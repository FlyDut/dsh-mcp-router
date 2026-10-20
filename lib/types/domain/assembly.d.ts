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
    /**
     * 运行时发现的插件内嵌 MCP server（注册表之外）。
     *
     * 只有 **已就绪** 的才会被纳入过滤（fail-open）：就绪 = catalog 已采集到工具
     * 且执行链可用。未就绪的一律保持「未知 server 放行」，避免出现「过滤了但调不到」
     * 的黑洞。返回空表即关闭接管（adoptRuntimeServers=false）。
     */
    runtimeServers?: () => ReadonlyMap<string, {
        tools: number;
    }>;
    /** 运行时 server 是否已就绪（catalog 有非空工具快照）。缺省视为未就绪（放行）。 */
    isRuntimeReady?: (serverName: string) => boolean;
    /** 运行时 server 的档位（策略层给出；面板只开放「进程常驻 / 隐藏」）。缺省按进程常驻。 */
    runtimeExposureOf?: (serverName: string) => Exposure;
    /**
     * 该 server 是否已有工具目录（catalog 非空）。
     *
     * 只用于「另有 N 个未列出」的计数口径：索引段承诺了「可用 dsh_mcp_search 检索」，
     * 所以 N 必须是**真能检索到**的 hidden 服务器数，而不是配置行数（未安装/未运行的
     * 服务器搜出来是空的）。缺省时退回旧口径（按配置行数），保持向后兼容。
     */
    hasTools?: (serverName: string) => boolean;
    /** 每次构建装配计划后的观察回调（诊断用：把 nameOnly/byServer 暴露到 /debug）。 */
    onPlan?: (plan: AssemblyPlan) => void;
}
/**
 * 「另有 N 个未列出」的计数口径（纯函数，selftest 覆盖）。
 *
 * 索引段承诺了「可用 dsh_mcp_search 检索」，所以只数**确实有工具目录**的 hidden
 * 服务器；未安装 / 未运行 / 采集为空的配置行不算，否则提示的数字会远大于实际可搜到的。
 *
 * @param hiddenNames - 档位为 hidden 的 server 名。
 * @param hasTools - 工具目录判定；缺省（undefined）时保持旧口径 = 全部计数。
 * @returns 可检索的 hidden server 数。
 */
export declare function countSearchableHidden(hiddenNames: readonly string[], hasTools: ((serverName: string) => boolean) | undefined): number;
/**
 * 把已就绪的运行时 server 合并进装配计划（纯函数，selftest 覆盖）。
 *
 * 规则：
 * - 注册表已声明的 server 优先，不重复处理；
 * - 未就绪（catalog 没采到 / 工具数为 0）→ 跳过 = 保持放行；
 * - 就绪 → 记 `name-only`，装配层据此过滤工具，模型改走 dsh_mcp_search / dsh_mcp_call。
 *
 * @param byServer - 装配计划的 server → 有效曝光映射（原地修改）。
 * @param nameOnly - 进程常驻索引段的 server 列表（原地追加）。
 * @param runtime - 运行时发现的 server 及工具数。
 * @param isReady - 就绪判定（由上层提供，缺省视为未就绪）。
 */
export declare function mergeRuntimeIntoPlan(byServer: Map<string, Exposure>, nameOnly: string[], runtime: ReadonlyMap<string, {
    tools: number;
}>, isReady: ((serverName: string) => boolean) | undefined, exposureOf?: (serverName: string) => Exposure): void;
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
