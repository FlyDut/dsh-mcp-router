/**
 * 面板数据收集：MCP 清单（注册表行 × 策略 × schema 聚合）。
 *
 * 行的来源统一由 `domain/registry.ts` 给出（loader 行 / preset standing 行 / 项目行），
 * 可见性与可用性统一由 `domain/assembly.ts` + `domain/policy.ts` 判定，因此本模块
 * 不再区分「live 行」与「preset 行」两套构建路径。
 * 依赖方向：本模块只被 routes.ts / index.ts 消费。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { McpRow, McpView } from './shared-types';
import type { McpCallController } from './mcpcall';
import type { CatalogRuntime } from './runtime-types';
import type { PolicyStore } from './domain/policy';
import type { Registry } from './domain/registry';
/** 分域缓存 TTL：事件驱动失效为主，TTL 只是兜底（事件丢失场景） */
export declare const DOMAIN_TTL_MS = 60000;
export interface Deps {
    ctx: Context;
    caches: DomainCaches;
    catalogRuntime: CatalogRuntime;
    registry: Registry;
    policy: PolicyStore;
    /** 中间层控制层（访问判定 + AI 启用标记查询/清除）。 */
    controller?: McpCallController;
}
/** 分域缓存句柄：apply 创建，makeRoutes 消费，事件失效由 apply 订阅。 */
export interface DomainCaches {
    mcpCache: Map<string, {
        at: number;
        promise: Promise<McpView>;
    }>;
    /** MCP 工具聚合缓存（per scope），tools/change 时随 mcpCache 一起清 */
    mcpAggregates: Map<object | null, {
        at: number;
        value: McpAggregate;
    }>;
    /** schemas 原始缓存（per scope），路径 A/B 共享同一份深克隆结果 */
    schemasCache: Map<object | null, {
        at: number;
        schemas: Array<{
            name?: unknown;
            description?: unknown;
            parameters?: unknown;
        }>;
    }>;
    invalidateMcp: () => void;
}
export declare function createDomainCaches(): DomainCaches;
/** 写时清理过期条目（P2-8）：分域缓存的 Map 长期运行不膨胀。 */
export declare function pruneExpired<T>(map: Map<T, {
    at: number;
}>, now: number): void;
/**
 * 按 scope 共享的 schemas 原始缓存：路径 A（catalog 采集）与路径 B（面板聚合）
 * 共用同一份深克隆结果，避免 tools.change 风暴期内重复深克隆。
 * key = scopeKey ?? null；TTL 由调用方指定（路径 A 500ms，路径 B 60s）。
 */
export declare function getSchemasView(ctx: Context, caches: DomainCaches, scopeKey: object | undefined, ttlMs: number): Array<{
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
}>;
export declare function resolveAgent(ctx: Context, sessionId: string | undefined): import("@deepseek-ai/dsh-agent").Agent;
export declare function resolveCollectScopeKey(ctx: Context, sessionId: string | undefined): Promise<object | undefined>;
/** scope key 解析来源（/debug scopeDiag 展示用）。 */
export declare function scopeKeySource(): 'agent' | 'standing' | null;
/** 行状态徽标判定（纯函数，selftest 表驱动回归）。
 * 语义：active/idle 以 **liveTools**（真实注册）为准——displayTools 含 catalog 快照
 * 兜底，用它判定 active 会掩盖「scope 解析失败但 catalog 有旧快照」的故障现场。
 */
export declare function computeStatus(disabled: boolean, running: boolean, liveTools: number): McpRow['status'];
/** MCP 工具聚合结果：per-server 工具数 + token 估算。 */
export interface McpAggregate {
    byServer: Map<string, {
        tools: number;
        tokens: number;
    }>;
    mcpToolsTotal: number;
    mcpTokensTotal: number;
}
/**
 * 按 name 去重合并两个 schemas 视图（scoped 优先）。
 *
 * ⚠️ 2026-08-27 实测：`tools.schemas()`（无参全局视图）不含任何 mcp__ 工具（全部
 * 注册在 scope 层）→ 本合并当前恒为 no-op，属防御性合并：若未来出现全局作用域注册
 * 的 mcp 工具，此路径才生效。
 */
export declare function mergeSchemas(scoped: Array<{
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
}>, global: Array<{
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
}>): Array<{
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
}>;
declare function collectMcp(deps: Deps, sessionId: string | undefined): Promise<McpView>;
export { collectMcp };
