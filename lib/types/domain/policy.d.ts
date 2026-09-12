import type { Context } from '@deepseek-ai/cordis';
import { type Exposure, type ServerPolicy } from './exposure';
import type { ServerPolicyState } from '../state';
/** 一次生效集合变化。 */
export interface PolicyChange {
    serverName: string;
    workspace?: string;
    policy: ServerPolicy;
    previous: ServerPolicy | undefined;
} /** 面板/诊断用的策略行。 */
export interface PolicyRow {
    serverName: string;
    workspace?: string;
    /** 用户意图。 */
    policy: ServerPolicy;
    /** 当前生效。 */
    effective: ServerPolicy;
    /** 意图与生效不一致（待生效）。 */
    pending: boolean;
    /** 是否由用户显式配置过（false = 使用默认策略）。 */
    configured: boolean;
}
export interface PolicyStoreOptions {
    ctx: Context;
    /** 未配置过的 server 使用的默认档位（Config.defaultExposure）。 */
    fallbackExposure?: Exposure;
    /** 生效集合变化后的回调（调整 loader 进程状态等）。 */
    onEffectiveChanged?: (changes: PolicyChange[]) => Promise<void> | void;
}
export interface PolicyStore {
    /** 启动加载 + v1 迁移（幂等；apply 早期调用一次）。 */
    load(): Promise<void>;
    /** 同步读生效策略。 */
    effective(serverName: string, workspace?: string): ServerPolicy;
    /** 同步读用户意图（未配置返回 undefined）。 */
    intent(serverName: string, workspace?: string): ServerPolicyState | undefined;
    /** 是否处于待生效（仅 next-session 模式可能出现）。 */
    isPending(serverName: string, workspace?: string): boolean;
    /** 全部已配置策略行。 */
    list(): PolicyRow[];
    /** 写入策略（合并 patch）；`applyMode` 决定是否立即提升为生效。 */
    set(input: {
        serverName: string;
        workspace?: string;
        patch: Partial<ServerPolicy>;
        applyMode: 'immediate' | 'next-session';
        /** 显式覆盖 `applied` 账本（物化链路用）。 */
        applied?: boolean | null;
    }): Promise<{
        applied: boolean;
        policy: ServerPolicyState;
    }>;
    /** 把全部待生效意图提升为生效；返回提升条数。 */
    commitPending(): Promise<number>;
    /** 以「预设文件现状」对齐一个从未配置过的 server（首次物化用）。 */
    adoptFromFile(serverName: string, workspace: string | undefined, fileDisabled: boolean | null): Promise<ServerPolicyState | undefined>;
    /** 记录某 server 的物化账本（写盘）。 */
    markApplied(serverName: string, workspace: string | undefined, applied: boolean | null): Promise<void>;
    /** 诊断信息。 */
    diagnostics(): {
        loaded: boolean;
        version: number | null;
        configured: number;
        migrated: number | null;
        unresolved: string[];
        lastError: string | null;
    };
}
export declare function createPolicyStore(options: PolicyStoreOptions): PolicyStore;
