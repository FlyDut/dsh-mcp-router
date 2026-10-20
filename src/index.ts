/**
 * dsh-mcp-router — Host 半区入口（接线层）。
 *
 * 插件唯一职责：**决定每个 MCP 服务器对哪个会话以什么粒度可见，并在不可见时按需调用它**。
 * 本文件只做组装与生命周期，各层职责见：
 * - `domain/exposure.ts`  四档语义 + 预设关联隔离 + v1 迁移（纯逻辑）
 * - `domain/policy.ts`    策略真源（意图/生效两份 + 持久化 + 启动迁移）
 * - `domain/registry.ts`  MCP 行来源归一（loader / preset standing / 项目级）
 * - `domain/assembly.ts`  唯一装配注入点（工具过滤 + 仅名称索引段）
 * - `mcpcall.ts`          中间层（dsh_mcp_search / dsh_mcp_call）+ 保活回收
 * - `collect.ts`/`routes.ts` 面板数据与 HTTP 端点
 *
 * 两条历史铁律（实测事故得出，勿改）：
 * 1. 运行期**禁止**写 agent preset 组合文件 —— dsh-agent-presets 用 {mtimeMs,size} stamp
 *    检测文件变化并重挂 standing，旧实例不 dispose → serverName 全冲突、会话创建失败。
 *    因此启停意图只写 state.json，由 `syncPresetFiles` 在启动早期（standing 未挂载）物化。
 * 2. `tools.schemas(scope)` 必须传 scope 对象（`scopeOf(agent.ctx)` 或 agent 对象本身）；
 *    传 agent 之外的键会落回全局视图，导致 mcp 工具「不存在」。
 */
import Schema from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CatalogEntry } from './catalog'
import { snapshotFromSchemas, loadCatalog, saveCatalog } from './catalog'
import { discoverRuntimeServers } from './domain/runtime'
import type { McpControlCtx, McpCallController, McpAccess } from './mcpcall'
import { createMcpCallController, installMcpControlTools } from './mcpcall'
import type { CatalogRuntime } from './runtime-types'
import { isMcpEntry, serverNameOf, mcpEntryConfig } from './mcp-entry'
import { createDomainCaches, getSchemasView, resolveCollectScopeKey, type DomainCaches } from './collect'
import { makeRoutes } from './routes'
import { setStateAiOwner, clearStateAiOwner, stateDir } from './state'
import { syncPresetFiles } from './preset'
import { installProjectMcp, rebuildOwnersFromState } from './project-mcp'
import { messageOf } from './util'
import { type Exposure, desiredRunning, offReason } from './domain/exposure'
import { createPolicyStore, type PolicyChange, type PolicyStore } from './domain/policy'
import { createRegistry, type Registry } from './domain/registry'
import { exposureForRef, installAssembly } from './domain/assembly'
import { agentPresetId, agentWorkspace, rememberSessionScope, sameWorkspace } from './domain/session-scope'

