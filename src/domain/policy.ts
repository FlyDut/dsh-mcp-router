/**
 * 策略层 —— 插件唯一的「每个 MCP 可见性/可用性」真源。
 *
 * 两份内存表：
 * - **intent**：用户意图（持久化到 state.json 的 `servers` / `projects` 分区）。
 * - **effective**：当前运行时生效值（装配层、`dsh_mcp_search`、`dsh_mcp_call` 只读这一份）。
 *
 * 生效时机（`applyMode`）：
 * - `immediate`（默认）：`set()` 同时更新两份，并通知 `onEffectiveChanged` 调整进程状态。
 * - `next-session`：只更新 intent 并落盘；effective 在会话边界（`commitPending()`）
 *   或重启后提升 —— 当前会话的工具集/前缀保持不变（零缓存失效）。
 *
 * 启动时执行一次 v1 → v2 迁移（`domain/exposure.ts` 的纯函数 + 这里的文件解析包装），
 * 原文件备份为 `state.v1.json`。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import {
  type Exposure,
  type ServerPolicy,
  defaultPolicy,
  hasV1PolicyData,
  migrateV1Policies,
  normalizePolicy,
} from './exposure'
import type { StateFile, ServerPolicyState } from '../state'
import { STATE_VERSION, readState, stateDir, stateFilePath, writeState } from '../state'
import { firstMatchServerName } from '../preset-mcp'
import { messageOf } from '../util'

/** 策略键：全局用空 workspace，项目级用其工作空间根。 */
function keyOf(serverName: string, workspace?: string): string {
  return `${workspace ?? ''}\u0000${serverName}`
}

/** 一次生效集合变化。 */
export interface PolicyChange {
  serverName: string
  workspace?: string
  policy: ServerPolicy
  previous: ServerPolicy | undefined
}/** 面板/诊断用的策略行。 */
export interface PolicyRow {
  serverName: string
  workspace?: string
  /** 用户意图。 */
  policy: ServerPolicy
  /** 当前生效。 */
  effective: ServerPolicy
  /** 意图与生效不一致（待生效）。 */
  pending: boolean
  /** 是否由用户显式配置过（false = 使用默认策略）。 */
  configured: boolean
}

export interface PolicyStoreOptions {
  ctx: Context
  /** 未配置过的 server 使用的默认档位（Config.defaultExposure）。 */
  fallbackExposure?: Exposure
  /** 生效集合变化后的回调（调整 loader 进程状态等）。 */
  onEffectiveChanged?: (changes: PolicyChange[]) => Promise<void> | void
}

export interface PolicyStore {
  /** 启动加载 + v1 迁移（幂等；apply 早期调用一次）。 */
  load(): Promise<void>
  /** 同步读生效策略。 */
  effective(serverName: string, workspace?: string): ServerPolicy
  /** 同步读用户意图（未配置返回 undefined）。 */
  intent(serverName: string, workspace?: string): ServerPolicyState | undefined
  /** 是否处于待生效（仅 next-session 模式可能出现）。 */
  isPending(serverName: string, workspace?: string): boolean
  /** 全部已配置策略行。 */
  list(): PolicyRow[]
  /** 写入策略（合并 patch）；`applyMode` 决定是否立即提升为生效。 */
  set(input: {
    serverName: string
    workspace?: string
    patch: Partial<ServerPolicy>
    applyMode: 'immediate' | 'next-session'
    /** 显式覆盖 `applied` 账本（物化链路用）。 */
    applied?: boolean | null
  }): Promise<{ applied: boolean; policy: ServerPolicyState }>
  /** 把全部待生效意图提升为生效；返回提升条数。 */
  commitPending(): Promise<number>
  /**
   * 改名迁移：把策略从旧 serverName 搬到新 serverName，并把工具级禁用的注册全名
   * 前缀一并重写（`mcp__old__x` → `mcp__new__x`）。不迁移等于改个名字就丢掉用户的
   * 档位 / 预设关联 / 工具禁用。
   */
  renameServer(oldName: string, newName: string, workspace?: string): Promise<boolean>
  /** 删除某 server 的策略（该服务器被删除时调用）。返回是否确实删过。 */
  clear(serverName: string, workspace?: string): Promise<boolean>
  /** 以「预设文件现状」对齐一个从未配置过的 server（首次物化用）。 */
  adoptFromFile(serverName: string, workspace: string | undefined, fileDisabled: boolean | null): Promise<ServerPolicyState | undefined>
  /** 记录某 server 的物化账本（写盘）。 */
  markApplied(serverName: string, workspace: string | undefined, applied: boolean | null): Promise<void>
  /** 诊断信息。 */
  diagnostics(): { loaded: boolean; version: number | null; configured: number; migrated: number | null; unresolved: string[]; lastError: string | null }
}

