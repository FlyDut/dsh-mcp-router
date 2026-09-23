# 设计：四档曝光模型与预设运行时隔离（v0.6.0）

> 状态：已实施（v0.6.0） · 取代旧文档 `design-mcp-control.md`（形态 1/2 + 全局 autoManage 双形态设计）

## 1. 目标与范围

插件只做一件事：**决定每个 MCP 服务器对哪些会话以什么粒度可见，并在不可见时按需调用它。**

为此需要三个正交但互不冗余的概念：

| 概念 | 回答的问题 | 载体 |
| --- | --- | --- |
| **曝光档位**（Exposure） | 这个 MCP 进多少上下文？进程该不该跑？ | 每 server 一个档位 |
| **预设关联**（PresetScope） | 哪些会话能用它？ | 每 server 一个 `all` / `only` / `except` + 列表 |
| **工具级禁用** | 单看这个工具能不能用？ | 每 server 一组禁用全名 |

显式不做的事：技能管理（交给独立插件）、MCP 客户端实现（用 `@deepseek-ai/dsh-mcp-client`）、preset 编辑器（用 dsh 自己的预设 UI）。

## 2. 领域模型

### 2.1 四档

| 档位 | 进程 | 上下文注入 | `dsh_mcp_search` | `dsh_mcp_call` |
| --- | --- | --- | --- | --- |
| `native` | 运行 | 全部 `mcp__<s>__*` schema | 摘要表列出（标注已注入） | 可调用 |
| `name-only` | 运行 | 一行「服务器名 + 摘要」索引段 | 摘要表列出 | 可调用 |
| `hidden` | 停用（调用时保活 → 空闲回收） | 无 | 仅关键词命中返回 | 可调用 |
| `off` | 停用 | 无 | 不出现 | 拒绝 |

档位与「进程期望状态」由一个纯函数绑定：`desiredRunning(exposure) = exposure === 'native' || 'name-only'`。用户切档位 = 隐式启停进程，不再有第二个开关。

### 2.2 预设关联

```ts
type PresetScope = { mode: 'all' | 'only' | 'except'; ids: string[] }
```

`only` 是白名单（无 preset 的会话不在名单内 → 不可用）；`except` 是黑名单（无 preset 的会话不在名单内 → 可用）。语义选择见 §5 决策 3。

隔离效果落在三处、共用同一个判定：装配过滤、`dsh_mcp_search`（摘要 + 检索）、`dsh_mcp_call`（拒绝文案区分「预设隔离」与「档位关闭」）。**物理状态不变** —— 这正是「一个会话用、另一个会话不用，而进程只有一份」的解法。

### 2.3 一个决策函数

```ts
decideExposure({ policy, running, aiActive, presetId }) : Exposure
```

判定顺序：

1. `!presetAllows(policy.presets, presetId)` → `off`（隔离优先于一切）
2. `off` / `hidden` → 原样（与运行态无关：`hidden` 在保活窗口内也不注入）
3. `native` / `name-only`：`running && !aiActive` → 原档；否则 **降级 `hidden`**（工具不注入，但仍可 `dsh_mcp_call`）

第 3 条是刻意的：进程没起来（启动失败、物化未及）或正被中间层托管时，宁可少注入也不能让能力静默消失。装配层、`dsh_mcp_search`、`dsh_mcp_call`、面板徽标全部消费这一个函数，杜绝「看得到调不动」。

## 3. 分层与模块职责

```
panel    collect.ts（视图）· routes.ts（端点）· client/*（UI）
policy   domain/policy.ts（意图/生效两份表 + 持久化 + 迁移）
         domain/exposure.ts（档位判定 + 预设隔离 + v1 迁移 + 物化规则，纯逻辑）
runtime  domain/registry.ts（三种来源归一）· catalog.ts（目录）
         mcpcall.ts（保活回收 + 两个模型工具）· project-mcp.ts（工作空间行）
assembly domain/assembly.ts（唯一 system-prompt/assemble 监听器 + 索引段）
infra    state.ts（state.json）· preset.ts（组合文件文本 + 启动物化）
         preset-mcp.ts（standing 行读取）· mcp-convert.ts（JSON → 行）
```

| 模块 | 唯一职责 | 关键约束 |
| --- | --- | --- |
| `domain/exposure.ts` | 领域语义（档位、隔离、迁移、物化规则） | 零 import：可被 `lib/exposure.js` 独立构建与真值表自测 |
| `domain/policy.ts` | 策略真源：intent（落盘）与 effective（运行时）两份表 | 装配路径只读 effective；写路径只经 `set()` |
| `domain/registry.ts` | 把 loader 行 / preset standing 行 / 项目行归一为 `ServerRef` | 维护**同步**快照（装配不能 await），未就绪时调用方保守放行 |
| `domain/assembly.ts` | 唯一的上下文注入点 | 合并了旧实现里三个独立 filter；每回合构建一次计划，O(1) 查表 |
| `mcpcall.ts` | 保活启用 → 等注册 → 执行 → 空闲回收；`dsh_mcp_search` / `dsh_mcp_call` | 通过 `accessOf/accessFor` 复用同一个判定 |
| `preset.ts` | 物化目标解析 + 启动早期物化 | 运行期**绝不**写组合文件（事故铁律） |
| `domain/composition-file.ts` | 组合/patch 文件的文本级行操作（块定位、删除、config 键读写、缩进行标志） | 纯文本：保留注释、`!!js` 与用户排版（YAML 库的 dump 会全丢） |
| `domain/external-import.ts` | 外部 agent 配置的形态嗅探与字段归一化 | 只解析 MCP 相关键；归一化后复用 mcp-convert 的校验 |
| `domain/mcp-edit.ts` | 编辑/删除编排（写回文件 + 同步运行时 + 策略迁移） | 顺序固定「先写文件、再动运行时」；预设组合行一律拒绝 |