// dsh_mcp_call 参数/错误归一化（selftest 回归护栏：双重前缀与参数双编码缺陷）
export { normalizeToolName, normalizeArguments, msgOf } from './mcpcall'
// 控制工具名常量（selftest 护栏：不得以 mcp_ 开头，否则 claude.ai 网关整请求 400）
export { MCP_SEARCH_TOOL, MCP_CALL_TOOL, CONTROL_TOOL_NAMES } from './mcpcall'
// dsh_mcp_search 的 server=X 分支结果构造（selftest 回归护栏：摘要/分页不得回吐全表）
export { buildServerListingResult } from './mcpcall'
export type { McpView, McpRow } from './shared-types'
export type { DomainCaches } from './collect'
export type { CatalogRuntime } from './runtime-types'
export type { Exposure, PresetScope, ServerPolicy } from './domain/exposure'
export type { ServerRef } from './domain/registry'
export type { PolicyRow } from './domain/policy'
// 策略层工厂（selftest-policy.mjs 用最小 ctx 桩直接验证迁移/持久化/生效时机）
export { createPolicyStore } from './domain/policy'
// schemas 视图合并 + 状态徽标判定 + 数字诚实口径（selftest 回归护栏）
export { mergeSchemas, computeStatus, computeRowDisplay } from './collect'
// 预设文件文本操作（selftest 回归护栏 + 潜在外部复用）
export { setRowFlag, rowDisabledState, removeRow, materializeTargetOf, syncPresetFiles } from './preset'
// 配置回显脱敏 / 写侧哨兵还原（selftest 回归护栏：两者必须成对，否则哨兵会写进配置）
export { maskConfigSecrets, unmaskEcho, MASKED_VALUE } from './domain/mcp-edit'
// HTTP 读体加固（selftest 回归护栏：跨 chunk 多字节乱码 + 超限 destroy socket）
export { readBody } from './routes'
// 项目 MCP 扫描（selftest 回归护栏：根目录先读、子目录覆盖的去重规则）
export { scanWorkspaceMcp } from './project-mcp'
// 项目 MCP 运行时装配（外部复用/端到端验证：手动安装、按工作空间重扫、owner 查询）
export { installProjectMcp, remountWorkspace, projectServerOwner, projectServerName, findProjectMcpFile } from './project-mcp'
export { readState, writeState } from './state'
// rc.1 standing 组合 preset 行解析（selftest 回归护栏：parsePresetMcpText 文本抽取 + mcp-anki 例外）
export { parsePresetMcpText, firstMatchServerName } from './preset-mcp'
// 编辑 / 删除编排（selftest-mcp-edit.mjs 用最小 ctx 桩直接验证文件写回与只读拒绝）
export { describeServer, removeServer, resolveWritableTarget, updateServer } from './domain/mcp-edit'
// 领域纯逻辑再导出（端到端验证与外部复用；独立构建入口见 lib/exposure.js）
export { decideExposure, desiredRunning, presetAllows, isExposure } from './domain/exposure'
// 运行时发现纯函数（selftest 回归护栏：注册表外的 server 识别 + 畸形名跳过）
export { discoverRuntimeServers } from './domain/runtime'

export const name = 'dsh-mcp-router'

export const inject = ['tools', 'agents', 'agentPresets', 'loader', 'systemPrompt', 'timer']

export interface Config {
  /** 保活回收窗口（ms）。默认 30_000。 */
  keepAliveMs?: number
  /** dsh_mcp_search 缺省 top-K。默认 5。 */
  searchLimitDefault?: number
  /** dsh_mcp_search top-K 上限。默认 10。 */
  searchLimitMax?: number
  /** 能力摘要表（name-only 索引段与 dsh_mcp_search 摘要用）。 */
  serverSummary?: Record<string, string>
  /** 未配置过的 MCP 服务器使用的默认档位。默认 name-only（进程运行、按需调用）。 */
  defaultExposure?: Exposure
  /** 是否注册中间层工具（dsh_mcp_search / dsh_mcp_call）。默认 true。 */
  middleLayer?: boolean
  /**
   * 是否接管运行时发现的「插件内嵌 MCP」—— 由插件在自己的 apply 里用
   * `ctx.plugin(McpClient, ...)` 动态连接、没有 loader 行的那些 server。
   *
   * 默认 true：catalog 采集到工具后，把它们的 schema 从模型上下文中过滤掉，改走
   * dsh_mcp_search / dsh_mcp_call 按需调用。采集完成前保持放行（fail-open），
   * 不会出现「过滤了但调不到」的黑洞。设为 false 则完全保持旧行为。
   */
  adoptRuntimeServers?: boolean
}

export const Config: Schema<Config> = Schema.object({
  keepAliveMs: Schema.number().min(1000).description('MCP 保活空闲回收窗口（ms）').default(30_000),
  searchLimitDefault: Schema.number().min(1).description('dsh_mcp_search 缺省 top-K').default(5),
  searchLimitMax: Schema.number().min(1).description('dsh_mcp_search top-K 上限').default(10),
  serverSummary: Schema.dict(Schema.string()).description('MCP 能力摘要表（serverName → 一句话）'),
  defaultExposure: Schema.union(['name-only', 'hidden', 'off'])
    .description('未配置 MCP 的默认档位')
    .default('name-only'),
  middleLayer: Schema.boolean().description('注册 dsh_mcp_search / dsh_mcp_call 中间层工具').default(true),
  adoptRuntimeServers: Schema.boolean()
    .description('接管插件内嵌 MCP（采集后过滤工具、按需调用；关闭则保持旧行为）')
    .default(true),
})

