/**
 * MCP 服务器注册表 —— 三种来源归一为同一份 `ServerRef` 视图。
 *
 * 来源（dsh 0.1.2-rc.1 实测）：
 * 1. **loader 行**：`ctx.loader.entries()` 里 `@deepseek-ai/dsh-mcp-client` 行（含
 *    profile patch 层行与项目级 `projmcp-*` 行）。同步可得，是最实时的运行状态来源。
 * 2. **preset standing 行**：rc.1 起预设组合的行挂在 agent scope 树，不再进
 *    `ctx.loader.entries()`，只能经 `ctx.agentPresets.compositionInventory()` +
 *    `presets.read(id)` 异步读取（见 preset-mcp.ts）。按 presetId 分桶保存。
 * 3. **项目级行**：由 project-mcp.ts 扫描 `<workspace>/.dsh/mcps` 挂载，在 loader 行
 *    里以 `projmcp-*` id 出现，owner 工作空间由 project-mcp 的内存表给出。
 *
 * 装配层与 mcp_call 都在**同步**路径上工作（`system-prompt/assemble` 的 waterfall
 * 与 section provider 不能 await），因此本模块维护一份同步内存快照：
 * `refresh()` 异步重建，`snapshot()/refFor()` 同步读。快照尚未就绪时调用方保守放行
 * （保留工具），绝不因采不到而误伤。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 一行 MCP 的来源。 */
export type ServerSource = 'loader' | 'preset' | 'project';
/** 归一的 MCP 服务器引用：装配、面板、控制层共用的最小事实集。 */
export interface ServerRef {
    serverName: string;
    entryId: string;
    /** 组合文件内的短行 id（state/物化用；预设行为 rowId，其余同 entryId 末段）。 */
    rowId: string;
    source: ServerSource;
    /** loader entry 当前是否被停用（preset 行取 inventory 的 enabled 取反）。 */
    disabled: boolean;
    /** 进程是否在跑（loader: fiber 存在；preset: inventory 带 fiberState）。 */
    running: boolean;
    transport: string | null;
    toolCallTimeoutMs?: number;
    /** 项目级 MCP 所属工作空间（source === 'project'）。 */
    workspace?: string;
    /** 该行所在的组合文件路径（loader 行取 tree.filename，preset 行取 preset 文件；供启动期物化）。 */
    file?: string;
    /** 该行所属预设 id（source === 'preset'）。 */
    presetId?: string;
}
/** 注册表快照（不可变视图）。 */
export interface RegistrySnapshot {
    /** serverName → ref（loader/项目行优先；面板与兜底查询用）。 */
    all: ReadonlyMap<string, ServerRef>;
    /** presetId → serverName → ref（预设行的精确视图，装配按当前会话 preset 取）。 */
    byPreset: ReadonlyMap<string, ReadonlyMap<string, ServerRef>>;
    /** 快照生成时间（诊断用）。 */
    at: number;
}
export interface RegistryDiagnostics {
    refreshes: number;
    lastAt: number | null;
    lastError: string | null;
    loaderRows: number;
    presetRows: number;
    presets: number;
}
export interface Registry {
    /** 同步读当前快照（永不 throw）。 */
    snapshot(): RegistrySnapshot;
    /**
     * 查询某 server 对给定会话的引用：优先该会话 preset 的 standing 行，
     * 无则回落合并视图（loader/项目行）。
     */
    refFor(serverName: string, presetId: string | null | undefined): ServerRef | undefined;
    /** 异步重建快照（幂等、可并发调用；内部去抖）。 */
    refresh(): Promise<void>;
    /** 立即重建（跳过去抖；诊断端点用）。 */
    refreshNow(): Promise<void>;
    /** 诊断信息。 */
    diagnostics(): RegistryDiagnostics;
    /** 绑定失效事件（tools/change、loader 生命周期、会话边界）；返回 disposer。 */
    install(): () => void;
}
/**
 * 创建注册表。
 *
 * @param ctx - 插件 apply 的 host ctx（用于 loader/preset 读取与事件订阅）。
 * @param onRefreshed - 快照更新后的回调（面板缓存失效等）。
 */
export declare function createRegistry(ctx: Context, onRefreshed?: () => void): Registry;
