/**
 * 外部 agent 配置的 MCP 嗅探与归一化。
 *
 * 目标：把「你机器上其它 agent 已经配好的 MCP」一次性搬进 DSH，不必手工抄命令与参数。
 *
 * 支持的文件形态（自动嗅探，无需用户指定）：
 *
 * | 形态 | 谁在用 | 键 |
 * |---|---|---|
 * | `{ mcpServers: {...} }` | Claude Code、Cursor、Gemini CLI | `mcpServers` |
 * | `{ mcp: { servers: {...} } }` | zcode | `mcp.servers` |
 * | `{ mcp: { <name>: {...} } }` | opencode | `mcp`（值为服务器映射） |
 * | `{ servers: {...} }` | VS Code `.vscode/mcp.json` | `servers` |
 * | `{ <name>: {...} }` | 手工片段 | 顶层裸映射 |
 *
 * 字段归一化（各家叫法不同）：
 * - `type: 'local'`（opencode）→ stdio；`type: 'remote'`（opencode/zcode）→ streamable-http
 * - `command` 为**数组**（opencode）→ 首个元素是命令、其余进 `args`
 * - `environment` → `env`
 * - `enabled: false` → 照常解析并在结果里标注（面板默认不勾选，但可见）
 *
 * 归一化后复用 `mcp-convert.ts` 的解析与校验（serverName 规则、transport 推断、
 * 非标量值告警），避免两套校验逻辑漂移。
 *
 * 纯逻辑、零运行时依赖（只 import 同构的纯模块），可被 selftest 直接覆盖。
 */
import { parseMcpServersJson, type McpServerConfig } from '../mcp-convert'

/** 识别出的文件形态。 */
export type ExternalFormat = 'mcpServers' | 'zcode' | 'opencode' | 'vscode' | 'bare'

/** 一条可导入的服务器。 */
export interface ImportedServer {
  /** 原始名字（作为新 serverName 的候选）。 */
  name: string
  /** 归一化后的配置（dsh-mcp-client 形状）。 */
  config: McpServerConfig
  /** 源配置里的 `enabled`（false = 源里已禁用，仅作提示）。 */
  enabled: boolean
  /** 归一化过程中的说明（如「command 数组已拆分」）。 */
  notes: string[]
}

export interface ExternalParseResult {
  /** 未能识别形态时为 undefined。 */
  format?: ExternalFormat
  servers: ImportedServer[]
  errors: string[]
  warnings: string[]
}

/** 内置扫描源（路径含 `<home>` / `<workspace>` 占位，由调用方展开）。 */
export interface KnownSource {
  id: string
  label: string
  path: string
  /** true = 路径相对当前工作空间而非 HOME。 */
  projectRelative: boolean
  /** false = 已知但本版本不支持解析（扫描结果里会说明原因）。 */
  supported: boolean
  note?: string
}

/**
 * 内置扫描源清单。
 *
 * @param opts.home - 用户主目录（`~`）。
 * @param opts.workspace - 当前会话工作空间（项目级源用；缺省时跳过项目级源）。
 */
export function knownMcpSources(opts: { home: string; workspace?: string | null }): KnownSource[] {
  const home = opts.home.replace(/[\\/]$/, '')
  const workspace = typeof opts.workspace === 'string' && opts.workspace.length > 0 ? opts.workspace : undefined
  const sources: KnownSource[] = [
    { id: 'opencode', label: 'opencode', path: `${home}/.config/opencode/opencode.json`, projectRelative: false, supported: true },
    { id: 'zcode', label: 'zcode', path: `${home}/.zcode/cli/config.json`, projectRelative: false, supported: true },
    { id: 'claude-code', label: 'Claude Code', path: `${home}/.claude.json`, projectRelative: false, supported: true },
    { id: 'cursor', label: 'Cursor', path: `${home}/.cursor/mcp.json`, projectRelative: false, supported: true },
    { id: 'gemini-cli', label: 'Gemini CLI', path: `${home}/.gemini/settings.json`, projectRelative: false, supported: true },
    {
      id: 'zed',
      label: 'Zed',
      path: `${home}/.config/zed/settings.json`,
      projectRelative: false,
      supported: false,
      note: 'Zed 用 context_servers 且 command 为对象形态，本版本不支持',
    },
    {
      id: 'codex',
      label: 'Codex',
      path: `${home}/.codex/config.toml`,
      projectRelative: false,
      supported: false,
      note: 'TOML 格式，本版本不支持',
    },
  ]
  if (workspace !== undefined) {
    sources.push(
      { id: 'claude-project', label: 'Claude Code（项目）', path: `${workspace}/.mcp.json`, projectRelative: true, supported: true },
      { id: 'vscode-project', label: 'VS Code（项目）', path: `${workspace}/.vscode/mcp.json`, projectRelative: true, supported: true },
    )
  }
  return sources
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 顶层键是否像「服务器名 → 配置对象」的映射。 */
function looksLikeServerMap(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false
  const entries = Object.entries(value)
  if (entries.length === 0) return false
  // 至少一半的值是对象且含 MCP 特征键，避免把 settings 之类的映射误判为服务器表
  let hits = 0
  for (const [, item] of entries) {
    if (!isPlainObject(item)) continue
    if ('command' in item || 'url' in item || 'type' in item || 'transport' in item) hits += 1
  }
  return hits * 2 >= entries.length
}

/** 嗅探形态并取出服务器映射。 */
function detect(text: string): { format?: ExternalFormat; map?: Record<string, unknown>; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isPlainObject(raw)) return { error: '顶层不是 JSON 对象' }
  if (looksLikeServerMap(raw.mcpServers)) return { format: 'mcpServers', map: raw.mcpServers }
  if (isPlainObject(raw.mcp)) {
    const mcp = raw.mcp as Record<string, unknown>
    if (looksLikeServerMap(mcp.servers)) return { format: 'zcode', map: mcp.servers }
    if (looksLikeServerMap(mcp)) return { format: 'opencode', map: mcp }
  }
  if (looksLikeServerMap(raw.servers)) return { format: 'vscode', map: raw.servers }
  if (looksLikeServerMap(raw)) return { format: 'bare', map: raw }
  return { error: '未找到 MCP 配置（支持 mcpServers / mcp.servers / mcp / servers 或裸名字映射）' }
}

