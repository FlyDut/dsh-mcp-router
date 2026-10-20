/**
 * 运行时发现的「插件内嵌 MCP server」—— 注册表之外的工具来源。
 *
 * 背景：`domain/registry.ts` 只认三种**显式声明**的来源（loader 行 / preset standing
 * 行 / 项目行）。有些插件（例如 computer-use 的 MCP 提供方）在自己的 apply 里用
 * `ctx.plugin(McpClient, ...)` 动态建 MCP 客户端 —— 没有对应的 loader 行，于是：
 *   - router 看不见它：面板无行、catalog 采不到、dsh_mcp_search 搜不到；
 *   - 它的工具又因为装配层「未知 server 保守放行」直接进模型上下文，白占 token。
 *
 * 本模块只回答一个问题：**这次 schema 视图里，哪些 MCP server 是注册表没声明的？**
 * 纯函数、零依赖（`serverOfMcp` 同属纯逻辑），便于 selftest 直接覆盖。
 */

import { serverOfMcp } from '../catalog'

/** 一次 schema 视图的运行时发现结果。 */
export interface RuntimeDiscovery {
  /** serverName → 本次视图里看到的工具数。 */
  servers: Map<string, number>
  /** 本次视图里 `mcp__` 前缀工具总数（诊断用，含已声明 server）。 */
  mcpTools: number
}

/**
 * 从一次 `tools.schemas(scope)` 视图里发现注册表之外的 MCP server。
 *
 * 判定规则：工具名以 `mcp__` 开头 → 解析出 server 段 → 若该 server 不在 `known`
 * 集合里，则归入运行时发现。名字畸形（`serverOfMcp` 返回 null）的条目跳过，与
 * 装配层「不误伤」的保守口径一致。
 *
 * @param schemas - schema 视图（只读；不修改入参）。
 * @param known - 注册表已显式声明的 server 名集合。
 * @returns 未知 server 及工具数；`known` 中的条目不会出现在结果里。
 */
export function discoverRuntimeServers(
  schemas: ReadonlyArray<{ name?: unknown }>,
  known: ReadonlySet<string>,
): RuntimeDiscovery {
  const servers = new Map<string, number>()
  let mcpTools = 0
  for (const schema of schemas) {
    const name = String(schema?.name ?? '')
    if (!name.startsWith('mcp__')) continue
    mcpTools += 1
    const server = serverOfMcp(name)
    if (server === null || known.has(server)) continue
    servers.set(server, (servers.get(server) ?? 0) + 1)
  }
  return { servers, mcpTools }
}