/** 私有 catalog / state 持久化目录。 */
const CATALOG_DIR = join(stateDir())
/** dsh_mcp_call 注册/调用的默认超时（读 entry config toolCallTimeoutMs，缺省回退）。 */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000
/** tools/change 后增量快照的去抖窗口。 */
const CATALOG_SNAPSHOT_DEBOUNCE_MS = 150
/** catalog 持久化写盘防抖（P1-3）：tools/change 风暴期合并写盘。 */
const CATALOG_PERSIST_DEBOUNCE_MS = 300

/* ── catalog 采集（P1） ───────────────────────────────────────────────── */

/** 从 loader entries 反查某 serverName 对应的 mcp 行（serverName 取自 config）。 */
function findMcpEntry(ctx: Context, serverName: string): Entry | undefined {
  for (const entry of ctx.loader.entries()) {
    if (!isMcpEntry(entry)) continue
    if (serverNameOf(entry) === serverName) return entry
  }
  return undefined
}

/** server 自己的注册/调用超时阈值。 */
function serverTimeoutMs(ctx: Context, serverName: string): number {
  const entry = findMcpEntry(ctx, serverName)
  if (!entry) return DEFAULT_TOOL_TIMEOUT_MS
  const t = mcpEntryConfig(entry)?.toolCallTimeoutMs
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : DEFAULT_TOOL_TIMEOUT_MS
}

function sameToolList(a: CatalogEntry[], b: CatalogEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name !== b[i].name || a[i].description !== b[i].description) return false
  }
  return true
}

/** 原子写回 catalog.json；失败保留 dirty 标记以在下次重试。
 * P1-3：写盘后 CATALOG_PERSIST_DEBOUNCE_MS 内的新变更延迟合并（ctx.timeout 绑 ctx，
 * 卸载自动清理）；正在写盘时置 dirty 排队（finally 补一次）。 */
async function persistCatalog(next: () => Context, runtime: CatalogRuntime): Promise<void> {
  if (runtime.persisting) {
    runtime.dirty = true
    return
  }
  if (!runtime.dirty) return
  const ctx = next()
  if (runtime.lastPersistAt !== null && Date.now() - runtime.lastPersistAt < CATALOG_PERSIST_DEBOUNCE_MS) {
    runtime.persistTimer?.()
    runtime.persistTimer = ctx.timeout(() => {
      runtime.persistTimer = undefined
      void persistCatalog(next, runtime)
    }, CATALOG_PERSIST_DEBOUNCE_MS)
    return
  }
  runtime.persisting = true
  try {
    await saveCatalog(CATALOG_DIR, runtime.catalog)
    runtime.dirty = false
    runtime.lastPersistAt = Date.now()
  } catch (error) {
    ctx.logger.warn(`dsh-mcp-router: catalog persist failed: ${messageOf(error)}`)
  } finally {
    runtime.persisting = false
    if (runtime.dirty) void persistCatalog(next, runtime)
  }
}

/**
 * 解析 scope 并取 schema 视图（preset 层共享，任一 standing 即可）。
 *
 * 关键坑（v0.4.1 + 2026-08-27）：HTTP/apply ctx 下 agents/standingKeyFor 视图
 * 受限（roots/list 空或服务不可解析）。统一走 collect.resolveCollectScopeKey 的
 * 进程级缓存：apply 早期预热一次，快照与面板路径共用同一 standing scope key。
 */
async function resolveScopeSchemas(
  ctx: Context,
  caches: DomainCaches,
): Promise<Array<{ name?: unknown; description?: unknown; parameters?: unknown }>> {
  const scopeKey = await resolveCollectScopeKey(ctx, undefined)
  if (scopeKey === undefined) return []
  return getSchemasView(ctx, caches, scopeKey, 500)
}

