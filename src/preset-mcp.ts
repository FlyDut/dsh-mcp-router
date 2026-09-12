/**
 * rc.1 standing 组合 preset 行读取（空面板修复A，2026-09-08）。
 *
 * 背景：dsh 0.1.2-rc.1 起 preset 行挂在 standing 组合（agent scope 树），不再进
 * `ctx.loader.entries()`（实证 host/agent loader 156 行零 MCP，而
 * `compositionInventory()` 显示 standard-mcp 10 行、filesystem fiberState=2 运行中）。
 * collectMcp 只扫 loader → mcp[]==0 空面板；mcp_call 也因 findMcpEntry miss 而
 * 报「不在 loader 中」。
 *
 * 本模块只经 `ctx.agentPresets` 服务读数（compositionInventory/resolve/read），
 * 不直连 `livePresetMounts` 模块实例（host 与面板各装一份，模块态不共享），
 * 不产生运行时新依赖（type-only import，tsdown external 无影响）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { MCP_CLIENT_NAME } from './mcp-convert'

/** preset 文件文本解析出的单行 MCP 配置（key = 短 rowId，如 mcp-filesystem）。 */
export interface PresetMcpParsed {
  serverName: string
  transport: string | null
  toolCallTimeoutMs?: number
}

/** 短 rowId 回落 serverName（preset 文本缺 serverName 键时用；覆盖已知例外）。 */
function fallbackServerName(rowId: string): string {
  if (rowId === 'mcp-anki') return 'anki-mcp'
  return rowId.replace(/^mcp-/, '')
}

/**
 * 从 preset 组合文件文本解析某 rowId 的 serverName（v1 状态迁移用）。
 *
 * @param text - 组合文件文本；`null` 表示文件不可读 → 回落命名约定（`mcp-x` → `x`，
 *   已知例外 `mcp-anki` → `anki-mcp`）。
 * @returns serverName；文件可读但**不含该行**时返回 undefined（该行已失效，调用方
 *   应记入 unresolved 而非猜测）。
 */
export function firstMatchServerName(text: string | null, rowId: string): string | undefined {
  if (text === null) return fallbackServerName(rowId)
  const hit = parsePresetMcpText(text).get(rowId)
  return hit ? hit.serverName : undefined
}

/**
 * 解析 preset 组合文本，抽取全部 `mcp-*` 行的 serverName/transport/超时。
 * 纯文本正则（preset 文件结构稳定）：按 `^- id:` 切块，块内抓三个键。
 * 键锚定行首（防注释/长键误命中）；值允许可选双引号（YAML `"stdio"` 形态）。
 * 纯函数，可被 selftest 直接覆盖。
 */
