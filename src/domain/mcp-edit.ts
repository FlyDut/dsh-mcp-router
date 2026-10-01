/**
 * MCP 服务器的编辑与删除编排层。
 *
 * 只处理「可写行」的持久化 + 运行时同步；预设组合行（`agent.cordis.yml`）一律拒绝并
 * 给出替代路径 —— 运行期写预设文件会触发 dsh-agent-presets 的重挂事故（见 index.ts 铁律）。
 *
 * 写回矩阵：
 *
 * | 来源 | 文件 | 编辑 | 删除 |
 * |---|---|---|---|
 * | loader 行（profile patch） | `tree.filename` 是根树 `cordis.yml` → 落到同目录 `cordis.patch.yml` | 文本替换 config 块 + `entry.update({config})` | 删块 + `loader.remove` + 清策略 |
 * | 项目行 | `<workspace>/.dsh/mcps/**\/mcp.json` | 改 JSON 值 + `remountWorkspace` | 删 JSON 键 + `remountWorkspace` |
 * | 预设行 | `<preset>/agent.cordis.yml` | 拒绝（只读） | 拒绝（引导用「关闭」档位） |
 *
 * 顺序固定为「**先写文件、再动运行时**」：反过来会出现「运行时改了但没落盘」的半状态，
 * 用户以为改成功了、重启后却回到旧配置。文件写成功后，运行时操作一律容错（live patch
 * reload 可能已经替我们重建了行）。
 */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { configKeyBodies, type McpServerConfig } from '../mcp-convert'
import { isMcpEntry } from '../mcp-entry'
import { materializeTargetOf } from '../preset'
import { findRowBlock, readConfigBlock, replaceRowConfig, removeRowBlock, dedentLines } from './composition-file'
import { findProjectMcpFile, remountWorkspace } from '../project-mcp'
import type { PolicyStore } from './policy'
import type { Registry, ServerRef } from './registry'
import { messageOf } from '../util'

/** 可写目标：把一行映射到「写哪个文件的哪个键/行」。 */
export type WritableTarget =
  | { kind: 'patch'; file: string; rowId: string }
  | { kind: 'project'; file: string; key: string; workspace: string; rowId: string }
  | { kind: 'readonly'; reason: 'preset'; file: string }

export interface EditDeps {
  ctx: Context
  registry: Registry
  policy: PolicyStore
}

/** 编辑用的配置补丁（面板表单字段；未提供的字段保持原值）。 */
export interface ServerConfigPatch {
  serverName?: string
  transport?: McpServerConfig['transport']
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
/** dsh-mcp-client 认识的 config 字段；不在新配置里的会被删除（切换 transport 时清理旧字段）。 */
const KNOWN_CONFIG_KEYS = new Set([
  'transport',
  'serverName',
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'toolCallTimeoutMs',
])

/** 解析某行的可写目标（预设行返回 readonly，附来源文件供面板提示）。 */
export async function resolveWritableTarget(ref: ServerRef): Promise<WritableTarget> {
  if (ref.source === 'preset') return { kind: 'readonly', reason: 'preset', file: ref.file ?? '' }
  if (ref.source === 'project') {
    const workspace = ref.workspace ?? ''
    const found = await findProjectMcpFile(workspace, ref.serverName)
    if (!found) {
      throw new Error(
        `项目级 MCP "${ref.serverName}"：在 ${workspace}/.dsh/mcps 下找不到它的来源文件（可能已被手工删除或改名）`,
      )
    }
    return { kind: 'project', file: found.file, key: found.key, workspace, rowId: ref.rowId }
  }
  const file = materializeTargetOf(ref.file)
  if (!file) {
    throw new Error(`MCP "${ref.serverName}"：无法定位它的配置文件（loader 行未挂载在任何可写文件上）`)
  }
  return { kind: 'patch', file, rowId: ref.rowId }
}

/** 只读目标的统一拒绝文案（编辑与删除共用）。 */
function readonlyError(serverName: string, target: Extract<WritableTarget, { kind: 'readonly' }>): Error {
  return new Error(
    `MCP "${serverName}" 声明在 agent 预设组合文件里（${target.file}），面板不能改写它 —— ` +
      `运行期写预设文件会让整个预设重挂并导致 MCP 名字冲突。` +
      `要让它彻底不可用，请把档位设为「关闭」；要真正删除，请直接编辑该文件。`,
  )
}

/** 项目工作空间重扫（容错：文件已落盘，重扫失败只是「未立即生效」）。 */
async function remountQuietly(ctx: Context, policy: PolicyStore, workspace: string): Promise<void> {
  try {
    await remountWorkspace(ctx, workspace, policy)
  } catch (error) {
    ctx.logger.warn?.(`dsh-mcp-router: remount workspace "${workspace}" failed: ${messageOf(error)}`)
  }
}

/** 读取 JSON 文件（失败给出可读错误）。 */
async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    throw new Error(`读取 ${file} 失败：${messageOf(error)}`)
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('顶层不是 JSON 对象')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`解析 ${file} 失败：${messageOf(error)}`)
  }
}