/**
 * 对所有当前 enabled 的 mcp server 重新快照（三来源统一：loader / preset / project）。
 *
 * 2026-09-23（移植上游 c0855f9）：采集与 prune 都必须以**注册表快照**为准。此前只看
 * `ctx.loader.entries()`，而预设 standing 行不在 loader 里 —— 结果是预设行的工具目录
 * 永远采不到，且 prune 的 alive 集合一旦只含 loader 行，就会把预设行已有的 last-good
 * 快照一并删掉（本部署预设行是主力形态，影响面比上游更大）。
 */
async function snapshotEnabled(
  ctx: Context,
  runtime: CatalogRuntime,
  caches: DomainCaches,
  registry: Registry,
): Promise<void> {
  runtime.diag.snapshots += 1
  // 磁盘 last-good 尚未加载完成：跳过采集，避免空快照覆盖磁盘好数据。
  if (!runtime.loaded) {
    runtime.diag.lastAt = Date.now()
    runtime.diag.lastError = 'skipped: catalog not loaded yet'
    return
  }
  try {
    const next = { ...runtime.catalog }
    let changed = false
    let rootsCount = 0
    let listCount = 0
    try {
      rootsCount = ctx.agents.roots().length
      listCount = ctx.agents.list().length
    } catch {
      rootsCount = -1
      listCount = -1
    }
    runtime.diag.lastAgentRoots = rootsCount
    runtime.diag.lastAgentList = listCount
    const schemas = await resolveScopeSchemas(ctx, caches)
    runtime.diag.lastSchemasTotal = schemas.length
    let mcpTools = 0
    for (const schema of schemas) {
      if (String(schema.name ?? '').startsWith('mcp__')) mcpTools += 1
    }
    runtime.diag.lastMcpTools = mcpTools
    runtime.diag.lastScope = mcpTools > 0
    // 一次取快照：采集与 prune 共用同一份行集合，避免两次读取间状态漂移。
    const refs = registry.snapshot().all
    // 第四种来源：运行时发现的插件内嵌 MCP server（无 loader 行）。
    // P1 阶段只做「发现 + 采集 + 展示」，装配层过滤行为保持不变（未知 server 仍放行）。
    const runtimeDiscovery = discoverRuntimeServers(schemas, new Set(refs.keys()))
    runtime.diag.lastRuntimeServers = [...runtimeDiscovery.servers.keys()]
    for (const serverName of runtimeDiscovery.servers.keys()) {
      let tools: CatalogEntry[]
      try {
        tools = snapshotFromSchemas(schemas, serverName)
      } catch {
        continue // 采集失败：保留上一轮快照，绝不写空
      }
      const prev = next[serverName]
      if (prev && prev.source === 'live' && sameToolList(prev.tools, tools)) continue
      if (tools.length === 0) continue
      next[serverName] = { tools, fetchedAt: Date.now(), source: 'live' }
      changed = true
    }
    for (const ref of refs.values()) {
      if (ref.disabled) continue
      const serverName = ref.serverName
      let tools: CatalogEntry[]
      try {
        tools = snapshotFromSchemas(schemas, serverName)
      } catch {
        continue // 采集失败：last-good，保留旧快照
      }
      const prev = next[serverName]
      if (prev && prev.source === 'live' && sameToolList(prev.tools, tools)) continue
      // last-good（v0.4.6 加强）：空采集一律不写盘，避免污染磁盘快照。
      // 未运行的预设行取不到工具 → 走这条保留其历史快照（不覆盖成空）。
      if (tools.length === 0) continue
      next[serverName] = { tools, fetchedAt: Date.now(), source: 'live' }
      changed = true
    }
    // 失效清理：alive = 注册表里仍配置的**全部**行（含停用行 —— 停用不等于删除，
    // 其 last-good 必须留给面板与 dsh_mcp_search 兜底）。注册表为空（启动早期）时跳过 prune。
    const alive = new Set<string>(refs.keys())
    for (const serverName of runtimeDiscovery.servers.keys()) alive.add(serverName)
    if (alive.size > 0) {
      for (const key of Object.keys(next)) {
        if (!alive.has(key)) {
          delete next[key]
          changed = true
        }
      }
    }
    runtime.catalog = next
    // 运行时来源整表替换：本轮视图里没出现 = 插件卸载/工具消失，面板不再显示。
    const nowAt = Date.now()
    runtime.runtimeServers = new Map(
      [...runtimeDiscovery.servers.entries()].map(([serverName, tools]) => [serverName, { tools, at: nowAt }]),
    )
    if (changed) {
      runtime.dirty = true
      void persistCatalog(() => ctx, runtime)
    }
    runtime.diag.lastAt = Date.now()
    runtime.diag.lastError = null
  } catch (error) {
    runtime.diag.lastError = messageOf(error)
    runtime.diag.lastAt = Date.now()
  }
}

