import type { Context } from '@deepseek-ai/cordis';
import { type McpServerConfig } from '../mcp-convert';
import type { PolicyStore } from './policy';
import type { Registry, ServerRef } from './registry';
/** 可写目标：把一行映射到「写哪个文件的哪个键/行」。 */
export type WritableTarget = {
    kind: 'patch';
    file: string;
    rowId: string;
} | {
    kind: 'project';
    file: string;
    key: string;
    workspace: string;
    rowId: string;
} | {
    kind: 'readonly';
    reason: 'preset';
    file: string;
};
export interface EditDeps {
    ctx: Context;
    registry: Registry;
    policy: PolicyStore;
}
/** 编辑用的配置补丁（面板表单字段；未提供的字段保持原值）。 */
export interface ServerConfigPatch {
    serverName?: string;
    transport?: McpServerConfig['transport'];
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    toolCallTimeoutMs?: number;
}
/** 解析某行的可写目标（预设行返回 readonly，附来源文件供面板提示）。 */
export declare function resolveWritableTarget(deps: EditDeps, ref: ServerRef): Promise<WritableTarget>;
/** 合并补丁与原配置（未提供的字段保持原值；数组/字典整体替换）。 */
export declare function mergeConfig(base: ServerConfigPatch, patch: ServerConfigPatch): ServerConfigPatch;
/** 回显脱敏哨兵：env/headers 的**键名保留**，值替换为它（整表单回写时视为「保留原值」）。 */
export declare const MASKED_VALUE = "***MASKED***";
/**
 * 回显脱敏（`GET /mcp/detail`、`POST /mcp/scan` 回传的 config 用）。
 *
 * 2026-09-23（移植上游 0b16e6f）：只读端点不该把求值后的 env/headers 真值吐出来。
 * 面板「读回显 → 整表单回写」的编辑路径依赖 {@link unmaskEcho} 把哨兵还原，
 * **两者必须成对上线**，否则会把哨兵当真值写进配置文件。
 */
export declare function maskConfigSecrets(config: ServerConfigPatch): ServerConfigPatch;
/**
 * 写侧：哨兵值即「保留原值」。
 *
 * 有 live 真值 → 恢复；live 里本就没有该键 → 丢弃（不凭空造键）。真实轮换/新增的值
 * 原样接受，用户删掉的键也不会被恢复。
 */
export declare function unmaskEcho(patch: ServerConfigPatch, live: ServerConfigPatch): ServerConfigPatch;
/** 把补丁转成 dsh-mcp-client 的 config 形状（丢掉与当前 transport 无关的字段）。 */
export declare function toClientConfig(patch: ServerConfigPatch): Record<string, unknown>;
export interface UpdateResult {
    serverName: string;
    /** 改名后的新 serverName（未改名时与入参相同）。 */
    renamedTo?: string;
    file: string;
    /** 运行时是否已同步（false = 需重启或由 live patch reload 接管）。 */
    applied: boolean;
}
/**
 * 编辑一个 MCP 服务器。
 *
 * @throws 目标只读 / 行不在文件里 / 名字冲突或非法 —— 都带明确中文原因，端点直接透传。
 */
export declare function updateServer(deps: EditDeps, input: {
    serverName: string;
    workspace?: string;
    patch: ServerConfigPatch;
}): Promise<UpdateResult>;
export interface RemoveResult {
    serverName: string;
    file: string;
    /** 是否已从 loader 卸载（false = 行不在 loader 中，属正常情况）。 */
    unloaded: boolean;
}
/**
 * 删除一个 MCP 服务器：写文件 → 卸载 loader 行 → 清理策略。预设组合行一律拒绝。
 *
 * @throws 目标只读 / 文件里找不到该行（都不做部分修改）。
 */
export declare function removeServer(deps: EditDeps, input: {
    serverName: string;
    workspace?: string;
}): Promise<RemoveResult>;
/** 供端点复用的「编辑初值」：把一行还原为面板表单需要的字段。 */
export interface ServerDetail {
    serverName: string;
    target: WritableTarget;
    config: ServerConfigPatch;
    /** config 顶层键：`dynamic` 的键在面板上只读、写回时原样保留。 */
    keys: Array<{
        name: string;
        dynamic: boolean;
    }>;
    /** 只读目标的原因说明（面板直接展示）。 */
    readonly?: string;
}
export declare function describeServer(deps: EditDeps, input: {
    serverName: string;
    workspace?: string;
}): Promise<ServerDetail>;
/** 供 server-card 展示「是否可写」用（避免前端重复实现来源判定）。 */
export declare function isWritableRef(ref: ServerRef): boolean;
/** 项目文件与 patch 文件同名键的展示辅助（诊断/日志）。 */
export declare function targetLabel(target: WritableTarget): string;
