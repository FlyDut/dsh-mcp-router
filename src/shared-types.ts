/**
 * Host/Client 共享的类型定义（单一来源）。
 *
 * 面板视图形状（McpRow / McpView / PresetListView）同时被 host 的 collect.ts 产出与
 * client 的 panel.tsx 消费 —— 集中定义避免两端各自声明导致漂移。
 * 纯类型文件：type-only import 不产生任何打包产物。
 */
import type { Exposure, PresetScope } from './domain/exposure'

export type { Exposure, PresetMode, PresetScope } from './domain/exposure'

export type McpStatus = 'active' | 'disabled' | 'idle' | 'failed'

/** 行来源：loader 行 / 预设 standing 行 / 项目级（工作空间）行。 */
export type McpSource = 'loader' | 'preset' | 'project'

/** 单个工具的展示信息（面板工具级禁用用）。 */
export interface McpToolInfo {
  /** 工具注册全名 `mcp__<server>__<tool>`。 */
  name: string
  description: string
  disabled: boolean
}

export interface McpRow {
  entryId: string
  rowId: string
  serverName: string
  transport: string | null
  /** loader 行/预设行当前是否停用（= 进程期望关闭）。 */
  disabled: boolean
  /** 进程当前是否在跑。 */
  running: boolean
  /** 进程在跑但一个工具都没注册（有效档位需要工具时属异常；工具数不再回落目录快照）。 */
  unregistered: boolean
  /** 工具数（停用态用 catalog 快照回填）。 */
  tools: number
  /** token 估算（停用态用 catalog 快照回填）。 */
  tokens: number
  status: McpStatus
  /** 用户意图档位（四档之一）。 */
  exposure: Exposure
  /** 当前对该面板会话生效的档位（含预设隔离与运行态降级）。 */
  effectiveExposure: Exposure
  /** 预设关联配置。 */
  presetScope: PresetScope
  /** 当前会话的 preset 是否被允许（false = 运行时隔离命中）。 */
  presetAllowed: boolean
  /** 模型是否直接看到工具（effective === native）。 */
  modelVisible: boolean
  /** 是否只暴露服务器名（effective === name-only）。 */
  nameOnly: boolean
  /** 是否存在待生效变更（next-session 模式）。 */
  pending?: boolean
  /** 是否已被用户显式配置过（false = 使用默认档位）。 */
  configured?: boolean
  source: McpSource
  /** 面板能否编辑/删除该行（预设组合行只读）。 */
  writable: boolean
  /** 项目级 MCP 所属工作空间。 */
  workspace?: string
  /** 该 server 的工具列表（面板工具级禁用用；null = 暂无目录）。 */
  toolList?: McpToolInfo[] | null
}

export interface McpView {
  sessionId: string | null
  preset: string | null
  cwd: string | null
  /** 最近一次会话进入的工作空间（随会话切换更新；添加项目 MCP 的默认目标）。 */
  activeWorkspace: string | null
  mcp: McpRow[]
  mcpTotal: number
  /** 档位为 off 的服务器数。 */
  mcpDisabled: number
  /** 当前生效为 native 的服务器数。 */
  mcpNative: number
  /** 当前生效为 name-only 的服务器数。 */
  mcpNameOnly: number
  /** 当前生效为 hidden 的服务器数。 */
  mcpHidden: number
  mcpToolsTotal: number
  mcpTokensTotal: number
  errors: string[]
}

/** 可关联的 agent 预设（面板预设关联控件用）。 */
export interface PresetOption {
  id: string
  name?: string
  description?: string
  /** 是否为「未指定预设时的默认预设」。 */
  isDefault?: boolean
  /** 该预设当前不可组合的原因（存在时面板标注）。 */
  broken?: string
}

export interface PresetListView {
  presets: PresetOption[]
  /** 当前面板会话运行的预设 id。 */
  current: string | null
  /** 预设列表不可得时的降级说明（面板提示，不阻塞其他功能）。 */
  error?: string
}