export function createPolicyStore(options: PolicyStoreOptions): PolicyStore {
  const { ctx } = options
  const fallbackExposure: Exposure = options.fallbackExposure ?? 'name-only'
  const intent = new Map<string, ServerPolicyState>()
  const effective = new Map<string, ServerPolicyState>()
  const pending = new Set<string>()
  let loaded = false
  let version: number | null = null
  let migrated: number | null = null
  let lastError: string | null = null
  const diagnosticsUnresolved: string[] = []

  const slot = (table: Map<string, ServerPolicyState>, key: string): ServerPolicyState => {
    const hit = table.get(key)
    if (hit) return hit
    const created: ServerPolicyState = defaultPolicy(fallbackExposure)
    table.set(key, created)
    return created
  }

  /** intent → effective 的纯拷贝（保持两份表独立，便于 pending 判定）。 */
  function promote(keys: Iterable<string>): PolicyChange[] {
    const changes: PolicyChange[] = []
    for (const key of keys) {
      const desired = intent.get(key)
      if (!desired) continue
      const previous = effective.get(key)
      const next: ServerPolicyState = {
        exposure: desired.exposure,
        presets: { mode: desired.presets.mode, ids: [...desired.presets.ids] },
        disabledTools: [...desired.disabledTools],
      }
      effective.set(key, next)
      changes.push({
        serverName: key.slice(key.indexOf('\u0000') + 1),
        workspace: key.slice(0, key.indexOf('\u0000')) || undefined,
        policy: next,
        previous,
      })
    }
    return changes
  }

  function loadFromState(state: StateFile): void {
    for (const [serverName, raw] of Object.entries(state.servers ?? {})) {
      const policy = normalizePolicy(raw, fallbackExposure)
      const entry: ServerPolicyState = { ...policy }
      if (typeof raw?.applied === 'boolean' || raw?.applied === null) entry.applied = raw.applied
      intent.set(keyOf(serverName), entry)
    }
    for (const [workspace, table] of Object.entries(state.projects ?? {})) {
      for (const [serverName, raw] of Object.entries(table ?? {})) {
        const policy = normalizePolicy(raw, fallbackExposure)
        const entry: ServerPolicyState = { ...policy }
        if (typeof raw?.applied === 'boolean' || raw?.applied === null) entry.applied = raw.applied
        intent.set(keyOf(serverName, workspace), entry)
      }
    }
  }

  /** 把两份表写回 state.json 的 v2 分区（并清除 v1 遗留字段）。 */
  function toState(state: StateFile): StateFile {
    const servers: Record<string, ServerPolicyState> = {}
    const projects: Record<string, Record<string, ServerPolicyState>> = {}
    for (const [key, policy] of intent) {
      const at = key.indexOf('\u0000')
      const workspace = key.slice(0, at)
      const serverName = key.slice(at + 1)
      if (workspace.length === 0) servers[serverName] = policy
      else (projects[workspace] ??= {})[serverName] = policy
    }
    const next: StateFile = { ...state, version: STATE_VERSION, servers, projects }
    delete next.mcp
    delete next.projectMcp
    delete next.toolDisabled
    delete next.projectToolDisabled
    if (next.config) {
      delete next.config.autoManage
    }
    return next
  }

  /** v1 → v2 迁移（纯函数 + 文件解析包装）；返回迁移条数。 */
  async function migrate(state: StateFile): Promise<number> {
    const autoManage = state.config?.autoManage === true
    // 预读全部 preset 文件文本：迁移是启动期一次性操作，读盘成本可忽略
    const files = new Set<string>(Object.keys(state.mcp ?? {}))
    const texts = new Map<string, string | null>()
    for (const file of files) {
      try {
        texts.set(file, await readFile(file, 'utf8'))
      } catch {
        texts.set(file, null) // 文件不可读 → 回落命名约定
      }
    }
    const result = migrateV1Policies(
      {
        mcp: state.mcp,
        projectMcp: state.projectMcp,
        toolDisabled: state.toolDisabled,
        projectToolDisabled: state.projectToolDisabled,
      },
      (file, rowId) => firstMatchServerName(texts.get(file) ?? null, rowId),
      autoManage,
    )
    for (const [serverName, policy] of Object.entries(result.servers)) {
      if (!intent.has(keyOf(serverName))) intent.set(keyOf(serverName), { ...policy })
    }
    for (const [workspace, table] of Object.entries(result.projects)) {
      for (const [serverName, policy] of Object.entries(table)) {
        const key = keyOf(serverName, workspace)
        if (!intent.has(key)) intent.set(key, { ...policy })
      }
    }
    // 迁移 v1 的 lastApplied 账本（识别后续「文件被外部修改」用）
    for (const [file, rows] of Object.entries(state.mcp ?? {})) {
      for (const [rowId, row] of Object.entries(rows ?? {})) {
        const serverName = firstMatchServerName(texts.get(file) ?? null, rowId)
        if (!serverName) continue
        const entry = intent.get(keyOf(serverName))
        if (entry && entry.applied === undefined && row && typeof row.lastApplied === 'boolean') {
          entry.applied = row.lastApplied
        }
      }
    }
    diagnosticsUnresolved.push(...result.unresolved)
    return result.migrated
  }

  return {
    async load() {
      if (loaded) return
      try {
        const state = await readState()
        version = typeof state.version === 'number' ? state.version : null
        if (version !== STATE_VERSION && hasV1PolicyData(state)) {
          // 迁移前把原文件（含全部 v1 字段）备份为 state.v1.json，失败不阻塞迁移
          try {
            const raw = await readFile(stateFilePath(), 'utf8')
            await mkdir(stateDir(), { recursive: true })
            await writeFile(`${stateDir()}/state.v1.json`, raw, { encoding: 'utf8', mode: 0o600 })
          } catch (error) {
            ctx.logger.warn?.(`dsh-mcp-router: state v1 backup failed: ${messageOf(error)}`)
          }
          loadFromState(state)
          migrated = await migrate(state)
          await writeState(toState(state))
          ctx.logger.info?.(`dsh-mcp-router: migrated ${migrated} state entr(ies) to v${STATE_VERSION}`)
        } else {
          loadFromState(state)
          if (version !== STATE_VERSION) {
            // 无 v1 数据：仅补版本号
            await writeState(toState(state))
          }
        }
        // 重启后生效值 = 意图（新进程即新边界）
        promote([...intent.keys()])
        loaded = true
      } catch (error) {
        lastError = messageOf(error)
        loaded = true
        ctx.logger.warn?.(`dsh-mcp-router: policy load failed: ${lastError}`)
      }
    },

    effective(serverName, workspace) {
      return effective.get(keyOf(serverName, workspace)) ?? defaultPolicy(fallbackExposure)
    },

    intent(serverName, workspace) {
      return intent.get(keyOf(serverName, workspace))
    },

    isPending(serverName, workspace) {
      return pending.has(keyOf(serverName, workspace))
    },

    list() {
      const rows: PolicyRow[] = []
      for (const [key, policy] of intent) {
        const at = key.indexOf('\u0000')
        const workspace = key.slice(0, at)
        const serverName = key.slice(at + 1)
        const row: PolicyRow = {
          serverName,
          policy,
          effective: effective.get(key) ?? defaultPolicy(fallbackExposure),
          pending: pending.has(key),
          configured: true,
        }
        if (workspace.length > 0) row.workspace = workspace
        rows.push(row)
      }
      rows.sort((a, b) => a.serverName.localeCompare(b.serverName))
      return rows
    },

    async set(input) {
      const key = keyOf(input.serverName, input.workspace)
      const current = slot(intent, key)
      const merged = normalizePolicy(
        {
          exposure: input.patch.exposure ?? current.exposure,
          presets: input.patch.presets ?? current.presets,
          disabledTools: input.patch.disabledTools ?? current.disabledTools,
        },
        fallbackExposure,
      )
      const entry: ServerPolicyState = { ...merged }
      if (input.applied !== undefined) entry.applied = input.applied
      else if (current.applied !== undefined) entry.applied = current.applied
      intent.set(key, entry)

      const immediate = input.applyMode === 'immediate'
      let changes: PolicyChange[] = []
      if (immediate) {
        pending.delete(key)
        changes = promote([key])
      } else {
        pending.add(key)
      }
      // 先落盘（意图是真相），再执行进程状态副作用：副作用失败不能丢用户设置
      const state = await readState()
      await writeState(toState(state))
      if (changes.length > 0) {
        try {
          await options.onEffectiveChanged?.(changes)
        } catch (error) {
          ctx.logger.warn?.(`dsh-mcp-router: apply process state failed: ${messageOf(error)}`)
        }
      }
      return { applied: immediate, policy: entry }
    },

    async commitPending() {
      if (pending.size === 0) return 0
      const keys = [...pending]
      pending.clear()
      const changes = promote(keys)
      const state = await readState()
      await writeState(toState(state))
      try {
        await options.onEffectiveChanged?.(changes)
      } catch (error) {
        ctx.logger.warn?.(`dsh-mcp-router: apply process state failed: ${messageOf(error)}`)
      }
      return changes.length
    },

    async renameServer(oldName, newName, workspace) {
      const fromKey = keyOf(oldName, workspace)
      const toKey = keyOf(newName, workspace)
      if (fromKey === toKey) return false
      const entry = intent.get(fromKey)
      if (!entry) return false
      const prefix = `mcp__${oldName}__`
      const disabledTools = entry.disabledTools.map((name) =>
        name.startsWith(prefix) ? `mcp__${newName}__${name.slice(prefix.length)}` : name,
      )
      const next: ServerPolicyState = { ...entry, disabledTools }
      intent.delete(fromKey)
      effective.delete(fromKey)
      const wasPending = pending.delete(fromKey)
      intent.set(toKey, next)
      effective.set(toKey, {
        exposure: next.exposure,
        presets: { mode: next.presets.mode, ids: [...next.presets.ids] },
        disabledTools: [...next.disabledTools],
      })
      if (wasPending) pending.add(toKey)
      const state = await readState()
      await writeState(toState(state))
      return true
    },

    async clear(serverName, workspace) {
      const key = keyOf(serverName, workspace)
      const had = intent.delete(key)
      effective.delete(key)
      pending.delete(key)
      if (!had) return false
      const state = await readState()
      await writeState(toState(state))
      return true
    },

    async adoptFromFile(serverName, workspace, fileDisabled) {
      const key = keyOf(serverName, workspace)
      if (intent.has(key)) return undefined
      const exposure: Exposure = fileDisabled === true ? 'hidden' : 'name-only'
      const entry: ServerPolicyState = { ...defaultPolicy(exposure) }
      if (fileDisabled !== null) entry.applied = fileDisabled
      intent.set(key, entry)
      effective.set(key, {
        exposure: entry.exposure,
        presets: { ...entry.presets },
        disabledTools: [...entry.disabledTools],
      })
      const state = await readState()
      await writeState(toState(state))
      return entry
    },

    async markApplied(serverName, workspace, applied) {
      const key = keyOf(serverName, workspace)
      const entry = intent.get(key)
      if (!entry) return
      entry.applied = applied
      const state = await readState()
      await writeState(toState(state))
    },

    diagnostics() {
      return {
        loaded,
        version,
        configured: intent.size,
        migrated,
        unresolved: [...diagnosticsUnresolved],
        lastError,
      }
    },
  }
}
