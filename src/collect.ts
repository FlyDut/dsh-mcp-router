/**
 * 面板数据收集：MCP 清单（注册表行 × 策略 × schema 聚合）。
 *
 * 行的来源统一由 `domain/registry.ts` 给出（loader 行 / preset standing 行 / 项目行），
 * 可见性与可用性统一由 `domain/assembly.ts` + `domain/policy.ts` 判定，因此本模块
 * 不再区分「live 行」与「preset 行」两套构建路径。
 * 依赖方向：本模块只被 routes.ts / index.ts 消费。
 */
import type { Context } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { McpRow, McpView } from './shared-types'
import type { CatalogServer } from './catalog'
import { serverOfMcp } from './catalog'
import type { McpCallController } from './mcpcall'
import type { CatalogRuntime } from './runtime-types'
import type { PolicyStore } from './domain/policy'
import type { Registry } from './domain/registry'
import { agentPresetId, agentWorkspace, lastSessionScope } from './domain/session-scope'
import { messageOf } from './util'
import { getActiveWorkspace } from './project-mcp'

/** 分域缓存 TTL：事件驱动失效为主，TTL 只是兜底（事件丢失场景） */
export const DOMAIN_TTL_MS = 60_000

export interface Deps {
  ctx: Context
  caches: DomainCaches
  catalogRuntime: CatalogRuntime
  registry: Registry
  policy: PolicyStore
  /** 中间层控制层（访问判定 + AI 启用标记查询/清除）。 */
  controller?: McpCallController
}

/** 分域缓存句柄：apply 创建，makeRoutes 消费，事件失效由 apply 订阅。 */
export interface DomainCaches {
  mcpCache: Map<string, { at: number; promise: Promise<McpView> }>
  /** MCP 工具聚合缓存（per scope），tools/change 时随 mcpCache 一起清 */
  mcpAggregates: Map<object | null, { at: number; value: McpAggregate }>
  /** schemas 原始缓存（per scope），路径 A/B 共享同一份深克隆结果 */
  schemasCache: Map<object | null, { at: number; schemas: Array<{ name?: unknown; description?: unknown; parameters?: unknown }> }>
  invalidateMcp: () => void
}

export function createDomainCaches(): DomainCaches {
  const mcpCache = new Map<string, { at: number; promise: Promise<McpView> }>()
  const mcpAggregates = new Map<object | null, { at: number; value: McpAggregate }>()
  const schemasCache = new Map<object | null, { at: number; schemas: Array<{ name?: unknown; description?: unknown; parameters?: unknown }> }>()
  return {
    mcpCache,
    mcpAggregates,
    schemasCache,
    invalidateMcp: () => {
      mcpCache.clear()
      mcpAggregates.clear()
      schemasCache.clear()
    },
  }
}

function tokenEstimate(parameters: unknown): number {
  try {
    return Math.max(1, Math.round(JSON.stringify(parameters ?? {}).length / 4))
  } catch {
    return 1
  }
}

/** 写时清理过期条目（P2-8）：分域缓存的 Map 长期运行不膨胀。 */
export function pruneExpired<T>(map: Map<T, { at: number }>, now: number): void {
  for (const [key, entry] of map) {
    if (now - entry.at >= DOMAIN_TTL_MS) map.delete(key)
  }
}

/**
 * 按 scope 共享的 schemas 原始缓存：路径 A（catalog 采集）与路径 B（面板聚合）
 * 共用同一份深克隆结果，避免 tools.change 风暴期内重复深克隆。
 * key = scopeKey ?? null；TTL 由调用方指定（路径 A 500ms，路径 B 60s）。
 */
export function getSchemasView(
  ctx: Context,
  caches: DomainCaches,
  scopeKey: object | undefined,
  ttlMs: number,
): Array<{ name?: unknown; description?: unknown; parameters?: unknown }> {
  const key = scopeKey ?? null
  const now = Date.now()
  const maxTtl = Math.max(ttlMs, DOMAIN_TTL_MS)
  for (const [k, entry] of caches.schemasCache) {
    if (now - entry.at >= maxTtl) caches.schemasCache.delete(k)
  }
  const hit = caches.schemasCache.get(key)
  if (hit && now - hit.at < ttlMs) return hit.schemas
  const schemas: Array<{ name?: unknown; description?: unknown; parameters?: unknown }> = scopeKey
    ? ctx.tools.schemas(scopeKey as Parameters<typeof ctx.tools.schemas>[0])
    : ctx.tools.schemas()
  caches.schemasCache.set(key, { at: now, schemas })
  return schemas
}

export function resolveAgent(ctx: Context, sessionId: string | undefined) {
  if (sessionId) {
    const byId = ctx.agents.get(sessionId as Parameters<typeof ctx.agents.get>[0])
    if (byId) return byId
  }
  const roots = ctx.agents.roots()
  if (roots.length > 0) return roots[0]
  return ctx.agents.list()[0]
}

