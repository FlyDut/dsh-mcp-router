/**
 * 组合文件的文本操作与启停意图物化。
 *
 * 运行期禁止写 agent 预设组合文件（dsh-agent-presets 的 {mtimeMs,size} stamp 检测会
 * 触发 standing 重挂事故，见 index.ts 铁律 1），因此档位切换只写 state.json 的意图，
 * 由 `syncPresetFiles` 在插件 apply（启动早期、standing 未挂载）时物化到组合文件。
 *
 * 文本级操作（行块定位、标志读写、config 替换）统一收敛在 `domain/composition-file.ts`，
 * 本模块只负责「物化目标解析 + 同步编排」，并保留对外的薄包装以便自测与复用。
 */
import type { Context } from '@deepseek-ai/cordis'
import { basename, dirname, join } from 'node:path'
import { readFile, writeFile, rename } from 'node:fs/promises'
import type { PolicyStore } from './domain/policy'
import type { Registry } from './domain/registry'
import { desiredRunning, decideSyncAction } from './domain/exposure'
import { findRowBlock, removeRowBlock, rowFlagAt, setRowFlagAt } from './domain/composition-file'

/** 根树 backing 文件名：每次启动重置为 `[]`，真正承载用户行的补丁层是同目录的 patch 文件。 */
const ROOT_TREE_FILE = 'cordis.yml'
/** profile 用户补丁层文件名。 */
const PROFILE_PATCH_FILE = 'cordis.patch.yml'

/**
 * 解析「可持久化的物化目标文件」。
 *
 * 关键事实（2026-09 实测确认）：profile patch（`cordis.patch.yml`）的 `- insert:` 行在
 * 加载后属于**根树**，其 `tree.filename` 是根树 backing 文件 `cordis.yml`（每次启动被
 * 重置为 `[]`）。因此对它写 disabled 标志必须落在同目录的 patch 文件上，否则重启后
 * 意图丢失（v0.6.0 曾因此让「隐藏/关闭」档位不再停用进程）。
 */
export function materializeTargetOf(file: string | undefined): string | undefined {
  if (typeof file !== 'string' || file.length === 0) return undefined
  return basename(file) === ROOT_TREE_FILE ? join(dirname(file), PROFILE_PATCH_FILE) : file
}

/**
 * 在组合文件中对 `- id: <rowId>` 行做 `  <key>: <value>` 标记的插入/移除
 * （薄包装 → `domain/composition-file.ts` 的 `setRowFlagAt`，支持缩进行）。
 *
 * 语义：`value=true` 保证标记存在且为 true（已有 `false` 时反转）；`value=false` 移除标记。
 */
export function setRowFlag(text: string, rowId: string, key: string, value: boolean): string {
  return setRowFlagAt(text, rowId, key, value)
}

/** 读取某行当前是否带 disabled: true（true/false/null=无标记/行不存在）。 */
export function rowDisabledState(text: string, rowId: string): boolean | null {
  return rowFlagAt(text, rowId, 'disabled')
}

/** `- id: <rowId>` 行块整块删除（删除持久行用；块内仅此一行时连 `- insert:` 头一起删）。 */
export function removeRow(text: string, rowId: string): { text: string; removed: boolean } {
  return removeRowBlock(text, rowId)
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
    if (ref.workspace !== undefined) continue // 项目级行不写组合文件
    if (policy.intent(ref.serverName, undefined)) continue
    const file = await readComposition(materializeTargetOf(ref.file))
    if (!file) continue
    // 行必须真实存在才谈「采用」：`rowFlagAt` 的 null 同时表示「无该行」与「无 disabled 键」
    if (!findRowBlock(file.text, ref.rowId)) continue
    await policy.adoptFromFile(ref.serverName, undefined, rowFlagAt(file.text, ref.rowId, 'disabled') === true)
  }

  // ② 按文件分组物化（同一文件只读一次、只写一次）
  const targets = new Map<string, Array<{ rowId: string; wantDisabled: boolean; serverName: string }>>()
  for (const ref of snapshot.all.values()) {
    if (ref.workspace !== undefined) continue
    const intent = policy.intent(ref.serverName, undefined)
    if (!intent) continue
    const wantDisabled = !desiredRunning(intent.exposure)
    // 根树 backing 文件（cordis.yml，每次启动重置为 []）→ 落到同目录的 patch 文件
    const file = materializeTargetOf(ref.file)
    if (!file) continue
    let bucket = targets.get(file)
    if (!bucket) {
      bucket = []
      targets.set(file, bucket)
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
      if (!findRowBlock(text, row.rowId)) continue // 行确实不存在（用户已删除）：放弃管理
      // 无 disabled 键 = 未停用（与 setRowFlag 的语义一致）—— 必须归一为 false，
      // 否则「文件中无该键」会被误判成「行不存在」，标志永远写不进去。
      const cur = rowFlagAt(text, row.rowId, 'disabled') === true
      const appliedRaw = policy.intent(row.serverName, undefined)?.applied
      const applied = appliedRaw === undefined ? undefined : appliedRaw === true
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
        text = setRowFlagAt(text, row.rowId, 'disabled', row.wantDisabled)
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
