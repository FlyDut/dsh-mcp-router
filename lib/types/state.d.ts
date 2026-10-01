import type { ServerPolicy } from './domain/exposure';
/** 当前状态文件版本。 */
export declare const STATE_VERSION = 2;
/** 每个预设文件（key=文件绝对路径）→ 每个 mcp 行 → 意图与上次物化状态（v1，仅迁移读）。 */
export interface McpRowState {
    /** toggle 时用户意图：是否停用 */
    desired: boolean;
    /** toggle 时该行在文件中的实际状态（true/false/null=无 disabled 键） */
    lastApplied: boolean | null;
}
/**
 * 一个 server 的持久化策略：领域策略（`domain/exposure.ts` 的 ServerPolicy）
 * + 物化账本 `applied`（上次写入预设文件的 disabled 状态，用于识别外部修改）。
 */
export interface ServerPolicyState extends ServerPolicy {
    /**
     * 上次物化到预设组合文件的 `disabled` 状态（`null` = 文件中无 `disabled` 键）。
     * `undefined` = 从未物化；读到与文件现状不一致 = 文件被外部改过，尊重现状不覆盖。
     */
    applied?: boolean | null;
}
export type StateFile = {
    /** 状态结构版本；缺失/小于 2 表示需要 v1 迁移。 */
    version?: number;
    /** v2：全局 serverName → 策略。 */
    servers?: Record<string, ServerPolicyState>;
    /** v2：工作空间 → serverName → 策略（项目级 MCP）。 */
    projects?: Record<string, Record<string, ServerPolicyState>>;
    /** AI 自动启用标记（dsh_mcp_call 保活启用）：entryId → 上次启用时间。 */
    ai?: Record<string, {
        at: number;
    }>;
    /** 面板可写的插件配置（生效时机），优先于 cordis config。 */
    config?: {
        applyMode?: ApplyMode;
        /** v1 遗留：全局 AI 中间层开关（迁移后并入各 server 的 exposure 并删除）。 */
        autoManage?: boolean;
    };
    /** v1：预设文件 → rowId → 启停意图。 */
    mcp?: Record<string, Record<string, McpRowState>>;
    /** v1：项目级 MCP 启停意图（工作空间 → serverName → 是否停用）。 */
    projectMcp?: Record<string, Record<string, boolean>>;
    /** v1：全局 MCP 工具级禁用（serverName → 禁用的工具全名）。 */
    toolDisabled?: Record<string, string[]>;
    /** v1：项目级 MCP 工具禁用（工作空间 → serverName → 禁用工具全名）。 */
    projectToolDisabled?: Record<string, Record<string, string[]>>;
};
/** 生效时机：immediate=立即（默认，下轮生效）；next-session=记意图、新会话/重启生效。 */
export type ApplyMode = 'immediate' | 'next-session';
/** 当前生效时机（缺省 immediate）。 */
export declare function stateApplyMode(state: StateFile): ApplyMode;
export declare function readState(): Promise<StateFile>;
export declare function writeState(state: StateFile): Promise<void>;
/** 状态文件路径（诊断端点与迁移备份用）。 */
export declare function stateFilePath(): string;
/** 状态文件所在目录（catalog.json 同目录）。 */
export declare function stateDir(): string;
/** AI-owner 标记读写：state.json 的 ai 段（entryId → {at}）。 */
export declare function setStateAiOwner(entryId: string, at: number): Promise<void>;
export declare function clearStateAiOwner(entryId: string): Promise<void>;
