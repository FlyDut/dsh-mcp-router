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
  /**
   * 运行时发现的插件内嵌 MCP server（注册表之外）。
   *
   * 只有 **已就绪** 的才会被纳入过滤（fail-open）：就绪 = catalog 已采集到工具
   * 且执行链可用。未就绪的一律保持「未知 server 放行」，避免出现「过滤了但调不到」
   * 的黑洞。返回空表即关闭接管（adoptRuntimeServers=false）。
   */
  runtimeServers?: () => ReadonlyMap<string, { tools: number }>
  /** 运行时 server 是否已就绪（catalog 有非空工具快照）。缺省视为未就绪（放行）。 */
  isRuntimeReady?: (serverName: string) => boolean
  /** 运行时 server 的档位（策略层给出；面板只开放「提示词注入 / 隐藏」）。缺省按提示词注入。 */
  runtimeExposureOf?: (serverName: string) => Exposure
  /**
   * 该 server 是否已有工具目录（catalog 非空）。
   *
   * 只用于「另有 N 个未列出」的计数口径：索引段承诺了「可用 dsh_mcp_search 检索」，
   * 所以 N 必须是**真能检索到**的 hidden 服务器数，而不是配置行数（未安装/未运行的
   * 服务器搜出来是空的）。缺省时退回旧口径（按配置行数），保持向后兼容。
   */
  hasTools?: (serverName: string) => boolean
  /** 每次构建装配计划后的观察回调（诊断用：把 nameOnly/byServer 暴露到 /debug）。 */
  onPlan?: (plan: AssemblyPlan) => void
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
export function countSearchableHidden(
  hiddenNames: readonly string[],
  hasTools: ((serverName: string) => boolean) | undefined,
): number {
  if (hasTools === undefined) return hiddenNames.length
  let count = 0
  for (const serverName of hiddenNames) {
    if (hasTools(serverName)) count += 1
  }
  return count
}

/**
 * 把已就绪的运行时 server 合并进装配计划（纯函数，selftest 覆盖）。
 *
 * 规则：
 * - 注册表已声明的 server 优先，不重复处理；
 * - 未就绪（catalog 没采到 / 工具数为 0）→ 跳过 = 保持放行；
 * - 就绪 → 记 `name-only`，装配层据此过滤工具，模型改走 dsh_mcp_search / dsh_mcp_call。
 *
 * @param byServer - 装配计划的 server → 有效曝光映射（原地修改）。
 * @param nameOnly - 提示词注入索引段的 server 列表（原地追加）。
 * @param runtime - 运行时发现的 server 及工具数。
 * @param isReady - 就绪判定（由上层提供，缺省视为未就绪）。
 */
export function mergeRuntimeIntoPlan(
  byServer: Map<string, Exposure>,
  nameOnly: string[],
  runtime: ReadonlyMap<string, { tools: number }>,
  isReady: ((serverName: string) => boolean) | undefined,
  exposureOf?: (serverName: string) => Exposure,
): void {
  for (const [serverName, info] of runtime) {
    if (byServer.has(serverName)) continue
    if (info.tools <= 0) continue
    if (isReady === undefined || !isReady(serverName)) continue
    // 档位来自策略层（面板可切「提示词注入 / 隐藏」）；缺省按提示词注入。
    // `off` 对运行时来源没有意义（插件进程关不掉，设 off 只会变成黑洞），防御性忽略。
    const exposure = exposureOf?.(serverName) ?? 'name-only'
    if (exposure === 'off') continue
    byServer.set(serverName, exposure)
    // 提示词注入进索引段；隐藏照样过滤工具，只是不列出名字。
    if (exposure === 'name-only') nameOnly.push(serverName)
  }
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
  const hidden: string[] = []

  for (const ref of deps.registry.snapshot().all.values()) {
    const effective = exposureForRef(deps, ref, presetId, workspace)
    byServer.set(ref.serverName, effective)
    if (effective === 'name-only') nameOnly.push(ref.serverName)
    else if (effective === 'hidden') hidden.push(ref.serverName)
  }
  const hiddenCount = countSearchableHidden(hidden, deps.hasTools)
  // 运行时发现的插件内嵌 MCP：只有已就绪的才纳入过滤（fail-open）。
  mergeRuntimeIntoPlan(
    byServer,
    nameOnly,
    deps.runtimeServers?.() ?? new Map(),
    deps.isRuntimeReady,
    deps.runtimeExposureOf,
  )
  nameOnly.sort((a, b) => a.localeCompare(b))
  return { presetId, workspace, byServer, nameOnly, hiddenCount }
}

/** 渲染 name-only 的服务器索引段（无内容时返回空串，不贡献 token）。 */
export function renderServerIndex(deps: AssemblyDeps, plan: AssemblyPlan): string {
  if (plan.nameOnly.length === 0 && plan.hiddenCount === 0) return ''
  const lines: string[] = []
  if (plan.nameOnly.length > 0) {
    lines.push('## MCP 路由器')
    lines.push('')
    lines.push(
      ' MCP 服务器已就绪但未把工具清单注入上下文，按需调用。用 `dsh_mcp_call`（`server` + `tool` + `arguments`）直接调用；' +
        '不确定工具名时用 `dsh_mcp_search` 传 `server` 查看该服务器的工具清单。',
    )
  }
  lines.push('')
  if (plan.hiddenCount > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`另有 ${plan.hiddenCount} 个 MCP 服务器未在提示词中列出，可用 \`dsh_mcp_search\` 以关键词检索。`)
  }
  return lines.join('\n')
}

/**
 * 安装装配层：一个 assemble 监听器 + 一个 name-only 索引段。
 * 返回合并 disposer（插件卸载时全部归还）。
 */
export function installAssembly(ctx: Context, depsRaw: Omit<AssemblyDeps, 'ctxForPreset'>): () => void {
  const deps: AssemblyDeps = { ...depsRaw, ctxForPreset: ctx }
  // 装配计划每次实时计算。
  //
  // 历史实现按 agent 缓存单槽计划（assemble 监听器与 section provider 共用），但缓存
  // 永远不失效：运行时来源（插件内嵌 MCP）在首轮装配时往往还没采到 catalog，算出的
  // 「没有它」的计划会被后续所有轮次复用 —— 索引段永远不出现、也永远不接管。
  // 计划构建本身只是遍历十几行注册表 + 几个 runtime server（纯内存读），实时计算
  // 的开销可以忽略，正确性优先。
  const planFor = (context: { agent?: unknown } | undefined): AssemblyPlan => {
    const plan = buildAssemblyPlan(deps, context)
    try {
      deps.onPlan?.(plan)
    } catch {
      /* 诊断回调绝不能影响装配 */
    }
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
