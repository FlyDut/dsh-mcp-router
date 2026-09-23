/**
 * MCP 中间层：模型面恒定 2 个工具 + 控制层。
 *
 * 模型面：
 *   dsh_mcp_search —— 检索私有 catalog（索引 / 列表 / top-K 全文检索），
 *                 结果按当前会话的曝光档位与预设关联过滤
 *   dsh_mcp_call   —— 按需启用指定 server → 执行工具 → 返回文本结果；
 *                 工具名未知时直接返回该 server 的工具清单
 *
 * 控制层职责：
 * - ensureEnabled：从注册表反查 loader entry，disabled 时 update 开启并记录
 *   AI owner（写 state.json 的 ai 段）。
 * - waitRegistered：轮询 ctx.tools.get + tools/change 事件加速。
 * - call：访问判定 → enable → waitRegistered → ctx.tools.execute。失败时若本次
 *   AI 启用且无并发则恢复 disabled 并清 owner。
 * - 引用计数（Map<serverName, number>）+ 空闲回收器（ctx.interval 每 10s 扫描）。
 *
 * 可用性判定（曝光档位 + 预设隔离 + 工具级禁用）经 `McpControlCtx.accessOf` 注入，
 * 与装配层共用同一套策略真源（`domain/policy.ts`）。
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Catalog, SearchHit } from './catalog'
import { searchCatalog, listServer, serverOfMcp } from './catalog'
import type { Exposure, ServerPolicy } from './domain/exposure'
import { listedInSummary, policyDisablesTool } from './domain/exposure'
import type { ServerRef } from './domain/registry'

/**
 * 某一 server 对当前会话的访问判定结果。
 * `effective` 与装配层同源（`decideExposure`），保证「模型看到的」与「能调用的」一致。
 */
export interface McpAccess {
  /** 有效曝光；`off` = 不可见且不可调用。 */
  effective: Exposure
  /** 生效策略（工具级禁用 + 预设关联文案用）。 */
  policy: ServerPolicy
  /** 注册表引用（未知 server 时为 undefined）。 */
  ref?: ServerRef
  /** 当前会话的 preset id（错误文案用）。 */
  presetId?: string
  /** `off` 的成因：预设隔离 / 档位关闭 / 工作区不符 / 未知 server。 */
  blockedBy: 'none' | 'preset' | 'exposure' | 'workspace' | 'unknown'
}

/** 空闲回收器扫描周期（ms）。 */
const REAPER_INTERVAL_MS = 10_000
/** waitRegistered 轮询间隔（ms）。 */
const REGISTER_POLL_MS = 50
/** 默认注册 / 调用超时：60s。 */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/**
 * 控制工具名（单一事实源）。
 *
 * ⚠️ 名字**不得以 `mcp_` 开头**：claude.ai 订阅网关把 `mcp_` 前缀当作 connector
 * 保留名，工具表里含旧名（`mcp_search` / `mcp_call`）会让整个请求 400 并伪报配额
 * 耗尽（上游 PR #16 的 A/B/A 取证：含这两个工具 5/5 全 400，不含 111/111 成功）。
 * selftest-mcp.mjs 有护栏断言，防止日后改回去。
 */
export const MCP_SEARCH_TOOL = 'dsh_mcp_search'
export const MCP_CALL_TOOL = 'dsh_mcp_call'
/** 中间层注册的两个控制工具名（装配层/网关按此判定控制工具）。 */
export const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set([MCP_SEARCH_TOOL, MCP_CALL_TOOL])

/**
 * 归一化 dsh_mcp_call 的 tool 参数（2026-08-22 修补）：模型可能把 dsh_mcp_search 返回的
 * 注册全名（mcp__<server>__<tool>）直接填入 tool，无条件拼接会生成双重前缀。
 * 规则：以 mcp__ 开头视为注册全名形态 → 循环剥离本 server 前缀（兼容嵌套重复）；
 * 剥完仍以 mcp__ 开头 → 传的是其他 server 的注册全名或格式异常 → 快速失败
 * （避免在 waitRegistered 白等满 toolCallTimeoutMs，默认 60s、mimo-image 300s）。
 * 注：远端工具裸名恰好以 mcp__ 开头属生态外的病态命名，会被误判，可接受。
 */
export function normalizeToolName(serverName: string, toolName: string): string {
  const prefix = `mcp__${serverName}__`
  let name = toolName
  if (name.startsWith('mcp__')) {
    while (name.startsWith(prefix)) name = name.slice(prefix.length)
    if (name.startsWith('mcp__')) {
      throw new Error(
        `dsh_mcp_call: tool 参数疑似其他 MCP server 的注册全名（${JSON.stringify(toolName)}，server="${serverName}"）；请传该 server 上的裸名（如 understand_image，不带 mcp__ 前缀）`,
      )
    }
  }
  return name
}