## 4. 数据与生命周期

### 4.1 state.json v2

```jsonc
{
  "version": 2,
  "servers":  { "<serverName>": { "exposure": "native", "presets": {"mode":"only","ids":["coding"]}, "disabledTools": ["mcp__s__t"], "applied": false } },
  "projects": { "<workspace>": { "<serverName>": { /* 同 servers */ } } },
  "ai":       { "<entryId>": { "at": 1750000000000 } },
  "config":   { "applyMode": "immediate" }
}
```

`applied` 是物化账本（上次写入组合文件的 `disabled`，`null` = 文件中无该键）。它与用户意图放在同一条目里，便于一次原子写盘。

目录：`~/.dsh/dsh-mcp-panel/`（`state.json` + `catalog.json`）；首次访问时从 `dsh-mcp-skill-panel` / `dsh-runtime-inventory` 搬迁。

### 4.2 启动序列

```
registry.refreshNow()        # 归一 loader/preset/项目行（同步快照就绪）
policy.load()                # 读 state.json；v1→v2 迁移（备份 state.v1.json）；intent → effective
syncPresetFiles()            # 物化：首次采用 / 对齐账本 / 写 disabled
registry.refreshNow()        # 物化改变了 disabled，复扫
```

`syncPresetFiles` 只在 `ctx.agents.list().length === 0` 时执行（有会话时写组合文件会触发 standing 重挂事故）。

### 4.3 生效时机

- `immediate`（默认）：`set()` 同时更新 intent 与 effective，并调用 `applyProcessState` 把期望启停同步到 loader 行（preset 行只能等下次启动物化）；当前会话下一轮即变（有缓存代价，面板提示）。
- `next-session`：只更新 intent 并落盘；effective 与 loader 都保持不变，直到会话边界（`agent/session-start` → `policy.commitPending()`）或重启。零缓存失效。

## 4.4 配置写回矩阵（v0.6.1）

| 行来源 | 真实文件 | 编辑 | 删除 |
| --- | --- | --- | --- |
| 全局行（loader） | `cordis.patch.yml`（loader 里这些行归属根树，`tree.filename` 是每次启动重置的 `cordis.yml`，因此由 `materializeTargetOf` 映射到同目录 patch 文件） | 文本替换 config 键块 + `entry.update({config})` | `removeRowBlock` + `loader.remove` + `policy.clear` |
| 项目行 | `<workspace>/.dsh/mcps/**/mcp.json`（挂载名带路径哈希后缀，用 `findProjectMcpFile` 反查原始键） | 改 JSON 值 + 重扫挂载 | 删 JSON 键 + 重扫 |
| 预设组合行 | `<preset>/agent.cordis.yml` | 拒绝（只读保护） | 拒绝（引导「关闭」档位） |

两条硬约束：

1. **先写文件、再动运行时**：顺序反了会出现「运行时改了但没落盘」的半状态；文件写成功后，所有运行时操作（`loader.remove/update`、`remountWorkspace`）一律容错 —— live patch reload 可能已经替我们完成了。
2. **动态字段不动**：`!!js` 键在表单里只读、写回时取原文（`dedentLines(readConfigBlock().lines)`）。否则一次无关的编辑就会把导入进来的 `${VAR}` 固化成明文密钥。

## 5. 关键决策