/**
 * 进程级共享的 scope key（standing 层）。
 *
 * 关键坑（2026-08-27 实测）：HTTP 请求路径（routes 的 httpCtx）下既解析不到
 * agent（roots/list 空或非目标）也拿不到 agentPresets.standingKeyFor()（该服务
 * 视图受限）→ scope key 恒 undefined → schemas 落入空视图，面板聚合全 0。
 * 解法：scope key 在 apply 早期解析一次并缓存（进程级单例），所有路径复用。
 */
let sharedScopeKey: object | undefined
let sharedScopeKeySource: 'agent' | 'standing' | null = null

export async function resolveCollectScopeKey(ctx: Context, sessionId: string | undefined): Promise<object | undefined> {
  if (sharedScopeKey !== undefined) return sharedScopeKey
  try {
    const agent = resolveAgent(ctx, sessionId)
    if (agent) {
      const key = scopeOf(agent.ctx)
      if (key !== undefined) {
        sharedScopeKey = key
        sharedScopeKeySource = 'agent'
        return key
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const key = await ctx.agentPresets.standingKeyFor()
    if (key !== undefined) {
      sharedScopeKey = key as object
      sharedScopeKeySource = 'standing'
      return key as object
    }
  } catch {
    /* ignore */
  }
  return sharedScopeKey
}

/** scope key 解析来源（/debug scopeDiag 展示用）。 */
export function scopeKeySource(): 'agent' | 'standing' | null {
  return sharedScopeKeySource
}

/** 行状态徽标判定（纯函数，selftest 表驱动回归）。
 * 语义：active/idle 以 **liveTools**（真实注册）为准——displayTools 含 catalog 快照
 * 兜底，用它判定 active 会掩盖「scope 解析失败但 catalog 有旧快照」的故障现场。
 */
export function computeStatus(disabled: boolean, running: boolean, liveTools: number): McpRow['status'] {
  if (disabled) return 'disabled'
  if (!running) return 'failed'
  return liveTools > 0 ? 'active' : 'idle'
}

/**
 * 面板显示数字的诚实口径（纯函数，selftest 表驱动回归）。
 *
 * 2026-09-23（移植上游 78142f6）：进程在跑但一个工具都没注册时，**不得**用目录快照
 * 回填工具数/token —— 那会把「根本没注册上」渲染成有工具的健康态（上游 codegraph
 * 实测：子进程零注册，面板却显示 tools=4）。历史目录仍经 toolList 兜底展示。
 */
export function computeRowDisplay(input: {
  disabled: boolean
  running: boolean
  liveTools: number
  liveTokens: number
  catalogTools: number
  catalogTokens: number
}): { tools: number; tokens: number; unregistered: boolean } {
  const unregistered = !input.disabled && input.running && input.liveTools <= 0
  if (unregistered) return { tools: 0, tokens: 0, unregistered }
  if (input.liveTools > 0) return { tools: input.liveTools, tokens: input.liveTokens, unregistered }
  return { tools: input.catalogTools, tokens: input.catalogTokens, unregistered }
}

function baseView(
  ctx: Context,
  agent: ReturnType<typeof resolveAgent>,
  cwd: string | undefined,
): Pick<McpView, 'sessionId' | 'preset' | 'cwd'> {
  let preset: string | null = null
  try {
    if (agent) preset = ctx.agentPresets.composedPreset(agent.ctx) ?? null
  } catch {
    preset = null
  }
  return { sessionId: agent ? agent.id : null, preset, cwd: cwd ?? null }
}

/** MCP 工具聚合结果：per-server 工具数 + token 估算。 */
export interface McpAggregate {
  byServer: Map<string, { tools: number; tokens: number }>
  mcpToolsTotal: number
  mcpTokensTotal: number
}

/**
 * 按 name 去重合并两个 schemas 视图（scoped 优先）。
 *
 * ⚠️ 2026-08-27 实测：`tools.schemas()`（无参全局视图）不含任何 mcp__ 工具（全部
 * 注册在 scope 层）→ 本合并当前恒为 no-op，属防御性合并：若未来出现全局作用域注册
 * 的 mcp 工具，此路径才生效。
 */
export function mergeSchemas(
  scoped: Array<{ name?: unknown; description?: unknown; parameters?: unknown }>,
  global: Array<{ name?: unknown; description?: unknown; parameters?: unknown }>,
): Array<{ name?: unknown; description?: unknown; parameters?: unknown }> {
  if (!global || global.length === 0) return scoped
  const seen = new Set<string>()
  for (const schema of scoped) seen.add(String(schema?.name ?? ''))
  const out = scoped.slice()
  for (const schema of global) {
    const name = String(schema?.name ?? '')
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    out.push(schema)
  }
  return out
}

function computeAggregate(schemas: Array<{ name?: string; parameters?: unknown }>): McpAggregate {
  const byServer = new Map<string, { tools: number; tokens: number }>()
  let mcpToolsTotal = 0
  let mcpTokensTotal = 0
  for (const schema of schemas) {
    const server = serverOfMcp(String(schema.name ?? ''))
    if (!server) continue
    const entry = byServer.get(server) ?? { tools: 0, tokens: 0 }
    entry.tools += 1
    const est = tokenEstimate(schema.parameters)
    entry.tokens += est
    byServer.set(server, entry)
    mcpToolsTotal += 1
    mcpTokensTotal += est
  }
  return { byServer, mcpToolsTotal, mcpTokensTotal }
}

/** 按 scope 复用的 MCP 聚合缓存：tools.schemas 深克隆是 collectMcp 最重的一步。 */
function getMcpAggregate(
  ctx: Context,
  caches: DomainCaches,
  scopeKey: object | undefined,
  errors: string[],
): McpAggregate {
  const key = scopeKey ?? null
  pruneExpired(caches.mcpAggregates, Date.now())
  const hit = caches.mcpAggregates.get(key)
  if (hit && Date.now() - hit.at < DOMAIN_TTL_MS) return hit.value
  let schemas: Array<{ name?: unknown; description?: unknown; parameters?: unknown }> = []
  try {
    schemas = getSchemasView(ctx, caches, scopeKey, DOMAIN_TTL_MS)
    if (scopeKey) schemas = mergeSchemas(schemas, getSchemasView(ctx, caches, undefined, DOMAIN_TTL_MS))
  } catch (error) {
    errors.push(`tools.schemas: ${messageOf(error)}`)
  }
  const value = computeAggregate(schemas as Array<{ name?: string; parameters?: unknown }>)
  caches.mcpAggregates.set(key, { at: Date.now(), value })
  return value
}

/** 停用态 token 估算缓存（P2-6）：fetchedAt 不变则复用。 */
function catalogTokens(runtime: CatalogRuntime, serverName: string, info: CatalogServer | undefined): number {
  if (!info) return 0
  const hit = runtime.tokenCache.get(serverName)
  if (hit && hit.fetchedAt === info.fetchedAt) return hit.tokens
  const tokens = info.tools.reduce((sum, t) => sum + tokenEstimate(t.parameters), 0)
  runtime.tokenCache.set(serverName, { fetchedAt: info.fetchedAt, tokens })
  return tokens
}

async function collectMcp(deps: Deps, sessionId: string | undefined): Promise<McpView> {
  const { ctx, registry, policy } = deps
  const errors: string[] = []
  const agent = resolveAgent(ctx, sessionId)
  // agent 解析不到时（HTTP 视图受限）退回最近会话作用域：宁可显示「最近一次」的真实
  // 判定结果，也不要按「无 preset」误判成被隔离。
  const remembered = lastSessionScope()
  const presetId = agentPresetId(ctx, agent) ?? remembered.presetId
  const workspace = agentWorkspace(agent) ?? remembered.workspace
  const scopeKey = await resolveCollectScopeKey(ctx, sessionId)

  const { byServer, mcpToolsTotal, mcpTokensTotal } = getMcpAggregate(ctx, deps.caches, scopeKey, errors)
  // 共享 schemas 缓存（路径 A/B 同源）：构建 per-server 工具列表（面板工具级禁用用）
  let schemas = getSchemasView(ctx, deps.caches, scopeKey, DOMAIN_TTL_MS)
  if (scopeKey) schemas = mergeSchemas(schemas, getSchemasView(ctx, deps.caches, undefined, DOMAIN_TTL_MS))
  const toolsByServer = new Map<string, Array<{ name: string; description: string }>>()
  for (const schema of schemas) {
    const name = String(schema?.name ?? '')
    if (!name.startsWith('mcp__')) continue
    const server = serverOfMcp(name)
    if (server === null) continue
    let list = toolsByServer.get(server)
    if (!list) {
      list = []
      toolsByServer.set(server, list)
    }
    list.push({ name, description: String(schema?.description ?? '') })
  }
  for (const list of toolsByServer.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  const mcp: McpRow[] = []
  try {
    for (const ref of registry.snapshot().all.values()) {
      const serverName = ref.serverName
      const effectivePolicy = policy.effective(serverName, ref.workspace)
      const intent = policy.intent(serverName, ref.workspace)
      const access = deps.controller?.accessFor(serverName, presetId, workspace)
      const effective = access?.effective ?? 'off'
      const agg = byServer.get(serverName)
      const liveTools = agg?.tools ?? 0
      const catalogInfo = deps.catalogRuntime.catalog[serverName]
      // 诚实上报（移植上游 78142f6）：数字口径见 computeRowDisplay。
      const display = computeRowDisplay({
        disabled: ref.disabled,
        running: ref.running,
        liveTools,
        liveTokens: agg?.tokens ?? 0,
        catalogTools: catalogInfo?.tools.length ?? 0,
        catalogTokens: catalogTokens(deps.catalogRuntime, serverName, catalogInfo),
      })
      const unregistered = display.unregistered
      const displayTools = display.tools
      const displayTokens = display.tokens
      // disabled → 'disabled'；启用但 fiber 缺失 → 'failed'；启用有 fiber → active/idle
      const status = computeStatus(ref.disabled, ref.disabled || ref.running, liveTools)
      let toolList = toolsByServer.get(serverName)
      if (!toolList && catalogInfo) {
        // 兜底：schemas 视图缺失该 server（scope 解析异常等）时用 catalog 快照构建列表
        toolList = catalogInfo.tools.map((tool) => ({ name: String(tool.name ?? ''), description: String(tool.description ?? '') }))
      }
      mcp.push({
        entryId: ref.entryId,
        rowId: ref.rowId,
        serverName,
        transport: ref.transport,
        disabled: ref.disabled,
        running: ref.running,
        unregistered,
        tools: displayTools,
        tokens: displayTokens,
        toolList:
          toolList?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            disabled: effectivePolicy.disabledTools.includes(tool.name),
          })) ?? null,
        status,
        exposure: intent?.exposure ?? effectivePolicy.exposure,
        effectiveExposure: effective,
        presetScope: effectivePolicy.presets,
        presetAllowed: access ? access.blockedBy !== 'preset' : true,
        pending: policy.isPending(serverName, ref.workspace),
        configured: intent !== undefined,
        source: ref.source,
        // 预设组合行不可写：运行期写 agent.cordis.yml 会触发 standing 重挂事故
        writable: ref.source !== 'preset',
        workspace: ref.workspace,
      })
    }
  } catch (error) {
    errors.push(`registry.entries: ${messageOf(error)}`)
  }

  // 运行时来源（第四种）：插件内嵌 MCP 客户端没有 loader 行，注册表里没有它们。
  // P1 只做「展示 + 目录采集」——工具进 catalog 后 dsh_mcp_search 即可检索；
  // 装配层仍按「未知 server 放行」处理，不改既有上下文行为。
  try {
    const declared = new Set(registry.snapshot().all.keys())
    for (const [serverName, info] of deps.catalogRuntime.runtimeServers) {
      if (declared.has(serverName)) continue
      const catalogInfo = deps.catalogRuntime.catalog[serverName]
      const liveList = toolsByServer.get(serverName)
      const toolList =
        liveList ??
        (catalogInfo
          ? catalogInfo.tools.map((tool) => ({
              name: String(tool.name ?? ''),
              description: String(tool.description ?? ''),
            }))
          : null)
      const toolCount = toolList?.length ?? info.tools
      // 插件提供的 MCP 不参与档位管理：进程归插件所有、router 停不掉，设成 hidden
      // 也只会让工具不可见却仍注入服务器 instructions（语义混乱）。固定按「提示词注入」
      // 处理：不注入工具 schema、进索引段、可 dsh_mcp_search / dsh_mcp_call。
      mcp.push({
        entryId: `runtime:${serverName}`,
        rowId: `runtime:${serverName}`,
        serverName,
        transport: null,
        disabled: false,
        running: true,
        unregistered: toolCount === 0,
        tools: toolCount,
        tokens: catalogTokens(deps.catalogRuntime, serverName, catalogInfo),
        status: toolCount > 0 ? 'active' : 'idle',
        exposure: 'name-only',
        effectiveExposure: 'name-only',
        presetScope: { mode: 'all', ids: [] },
        presetAllowed: true,
        pending: false,
        configured: false,
        source: 'runtime',
        writable: false,
        toolList: toolList?.map((tool) => ({ name: tool.name, description: tool.description, disabled: false })) ?? null,
      })
    }
  } catch (error) {
    errors.push(`runtime.servers: ${messageOf(error)}`)
  }

  mcp.sort((a, b) => a.serverName.localeCompare(b.serverName))

  return {
    ...baseView(ctx, agent, workspace),
    mcp,
    mcpTotal: mcp.length,
    mcpDisabled: mcp.filter((row) => row.exposure === 'off').length,
    mcpNameOnly: mcp.filter((row) => row.effectiveExposure === 'name-only').length,
    mcpHidden: mcp.filter((row) => row.effectiveExposure === 'hidden').length,
    mcpToolsTotal,
    mcpTokensTotal,
    activeWorkspace: getActiveWorkspace(),
    errors,
  }
}

export { collectMcp }
