/**
 * 装配层 —— 插件对模型上下文的**唯一**注入点。
 *
 * 合并了旧实现里三个各自监听 `system-prompt/assemble` 的过滤器（MCP 可见性 /
 * 工具级禁用 / 项目工作区作用域），语义收敛为一次判定：
 *
 * ```
 * 有效曝光 = decideExposure({ policy.effective, running, aiActive, presetId })
 *            （项目级 MCP 额外要求会话工作空间匹配）
 * ```
 *
 * - `name-only` → 工具全部过滤，server 名与摘要进入「服务器索引段」
 * - `hidden`    → 工具过滤，索引段不出现（仅 dsh_mcp_search 可检索、dsh_mcp_call 可调用）
 * - `off`       → 工具过滤，索引段不出现，dsh_mcp_call 拒绝
 *
 * 本插件不注入任何 MCP 工具 schema：`mcp__*` 工具对**已知 server 一律过滤**，模型一律经
 * dsh_mcp_search / dsh_mcp_call 按需调用（工具级禁用由调用路径强制，见 mcpcall）。
 * 未知 server（快照尚未覆盖）与畸形工具名保守保留，绝不误伤。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Exposure } from './exposure';
import type { PolicyStore } from './policy';
import type { Registry, ServerRef } from './registry';
/** name-only 索引段的段名（唯一，避免与其它插件冲突）。 */
export declare const SERVER_INDEX_SECTION = "dsh-mcp-router:server-index";
/** 一次装配的判定计划。 */
export interface AssemblyPlan {
    presetId: string | undefined;
    workspace: string | undefined;
    /** serverName → 有效曝光。 */
    byServer: Map<string, Exposure>;
    /** 判定为 name-only 的 server（索引段渲染顺序按名字排序）。 */
    nameOnly: string[];
    /** 判定为 hidden 的 server 数量（索引段提示"另有 N 个可检索"）。 */
    hiddenCount: number;
}
export interface AssemblyDeps {
    /** host ctx（读 `agentPresets.composedPreset` 用）。 */
    ctxForPreset: Context;
    registry: Registry;
    policy: PolicyStore;
    /** 该 server 当前是否处于 AI 保活窗口（dsh_mcp_call 临时启用中）。 */
    isAiActive: (serverName: string) => boolean;
    /** 该 server 的一句话摘要（catalog / config.serverSummary）。 */
    summaryOf: (serverName: string) => string | undefined;
}
/** 计算某 server 的有效曝光（先作用域、再档位）。装配层与中间层共用。 */
export declare function exposureForRef(deps: AssemblyDeps, ref: ServerRef, presetId: string | undefined, workspace: string | undefined): Exposure;
/**
 * 构建一次装配的判定计划（同步；装配 waterfall 与 section provider 共用）。
 *
 * @param context - 装配上下文（`agent` 由 dsh-agent 注入到 AssembleContext）。
 */
export declare function buildAssemblyPlan(deps: AssemblyDeps, context: {
    agent?: unknown;
} | undefined): AssemblyPlan;
/** 渲染 name-only 的服务器索引段（无内容时返回空串，不贡献 token）。 */
export declare function renderServerIndex(deps: AssemblyDeps, plan: AssemblyPlan): string;
/**
 * 安装装配层：一个 assemble 监听器 + 一个 name-only 索引段。
 * 返回合并 disposer（插件卸载时全部归还）。
 */
export declare function installAssembly(ctx: Context, depsRaw: Omit<AssemblyDeps, 'ctxForPreset'>): () => void;