/** 原子写文件（tmp + rename），保留原换行风格由调用方保证。 */
async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

/** 合并补丁与原配置（未提供的字段保持原值；数组/字典整体替换）。 */
export function mergeConfig(base: ServerConfigPatch, patch: ServerConfigPatch): ServerConfigPatch {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = value
  }
  return out as ServerConfigPatch
}

/** 回显脱敏哨兵：env/headers 的**键名保留**，值替换为它（整表单回写时视为「保留原值」）。 */
export const MASKED_VALUE = '***MASKED***'

/** 需要脱敏的字段（遮蔽值、保留键名）。 */
const SECRET_CONFIG_KEYS = ['env', 'headers'] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 回显脱敏（`GET /mcp/detail`、`POST /mcp/scan` 回传的 config 用）。
 *
 * 2026-09-23（移植上游 0b16e6f）：只读端点不该把求值后的 env/headers 真值吐出来。
 * 面板「读回显 → 整表单回写」的编辑路径依赖 {@link unmaskEcho} 把哨兵还原，
 * **两者必须成对上线**，否则会把哨兵当真值写进配置文件。
 */
export function maskConfigSecrets(config: ServerConfigPatch): ServerConfigPatch {
  const out: Record<string, unknown> = { ...config }
  for (const key of SECRET_CONFIG_KEYS) {
    const value = out[key]
    if (!isPlainRecord(value)) continue
    const masked: Record<string, string> = {}
    for (const name of Object.keys(value)) masked[name] = MASKED_VALUE
    out[key] = masked
  }
  return out as ServerConfigPatch
}

/**
 * 写侧：哨兵值即「保留原值」。
 *
 * 有 live 真值 → 恢复；live 里本就没有该键 → 丢弃（不凭空造键）。真实轮换/新增的值
 * 原样接受，用户删掉的键也不会被恢复。
 */
export function unmaskEcho(patch: ServerConfigPatch, live: ServerConfigPatch): ServerConfigPatch {
  const out: Record<string, unknown> = { ...patch }
  for (const key of SECRET_CONFIG_KEYS) {
    const incoming = out[key]
    if (!isPlainRecord(incoming)) continue
    const liveMap = isPlainRecord(live[key]) ? (live[key] as Record<string, unknown>) : undefined
    const merged: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(incoming)) {
      if (value === MASKED_VALUE) {
        if (liveMap && Object.prototype.hasOwnProperty.call(liveMap, name)) merged[name] = liveMap[name]
        continue
      }
      merged[name] = value
    }
    out[key] = merged
  }
  return out as ServerConfigPatch
}

/** 把补丁转成 dsh-mcp-client 的 config 形状（丢掉与当前 transport 无关的字段）。 */
export function toClientConfig(patch: ServerConfigPatch): Record<string, unknown> {
  const transport = patch.transport ?? (patch.url !== undefined && patch.command === undefined ? 'streamable-http' : 'stdio')
  const config: Record<string, unknown> = { transport }
  if (patch.serverName !== undefined) config.serverName = patch.serverName
  if (transport === 'stdio') {
    if (patch.command !== undefined) config.command = patch.command
    if (patch.args !== undefined && patch.args.length > 0) config.args = patch.args
    if (patch.env !== undefined && Object.keys(patch.env).length > 0) config.env = patch.env
    if (patch.cwd !== undefined && patch.cwd.length > 0) config.cwd = patch.cwd
  } else {
    if (patch.url !== undefined) config.url = patch.url
    if (patch.headers !== undefined && Object.keys(patch.headers).length > 0) config.headers = patch.headers
  }
  if (patch.toolCallTimeoutMs !== undefined) config.toolCallTimeoutMs = patch.toolCallTimeoutMs
  return config
}