/** 空 catalog 运行时（启动早期）。 */
function createCatalogRuntime(): CatalogRuntime {
  return {
    catalog: {},
    dirty: false,
    persisting: false,
    loaded: false,
    lastPersistAt: null,
    persistTimer: undefined,
    tokenCache: new Map(),
    runtimeServers: new Map(),
    diag: {
      toolsChangeEvents: 0,
      snapshots: 0,
      lastError: null,
      lastAt: null,
      lastMcpTools: null,
      lastSchemasTotal: null,
      lastScope: null,
      lastAgentRoots: null,
      lastAgentList: null,
      loadedAt: null,
      loadedServers: null,
      lastRuntimeServers: null,
      lastAssemblyNameOnly: null,
      lastAssemblyHidden: null,
    },
  }
}

/* ── 插件主体 ──────────────────────────────────────────────────────────── */

export function apply(ctx: Context, config: Config = {}): void {
  const caches = createDomainCaches()
  const catalogRuntime = createCatalogRuntime()
  const fallbackExposure: Exposure = config.defaultExposure ?? 'name-only'
  /** P2：接管插件内嵌 MCP（默认开）；关闭时装配层拿不到 runtime 表，行为回到旧版。 */
  const adoptRuntimeServers = config.adoptRuntimeServers !== false

  // 注册表：三种来源归一（loader 行同步、preset standing 行异步刷新）
  const registry: Registry = createRegistry(ctx, () => caches.invalidateMcp())
  ctx.effect(() => registry.install(), 'dsh-mcp-router: registry events')

  // 策略层：意图/生效两份表 + state.json 持久化 + 启动迁移。
  // onEffectiveChanged：immediate 模式下把「期望运行」同步到 loader（预设行只能等重启物化）。
  const policy: PolicyStore = createPolicyStore({
    ctx,
    fallbackExposure,
    onEffectiveChanged: (changes) => applyProcessState(ctx, registry, changes, () => controllerRef),
  })

  // 中间层控制层（catalog/loader/state 的 IO 封装）。controller 在控制层之后创建，
  // 用可变引用打通「控制层查询 AI 保活窗口 → 控制器状态」的回路。
  let controllerRef: McpCallController | undefined
  const control: McpControlCtx = buildMcpControl(ctx, catalogRuntime, config, caches, registry, policy, (serverName) =>
    controllerRef?.isAiEnabled(serverName) ?? false,
  )
  const controller: McpCallController = createMcpCallController(ctx, control)
  controllerRef = controller

  // 启动早期：重建项目 MCP owner 映射（HMR/热重载后内存表清空）
  void rebuildOwnersFromState(ctx).catch((error: unknown) => {
    ctx.logger.warn(`dsh-mcp-router: 重建项目 MCP owner 映射失败: ${messageOf(error)}`)
  })

  // 启动早期：加载持久化 catalog（last-good 兜底）；失败置空不阻塞。
  void loadCatalog(CATALOG_DIR).then(
    (catalog) => {
      catalogRuntime.catalog = catalog
      catalogRuntime.loaded = true
      catalogRuntime.diag.loadedAt = Date.now()
      catalogRuntime.diag.loadedServers = Object.keys(catalog).length
      // 磁盘 catalog 就绪后立刻补一次采集：启动早期的 snapshotEnabled 会因 loaded=false
      // 跳过，若不在这里补，运行时来源要等下一次 tools/change 才被发现。
      void snapshotEnabled(ctx, catalogRuntime, caches, registry)
    },
    () => {
      catalogRuntime.catalog = {}
      catalogRuntime.loaded = true
      catalogRuntime.diag.loadedAt = Date.now()
      catalogRuntime.diag.loadedServers = 0
    },
  )

  // 启动序列（不阻塞 apply）：注册表快照 → 策略加载（含 v1 迁移）→ 预设文件物化 → 复扫
  void (async () => {
    await registry.refreshNow()
    await policy.load()
    try {
      const count = await syncPresetFiles({ ctx, registry, policy })
      if (count > 0) ctx.logger.info(`dsh-mcp-router: materialized ${count} MCP row state(s) into preset composition`)
    } catch (error) {
      ctx.logger.warn(`dsh-mcp-router: preset sync skipped: ${messageOf(error)}`)
    }
    await registry.refreshNow()
  })().catch((error: unknown) => {
    ctx.logger.warn(`dsh-mcp-router: startup sequence failed: ${messageOf(error)}`)
  })

  // 装配层（常开）：唯一注入点 = 工具过滤 + 仅名称索引段
  const disposeAssembly = installAssembly(ctx, {
    registry,
    policy,
    isAiActive: (serverName) => controller.isAiEnabled(serverName),
    summaryOf: (serverName) => summaryOf(serverName, config, catalogRuntime),
    // P2：运行时发现的插件内嵌 MCP —— 只有 catalog 采到非空工具快照后才过滤（fail-open）。
    // 未采集 / 采集失败 / 采集为空 → 不进 byServer → 装配层按「未知 server 放行」保留工具。
    runtimeServers: () =>
      adoptRuntimeServers ? (catalogRuntime.runtimeServers as ReadonlyMap<string, { tools: number }>) : new Map(),
    isRuntimeReady: (serverName) => (catalogRuntime.catalog[serverName]?.tools.length ?? 0) > 0,
    // 「另有 N 个未列出」只数真能检索到的：没有工具目录的配置行搜出来是空的。
    hasTools: (serverName) => (catalogRuntime.catalog[serverName]?.tools.length ?? 0) > 0,
    // 插件提供的 MCP 不参与档位管理：固定「仅名称」（工具 schema 不注入、可检索可调用）。
    runtimeExposureOf: () => 'name-only',
    onPlan: (plan) => {
      catalogRuntime.diag.lastAssemblyNameOnly = plan.nameOnly
      catalogRuntime.diag.lastAssemblyHidden = plan.hiddenCount
    },
  })
  ctx.effect(() => disposeAssembly, 'dsh-mcp-router: assembly teardown')

  // 项目级（工作空间）MCP：.dsh/mcps/**/mcp.json → 惰性挂载（可见性由装配层按档位+工作区统一判定）
  const disposeProjectMcp = installProjectMcp(ctx, policy)
  ctx.effect(() => disposeProjectMcp, 'dsh-mcp-router: project mcp teardown')

  // 中间层工具（dsh_mcp_search / dsh_mcp_call）+ 空闲回收器
  if (config.middleLayer !== false) {
    const disposeTools = installMcpControlTools(ctx, control, controller)
    const offReaper = controller.startIdleReaper()
    ctx.effect(
      () => () => {
        offReaper()
        disposeTools()
      },
      'dsh-mcp-router: middle layer teardown',
    )
  }

  // 失效订阅：工具注册表变化 → 面板缓存失效 + 注册表/目录快照刷新
  ctx.effect(() => {
    let scheduled = false
    const invalidate = () => caches.invalidateMcp()
    const offTools = ctx.root.on('tools/change', () => {
      catalogRuntime.diag.toolsChangeEvents += 1
      invalidate()
      void registry.refresh()
      if (scheduled) return
      scheduled = true
      ctx.timeout(() => {
        scheduled = false
        void snapshotEnabled(ctx, catalogRuntime, caches, registry)
      }, CATALOG_SNAPSHOT_DEBOUNCE_MS)
    })
    const offLoader = ctx.root.on('loader/partial-dispose', () => {
      invalidate()
      void registry.refresh()
    })
    return () => {
      offTools()
      offLoader()
    }
  }, 'dsh-mcp-router: catalog snapshot + registry refresh')

  // 初始快照（可能还没有 agent，mcp__* 会在后续增量补全）
  void snapshotEnabled(ctx, catalogRuntime, caches, registry).catch(() => {})

  // 会话边界：next-session 模式的待生效意图在此提升为生效
  ctx.effect(
    () => {
      let guard = false
      const off = ctx.root.on('agent/created', (payload: { agent?: unknown }) => {
        // 记录最近会话作用域：HTTP 面板路径下 agents 视图可能受限，用作展示兜底
        rememberSessionScope(agentPresetId(ctx, payload?.agent), agentWorkspace(payload?.agent))
        if (guard) return undefined
        guard = true
        void (async () => {
          const applied = await policy.commitPending()
          await registry.refreshNow()
          if (applied > 0) {
            caches.invalidateMcp()
            ctx.logger.info(`dsh-mcp-router: applied ${applied} pending MCP change(s) at session boundary`)
          }
        })()
          .catch((error: unknown) => {
            ctx.logger.warn(`dsh-mcp-router: session-boundary apply failed: ${messageOf(error)}`)
          })
          .finally(() => {
            guard = false
          })
        return undefined
      })
      return off
    },
    'dsh-mcp-router: session-boundary apply',
  )

  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => {
      const routes = makeRoutes({
        ctx: httpCtx,
        hostCtx: ctx,
        caches,
        catalogRuntime,
        config,
        controller,
        registry,
        policy,
        triggerSnapshot: () => snapshotEnabled(httpCtx, catalogRuntime, caches, registry),
      })
      const disposers = routes.map((route) => httpCtx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-mcp-router: routes')
  })
}

