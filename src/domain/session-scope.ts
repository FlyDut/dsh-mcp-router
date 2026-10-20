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
import type { Context } from '@deepseek-ai/cordis'

/** 从 agent 对象读当前运行的 preset id（无 agent / 服务不可用 → undefined）。 */
export function agentPresetId(ctx: Context, agent: unknown): string | undefined {
  const agentCtx = (agent as { ctx?: Context } | null | undefined)?.ctx
  if (!agentCtx) return undefined
  try {
    const id = ctx.agentPresets.composedPreset(agentCtx)
    return typeof id === 'string' && id.length > 0 ? id : undefined
  } catch {
    return undefined
  }
}

/** 从 agent 对象读会话工作空间 cwd（无 agent → undefined）。 */
export function agentWorkspace(agent: unknown): string | undefined {
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } } | null | undefined)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * 最近一次会话作用域（进程级单例）。
 *
 * 与 `project-mcp.ts` 的 activeWorkspace 同一套路：HTTP 请求路径下 `ctx.agents`
 * 的 roots/list 可能为空（历史实测的服务视图限制），此时面板需要退回到「最近一次
 * 已知会话」的 preset/工作空间来展示生效档位与预设隔离结果，而不是错误地按
 * 「无 preset」判定（那会把 `only` 模式的服务器显示成被隔离）。
 */
let lastPresetId: string | undefined
let lastWorkspace: string | undefined

/** 会话边界记录最近作用域（index.ts 的 agent/created 监听调用）。 */
export function rememberSessionScope(presetId: string | undefined, workspace: string | undefined): void {
  if (presetId !== undefined) lastPresetId = presetId
  if (workspace !== undefined) lastWorkspace = workspace
}

/** 读最近一次会话作用域（面板兜底）。 */
export function lastSessionScope(): { presetId: string | undefined; workspace: string | undefined } {
  return { presetId: lastPresetId, workspace: lastWorkspace }
}

/** Windows 下路径比较忽略大小写（c:\ 与 C:\ 视为同一工作区）。 */
export function sameWorkspace(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