/**
 * patch 行的编辑基线：loader 已解析的 config（含 `!!js` 的运行值；写回文件时动态键仍保留原文）。
 * 取不到时**报错**而非退化 —— 残缺基线会在合并时静默丢掉 command/args 等字段。
 */
function patchBaseFromLoader(deps: EditDeps, ref: ServerRef): ServerConfigPatch {
  let entry: ReturnType<Context['loader']['resolve']> | undefined
  try {
    entry = deps.ctx.loader.resolve(ref.entryId)
  } catch {
    entry = undefined
  }
  if (!entry || !isMcpEntry(entry)) {
    throw new Error(`MCP "${ref.serverName}" 当前未挂载在 loader 中，无法读取现有配置（请刷新面板后重试）`)
  }
  const raw = entry.options.config
  return raw !== null && typeof raw === 'object' ? { ...(raw as ServerConfigPatch) } : { serverName: ref.serverName, transport: 'stdio' }
}

/** 项目行的编辑基线：`mcp.json` 里该键的值（文件即真相；loader 侧的名字带路径哈希后缀）。 */
function projectBaseFrom(parsed: Record<string, unknown>, key: string, file: string): ServerConfigPatch {
  const servers = parsed.mcpServers
  const value =
    servers !== null && typeof servers === 'object' && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)[key]
      : undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} 里的 server "${key}" 不是对象配置，无法编辑`)
  }
  return { ...(value as ServerConfigPatch) }
}

/** 取出 mcpServers 映射（缺失时给出可读错误）。 */
function mcpServersOf(parsed: Record<string, unknown>, file: string): Record<string, unknown> {
  const servers = parsed.mcpServers
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error(`${file} 里没有 mcpServers 映射`)
  }
  return servers as Record<string, unknown>
}

export interface UpdateResult {
  serverName: string
  /** 改名后的新 serverName（未改名时与入参相同）。 */
  renamedTo?: string
  file: string
  /** 运行时是否已同步（false = 需重启或由 live patch reload 接管）。 */
  applied: boolean
}

/**
 * 编辑一个 MCP 服务器。
 *
 * @throws 目标只读 / 行不在文件里 / 名字冲突或非法 —— 都带明确中文原因，端点直接透传。
 */
export async function updateServer(deps: EditDeps, input: { serverName: string; workspace?: string; patch: ServerConfigPatch }): Promise<UpdateResult> {
  const { ctx, registry, policy } = deps
  const ref = registry.refFor(input.serverName, undefined)
  if (!ref) throw new Error(`未知 MCP server：${input.serverName}`)
  const target = await resolveWritableTarget(ref)
  if (target.kind === 'readonly') throw readonlyError(input.serverName, target)

  const renameRequested = input.patch.serverName !== undefined && input.patch.serverName !== ref.serverName
  if (target.kind === 'project' && renameRequested) {
    throw new Error(
      `项目级 MCP 的名字由 ${target.file} 里的配置键决定（当前挂载名 ${ref.serverName}），面板不支持改名；请直接编辑该文件。`,
    )
  }
  const nextName = renameRequested ? (input.patch.serverName as string) : ref.serverName
  if (!SERVER_NAME_PATTERN.test(nextName)) {
    throw new Error(`serverName "${nextName}" 需匹配 [A-Za-z0-9_-]{1,32}`)
  }
  if (renameRequested) {
    const clash = registry.refFor(nextName, undefined)
    if (clash) throw new Error(`serverName "${nextName}" 已被占用（dsh-mcp-client 的名字全进程唯一）`)
  }

  // ① 目标文件存在性校验（先行：错误信息对得上用户能处理的问题）
  let patchText: string | undefined
  let projectParsed: Record<string, unknown> | undefined
  if (target.kind === 'patch') {
    patchText = await readFile(target.file, 'utf8').catch((error: unknown) => {
      throw new Error(`读取 ${target.file} 失败：${messageOf(error)}`)
    })
    if (!findRowBlock(patchText, target.rowId)) {
      throw new Error(`${target.file} 里找不到 "- id: ${target.rowId}" 这一行（可能被手工改过），未做任何改动`)
    }
  } else {
    projectParsed = await readJsonFile(target.file)
    const servers = mcpServersOf(projectParsed, target.file)
    if (!(target.key in servers)) {
      throw new Error(`${target.file} 里找不到 server "${target.key}"（可能被手工改过），未做任何改动`)
    }
  }

  // ② 合并编辑补丁（基线必须完整，否则会丢字段）；哨兵值还原成 live 真值（脱敏回显闭环）
  const base = target.kind === 'patch' ? patchBaseFromLoader(deps, ref) : projectBaseFrom(projectParsed as Record<string, unknown>, target.key, target.file)
  const runtimeConfig = toClientConfig(mergeConfig(base, unmaskEcho(input.patch, base)))

  if (target.kind === 'patch') {
    const text = patchText as string
    const existing = readConfigBlock(text, target.rowId)
    const generated = new Map(configKeyBodies(runtimeConfig).map((item) => [item.name, item]))
    const inputs: Array<{ name: string; body: string[] }> = []
    const used = new Set<string>()
    for (const key of existing?.keys ?? []) {
      // 动态（!!js）键：原文保留，绝不把表达式固化成当前值
      if (key.dynamic) {
        inputs.push({ name: key.name, body: dedentLines(key.lines) })
        used.add(key.name)
        continue
      }
      const fresh = generated.get(key.name)
      if (fresh) {
        inputs.push(fresh)
        used.add(key.name)
        continue
      }
      // 已知字段但新配置里没有（如 stdio → http 后的 command/args）：删除，避免残留无效字段
      if (KNOWN_CONFIG_KEYS.has(key.name)) continue
      // 真正未知的字段（用户自定义/未来版本）：原样保留
      inputs.push({ name: key.name, body: dedentLines(key.lines) })
    }
    for (const item of configKeyBodies(runtimeConfig)) if (!used.has(item.name)) inputs.push(item)

    const rewritten = replaceRowConfig(text, target.rowId, inputs)
    if (!rewritten.changed) {
      throw new Error(`${target.file} 里这一行没有可替换的 config 块（可能是内联写法），请直接编辑该文件`)
    }
    await writeFileAtomic(target.file, rewritten.text)
  } else {
    const parsed = projectParsed as Record<string, unknown>
    const servers = mcpServersOf(parsed, target.file)
    // 键即原始名（挂载名由 projectServerName 加路径哈希后缀生成）→ 编辑只改值，不动键
    servers[target.key] = toClientConfigWithoutName(runtimeConfig)
    parsed.mcpServers = servers
    await writeFileAtomic(target.file, `${JSON.stringify(parsed, null, 2)}\n`)
    // 项目行改名后挂载名会重新计算（带路径哈希后缀）：让 project-mcp 重扫。
    // 文件已落盘是主结果，重扫失败只影响「立即生效」，下次会话/启动会重扫，故容错。
    await remountQuietly(ctx, policy, target.workspace)
  }

  // 运行时同步（容错）：live patch reload 可能已按新文件内容重建了行
  let applied = false
  try {
    const entry = ctx.loader.resolve(ref.entryId)
    if (entry && isMcpEntry(entry)) {
      await entry.update({ config: runtimeConfig })
      applied = true
    }
  } catch (error) {
    ctx.logger.debug?.(`dsh-mcp-router: runtime update for "${ref.serverName}" skipped (${messageOf(error)})`)
  }

  if (nextName !== ref.serverName) {
    await policy.renameServer(ref.serverName, nextName, ref.workspace)
  }
  await registry.refreshNow()

  const result: UpdateResult = { serverName: ref.serverName, file: target.file, applied }
  if (nextName !== ref.serverName) result.renamedTo = nextName
  return result
}

/** 项目 mcp.json 的 server 值不写 serverName（键即名字，挂载时会由 projectServerName 生成）。 */
function toClientConfigWithoutName(patch: ServerConfigPatch): Record<string, unknown> {
  const config = toClientConfig(patch)
  delete config.serverName
  return config
}

export interface RemoveResult {
  serverName: string
  file: string
  /** 是否已从 loader 卸载（false = 行不在 loader 中，属正常情况）。 */
  unloaded: boolean
}

/**
 * 删除一个 MCP 服务器：写文件 → 卸载 loader 行 → 清理策略。预设组合行一律拒绝。
 *
 * @throws 目标只读 / 文件里找不到该行（都不做部分修改）。
 */
export async function removeServer(deps: EditDeps, input: { serverName: string; workspace?: string }): Promise<RemoveResult> {
  const { ctx, registry, policy } = deps
  const ref = registry.refFor(input.serverName, undefined)
  if (!ref) throw new Error(`未知 MCP server：${input.serverName}`)
  const target = await resolveWritableTarget(ref)
  if (target.kind === 'readonly') throw readonlyError(input.serverName, target)

  if (target.kind === 'patch') {
    const text = await readFile(target.file, 'utf8').catch((error: unknown) => {
      throw new Error(`读取 ${target.file} 失败：${messageOf(error)}`)
    })
    const removed = removeRowBlock(text, target.rowId)
    if (!removed.removed) {
      throw new Error(`${target.file} 里找不到 "- id: ${target.rowId}" 这一行（可能被手工删除），未做任何改动`)
    }
    await writeFileAtomic(target.file, removed.text)
  } else {
    const parsed = await readJsonFile(target.file)
    const servers = parsed.mcpServers
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
      throw new Error(`${target.file} 里没有 mcpServers 映射`)
    }
    const map = servers as Record<string, unknown>
    if (!(target.key in map)) throw new Error(`${target.file} 里找不到 server "${target.key}"（可能被手工改过）`)
    delete map[target.key]
    parsed.mcpServers = map
    await writeFileAtomic(target.file, `${JSON.stringify(parsed, null, 2)}\n`)
    await remountQuietly(ctx, policy, target.workspace)
  }

  // 卸载运行时行（live patch reload 可能已经卸载；预设行不在 loader 中，属正常）
  let unloaded = false
  try {
    await ctx.loader.remove(ref.entryId)
    unloaded = true
  } catch (error) {
    ctx.logger.debug?.(`dsh-mcp-router: loader remove for "${ref.serverName}" skipped (${messageOf(error)})`)
  }

  const cleared = await policy.clear(ref.serverName, ref.workspace)
  if (cleared) ctx.logger.info?.(`dsh-mcp-router: cleared policy of removed MCP "${ref.serverName}"`)
  await registry.refreshNow()

  return { serverName: ref.serverName, file: target.file, unloaded }
}

/** 供端点复用的「编辑初值」：把一行还原为面板表单需要的字段。 */
export interface ServerDetail {
  serverName: string
  target: WritableTarget
  config: ServerConfigPatch
  /** config 顶层键：`dynamic` 的键在面板上只读、写回时原样保留。 */
  keys: Array<{ name: string; dynamic: boolean }>
  /** 只读目标的原因说明（面板直接展示）。 */
  readonly?: string
}

export async function describeServer(deps: EditDeps, input: { serverName: string; workspace?: string }): Promise<ServerDetail> {
  const { registry } = deps
  const ref = registry.refFor(input.serverName, undefined)
  if (!ref) throw new Error(`未知 MCP server：${input.serverName}`)
  const target = await resolveWritableTarget(ref)
  // 只读目标（预设行）不读基线：面板只展示来源与说明，不提供表单
  let config: ServerConfigPatch = { serverName: ref.serverName }
  if (target.kind === 'patch') config = patchBaseFromLoader(deps, ref)
  else if (target.kind === 'project') config = projectBaseFrom(await readJsonFile(target.file), target.key, target.file)
  let keys: Array<{ name: string; dynamic: boolean }> = []
  if (target.kind === 'patch') {
    const text = await readFile(target.file, 'utf8').catch(() => '')
    const block = text ? readConfigBlock(text, target.rowId) : undefined
    keys = (block?.keys ?? []).map((key) => ({ name: key.name, dynamic: key.dynamic }))
  } else if (target.kind === 'project') {
    keys = Object.keys(config).map((name) => ({ name, dynamic: false }))
  }
  const detail: ServerDetail = { serverName: ref.serverName, target, config, keys }
  if (target.kind === 'readonly') {
    detail.readonly = `声明在预设组合文件 ${basename(target.file) || target.file}（只读）`
  }
  return detail
}

/** 项目文件与 patch 文件同名键的展示辅助（诊断/日志）。 */
export function targetLabel(target: WritableTarget): string {
  if (target.kind === 'readonly') return `preset:${target.file}`
  if (target.kind === 'project') return `project:${join(dirname(target.file), basename(target.file))}#${target.key}`
  return `patch:${target.file}`
}