/** 控制层依赖（McpControlCtx）：封闭 catalog/loader/state/registry/policy 的 IO。 */
function buildMcpControl(
  ctx: Context,
  runtime: CatalogRuntime,
  config: Config,
  caches: DomainCaches,
  registry: Registry,
  policy: PolicyStore,
  isAiActive: (serverName: string) => boolean,
): McpControlCtx {
  // preset 超时缓存（presetId+serverName → 超时/ms，有效 60s）：inventory+resolve+read
  // 每次 dsh_mcp_call 都做太重，key 含 presetId（切 preset 即换 key，天然失效）。
  const presetTimeoutCache = new Map<string, { at: number; timeout: number | undefined }>()
  const assemblyDeps = {
    ctxForPreset: ctx,
    registry,
    policy,
    isAiActive,
    summaryOf: () => undefined,
  }
  const accessFor = (serverName: string, presetId: string | undefined, workspace: string | undefined): McpAccess => {
    const ref = registry.refFor(serverName, presetId)
    const effectivePolicy = policy.effective(serverName, ref?.workspace)
    if (!ref) {
      // 运行时来源（插件内嵌 MCP 客户端）：没有注册表行，但工具确实注册在 schema 视图里。
      // 给它 name-only 的等价访问，使 dsh_mcp_search 能列出/检索这些工具（P1）；
      // 执行路径由 P3 的 tools.execute 分支接管。
      if (runtime.runtimeServers.has(serverName)) {
        // 插件提供的 server 固定按「仅名称」处理：进程由插件持有，router 既停不掉进程
        // 也隐藏不了它注入的 instructions，因此不参与档位管理（面板也不提供选择）。
        return { effective: 'name-only', policy: effectivePolicy, presetId, blockedBy: 'none' }
      }
      return { effective: 'off', policy: effectivePolicy, presetId, blockedBy: 'unknown' }
    }
    const effective = exposureForRef(assemblyDeps, ref, presetId, workspace)
    const workspaceMismatch = ref.workspace !== undefined && !sameWorkspace(ref.workspace, workspace)
    const blockedBy = effective === 'off' ? offReason(effectivePolicy, presetId, workspaceMismatch) : 'none'
    return { effective, policy: effectivePolicy, ref, presetId, blockedBy }
  }
  const accessOf = (serverName: string, agent: Agent | undefined): McpAccess =>
    accessFor(serverName, agentPresetId(ctx, agent), agentWorkspace(agent))
  return {
    keepAliveMs: config.keepAliveMs ?? 30_000,
    searchLimitDefault: config.searchLimitDefault ?? 5,
    searchLimitMax: config.searchLimitMax ?? 10,
    serverSummary: config.serverSummary ?? {},
    getCatalog: () => runtime.catalog,
    setCatalog: (catalog) => {
      runtime.catalog = catalog
    },
    persistCatalog: () => persistCatalog(() => ctx, runtime),
    resolveEntry: (serverName) => findMcpEntry(ctx, serverName),
    accessOf,
    accessFor,
    presetIdOf: (agent) => agentPresetId(ctx, agent),
    serverTimeoutMs: (serverName) => serverTimeoutMs(ctx, serverName),
    presetTimeoutMs: async (serverName) => {
      // rc.1 standing 组合兜底（窄场景）：仅 loader 有行但缺 toolCallTimeoutMs 时补读
      try {
        const ref = registry.refFor(serverName, undefined)
        if (ref?.toolCallTimeoutMs !== undefined) return ref.toolCallTimeoutMs
        const agent = ctx.agents.roots()[0] ?? ctx.agents.list()[0]
        const presetId = agent ? (ctx.agentPresets.composedPreset(agent.ctx) ?? null) : null
        if (!presetId) return undefined
        const key = `${presetId}\0${serverName}`
        const hit = presetTimeoutCache.get(key)
        if (hit && Date.now() - hit.at < 60_000) return hit.timeout
        const { listPresetMcpRows } = await import('./preset-mcp')
        const { rows } = await listPresetMcpRows(ctx, presetId)
        const timeout = rows.find((r) => r.serverName === serverName)?.toolCallTimeoutMs
        presetTimeoutCache.set(key, { at: Date.now(), timeout })
        return timeout
      } catch {
        return undefined
      }
    },
    setAiOwner: (entryId, at) => setStateAiOwner(entryId, at),
    clearAiOwner: (entryId) => clearStateAiOwner(entryId),
    snapshotEnabled: () => snapshotEnabled(ctx, runtime, caches, registry),
  }
}

