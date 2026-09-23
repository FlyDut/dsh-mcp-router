# 上游溯源台账：本地 v0.7.0 ← 上游 0.6.0

本文件回答一个问题：**下次从上游更新时，从哪里开始看？**

本地已与上游架构分叉，因此**不合并上游分支**，而是按提交逐条等价移植（见「架构差异」）。这份台账记录：

1. 每条上游分支的**水位线**（已评估到的 tip）；
2. 已移植提交 → 本地提交的映射；
3. 已评估、**明确不适用**的提交与模块（避免下次重复评估）。

## 下次更新从这里开始

```sh
git fetch upstream --no-tags
pnpm upstream:check            # 按下方水位线列出上游新增的提交与分支
```

`upstream:check` 会读本文件里的水位线块（见下），逐分支报告「水位线之后新增了什么」，并提示上游出现的新分支。

<!-- upstream-watermarks
main 3c060253d1e007d4e15865e231d4774c90a4ab92
feat/0.6.0-pr16-17-port 26f2a62df266ddcbaa21648f90289489cb5acb00
fix/0.6.x-preset-row-handles 155b5b56633edfffc3570f90a4eabec67ced081c
feat/0.5.6-passthrough f24d7ba9bdf6605a5b85de893956ddad108f3257
-->

> 上面这段是**机器可读**的水位线块（`scripts/upstream-check.mjs` 解析它）。更新完上游后请同步修改这里的 sha，并追加本次的映射表。
>
> 注意水位线是**逐分支**的：`upstream/main` 的 `3c06025` 是 squash release，**不是** `feat/*` 分支的祖先（见下），所以不能拿一个 sha 去 diff 所有分支。

## 上游拓扑事实（决定了水位线怎么记）

| 事实 | 说明 |
| --- | --- |
| 共同祖先 | `215623d` = 0.5.5 release（2026-09-09） |
| `upstream/main` | `3c06025` = **`215623d` 的直接子提交**（squash release，单提交 +5678/−293），其内容 = `feat/0.6.0-pr16-17-port` 的最终态 |
| `feat/0.6.0-pr16-17-port` | `26f2a62`，46 提交（0.5.6~0.6.0 开发线） |
| `fix/0.6.x-preset-row-handles` | `155b5b5`，28 提交（0.5.7~0.7.2 开发线），**是** `feat/0.6.0-pr16-17-port` 的祖先 |
| `feat/0.5.6-passthrough` | `f24d7ba`，5 提交（gateway 透传早期线） |
| 因此 | 「评估到 0.6.0」在内容上已覆盖上述分支的全部提交；但上游若继续在这些分支上开发，新提交**不会**自动出现在 `main` 上 —— 所以水位线逐分支记 |

各分支 tip 台账（本次评估时点：2026-09-23）：

| 分支 | tip | 提交日期 | 处置 |
| --- | --- | --- | --- |
| `upstream/main` | `3c06025` | 2026-09-16 | 已逐条评估（本表） |
| `upstream/feat/0.6.0-pr16-17-port` | `26f2a62` | 2026-09-16 | 已评估（内容同 main） |
| `upstream/fix/0.6.x-preset-row-handles` | `155b5b5` | 2026-09-16 | 已评估（0.7.x 线） |
| `upstream/feat/0.5.6-passthrough` | `f24d7ba` | 2026-09-10 | 已评估（gateway 早期，不适用） |
| `upstream/docs/readme-upgrade-note` | `704ac9c` | 2026-08-21 | 旧分支（落后 25），忽略 |
| `upstream/release-0.5.5` | `27ba2bf` | 2026-09-09 | 已在共同祖先内 |
| `upstream/rc1-0.5.4` | `2983d92` | 2026-09-08 | 历史分支，忽略 |
| `upstream/test/prompt-cache-p0-p1` | — | — | 历史测试分支，忽略 |
| `upstream/test/v0.4.3-perf` | — | — | 历史测试分支，忽略 |
| `upstream/test/v0.4.4-maintain` | — | — | 历史测试分支，忽略 |
| `upstream/test/v0.4.5-catalog-prune` | — | — | 历史测试分支，忽略 |
| `upstream/test/v0.4.6-catalog-guard` | — | — | 历史测试分支，忽略 |

## 已移植：上游提交 → 本地提交

