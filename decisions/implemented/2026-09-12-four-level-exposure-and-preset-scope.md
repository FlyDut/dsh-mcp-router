# 四档曝光模型 + 预设运行时隔离（v0.6.0）

## 背景

旧设计（v0.4~v0.5）把「MCP 是否可见」拆成两个维度：

- 物理启停（loader `disabled`）—— 由面板开关控制；
- 全局 `autoManage` 开关 —— 决定停用的 MCP 是否由中间层（`mcp_search` / `mcp_call`）托管。

用户反馈三个问题（2026-09）：

1. **技能功能冗余**：用户已有独立的技能管理插件；插件应当只做好一件事。
2. **可见性是二值的**：「停用即完全隐藏、需要 `mcp_search` 才查得到」之外，缺少中间档 —— 想让模型「知道有这么个 MCP、但不要把工具清单塞进上下文」。
3. **缺少按会话隔离**：一个会话用某个 MCP、另一个会话不用时，旧设计只能靠反复物理开关，而进程只有一份。

同时代码层面出现明显症状：三个模块各自监听 `system-prompt/assemble` 过滤工具（可见性 / 工具级禁用 / 项目工作区），面板行的 live 路径与 preset 路径是两份几乎复制粘贴的构建代码，状态概念有五个（`disabled` / `aiEnabled` / `modelVisible` / `toolDisabled` / `desired+pending`）。

## 决策

1. **移除技能功能**，插件定位收敛为 MCP 可见性与可用性的单一控制面。
2. **每 server 一个曝光档位（四档）**，档位同时决定进程期望状态与注入量：
   `native`（全注入）/ `name-only`（只注入服务器名索引）/ `hidden`（不注入，可检索可调用）/ `off`（不可见不可调用）。
   删除全局 `autoManage` 开关与独立的启用/停用按钮。
3. **预设关联做运行时隔离**：`{ mode: 'all' | 'only' | 'except', ids }`；
   隔离只影响装配、`mcp_search`、`mcp_call` 三处判定，**不改变物理运行状态**。
4. **单一决策函数** `decideExposure({policy, running, aiActive, presetId})`，四处消费同一结果。
5. **单一装配层**：合并三个 assemble 监听器为一个。
6. **来源归一**：loader 行 / preset standing 行 / 项目行统一为 `ServerRef`，面板只有一条构建路径。
7. **策略真源**：intent（持久化）/ effective（运行时）两份表取代 `desired` + `lastApplied` + `pending` 多轨状态；`applied` 仅作物化账本。
8. **改名** `dsh-mcp-panel`；数据目录与 state.json 结构自动迁移（v1 → v2，备份 `state.v1.json`）。

## Alternatives

| 方案 | 为什么不选 |
| --- | --- |
| 保留全局 autoManage，只给停用态加三档 | 用户要的是「每个 MCP 一个状态」；两个维度叠加会让面板出现 4×2 的组合，语义更难解释 |
| 隔离靠物理停用（按 preset 起停进程） | 框架限制：preset standing 组合按 preset 共享一份，且运行期写组合文件会触发 stamp 重挂事故；同一 MCP 也无法同时「对 A 会话开、对 B 会话关」 |
| `name-only` 用一个占位工具（`mcp__<server>__list`）承载 | 每个 server 会多一个工具条目，且要维护占位工具的 schema/生命周期；`mcp_call` 不传工具名返回清单更省 |
| 跳过档位、只做「预设关联 + 保留启停」 | 用户明确要三档可见性；且启停按钮与档位的联合语义（停用 + native = ？）无法自洽 |
| 装配按 preset 只读 loader、不读 standing 行 | rc.1 起 preset 行不在 loader，装配将无法对预设行生效（旧实现的实际行为），hidden/name-only 对预设行失效 |
| 保留旧的三个 filter，各自扩展新维度 | 三处重复判定必然漂移，且每次新增维度要改三遍 |

## Consequences

- **面板语义**：每张卡片只有一个状态控件（四档），加一个折叠的预设关联区。旧「AI 中间层」开关消失，`mcp_search` / `mcp_call` 常驻（部署级可用 `Config.middleLayer=false` 关闭）。
- **上下文成本**：`native` 全量注入；`name-only` 每 server 约一行文本；`hidden` / `off` 零注入。
- **进程管理变成 best-effort**：loader 行可即时启停；preset standing 行只能等下次启动的物化（框架限制不变），但**可见性与可调用性始终即时生效** —— 因为它们由装配与中间层判定，与进程状态解耦。
- **迁移一次性完成**：旧 `autoManage: true` + 已停用 → `hidden`（保持「AI 可按需调用」）；旧 `autoManage: false` + 已停用 → `off`；已启用 → `native`。工具级禁用并入对应策略，项目级启停并入 `projects` 分区。
- **可测试性提升**：档位/隔离/迁移/物化规则全部落在零依赖的 `domain/exposure.ts`，由 `lib/exposure.js` 独立构建并真值表自测；旧实现这些语义散在三个带 ctx 依赖的模块里，只能手工验证。
