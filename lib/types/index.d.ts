/**
 * dsh-mcp-skill-panel — Host 半区入口（接线层）。
 *
 * 插件唯一职责：**决定每个 MCP 服务器对哪个会话以什么粒度可见，并在不可见时按需调用它**。
 * 本文件只做组装与生命周期，各层职责见：
 * - `domain/exposure.ts`  四档语义 + 预设关联隔离 + v1 迁移（纯逻辑）
 * - `domain/policy.ts`    策略真源（意图/生效两份 + 持久化 + 启动迁移）
 * - `domain/registry.ts`  MCP 行来源归一（loader / preset standing / 项目级）
 * - `domain/assembly.ts`  唯一装配注入点（工具过滤 + 仅名称索引段）
 * - `mcpcall.ts`          中间层（mcp_search / mcp_call）+ 保活回收
 * - `collect.ts`/`routes.ts` 面板数据与 HTTP 端点
 *
 * 两条历史铁律（实测事故得出，勿改）：
 * 1. 运行期**禁止**写 agent preset 组合文件 —— dsh-agent-presets 用 {mtimeMs,size} stamp
 *    检测文件变化并重挂 standing，旧实例不 dispose → serverName 全冲突、会话创建失败。
 *    因此启停意图只写 state.json，由 `syncPresetFiles` 在启动早期（standing 未挂载）物化。
 * 2. `tools.schemas(scope)` 必须传 scope 对象（`scopeOf(agent.ctx)` 或 agent 对象本身）；
 *    传 agent 之外的键会落回全局视图，导致 mcp 工具「不存在」。
 */
import Schema from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { type Exposure } from './domain/exposure';
export { normalizeToolName, normalizeArguments, msgOf } from './mcpcall';
export type { McpView, McpRow } from './shared-types';
export type { DomainCaches } from './collect';
export type { CatalogRuntime } from './runtime-types';
export type { Exposure, PresetScope, ServerPolicy } from './domain/exposure';
export type { ServerRef } from './domain/registry';
export type { PolicyRow } from './domain/policy';
export { createPolicyStore } from './domain/policy';
export { mergeSchemas, computeStatus } from './collect';
export { setRowFlag, rowDisabledState, removeRow, materializeTargetOf, syncPresetFiles } from './preset';
export { scanWorkspaceMcp } from './project-mcp';
export { installProjectMcp, remountWorkspace, projectServerOwner, projectServerName, findProjectMcpFile } from './project-mcp';
export { readState, writeState } from './state';
export { parsePresetMcpText, firstMatchServerName } from './preset-mcp';
export { describeServer, removeServer, resolveWritableTarget, updateServer } from './domain/mcp-edit';
export { decideExposure, desiredRunning, presetAllows, isExposure } from './domain/exposure';
export declare const name = "mcp-panel";
export declare const inject: string[];
export interface Config {
    /** 保活回收窗口（ms）。默认 30_000。 */
    keepAliveMs?: number;
    /** mcp_search 缺省 top-K。默认 5。 */
    searchLimitDefault?: number;
    /** mcp_search top-K 上限。默认 10。 */
    searchLimitMax?: number;
    /** 能力摘要表（name-only 索引段与 mcp_search 摘要用）。 */
    serverSummary?: Record<string, string>;
    /** 未配置过的 MCP 服务器使用的默认档位。默认 native（DSH 原生行为）。 */
    defaultExposure?: Exposure;
    /** 是否注册中间层工具（mcp_search / mcp_call）。默认 true。 */
    middleLayer?: boolean;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config?: Config): void;