| 上游提交 | 上游主题 | 本地提交 | 移植方式与偏离 |
| --- | --- | --- | --- |
| `c0855f9` | 采集循环覆盖 preset 行 | `3646e1b` | 等价改写：`snapshotEnabled` 采集与 prune 都改走**注册表快照**（loader ∪ preset ∪ project），不直连 `standingMcpEntries()` |
| `78142f6` | 未注册行诚实上报 + `row-display` 零依赖 | `3646e1b` | 取 `rowDisplay` 语义（零注册不回填目录快照）+ 新增 `unregistered` 徽标；**偏离**：本地保留 `computeStatus` 的 `idle`（README 把「在跑但零工具」定义为合法 🟡），不改成 `failed` |
| `d848005` | `existingRowIds` 覆盖 standing 行 | `3646e1b` | 等价改写：判据叠加 `registry.snapshot().all` 的 `entryId` 与 `mcp-<serverName>` |
| `0b16e6f` | `readBody` 加固 | `ab913a3` | 全量等价：`StringDecoder` 逐块解码 + 按字节计数 + 超限先解绑监听器；**偏离**：超限不 `destroy` socket 而是 `resume()` 排空，否则 400 送不出去 |
| `0b16e6f` | `rowConfig` 回传脱敏 + 占位符即保留原值 | `ab913a3` | 只落 `/mcp/detail`（`maskConfigSecrets`）+ 写侧 `unmaskEcho`；**偏离**：`/mcp/scan` 刻意不脱敏（其唯一用途是原样导入，脱敏会把哨兵写进新配置） |
| `b9ea506-A` | 逃生舱确认闸门 | `ab913a3` | 等价：本地逃生舱是 `POST /policy/commit`，要求 `{confirm:true}` + 面板二次确认 |
| `18576e4` | `mcp_search` 分层检索 | `adda475` | 等价：`server=X` 默认能力摘要（前 5 裸名）+ `all:true` 分页（20/上限 100）+ `query+server` 单库检索；`catalog.ts` 增 `scopedTo`、`listServer` 改三态 |
| `b8b87f9` | 摘要分支 `count` 用 `totalCount` | `adda475` | 随分层一起（`count` 一律取总数，不取页大小） |
| `0f4794a`（PR#16） | 控制工具改名 `dsh_mcp_search`/`dsh_mcp_call` | `63a437c` | 等价 + 单一事实源常量 `MCP_SEARCH_TOOL`/`MCP_CALL_TOOL`/`CONTROL_TOOL_NAMES` + 自测护栏「不得以 `mcp_` 开头」 |
| `74ed18e` | 会话透传（面板跟随当前会话） | `63a437c` | 等价改写：新增 `src/client/session-param.ts`（避开已占用的 `src/domain/session-scope.ts`）+ 独立产物入口 + verify 闸门 |
| PR#17 特性 1 | 工具级批量启停（含三态 BLOCK-1） | `63a437c` | 等价：`resolveToolBulkTargets` 纯函数 + `POST /mcp/toolBulk` + 面板过滤框与批量按钮 |
| `31f60ca`（PR#17 特性 5b） | `setup-dsh-deps.mjs` 支持 POSIX | `63a437c` | 等价改写：非 win32 用相对目录符号链接；顺带修悬空链接的幂等判定（`lstat`） |

## 已评估、明确不适用（下次不要重复评估）

