/**
 * MCP 曝光档位（Exposure）与预设关联（PresetScope）—— 领域纯逻辑层。
 *
 * 本模块是整个插件唯一一处「一个 MCP 服务器对模型曝光多少」的语义定义：
 * 档位判定、预设隔离判定、v1→v2 策略迁移都收敛在这里，且**不依赖 Cordis 运行时**
 * （零 import），因此可被 scripts/selftest-exposure.mjs 直接以构建产物覆盖。
 *
 * ── 四档语义（每 server 一个档位，同时决定进程期望状态）──────────────────
 *
 * | exposure    | 进程            | 上下文注入              | dsh_mcp_search            | dsh_mcp_call |
 * |-------------|-----------------|-------------------------|-----------------------|----------|
 * | `native`    | 运行            | 全部 mcp__<s>__* schema | 摘要表列出（已注入）   | 可调用   |
 * | `name-only` | 运行            | 无工具，仅 server 名索引 | 摘要表列出            | 可调用   |
 * | `hidden`    | 停用（按需保活） | 无                      | 仅关键词命中返回       | 可调用   |
 * | `off`       | 停用            | 无                      | 完全不出现            | 拒绝     |
 *
 * `native` / `name-only` 期望进程运行；`hidden` / `off` 期望进程停用（由
 * {@link desiredRunning} 派生，用户切档位即隐式启停）。`hidden` 的 server 仍可被
 * 模型经 `dsh_mcp_call` 保活启用（临时运行 → 调用 → 空闲回收），这正是「完全被中间层
 * 托管」的语义；`off` 连这条路径也关掉。
 *
 * ── 预设关联（运行时隔离，不改变物理状态）──────────────────────────────
 *
 * `presets.mode`：`all`（默认，全部预设可用）/ `only`（仅列出预设可用）/
 * `except`（除列出预设外可用）。会话无 preset（rosterless 部署）时：`all` 与
 * `except` 视为可用，`only` 视为不可用。
 */
/** 曝光档位。 */
export type Exposure = 'native' | 'name-only' | 'hidden' | 'off';
/** 预设关联模式。 */
export type PresetMode = 'all' | 'only' | 'except';
/** 预设关联：模式 + 预设 id 列表（`all` 时列表为空）。 */
export interface PresetScope {
    mode: PresetMode;
    ids: string[];
}
/** 一个 MCP 服务器的完整策略（用户意图）。 */
export interface ServerPolicy {
    exposure: Exposure;
    presets: PresetScope;
    /** 被禁用的工具注册全名（`mcp__<server>__<tool>`）。 */
    disabledTools: string[];
}
/** 全部档位（面板渲染顺序：从最曝光到最封闭）。 */
export declare const EXPOSURE_VALUES: readonly Exposure[];
/** 全部预设模式。 */
export declare const PRESET_MODES: readonly PresetMode[];
/** 档位是否为合法值。 */
export declare function isExposure(value: unknown): value is Exposure;
/** 预设模式是否为合法值。 */
export declare function isPresetMode(value: unknown): value is PresetMode;
/** 构造默认策略（未配置过的 server 默认全部 = DSH 原本行为）。 */
export declare function defaultPolicy(exposure?: Exposure): ServerPolicy;
/** 宽容解析预设关联（非法输入回落 `all`）。 */
export declare function normalizePresetScope(raw: unknown): PresetScope;
/** 宽容解析完整策略（缺字段/非法值回落默认；`fallbackExposure` 供 Config 默认档位注入）。 */
export declare function normalizePolicy(raw: unknown, fallbackExposure?: Exposure): ServerPolicy;
/**
 * 该 server 是否对给定 agent 预设开放（运行时隔离的唯一判定点）。
 *
 * @param scope - 用户配置的预设关联。
 * @param presetId - 当前会话运行的 agent 预设 id；`undefined`/`null` 表示该会话没有
 *   preset（rosterless 部署）。
 */
export declare function presetAllows(scope: PresetScope, presetId: string | null | undefined): boolean;
/** 该档位是否期望 loader entry 运行（用户切档位即隐式启停进程）。 */
export declare function desiredRunning(exposure: Exposure): boolean;
/** 判定输入的运行时现场。 */
export interface ExposureInput {
    policy: ServerPolicy;
    /** loader entry 当前是否在运行（!disabled）。 */
    running: boolean;
    /** 该 server 当前是否处于 AI 保活窗口（dsh_mcp_call 临时启用中）。 */
    aiActive: boolean;
    /** 当前会话的 agent 预设 id（undefined = 无 preset）。 */
    presetId: string | null | undefined;
}
/**
 * 有效曝光判定 —— 装配层、`dsh_mcp_search`、`dsh_mcp_call`、面板徽标共用这一个函数。
 *
 * 判定顺序（先隔离、再档位、最后运行态降级）：
 * 1. 预设不允许 → `off`（运行时隔离，物理状态不变）；
 * 2. `off` / `hidden` 档 → 原样返回；
 * 3. `native` / `name-only` 档：进程在跑且非 AI 保活窗口 → 原档；否则降级为
 *    `hidden`（进程未跑或正被中间层托管：工具不注入，但仍可经 dsh_mcp_call 调用，
 *    不静默丢失能力）。
 */
export declare function decideExposure(input: ExposureInput): Exposure;
/** 不可用（`off`）的成因。 */
export type BlockedReason = 'preset' | 'exposure' | 'workspace';
/**
 * 判定「不可用」的成因（错误文案与面板徽标用）。
 *
 * @param workspaceMismatch - 项目级 MCP 的所属工作空间与会话工作空间不一致（硬作用域）。
 */
