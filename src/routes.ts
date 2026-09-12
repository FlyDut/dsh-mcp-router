/**
 * HTTP 路由层：策略读写、启停意图、预设列表与诊断端点（前缀 `/api/mcp-panel`）。
 *
 * 设计（P2-6 收敛）：`handle`/`handleAny` 统一 method 校验 / 异步错误响应 /
 * `{ok:true}` 包装；写操作要求 `x-panel-token` 与本进程随机令牌一致（阻断跨源 /
 * DNS-rebinding 对本地控制端点的盲写），GET 只读端点保持开放。
 *
 * 端点与职责：
 * - `GET  /state`        面板视图（注册表行 × 策略 × 预设隔离后的生效档位）
 * - `GET  /presets`      可关联的 agent 预设列表
 * - `POST /policy`       写策略（档位 / 预设关联 / 工具级禁用），支持批量
 * - `POST /policy/commit` 立即应用 next-session 模式积压的待生效意图（有缓存代价）
 * - `GET/POST /config`   生效时机（immediate / next-session）
 * - `POST /mcp/add`、`POST /mcp/preview`  快速迁移（粘贴 mcpServers JSON）
 * - `GET  /debug`、`POST /debug/collect`  运维诊断
 */
import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { readState, writeState, stateApplyMode, type ApplyMode } from './state'
import { resolveAgent, resolveCollectScopeKey, scopeKeySource, getSchemasView, mergeSchemas, collectMcp, pruneExpired, DOMAIN_TTL_MS, type DomainCaches } from './collect'
import { isMcpEntry } from './mcp-entry'
import { parseMcpServersJson, serversToPatchYaml, serversToRows, type McpServers, type McpRowConfig } from './mcp-convert'
import { remountWorkspace, getActiveWorkspace } from './project-mcp'
import type { McpCallController } from './mcpcall'
import type { Config } from './index'
import type { CatalogRuntime } from './runtime-types'
import type { PolicyStore } from './domain/policy'
import type { Registry } from './domain/registry'
import { isExposure, normalizePresetScope, type Exposure, type PresetScope } from './domain/exposure'
import { agentPresetId, agentWorkspace, lastSessionScope } from './domain/session-scope'
import type { PresetListView } from './shared-types'
import { messageOf } from './util'

const API_PREFIX = '/api/mcp-panel'
/** 旧前缀（0.3.1 及以前为 /api/runtime-inventory），保留兼容 */
const LEGACY_API_PREFIX = '/api/runtime-inventory'
/** 进程级随机令牌：写操作（策略/config）要求客户端在 x-panel-token 头携带。 */
const PANEL_TOKEN = randomBytes(32).toString('hex')
/** readBody 体积上限：防无界 body 累积（本地 DoS 向量）。 */
const MAX_BODY_BYTES = 64 * 1024

type Req = import('node:http').IncomingMessage
type Res = import('node:http').ServerResponse

export type Route = {
  kind: 'exact'
  path: string
  handler: (req: Req, res: Res) => void
}

export interface RoutesDeps {
  /** HTTP 请求 ctx（路由注册在它上面）。 */
  ctx: Context
  /** 插件 apply ctx（服务视图更完整，如 agentPresets）。 */
  hostCtx: Context
  caches: DomainCaches
  catalogRuntime: CatalogRuntime
  config: Config
  controller: McpCallController
  registry: Registry
  policy: PolicyStore
  /** 手动触发一次 catalog 采集（调试端点用）。 */
  triggerSnapshot: () => Promise<void>
}

function json(res: Res, code: number, body: unknown): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function ok(res: Res, data: object): void {
  json(res, 200, { ok: true, ...data })
}