/** 该 server 的一句话摘要（config 覆盖 > catalog 首条描述）。 */
function summaryOf(serverName: string, config: Config, runtime: CatalogRuntime): string | undefined {
  const configured = config.serverSummary?.[serverName]
  if (typeof configured === 'string' && configured.length > 0) return configured
  const first = runtime.catalog[serverName]?.tools?.[0]
  const raw = first ? String(first.description ?? '') : ''
  return raw.length > 0 ? raw : undefined
}

/**
 * 生效策略变化 → 调整 loader 进程状态（`desiredRunning`）。
 *
 * 只对 loader 行即时生效（entry.update）。预设组合行不在 loader 中，其进程状态由
 * 启动早期 `syncPresetFiles` 物化到组合文件后随重启生效 —— 运行期改文件会触发
 * dsh-agent-presets 的 standing 重挂事故（见文件头铁律 1）。运行期对预设行的
 * 「不可见/不可调用」由装配层与中间层即时保证，与进程状态无关。
 */
async function applyProcessState(
  ctx: Context,
  registry: Registry,
  changes: PolicyChange[],
  controller: () => McpCallController | undefined,
): Promise<void> {
  for (const change of changes) {
    const want = desiredRunning(change.policy.exposure)
    // 用户把档位切到「需要运行」的两档 = 用户接管该 server：清除 AI 保活标记，
    // 回收器不再回收它，且装配不再因 aiActive 把它降级为 hidden。
    if (want) controller()?.markUserEnabled(change.serverName)
    const ref = registry.refFor(change.serverName, undefined)
    if (!ref) continue
    const wantDisabled = !want
    try {
      // preset standing 行不在 loader 中（resolve 会抛错）：忽略即可，其进程状态
      // 由下次启动的物化决定；可见性与可调用性不受影响（装配/中间层即时判定）。
      const entry = ctx.loader.resolve(ref.entryId)
      if (!entry || !isMcpEntry(entry)) continue
      if (Boolean(entry.disabled) === wantDisabled) continue
      await entry.update({ disabled: wantDisabled })
      ctx.logger.info?.(`dsh-mcp-router: ${change.serverName} → ${want ? 'enabled' : 'disabled'} (exposure=${change.policy.exposure})`)
    } catch (error) {
      ctx.logger.debug?.(`dsh-mcp-router: process state for "${change.serverName}" not applied (${messageOf(error)})`)
    }
  }
}
