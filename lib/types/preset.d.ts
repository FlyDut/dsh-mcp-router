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
import type { Context } from '@deepseek-ai/cordis';
import type { PolicyStore } from './domain/policy';
import type { Registry } from './domain/registry';
/**
 * 解析「可持久化的物化目标文件」。
 *
 * 关键事实（2026-09 实测确认）：profile patch（`cordis.patch.yml`）的 `- insert:` 行在
 * 加载后属于**根树**，其 `tree.filename` 是根树 backing 文件 `cordis.yml`（每次启动被
 * 重置为 `[]`）。因此对它写 disabled 标志必须落在同目录的 patch 文件上，否则重启后
 * 意图丢失（v0.6.0 曾因此让「隐藏/关闭」档位不再停用进程）。
 */
export declare function materializeTargetOf(file: string | undefined): string | undefined;
/**
 * 在组合文件中对 `- id: <rowId>` 行做 `  <key>: <value>` 标记的插入/移除
 * （薄包装 → `domain/composition-file.ts` 的 `setRowFlagAt`，支持缩进行）。
 *
 * 语义：`value=true` 保证标记存在且为 true（已有 `false` 时反转）；`value=false` 移除标记。
 */
export declare function setRowFlag(text: string, rowId: string, key: string, value: boolean): string;
/** 读取某行当前是否带 disabled: true（true/false/null=无标记/行不存在）。 */
export declare function rowDisabledState(text: string, rowId: string): boolean | null;
/** `- id: <rowId>` 行块整块删除（删除持久行用；块内仅此一行时连 `- insert:` 头一起删）。 */
export declare function removeRow(text: string, rowId: string): {
    text: string;
    removed: boolean;
};
export interface SyncPresetDeps {
    ctx: Context;
    registry: Registry;
    policy: PolicyStore;
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
export declare function syncPresetFiles(deps: SyncPresetDeps): Promise<number>;