function readBody(req: Req): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    const onData = (chunk: Buffer | string) => {
      body += String(chunk)
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error(`body exceeds ${MAX_BODY_BYTES} bytes`))
      }
    }
    const onEnd = () => {
      cleanup()
      resolve(body)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function queryParam(url: string, key: string): string | undefined {
  const m = new RegExp(`[?&]${key}=([^&]+)`).exec(url)
  return m ? decodeURIComponent(m[1]) : undefined
}

/** 写操作 token 校验（x-panel-token === 本进程随机令牌）。 */
function tokenOk(req: Req): boolean {
  return req.headers['x-panel-token'] === PANEL_TOKEN
}

/** 端点样板：method 校验 + 异步执行 + {ok:true} 包装 + 统一错误码（POST 参数错 400 / GET 服务错 500）。
 * guarded=true 时要求 x-panel-token 匹配（写操作鉴权）。 */
function handle(method: 'GET' | 'POST', run: (req: Req) => Promise<object>, guarded = false): (req: Req, res: Res) => void {
  return (req, res) => {
    if (req.method !== method) {
      json(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    if (guarded && !tokenOk(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    Promise.resolve(run(req))
      .then((data) => ok(res, data))
      .catch((error) => json(res, method === 'POST' ? 400 : 500, { ok: false, error: messageOf(error) }))
  }
}

/**
 * 同 path 多 method 路由：webServer 的 exact 路由按 path 唯一（同 path 重复注册
 * 会中断后续注册），因此 GET+POST 共存的端点必须合并为单个 handler 内部分发。
 * guardPosts=true 时仅 POST 需要 x-panel-token。
 */
function handleAny(entries: Array<{ method: 'GET' | 'POST'; run: (req: Req) => Promise<object> }>, guardPosts = false): (req: Req, res: Res) => void {
  return (req, res) => {
    const entry = entries.find((e) => e.method === req.method)
    if (!entry) {
      json(res, 405, { ok: false, error: 'method-not-allowed' })
      return
    }
    handle(entry.method, entry.run, guardPosts && entry.method === 'POST')(req, res)
  }
}

/* ── 快速迁移：mcpServers JSON → 全局 profile patch / 项目 .dsh/mcps ─────── */

/**
 * 路由写文件队列：串行化 appendGlobalPatch / writeProjectMcp 的「读-改-写」。
 * 并发 POST（或多会话同时添加）若各自以旧内容为基底写盘，
 * 先写者的内容会被后写者整体覆盖丢失 → 全部走同一 Promise 链。
 */
let fileWriteChain: Promise<unknown> = Promise.resolve()

/**
 * 定位 profile 的用户 patch 层（<profile>/cordis.patch.yml）。
 * 根树 backing 文件是 <profile>/cordis.yml（每次启动重置为 []），
 * patch 与其同目录；从任一 root 树 entry 的 tree.filename 反推。
 */
function profilePatchPath(ctx: Context): string {
  for (const entry of ctx.loader.entries()) {
    const tree = entry.parent?.tree as { filename?: string } | undefined
    const file = tree?.filename
    if (typeof file === 'string' && basename(file) === 'cordis.yml') return join(dirname(file), 'cordis.patch.yml')
  }
  throw new Error('无法定位 profile 补丁文件 cordis.patch.yml（未找到 cordis.yml 根树；请确认 profile 已正常挂载后重试）')
}

/** 已存在检查：loader 存活行或 patch 文本里已有同 id。 */
function existingRowIds(ctx: Context, patchText: string): Set<string> {
  const ids = new Set<string>()
  for (const entry of ctx.loader.entries()) {
    if (!isMcpEntry(entry)) continue
    ids.add(String(entry.options.id))
  }
  for (const line of patchText.split(/\r?\n/)) {
    const m = /^\s*-?\s*id:\s*([^\s]+)\s*$/.exec(line)
    if (m) ids.add(m[1])
  }
  return ids
}

/** 追加 `- insert:` patch 块到 profile cordis.patch.yml（串行排队 + 原子写 + 跟随原换行风格）。 */
function appendGlobalPatch(ctx: Context, yamlBlock: string): Promise<{ file: string }> {
  const run = fileWriteChain.then(async () => {
    const file = profilePatchPath(ctx)
    const existing = await readFile(file, 'utf8').catch(() => '')
    const sep = existing.includes('\r\n') ? '\r\n' : '\n'
    const text = existing.length > 0 && !existing.endsWith('\n') ? existing + sep : existing
    const next = text + yamlBlock.replace(/\r?\n/g, sep)
    await writeFile(`${file}.tmp`, next, 'utf8')
    await rename(`${file}.tmp`, file)
    return { file }
  })
  fileWriteChain = run.catch(() => undefined)
  return run
}

/** 把 servers 合并写入 <workspace>/.dsh/mcps/mcp.json（新建 server 覆盖同名旧值；读-改-写串行化）。 */
function writeProjectMcp(workspace: string, servers: McpServers): Promise<{ file: string }> {
  const run = fileWriteChain.then(async () => {
    const mcpsDir = join(workspace, '.dsh', 'mcps')
    const file = join(mcpsDir, 'mcp.json')
    await mkdir(mcpsDir, { recursive: true })
    let existing: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>
    } catch {
      // 文件不存在或损坏：从空对象重建
    }
    let map: Record<string, unknown> = {}
    if (existing.mcpServers && typeof existing.mcpServers === 'object' && !Array.isArray(existing.mcpServers)) {
      map = existing.mcpServers as Record<string, unknown>
    }
    for (const [name, server] of Object.entries(servers)) map[name] = server
    const payload = { ...existing, mcpServers: map }
    await writeFile(`${file}.tmp`, JSON.stringify(payload, null, 2), 'utf8')
    await rename(`${file}.tmp`, file)
    return { file }
  })
  fileWriteChain = run.catch(() => undefined)
  return run
}

/** 全局添加：写入 profile patch + 立即挂载到 loader（粘贴即用，重启由 patch 承接）。 */
async function addGlobalMcp(ctx: Context, servers: McpServers): Promise<{ file: string; added: number; skipped: string[] }> {
  const file = profilePatchPath(ctx)
  const patchText = await readFile(file, 'utf8').catch(() => '')
  const existingIds = existingRowIds(ctx, patchText)
  const toAdd = new Map<string, McpRowConfig>()
  const skipped: string[] = []
  for (const row of serversToRows(servers)) {
    if (existingIds.has(row.id)) {
      skipped.push(String(row.config.serverName))
      continue
    }
    toAdd.set(row.id, row)
  }
  const rows = [...toAdd.values()]
  if (rows.length === 0) return { file, added: 0, skipped }
  // 先挂载后落盘：挂载失败（如 serverName 全局唯一冲突）不应污染 patch
  const mounted: McpRowConfig[] = []
  for (const row of rows) {
    try {
      await ctx.loader.create(row)
      mounted.push(row)
    } catch (error) {
      skipped.push(String(row.config.serverName))
      ctx.logger.warn?.(`mcp-panel: 全局 MCP "${row.config.serverName}" 挂载失败: ${messageOf(error)}`)
    }
  }
  if (mounted.length === 0) return { file, added: 0, skipped }
  await appendGlobalPatch(ctx, serversToPatchYaml(serversFromRows(mounted)))
  return { file, added: mounted.length, skipped }
}

/** 从已挂载行重建 McpServers（落盘 patch 用；避免把未挂载成功的行写进去）。 */
function serversFromRows(rows: McpRowConfig[]): McpServers {
  const servers: McpServers = {}
  for (const row of rows) {
    const config = row.config as unknown as McpServerConfigLike
    servers[config.serverName] = config as McpServers[string]
  }
  return servers
}

/** mcp-convert 的 McpServerConfig 最小形状（落盘重建用，字段与行 config 一致）。 */
interface McpServerConfigLike {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}

/* ── 策略写入 ─────────────────────────────────────────────────────────── */

/** 单条策略更新（面板提交的形状）。 */
interface PolicyUpdateInput {
  serverName?: unknown
  workspace?: unknown
  exposure?: unknown
  presets?: unknown
  disabledTools?: unknown
}

function normalizeUpdate(raw: PolicyUpdateInput): {
  serverName: string
  workspace?: string
  patch: Partial<{ exposure: Exposure; presets: PresetScope; disabledTools: string[] }>
} {
  const serverName = typeof raw.serverName === 'string' ? raw.serverName.trim() : ''
  if (serverName.length === 0) throw new Error('serverName is required')
  const workspace = typeof raw.workspace === 'string' && raw.workspace.length > 0 ? raw.workspace : undefined
  const patch: Partial<{ exposure: Exposure; presets: PresetScope; disabledTools: string[] }> = {}
  if (raw.exposure !== undefined) {
    if (!isExposure(raw.exposure)) throw new Error(`invalid exposure: ${String(raw.exposure)}`)
    patch.exposure = raw.exposure
  }
  if (raw.presets !== undefined) patch.presets = normalizePresetScope(raw.presets)
  if (raw.disabledTools !== undefined) {
    const list = Array.isArray(raw.disabledTools) ? raw.disabledTools : []
    patch.disabledTools = list.filter((v): v is string => typeof v === 'string' && v.length > 0).sort()
  }
  if (Object.keys(patch).length === 0) throw new Error('至少需要 exposure / presets / disabledTools 之一')
  return workspace === undefined ? { serverName, patch } : { serverName, workspace, patch }
}

/* ── 路由 ──────────────────────────────────────────────────────────────── */

export function makeRoutes(deps: RoutesDeps): Route[] {
  const { ctx, hostCtx, caches, catalogRuntime, config, controller, registry, policy, triggerSnapshot } = deps
  const { mcpCache, invalidateMcp } = caches

  const cachedMcp = (sessionId: string | undefined) => {
    const key = sessionId ?? '*'
    pruneExpired(mcpCache, Date.now())
    const hit = mcpCache.get(key)
    if (hit && Date.now() - hit.at < DOMAIN_TTL_MS) return hit.promise
    const promise = collectMcp({ ctx, caches, catalogRuntime, registry, policy, controller }, sessionId).catch((error) => {
      mcpCache.delete(key)
      throw error
    })
    mcpCache.set(key, { at: Date.now(), promise })
    return promise
  }

  /** 当前面板会话的 preset id 与工作空间（预设关联 UI 的「当前会话」标注）。 */
  const sessionScopeOf = (sessionId: string | undefined) => {
    const agent = resolveAgent(hostCtx, sessionId)
    const remembered = lastSessionScope()
    return {
      presetId: agentPresetId(hostCtx, agent) ?? remembered.presetId,
      workspace: agentWorkspace(agent) ?? remembered.workspace,
    }
  }

  async function listPresets(sessionId: string | undefined): Promise<PresetListView> {
    const { presetId } = sessionScopeOf(sessionId)
    try {
      const list = await hostCtx.agentPresets.list()
      return {
        presets: list.map((preset) => {
          const row: { id: string; name?: string; description?: string; broken?: string } = { id: preset.id }
          if (preset.name !== undefined) row.name = preset.name
          if (preset.description !== undefined) row.description = preset.description
          if (preset.broken !== undefined) row.broken = preset.broken
          return row
        }),
        current: presetId ?? null,
      }
    } catch (error) {
      // 服务视图受限（HTTP ctx 下历史实测）：降级为「仅手填 id」，不阻塞面板其它功能
      return { presets: [], current: presetId ?? null, error: messageOf(error) }
    }
  }

  const routes: Route[] = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/state`,
      handler: handle('GET', async (req) => {
        const sessionId = queryParam(req.url ?? '', 'session')
        return { state: await cachedMcp(sessionId) }
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/presets`,
      handler: handle('GET', async (req) => {
        const sessionId = queryParam(req.url ?? '', 'session')
        return await listPresets(sessionId)
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/policy`,
      handler: handle('POST', async (req) => {
        const parsed = JSON.parse((await readBody(req)) || '{}') as { updates?: PolicyUpdateInput[]; applyMode?: ApplyMode }
        const updates = Array.isArray(parsed.updates) ? parsed.updates : []
        if (updates.length === 0) throw new Error('updates array is required (non-empty)')
        const applyMode: ApplyMode =
          parsed.applyMode === 'next-session' || parsed.applyMode === 'immediate'
            ? parsed.applyMode
            : stateApplyMode(await readState())
        let applied = false
        let count = 0
        const failures: Array<{ serverName: string; error: string }> = []
        for (const raw of updates) {
          try {
            const { serverName, workspace, patch } = normalizeUpdate(raw)
            const result = await policy.set({ serverName, workspace, patch, applyMode })
            applied = applied || result.applied
            count += 1
          } catch (error) {
            failures.push({ serverName: String(raw?.serverName ?? '?'), error: messageOf(error) })
          }
        }
        if (count > 0) {
          // 策略变化可能改变期望进程状态：等注册表刷新后再返回，面板一次刷新即一致
          await registry.refreshNow()
          invalidateMcp()
        }
        return { applied, count, failed: failures.length, failures, applyMode }
      }, true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/policy/commit`,
      handler: handle('POST', async () => {
        // next-session 模式：「立即应用」把这批待生效意图提升为生效 —— 当轮工具集变化，
        // 当前会话前缀缓存失效（面板已提示费用），客户端刷新后会看到 live 与 intent 一致。
        const applied = await policy.commitPending()
        await registry.refreshNow()
        invalidateMcp()
        return { applied }
      }, true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/mcp/toolToggle`,
      handler: handle('POST', async (req) => {
        // 工具级禁用：写进该 server 的策略（项目级 server 写其工作空间表）
        const parsed = JSON.parse((await readBody(req)) || '{}') as {
          serverName?: string
          toolName?: string
          disabled?: boolean
          workspace?: string
        }
        if (typeof parsed.serverName !== 'string' || parsed.serverName.length === 0) throw new Error('serverName is required')
        if (typeof parsed.toolName !== 'string' || parsed.toolName.length === 0) throw new Error('toolName is required')
        const ref = registry.refFor(parsed.serverName, undefined)
        const workspace = typeof parsed.workspace === 'string' && parsed.workspace.length > 0 ? parsed.workspace : ref?.workspace
        const current = policy.effective(parsed.serverName, workspace).disabledTools
        const disabled = Boolean(parsed.disabled)
        const next = disabled
          ? [...new Set([...current, parsed.toolName])].sort()
          : current.filter((name) => name !== parsed.toolName)
        await policy.set({
          serverName: parsed.serverName,
          workspace,
          patch: { disabledTools: next },
          applyMode: stateApplyMode(await readState()),
        })
        await registry.refreshNow()
        invalidateMcp()
        return { serverName: parsed.serverName, toolName: parsed.toolName, disabled, disabledTools: next }
      }, true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/config`,
      handler: handleAny([
        {
          method: 'GET',
          run: async () => {
            const state = await readState()
            return {
              applyMode: stateApplyMode(state),
              middleLayer: config.middleLayer !== false,
              defaultExposure: config.defaultExposure ?? 'native',
            }
          },
        },
        {
          method: 'POST',
          run: async (req) => {
            const parsed = JSON.parse((await readBody(req)) || '{}') as { applyMode?: ApplyMode }
            const state = await readState()
            state.config ??= {}
            if (parsed.applyMode === 'immediate' || parsed.applyMode === 'next-session') {
              state.config.applyMode = parsed.applyMode
            }
            await writeState(state)
            return { applyMode: stateApplyMode(state) }
          },
        },
      ], true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/token`,
      handler: handle('GET', async () => ({ token: PANEL_TOKEN })),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/debug`,
      handler: handle('GET', async () => {
        const catalog: Record<string, { tools: number; fetchedAt: number; source: string }> = {}
        for (const [server, info] of Object.entries(catalogRuntime.catalog)) {
          catalog[server] = { tools: info.tools.length, fetchedAt: info.fetchedAt, source: info.source }
        }
        const scopeDiag: Record<string, unknown> = { error: null }
        try {
          const scopeKey = await resolveCollectScopeKey(hostCtx, undefined)
          const scoped = scopeKey ? getSchemasView(hostCtx, caches, scopeKey, DOMAIN_TTL_MS) : []
          const globalView = getSchemasView(hostCtx, caches, undefined, DOMAIN_TTL_MS)
          const merged = scopeKey ? mergeSchemas(scoped, globalView) : scoped
          const mcpNames = merged.map((s) => String(s?.name ?? '')).filter((name) => name.startsWith('mcp__'))
          scopeDiag.scopeKeyType = scopeKey ? typeof scopeKey : null
          scopeDiag.scopeKeySource = scopeKeySource()
          scopeDiag.scopedTotal = scoped.length
          scopeDiag.globalTotal = globalView.length
          scopeDiag.mergedMcpTools = mcpNames.length
          scopeDiag.scopedMcpSample = mcpNames.slice(0, 20)
        } catch (error) {
          scopeDiag.error = messageOf(error)
        }
        const snapshot = registry.snapshot()
        return {
          diag: catalogRuntime.diag,
          catalog,
          scopeDiag,
          registry: {
            ...registry.diagnostics(),
            servers: [...snapshot.all.values()].map((ref) => ({
              serverName: ref.serverName,
              source: ref.source,
              disabled: ref.disabled,
              running: ref.running,
              exposure: policy.effective(ref.serverName, ref.workspace).exposure,
            })),
          },
          policy: policy.diagnostics(),
        }
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/debug/collect`,
      handler: handle('POST', async () => {
        await triggerSnapshot()
        return { diag: catalogRuntime.diag }
      }, true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/mcp/preview`,
      handler: handle('POST', async (req) => {
        const parsed = JSON.parse((await readBody(req)) || '{}') as { json?: string }
        if (typeof parsed.json !== 'string' || parsed.json.trim().length === 0) throw new Error('json is required')
        const { servers, errors, warnings } = parseMcpServersJson(parsed.json)
        if (errors.length > 0) throw new Error(errors.join('；'))
        if (Object.keys(servers).length === 0) throw new Error('未解析出任何 MCP server')
        return { names: Object.keys(servers), yaml: serversToPatchYaml(servers), warnings }
      }, true),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/mcp/add`,
      handler: handle('POST', async (req) => {
        const parsed = JSON.parse((await readBody(req)) || '{}') as {
          json?: string
          target?: string
          workspace?: string
        }
        if (typeof parsed.json !== 'string' || parsed.json.trim().length === 0) throw new Error('json is required')
        const target = parsed.target === 'project' ? 'project' : 'global'
        const { servers, errors, warnings } = parseMcpServersJson(parsed.json)
        if (errors.length > 0) throw new Error(`转换失败：${errors.join('；')}`)
        if (Object.keys(servers).length === 0) throw new Error('没有可添加的 MCP server')
        if (target === 'global') {
          const result = await addGlobalMcp(ctx, servers)
          if (result.added === 0) {
            throw new Error(`全部跳过（已存在或挂载失败）：${result.skipped.join('、') || '未知原因'}`)
          }
          await registry.refreshNow()
          invalidateMcp()
          return { target, ...result, warnings }
        }
        // project：写入 <workspace>/.dsh/mcps/mcp.json 并重扫挂载（立即生效）
        let workspace = typeof parsed.workspace === 'string' && parsed.workspace.length > 0 ? parsed.workspace : undefined
        if (!workspace) workspace = getActiveWorkspace() ?? sessionScopeOf(undefined).workspace
        if (typeof workspace !== 'string' || workspace.length === 0) {
          throw new Error('project 目标需要 workspace（当前会话工作空间）')
        }
        const written = await writeProjectMcp(workspace, servers)
        await remountWorkspace(ctx, workspace, policy)
        await registry.refreshNow()
        invalidateMcp()
        return { target: 'project', ...written, workspace, added: Object.keys(servers).length, warnings }
      }, true),
    },
  ]
  // 旧前缀兼容（0.3.1 及以前）：同一组路由在新旧前缀下都注册
  return [
    ...routes,
    ...routes.map((route) => ({
      ...route,
      path: route.path.replace(API_PREFIX, LEGACY_API_PREFIX),
    })),
  ]
}
