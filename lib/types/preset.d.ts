/**
 * 预设组合文件的文本操作与启停意图物化。
 *
 * 运行期禁止写 agent 组合文件（dsh-agent-presets 的 {mtimeMs,size} stamp 检测会触发
 * standing 重挂事故，见 index.ts 铁律 1），因此档位切换只写 state.json 的意图，
 * 由 `syncPresetFiles` 在插件 apply（启动早期、standing 未挂载）时物化到组合文件。
 * 本模块的组合文件部分为纯文本操作，可被 selftest 覆盖。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PolicyStore } from './domain/policy';
import type { Registry } from './domain/registry';
/**
 * 在组合文件中对 `- id: <rowId>` 行做 `  <key>: <value>` 标记的插入/移除。
 * 逐行文本编辑，保留注释与 !!js 表达式原样（loader 的 yaml.dump 会丢注释，故不用）。
 *
 * 语义（2026-08-27 修复）：value=true 保证标记存在且为 true（已有 false 时反转）；
 * value=false 移除标记。
 */
export declare function setRowFlag(text: string, rowId: string, key: string, value: boolean): string;
/** 读取某行当前是否带 disabled: true（true/false/null=无标记/行不存在）。 */
export declare function rowDisabledState(text: string, rowId: string): boolean | null;
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
