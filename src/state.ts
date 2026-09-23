/**
 * state.json 持久化（~/.dsh/dsh-mcp-panel/state.json）。
 *
 * v2 结构（当前）：
 * - `servers`  ：全局 MCP 的策略（曝光档位 + 预设关联 + 工具级禁用 + 物化账本）
 * - `projects` ：项目级 MCP 的策略（工作空间 → serverName → 策略）
 * - `ai`       ：AI 保活标记（entryId → 上次启用时间）
 * - `config`   ：面板可写的插件配置（生效时机）
 *
 * v1 → v2 迁移由 `src/domain/policy.ts` 在插件启动早期执行一次（需要 loader/preset
 * 文件解析 serverName），v1 字段类型保留在本文件仅供迁移读取；迁移写回后不再出现。
 *
 * 内存态 + 写队列合并（P1-4）：启动加载一次，高频写（dsh_mcp_call 连击的 ai 标记）
 * 串行合并落盘，避免每次读+写各一次文件 IO。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import type { Exposure, PresetScope, ServerPolicy } from './domain/exposure'

const STATE_DIR = join(homedir(), '.dsh', 'dsh-mcp-panel')
/** 历史目录（0.6.0 之前叫 dsh-mcp-skill-panel、0.2.0 之前叫 dsh-runtime-inventory）。 */
const LEGACY_STATE_DIRS = [
  join(homedir(), '.dsh', 'dsh-mcp-skill-panel'),
  join(homedir(), '.dsh', 'dsh-runtime-inventory'),
]
const STATE_FILE = join(STATE_DIR, 'state.json')

/** 当前状态文件版本。 */
export const STATE_VERSION = 2

/** 每个预设文件（key=文件绝对路径）→ 每个 mcp 行 → 意图与上次物化状态（v1，仅迁移读）。 */
export interface McpRowState {
  /** toggle 时用户意图：是否停用 */
  desired: boolean
  /** toggle 时该行在文件中的实际状态（true/false/null=无 disabled 键） */
  lastApplied: boolean | null
}

/**
 * 一个 server 的持久化策略：领域策略（`domain/exposure.ts` 的 ServerPolicy）
 * + 物化账本 `applied`（上次写入预设文件的 disabled 状态，用于识别外部修改）。
 */
export interface ServerPolicyState extends ServerPolicy {
  /**
   * 上次物化到预设组合文件的 `disabled` 状态（`null` = 文件中无 `disabled` 键）。
   * `undefined` = 从未物化；读到与文件现状不一致 = 文件被外部改过，尊重现状不覆盖。
   */
  applied?: boolean | null
}

export type StateFile = {
  /** 状态结构版本；缺失/小于 2 表示需要 v1 迁移。 */
  version?: number
  /** v2：全局 serverName → 策略。 */
  servers?: Record<string, ServerPolicyState>
  /** v2：工作空间 → serverName → 策略（项目级 MCP）。 */
  projects?: Record<string, Record<string, ServerPolicyState>>
  /** AI 自动启用标记（dsh_mcp_call 保活启用）：entryId → 上次启用时间。 */
  ai?: Record<string, { at: number }>
  /** 面板可写的插件配置（生效时机），优先于 cordis config。 */
  config?: {
    applyMode?: ApplyMode
    /** v1 遗留：全局 AI 中间层开关（迁移后并入各 server 的 exposure 并删除）。 */
    autoManage?: boolean
  }
  /* ── v1 遗留字段（仅迁移读取；迁移写回后清除）──────────────────────── */
  /** v1：预设文件 → rowId → 启停意图。 */
  mcp?: Record<string, Record<string, McpRowState>>
  /** v1：项目级 MCP 启停意图（工作空间 → serverName → 是否停用）。 */
  projectMcp?: Record<string, Record<string, boolean>>
  /** v1：全局 MCP 工具级禁用（serverName → 禁用的工具全名）。 */
  toolDisabled?: Record<string, string[]>
  /** v1：项目级 MCP 工具禁用（工作空间 → serverName → 禁用工具全名）。 */
  projectToolDisabled?: Record<string, Record<string, string[]>>
}

/** 生效时机：immediate=立即（默认，下轮生效）；next-session=记意图、新会话/重启生效。 */
export type ApplyMode = 'immediate' | 'next-session'

/** 当前生效时机（缺省 immediate）。 */
export function stateApplyMode(state: StateFile): ApplyMode {
  return state.config?.applyMode === 'next-session' ? 'next-session' : 'immediate'
}

/* ── 策略读写（v2 分区，纯函数）──────────────────────────────────────── */

/** 取某 server 的策略槽（不存在返回 undefined）。workspace 缺省 = 全局表。 */
export function policySlotOf(
  state: StateFile,
  serverName: string,
  workspace?: string,
): ServerPolicyState | undefined {
  if (typeof workspace === 'string' && workspace.length > 0) return state.projects?.[workspace]?.[serverName]
  return state.servers?.[serverName]
}

