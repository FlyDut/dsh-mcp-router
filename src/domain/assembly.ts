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
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { type Exposure, decideExposure } from './exposure'
import type { PolicyStore } from './policy'
import type { Registry, ServerRef } from './registry'
import { agentPresetId, agentWorkspace, sameWorkspace } from './session-scope'
import { serverOfMcp } from '../catalog'

/** name-only 索引段的段名（唯一，避免与其它插件冲突）。 */
export const SERVER_INDEX_SECTION = 'dsh-mcp-router:server-index'
/** 索引段在工具区之后的偏移（`TOOLS_SDK` 顺序号 + 10）。 */
const SERVER_INDEX_ORDER_OFFSET = 10
/** 单个 server 摘要的最大长度（索引段 token 控制）。 */
const SUMMARY_MAX_LEN = 60

/** 一次装配的判定计划。 */
export interface AssemblyPlan {
  presetId: string | undefined
  workspace: string | undefined
  /** serverName → 有效曝光。 */
  byServer: Map<string, Exposure>
  /** 判定为 name-only 的 server（索引段渲染顺序按名字排序）。 */
  nameOnly: string[]
  /** 判定为 hidden 的 server 数量（索引段提示"另有 N 个可检索"）。 */
  hiddenCount: number
}

export interface AssemblyDeps {
  /** host ctx（读 `agentPresets.composedPreset` 用）。 */
  ctxForPreset: Context
  registry: Registry
  policy: PolicyStore
  /** 该 server 当前是否处于 AI 保活窗口（dsh_mcp_call 临时启用中）。 */
  isAiActive: (serverName: string) => boolean
  /** 该 server 的一句话摘要（catalog / config.serverSummary）。 */
  summaryOf: (serverName: string) => string | undefined
}

/** 计算某 server 的有效曝光（先作用域、再档位）。装配层与中间层共用。 */
export function exposureForRef(
  deps: AssemblyDeps,
  ref: ServerRef,
  presetId: string | undefined,
  workspace: string | undefined,
): Exposure {
  // 项目级 MCP：仅所属工作空间的会话可见（硬作用域，先于档位判定）
  if (ref.workspace !== undefined && !sameWorkspace(ref.workspace, workspace)) return 'off'
  const policy = deps.policy.effective(ref.serverName, ref.workspace)
  return decideExposure({
    policy,
    running: ref.running && !ref.disabled,
    aiActive: deps.isAiActive(ref.serverName),
    presetId,
  })
}

/**
 * 构建一次装配的判定计划（同步；装配 waterfall 与 section provider 共用）。
 *
 * @param context - 装配上下文（`agent` 由 dsh-agent 注入到 AssembleContext）。
 */
export function buildAssemblyPlan(deps: AssemblyDeps, context: { agent?: unknown } | undefined): AssemblyPlan {
  const presetId = agentPresetId(deps.ctxForPreset, context?.agent)
  const workspace = agentWorkspace(context?.agent)
  const byServer = new Map<string, Exposure>()
  const nameOnly: string[] = []
  let hiddenCount = 0

  for (const ref of deps.registry.snapshot().all.values()) {
    const effective = exposureForRef(deps, ref, presetId, workspace)
    byServer.set(ref.serverName, effective)
    if (effective === 'name-only') nameOnly.push(ref.serverName)
    else if (effective === 'hidden') hiddenCount += 1
  }
  nameOnly.sort((a, b) => a.localeCompare(b))
  return { presetId, workspace, byServer, nameOnly, hiddenCount }
}

/** 渲染 name-only 的服务器索引段（无内容时返回空串，不贡献 token）。 */
export function renderServerIndex(deps: AssemblyDeps, plan: AssemblyPlan): string {
  if (plan.nameOnly.length === 0 && plan.hiddenCount === 0) return ''
  const lines: string[] = []
  if (plan.nameOnly.length > 0) {
    lines.push('## MCP 服务器（工具未直接注入，按需调用）')
    lines.push('')
    lines.push(
      '下列 MCP 服务器已就绪但未把工具清单注入上下文。用 `dsh_mcp_call`（`server` + `tool` + `arguments`）直接调用；' +
        '不确定工具名时用 `dsh_mcp_search` 传 `server` 查看该服务器的工具清单。',
    )
    lines.push('')
    for (const server of plan.nameOnly) {
      const raw = deps.summaryOf(server)
      const summary = raw && raw.length > 0 ? (raw.length > SUMMARY_MAX_LEN ? `${raw.slice(0, SUMMARY_MAX_LEN)}…` : raw) : ''
      lines.push(summary.length > 0 ? `- ${server}: ${summary}` : `- ${server}`)
    }
  }
  if (plan.hiddenCount > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`另有 ${plan.hiddenCount} 个 MCP 服务器未在此列出，可用 \`dsh_mcp_search\` 以关键词检索。`)
  }
  return lines.join('\n')
}

/**
 * 安装装配层：一个 assemble 监听器 + 一个 name-only 索引段。
 * 返回合并 disposer（插件卸载时全部归还）。
 */
export function installAssembly(ctx: Context, depsRaw: Omit<AssemblyDeps, 'ctxForPreset'>): () => void {
  const deps: AssemblyDeps = { ...depsRaw, ctxForPreset: ctx }
  // 同一次装配内，assemble 监听器与 section provider 都要这份计划：按 agent 单槽缓存
  let lastAgent: unknown
  let lastPlan: AssemblyPlan | undefined
  const planFor = (context: { agent?: unknown } | undefined): AssemblyPlan => {
    const agent = context?.agent
    if (lastPlan !== undefined && agent !== undefined && agent === lastAgent) return lastPlan
    const plan = buildAssemblyPlan(deps, context)
    lastAgent = agent
    lastPlan = plan
    return plan
  }

  const disposers: Array<() => void> = []
  disposers.push(
    ctx.effect(() => {
      const off = ctx.root.on(
        'system-prompt/assemble',
        (
          assembly: PromptAssembly,
          context: unknown,
          next: () => Promise<PromptAssembly>,
        ): Promise<PromptAssembly> => {
          if (!assembly || !Array.isArray(assembly.tools)) return next()
          const plan = planFor(context as { agent?: unknown } | undefined)
          // 计划为空（快照未就绪/无 MCP）：零开销放行，避免误伤
          if (plan.byServer.size === 0) return next()
          assembly.tools = assembly.tools.filter((tool) => {
            const name = String(tool?.name ?? '')
            if (!name.startsWith('mcp__')) return true
            const server = serverOfMcp(name)
            // 畸形工具名保守保留
            if (server === null) return true
            // 未知 server（快照未覆盖）保守保留
            if (plan.byServer.get(server) === undefined) return true
            // 已知 server：一律不注入工具 schema，改由 dsh_mcp_call 按需调用
            return false
          })
          return next()
        },
      )
      return off
    }, 'dsh-mcp-router: assembly filter'),
  )

  disposers.push(
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: SERVER_INDEX_SECTION,
          order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK') + SERVER_INDEX_ORDER_OFFSET,
          text: (context) => renderServerIndex(deps, planFor(context as { agent?: unknown } | undefined)),
        }),
      'dsh-mcp-router: server index section',
    ),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