/**
 * 把一家之言归一为 `mcpServers` 形状（供 mcp-convert 复用解析）。
 * 只做形状转换，不校验值；notes 记录发生过的转换。
 */
function normalizeServer(value: unknown, notes: string[]): unknown {
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = { ...value }
  const type = String(value.type ?? '').toLowerCase()
  // opencode / zcode 的 type 叫法
  if (type === 'local') {
    out.type = 'stdio'
    notes.push('type: local → stdio')
  } else if (type === 'remote') {
    out.type = 'http'
    notes.push('type: remote → streamable-http')
  }
  // opencode 的 command 是「命令 + 参数」数组
  if (Array.isArray(value.command)) {
    const list = value.command.filter((item): item is string => typeof item === 'string')
    if (list.length > 0) {
      out.command = list[0]
      if (value.args === undefined && list.length > 1) out.args = list.slice(1)
      notes.push(list.length > 1 && value.args === undefined ? `command 数组已拆分为命令 + ${list.length - 1} 个参数` : 'command 数组已取首个元素作为命令')
    } else {
      delete out.command
      notes.push('command 数组为空，已忽略')
    }
  }
  // environment → env（Claude Code 用 env，opencode/zcode 用 environment）
  if (value.environment !== undefined && value.env === undefined) {
    out.env = value.environment
    notes.push('environment → env')
  }
  // enabled 不是 dsh-mcp-client 的字段：记录后从配置里剔除
  delete out.enabled
  return out
}

/**
 * 解析一份外部 agent 配置文件。
 *
 * @param text - 文件全文（JSON；TOML 等其它格式请先由调用方拒绝）。
 */
export function parseExternalMcpConfig(text: string): ExternalParseResult {
  const detected = detect(text)
  if (detected.map === undefined) {
    return { servers: [], errors: [detected.error ?? '无法识别的配置形态'], warnings: [] }
  }
  const map: Record<string, unknown> = {}
  const notesByName = new Map<string, string[]>()
  for (const [name, value] of Object.entries(detected.map)) {
    const notes: string[] = []
    map[name] = normalizeServer(value, notes)
    if (notes.length > 0) notesByName.set(name, notes)
    if (isPlainObject(value) && value.enabled === false) notes.push('源配置里该项为 enabled: false')
  }
  // 复用 mcp-convert 的解析与校验（serverName 规则 / transport 推断 / 非标量告警）
  const parsed = parseMcpServersJson(JSON.stringify({ mcpServers: map }))
  const servers: ImportedServer[] = []
  for (const [name, config] of Object.entries(parsed.servers)) {
    const rawValue = detected.map[name]
    servers.push({
      name,
      config,
      enabled: !(isPlainObject(rawValue) && rawValue.enabled === false),
      notes: notesByName.get(name) ?? [],
    })
  }
  servers.sort((a, b) => a.name.localeCompare(b.name))
  return {
    format: detected.format,
    servers,
    errors: parsed.errors,
    warnings: parsed.warnings,
  }
}

/** 一句话描述某服务器的连接方式（面板列表用）。 */
export function describeImportedServer(server: ImportedServer): string {
  const { config } = server
  if (config.transport === 'stdio') {
    const args = config.args && config.args.length > 0 ? ` ${config.args.join(' ')}` : ''
    return `stdio: ${config.command ?? ''}${args}`.trim()
  }
  return `http: ${config.url ?? ''}`.trim()
}
