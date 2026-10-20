/**
 * 会话作用域读取 —— 从 Agent 对象取出「本次请求属于哪个会话作用域」。
 *
 * 两个事实被装配层与中间层共用：
 * - **agent 预设 id**：`ctx.agentPresets.composedPreset(agent.ctx)`。子代理经
 *   `composeFrom` 继承父代理的 standing 组合，因此父子天然同 id。
 * - **会话工作空间**：`agent.session.header.cwd`（项目级 MCP 的作用域判定）。
 *
 * 全部读取都做防御式包装：诊断路径（无 agent）或服务视图受限时返回 undefined，
 * 调用方按「无作用域」语义处理（见 `domain/exposure.ts` 的 presetAllows 注释）。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 从 agent 对象读当前运行的 preset id（无 agent / 服务不可用 → undefined）。 */
export declare function agentPresetId(ctx: Context, agent: unknown): string | undefined;
/** 从 agent 对象读会话工作空间 cwd（无 agent → undefined）。 */
export declare function agentWorkspace(agent: unknown): string | undefined;
/** 会话边界记录最近作用域（index.ts 的 agent/created 监听调用）。 */
export declare function rememberSessionScope(presetId: string | undefined, workspace: string | undefined): void;
/** 读最近一次会话作用域（面板兜底）。 */
export declare function lastSessionScope(): {
    presetId: string | undefined;
    workspace: string | undefined;
};
/** Windows 下路径比较忽略大小写（c:\ 与 C:\ 视为同一工作区）。 */
export declare function sameWorkspace(a: string | undefined, b: string | undefined): boolean;
