/**
 * 预设组合文件的文本操作与启停意图物化。
 *
 * 运行期禁止写 agent 组合文件（dsh-agent-presets 的 {mtimeMs,size} stamp 检测会触发
 * standing 重挂事故，见 index.ts 铁律 1），因此档位切换只写 state.json 的意图，
 * 由 `syncPresetFiles` 在插件 apply（启动早期、standing 未挂载）时物化到组合文件。
 * 本模块的组合文件部分为纯文本操作，可被 selftest 覆盖。
 */
import type { Context } from '@deepseek-ai/cordis'
import { basename } from 'node:path'
import { readFile, writeFile, rename } from 'node:fs/promises'
import type { PolicyStore } from './domain/policy'
import type { Registry } from './domain/registry'
import { desiredRunning, decideSyncAction } from './domain/exposure'

/** 根树 backing 文件名（每次启动重置为 []，写它无意义）。 */
const ROOT_TREE_FILE = 'cordis.yml'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 新行分隔符：跟随原文件。 */
function lineSep(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * 在组合文件中对 `- id: <rowId>` 行做 `  <key>: <value>` 标记的插入/移除。
 * 逐行文本编辑，保留注释与 !!js 表达式原样（loader 的 yaml.dump 会丢注释，故不用）。
 *
 * 语义（2026-08-27 修复）：value=true 保证标记存在且为 true（已有 false 时反转）；
 * value=false 移除标记。
 */
export function setRowFlag(text: string, rowId: string, key: string, value: boolean): string {
  const nl = lineSep(text)
  const lines = text.split(/\r?\n/)
  const rowRe = new RegExp(`^-\\s*id:\\s*${escapeRegExp(rowId)}\\s*$`)
  const idx = lines.findIndex((line) => rowRe.test(line))
  if (idx < 0) throw new Error(`row "- id: ${rowId}" not found in composition file`)
  let end = idx + 1
  while (end < lines.length && !/^-\s*id:/.test(lines[end])) end += 1
  const block = lines.slice(idx, end)
  const flagRe = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(true|false)\\s*$`)
  const flagAt = block.findIndex((line) => flagRe.test(line))
  if (flagAt >= 0) {
    if (value) {
      // 已有标记但为 false → 替换为 true（反转）；已有 true → 文本不变（幂等）
      if (/:\s*false\s*$/.test(block[flagAt])) {
        lines.splice(idx + flagAt, 1, `  ${key}: true`)
        return lines.join(nl)
      }
      return text
    }
    // 移除现有标记行（flagAt 是行块内偏移 → 全局偏移为 idx + flagAt）
    lines.splice(idx + flagAt, 1)
    return lines.join(nl)
  }
  if (value) {
    lines.splice(idx + 1, 0, `  ${key}: true`)
    return lines.join(nl)
  }
  return text
}

/** 读取某行当前是否带 disabled: true（true/false/null=无标记/行不存在）。 */
export function rowDisabledState(text: string, rowId: string): boolean | null {
  const lines = text.split(/\r?\n/)
  const rowRe = new RegExp(`^-\\s*id:\\s*${escapeRegExp(rowId)}\\s*$`)
  const idx = lines.findIndex((line) => rowRe.test(line))
  if (idx < 0) return null
  let end = idx + 1
  while (end < lines.length && !/^-\s*id:/.test(lines[end])) end += 1
  const block = lines.slice(idx, end)
  const flagLine = block.find((line) => /^\s*disabled:\s*(true|false)\s*$/.test(line))
  if (!flagLine) return null
  return /:\s*true\s*$/.test(flagLine)
}

export interface SyncPresetDeps {
  ctx: Context
  registry: Registry
  policy: PolicyStore
}

/**
 * 启动早期物化：把策略意图（`desiredRunning` 派生的期望 disabled）写入组合文件。
 *
 * 只在「没有任何 agent 在跑」时执行 —— 有会话时写文件会触发 dsh-agent-presets 的
 * stamp 重挂（旧实例不 dispose → serverName 冲突事故）。
 *
 * 三条规则：
 * 1. **首次采用**：策略表里没有、但组合文件里有该行的 server，按文件现状采用
 *    （文件 disabled → `hidden`，否则 `native`），绝不反过来覆盖用户手工配置。
 * 2. **尊重外部修改**：文件当前状态与上次物化账本不一致 = 用户手工改过 → 只对齐
 *    账本，不覆盖文件。
 * 3. **物化**：期望 disabled ≠ 文件现状时写文件，并更新账本。
 *
 * @returns 实际写入文件的行数。
 */
export async function syncPresetFiles(deps: SyncPresetDeps): Promise<number> {
  const { ctx, registry, policy } = deps
  if (ctx.agents.list().length > 0) return 0
  const snapshot = registry.snapshot()
  if (snapshot.all.size === 0) return 0

  // ① 首次采用：文件里有行、策略表里没有 → 按文件现状建档（不写文件）
  for (const ref of snapshot.all.values()) {
    const workspace = ref.workspace
    if (workspace !== undefined) continue // 项目级行不写组合文件
    if (policy.intent(ref.serverName, undefined)) continue
    const file = await readComposition(ref.file)
    if (!file) continue
    const cur = rowDisabledState(file.text, ref.rowId)
    if (cur === null) continue
    await policy.adoptFromFile(ref.serverName, undefined, cur)
  }

  // ② 按文件分组物化（同一文件只读一次、只写一次）
  const targets = new Map<string, Array<{ rowId: string; wantDisabled: boolean; serverName: string }>>()
  for (const ref of snapshot.all.values()) {
    if (ref.workspace !== undefined) continue
    const intent = policy.intent(ref.serverName, undefined)
    if (!intent) continue
    const wantDisabled = !desiredRunning(intent.exposure)
    // 根树 backing 文件每次启动重置为 []：写它无意义
    if (!ref.file || basename(ref.file) === ROOT_TREE_FILE) continue
    let bucket = targets.get(ref.file)
    if (!bucket) {
      bucket = []
      targets.set(ref.file, bucket)
    }
    bucket.push({ rowId: ref.rowId, wantDisabled, serverName: ref.serverName })
  }

  let materialized = 0
  for (const [file, rows] of targets) {
    const loaded = await readComposition(file)
    if (!loaded) continue
    let text = loaded.text
    let changed = false
    let ledgerChanged = false
    for (const row of rows) {
      const cur = rowDisabledState(text, row.rowId)
      if (cur === null) continue // 行已不存在：放弃管理
      const applied = policy.intent(row.serverName, undefined)?.applied
      const action = decideSyncAction({ cur, applied, wantDisabled: row.wantDisabled, configured: true })
      if (action === 'align-ledger') {
        // 文件被外部改过：尊重现状（对齐账本，不覆盖）
        await policy.markApplied(row.serverName, undefined, cur)
        ledgerChanged = true
        ctx.logger.info?.(`mcp-panel: ${row.serverName}: composition externally modified, aligning ledger`)
        continue
      }
      if (action === 'noop') {
        if (applied !== cur) await policy.markApplied(row.serverName, undefined, cur)
        continue
      }
      if (action !== 'materialize') continue
      try {
        text = setRowFlag(text, row.rowId, 'disabled', row.wantDisabled)
        changed = true
        materialized += 1
        await policy.markApplied(row.serverName, undefined, row.wantDisabled)
      } catch {
        // 行已消失（用户删除）：放弃管理
      }
    }
    if (changed) {
      const tmp = `${file}.tmp`
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, file)
    }
    void ledgerChanged
  }
  return materialized
}

/** 读组合文件；不存在/不可读返回 undefined。 */
async function readComposition(file: string | undefined): Promise<{ text: string } | undefined> {
  if (typeof file !== 'string' || file.length === 0) return undefined
  try {
    return { text: await readFile(file, 'utf8') }
  } catch {
    return undefined
  }
}