export function parsePresetMcpText(text: string): Map<string, PresetMcpParsed> {
  const out = new Map<string, PresetMcpParsed>()
  const blocks = String(text ?? '').split(/(?=^- id:\s*)/m)
  for (const block of blocks) {
    const idMatch = /^-\s*id:\s*"?([^"\s]+)"?\s*$/m.exec(block)
    if (!idMatch) continue
    const rowId = idMatch[1]
    if (!rowId.startsWith('mcp-')) continue
    const sn = /^\s*serverName:\s*"?([A-Za-z0-9_-]+)"?\s*(?:#.*)?$/m.exec(block)
    const tr = /^\s*transport:\s*"?(\S+?)"?\s*(?:#.*)?$/m.exec(block)
    const tm = /^\s*toolCallTimeoutMs:\s*"?(\d+)"?\s*(?:#.*)?$/m.exec(block)
    const parsed: PresetMcpParsed = {
      serverName: sn ? sn[1] : fallbackServerName(rowId),
      transport: tr ? tr[1] : null,
    }
    if (tm) {
      const n = Number(tm[1])
      if (Number.isFinite(n) && n > 0) parsed.toolCallTimeoutMs = n
    }
    out.set(rowId, parsed)
  }
  return out
}

/** standing 组合中的一行 MCP（inventory 行 + preset 文本配置的合并）。 */
export interface PresetMcpRow {
  /** inventory 长 id（含 standing 前缀，如 include:agent-presets:mcp-filesystem）。 */
  entryId: string
  /** preset 文件内短 id（如 mcp-filesystem；state.json row 键）。 */
  rowId: string
  serverName: string
  transport: string | null
  toolCallTimeoutMs?: number
  disabled: boolean
  running: boolean
  /** preset 组合文件绝对路径（state.json mcp 段的文件键）。 */
  file: string
}

/** 带所属 preset id 的行（全量扫描用）。 */
export interface PresetMcpRowWithPreset extends PresetMcpRow {
  presetId: string
}

/** agentPresets 服务的最小读取契约（只经服务读数，不直连模块实例）。 */
interface PresetReaderService {
  compositionInventory(): Promise<unknown>
  resolve(id: string): Promise<unknown>
  read(id: string): Promise<unknown>
}

interface InventoryRow {
  entryId?: unknown
  moduleName?: unknown
  enabled?: unknown
  fiberState?: unknown
}

interface InventoryEntry {
  id?: unknown
  rows?: InventoryRow[]
}

async function readInventory(ctx: Context): Promise<InventoryEntry[]> {
  const presets = ctx.agentPresets as unknown as PresetReaderService
  const inventory = (await presets.compositionInventory()) as unknown
  return (Array.isArray(inventory) ? inventory : []) as InventoryEntry[]
}

/** 该 preset 的 standing 组合文件路径（resolve 失败返回空串）。 */
async function presetPathOf(ctx: Context, presetId: string): Promise<string> {
  const presets = ctx.agentPresets as unknown as PresetReaderService
  const resolved = (await presets.resolve(presetId)) as { path?: unknown }
  return String(resolved?.path ?? '')
}

/** 把 inventory 的 MCP 行 + preset 文本配置合并为 PresetMcpRow。 */
function mergeRows(inventoryRows: InventoryRow[], parsed: Map<string, PresetMcpParsed>, file: string): PresetMcpRow[] {
  const rows: PresetMcpRow[] = []
  for (const r of inventoryRows) {
    if (String(r?.moduleName ?? '') !== MCP_CLIENT_NAME) continue
    const entryId = String(r?.entryId ?? '')
    if (!entryId) continue
    const rowId = entryId.split(':').pop() ?? entryId
    const info = parsed.get(rowId)
    const serverName = info?.serverName ?? fallbackServerName(rowId)
    // inventory enabled 恒为 boolean（mcp 行 disabled 无 !!js）；缺席/非 false 保守按启用处理
    const disabled = r?.enabled === false
    // fiberState：inventory 只在 fiber 存在时带该键；判 running 用 != null（防 null/0 误判）
    const running = r?.fiberState !== undefined && r?.fiberState !== null
    const row: PresetMcpRow = {
      entryId,
      rowId,
      serverName,
      transport: info?.transport ?? null,
      disabled,
      running,
      file,
    }
    if (info?.toolCallTimeoutMs !== undefined) row.toolCallTimeoutMs = info.toolCallTimeoutMs
    rows.push(row)
  }
  return rows
}

/**
 * 列出某 preset 在 standing 组合中的全部 MCP 行。
 * inventory 给 entryId/enabled/fiberState，preset 文本给 serverName/transport/超时。
 */
export async function listPresetMcpRows(
  ctx: Context,
  presetId: string,
): Promise<{ rows: PresetMcpRow[]; presetPath: string }> {
  const inventory = await readInventory(ctx)
  const found = inventory.find((c) => String(c?.id ?? '') === presetId)
  if (!found) throw new Error(`preset "${presetId}" not in compositionInventory`)
  const presetPath = await presetPathOf(ctx, presetId)
  if (!presetPath) throw new Error(`preset "${presetId}" has no path`)
  const presets = ctx.agentPresets as unknown as PresetReaderService
  const text = String((await presets.read(presetId)) as unknown as string)
  return { rows: mergeRows(found.rows ?? [], parsePresetMcpText(text), presetPath), presetPath }
}

/**
 * 全量列出**所有** preset 的 standing MCP 行（注册表快照用）。
 *
 * 装配必须按「当前会话的 preset」精确判定一个 MCP 行的运行状态，而 rc.1 下这些行
 * 不在 `ctx.loader.entries()` 里，只能一次扫全量再按 presetId 分桶。无 MCP 行的
 * preset 直接跳过（避免无谓的 read 与文件 IO）。
 */
export async function listAllPresetMcpRows(ctx: Context): Promise<PresetMcpRowWithPreset[]> {
  const inventory = await readInventory(ctx)
  const presets = ctx.agentPresets as unknown as PresetReaderService
  const out: PresetMcpRowWithPreset[] = []
  for (const entry of inventory) {
    const presetId = String(entry?.id ?? '')
    if (!presetId) continue
    const mcpRows = (entry.rows ?? []).filter((r) => String(r?.moduleName ?? '') === MCP_CLIENT_NAME)
    if (mcpRows.length === 0) continue
    let file: string
    try {
      file = await presetPathOf(ctx, presetId)
    } catch {
      continue
    }
    if (!file) continue
    let text: string
    try {
      text = String((await presets.read(presetId)) as unknown as string)
    } catch {
      continue
    }
    for (const row of mergeRows(mcpRows, parsePresetMcpText(text), file)) {
      out.push({ ...row, presetId })
    }
  }
  return out
}

/**
 * 按长 entryId 反查其所属 preset 行（toggleMcp 预设兜底用）。
 * 逐 preset 找 entryId 命中，找到即 resolve+read+parse 该 preset。
 */
export async function findPresetRowByEntryId(
  ctx: Context,
  entryId: string,
): Promise<{ presetId: string; row: PresetMcpRow; presetPath: string } | undefined> {
  const inventory = await readInventory(ctx)
  const presets = ctx.agentPresets as unknown as PresetReaderService
  for (const c of inventory) {
    const pid = String(c?.id ?? '')
    if (!pid) continue
    const hit = (c.rows ?? []).find((r) => String(r?.entryId ?? '') === entryId && String(r?.moduleName ?? '') === MCP_CLIENT_NAME)
    if (!hit) continue
    const presetPath = await presetPathOf(ctx, pid)
    if (!presetPath) continue
    const text = String((await presets.read(pid)) as unknown as string)
    const [row] = mergeRows([hit], parsePresetMcpText(text), presetPath)
    if (!row) continue
    return { presetId: pid, row: { ...row, entryId }, presetPath }
  }
  return undefined
}