/**
 * 归一化 dsh_mcp_call 的 arguments 参数（2026-08-24 修补）：模型直连 Tool call 时倾向把
 * 参数字典填成 JSON 字符串（实测 flash 与 mimo 两系均会出现）。这里循环安全解析为对象
 * 后再透传。
 *
 * 2026-09-18：arguments 的 schema 已改为 oneOf[object, string]（见 registerMcpCallTool），
 * 其中 string 分支专为保留下面的兼容路径而存在——不能删掉该分支，否则字符串入参会先在
 * defineTool 的校验阶段被拒，本函数永远轮不到执行。object 分支已在执行前挡掉
 * [] / 42 / null 等错误形态，因此这里只需处理「字符串 → 对象」这一种转换：
 * - 值以 { / [ 开头 → 直接按容器 JSON 解析；
 * - 值以 " 开头（引号包裹层）→ 解包后若内层仍是容器形态才继续剥，防止误改合法标量入参；
 * - 解析失败或非字典形态 → 保留原值交由远端给出可读错误。
 */
export function normalizeArguments(raw: unknown): unknown {
  let value: unknown = raw ?? {}
  let depth = 0
  while (typeof value === 'string' && depth < 4) {
    const trimmed = value.trim()
    if (trimmed.length === 0) return {}
    const head = trimmed.charCodeAt(0)
    const isContainerJson = head === 123 /* { */ || head === 91 /* [ */
    const isQuotedJson = head === 34 /* " */
    if (!isContainerJson && !isQuotedJson) break
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      break
    }
    if (parsed !== null && typeof parsed === 'object') {
      return parsed
    }
    // 解出标量：仅「引号包裹层 + 内层仍为容器形态」才继续剥，其余视为字面量入参
    const inner = typeof parsed === 'string' ? parsed.trim() : ''
    const innerLooksContainer = inner.startsWith('{') || inner.startsWith('[')
    if (!isQuotedJson || !innerLooksContainer) break
    value = parsed
    depth++
  }
  return value
}

/**
 * 控制层依赖：由 src/index.ts 在 apply 里构建并注入。这些 helper 封闭了
 * 插件对 catalog 内存态、catalog.json 持久化、loader entry 反查、state.json
 * AI-owner 标记的读写 —— 这样控制层不反向依赖 index.ts（避免循环依赖）。
 */
export interface McpControlCtx {
  /** 空闲回收窗口（ms）。 */
  keepAliveMs: number
  /** dsh_mcp_search 缺省 top-K。 */
  searchLimitDefault: number
  /** dsh_mcp_search top-K 上限。 */
  searchLimitMax: number
  /** 能力摘要表（Config.serverSummary）。 */
  serverSummary: Record<string, string>

  /** 当前内存 catalog。 */
  getCatalog(): Catalog
  /** 替换内存 catalog（快照 / 增量后）。 */
  setCatalog(catalog: Catalog): void
  /** 把内存 catalog 持久化到 catalog.json。 */
  persistCatalog(): Promise<void>

  /** 按 serverName 反查 loader entry；无则 undefined。 */
  resolveEntry(serverName: string): Entry | undefined
  /**
   * 访问判定：该 server 对给定 agent 的有效曝光 + 成因（与装配层同源）。
   * agent 缺省（无会话上下文）时按「无预设、无工作区」判定。
   */
  accessOf(serverName: string, agent: Agent | undefined): McpAccess
  /** 同上，但直接给 presetId / workspace（面板按会话参数查询用）。 */
  accessFor(serverName: string, presetId: string | undefined, workspace: string | undefined): McpAccess
  /** 当前 agent 运行的 preset id（错误文案与诊断用）。 */
  presetIdOf(agent: Agent | undefined): string | undefined
  /** server 自己的注册/调用超时（读 entry config 的 toolCallTimeoutMs，缺省回退）。 */
  serverTimeoutMs(serverName: string): number

  /**
   * rc.1 standing 组合兜底超时（窄场景）：loader 有行但缺 toolCallTimeoutMs 时，
   * 从 preset 快照补读。loader 无行（dsh_mcp_call 预设行）仍走「不在 loader 中」返回，
   * 预设行直通调用是后续修复，本 PR 定为仅面板修复（见 toggleMcp 预设分支注释）。
   * 返回 undefined = preset 也无该 server，调用方回退默认超时。
   * 调用方应做 TTL 缓存（inventory+resolve+read 较重），见 index.ts 闭包。
   */
  presetTimeoutMs?(serverName: string): Promise<number | undefined>