1. **四档取代「启用/停用 + 全局 autoManage」**：旧设计有两个状态维度（物理启停 × 全局是否走中间层）和两条可见性路径，用户要在脑子里做笛卡尔积。四档把「注入多少」与「进程是否运行」绑成一个语义清晰的阶梯。
2. **档位驱动进程**：不保留独立的启停按钮。切到隐藏/关闭即停进程（省资源），切到原生注入/仅名称即启动。
3. **`only` 白名单 / `except` 黑名单双向都支持**：只做其一都会有用户无法表达的场景（「只有 coding 用」vs「除了 ptc 都能用」）。
4. **预设隔离不改物理状态**：用户明确要求「一个会话用一个 MCP，另一个会话不用，总不能既开着又关着」——隔离是装配/检索/调用三处的运行时判定，进程共享一份。
5. **`name-only` 用 system-prompt section 注入**：`systemPrompt.section({ text: (context) => … })` 每次装配求值且能拿到 `context.agent`，因此可以按会话的 preset 动态渲染；索引段无内容时返回空串，不贡献 token。
6. **注册表同步快照 + 保守放行**：装配在同步路径（waterfall / section provider 不能 await），preset 行又只能异步读，所以快照未就绪时一律保留工具（宁可多注入也不误伤）。
7. **单一装配监听器**：旧实现有三个各自 `filter` 的 `system-prompt/assemble` 监听器（可见性 / 工具禁用 / 项目工作区），语义分散且新增维度要复制三份；现在合并为一个监听器 + 一个纯决策函数。
8. **`dsh_mcp_call` 支持只传 server**：`name-only` 的模型不知道工具名，让其「先猜再试」体验很差；不传工具名（或传 `*`）直接返回工具清单，把发现成本压到一次调用。
9. **`dsh_mcp_search` 摘要分层**：摘要表列出 `native`（标注已注入）与 `name-only`（名字本就暴露），`hidden` 只给计数提示（不泄漏名字但提示检索入口），`off` 与预设隔离的完全不出现。
10. **保留启动期物化 + 铁律**：把「用户手工改过组合文件」识别为外部修改并只对齐账本（首次遇到则按文件现状采用），避免插件反向覆盖用户配置。
11. **编辑走文本级替换而非 YAML 库**：这些文件承载注释、`!!js` 与用户排版，`yaml.dump` 会把它们全丢掉（loader 自己就不用 dump 回写用户文件）。
12. **预设组合行只读**：运行期写 `agent.cordis.yml` 会触发 standing 重挂事故；「关闭」档位在可见性与可调用性上等效于删除，是更安全的替代路径。
13. **项目行不支持改名**：它的名字由 `.dsh/mcps` 下的配置键决定，运行时挂载名额外带路径哈希后缀；允许改名会让"文件键 / 挂载名 / 策略键"三者关系失控。
14. **导入复用 `/mcp/add`**：格式归一化后交给既有的「已存在跳过 / 挂载失败报告」链路，避免第二套落盘逻辑。

## 6. 边界情况

| 场景 | 处理 |
| --- | --- |
| 会话无 preset（rosterless 部署） | `only` 不可用；`all` / `except` 可用 |
| `native`/`name-only` 但进程未运行 | 降级 `hidden`：工具不注入、`dsh_mcp_call` 仍可用（保活或提示需重启物化） |
| preset 行不在 loader（rc.1 起） | 注册表经 `compositionInventory` + 组合文件文本解析得到，装配按会话 preset 精确取行 |
| `agentPresets` 服务视图受限（HTTP 路径历史问题） | 面板 `/presets` 降级为「已配置 id 仍展示并生效」+ 错误文案；判定路径不依赖该服务 |
| 预设 id 被删除 | 配置保留、UI 标注「已不存在」、判定仍按 id 比较 |
| state.json 损坏 | 逐字段宽容解析（`normalizePolicy`），非法值回落默认档位 |
| 迁移时行解析不到 serverName | 记入 `diagnostics().unresolved` 并告警，不静默丢弃 |
| 工具级禁用与档位冲突 | 禁用优先（`native` 档下也过滤） |
| AI 保活窗口内用户改档位 | `markUserEnabled` 清 AI 标记；回收器不再回收用户接管的 server |

## 7. 测试策略

- `scripts/selftest-exposure.mjs`（走 `lib/exposure.js`）：四档真值表、隔离三模式 × preset 有无、`desiredRunning`、注入形态、工具禁用、v1→v2 迁移（含 unresolved 与幂等）、物化规则 `decideSyncAction`。
- `scripts/selftest-policy.mjs`（临时 HOME，真实文件）：数据目录搬迁、v1→v2 迁移写回与备份、生效时机（immediate / next-session）、**全局行物化落到 patch 文件**与幂等。
- `scripts/selftest-composition-file.mjs`（走 `lib/composition-file.js`）：行块定位（单行/多行/带注释/CRLF）、删除（含空块清理与归属注释）、config 键读取（`!!js` 标记）、config 替换（动态键保留原文）、缩进行标志读写。
- `scripts/selftest-external-import.mjs`（走 `lib/external-import.js`）：五种形态嗅探、字段归一（`type: local|remote`、`command` 数组拆分、`environment` → `env`、`enabled: false` 标注）、坏输入与边界。
- `scripts/selftest-mcp-edit.mjs`（最小 ctx 桩 + 真实文件）：patch 行改写/改名迁移/删除、项目行 JSON 写回与键定位、只读拒绝、详情初值、失败时不改文件。
- `scripts/selftest-mcp.mjs`：catalog 检索打分、组合文件文本操作、项目工作空间扫描去重、mcpServers JSON 转换、`dsh_mcp_call` 参数归一化（双重前缀 / 双编码回归）。
- `pnpm verify`：产物形态（external 未内联、`lib/exposure.js` 无依赖、client 包装与导出）。
- 端到端手测清单见 README「验证清单」（四档行为、预设隔离、工具禁用、重启保持）。
