/**
 * 外部 agent 配置的 MCP 嗅探与归一化。
 *
 * 目标：把「你机器上其它 agent 已经配好的 MCP」一次性搬进 DSH，不必手工抄命令与参数。
 *
 * 支持的文件形态（自动嗅探，无需用户指定）：
 *
 * | 形态 | 谁在用 | 键 |
 * |---|---|---|
 * | `{ mcpServers: {...} }` | Claude Code、Cursor、Gemini CLI | `mcpServers` |
 * | `{ mcp: { servers: {...} } }` | zcode | `mcp.servers` |
 * | `{ mcp: { <name>: {...} } }` | opencode | `mcp`（值为服务器映射） |
 * | `{ servers: {...} }` | VS Code `.vscode/mcp.json` | `servers` |
 * | `{ <name>: {...} }` | 手工片段 | 顶层裸映射 |
 *
 * 字段归一化（各家叫法不同）：
 * - `type: 'local'`（opencode）→ stdio；`type: 'remote'`（opencode/zcode）→ streamable-http
 * - `command` 为**数组**（opencode）→ 首个元素是命令、其余进 `args`
 * - `environment` → `env`
 * - `enabled: false` → 照常解析并在结果里标注（面板默认不勾选，但可见）
 *
 * 归一化后复用 `mcp-convert.ts` 的解析与校验（serverName 规则、transport 推断、
 * 非标量值告警），避免两套校验逻辑漂移。
 *
 * 纯逻辑、零运行时依赖（只 import 同构的纯模块），可被 selftest 直接覆盖。
 */
import { type McpServerConfig } from '../mcp-convert';
/** 识别出的文件形态。 */
export type ExternalFormat = 'mcpServers' | 'zcode' | 'opencode' | 'vscode' | 'bare';
/** 一条可导入的服务器。 */
export interface ImportedServer {
    /** 原始名字（作为新 serverName 的候选）。 */
    name: string;
    /** 归一化后的配置（dsh-mcp-client 形状）。 */
    config: McpServerConfig;
    /** 源配置里的 `enabled`（false = 源里已禁用，仅作提示）。 */
    enabled: boolean;
    /** 归一化过程中的说明（如「command 数组已拆分」）。 */
    notes: string[];
}
export interface ExternalParseResult {
    /** 未能识别形态时为 undefined。 */
    format?: ExternalFormat;
    servers: ImportedServer[];
    errors: string[];
    warnings: string[];
}
/** 内置扫描源（路径含 `<home>` / `<workspace>` 占位，由调用方展开）。 */
export interface KnownSource {
    id: string;
    label: string;
    path: string;
    /** true = 路径相对当前工作空间而非 HOME。 */
    projectRelative: boolean;
    /** false = 已知但本版本不支持解析（扫描结果里会说明原因）。 */
    supported: boolean;
    note?: string;
}
/**
 * 内置扫描源清单。
 *
 * @param opts.home - 用户主目录（`~`）。
 * @param opts.workspace - 当前会话工作空间（项目级源用；缺省时跳过项目级源）。
 */
export declare function knownMcpSources(opts: {
    home: string;
    workspace?: string | null;
}): KnownSource[];
/**
 * 解析一份外部 agent 配置文件。
 *
 * @param text - 文件全文（JSON；TOML 等其它格式请先由调用方拒绝）。
 */
export declare function parseExternalMcpConfig(text: string): ExternalParseResult;
/** 一句话描述某服务器的连接方式（面板列表用）。 */
export declare function describeImportedServer(server: ImportedServer): string;