  /** AI-owner 标记：上次自动开启该 entry 的时间戳。 */
  setAiOwner(entryId: string, at: number): Promise<void>
  clearAiOwner(entryId: string): Promise<void>

  /** 对所有当前 enabled 的 server 重新快照（tools/change / 启动）。 */
  snapshotEnabled(): Promise<void>
}

interface ControllerState {
  refCounts: Map<string, number>
  lastUsed: Map<string, number>
  aiEnabled: Set<string>
}

export interface McpCallController {
  /** 访问判定（面板/诊断用；与装配层同源）。 */
  accessFor(serverName: string, presetId: string | undefined, workspace: string | undefined): McpAccess
  /** 保活启用：disabled 时开启并记录 AI owner。返回本次是否由 AI 开启。 */
  ensureEnabled(serverName: string): Promise<boolean>
  /** 该 server 当前是否由 AI 临时启用（dsh_mcp_call 保活中）——装配过滤据此保持其不可见。 */
  isAiEnabled(serverName: string): boolean
  /**
   * 用户手动打开该 server：清除 AI 临时启用标记（aiEnabled/引用计数/lastUsed +
   * state.json 的 ai owner），使其转为「用户打开」语义 —— 模型立即可见、回收器不再回收。
   */
  markUserEnabled(serverName: string): void
  /** 完整调用流程，返回给模型的文本结果（不会 throw，错误也转文本）。 */
  call(
    serverName: string,
    toolName: string,
    args: unknown,
    agent: Agent | undefined,
    signal: AbortSignal,
    explicitTimeoutMs?: number,
  ): Promise<string>
  /** 启动空闲回收器；返回 disposer。 */
  startIdleReaper(): () => void
  /** 诊断视图：AI 启用的 server 及其引用计数。 */
  status(): Array<{ server: string; refCount: number; lastUsed: number }>
}

export function msgOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    try {
      const text = JSON.stringify(error)
      if (typeof text === 'string' && text.length > 0) return text
    } catch {
      /* 循环引用等序列化失败 → 回退 String */
    }
  }
  return String(error)
}

/** 从 execute 结果的 content 块抽取文本（防御式）。 */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else if (typeof b.text === 'string') parts.push(b.text)
    }
  }
  return parts.join('\n').trim()
}

/** 可执行一个注册工具的最小视图（宿主 ctx 或调用方 agent ctx 的 tools 服务）。 */
interface ToolView {
  label: string
  tools: { get(name: string, scope?: object): unknown; execute(exec: unknown): Promise<unknown> } | undefined
  scope: object | undefined
}

/**
 * 组装候选工具视图（2026-08-24 scope 回归第二版修复）：dsh-tools 注册表的
 * scope 约定是「agent 对象」而非 `scopeOf(agent.ctx)` 的 ctx 标签——模型面的
 * schemas(exec.agent) / 执行面 get(name, agent) 均以 agent 对象为钥匙建立层级链，
 * session-boundary 下 MCP 工具注册进该链可达的作用域层；而旧实现用 scopeOf(agent.ctx)
 * 查询同一注册表，链条不达 → 全部「未在超时内注册」。现改为直接以 agent 对象为
 * 作用域钥匙，与模型面/执行面完全同构；无 agent 时退回全局视图。
 */
function collectToolViews(ctx: Context, agent: Agent | undefined): Array<ToolView> {
  const views: Array<ToolView> = []
  if (agent) views.push({ label: 'agent-object', tools: ctx.tools, scope: agent })
  views.push({ label: 'host-global', tools: ctx.tools, scope: undefined })
  return views
}

async function ensureEnabled(
  control: McpControlCtx,
  ctx: Context,
  state: ControllerState,
  serverName: string,
  entry: Entry,
): Promise<boolean> {
  const wasDisabled = entry.disabled
  const entryId = entry.id
  if (wasDisabled) {
    await entry.update({ disabled: false })
    state.aiEnabled.add(serverName)
    await control.setAiOwner(entryId, Date.now())
    ctx.logger.info?.(`mcp-panel: AI enabled MCP server "${serverName}"`)
  }
  return wasDisabled
}