| 上游提交 / 模块 | 结论 | 理由（本地证据） |
| --- | --- | --- |
| `b500d0d` 写端点 token 守卫 | 本地已有等价 | 10 个写端点全部 `guarded=true`；无 `rowConfig` 路由 |
| `1eca30b` 配置意图物化 / `lastApplied` | 不适用 | 本地无配置物化路径（`preset.ts` 只物化 `disabled`），账本本就取文件事实 |
| `155b5b5` `setRowConfigKeys` 值区间 | 不适用 | 本地无该函数；写盘是整块替换（`composition-file.ts` 的 `replaceRowConfig`）+ 字符串全量加引号 |
| `2161bba` / `1db832f` 关前补采（守卫 / 等待上限） | 不适用 | 本地无 `fetchInventory` / 按需采集 |
| `7672450` 能力表采集走 `snapshotEnabled` | 不适用 | 本地无按需采集路径 |
| `e4318d4` 网关补关链路 | 不适用 | 本地无 `gateway.ts`，无 `ctx.loader.create` 运行期挂载 |
| `627e627` preset 行句柄 / 临时拉起 / 已安装能力表 / 诊断面 | 不适用 | 依赖 `livePresetMounts()` 同模块实例；`src/preset-mcp.ts` 明文判定「host 与面板各装一份，模块态不共享」 |
| `5416410` 亮色主题抽屉 | 不适用 | 本地 client 无 `--dsw-alias-bg-l1` 误用，抽屉已用 `bg-layer-1` + `color-mix` |
| `src/gateway.ts`（321 行） | 未引 | 上游真挂载 `ctx.loader.create` + `restrict` 视野隔离；本地等价是组合文件物化 + 重启生效 |
| `src/standing-rows.ts`（193 行） | 未引 | 唯一数据源 `livePresetMounts`（模块私有 WeakMap，需同实例）+ 0.1.5-rc2 新 API |
| `src/pending.ts` 增量 | 未引 | 100% 是 standing 句柄适配；本地策略双表不读 Entry 句柄，无「意图悬空」缺陷 |
| `src/model-route.ts`（275 行）+ `GET /models` | 未引 | 按**模型**路由，与本地按 **agent 预设**隔离正交；无需求源头 |
| `src/filter.ts` 的 `gateFor` | 未引 | 按模型分流中间层工具；本地无模型维度 |
| `autoManage` / `autoManageByRoute` / `middleLayerHides` | 未引 | 上游的「中间层开关」范式；本地以四档曝光承担该语义 |
| `toolBudget` + 有效统计 | 未引（可选特性） | 属新特性而非修复；本地 `McpView`/`config` 无对应字段 |
| `/mcp/rowConfig`、`/debug/rowConfig` | 未引 | 依赖 standing 句柄 `entry.update({config})`；本地已有 `/mcp/detail` + `/mcp/update` |
| 技能面板（`/skill/*`） | 未引 | 本地 v0.6.0 已整体移除技能功能 |

## 上游文件 → 本地落点对照（读 diff 用）

| 上游 | 本地等价物 | 备注 |
| --- | --- | --- |
| `src/gateway.ts` | —（`domain/composition-file.ts` + `preset.ts`） | 物化 vs 运行期挂载，路线不同 |
| `src/model-route.ts` | — | 无落点 |
| `src/tool-disable.ts` | `domain/exposure.ts`（`resolveToolBulkTargets`）+ `routes.ts`（`/mcp/toolBulk`） | 本地策略表 vs 上游模块级 Map |
| `src/row-display.ts` | `collect.ts`（`computeRowDisplay` / `computeStatus`） | 语义已对齐（`unregistered`） |
| `src/session-scope.ts`（client 侧） | `src/client/session-param.ts` | 同名文件在本地是 **host 侧**语义（preset/cwd） |
| `src/filter.ts` | `domain/assembly.ts` | 本地唯一装配注入点 |
| `src/standing-rows.ts` / `src/pending.ts` | — | 本地不直连 standing 模块实例 |
| `src/mcpcall.ts` | `src/mcpcall.ts` | 分层检索、改名、`buildServerListingResult` 已移植 |
| `src/routes.ts` | `src/routes.ts` | `toolBulk` / 脱敏 / 闸门已移植；`rowConfig`、`/models` 未引 |
| `src/client/views.tsx` | `src/client/panel.tsx` + `server-card.tsx` | 上游单文件，本地按组件拆分 |

## 架构差异（为什么不合并）

- **本地**：四档曝光（`native` / `name-only` / `hidden` / `off`，按 server 粒度）+ 按 **agent 预设** 运行时隔离；启停走「启动早期组合文件物化 + 重启生效」；中间层工具固定注册。
- **上游**：`autoManage` 中间层开关范式 + gateway 真挂载（`ctx.loader.create`）+ standing 行句柄（`livePresetMounts` 同实例）+ 技能面板 + 按**模型**路由覆盖。

两者不是同一套控制面，直接 merge 会产生大量语义冲突，因此本仓库只做**逐条等价移植**：能独立移植的按提交移植并记录映射，依赖上游专有架构的明确弃用并记录理由（上表）。