export declare function offReason(policy: ServerPolicy, presetId: string | null | undefined, workspaceMismatch?: boolean): BlockedReason;
/** 有效曝光对模型的意义：注入工具 / 仅暴露名称 / 完全不暴露。 */
export type Injection = 'tools' | 'name' | 'none';
/** 由有效曝光映射到注入形态。 */
export declare function injectionOf(effective: Exposure): Injection;
/** 该有效曝光下该 server 的工具是否进入模型目录。 */
export declare function injectsTools(effective: Exposure): boolean;
/** 该有效曝光下模型是否可经 dsh_mcp_call 调用该 server（`off` 拒绝）。 */
export declare function callableUnder(effective: Exposure): boolean;
/** 该有效曝光下该 server 是否出现在 dsh_mcp_search 的无参摘要表。 */
export declare function listedInSummary(effective: Exposure): boolean;
/** 工具注册全名是否被策略禁用（工具级禁用，native 档下同样生效）。 */
export declare function policyDisablesTool(policy: ServerPolicy | undefined, fullName: string): boolean;
/**
 * 工具级**批量**启停的目标解析（三态契约，纯函数；移植上游 PR#17 特性 1 的 BLOCK-1 修法）。
 *
 * 契约故意严格 —— 面板「按当前过滤批量操作」在过滤命中 0 项时天然会发 `[]`，
 * 若把它当成「全部」，对一个 450 工具的 server 就是一次性全量禁用**并已写盘**，
 * 与用户意图完全相反：
 * - `toolNames === undefined`（字段缺失）= 全部已知工具，**只有这一种**表示全部；
 * - 显式数组 = 精确集合（`[]` 是合法空操作）；
 * - 非数组 / 含非字符串项 / 非空却一条都不匹配 = 返回 error（调用方 400），
 *   既不静默降级为「全部」，也不静默 no-op。
 */
export declare function resolveToolBulkTargets(raw: unknown, known: readonly string[]): {
    targets: string[];
    ignored: string[];
    error?: string;
};
/** state.json v1 中与策略相关的字段（迁移读取用）。 */
export interface V1PolicySource {
    mcp?: Record<string, Record<string, {
        desired?: unknown;
    } | undefined> | undefined>;
    projectMcp?: Record<string, Record<string, unknown> | undefined>;
    toolDisabled?: Record<string, unknown>;
    projectToolDisabled?: Record<string, Record<string, unknown> | undefined>;
}
/** 迁移结果。 */
export interface MigrationResult {
    /** 全局 serverName → 策略。 */
    servers: Record<string, ServerPolicy>;
    /** 工作空间 → serverName → 策略。 */
    projects: Record<string, Record<string, ServerPolicy>>;
    /** 迁移的条目数（写回判定用）。 */
    migrated: number;
    /** 解析不到 serverName 的旧行（file:rowId），调用方负责告警，绝不静默丢弃。 */
    unresolved: string[];
}
/**
 * v1 策略 → v2 策略（纯函数，可单测）。
 *
 * 映射规则：
 * - `mcp[file][rowId].desired === true`（用户停用）→ `hidden`（旧 autoManage 开启，
 *   停用的 MCP 由中间层按需调用）或 `off`（旧 autoManage 关闭，停用即完全不可用）；
 *   `desired === false`（用户启用）→ `native`。
 * - `projectMcp[workspace][serverName]` 同理（boolean 值即 desired disabled）。
 * - `toolDisabled[serverName]` / `projectToolDisabled[workspace][serverName]` →
 *   对应策略的 `disabledTools`。
 *
 * @param source - v1 状态字段。
 * @param resolveServerName - 把旧行的 (preset 文件, rowId) 解析为 serverName；
 *   返回 undefined 的行走 `unresolved`。
 * @param autoManage - 旧全局中间层开关（决定停用态迁移为 hidden 还是 off）。
 */
export declare function migrateV1Policies(source: V1PolicySource, resolveServerName: (file: string, rowId: string) => string | undefined, autoManage: boolean): MigrationResult;
/** v1 状态里是否存在与策略相关的数据（决定是否需要迁移）。 */
export declare function hasV1PolicyData(source: V1PolicySource): boolean;
/** 一个 server 在组合文件与策略账本之间应当执行的同步动作。 */
export type SyncAction = 
/** 文件里没有该行：放弃管理（行已被用户删除）。 */
'skip-missing'
/** 策略表里没有该 server：按文件现状建档（首次采用，不写文件）。 */
 | 'adopt'
/** 文件被外部改过（现状 ≠ 上次账本）：只对齐账本，不覆盖文件。 */
 | 'align-ledger'
/** 期望状态与文件一致：无需动作。 */
 | 'noop'
/** 需要写文件：把 disabled 置为期望值。 */
 | 'materialize';
/**
 * 判定物化动作（启动早期 `syncPresetFiles` 的唯一决策点，纯函数便于单测）。
 *
 * @param input.cur - 组合文件里该行当前的 `disabled`（`null` = 无标记；文件里没有该行请先判 skip）。
 * @param input.applied - 上次物化账本（`undefined` = 从未物化过）。
 * @param input.wantDisabled - 期望的 disabled（由 exposure 的 desiredRunning 派生）。
 * @param input.configured - 策略表里是否已有该 server 的意图（false = 首次遇到）。
 */
export declare function decideSyncAction(input: {
    cur: boolean | null;
    applied: boolean | null | undefined;
    wantDisabled: boolean;
    configured: boolean;
}): SyncAction;