async function waitRegistered(
  ctx: Context,
  name: string,
  views: Array<ToolView>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolView | undefined> {
  const start = Date.now()
  return new Promise<ToolView | undefined>((resolve, reject) => {
    let settled = false
    let pollTimer: (() => void) | undefined
    let offTools: (() => boolean) | undefined
    let offAbort: (() => void) | undefined
    let offDispose: (() => void) | undefined
    const onAbort = () => finish(new Error('aborted'))
    const finish = (error?: Error, view?: ToolView) => {
      if (settled) return
      settled = true
      pollTimer?.()
      offTools?.()
      offAbort?.()
      offDispose?.()
      if (error) reject(error)
      else resolve(view)
    }
    const check = () => {
      if (settled) return
      for (const view of views) {
        if (!view.tools) continue
        try {
          if (Boolean(view.tools.get(name, view.scope as object | undefined))) {
            ctx.logger.info?.(`mcp-panel: tool "${name}" resolved via view "${view.label}"`)
            return finish(undefined, view)
          }
        } catch {
          /* 该视图查询失败，换下一个 */
        }
      }
      if (Date.now() - start >= timeoutMs) {
        return finish(new Error(`tool "${name}" 未在 ${timeoutMs}ms 内注册`))
      }
      pollTimer = ctx.timeout(check, REGISTER_POLL_MS)
    }
    offTools = ctx.root.on('tools/change', () => check())
    // 上下文销毁 → 立即终局：此前无 dispose 监听时 Promise 永不 settle，会挂起 dsh_mcp_call。
    offDispose = ctx.effect(() => () => finish(new Error('context disposed')), 'mcp-panel: waitRegistered')
    // 调用方中止（exec.signal）→ 立即终局。
    if (signal) {
      if (signal.aborted) {
        finish(new Error('aborted'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      offAbort = () => signal.removeEventListener('abort', onAbort)
    }
    check()
  })
}

/** 失败 / 无并发时恢复原状态：禁用并清 AI owner。 */
async function restore(
  control: McpControlCtx,
  ctx: Context,
  state: ControllerState,
  serverName: string,
  entryId: string,
): Promise<void> {
  // 用户中途手动打开（markUserEnabled）会清除 AI 标记 → 该 server 已转交用户管理，
  // 本次调用不再拥有它，绝不能恢复 disabled（否则关闭用户手动打开的 server，违反
  // 「用户启停不被模型干预」承诺）。引用计数等残留一并清掉。
  if (!state.aiEnabled.has(serverName)) {
    state.refCounts.delete(serverName)
    state.lastUsed.delete(serverName)
    return
  }
  try {
    const entry = control.resolveEntry(serverName)
    if (entry && entry.id === entryId && !entry.disabled) {
      await entry.update({ disabled: true })
    }
    await control.clearAiOwner(entryId)
  } catch (error) {
    ctx.logger.warn?.(`mcp-panel: restore disabled for "${serverName}" failed: ${msgOf(error)}`)
  } finally {
    state.aiEnabled.delete(serverName)
    state.lastUsed.delete(serverName)
    state.refCounts.delete(serverName)
  }
}

/** 不可调用时的拒绝文案（区分预设隔离 / 档位关闭两种成因）。 */
function blockedText(serverName: string, access: McpAccess): string {
  switch (access.blockedBy) {
    case 'preset':
      return (
        `MCP server "${serverName}" 未对当前 agent 预设（${access.presetId ?? '无预设'}）开放；` +
        `如需使用，请在 MCP 调整该服务器的预设关联。`
      )
    case 'exposure':
      return (
        `MCP server "${serverName}" 已被设为「彻底关闭」（off），不可调用；` +
        `如需使用，请在 MCP 把它的状态改为「原生注入 / 仅名称 / 隐藏」。`
      )
    case 'workspace':
      return `MCP server "${serverName}" 属于另一个工作空间的项目级配置，仅该工作空间的会话可用。`
    default:
      return `未知 MCP server：${serverName}（不在注册表中）`
  }
}

/** 从工具注册全名取裸名（`mcp__<server>__<tool>` → `<tool>`）。 */
function bareNameOf(fullName: string): string {
  const rest = String(fullName).replace(/^mcp__/, '')
  const at = rest.indexOf('__')
  return at < 0 ? rest : rest.slice(at + 2)
}

/**
 * 该 server 的工具清单文本（`dsh_mcp_call` 只传 server、或工具名未知时返回）。
 * 这是「仅名称」档位下模型发现工具的主要路径：不必猜名字，直接问。
 */
function toolListText(caches: McpControlCtx, serverName: string): string {
  const listing = listServer(caches.getCatalog(), serverName)
  if (!listing.found || listing.totalCount === 0) {
    return (
      `MCP server "${serverName}" 目前没有采集到工具目录（可能尚未运行过或该 server 无工具）。` +
      `可直接用 dsh_mcp_call 指定裸工具名尝试；或用 dsh_mcp_search({ server: "${serverName}" }) 重试。`
    )
  }
  const lines = listing.tools.map((tool) => `- ${bareNameOf(tool.name)}: ${tool.description || '（无描述）'}`)
  return (
    `MCP server "${serverName}" 的工具清单（共 ${listing.totalCount} 个）：\n${lines.join('\n')}\n\n` +
    `调用方式：dsh_mcp_call({ server: "${serverName}", tool: "<上面的裸名>", arguments: { ... } })`
  )
}

function startIdleReaper(control: McpControlCtx, ctx: Context, state: ControllerState): () => void {
  return ctx.interval(() => {
    const now = Date.now()
    for (const server of [...state.aiEnabled]) {
      const refCount = state.refCounts.get(server) ?? 0
      if (refCount > 0) continue
      const last = state.lastUsed.get(server) ?? 0
      if (now - last < control.keepAliveMs) continue
      const entry = control.resolveEntry(server)
      if (!entry) {
        state.aiEnabled.delete(server)
        state.refCounts.delete(server)
        state.lastUsed.delete(server)
        continue
      }
      const entryId = entry.id
      void (async () => {
        try {
          if (!entry.disabled) await entry.update({ disabled: true })
          // 二次检查：await 让出事件循环期间可能有新 call() 接手（refCount 升到 1），
          // 此时放弃本轮回收，不清 owner 不打日志。
          if ((state.refCounts.get(server) ?? 0) > 0) return
          await control.clearAiOwner(entryId)
          ctx.logger.info?.(`mcp-panel: idle-reaped MCP server "${server}"`)
        } catch (error) {
          ctx.logger.warn?.(`mcp-panel: idle reaper disable "${server}" failed: ${msgOf(error)}`)
        } finally {
          // 仅在无新调用接手时才删除状态，防止把新 call() 的计数清掉。
          if ((state.refCounts.get(server) ?? 0) === 0) {
            state.aiEnabled.delete(server)
            state.refCounts.delete(server)
            state.lastUsed.delete(server)
          }
        }
      })()
    }
  }, REAPER_INTERVAL_MS)
}

/**
 * 创建控制层控制器。`caches` 即控制层依赖（McpControlCtx），由 index.ts
 * 在 apply 里构建并封闭所有 IO。
 */
export function createMcpCallController(ctx: Context, caches: McpControlCtx): McpCallController {
  const state: ControllerState = {
    refCounts: new Map<string, number>(),
    lastUsed: new Map<string, number>(),
    aiEnabled: new Set<string>(),
  }

  const controller: McpCallController = {
    accessFor: (serverName, presetId, workspace) => caches.accessFor(serverName, presetId, workspace),

    async ensureEnabled(serverName): Promise<boolean> {
      const entry = caches.resolveEntry(serverName)
      if (!entry) throw new Error(`unknown MCP server "${serverName}"`)
      return ensureEnabled(caches, ctx, state, serverName, entry)
    },

    isAiEnabled(serverName): boolean {
      return state.aiEnabled.has(serverName)
    },

    markUserEnabled(serverName): void {
      state.aiEnabled.delete(serverName)
      state.refCounts.delete(serverName)
      state.lastUsed.delete(serverName)
      const entry = caches.resolveEntry(serverName)
      if (entry) void caches.clearAiOwner(entry.id)
    },

    async call(serverName, toolName, args, agent, signal, explicitTimeoutMs) {
      // ① 访问判定（曝光档位 + 预设隔离）：与装配层同源，保证「看不到就调不动」
      const access = caches.accessOf(serverName, agent)
      if (access.blockedBy === 'unknown') return `未知 MCP server：${serverName}（不在注册表中）`
      if (access.effective === 'off') return blockedText(serverName, access)

      // ② 工具名未知/为空 → 直接返回该 server 的工具清单（「仅名称」档位的发现路径）
      const rawTool = typeof toolName === 'string' ? toolName.trim() : ''
      if (rawTool.length === 0 || rawTool === '*') return toolListText(caches, serverName)
      const bareTool = normalizeToolName(serverName, rawTool)
      const name = `mcp__${serverName}__${bareTool}`
      // ③ 工具级禁用（面板指定关闭）：拒绝并提示可经面板重新开启
      if (policyDisablesTool(access.policy, name)) {
        return `MCP 工具 ${serverName}.${bareTool} 已被禁用（请在 MCP 打开该工具后再调用）`
      }

      const entry = caches.resolveEntry(serverName)
      const ref = access.ref
      const presetTimeout = caches.presetTimeoutMs ? await caches.presetTimeoutMs(serverName).catch(() => undefined) : undefined
      const timeoutMs = explicitTimeoutMs ?? presetTimeout ?? caches.serverTimeoutMs(serverName)

      // ④ 保活启用：loader 行可即时启停；预设组合行不在 loader 中，只能在已运行时直连执行
      let aiOwned = false
      if (entry) {
        try {
          aiOwned = await ensureEnabled(caches, ctx, state, serverName, entry)
        } catch (error) {
          return `启用 MCP server "${serverName}" 失败：${msgOf(error)}`
        }
        state.refCounts.set(serverName, (state.refCounts.get(serverName) ?? 0) + 1)
        state.lastUsed.set(serverName, Date.now())
      } else if (!ref || !ref.running || ref.disabled) {
        return (
          `MCP server "${serverName}" 当前未运行，且它的行不在 loader 中（预设组合行）——` +
          `无法即时保活启用。请在 MCP 把它切换为「原生注入」或「仅名称」后重启 DSH 生效。`
        )
      }

      let failed = false
      try {
        // 2026-08-24：多视图轮询（agent 作用域/全局 + 宿主作用域/全局），
        // 命中视图负责执行；未见任何视图注册时保持原有超时语义。
        const views = collectToolViews(ctx, agent)
        const view = await waitRegistered(ctx, name, views, timeoutMs, signal)
        // view 在 waitRegistered resolve 时必定存在（ToolView 已被解析）
        const execTools = view!.tools!
        const result = (await execTools.execute({
          callId: `mcp-call-${randomUUID()}` as import('@deepseek-ai/dsh-llm').ToolCallId,
          name,
          arguments: args,
          agent,
          signal,
        })) as { isError?: boolean; error?: unknown; content?: unknown } | undefined
        if (entry) state.lastUsed.set(serverName, Date.now())
        if (result && result.isError) {
          failed = true
          return `MCP ${serverName}.${bareTool} 调用失败：${msgOf((result as { error?: unknown }).error ?? 'unknown error')}`
        }
        const text = contentText(result ? (result as { content?: unknown }).content : undefined)
        return text.length > 0 ? text : `MCP ${serverName}.${bareTool} 无返回内容`
      } catch (error) {
        failed = true
        return `MCP ${serverName}.${bareTool} 调用异常：${msgOf(error)}（提示：tool 参数应传该 server 上的裸名；不确定工具名时可用 dsh_mcp_call 只传 server 获取工具清单）`
      } finally {
        if (entry) {
          const next = (state.refCounts.get(serverName) ?? 1) - 1
          if (next <= 0) state.refCounts.delete(serverName)
          else state.refCounts.set(serverName, next)
          // 本次 AI 启用的，失败且无并发 → 恢复原状态
          if (failed && aiOwned && next <= 0) void restore(caches, ctx, state, serverName, entry.id)
        }
      }
    },

    startIdleReaper() {
      return startIdleReaper(caches, ctx, state)
    },

    status() {
      const out: Array<{ server: string; refCount: number; lastUsed: number }> = []
      for (const server of state.aiEnabled) {
        out.push({ server, refCount: state.refCounts.get(server) ?? 0, lastUsed: state.lastUsed.get(server) ?? 0 })
      }
      out.sort((a, b) => a.server.localeCompare(b.server))
      return out
    },
  }

  return controller
}

/* ── dsh_mcp_search ─────────────────────────────────────────────────────────── */

function clampLimit(value: number | undefined, defaultValue: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return defaultValue
  return Math.min(Math.floor(value), max)
}

/** 摘要截断长度：dsh_mcp_search 空查询的输出 token 控制（P2-5）。 */
const SUMMARY_MAX_LEN = 80

/** server=X 的能力摘要：只预览前 N 个工具名（移植上游 18576e4，防一次回吐上百工具）。 */
const LIST_PREVIEW_COUNT = 5
/** all:true 返回完整清单时的默认页大小与上限。 */
const LIST_PAGE_DEFAULT = 20
const LIST_PAGE_MAX = 100

function buildSummary(control: McpControlCtx): Array<{ server: string; summary: string }> {
  const catalog = control.getCatalog()
  // 只列「配置了 serverSummary 或 catalog 有快照」的 server（此前硬编码作者机器上的
  // cheatengine/mimo-image/chrome/calcmcp 摘要，本机没装这些 server 的用户会看到误导条目）。
  const merged: Record<string, string> = { ...control.serverSummary }
  const lines: Array<{ server: string; summary: string }> = []
  const seen = new Set<string>()
  for (const [server, summary] of Object.entries(merged)) {
    if (seen.has(server)) continue
    seen.add(server)
    lines.push({ server, summary })
  }
  // 补上 catalog 里有但 summary 没写的 server（截断长描述，避免输出膨胀）
  for (const server of Object.keys(catalog)) {
    if (seen.has(server)) continue
    seen.add(server)
    const first = catalog[server]?.tools?.[0]
    const raw = first ? String(first.description) : 'MCP server'
    const summary = raw.length > SUMMARY_MAX_LEN ? `${raw.slice(0, SUMMARY_MAX_LEN)}…` : raw
    lines.push({ server, summary })
  }
  lines.sort((a, b) => a.server.localeCompare(b.server))
  return lines
}

/** server=X 分支的结果构造（纯函数，selftest 表驱动：防「一次回吐全表」的上下文膨胀）。 */
export function buildServerListingResult(input: {
  server: string
  found: boolean
  visible: Array<{ name: string; description: string }>
  all: boolean
  offset?: number
  pageSize?: number
}): Record<string, unknown> {
  const total = input.visible.length
  if (!input.all) {
    const preview = input.visible.slice(0, LIST_PREVIEW_COUNT)
    return {
      ok: true,
      kind: 'list',
      server: input.server,
      found: input.found,
      count: total,
      preview: preview.map((tool) => ({ name: bareNameOf(tool.name), description: tool.description })),
      truncated: total > preview.length,
      hint:
        total > preview.length
          ? `仅显示前 ${LIST_PREVIEW_COUNT} 个；完整清单请传 all:true（分页），或直接 query+server 检索具体工具`
          : null,
    }
  }
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0))
  const requested = Math.min(Math.max(1, Math.floor(Number(input.pageSize) || LIST_PAGE_DEFAULT)), LIST_PAGE_MAX)
  const page = input.visible.slice(offset, offset + requested)
  return {
    ok: true,
    kind: 'list',
    server: input.server,
    found: input.found,
    count: total,
    offset,
    limit: requested,
    tools: page,
    hasMore: offset + page.length < total,
  }
}

function registerMcpSearchTool(ctx: Context, control: McpControlCtx): () => void {
  const definition = defineTool({
    name: MCP_SEARCH_TOOL,
    description:
      '检索可用的 MCP 服务器与工具目录（只读，不执行）。四种用法：① 空参数 → 当前会话可用的服务器索引；' +
      `② server=X → 该 server 的**能力摘要**（工具总数 + 前 ${LIST_PREVIEW_COUNT} 个名字预览，默认不返回全表）；` +
      '③ query + server → **在该 server 内**按需检索 top-K 命中（含完整 schema），想找某个 server 上的具体工具就用这个；' +
      '④ query → 全目录关键词检索。查到工具名后用 dsh_mcp_call(server, tool, arguments) 调用；不要用 ② 拉全表' +
      '（只有 all:true 才返回完整清单，且分页）。只返回对当前 agent 预设开放且未彻底关闭的服务器。',
    parameters: {
      query: { type: 'string', description: '检索关键词，按工具名/描述/参数名打分' },
      server: {
        type: 'string',
        description: `目标 MCP server 名。单独传 = 返回能力摘要（工具总数 + 前 ${LIST_PREVIEW_COUNT} 个名字预览）；与 query 同传 = 只在该 server 内检索`,
      },
      all: { type: 'boolean', description: '仅在传 server 时有效：true = 返回该 server 的完整工具清单（分页，可能很大）。默认 false 只给摘要' },
      limit: { type: 'integer', description: 'query 检索的 top-K 上限（默认 5，最大 10）；all:true 分页时表示页大小（默认 20，最大 100）' },
      offset: { type: 'integer', description: '配合 all:true 的分页起点（默认 0）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const catalog = control.getCatalog()
      const agent = exec?.agent
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const server = typeof args.server === 'string' ? args.server.trim() : ''
      const limit = clampLimit(typeof args.limit === 'number' ? args.limit : undefined, control.searchLimitDefault, control.searchLimitMax)
      const access = (name: string): McpAccess => control.accessOf(name, agent)
      // 可检索 = 非 off（预设隔离或彻底关闭都不返回）；工具级禁用单独过滤
      const searchable = (name: string): boolean => access(name).effective !== 'off'
      const keepTool = (name: string): boolean => !policyDisablesTool(access(serverOfMcp(name) ?? '').policy, name)

      if (server && !searchable(server)) {
        return toJson({
          ok: false,
          kind: query ? 'search' : 'list',
          server,
          found: false,
          error: blockedText(server, access(server)),
        })
      }

      // ③ query + server：在该 server 内按需检索 —— 「知道该调哪个工具」的正解：按需、有界
      if (server && query) {
        const hits: SearchHit[] = searchCatalog(catalog, query, limit, server).filter((hit) => keepTool(hit.tool.name))
        return toJson({ ok: true, kind: 'search', server, query, count: hits.length, limit, hits })
      }

      if (server) {
        // ② server=X：默认只给能力摘要，不再一次性回吐全表（移植上游 18576e4）
        const listing = listServer(catalog, server)
        // 工具级禁用先过滤：count 必须是「可见总数」而非页大小（上游 b8b87f9 修过该口径）
        const visible = listing.tools.filter((tool) => keepTool(tool.name))
        return toJson(
          buildServerListingResult({
            server,
            found: listing.found,
            visible,
            all: args.all === true,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
            pageSize: typeof args.limit === 'number' ? args.limit : undefined,
          }),
        )
      }

      if (query) {
        // 检索覆盖 hidden 档（这正是「完全隐藏」的发现路径），但不含 off / 预设隔离
        const hits: SearchHit[] = searchCatalog(catalog, query, limit)
          .filter((hit) => searchable(hit.server))
          .filter((hit) => keepTool(hit.tool.name))
        return toJson({ ok: true, kind: 'search', query, count: hits.length, limit, hits })
      }

      // 无参摘要：列出 native（工具已注入）与 name-only（名称已暴露）的服务器；
      // hidden 只给计数提示（名字不外泄），off / 预设隔离完全不出现在结果里
      const rows = buildSummary(control)
      const listed: Array<{ server: string; summary: string; injected: boolean }> = []
      let hiddenCount = 0
      for (const row of rows) {
        const effective = access(row.server).effective
        if (!listedInSummary(effective)) {
          if (effective === 'hidden') hiddenCount += 1
          continue
        }
        listed.push({ server: row.server, summary: row.summary, injected: effective === 'native' })
      }
      const text = listed
        .map((row) => `- ${row.server}: ${row.summary}${row.injected ? '（工具已直接注入上下文）' : ''}`)
        .join('\n')
      return toJson({
        ok: true,
        kind: 'summary',
        summary: text,
        servers: listed,
        count: listed.length,
        hiddenCount,
        hiddenHint: hiddenCount > 0 ? `另有 ${hiddenCount} 个 MCP 服务器未列出，可用关键词检索` : null,
      })
    },
  })
  return ctx.tools.register(definition)
}

/** 把运行时对象投影为 JsonValue（工具 schema 本身是 JSON，转换是安全的）。 */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/* ── dsh_mcp_call ───────────────────────────────────────────────────────────── */

function registerMcpCallTool(ctx: Context, controller: McpCallController): () => void {
  const definition = defineTool({
    name: MCP_CALL_TOOL,
    description:
      '调用一个 MCP 服务器上的工具。自动保活启用目标 server（用完按 keepAliveMs 空闲回收），等待注册后在下层执行。参数透传给远端工具。',
    parameters: {
      server: { type: 'string', required: true, description: 'MCP 服务器名（见 dsh_mcp_search 摘要）' },
      tool: { type: 'string', required: true, description: '该 server 上的工具名（裸名，如 understand_image；误传注册全名 mcp__<server>__<tool> 会自动归一化）' },
      // 2026-09-18：原为 { type: 'json' }，编译后只剩 description、不带任何 type，
      // 等于没给模型引导：实测 [] 与 42 都能通过校验，模型也更容易整个跳过该字段。
      // 这里用 oneOf[object, string]：object 分支给出明确的对象引导，string 分支
      // 保留 normalizeArguments 的 JSON 字符串兼容路径（flash 系确实会传字符串）；
      // 同时把 [] / 42 / null 这类错误形态在执行前拒掉。
      // 注意：不能直接写成裸 { type: 'object' }，那会让字符串兼容路径在 defineTool
      // 的校验阶段就被拒（校验发生在 execute 之前，normalizeArguments 根本轮不到执行）。
      arguments: {
        oneOf: [
          { type: 'object', additionalProperties: true },
          { type: 'string' },
        ],
        description:
          '传给工具的参数字典（JSON 对象，如 {"url":"https://example.com"}）。' +
          '无参数工具可省略本字段或传 {}。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args, exec) => {
      // 2026-08-24：模型可能把 arguments 填成 JSON 字符串（见 normalizeArguments 注释），先归一化再透传
      return controller.call(args.server, args.tool, normalizeArguments(args.arguments), exec.agent, exec.signal)
    },
  })
  return ctx.tools.register(definition)
}

/**
 * 注册 dsh_mcp_search + dsh_mcp_call 两个模型工具。`controller` 必须是调用方持有的唯一
 * 控制层实例（与空闲回收器共享同一引用计数/owner 状态），否则回收与调用不同步。
 * 返回合并 disposer。
 */
export function installMcpControlTools(ctx: Context, control: McpControlCtx, controller: McpCallController): () => void {
  return ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(registerMcpSearchTool(ctx, control))
      disposers.push(registerMcpCallTool(ctx, controller))
    } catch (error) {
      for (const d of disposers) d()
      throw error
    }
    return () => {
      for (const d of disposers) d()
    }
  }, 'mcp-panel: mcp control tools')
}