/** 写入某 server 的策略（自动建表）。workspace 缺省 = 全局表。 */
export function setPolicySlot(
  state: StateFile,
  serverName: string,
  policy: ServerPolicyState,
  workspace?: string,
): void {
  if (typeof workspace === 'string' && workspace.length > 0) {
    state.projects ??= {}
    const table = (state.projects[workspace] ??= {})
    table[serverName] = policy
    return
  }
  state.servers ??= {}
  state.servers[serverName] = policy
}

/** 删除某 server 的策略槽（回落默认）。返回是否确实删除。 */
export function clearPolicySlot(state: StateFile, serverName: string, workspace?: string): boolean {
  if (typeof workspace === 'string' && workspace.length > 0) {
    const table = state.projects?.[workspace]
    if (!table || !(serverName in table)) return false
    delete table[serverName]
    if (Object.keys(table).length === 0) delete state.projects?.[workspace]
    return true
  }
  if (!state.servers || !(serverName in state.servers)) return false
  delete state.servers[serverName]
  return true
}

/** 构造策略槽（默认值 + 可选覆盖），供端点与迁移共用。 */
export function makePolicyState(
  patch: Partial<{ exposure: Exposure; presets: PresetScope; disabledTools: string[]; applied?: boolean }> = {},
): ServerPolicyState {
  const out: ServerPolicyState = {
    exposure: patch.exposure ?? 'native',
    presets: patch.presets ?? { mode: 'all', ids: [] },
    disabledTools: patch.disabledTools ?? [],
  }
  if (patch.applied !== undefined) out.applied = patch.applied
  return out
}

/* ── 文件 IO ─────────────────────────────────────────────────────────── */

let stateCache: StateFile | null = null
let stateDirty = false
let stateWriteChain: Promise<void> = Promise.resolve()

export async function readState(): Promise<StateFile> {
  if (stateCache) return stateCache
  let parsed: StateFile
  try {
    parsed = JSON.parse(await readFile(STATE_FILE, 'utf8')) as StateFile
  } catch {
    // 两种情况都落到这里：文件不存在（首次运行/迁移）或文件损坏。
    // 损坏时先备份原文件（state.corrupt.json），避免后续写盘把它彻底覆盖。
    await backupCorruptState()
    // 历史目录迁移（0.6.0 改名）：旧目录有数据则整体搬过来（state.json + catalog.json）
    const moved = await migrateDataDir()
    parsed = moved ?? {}
  }
  stateCache = parsed
  return parsed
}

/** 当前 state.json 存在但解析失败时备份一份（不覆盖已有备份）。 */
async function backupCorruptState(): Promise<void> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(join(STATE_DIR, 'state.corrupt.json'), raw, { encoding: 'utf8', mode: 0o600 })
  } catch {
    /* 文件不存在（首次运行）：无需备份 */
  }
}

/**
 * 把历史数据目录整体搬到当前目录（幂等；当前目录已有 state.json 时直接返回其内容）。
 * 迁移内容：state.json（策略与状态）+ catalog.json（工具目录 last-good 快照）。
 */
async function migrateDataDir(): Promise<StateFile | undefined> {
  for (const legacyDir of LEGACY_STATE_DIRS) {
    const legacyState = join(legacyDir, 'state.json')
    try {
      const text = await readFile(legacyState, 'utf8')
      await mkdir(STATE_DIR, { recursive: true })
      await rename(legacyState, STATE_FILE)
      // catalog.json 尽力一起搬（失败不影响状态加载）
      try {
        await rename(join(legacyDir, 'catalog.json'), join(STATE_DIR, 'catalog.json'))
      } catch {
        /* 旧目录没有 catalog 或搬不动：忽略 */
      }
      return JSON.parse(text) as StateFile
    } catch {
      /* 该历史目录不存在：尝试下一个 */
    }
  }
  return undefined
}

export async function writeState(state: StateFile): Promise<void> {
  stateCache = state
  stateDirty = true
  stateWriteChain = stateWriteChain
    .catch(() => {})
    .then(async () => {
      if (!stateDirty) return
      stateDirty = false
      const current = stateCache ?? state
      await mkdir(STATE_DIR, { recursive: true })
      await writeFile(`${STATE_FILE}.tmp`, JSON.stringify(current, null, 2), 'utf8')
      await rename(`${STATE_FILE}.tmp`, STATE_FILE)
    })
  await stateWriteChain
}

/** 状态文件路径（诊断端点与迁移备份用）。 */
export function stateFilePath(): string {
  return STATE_FILE
}

/** 状态文件所在目录（catalog.json 同目录）。 */
export function stateDir(): string {
  return STATE_DIR
}

/** AI-owner 标记读写：state.json 的 ai 段（entryId → {at}）。 */
export async function setStateAiOwner(entryId: string, at: number): Promise<void> {
  const state = await readState()
  state.ai ??= {}
  state.ai[entryId] = { at }
  await writeState(state)
}

export async function clearStateAiOwner(entryId: string): Promise<void> {
  const state = await readState()
  if (!state.ai || !(entryId in state.ai)) return
  delete state.ai[entryId]
  await writeState(state)
}
