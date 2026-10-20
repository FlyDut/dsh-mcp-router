import Schema from "@deepseek-ai/schemastery";
import { basename, dirname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import { watch } from "node:fs";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/catalog.ts
/** 从完整 tool name 解析 server 段（与 src/index.ts serverOf 一致）。 */
function serverOfMcp(name) {
	if (!name.startsWith("mcp__")) return null;
	const rest = name.slice(5);
	const at = rest.indexOf("__");
	if (at < 0) return null;
	return rest.slice(0, at);
}
/**
* 从 tools.schemas(scope) 的结果里，按 `mcp__<serverName>__` 前缀抽取该 server
* 的全部工具条目。name 是完整工具 id；参数取原样 JSON Schema。
*/
function snapshotFromSchemas(schemas, serverName) {
	const prefix = `mcp__${serverName}__`;
	const out = [];
	for (const schema of schemas) {
		const name = String(schema?.name ?? "");
		if (!name.startsWith(prefix)) continue;
		out.push({
			name,
			description: String(schema?.description ?? ""),
			parameters: schema?.parameters ?? {}
		});
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}
/** 按空白 / 下划线 / 连字符切分小写化。 */
function tokenize(text) {
	return String(text).toLowerCase().split(/[\s_-]+/).filter(Boolean);
}
/** 从工具参数 JSON Schema 提取参数名集合（properties 键）。 */
function paramNamesOf(parameters) {
	const names = /* @__PURE__ */ new Set();
	if (parameters && typeof parameters === "object") {
		const props = parameters.properties;
		if (props && typeof props === "object") for (const key of Object.keys(props)) names.add(key.toLowerCase());
	}
	return names;
}
/**
* 关键词全文检索 top-K。
* 打分：工具名命中 3 / 工具名前缀 2 / 描述命中 2 / 描述前缀 1 / 参数名 1。
* 返回按分数降序（同分按 server、name 字典序稳定）的命中数组。
*
* @param scopedTo 限定单个 server（`query + server` 的「在该 server 内按需检索」）。
*   未找到该 server 时返回空数组 —— 调用方据此区分「无命中」与「server 不存在」。
*/
function searchCatalog(catalog, query, limit = 5, scopedTo) {
	const tokens = tokenize(query);
	if (tokens.length === 0) return [];
	const scored = [];
	const entries = scopedTo === void 0 ? Object.entries(catalog) : catalog[scopedTo] ? [[scopedTo, catalog[scopedTo]]] : [];
	for (const [server, serverInfo] of entries) for (const tool of serverInfo.tools) {
		const nameTokens = tokenize(tool.name);
		const descTokens = tokenize(tool.description);
		const paramTokens = paramNamesOf(tool.parameters);
		let score = 0;
		for (const token of tokens) {
			if (nameTokens.includes(token)) score += 3;
			else if (nameTokens.some((t) => t.startsWith(token))) score += 2;
			if (descTokens.includes(token)) score += 2;
			else if (descTokens.some((t) => t.startsWith(token))) score += 1;
			if (paramTokens.has(token)) score += 1;
		}
		if (score > 0) scored.push({
			hit: {
				server,
				tool
			},
			score
		});
	}
	scored.sort((a, b) => b.score - a.score || a.hit.server.localeCompare(b.hit.server) || a.hit.tool.name.localeCompare(b.hit.tool.name));
	const k = Math.max(1, Math.floor(Number(limit) || 1));
	return scored.slice(0, k).map((s) => s.hit);
}
/**
* 列出某 server 的工具（name + description），支持分页。
*
* 返回三态而非 `Array | undefined`：调用方需要同时知道「server 是否存在」与
* 「共有多少个」—— 只回数组时容易把「分页后的页大小」当成总数（上游 b8b87f9
* 修过这个 bug：27 个工具报 20）。
*/
function listServer(catalog, server, options = {}) {
	const requestedLimit = options.limit === void 0 ? null : Math.max(1, Math.floor(Number(options.limit) || 1));
	const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
	const serverInfo = catalog[server];
	if (!serverInfo) return {
		server,
		found: false,
		totalCount: 0,
		tools: [],
		offset,
		limit: requestedLimit
	};
	const all = serverInfo.tools.map((tool) => ({
		name: tool.name,
		description: tool.description
	}));
	const tools = requestedLimit === null ? all.slice(offset) : all.slice(offset, offset + requestedLimit);
	return {
		server,
		found: true,
		totalCount: all.length,
		tools,
		offset,
		limit: requestedLimit
	};
}
/** catalog 文件路径：<dir>/catalog.json。 */
function catalogFileFor(dir) {
	return `${dir.replace(/[\\/]$/, "")}/catalog.json`;
}
/** 从目录加载 catalog；文件不存在 / 解析失败时返回空 catalog。 */
async function loadCatalog(dir) {
	try {
		const text = await import("node:fs/promises").then((fsp) => fsp.readFile(catalogFileFor(dir), "utf8"));
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		return {};
	} catch {
		return {};
	}
}
/** 原子写回 catalog（tmp + rename，0600）。调用方负责 mkdir。 */
async function saveCatalog(dir, catalog) {
	const fsp = await import("node:fs/promises");
	await fsp.mkdir(dir, { recursive: true });
	const file = catalogFileFor(dir);
	const json = JSON.stringify(catalog, null, 2);
	await fsp.writeFile(`${file}.tmp`, json, {
		encoding: "utf8",
		mode: 384
	});
	await fsp.rename(`${file}.tmp`, file);
}
//#endregion
//#region src/domain/runtime.ts
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
function discoverRuntimeServers(schemas, known) {
	const servers = /* @__PURE__ */ new Map();
	let mcpTools = 0;
	for (const schema of schemas) {
		const name = String(schema?.name ?? "");
		if (!name.startsWith("mcp__")) continue;
		mcpTools += 1;
		const server = serverOfMcp(name);
		if (server === null || known.has(server)) continue;
		servers.set(server, (servers.get(server) ?? 0) + 1);
	}
	return {
		servers,
		mcpTools
	};
}
//#endregion
//#region src/domain/exposure.ts
/** 全部档位（面板渲染顺序：从最曝光到最封闭）。 */
const EXPOSURE_VALUES = [
	"name-only",
	"hidden",
	"off"
];
/** 全部预设模式。 */
const PRESET_MODES = [
	"all",
	"only",
	"except"
];
/** 档位是否为合法值。 */
function isExposure(value) {
	return typeof value === "string" && EXPOSURE_VALUES.includes(value);
}
/** 预设模式是否为合法值。 */
function isPresetMode(value) {
	return typeof value === "string" && PRESET_MODES.includes(value);
}
/** 构造默认策略（未配置过的 server 默认进程常驻索引、按需调用）。 */
function defaultPolicy(exposure = "name-only") {
	return {
		exposure,
		presets: {
			mode: "all",
			ids: []
		},
		disabledTools: []
	};
}
/** 预设 id 列表规范化：仅字符串、去空、去重、排序（稳定输出便于比较与落盘）。 */
function normalizeIds(raw) {
	if (!Array.isArray(raw)) return [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const id = item.trim();
		if (id.length === 0) continue;
		seen.add(id);
	}
	return [...seen].sort();
}
/** 宽容解析预设关联（非法输入回落 `all`）。 */
function normalizePresetScope(raw) {
	if (raw === null || typeof raw !== "object") return {
		mode: "all",
		ids: []
	};
	const obj = raw;
	const mode = isPresetMode(obj.mode) ? obj.mode : "all";
	return {
		mode,
		ids: mode === "all" ? [] : normalizeIds(obj.ids)
	};
}
/** 宽容解析完整策略（缺字段/非法值回落默认；`fallbackExposure` 供 Config 默认档位注入）。 */
function normalizePolicy(raw, fallbackExposure = "name-only") {
	if (raw === null || typeof raw !== "object") return defaultPolicy(fallbackExposure);
	const obj = raw;
	return {
		exposure: isExposure(obj.exposure) ? obj.exposure : fallbackExposure,
		presets: normalizePresetScope(obj.presets),
		disabledTools: normalizeIds(obj.disabledTools)
	};
}
/**
* 该 server 是否对给定 agent 预设开放（运行时隔离的唯一判定点）。
*
* @param scope - 用户配置的预设关联。
* @param presetId - 当前会话运行的 agent 预设 id；`undefined`/`null` 表示该会话没有
*   preset（rosterless 部署）。
*/
function presetAllows(scope, presetId) {
	const id = typeof presetId === "string" && presetId.length > 0 ? presetId : void 0;
	switch (scope.mode) {
		case "all": return true;
		case "only": return id !== void 0 && scope.ids.includes(id);
		case "except": return id === void 0 || !scope.ids.includes(id);
		default: return true;
	}
}
/** 该档位是否期望 loader entry 运行（用户切档位即隐式启停进程）。 */
function desiredRunning(exposure) {
	return exposure === "name-only";
}
/**
* 有效曝光判定 —— 装配层、`dsh_mcp_search`、`dsh_mcp_call`、面板徽标共用这一个函数。
*
* 判定顺序（先隔离、再档位、最后运行态降级）：
* 1. 预设不允许 → `off`（运行时隔离，物理状态不变）；
* 2. `off` / `hidden` 档 → 原样返回；
* 3. `name-only` 档：进程在跑且非 AI 保活窗口 → 原档；否则降级为
*    `hidden`（进程未跑或正被中间层托管：工具不注入，但仍可经 dsh_mcp_call 调用，
*    不静默丢失能力）。
*/
function decideExposure(input) {
	const { policy, running, aiActive, presetId } = input;
	if (!presetAllows(policy.presets, presetId)) return "off";
	switch (policy.exposure) {
		case "off": return "off";
		case "hidden": return "hidden";
		case "name-only": return running && !aiActive ? "name-only" : "hidden";
		default: return "off";
	}
}
/**
* 判定「不可用」的成因（错误文案与面板徽标用）。
*
* @param workspaceMismatch - 项目级 MCP 的所属工作空间与会话工作空间不一致（硬作用域）。
*/
function offReason(policy, presetId, workspaceMismatch = false) {
	if (workspaceMismatch) return "workspace";
	return presetAllows(policy.presets, presetId) ? "exposure" : "preset";
}
/** 该有效曝光下该 server 是否出现在 dsh_mcp_search 的无参摘要表。 */
function listedInSummary(effective) {
	return effective === "name-only";
}
/** 工具注册全名是否被策略禁用（工具级禁用）。 */
function policyDisablesTool(policy, fullName) {
	if (!policy || policy.disabledTools.length === 0) return false;
	return policy.disabledTools.includes(fullName);
}
/**
* 工具级**批量**启停的目标解析（三态契约，纯函数；移植上游 PR#17 特性 1 的 BLOCK-1 修法）。
*
* 契约故意严格 —— 面板「按当前过滤批量操作」在过滤命中 0 项时天然会发 `[]`，
* 若把它当成「全部」，对一个 450 工具的 server 就是一次性全量禁用**并已写盘**，
* 与用户意图完全相反：
* - `toolNames === undefined`（字段缺失）= 全部已知工具，**只有这一种**表示全部；
* - 显式数组 = 精确集合（`[]` 是合法空操作）；
* - 非数组 / 含非字符串项 / 非空却一条都不匹配 = 返回 error（调用方 400），
*   既不静默降级为「全部」，也不静默 no-op。
*/
function resolveToolBulkTargets(raw, known) {
	if (raw === void 0) return {
		targets: [...known],
		ignored: []
	};
	if (!Array.isArray(raw)) return {
		targets: [],
		ignored: [],
		error: "toolNames 必须是字符串数组（省略该字段才表示「全部工具」）"
	};
	const knownSet = new Set(known);
	const wanted = [];
	const ignored = [];
	for (const item of raw) {
		if (typeof item !== "string" || item.length === 0) return {
			targets: [],
			ignored: [],
			error: "toolNames 只能包含非空字符串（工具注册全名 mcp__<server>__<tool>）"
		};
		if (knownSet.has(item)) wanted.push(item);
		else ignored.push(item);
	}
	const targets = [...new Set(wanted)];
	if (targets.length === 0 && raw.length > 0) return {
		targets: [],
		ignored,
		error: `toolNames 里的 ${raw.length} 项都不在当前工具目录中（目录可能已过期，请刷新面板后重试）`
	};
	return {
		targets,
		ignored
	};
}
/** 取/建可变策略槽（迁移内部用）。 */
function slot(table, key) {
	const hit = table[key];
	if (hit) return hit;
	const created = defaultPolicy();
	table[key] = created;
	return created;
}
function mergeTools(policy, tools) {
	if (!Array.isArray(tools)) return;
	const merged = new Set(policy.disabledTools);
	for (const tool of tools) if (typeof tool === "string" && tool.length > 0) merged.add(tool);
	policy.disabledTools = [...merged].sort();
}
/**
* v1 策略 → v2 策略（纯函数，可单测）。
*
* 映射规则：
* - `mcp[file][rowId].desired === true`（用户停用）→ `hidden`（旧 autoManage 开启，
*   停用的 MCP 由中间层按需调用）或 `off`（旧 autoManage 关闭，停用即完全不可用）；
*   `desired === false`（用户启用）→ `name-only`。
* - `projectMcp[workspace][serverName]` 同理（boolean 值即 desired disabled）。
* - `toolDisabled[serverName]` / `projectToolDisabled[workspace][serverName]` →
*   对应策略的 `disabledTools`。
*
* @param source - v1 状态字段。
* @param resolveServerName - 把旧行的 (preset 文件, rowId) 解析为 serverName；
*   返回 undefined 的行走 `unresolved`。
* @param autoManage - 旧全局中间层开关（决定停用态迁移为 hidden 还是 off）。
*/
function migrateV1Policies(source, resolveServerName, autoManage) {
	const servers = {};
	const projects = {};
	const unresolved = [];
	let migrated = 0;
	const stoppedExposure = autoManage ? "hidden" : "off";
	for (const [file, rows] of Object.entries(source.mcp ?? {})) {
		if (!rows || typeof rows !== "object") continue;
		for (const [rowId, entry] of Object.entries(rows)) {
			if (!entry || typeof entry !== "object") continue;
			const serverName = resolveServerName(file, rowId);
			if (serverName === void 0 || serverName.length === 0) {
				unresolved.push(`${file}:${rowId}`);
				continue;
			}
			const desired = entry.desired;
			if (typeof desired !== "boolean") continue;
			slot(servers, serverName).exposure = desired ? stoppedExposure : "name-only";
			migrated += 1;
		}
	}
	for (const [workspace, perServer] of Object.entries(source.projectMcp ?? {})) {
		if (!perServer || typeof perServer !== "object") continue;
		const table = projects[workspace] ??= {};
		for (const [serverName, desired] of Object.entries(perServer)) {
			if (typeof desired !== "boolean") continue;
			slot(table, serverName).exposure = desired ? stoppedExposure : "name-only";
			migrated += 1;
		}
	}
	for (const [serverName, tools] of Object.entries(source.toolDisabled ?? {})) mergeTools(slot(servers, serverName), tools);
	for (const [workspace, perServer] of Object.entries(source.projectToolDisabled ?? {})) {
		if (!perServer || typeof perServer !== "object") continue;
		const table = projects[workspace] ??= {};
		for (const [serverName, tools] of Object.entries(perServer)) mergeTools(slot(table, serverName), tools);
	}
	const sortedServers = {};
	for (const key of Object.keys(servers).sort()) sortedServers[key] = normalizePolicy(servers[key]);
	const sortedProjects = {};
	for (const workspace of Object.keys(projects).sort()) {
		const inner = {};
		for (const key of Object.keys(projects[workspace]).sort()) inner[key] = normalizePolicy(projects[workspace][key]);
		sortedProjects[workspace] = inner;
	}
	return {
		servers: sortedServers,
		projects: sortedProjects,
		migrated,
		unresolved
	};
}
/** v1 状态里是否存在与策略相关的数据（决定是否需要迁移）。 */
function hasV1PolicyData(source) {
	const size = (value) => value && typeof value === "object" ? Object.keys(value).length : 0;
	if (size(source.mcp) > 0) return true;
	if (size(source.projectMcp) > 0) return true;
	if (size(source.toolDisabled) > 0) return true;
	if (size(source.projectToolDisabled) > 0) return true;
	return false;
}
/**
* 判定物化动作（启动早期 `syncPresetFiles` 的唯一决策点，纯函数便于单测）。
*
* @param input.cur - 组合文件里该行当前的 `disabled`（`null` = 无标记；文件里没有该行请先判 skip）。
* @param input.applied - 上次物化账本（`undefined` = 从未物化过）。
* @param input.wantDisabled - 期望的 disabled（由 exposure 的 desiredRunning 派生）。
* @param input.configured - 策略表里是否已有该 server 的意图（false = 首次遇到）。
*/
function decideSyncAction(input) {
	const { cur, applied, wantDisabled, configured } = input;
	if (!configured) return "adopt";
	if (applied !== void 0 && applied !== null && cur !== applied) return "align-ledger";
	if (cur === wantDisabled) return "noop";
	return "materialize";
}
//#endregion
//#region src/mcpcall.ts
/**
* MCP 中间层：模型面恒定 2 个工具 + 控制层。
*
* 模型面：
*   dsh_mcp_search —— 检索私有 catalog（索引 / 列表 / top-K 全文检索），
*                 结果按当前会话的曝光档位与预设关联过滤
*   dsh_mcp_call   —— 按需启用指定 server → 执行工具 → 返回文本结果；
*                 工具名未知时直接返回该 server 的工具清单
*
* 控制层职责：
* - ensureEnabled：从注册表反查 loader entry，disabled 时 update 开启并记录
*   AI owner（写 state.json 的 ai 段）。
* - waitRegistered：轮询 ctx.tools.get + tools/change 事件加速。
* - call：访问判定 → enable → waitRegistered → ctx.tools.execute。失败时若本次
*   AI 启用且无并发则恢复 disabled 并清 owner。
* - 引用计数（Map<serverName, number>）+ 空闲回收器（ctx.interval 每 10s 扫描）。
*
* 可用性判定（曝光档位 + 预设隔离 + 工具级禁用）经 `McpControlCtx.accessOf` 注入，
* 与装配层共用同一套策略真源（`domain/policy.ts`）。
*/
/** 空闲回收器扫描周期（ms）。 */
const REAPER_INTERVAL_MS = 1e4;
/** waitRegistered 轮询间隔（ms）。 */
const REGISTER_POLL_MS = 50;
/**
* 控制工具名（单一事实源）。
*
* ⚠️ 名字**不得以 `mcp_` 开头**：claude.ai 订阅网关把 `mcp_` 前缀当作 connector
* 保留名，工具表里含旧名（`mcp_search` / `mcp_call`）会让整个请求 400 并伪报配额
* 耗尽（上游 PR #16 的 A/B/A 取证：含这两个工具 5/5 全 400，不含 111/111 成功）。
* selftest-mcp.mjs 有护栏断言，防止日后改回去。
*/
const MCP_SEARCH_TOOL = "dsh_mcp_search";
const MCP_CALL_TOOL = "dsh_mcp_call";
/** 中间层注册的两个控制工具名（装配层/网关按此判定控制工具）。 */
const CONTROL_TOOL_NAMES = /* @__PURE__ */ new Set([MCP_SEARCH_TOOL, MCP_CALL_TOOL]);
/**
* 归一化 dsh_mcp_call 的 tool 参数（2026-08-22 修补）：模型可能把 dsh_mcp_search 返回的
* 注册全名（mcp__<server>__<tool>）直接填入 tool，无条件拼接会生成双重前缀。
* 规则：以 mcp__ 开头视为注册全名形态 → 循环剥离本 server 前缀（兼容嵌套重复）；
* 剥完仍以 mcp__ 开头 → 传的是其他 server 的注册全名或格式异常 → 快速失败
* （避免在 waitRegistered 白等满 toolCallTimeoutMs，默认 60s、mimo-image 300s）。
* 注：远端工具裸名恰好以 mcp__ 开头属生态外的病态命名，会被误判，可接受。
*/
function normalizeToolName(serverName, toolName) {
	const prefix = `mcp__${serverName}__`;
	let name = toolName;
	if (name.startsWith("mcp__")) {
		while (name.startsWith(prefix)) name = name.slice(prefix.length);
		if (name.startsWith("mcp__")) throw new Error(`dsh_mcp_call: tool 参数疑似其他 MCP server 的注册全名（${JSON.stringify(toolName)}，server="${serverName}"）；请传该 server 上的裸名（如 understand_image，不带 mcp__ 前缀）`);
	}
	return name;
}
/**
* 归一化 dsh_mcp_call 的 arguments 参数（2026-08-24 修补）：模型直连 Tool call 时倾向把
* 参数字典填成 JSON 字符串（实测 flash 与 mimo 两系均会出现）。这里循环安全解析为对象
* 后再透传。
*
* 2026-09-18：arguments 的 schema 已改为 oneOf[object, string]（见 registerMcpCallTool），
* 其中 string 分支专为保留下面的兼容路径而存在——不能删掉该分支，否则字符串入参会先在
* defineTool 的校验阶段被拒，本函数永远轮不到执行。object 分支已在执行前挡掉
* [] / 42 / null 等错误形态，因此这里只需处理「字符串 → 对象」这一种转换：
* - 值以 { / [ 开头 → 直接按容器 JSON 解析；
* - 值以 " 开头（引号包裹层）→ 解包后若内层仍是容器形态才继续剥，防止误改合法标量入参；
* - 解析失败或非字典形态 → 保留原值交由远端给出可读错误。
*/
function normalizeArguments(raw) {
	let value = raw ?? {};
	let depth = 0;
	while (typeof value === "string" && depth < 4) {
		const trimmed = value.trim();
		if (trimmed.length === 0) return {};
		const head = trimmed.charCodeAt(0);
		const isContainerJson = head === 123 || head === 91;
		const isQuotedJson = head === 34;
		if (!isContainerJson && !isQuotedJson) break;
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			break;
		}
		if (parsed !== null && typeof parsed === "object") return parsed;
		const inner = typeof parsed === "string" ? parsed.trim() : "";
		const innerLooksContainer = inner.startsWith("{") || inner.startsWith("[");
		if (!isQuotedJson || !innerLooksContainer) break;
		value = parsed;
		depth++;
	}
	return value;
}
function msgOf(error) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (error && typeof error === "object") try {
		const text = JSON.stringify(error);
		if (typeof text === "string" && text.length > 0) return text;
	} catch {}
	return String(error);
}
/** 从 execute 结果的 content 块抽取文本（防御式）。 */
function contentText(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) if (block && typeof block === "object") {
		const b = block;
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
		else if (typeof b.text === "string") parts.push(b.text);
	}
	return parts.join("\n").trim();
}
/**
* 组装候选工具视图（2026-08-24 scope 回归第二版修复）：dsh-tools 注册表的
* scope 约定是「agent 对象」而非 `scopeOf(agent.ctx)` 的 ctx 标签——模型面的
* schemas(exec.agent) / 执行面 get(name, agent) 均以 agent 对象为钥匙建立层级链，
* session-boundary 下 MCP 工具注册进该链可达的作用域层；而旧实现用 scopeOf(agent.ctx)
* 查询同一注册表，链条不达 → 全部「未在超时内注册」。现改为直接以 agent 对象为
* 作用域钥匙，与模型面/执行面完全同构；无 agent 时退回全局视图。
*/
function collectToolViews(ctx, agent) {
	const views = [];
	if (agent) views.push({
		label: "agent-object",
		tools: ctx.tools,
		scope: agent
	});
	views.push({
		label: "host-global",
		tools: ctx.tools,
		scope: void 0
	});
	return views;
}
async function ensureEnabled(control, ctx, state, serverName, entry) {
	const wasDisabled = entry.disabled;
	const entryId = entry.id;
	if (wasDisabled) {
		await entry.update({ disabled: false });
		state.aiEnabled.add(serverName);
		await control.setAiOwner(entryId, Date.now());
		ctx.logger.info?.(`dsh-mcp-router: AI enabled MCP server "${serverName}"`);
	}
	return wasDisabled;
}
async function waitRegistered(ctx, name, views, timeoutMs, signal) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		let settled = false;
		let pollTimer;
		let offTools;
		let offAbort;
		let offDispose;
		const onAbort = () => finish(/* @__PURE__ */ new Error("aborted"));
		const finish = (error, view) => {
			if (settled) return;
			settled = true;
			pollTimer?.();
			offTools?.();
			offAbort?.();
			offDispose?.();
			if (error) reject(error);
			else resolve(view);
		};
		const check = () => {
			if (settled) return;
			for (const view of views) {
				if (!view.tools) continue;
				try {
					if (Boolean(view.tools.get(name, view.scope))) {
						ctx.logger.info?.(`dsh-mcp-router: tool "${name}" resolved via view "${view.label}"`);
						return finish(void 0, view);
					}
				} catch {}
			}
			if (Date.now() - start >= timeoutMs) return finish(/* @__PURE__ */ new Error(`tool "${name}" 未在 ${timeoutMs}ms 内注册`));
			pollTimer = ctx.timeout(check, REGISTER_POLL_MS);
		};
		offTools = ctx.root.on("tools/change", () => check());
		offDispose = ctx.effect(() => () => finish(/* @__PURE__ */ new Error("context disposed")), "dsh-mcp-router: waitRegistered");
		if (signal) {
			if (signal.aborted) {
				finish(/* @__PURE__ */ new Error("aborted"));
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			offAbort = () => signal.removeEventListener("abort", onAbort);
		}
		check();
	});
}
/** 失败 / 无并发时恢复原状态：禁用并清 AI owner。 */
async function restore(control, ctx, state, serverName, entryId) {
	if (!state.aiEnabled.has(serverName)) {
		state.refCounts.delete(serverName);
		state.lastUsed.delete(serverName);
		return;
	}
	try {
		const entry = control.resolveEntry(serverName);
		if (entry && entry.id === entryId && !entry.disabled) await entry.update({ disabled: true });
		await control.clearAiOwner(entryId);
	} catch (error) {
		ctx.logger.warn?.(`dsh-mcp-router: restore disabled for "${serverName}" failed: ${msgOf(error)}`);
	} finally {
		state.aiEnabled.delete(serverName);
		state.lastUsed.delete(serverName);
		state.refCounts.delete(serverName);
	}
}
/** 不可调用时的拒绝文案（区分预设隔离 / 档位关闭两种成因）。 */
function blockedText(serverName, access) {
	switch (access.blockedBy) {
		case "preset": return `MCP server "${serverName}" 未对当前 agent 预设（${access.presetId ?? "无预设"}）开放；如需使用，请在 MCP 调整该服务器的预设关联。`;
		case "exposure": return `MCP server "${serverName}" 已被设为「彻底关闭」（off），不可调用；如需使用，请在 MCP 把它的状态改为「全部 / 进程常驻 / 隐藏」。`;
		case "workspace": return `MCP server "${serverName}" 属于另一个工作空间的项目级配置，仅该工作空间的会话可用。`;
		default: return `未知 MCP server：${serverName}（不在注册表中）`;
	}
}
/** 从工具注册全名取裸名（`mcp__<server>__<tool>` → `<tool>`）。 */
function bareNameOf(fullName) {
	const rest = String(fullName).replace(/^mcp__/, "");
	const at = rest.indexOf("__");
	return at < 0 ? rest : rest.slice(at + 2);
}
/**
* 该 server 的工具清单文本（`dsh_mcp_call` 只传 server、或工具名未知时返回）。
* 这是「进程常驻」档位下模型发现工具的主要路径：不必猜名字，直接问。
*/
function toolListText(caches, serverName) {
	const listing = listServer(caches.getCatalog(), serverName);
	if (!listing.found || listing.totalCount === 0) return `MCP server "${serverName}" 目前没有采集到工具目录（可能尚未运行过或该 server 无工具）。可直接用 dsh_mcp_call 指定裸工具名尝试；或用 dsh_mcp_search({ server: "${serverName}" }) 重试。`;
	const lines = listing.tools.map((tool) => `- ${bareNameOf(tool.name)}: ${tool.description || "（无描述）"}`);
	return `MCP server "${serverName}" 的工具清单（共 ${listing.totalCount} 个）：\n${lines.join("\n")}\n\n调用方式：dsh_mcp_call({ server: "${serverName}", tool: "<上面的裸名>", arguments: { ... } })`;
}
function startIdleReaper(control, ctx, state) {
	return ctx.interval(() => {
		const now = Date.now();
		for (const server of [...state.aiEnabled]) {
			if ((state.refCounts.get(server) ?? 0) > 0) continue;
			if (now - (state.lastUsed.get(server) ?? 0) < control.keepAliveMs) continue;
			const entry = control.resolveEntry(server);
			if (!entry) {
				state.aiEnabled.delete(server);
				state.refCounts.delete(server);
				state.lastUsed.delete(server);
				continue;
			}
			const entryId = entry.id;
			(async () => {
				try {
					if (!entry.disabled) await entry.update({ disabled: true });
					if ((state.refCounts.get(server) ?? 0) > 0) return;
					await control.clearAiOwner(entryId);
					ctx.logger.info?.(`dsh-mcp-router: idle-reaped MCP server "${server}"`);
				} catch (error) {
					ctx.logger.warn?.(`dsh-mcp-router: idle reaper disable "${server}" failed: ${msgOf(error)}`);
				} finally {
					if ((state.refCounts.get(server) ?? 0) === 0) {
						state.aiEnabled.delete(server);
						state.refCounts.delete(server);
						state.lastUsed.delete(server);
					}
				}
			})();
		}
	}, REAPER_INTERVAL_MS);
}
/**
* 创建控制层控制器。`caches` 即控制层依赖（McpControlCtx），由 index.ts
* 在 apply 里构建并封闭所有 IO。
*/
function createMcpCallController(ctx, caches) {
	const state = {
		refCounts: /* @__PURE__ */ new Map(),
		lastUsed: /* @__PURE__ */ new Map(),
		aiEnabled: /* @__PURE__ */ new Set()
	};
	return {
		accessFor: (serverName, presetId, workspace) => caches.accessFor(serverName, presetId, workspace),
		async ensureEnabled(serverName) {
			const entry = caches.resolveEntry(serverName);
			if (!entry) throw new Error(`unknown MCP server "${serverName}"`);
			return ensureEnabled(caches, ctx, state, serverName, entry);
		},
		isAiEnabled(serverName) {
			return state.aiEnabled.has(serverName);
		},
		markUserEnabled(serverName) {
			state.aiEnabled.delete(serverName);
			state.refCounts.delete(serverName);
			state.lastUsed.delete(serverName);
			const entry = caches.resolveEntry(serverName);
			if (entry) caches.clearAiOwner(entry.id);
		},
		async call(serverName, toolName, args, agent, signal, explicitTimeoutMs, nesting) {
			const access = caches.accessOf(serverName, agent);
			if (access.blockedBy === "unknown") return `未知 MCP server：${serverName}（不在注册表中）`;
			if (access.effective === "off") return blockedText(serverName, access);
			const rawTool = typeof toolName === "string" ? toolName.trim() : "";
			if (rawTool.length === 0 || rawTool === "*") return toolListText(caches, serverName);
			const bareTool = normalizeToolName(serverName, rawTool);
			const name = `mcp__${serverName}__${bareTool}`;
			if (policyDisablesTool(access.policy, name)) return `MCP 工具 ${serverName}.${bareTool} 已被禁用（请在 MCP 打开该工具后再调用）`;
			const entry = caches.resolveEntry(serverName);
			const ref = access.ref;
			const presetTimeout = caches.presetTimeoutMs ? await caches.presetTimeoutMs(serverName).catch(() => void 0) : void 0;
			const timeoutMs = explicitTimeoutMs ?? presetTimeout ?? caches.serverTimeoutMs(serverName);
			let aiOwned = false;
			if (entry) {
				try {
					aiOwned = await ensureEnabled(caches, ctx, state, serverName, entry);
				} catch (error) {
					return `启用 MCP server "${serverName}" 失败：${msgOf(error)}`;
				}
				state.refCounts.set(serverName, (state.refCounts.get(serverName) ?? 0) + 1);
				state.lastUsed.set(serverName, Date.now());
			} else if (access.ref === void 0) {} else if (!ref || !ref.running || ref.disabled) return `MCP server "${serverName}" 当前未运行，且它的行不在 loader 中（预设组合行）——无法即时保活启用。请在 MCP 把它切换为「全部」或「进程常驻」后重启 DSH 生效。`;
			let failed = false;
			try {
				const result = await (await waitRegistered(ctx, name, collectToolViews(ctx, agent), timeoutMs, signal)).tools.execute({
					callId: `mcp-call-${randomUUID()}`,
					...nesting?.rootCallId === void 0 ? {} : { rootCallId: nesting.rootCallId },
					...nesting?.token === void 0 ? {} : { parent: nesting.token },
					name,
					arguments: args,
					agent,
					signal
				});
				if (entry) state.lastUsed.set(serverName, Date.now());
				if (result && result.isError) {
					failed = true;
					return `MCP ${serverName}.${bareTool} 调用失败：${msgOf(result.error ?? "unknown error")}`;
				}
				const text = contentText(result ? result.content : void 0);
				return text.length > 0 ? text : `MCP ${serverName}.${bareTool} 无返回内容`;
			} catch (error) {
				failed = true;
				return `MCP ${serverName}.${bareTool} 调用异常：${msgOf(error)}（提示：tool 参数应传该 server 上的裸名；不确定工具名时可用 dsh_mcp_call 只传 server 获取工具清单）`;
			} finally {
				if (entry) {
					const next = (state.refCounts.get(serverName) ?? 1) - 1;
					if (next <= 0) state.refCounts.delete(serverName);
					else state.refCounts.set(serverName, next);
					if (failed && aiOwned && next <= 0) restore(caches, ctx, state, serverName, entry.id);
				}
			}
		},
		startIdleReaper() {
			return startIdleReaper(caches, ctx, state);
		},
		status() {
			const out = [];
			for (const server of state.aiEnabled) out.push({
				server,
				refCount: state.refCounts.get(server) ?? 0,
				lastUsed: state.lastUsed.get(server) ?? 0
			});
			out.sort((a, b) => a.server.localeCompare(b.server));
			return out;
		}
	};
}
function clampLimit(value, defaultValue, max) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return defaultValue;
	return Math.min(Math.floor(value), max);
}
/** 摘要截断长度：dsh_mcp_search 空查询的输出 token 控制（P2-5）。 */
const SUMMARY_MAX_LEN = 80;
/** server=X 的能力摘要：只预览前 N 个工具名（移植上游 18576e4，防一次回吐上百工具）。 */
const LIST_PREVIEW_COUNT = 5;
/** all:true 返回完整清单时的默认页大小与上限。 */
const LIST_PAGE_DEFAULT = 20;
const LIST_PAGE_MAX = 100;
function buildSummary(control) {
	const catalog = control.getCatalog();
	const merged = { ...control.serverSummary };
	const lines = [];
	const seen = /* @__PURE__ */ new Set();
	for (const [server, summary] of Object.entries(merged)) {
		if (seen.has(server)) continue;
		seen.add(server);
		lines.push({
			server,
			summary
		});
	}
	for (const server of Object.keys(catalog)) {
		if (seen.has(server)) continue;
		seen.add(server);
		const first = catalog[server]?.tools?.[0];
		const raw = first ? String(first.description) : "MCP server";
		const summary = raw.length > SUMMARY_MAX_LEN ? `${raw.slice(0, SUMMARY_MAX_LEN)}…` : raw;
		lines.push({
			server,
			summary
		});
	}
	lines.sort((a, b) => a.server.localeCompare(b.server));
	return lines;
}
/** server=X 分支的结果构造（纯函数，selftest 表驱动：防「一次回吐全表」的上下文膨胀）。 */
function buildServerListingResult(input) {
	const total = input.visible.length;
	if (!input.all) {
		const preview = input.visible.slice(0, LIST_PREVIEW_COUNT);
		return {
			ok: true,
			kind: "list",
			server: input.server,
			found: input.found,
			count: total,
			preview: preview.map((tool) => ({
				name: bareNameOf(tool.name),
				description: tool.description
			})),
			truncated: total > preview.length,
			hint: total > preview.length ? `仅显示前 ${LIST_PREVIEW_COUNT} 个；完整清单请传 all:true（分页），或直接 query+server 检索具体工具` : null
		};
	}
	const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
	const requested = Math.min(Math.max(1, Math.floor(Number(input.pageSize) || LIST_PAGE_DEFAULT)), LIST_PAGE_MAX);
	const page = input.visible.slice(offset, offset + requested);
	return {
		ok: true,
		kind: "list",
		server: input.server,
		found: input.found,
		count: total,
		offset,
		limit: requested,
		tools: page,
		hasMore: offset + page.length < total
	};
}
function registerMcpSearchTool(ctx, control) {
	const definition = defineTool({
		name: MCP_SEARCH_TOOL,
		description: `检索可用的 MCP 服务器与工具目录（只读，不执行）。四种用法：① 空参数 → 当前会话可用的服务器索引；② server=X → 该 server 的**能力摘要**（工具总数 + 前 ${LIST_PREVIEW_COUNT} 个名字预览，默认不返回全表）；③ query + server → **在该 server 内**按需检索 top-K 命中（含完整 schema），想找某个 server 上的具体工具就用这个；④ query → 全目录关键词检索。查到工具名后用 dsh_mcp_call(server, tool, arguments) 调用；不要用 ② 拉全表（只有 all:true 才返回完整清单，且分页）。只返回对当前 agent 预设开放且未彻底关闭的服务器。`,
		parameters: {
			query: {
				type: "string",
				description: "检索关键词，按工具名/描述/参数名打分"
			},
			server: {
				type: "string",
				description: `目标 MCP server 名。单独传 = 返回能力摘要（工具总数 + 前 ${LIST_PREVIEW_COUNT} 个名字预览）；与 query 同传 = 只在该 server 内检索`
			},
			all: {
				type: "boolean",
				description: "仅在传 server 时有效：true = 返回该 server 的完整工具清单（分页，可能很大）。默认 false 只给摘要"
			},
			limit: {
				type: "integer",
				description: "query 检索的 top-K 上限（默认 5，最大 10）；all:true 分页时表示页大小（默认 20，最大 100）"
			},
			offset: {
				type: "integer",
				description: "配合 all:true 的分页起点（默认 0）"
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		execute: async (args, exec) => {
			const catalog = control.getCatalog();
			const agent = exec?.agent;
			const query = typeof args.query === "string" ? args.query.trim() : "";
			const server = typeof args.server === "string" ? args.server.trim() : "";
			const limit = clampLimit(typeof args.limit === "number" ? args.limit : void 0, control.searchLimitDefault, control.searchLimitMax);
			const access = (name) => control.accessOf(name, agent);
			const searchable = (name) => access(name).effective !== "off";
			const keepTool = (name) => !policyDisablesTool(access(serverOfMcp(name) ?? "").policy, name);
			if (server && !searchable(server)) return toJson({
				ok: false,
				kind: query ? "search" : "list",
				server,
				found: false,
				error: blockedText(server, access(server))
			});
			if (server && query) {
				const hits = searchCatalog(catalog, query, limit, server).filter((hit) => keepTool(hit.tool.name));
				return toJson({
					ok: true,
					kind: "search",
					server,
					query,
					count: hits.length,
					limit,
					hits
				});
			}
			if (server) {
				const listing = listServer(catalog, server);
				const visible = listing.tools.filter((tool) => keepTool(tool.name));
				return toJson(buildServerListingResult({
					server,
					found: listing.found,
					visible,
					all: args.all === true,
					offset: typeof args.offset === "number" ? args.offset : void 0,
					pageSize: typeof args.limit === "number" ? args.limit : void 0
				}));
			}
			if (query) {
				const hits = searchCatalog(catalog, query, limit).filter((hit) => searchable(hit.server)).filter((hit) => keepTool(hit.tool.name));
				return toJson({
					ok: true,
					kind: "search",
					query,
					count: hits.length,
					limit,
					hits
				});
			}
			const rows = buildSummary(control);
			const listed = [];
			let hiddenCount = 0;
			for (const row of rows) {
				const effective = access(row.server).effective;
				if (!listedInSummary(effective)) {
					if (effective === "hidden") hiddenCount += 1;
					continue;
				}
				listed.push({
					server: row.server,
					summary: row.summary
				});
			}
			return toJson({
				ok: true,
				kind: "summary",
				summary: listed.map((row) => `- ${row.server}: ${row.summary}`).join("\n"),
				servers: listed,
				count: listed.length,
				hiddenCount,
				hiddenHint: hiddenCount > 0 ? `另有 ${hiddenCount} 个 MCP 服务器未列出，可用关键词检索` : null
			});
		}
	});
	return ctx.tools.register(definition);
}
/** 把运行时对象投影为 JsonValue（工具 schema 本身是 JSON，转换是安全的）。 */
function toJson(value) {
	return JSON.parse(JSON.stringify(value));
}
function registerMcpCallTool(ctx, controller) {
	const definition = defineTool({
		name: MCP_CALL_TOOL,
		description: "调用一个 MCP 服务器上的工具。自动保活启用目标 server（用完按 keepAliveMs 空闲回收），等待注册后在下层执行。参数透传给远端工具。",
		parameters: {
			server: {
				type: "string",
				required: true,
				description: "MCP 服务器名（见 dsh_mcp_search 摘要）"
			},
			tool: {
				type: "string",
				required: true,
				description: "该 server 上的工具名（裸名，如 understand_image；误传注册全名 mcp__<server>__<tool> 会自动归一化）"
			},
			arguments: {
				oneOf: [{
					type: "object",
					additionalProperties: true
				}, { type: "string" }],
				description: "传给工具的参数字典（JSON 对象，如 {\"url\":\"https://example.com\"}）。无参数工具可省略本字段或传 {}。"
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		execute: (args, exec) => {
			return controller.call(args.server, args.tool, normalizeArguments(args.arguments), exec.agent, exec.signal, void 0, {
				token: exec.token,
				rootCallId: exec.rootCallId
			});
		}
	});
	return ctx.tools.register(definition);
}
/**
* 注册 dsh_mcp_search + dsh_mcp_call 两个模型工具。`controller` 必须是调用方持有的唯一
* 控制层实例（与空闲回收器共享同一引用计数/owner 状态），否则回收与调用不同步。
* 返回合并 disposer。
*/
function installMcpControlTools(ctx, control, controller) {
	return ctx.effect(() => {
		const disposers = [];
		try {
			disposers.push(registerMcpSearchTool(ctx, control));
			disposers.push(registerMcpCallTool(ctx, controller));
		} catch (error) {
			for (const d of disposers) d();
			throw error;
		}
		return () => {
			for (const d of disposers) d();
		};
	}, "dsh-mcp-router: mcp control tools");
}
//#endregion
//#region src/mcp-entry.ts
/** 判定 loader entry 是否为 MCP 行（dsh-mcp-client 或带 serverName 配置的行）。 */
function isMcpEntry(entry) {
	if (entry.options.group) return false;
	const cfg = entry.options.config;
	return entry.options.name === "@deepseek-ai/dsh-mcp-client" || cfg !== null && typeof cfg === "object" && "serverName" in cfg;
}
/** 取 MCP 行的 serverName（config.serverName 缺省回落 entry id）。 */
function serverNameOf(entry) {
	const cfg = entry.options.config;
	return String(cfg?.serverName ?? entry.options.id);
}
/** 取 MCP 行的 config（供 transport / toolCallTimeoutMs 读取）。 */
function mcpEntryConfig(entry) {
	const cfg = entry.options.config;
	return cfg !== null && typeof cfg === "object" ? cfg : null;
}
//#endregion
//#region src/domain/session-scope.ts
/** 从 agent 对象读当前运行的 preset id（无 agent / 服务不可用 → undefined）。 */
function agentPresetId(ctx, agent) {
	const agentCtx = agent?.ctx;
	if (!agentCtx) return void 0;
	try {
		const id = ctx.agentPresets.composedPreset(agentCtx);
		return typeof id === "string" && id.length > 0 ? id : void 0;
	} catch {
		return;
	}
}
/** 从 agent 对象读会话工作空间 cwd（无 agent → undefined）。 */
function agentWorkspace(agent) {
	const cwd = agent?.session?.header?.cwd;
	return typeof cwd === "string" && cwd.length > 0 ? cwd : void 0;
}
/**
* 最近一次会话作用域（进程级单例）。
*
* 与 `project-mcp.ts` 的 activeWorkspace 同一套路：HTTP 请求路径下 `ctx.agents`
* 的 roots/list 可能为空（历史实测的服务视图限制），此时面板需要退回到「最近一次
* 已知会话」的 preset/工作空间来展示生效档位与预设隔离结果，而不是错误地按
* 「无 preset」判定（那会把 `only` 模式的服务器显示成被隔离）。
*/
let lastPresetId;
let lastWorkspace;
/** 会话边界记录最近作用域（index.ts 的 agent/created 监听调用）。 */
function rememberSessionScope(presetId, workspace) {
	if (presetId !== void 0) lastPresetId = presetId;
	if (workspace !== void 0) lastWorkspace = workspace;
}
/** 读最近一次会话作用域（面板兜底）。 */
function lastSessionScope() {
	return {
		presetId: lastPresetId,
		workspace: lastWorkspace
	};
}
/** Windows 下路径比较忽略大小写（c:\ 与 C:\ 视为同一工作区）。 */
function sameWorkspace(a, b) {
	if (a === void 0 || b === void 0) return false;
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
//#endregion
//#region src/util.ts
/** 通用小工具（index / collect / routes 共用）。 */
/** 把未知错误投影为可读字符串（日志与 HTTP 错误响应）。 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/mcp-convert.ts
/** dsh-mcp-client 的 serverName 约束（存活实例全局唯一 + 命名长度）。 */
const SERVER_NAME_PATTERN$1 = /^[A-Za-z0-9_-]{1,32}$/;
/** `${VAR}` 环境变量占位（VAR 为 JS 标识符）。 */
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** dsh-mcp-client 的插件包名。 */
const MCP_CLIENT_NAME = "@deepseek-ai/dsh-mcp-client";
function isPlainObject$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function str(value) {
	return typeof value === "string" ? value : void 0;
}
/**
* 字符串数组：number/boolean 项强制转字符串（同行 harness 常见，如 args: [3000]），
* 其余非标量项跳过并记警告——不再静默清空整个数组。
*/
function strArray(value, warnings, label) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const item of value) if (typeof item === "string") out.push(item);
	else if (typeof item === "number" || typeof item === "boolean") {
		out.push(String(item));
		warnings.push(`${label}: ${typeof item} 项已转为字符串 "${String(item)}"`);
	} else warnings.push(`${label}: 忽略非标量项（${Array.isArray(item) ? "array" : typeof item}）`);
	return out;
}
/**
* 字符串字典：number/boolean 值强制转字符串（如 env: { PORT: 3000 }），
* 其余非标量值跳过并记警告——不再静默清空整个字段。
*/
function strDict(value, warnings, label) {
	if (!isPlainObject$1(value)) return void 0;
	const out = {};
	for (const [key, item] of Object.entries(value)) if (typeof item === "string") out[key] = item;
	else if (typeof item === "number" || typeof item === "boolean") {
		out[key] = String(item);
		warnings.push(`${label}.${key}: ${typeof item} 值已转为字符串 "${String(item)}"`);
	} else warnings.push(`${label}.${key}: 忽略非标量值（${Array.isArray(item) ? "array" : typeof item}）`);
	return out;
}
/** 解析单个 server 配置；失败返回错误文案。 */
function parseServer(name, value, warnings) {
	if (!SERVER_NAME_PATTERN$1.test(name)) return { error: `server "${name}": serverName 需匹配 [A-Za-z0-9_-]{1,32}` };
	if (!isPlainObject$1(value)) return { error: `server "${name}": 配置需为对象` };
	const cfg = value;
	const explicit = String(cfg.type ?? cfg.transport ?? "").toLowerCase();
	const command = str(cfg.command);
	const url = str(cfg.url);
	let transport;
	if (explicit === "stdio" || explicit === "command") transport = "stdio";
	else if (explicit === "streamable-http" || explicit === "http" || explicit === "sse") transport = "streamable-http";
	else if (command !== void 0) transport = "stdio";
	else if (url !== void 0) transport = "streamable-http";
	if (transport === void 0) return { error: `server "${name}": 无法推断传输方式（需要 command=stdio 或 url=http）` };
	const toolCallTimeoutMs = typeof cfg.toolCallTimeoutMs === "number" && Number.isFinite(cfg.toolCallTimeoutMs) ? cfg.toolCallTimeoutMs : void 0;
	if (transport === "stdio") {
		if (command === void 0) return { error: `server "${name}": stdio 需要 command` };
		const label = `server "${name}"`;
		return {
			serverName: name,
			transport,
			command,
			args: strArray(cfg.args, warnings, `${label}.args`) ?? [],
			env: strDict(cfg.env, warnings, `${label}.env`) ?? {},
			cwd: str(cfg.cwd),
			toolCallTimeoutMs
		};
	}
	if (url === void 0) return { error: `server "${name}": http 需要 url` };
	return {
		serverName: name,
		transport,
		url,
		headers: strDict(cfg.headers, warnings, `server "${name}".headers`) ?? {},
		toolCallTimeoutMs
	};
}
/**
* 解析 mcpServers JSON 文本。
* 同时接受 `{ "mcpServers": {...} }` 与直接 `{ <name>: {...} }` 两种形态。
*/
function parseMcpServersJson(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return {
			servers: {},
			errors: [`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`],
			warnings: []
		};
	}
	if (!isPlainObject$1(raw)) return {
		servers: {},
		errors: ["期望 JSON 对象（mcpServers 映射）"],
		warnings: []
	};
	const map = isPlainObject$1(raw.mcpServers) ? raw.mcpServers : raw;
	const servers = {};
	const errors = [];
	const warnings = [];
	for (const [name, value] of Object.entries(map)) {
		const parsed = parseServer(name, value, warnings);
		if ("error" in parsed) {
			errors.push(parsed.error);
			continue;
		}
		servers[name] = parsed;
	}
	return {
		servers,
		errors,
		warnings
	};
}
/** 字符串是否含 `${VAR}` 环境变量占位。 */
function hasEnvRef(value) {
	ENV_REF.lastIndex = 0;
	return ENV_REF.test(value);
}
/** 把含 `${VAR}` 的字符串转成 JS 模板字面量文本（`!!js` 表达式体）。 */
function toJsTemplate(value) {
	return `\`${value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/'/g, "\\'").replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "${process.env.$1}")}\``;
}
/** 运行时解析 `${VAR}` → process.env 值；缺失的保留占位符原样（远端报可见错误）。 */
function resolveEnvRefs(value) {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
		const env = process.env[name];
		return env !== void 0 ? env : `\${${name}}`;
	});
}
/** 递归解析对象内所有字符串值的 ${VAR}（挂载时调用）。 */
function resolveServersEnv(servers) {
	const out = {};
	for (const [name, server] of Object.entries(servers)) {
		const copy = { ...server };
		if (copy.command !== void 0) copy.command = resolveEnvRefs(copy.command);
		if (copy.cwd !== void 0) copy.cwd = resolveEnvRefs(copy.cwd);
		if (copy.url !== void 0) copy.url = resolveEnvRefs(copy.url);
		if (copy.env) {
			const env = {};
			for (const [key, item] of Object.entries(copy.env)) env[key] = resolveEnvRefs(item);
			copy.env = env;
		}
		if (copy.headers) {
			const headers = {};
			for (const [key, item] of Object.entries(copy.headers)) headers[key] = resolveEnvRefs(item);
			copy.headers = headers;
		}
		if (copy.args) copy.args = copy.args.map((item) => resolveEnvRefs(item));
		out[name] = copy;
	}
	return out;
}
/** 把 McpServers 转成 dsh-mcp-client 插件行（loader entry 形状）。 */
function serversToRows(servers, idPrefix = "mcp") {
	const rows = [];
	for (const server of Object.values(servers)) {
		const config = {
			transport: server.transport,
			serverName: server.serverName
		};
		if (server.transport === "stdio") {
			config.command = server.command;
			if (server.args && server.args.length > 0) config.args = server.args;
			if (server.env && Object.keys(server.env).length > 0) config.env = server.env;
			if (server.cwd) config.cwd = server.cwd;
		} else {
			config.url = server.url;
			if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers;
		}
		if (server.toolCallTimeoutMs !== void 0) config.toolCallTimeoutMs = server.toolCallTimeoutMs;
		rows.push({
			id: `${idPrefix}-${server.serverName}`,
			name: MCP_CLIENT_NAME,
			config
		});
	}
	return rows;
}
/** JSON 双引号字符串是合法 YAML 标量（内嵌转义由 JSON.stringify 处理）。 */
function yamlString(value) {
	return JSON.stringify(value);
}
/** 单个字符串值 → YAML 标量：含 ${VAR} → `!!js` 模板表达式；否则 JSON 字符串。 */
function yamlScalar(value) {
	if (!hasEnvRef(value)) return yamlString(value);
	return `!!js '${toJsTemplate(value).replace(/'/g, "''")}'`;
}
/** 迷你 YAML 序列化：对象/数组/字符串/数字/布尔（配置结构简单，无需完整 YAML 库）。 */
function emitYaml(obj, indent) {
	const out = [];
	for (const [key, value] of Object.entries(obj)) {
		if (value === void 0) continue;
		if (isPlainObject$1(value)) {
			out.push(`${indent}${key}:`);
			out.push(...emitYaml(value, `${indent}  `));
		} else if (Array.isArray(value)) {
			out.push(`${indent}${key}:`);
			for (const item of value) out.push(`${indent}  - ${yamlScalar(String(item))}`);
		} else if (typeof value === "string") out.push(`${indent}${key}: ${yamlScalar(value)}`);
		else out.push(`${indent}${key}: ${String(value)}`);
	}
	return out;
}
/**
* 把 config 映射拆成「逐顶层键的 YAML 行」——每项的 `body` 相对 config 子键缩进
* （可含内部嵌套缩进），供组合文件的文本级替换使用（`composition-file.ts`）。
*/
function configKeyBodies(config) {
	const out = [];
	for (const [name, value] of Object.entries(config)) {
		if (value === void 0) continue;
		out.push({
			name,
			body: emitYaml({ [name]: value }, "")
		});
	}
	return out;
}
/** 生成全局 profile 可追加的 `- insert:` patch 块（dsh-mcp-client 行，!!js 环境插值）。 */
function serversToPatchYaml(servers) {
	const lines = [];
	for (const row of serversToRows(servers)) {
		lines.push("- insert:");
		lines.push(`    - id: ${row.id}`);
		lines.push(`      name: '${row.name.replace(/'/g, "''")}'`);
		lines.push("      config:");
		lines.push(...emitYaml(row.config, "        "));
	}
	return lines.join("\n") + "\n";
}
//#endregion
//#region src/state.ts
/**
* state.json 持久化（~/.dsh/dsh-mcp-router/state.json）。
*
* v2 结构（当前）：
* - `servers`  ：全局 MCP 的策略（曝光档位 + 预设关联 + 工具级禁用 + 物化账本）
* - `projects` ：项目级 MCP 的策略（工作空间 → serverName → 策略）
* - `ai`       ：AI 保活标记（entryId → 上次启用时间）
* - `config`   ：面板可写的插件配置（生效时机）
*
* v1 → v2 迁移由 `src/domain/policy.ts` 在插件启动早期执行一次（需要 loader/preset
* 文件解析 serverName），v1 字段类型保留在本文件仅供迁移读取；迁移写回后不再出现。
*
* 内存态 + 写队列合并（P1-4）：启动加载一次，高频写（dsh_mcp_call 连击的 ai 标记）
* 串行合并落盘，避免每次读+写各一次文件 IO。
*/
const STATE_DIR = join(homedir(), ".dsh", "dsh-mcp-router");
/** 历史目录（独立分叉前叫 dsh-mcp-panel；0.6.0 之前叫 dsh-mcp-skill-panel、0.2.0 之前叫 dsh-runtime-inventory）。 */
const LEGACY_STATE_DIRS = [
	join(homedir(), ".dsh", "dsh-mcp-panel"),
	join(homedir(), ".dsh", "dsh-mcp-skill-panel"),
	join(homedir(), ".dsh", "dsh-runtime-inventory")
];
const STATE_FILE = join(STATE_DIR, "state.json");
/** 当前生效时机（缺省 immediate）。 */
function stateApplyMode(state) {
	return state.config?.applyMode === "next-session" ? "next-session" : "immediate";
}
let stateCache = null;
let stateDirty = false;
let stateWriteChain = Promise.resolve();
async function readState() {
	if (stateCache) return stateCache;
	let parsed;
	try {
		parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
	} catch {
		await backupCorruptState();
		parsed = await migrateDataDir() ?? {};
	}
	stateCache = parsed;
	return parsed;
}
/** 当前 state.json 存在但解析失败时备份一份（不覆盖已有备份）。 */
async function backupCorruptState() {
	try {
		const raw = await readFile(STATE_FILE, "utf8");
		await mkdir(STATE_DIR, { recursive: true });
		await writeFile(join(STATE_DIR, "state.corrupt.json"), raw, {
			encoding: "utf8",
			mode: 384
		});
	} catch {}
}
/**
* 把历史数据目录整体搬到当前目录（幂等；当前目录已有 state.json 时直接返回其内容）。
* 迁移内容：state.json（策略与状态）+ catalog.json（工具目录 last-good 快照）。
*/
async function migrateDataDir() {
	for (const legacyDir of LEGACY_STATE_DIRS) {
		const legacyState = join(legacyDir, "state.json");
		try {
			const text = await readFile(legacyState, "utf8");
			await mkdir(STATE_DIR, { recursive: true });
			await rename(legacyState, STATE_FILE);
			try {
				await rename(join(legacyDir, "catalog.json"), join(STATE_DIR, "catalog.json"));
			} catch {}
			return JSON.parse(text);
		} catch {}
	}
}
async function writeState(state) {
	stateCache = state;
	stateDirty = true;
	stateWriteChain = stateWriteChain.catch(() => {}).then(async () => {
		if (!stateDirty) return;
		stateDirty = false;
		const current = stateCache ?? state;
		await mkdir(STATE_DIR, { recursive: true });
		await writeFile(`${STATE_FILE}.tmp`, JSON.stringify(current, null, 2), "utf8");
		await rename(`${STATE_FILE}.tmp`, STATE_FILE);
	});
	await stateWriteChain;
}
/** 状态文件路径（诊断端点与迁移备份用）。 */
function stateFilePath() {
	return STATE_FILE;
}
/** 状态文件所在目录（catalog.json 同目录）。 */
function stateDir() {
	return STATE_DIR;
}
/** AI-owner 标记读写：state.json 的 ai 段（entryId → {at}）。 */
async function setStateAiOwner(entryId, at) {
	const state = await readState();
	state.ai ??= {};
	state.ai[entryId] = { at };
	await writeState(state);
}
async function clearStateAiOwner(entryId) {
	const state = await readState();
	if (!state.ai || !(entryId in state.ai)) return;
	delete state.ai[entryId];
	await writeState(state);
}
//#endregion
//#region src/project-mcp.ts
/** 工作空间根下项目 MCP 的固定目录。 */
const MCPS_DIR = ".dsh/mcps";
/** watcher 去抖窗口（合并文件批量写）。 */
const RESCAN_DEBOUNCE_MS = 200;
/** serverName → 所属工作空间根（仅本项目 MCP 行；全局行不在表内）。 */
const projectOwners = /* @__PURE__ */ new Map();
/** 最近一次会话进入的工作空间（随会话切换更新；面板添加项目 MCP 的目标工作区）。 */
let activeWorkspace = null;
/** 查询某 serverName 是否为本项目 MCP 行及其所属工作空间（collect/面板集成用）。 */
function projectServerOwner(serverName) {
	return projectOwners.get(serverName);
}
/** 最近一次会话进入的工作空间（add project 目标 + 面板展示当前工作区）。 */
function getActiveWorkspace() {
	return activeWorkspace;
}
const workspaces = /* @__PURE__ */ new Map();
async function isDirectory(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
async function fileExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
/** 递归收集 `dir` 下所有子目录（含 dir 本身）的 mcp.json：根目录文件在前、子目录按路径序。 */
async function collectMcpJsonFiles(dir, out) {
	if (await fileExists(join(dir, "mcp.json"))) out.push(join(dir, "mcp.json"));
	let names = [];
	try {
		names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	} catch {
		return;
	}
	for (const name of names) await collectMcpJsonFiles(join(dir, name), out);
}
/**
* 扫描工作空间的项目 MCP 配置：根目录 mcp.json 优先，子目录覆盖（后写覆盖先写）。
* 目录不存在 → 空。解析错误经 warn 回调上报、跳过该文件。
* 纯文件系统逻辑（不依赖 ctx），可被 selftest 用临时目录覆盖。
*/
async function scanWorkspaceMcp(root, warn) {
	const mcpsDir = join(root, MCPS_DIR);
	if (!await isDirectory(mcpsDir)) return {};
	const files = [];
	await collectMcpJsonFiles(mcpsDir, files);
	const servers = {};
	for (const file of files) {
		let text;
		try {
			text = await readFile(file, "utf8");
		} catch (error) {
			warn?.(`读取项目 MCP 配置失败 ${file}: ${messageOf(error)}`);
			continue;
		}
		const parsed = parseMcpServersJson(text);
		for (const error of parsed.errors) warn?.(`${file}: ${error}`);
		for (const warning of parsed.warnings) warn?.(`${file}: ${warning}`);
		for (const [name, server] of Object.entries(parsed.servers)) servers[name] = server;
	}
	return servers;
}
/** 工作空间根的稳定 id 前缀（djb2 hash，避免跨工作空间 entry id 冲突）。 */
function projectIdPrefix(root) {
	let hash = 5381;
	for (let i = 0; i < root.length; i += 1) hash = (hash << 5) + hash + root.charCodeAt(i) >>> 0;
	return `projmcp-${hash.toString(16).padStart(8, "0")}`;
}
/**
* 项目 MCP 的 serverName 重命名：追加<路径哈希 8 位 hex>后缀。
*
* 背景（2026-08-27 用户需求）：不同工作区可能配置「同 serverName 但路径参数不同」
* 的项目 MCP（如各自 codegraph 指向不同仓库）。dsh-mcp-client 的 serverName 全进程
* 唯一，同名会互相挤占 → 后挂载的工作区会拿到前者的路径配置、调用必然失败。
* 给 serverName 追加确定性路径后缀后，不同工作区 = 不同 serverName = 各自独立实例。
*
* 形态：`<原名>-<8位hex>`（如 codegraph-e5f6a7b8，原名领先更可读）。
* 约束：serverName 限 `[A-Za-z0-9_-]{1,32}`,后缀 8 位 hex + 分隔符 `-`;
* 原名超过 23 字符时截断尾部（保留头部可读性），总长收敛到 ≤32。
*/
function projectServerName(root, name) {
	let hash = 5381;
	for (let i = 0; i < root.length; i += 1) hash = (hash << 5) + hash + root.charCodeAt(i) >>> 0;
	const suffix = `${hash.toString(16).padStart(8, "0")}`;
	return `${name.slice(0, 23)}-${suffix}`;
}
/** 对比配置变化（loader.update 的 diff 需要；JSON 序列化足够判等）。 */
function configChanged(a, b) {
	return JSON.stringify(a) !== JSON.stringify(b);
}
/**
* 项目 MCP 行构建：原始 mcpServers 配置 → dsh-mcp-client 行，
* 并把 serverName 重命名为带路径哈希前缀（不同工作区同名 server 拆成独立实例）。
* entry id 仍由 projectIdPrefix（同样含路径 hash）保证跨工作区唯一，无需重复缀加。
*/
function buildRows(root, servers) {
	const rows = serversToRows(resolveServersEnv(servers), projectIdPrefix(root));
	for (const row of rows) {
		const raw = String(row.config.serverName ?? "");
		row.config.serverName = projectServerName(root, raw);
	}
	return rows;
}
/** 按行集合同步该工作空间已挂载的条目：删多出的、更新变化的、新建缺的。
* 期望进程状态由策略层派生（exposure → desiredRunning），与面板档位一致。 */
async function syncRows(ctx, state, rows, policy) {
	const wanted = new Map(rows.map((row) => [String(row.config.serverName), row]));
	const intentOf = (serverName) => !desiredRunning(policy.effective(serverName, state.root).exposure);
	for (const [serverName, entryId] of [...state.entries]) {
		if (wanted.has(serverName)) continue;
		try {
			await ctx.loader.remove(entryId);
		} catch (error) {
			ctx.logger.warn?.(`dsh-mcp-router: 卸载项目 MCP "${serverName}" 失败: ${messageOf(error)}`);
		}
		state.entries.delete(serverName);
		projectOwners.delete(serverName);
	}
	for (const [serverName, row] of wanted) {
		const existingId = state.entries.get(serverName);
		if (existingId) {
			try {
				const entry = ctx.loader.resolve(existingId);
				const wantDisabled = intentOf(serverName);
				if (entry && (configChanged(entry.options.config, row.config) || Boolean(entry.disabled) !== wantDisabled)) await ctx.loader.update(existingId, {
					...row,
					disabled: wantDisabled
				});
			} catch (error) {
				ctx.logger.warn?.(`dsh-mcp-router: 更新项目 MCP "${serverName}" 失败: ${messageOf(error)}`);
			}
			continue;
		}
		try {
			await ctx.loader.create({
				...row,
				disabled: intentOf(serverName)
			});
			state.entries.set(serverName, row.id);
			projectOwners.set(serverName, state.root);
		} catch (error) {
			ctx.logger.warn?.(`dsh-mcp-router: 挂载项目 MCP "${serverName}" 失败: ${messageOf(error)}`);
		}
	}
}
/** 卸载某工作空间的全部项目 MCP 条目并停 watcher。 */
async function disposeWorkspace(ctx, root) {
	const state = workspaces.get(root);
	if (!state) return;
	workspaces.delete(root);
	if (state.refreshTimer) clearTimeout(state.refreshTimer);
	state.watcher?.close();
	for (const [serverName, entryId] of [...state.entries]) {
		try {
			await ctx.loader.remove(entryId);
		} catch {}
		projectOwners.delete(serverName);
	}
	state.entries.clear();
}
/** 会话进入工作空间时：无 .dsh/mcps → 卸载；有 → 扫描并按需挂载。
* 记录「最近进入的工作空间」（活动工作区，随会话切换更新）。 */
async function ensureWorkspace(ctx, root, policy) {
	activeWorkspace = root;
	if (!await isDirectory(join(root, MCPS_DIR))) {
		await disposeWorkspace(ctx, root);
		return;
	}
	const rows = buildRows(root, await scanWorkspaceMcp(root, (msg) => ctx.logger.warn?.(`dsh-mcp-router: ${msg}`)));
	let state = workspaces.get(root);
	if (!state) {
		state = {
			root,
			entries: /* @__PURE__ */ new Map(),
			watcher: void 0,
			refreshTimer: void 0,
			refreshing: false
		};
		workspaces.set(root, state);
	}
	await syncRows(ctx, state, rows, policy);
	if (!state.watcher) try {
		state.watcher = watch(join(root, MCPS_DIR), { recursive: true }, () => {
			if (state.refreshTimer) clearTimeout(state.refreshTimer);
			state.refreshTimer = setTimeout(() => {
				state.refreshTimer = void 0;
				refresh(ctx, root, state, policy).catch((error) => {
					ctx.logger.warn?.(`dsh-mcp-router: 项目 MCP 热更新失败（${root}）: ${messageOf(error)}`);
				});
			}, RESCAN_DEBOUNCE_MS);
		});
	} catch (error) {
		ctx.logger.warn?.(`dsh-mcp-router: 无法监视 ${join(root, MCPS_DIR)}: ${messageOf(error)}`);
	}
}
/** watcher 触发的重扫：配置/目录变化后按新集合同步（热更新）。 */
async function refresh(ctx, root, state, policy) {
	if (state.refreshing) return;
	state.refreshing = true;
	try {
		if (!await isDirectory(join(root, MCPS_DIR))) {
			await disposeWorkspace(ctx, root);
			return;
		}
		await syncRows(ctx, state, buildRows(root, await scanWorkspaceMcp(root, (msg) => ctx.logger.warn?.(`dsh-mcp-router: ${msg}`))), policy);
	} finally {
		state.refreshing = false;
	}
}
/** 安装项目 MCP 运行时：会话挂载 + 热更新。可见性由装配层按档位/工作区统一判定。返回释放函数。 */
function installProjectMcp(ctx, policy) {
	const disposers = [];
	disposers.push(ctx.effect(() => {
		return ctx.root.on("agent/created", (payload) => {
			const cwd = payload?.agent?.session?.header?.cwd;
			if (typeof cwd !== "string" || cwd.length === 0) return void 0;
			ensureWorkspace(ctx, cwd, policy).catch((error) => {
				ctx.logger.warn?.(`dsh-mcp-router: 项目 MCP 挂载失败（${cwd}）: ${messageOf(error)}`);
			});
		});
	}, "dsh-mcp-router: project mcp session hook"));
	return () => {
		for (const dispose of disposers) dispose();
	};
}
/**
* 在 `<workspace>/.dsh/mcps/**\/mcp.json` 中定位某个挂载名（带路径哈希后缀）对应的
* **来源文件与原始键名**。编辑/删除项目行时用它把「运行时 serverName」映射回文件里的键。
*
* 扫描顺序与发现规则一致（根目录先、子目录后），因此倒序查找即「后写覆盖」的赢家。
*/
async function findProjectMcpFile(root, serverName) {
	const mcpsDir = join(root, MCPS_DIR);
	if (!await isDirectory(mcpsDir)) return void 0;
	const files = [];
	await collectMcpJsonFiles(mcpsDir, files);
	for (let i = files.length - 1; i >= 0; i -= 1) {
		const file = files[i];
		let text;
		try {
			text = await readFile(file, "utf8");
		} catch {
			continue;
		}
		const parsed = parseMcpServersJson(text);
		for (const key of Object.keys(parsed.servers)) if (projectServerName(root, key) === serverName) return {
			file,
			key
		};
	}
}
/** 面板添加/外部修改项目 MCP 文件后，强制重扫该工作空间并同步挂载（幂等）。 */
async function remountWorkspace(ctx, root, policy) {
	await ensureWorkspace(ctx, root, policy);
}
/**
* HMR/热重载后从 state.json 反向重建 projectOwners 映射（幂等，已有数据时跳过）。
*
* 背景：projectOwners 是模块级内存表，插件 HMR 重载即清空，而 loader 根树上的
* projmcp-* 行仍然存在 → 期间项目工具短暂按全局展示、项目级禁用作用域错判。
* state.json 的 projects 分区（工作空间 → serverName → 策略）保存了 owner 关系，
* 以 loader 存活行交叉验证后重建；watcher/entries 由下次 agent/created 的
* ensureWorkspace 完整恢复。
*/
async function rebuildOwnersFromState(ctx) {
	if (projectOwners.size > 0) return;
	const map = (await readState().catch(() => void 0))?.projects;
	if (!map) return;
	const live = /* @__PURE__ */ new Set();
	for (const entry of ctx.loader.entries()) if (isMcpEntry(entry)) live.add(serverNameOf(entry));
	for (const [workspace, servers] of Object.entries(map)) {
		if (!servers || typeof servers !== "object") continue;
		for (const serverName of Object.keys(servers)) if (live.has(serverName)) projectOwners.set(serverName, workspace);
	}
}
//#endregion
//#region src/collect.ts
/** 分域缓存 TTL：事件驱动失效为主，TTL 只是兜底（事件丢失场景） */
const DOMAIN_TTL_MS = 6e4;
function createDomainCaches() {
	const mcpCache = /* @__PURE__ */ new Map();
	const mcpAggregates = /* @__PURE__ */ new Map();
	const schemasCache = /* @__PURE__ */ new Map();
	return {
		mcpCache,
		mcpAggregates,
		schemasCache,
		invalidateMcp: () => {
			mcpCache.clear();
			mcpAggregates.clear();
			schemasCache.clear();
		}
	};
}
function tokenEstimate(parameters) {
	try {
		return Math.max(1, Math.round(JSON.stringify(parameters ?? {}).length / 4));
	} catch {
		return 1;
	}
}
/** 写时清理过期条目（P2-8）：分域缓存的 Map 长期运行不膨胀。 */
function pruneExpired(map, now) {
	for (const [key, entry] of map) if (now - entry.at >= 6e4) map.delete(key);
}
/**
* 按 scope 共享的 schemas 原始缓存：路径 A（catalog 采集）与路径 B（面板聚合）
* 共用同一份深克隆结果，避免 tools.change 风暴期内重复深克隆。
* key = scopeKey ?? null；TTL 由调用方指定（路径 A 500ms，路径 B 60s）。
*/
function getSchemasView(ctx, caches, scopeKey, ttlMs) {
	const key = scopeKey ?? null;
	const now = Date.now();
	const maxTtl = Math.max(ttlMs, DOMAIN_TTL_MS);
	for (const [k, entry] of caches.schemasCache) if (now - entry.at >= maxTtl) caches.schemasCache.delete(k);
	const hit = caches.schemasCache.get(key);
	if (hit && now - hit.at < ttlMs) return hit.schemas;
	const schemas = scopeKey ? ctx.tools.schemas(scopeKey) : ctx.tools.schemas();
	caches.schemasCache.set(key, {
		at: now,
		schemas
	});
	return schemas;
}
function resolveAgent(ctx, sessionId) {
	if (sessionId) {
		const byId = ctx.agents.get(sessionId);
		if (byId) return byId;
	}
	const roots = ctx.agents.roots();
	if (roots.length > 0) return roots[0];
	return ctx.agents.list()[0];
}
/**
* 进程级共享的 scope key（standing 层）。
*
* 关键坑（2026-08-27 实测）：HTTP 请求路径（routes 的 httpCtx）下既解析不到
* agent（roots/list 空或非目标）也拿不到 agentPresets.standingKeyFor()（该服务
* 视图受限）→ scope key 恒 undefined → schemas 落入空视图，面板聚合全 0。
* 解法：scope key 在 apply 早期解析一次并缓存（进程级单例），所有路径复用。
*/
let sharedScopeKey;
let sharedScopeKeySource = null;
async function resolveCollectScopeKey(ctx, sessionId) {
	if (sharedScopeKey !== void 0) return sharedScopeKey;
	try {
		const agent = resolveAgent(ctx, sessionId);
		if (agent) {
			const key = scopeOf(agent.ctx);
			if (key !== void 0) {
				sharedScopeKey = key;
				sharedScopeKeySource = "agent";
				return key;
			}
		}
	} catch {}
	try {
		const key = await ctx.agentPresets.standingKeyFor();
		if (key !== void 0) {
			sharedScopeKey = key;
			sharedScopeKeySource = "standing";
			return key;
		}
	} catch {}
	return sharedScopeKey;
}
/** scope key 解析来源（/debug scopeDiag 展示用）。 */
function scopeKeySource() {
	return sharedScopeKeySource;
}
/** 行状态徽标判定（纯函数，selftest 表驱动回归）。
* 语义：active/idle 以 **liveTools**（真实注册）为准——displayTools 含 catalog 快照
* 兜底，用它判定 active 会掩盖「scope 解析失败但 catalog 有旧快照」的故障现场。
*/
function computeStatus(disabled, running, liveTools) {
	if (disabled) return "disabled";
	if (!running) return "failed";
	return liveTools > 0 ? "active" : "idle";
}
/**
* 面板显示数字的诚实口径（纯函数，selftest 表驱动回归）。
*
* 2026-09-23（移植上游 78142f6）：进程在跑但一个工具都没注册时，**不得**用目录快照
* 回填工具数/token —— 那会把「根本没注册上」渲染成有工具的健康态（上游 codegraph
* 实测：子进程零注册，面板却显示 tools=4）。历史目录仍经 toolList 兜底展示。
*/
function computeRowDisplay(input) {
	const unregistered = !input.disabled && input.running && input.liveTools <= 0;
	if (unregistered) return {
		tools: 0,
		tokens: 0,
		unregistered
	};
	if (input.liveTools > 0) return {
		tools: input.liveTools,
		tokens: input.liveTokens,
		unregistered
	};
	return {
		tools: input.catalogTools,
		tokens: input.catalogTokens,
		unregistered
	};
}
function baseView(ctx, agent, cwd) {
	let preset = null;
	try {
		if (agent) preset = ctx.agentPresets.composedPreset(agent.ctx) ?? null;
	} catch {
		preset = null;
	}
	return {
		sessionId: agent ? agent.id : null,
		preset,
		cwd: cwd ?? null
	};
}
/**
* 按 name 去重合并两个 schemas 视图（scoped 优先）。
*
* ⚠️ 2026-08-27 实测：`tools.schemas()`（无参全局视图）不含任何 mcp__ 工具（全部
* 注册在 scope 层）→ 本合并当前恒为 no-op，属防御性合并：若未来出现全局作用域注册
* 的 mcp 工具，此路径才生效。
*/
function mergeSchemas(scoped, global) {
	if (!global || global.length === 0) return scoped;
	const seen = /* @__PURE__ */ new Set();
	for (const schema of scoped) seen.add(String(schema?.name ?? ""));
	const out = scoped.slice();
	for (const schema of global) {
		const name = String(schema?.name ?? "");
		if (name.length === 0 || seen.has(name)) continue;
		seen.add(name);
		out.push(schema);
	}
	return out;
}
function computeAggregate(schemas) {
	const byServer = /* @__PURE__ */ new Map();
	let mcpToolsTotal = 0;
	let mcpTokensTotal = 0;
	for (const schema of schemas) {
		const server = serverOfMcp(String(schema.name ?? ""));
		if (!server) continue;
		const entry = byServer.get(server) ?? {
			tools: 0,
			tokens: 0
		};
		entry.tools += 1;
		const est = tokenEstimate(schema.parameters);
		entry.tokens += est;
		byServer.set(server, entry);
		mcpToolsTotal += 1;
		mcpTokensTotal += est;
	}
	return {
		byServer,
		mcpToolsTotal,
		mcpTokensTotal
	};
}
/** 按 scope 复用的 MCP 聚合缓存：tools.schemas 深克隆是 collectMcp 最重的一步。 */
function getMcpAggregate(ctx, caches, scopeKey, errors) {
	const key = scopeKey ?? null;
	pruneExpired(caches.mcpAggregates, Date.now());
	const hit = caches.mcpAggregates.get(key);
	if (hit && Date.now() - hit.at < 6e4) return hit.value;
	let schemas = [];
	try {
		schemas = getSchemasView(ctx, caches, scopeKey, DOMAIN_TTL_MS);
		if (scopeKey) schemas = mergeSchemas(schemas, getSchemasView(ctx, caches, void 0, DOMAIN_TTL_MS));
	} catch (error) {
		errors.push(`tools.schemas: ${messageOf(error)}`);
	}
	const value = computeAggregate(schemas);
	caches.mcpAggregates.set(key, {
		at: Date.now(),
		value
	});
	return value;
}
/** 停用态 token 估算缓存（P2-6）：fetchedAt 不变则复用。 */
function catalogTokens(runtime, serverName, info) {
	if (!info) return 0;
	const hit = runtime.tokenCache.get(serverName);
	if (hit && hit.fetchedAt === info.fetchedAt) return hit.tokens;
	const tokens = info.tools.reduce((sum, t) => sum + tokenEstimate(t.parameters), 0);
	runtime.tokenCache.set(serverName, {
		fetchedAt: info.fetchedAt,
		tokens
	});
	return tokens;
}
async function collectMcp(deps, sessionId) {
	const { ctx, registry, policy } = deps;
	const errors = [];
	const agent = resolveAgent(ctx, sessionId);
	const remembered = lastSessionScope();
	const presetId = agentPresetId(ctx, agent) ?? remembered.presetId;
	const workspace = agentWorkspace(agent) ?? remembered.workspace;
	const scopeKey = await resolveCollectScopeKey(ctx, sessionId);
	const { byServer, mcpToolsTotal, mcpTokensTotal } = getMcpAggregate(ctx, deps.caches, scopeKey, errors);
	let schemas = getSchemasView(ctx, deps.caches, scopeKey, DOMAIN_TTL_MS);
	if (scopeKey) schemas = mergeSchemas(schemas, getSchemasView(ctx, deps.caches, void 0, DOMAIN_TTL_MS));
	const toolsByServer = /* @__PURE__ */ new Map();
	for (const schema of schemas) {
		const name = String(schema?.name ?? "");
		if (!name.startsWith("mcp__")) continue;
		const server = serverOfMcp(name);
		if (server === null) continue;
		let list = toolsByServer.get(server);
		if (!list) {
			list = [];
			toolsByServer.set(server, list);
		}
		list.push({
			name,
			description: String(schema?.description ?? "")
		});
	}
	for (const list of toolsByServer.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	const mcp = [];
	try {
		for (const ref of registry.snapshot().all.values()) {
			const serverName = ref.serverName;
			const effectivePolicy = policy.effective(serverName, ref.workspace);
			const intent = policy.intent(serverName, ref.workspace);
			const access = deps.controller?.accessFor(serverName, presetId, workspace);
			const effective = access?.effective ?? "off";
			const agg = byServer.get(serverName);
			const liveTools = agg?.tools ?? 0;
			const catalogInfo = deps.catalogRuntime.catalog[serverName];
			const display = computeRowDisplay({
				disabled: ref.disabled,
				running: ref.running,
				liveTools,
				liveTokens: agg?.tokens ?? 0,
				catalogTools: catalogInfo?.tools.length ?? 0,
				catalogTokens: catalogTokens(deps.catalogRuntime, serverName, catalogInfo)
			});
			const unregistered = display.unregistered;
			const displayTools = display.tools;
			const displayTokens = display.tokens;
			const status = computeStatus(ref.disabled, ref.disabled || ref.running, liveTools);
			let toolList = toolsByServer.get(serverName);
			if (!toolList && catalogInfo) toolList = catalogInfo.tools.map((tool) => ({
				name: String(tool.name ?? ""),
				description: String(tool.description ?? "")
			}));
			mcp.push({
				entryId: ref.entryId,
				rowId: ref.rowId,
				serverName,
				transport: ref.transport,
				disabled: ref.disabled,
				running: ref.running,
				unregistered,
				tools: displayTools,
				tokens: displayTokens,
				toolList: toolList?.map((tool) => ({
					name: tool.name,
					description: tool.description,
					disabled: effectivePolicy.disabledTools.includes(tool.name)
				})) ?? null,
				status,
				exposure: intent?.exposure ?? effectivePolicy.exposure,
				effectiveExposure: effective,
				presetScope: effectivePolicy.presets,
				presetAllowed: access ? access.blockedBy !== "preset" : true,
				pending: policy.isPending(serverName, ref.workspace),
				configured: intent !== void 0,
				source: ref.source,
				writable: ref.source !== "preset",
				workspace: ref.workspace
			});
		}
	} catch (error) {
		errors.push(`registry.entries: ${messageOf(error)}`);
	}
	try {
		const declared = new Set(registry.snapshot().all.keys());
		for (const [serverName, info] of deps.catalogRuntime.runtimeServers) {
			if (declared.has(serverName)) continue;
			const catalogInfo = deps.catalogRuntime.catalog[serverName];
			const toolList = toolsByServer.get(serverName) ?? (catalogInfo ? catalogInfo.tools.map((tool) => ({
				name: String(tool.name ?? ""),
				description: String(tool.description ?? "")
			})) : null);
			const toolCount = toolList?.length ?? info.tools;
			mcp.push({
				entryId: `runtime:${serverName}`,
				rowId: `runtime:${serverName}`,
				serverName,
				transport: null,
				disabled: false,
				running: true,
				unregistered: toolCount === 0,
				tools: toolCount,
				tokens: catalogTokens(deps.catalogRuntime, serverName, catalogInfo),
				status: toolCount > 0 ? "active" : "idle",
				exposure: "name-only",
				effectiveExposure: "name-only",
				presetScope: {
					mode: "all",
					ids: []
				},
				presetAllowed: true,
				pending: false,
				configured: false,
				source: "runtime",
				writable: false,
				toolList: toolList?.map((tool) => ({
					name: tool.name,
					description: tool.description,
					disabled: false
				})) ?? null
			});
		}
	} catch (error) {
		errors.push(`runtime.servers: ${messageOf(error)}`);
	}
	mcp.sort((a, b) => a.serverName.localeCompare(b.serverName));
	return {
		...baseView(ctx, agent, workspace),
		mcp,
		mcpTotal: mcp.length,
		mcpDisabled: mcp.filter((row) => row.exposure === "off").length,
		mcpNameOnly: mcp.filter((row) => row.effectiveExposure === "name-only").length,
		mcpHidden: mcp.filter((row) => row.effectiveExposure === "hidden").length,
		mcpToolsTotal,
		mcpTokensTotal,
		activeWorkspace: getActiveWorkspace(),
		errors
	};
}
//#endregion
//#region src/domain/external-import.ts
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
/**
* 内置扫描源清单。
*
* @param opts.home - 用户主目录（`~`）。
* @param opts.workspace - 当前会话工作空间（项目级源用；缺省时跳过项目级源）。
*/
function knownMcpSources(opts) {
	const home = opts.home.replace(/[\\/]$/, "");
	const workspace = typeof opts.workspace === "string" && opts.workspace.length > 0 ? opts.workspace : void 0;
	const sources = [
		{
			id: "opencode",
			label: "opencode",
			path: `${home}/.config/opencode/opencode.json`,
			projectRelative: false,
			supported: true
		},
		{
			id: "zcode",
			label: "zcode",
			path: `${home}/.zcode/cli/config.json`,
			projectRelative: false,
			supported: true
		},
		{
			id: "claude-code",
			label: "Claude Code",
			path: `${home}/.claude.json`,
			projectRelative: false,
			supported: true
		},
		{
			id: "cursor",
			label: "Cursor",
			path: `${home}/.cursor/mcp.json`,
			projectRelative: false,
			supported: true
		},
		{
			id: "gemini-cli",
			label: "Gemini CLI",
			path: `${home}/.gemini/settings.json`,
			projectRelative: false,
			supported: true
		},
		{
			id: "zed",
			label: "Zed",
			path: `${home}/.config/zed/settings.json`,
			projectRelative: false,
			supported: false,
			note: "Zed 用 context_servers 且 command 为对象形态，本版本不支持"
		},
		{
			id: "codex",
			label: "Codex",
			path: `${home}/.codex/config.toml`,
			projectRelative: false,
			supported: false,
			note: "TOML 格式，本版本不支持"
		}
	];
	if (workspace !== void 0) sources.push({
		id: "claude-project",
		label: "Claude Code（项目）",
		path: `${workspace}/.mcp.json`,
		projectRelative: true,
		supported: true
	}, {
		id: "vscode-project",
		label: "VS Code（项目）",
		path: `${workspace}/.vscode/mcp.json`,
		projectRelative: true,
		supported: true
	});
	return sources;
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** 顶层键是否像「服务器名 → 配置对象」的映射。 */
function looksLikeServerMap(value) {
	if (!isPlainObject(value)) return false;
	const entries = Object.entries(value);
	if (entries.length === 0) return false;
	let hits = 0;
	for (const [, item] of entries) {
		if (!isPlainObject(item)) continue;
		if ("command" in item || "url" in item || "type" in item || "transport" in item) hits += 1;
	}
	return hits * 2 >= entries.length;
}
/** 嗅探形态并取出服务器映射。 */
function detect(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return { error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
	}
	if (!isPlainObject(raw)) return { error: "顶层不是 JSON 对象" };
	if (looksLikeServerMap(raw.mcpServers)) return {
		format: "mcpServers",
		map: raw.mcpServers
	};
	if (isPlainObject(raw.mcp)) {
		const mcp = raw.mcp;
		if (looksLikeServerMap(mcp.servers)) return {
			format: "zcode",
			map: mcp.servers
		};
		if (looksLikeServerMap(mcp)) return {
			format: "opencode",
			map: mcp
		};
	}
	if (looksLikeServerMap(raw.servers)) return {
		format: "vscode",
		map: raw.servers
	};
	if (looksLikeServerMap(raw)) return {
		format: "bare",
		map: raw
	};
	return { error: "未找到 MCP 配置（支持 mcpServers / mcp.servers / mcp / servers 或裸名字映射）" };
}
/**
* 把一家之言归一为 `mcpServers` 形状（供 mcp-convert 复用解析）。
* 只做形状转换，不校验值；notes 记录发生过的转换。
*/
function normalizeServer(value, notes) {
	if (!isPlainObject(value)) return value;
	const out = { ...value };
	const type = String(value.type ?? "").toLowerCase();
	if (type === "local") {
		out.type = "stdio";
		notes.push("type: local → stdio");
	} else if (type === "remote") {
		out.type = "http";
		notes.push("type: remote → streamable-http");
	}
	if (Array.isArray(value.command)) {
		const list = value.command.filter((item) => typeof item === "string");
		if (list.length > 0) {
			out.command = list[0];
			if (value.args === void 0 && list.length > 1) out.args = list.slice(1);
			notes.push(list.length > 1 && value.args === void 0 ? `command 数组已拆分为命令 + ${list.length - 1} 个参数` : "command 数组已取首个元素作为命令");
		} else {
			delete out.command;
			notes.push("command 数组为空，已忽略");
		}
	}
	if (value.environment !== void 0 && value.env === void 0) {
		out.env = value.environment;
		notes.push("environment → env");
	}
	delete out.enabled;
	return out;
}
/**
* 解析一份外部 agent 配置文件。
*
* @param text - 文件全文（JSON；TOML 等其它格式请先由调用方拒绝）。
*/
function parseExternalMcpConfig(text) {
	const detected = detect(text);
	if (detected.map === void 0) return {
		servers: [],
		errors: [detected.error ?? "无法识别的配置形态"],
		warnings: []
	};
	const map = {};
	const notesByName = /* @__PURE__ */ new Map();
	for (const [name, value] of Object.entries(detected.map)) {
		const notes = [];
		map[name] = normalizeServer(value, notes);
		if (notes.length > 0) notesByName.set(name, notes);
		if (isPlainObject(value) && value.enabled === false) notes.push("源配置里该项为 enabled: false");
	}
	const parsed = parseMcpServersJson(JSON.stringify({ mcpServers: map }));
	const servers = [];
	for (const [name, config] of Object.entries(parsed.servers)) {
		const rawValue = detected.map[name];
		servers.push({
			name,
			config,
			enabled: !(isPlainObject(rawValue) && rawValue.enabled === false),
			notes: notesByName.get(name) ?? []
		});
	}
	servers.sort((a, b) => a.name.localeCompare(b.name));
	return {
		format: detected.format,
		servers,
		errors: parsed.errors,
		warnings: parsed.warnings
	};
}
/** 一句话描述某服务器的连接方式（面板列表用）。 */
function describeImportedServer(server) {
	const { config } = server;
	if (config.transport === "stdio") {
		const args = config.args && config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
		return `stdio: ${config.command ?? ""}${args}`.trim();
	}
	return `http: ${config.url ?? ""}`.trim();
}
//#endregion
//#region src/domain/composition-file.ts
/**
* 组合文件（profile patch / agent 预设 cordis.yml）的**文本级**行操作。
*
* 为什么是文本级而不是 YAML 库：这些文件承载用户的注释、`!!js` 表达式与手工排版，
* YAML 库的 dump 会把它们全部丢掉（loader 自己的 `yaml.dump` 就有这个问题）。因此
* 编辑一律走「定位行块 → 局部替换」，其余字节原样保留。
*
* 处理两种形态（同一种缩进规则）：
* ```yaml
* # profile patch（cordis.patch.yml）
* - insert:
*     - id: mcp-brave-search
*       name: '@deepseek-ai/dsh-mcp-client'
*       config:
*         transport: "stdio"
*
* # agent 预设组合（agent.cordis.yml）
* - id: mcp-brave-search
*   name: '@deepseek-ai/dsh-mcp-client'
*   config:
*     transport: "stdio"
* ```
*
* 纯逻辑、零依赖，可被 `scripts/selftest-composition-file.mjs` 直接以构建产物覆盖。
*/
/** 一行 `- id: <rowId>` 的匹配（允许任意缩进；值允许可选引号）。 */
const ROW_ID_RE = /^(\s*)-\s*id:\s*"?([^"\s]+)"?\s*$/;
/** 任意列表项起始行（允许 `-` 后直接换行，如 `- insert:`）。 */
const LIST_ITEM_RE = /^(\s*)-(?:\s|$)/;
/** 注释行。 */
const COMMENT_RE = /^\s*#/;
/** 一行的缩进宽度（空格数；Tab 按 1 计，够用且不与我们的输出冲突）。 */
function indentOf(line) {
	const match = /^[ \t]*/.exec(line);
	return match ? match[0].length : 0;
}
function isBlank(line) {
	return line.trim().length === 0;
}
/** 原文件的换行风格（默认 LF）。 */
function lineEndingOf(text) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}
/** 定位一行所在的块；找不到返回 undefined。 */
function findRowBlock(text, rowId) {
	const lines = text.split(/\r?\n/);
	let idLine = -1;
	let indent = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const match = ROW_ID_RE.exec(lines[i]);
		if (match && match[2] === rowId) {
			idLine = i;
			indent = match[1].length;
			break;
		}
	}
	if (idLine < 0) return void 0;
	let endLine = idLine;
	for (let i = idLine + 1; i < lines.length; i += 1) {
		if (isBlank(lines[i])) continue;
		if (indentOf(lines[i]) <= indent) break;
		endLine = i;
	}
	let blockHead = -1;
	let blockIndent = -1;
	for (let i = idLine - 1; i >= 0; i -= 1) {
		if (isBlank(lines[i])) continue;
		const ind = indentOf(lines[i]);
		if (ind >= indent) continue;
		if (LIST_ITEM_RE.test(lines[i])) {
			blockHead = i;
			blockIndent = ind;
		}
		break;
	}
	let sibling = false;
	if (blockHead >= 0) {
		let parentEnd = lines.length - 1;
		for (let i = blockHead + 1; i < lines.length; i += 1) {
			if (isBlank(lines[i])) continue;
			if (indentOf(lines[i]) <= blockIndent) {
				parentEnd = i - 1;
				break;
			}
		}
		for (let i = blockHead + 1; i <= parentEnd; i += 1) {
			const match = ROW_ID_RE.exec(lines[i]);
			if (match && match[1].length === indent && match[2] !== rowId) {
				sibling = true;
				break;
			}
		}
	}
	return {
		idLine,
		indent,
		endLine,
		blockHead,
		blockIndent,
		sibling
	};
}
/** 把 3 个以上连续空行压成 1 个（删除块后清理留白；不改动其它行）。 */
function collapseBlankRuns(lines) {
	const out = [];
	let blanks = 0;
	for (const line of lines) {
		if (isBlank(line)) {
			blanks += 1;
			if (blanks > 1) continue;
		} else blanks = 0;
		out.push(line);
	}
	while (out.length > 1 && isBlank(out[out.length - 1]) && isBlank(out[out.length - 2])) out.pop();
	return out;
}
/**
* 删除一行（含其父 `- insert:` 块，若父块里只有这一行）。
*
* 同时删除紧邻其上的、**指向该行**的注释（形如 `# <source>:server:<name>` 或含 rowId）——
* 这是其它工具写入的归属标记，留下会变成孤儿注释；不匹配的注释（分区标题等）保留。
*
* @returns `removed = false` 表示文件里没有该行（调用方应报错而不是假装成功）。
*/
function removeRowBlock(text, rowId) {
	const block = findRowBlock(text, rowId);
	if (!block) return {
		text,
		removed: false
	};
	const lines = text.split(/\r?\n/);
	let start = block.blockHead >= 0 && !block.sibling ? block.blockHead : block.idLine;
	const end = block.endLine;
	while (start - 1 >= 0 && COMMENT_RE.test(lines[start - 1])) {
		const comment = lines[start - 1];
		if (comment.includes(rowId) || /:server:/.test(comment)) {
			start -= 1;
			continue;
		}
		break;
	}
	return {
		text: collapseBlankRuns([...lines.slice(0, start), ...lines.slice(end + 1)]).join(lineEndingOf(text)),
		removed: true
	};
}
/** 定位某行的 `config:` 块并解析其顶层键（文本级，不解析值语义）。 */
function readConfigBlock(text, rowId) {
	const block = findRowBlock(text, rowId);
	if (!block) return void 0;
	const lines = text.split(/\r?\n/);
	let configLine = -1;
	for (let i = block.idLine + 1; i <= block.endLine; i += 1) if (/^\s*config\s*:/.test(lines[i])) {
		configLine = i;
		break;
	}
	if (configLine < 0) return void 0;
	const configIndent = indentOf(lines[configLine]);
	if (lines[configLine].replace(/^\s*config\s*:/, "").trim().length > 0) return {
		line: configLine,
		indent: configIndent,
		endLine: configLine,
		keys: []
	};
	const keyIndent = configIndent + 2;
	const keys = [];
	let cursor = configLine + 1;
	let current;
	let lastContent = configLine;
	for (; cursor <= block.endLine; cursor += 1) {
		const line = lines[cursor];
		if (isBlank(line)) continue;
		const ind = indentOf(line);
		if (ind < keyIndent) break;
		if (ind === keyIndent && /^[A-Za-z_][\w$.-]*\s*:/.test(line.trim())) {
			current = {
				name: line.trim().slice(0, line.trim().indexOf(":")),
				lines: [line],
				dynamic: line.includes("!!js"),
				indent: keyIndent
			};
			keys.push(current);
			lastContent = cursor;
			continue;
		}
		if (current) {
			current.lines.push(line);
			if (line.includes("!!js")) current.dynamic = true;
			lastContent = cursor;
		}
	}
	return {
		line: configLine,
		indent: configIndent,
		endLine: lastContent,
		keys
	};
}
/**
* 用新的 config 顶层键替换原文（整体替换子键区间，`config:` 行本身保留）。
*
* 调用方对 `dynamic` 键传入其原文 body（由 {@link readConfigBlock} 得到的 lines，
* 去掉公共缩进），即可做到「动态表达式原样保留」。
*
* @returns `changed = false` 表示文件里没有该行或没有 config 块（调用方应报错）。
*/
function replaceRowConfig(text, rowId, keys) {
	const block = findRowBlock(text, rowId);
	const config = readConfigBlock(text, rowId);
	if (!block || !config || config.keys.length === 0) return {
		text,
		changed: false
	};
	const lines = text.split(/\r?\n/);
	const prefix = " ".repeat(config.indent + 2);
	const body = [];
	for (const key of keys) for (const line of key.body) body.push(line.length === 0 ? "" : `${prefix}${line}`);
	return {
		text: [
			...lines.slice(0, config.line + 1),
			...body,
			...lines.slice(config.endLine + 1)
		].join(lineEndingOf(text)),
		changed: true
	};
}
/** 去掉一组行的公共缩进（供 dynamic 键原样回写）。 */
function dedentLines(lines) {
	let min = Number.POSITIVE_INFINITY;
	for (const line of lines) {
		if (isBlank(line)) continue;
		min = Math.min(min, indentOf(line));
	}
	if (!Number.isFinite(min) || min === 0) return [...lines];
	return lines.map((line) => isBlank(line) ? "" : line.slice(min));
}
/**
* 在（任意缩进的）`- id: <rowId>` 行块内写入/移除 `key: value` 标志。
*
* 与 `preset.ts` 的 `setRowFlag` 行为一致，但支持缩进行（profile patch 的
* `    - id: mcp-x`）——现有实现只匹配行首 `- id:`，对 patch 文件无效。
*
* 语义：`value=true` 保证标记存在且为 true（已有 `false` 时反转）；`value=false` 移除标记。
*/
function setRowFlagAt(text, rowId, key, value) {
	const block = findRowBlock(text, rowId);
	if (!block) throw new Error(`row "- id: ${rowId}" not found in composition file`);
	const nl = lineEndingOf(text);
	const lines = text.split(/\r?\n/);
	const flagRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(true|false)\\s*$`);
	let flagLine = -1;
	for (let i = block.idLine + 1; i <= block.endLine; i += 1) if (flagRe.test(lines[i])) {
		flagLine = i;
		break;
	}
	const flagIndent = " ".repeat(block.indent + 2);
	if (flagLine >= 0) {
		if (value) {
			if (/:\s*false\s*$/.test(lines[flagLine])) {
				lines.splice(flagLine, 1, `${flagIndent}${key}: true`);
				return lines.join(nl);
			}
			return text;
		}
		lines.splice(flagLine, 1);
		return lines.join(nl);
	}
	if (!value) return text;
	lines.splice(block.idLine + 1, 0, `${flagIndent}${key}: true`);
	return lines.join(nl);
}
/** 读取（任意缩进的）行块内 `key: true/false` 标志；行或键不存在返回 null。 */
function rowFlagAt(text, rowId, key) {
	const block = findRowBlock(text, rowId);
	if (!block) return null;
	const lines = text.split(/\r?\n/);
	const flagRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(true|false)\\s*$`);
	for (let i = block.idLine + 1; i <= block.endLine; i += 1) {
		const match = flagRe.exec(lines[i]);
		if (match) return match[1] === "true";
	}
	return null;
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//#endregion
//#region src/preset.ts
/** 根树 backing 文件名：每次启动重置为 `[]`，真正承载用户行的补丁层是同目录的 patch 文件。 */
const ROOT_TREE_FILE = "cordis.yml";
/** profile 用户补丁层文件名。 */
const PROFILE_PATCH_FILE = "cordis.patch.yml";
/**
* 解析「可持久化的物化目标文件」。
*
* 关键事实（2026-09 实测确认）：profile patch（`cordis.patch.yml`）的 `- insert:` 行在
* 加载后属于**根树**，其 `tree.filename` 是根树 backing 文件 `cordis.yml`（每次启动被
* 重置为 `[]`）。因此对它写 disabled 标志必须落在同目录的 patch 文件上，否则重启后
* 意图丢失（v0.6.0 曾因此让「隐藏/关闭」档位不再停用进程）。
*/
function materializeTargetOf(file) {
	if (typeof file !== "string" || file.length === 0) return void 0;
	return basename(file) === ROOT_TREE_FILE ? join(dirname(file), PROFILE_PATCH_FILE) : file;
}
/**
* 在组合文件中对 `- id: <rowId>` 行做 `  <key>: <value>` 标记的插入/移除
* （薄包装 → `domain/composition-file.ts` 的 `setRowFlagAt`，支持缩进行）。
*
* 语义：`value=true` 保证标记存在且为 true（已有 `false` 时反转）；`value=false` 移除标记。
*/
function setRowFlag(text, rowId, key, value) {
	return setRowFlagAt(text, rowId, key, value);
}
/** 读取某行当前是否带 disabled: true（true/false/null=无标记/行不存在）。 */
function rowDisabledState(text, rowId) {
	return rowFlagAt(text, rowId, "disabled");
}
/** `- id: <rowId>` 行块整块删除（删除持久行用；块内仅此一行时连 `- insert:` 头一起删）。 */
function removeRow(text, rowId) {
	return removeRowBlock(text, rowId);
}
/**
* 启动早期物化：把策略意图（`desiredRunning` 派生的期望 disabled）写入组合文件。
*
* 只在「没有任何 agent 在跑」时执行 —— 有会话时写文件会触发 dsh-agent-presets 的
* stamp 重挂（旧实例不 dispose → serverName 冲突事故）。
*
* 三条规则：
* 1. **首次采用**：策略表里没有、但组合文件里有该行的 server，按文件现状采用
*    （文件 disabled → `hidden`，否则 `name-only`），绝不反过来覆盖用户手工配置。
* 2. **尊重外部修改**：文件当前状态与上次物化账本不一致 = 用户手工改过 → 只对齐
*    账本，不覆盖文件。
* 3. **物化**：期望 disabled ≠ 文件现状时写文件，并更新账本。
*
* @returns 实际写入文件的行数。
*/
async function syncPresetFiles(deps) {
	const { ctx, registry, policy } = deps;
	if (ctx.agents.list().length > 0) return 0;
	const snapshot = registry.snapshot();
	if (snapshot.all.size === 0) return 0;
	for (const ref of snapshot.all.values()) {
		if (ref.workspace !== void 0) continue;
		if (policy.intent(ref.serverName, void 0)) continue;
		const file = await readComposition(materializeTargetOf(ref.file));
		if (!file) continue;
		if (!findRowBlock(file.text, ref.rowId)) continue;
		await policy.adoptFromFile(ref.serverName, void 0, rowFlagAt(file.text, ref.rowId, "disabled") === true);
	}
	const targets = /* @__PURE__ */ new Map();
	for (const ref of snapshot.all.values()) {
		if (ref.workspace !== void 0) continue;
		const intent = policy.intent(ref.serverName, void 0);
		if (!intent) continue;
		const wantDisabled = !desiredRunning(intent.exposure);
		const file = materializeTargetOf(ref.file);
		if (!file) continue;
		let bucket = targets.get(file);
		if (!bucket) {
			bucket = [];
			targets.set(file, bucket);
		}
		bucket.push({
			rowId: ref.rowId,
			wantDisabled,
			serverName: ref.serverName
		});
	}
	let materialized = 0;
	for (const [file, rows] of targets) {
		const loaded = await readComposition(file);
		if (!loaded) continue;
		let text = loaded.text;
		let changed = false;
		for (const row of rows) {
			if (!findRowBlock(text, row.rowId)) continue;
			const cur = rowFlagAt(text, row.rowId, "disabled") === true;
			const appliedRaw = policy.intent(row.serverName, void 0)?.applied;
			const applied = appliedRaw === void 0 ? void 0 : appliedRaw === true;
			const action = decideSyncAction({
				cur,
				applied,
				wantDisabled: row.wantDisabled,
				configured: true
			});
			if (action === "align-ledger") {
				await policy.markApplied(row.serverName, void 0, cur);
				ctx.logger.info?.(`dsh-mcp-router: ${row.serverName}: composition externally modified, aligning ledger`);
				continue;
			}
			if (action === "noop") {
				if (applied !== cur) await policy.markApplied(row.serverName, void 0, cur);
				continue;
			}
			if (action !== "materialize") continue;
			try {
				text = setRowFlagAt(text, row.rowId, "disabled", row.wantDisabled);
				changed = true;
				materialized += 1;
				await policy.markApplied(row.serverName, void 0, row.wantDisabled);
			} catch {}
		}
		if (changed) {
			const tmp = `${file}.tmp`;
			await writeFile(tmp, text, "utf8");
			await rename(tmp, file);
		}
	}
	return materialized;
}
/** 读组合文件；不存在/不可读返回 undefined。 */
async function readComposition(file) {
	if (typeof file !== "string" || file.length === 0) return void 0;
	try {
		return { text: await readFile(file, "utf8") };
	} catch {
		return;
	}
}
//#endregion
//#region src/domain/mcp-edit.ts
/**
* MCP 服务器的编辑与删除编排层。
*
* 只处理「可写行」的持久化 + 运行时同步；预设组合行（`agent.cordis.yml`）一律拒绝并
* 给出替代路径 —— 运行期写预设文件会触发 dsh-agent-presets 的重挂事故（见 index.ts 铁律）。
*
* 写回矩阵：
*
* | 来源 | 文件 | 编辑 | 删除 |
* |---|---|---|---|
* | loader 行（profile patch） | `tree.filename` 是根树 `cordis.yml` → 落到同目录 `cordis.patch.yml` | 文本替换 config 块 + `entry.update({config})` | 删块 + `loader.remove` + 清策略 |
* | 项目行 | `<workspace>/.dsh/mcps/**\/mcp.json` | 改 JSON 值 + `remountWorkspace` | 删 JSON 键 + `remountWorkspace` |
* | 预设行 | `<preset>/agent.cordis.yml` | 拒绝（只读） | 拒绝（引导用「关闭」档位） |
*
* 顺序固定为「**先写文件、再动运行时**」：反过来会出现「运行时改了但没落盘」的半状态，
* 用户以为改成功了、重启后却回到旧配置。文件写成功后，运行时操作一律容错（live patch
* reload 可能已经替我们重建了行）。
*/
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** dsh-mcp-client 认识的 config 字段；不在新配置里的会被删除（切换 transport 时清理旧字段）。 */
const KNOWN_CONFIG_KEYS = /* @__PURE__ */ new Set([
	"transport",
	"serverName",
	"command",
	"args",
	"env",
	"cwd",
	"url",
	"headers",
	"toolCallTimeoutMs"
]);
/** 解析某行的可写目标（预设行返回 readonly，附来源文件供面板提示）。 */
async function resolveWritableTarget(ref) {
	if (ref.source === "preset") return {
		kind: "readonly",
		reason: "preset",
		file: ref.file ?? ""
	};
	if (ref.source === "project") {
		const workspace = ref.workspace ?? "";
		const found = await findProjectMcpFile(workspace, ref.serverName);
		if (!found) throw new Error(`项目级 MCP "${ref.serverName}"：在 ${workspace}/.dsh/mcps 下找不到它的来源文件（可能已被手工删除或改名）`);
		return {
			kind: "project",
			file: found.file,
			key: found.key,
			workspace,
			rowId: ref.rowId
		};
	}
	const file = materializeTargetOf(ref.file);
	if (!file) throw new Error(`MCP "${ref.serverName}"：无法定位它的配置文件（loader 行未挂载在任何可写文件上）`);
	return {
		kind: "patch",
		file,
		rowId: ref.rowId
	};
}
/** 只读目标的统一拒绝文案（编辑与删除共用）。 */
function readonlyError(serverName, target) {
	return /* @__PURE__ */ new Error(`MCP "${serverName}" 声明在 agent 预设组合文件里（${target.file}），面板不能改写它 —— 运行期写预设文件会让整个预设重挂并导致 MCP 名字冲突。要让它彻底不可用，请把档位设为「关闭」；要真正删除，请直接编辑该文件。`);
}
/** 项目工作空间重扫（容错：文件已落盘，重扫失败只是「未立即生效」）。 */
async function remountQuietly(ctx, policy, workspace) {
	try {
		await remountWorkspace(ctx, workspace, policy);
	} catch (error) {
		ctx.logger.warn?.(`dsh-mcp-router: remount workspace "${workspace}" failed: ${messageOf(error)}`);
	}
}
/** 读取 JSON 文件（失败给出可读错误）。 */
async function readJsonFile(file) {
	let text;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		throw new Error(`读取 ${file} 失败：${messageOf(error)}`);
	}
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("顶层不是 JSON 对象");
		return parsed;
	} catch (error) {
		throw new Error(`解析 ${file} 失败：${messageOf(error)}`);
	}
}
/** 原子写文件（tmp + rename），保留原换行风格由调用方保证。 */
async function writeFileAtomic(file, text) {
	const tmp = `${file}.tmp`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, file);
}
/** 合并补丁与原配置（未提供的字段保持原值；数组/字典整体替换）。 */
function mergeConfig(base, patch) {
	const out = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value === void 0) continue;
		out[key] = value;
	}
	return out;
}
/** 回显脱敏哨兵：env/headers 的**键名保留**，值替换为它（整表单回写时视为「保留原值」）。 */
const MASKED_VALUE = "***MASKED***";
/** 需要脱敏的字段（遮蔽值、保留键名）。 */
const SECRET_CONFIG_KEYS = ["env", "headers"];
function isPlainRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* 回显脱敏（`GET /mcp/detail`、`POST /mcp/scan` 回传的 config 用）。
*
* 2026-09-23（移植上游 0b16e6f）：只读端点不该把求值后的 env/headers 真值吐出来。
* 面板「读回显 → 整表单回写」的编辑路径依赖 {@link unmaskEcho} 把哨兵还原，
* **两者必须成对上线**，否则会把哨兵当真值写进配置文件。
*/
function maskConfigSecrets(config) {
	const out = { ...config };
	for (const key of SECRET_CONFIG_KEYS) {
		const value = out[key];
		if (!isPlainRecord(value)) continue;
		const masked = {};
		for (const name of Object.keys(value)) masked[name] = MASKED_VALUE;
		out[key] = masked;
	}
	return out;
}
/**
* 写侧：哨兵值即「保留原值」。
*
* 有 live 真值 → 恢复；live 里本就没有该键 → 丢弃（不凭空造键）。真实轮换/新增的值
* 原样接受，用户删掉的键也不会被恢复。
*/
function unmaskEcho(patch, live) {
	const out = { ...patch };
	for (const key of SECRET_CONFIG_KEYS) {
		const incoming = out[key];
		if (!isPlainRecord(incoming)) continue;
		const liveMap = isPlainRecord(live[key]) ? live[key] : void 0;
		const merged = {};
		for (const [name, value] of Object.entries(incoming)) {
			if (value === "***MASKED***") {
				if (liveMap && Object.prototype.hasOwnProperty.call(liveMap, name)) merged[name] = liveMap[name];
				continue;
			}
			merged[name] = value;
		}
		out[key] = merged;
	}
	return out;
}
/** 把补丁转成 dsh-mcp-client 的 config 形状（丢掉与当前 transport 无关的字段）。 */
function toClientConfig(patch) {
	const transport = patch.transport ?? (patch.url !== void 0 && patch.command === void 0 ? "streamable-http" : "stdio");
	const config = { transport };
	if (patch.serverName !== void 0) config.serverName = patch.serverName;
	if (transport === "stdio") {
		if (patch.command !== void 0) config.command = patch.command;
		if (patch.args !== void 0 && patch.args.length > 0) config.args = patch.args;
		if (patch.env !== void 0 && Object.keys(patch.env).length > 0) config.env = patch.env;
		if (patch.cwd !== void 0 && patch.cwd.length > 0) config.cwd = patch.cwd;
	} else {
		if (patch.url !== void 0) config.url = patch.url;
		if (patch.headers !== void 0 && Object.keys(patch.headers).length > 0) config.headers = patch.headers;
	}
	if (patch.toolCallTimeoutMs !== void 0) config.toolCallTimeoutMs = patch.toolCallTimeoutMs;
	return config;
}
/**
* patch 行的编辑基线：loader 已解析的 config（含 `!!js` 的运行值；写回文件时动态键仍保留原文）。
* 取不到时**报错**而非退化 —— 残缺基线会在合并时静默丢掉 command/args 等字段。
*/
function patchBaseFromLoader(deps, ref) {
	let entry;
	try {
		entry = deps.ctx.loader.resolve(ref.entryId);
	} catch {
		entry = void 0;
	}
	if (!entry || !isMcpEntry(entry)) throw new Error(`MCP "${ref.serverName}" 当前未挂载在 loader 中，无法读取现有配置（请刷新面板后重试）`);
	const raw = entry.options.config;
	return raw !== null && typeof raw === "object" ? { ...raw } : {
		serverName: ref.serverName,
		transport: "stdio"
	};
}
/** 项目行的编辑基线：`mcp.json` 里该键的值（文件即真相；loader 侧的名字带路径哈希后缀）。 */
function projectBaseFrom(parsed, key, file) {
	const servers = parsed.mcpServers;
	const value = servers !== null && typeof servers === "object" && !Array.isArray(servers) ? servers[key] : void 0;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} 里的 server "${key}" 不是对象配置，无法编辑`);
	return { ...value };
}
/** 取出 mcpServers 映射（缺失时给出可读错误）。 */
function mcpServersOf(parsed, file) {
	const servers = parsed.mcpServers;
	if (servers === null || typeof servers !== "object" || Array.isArray(servers)) throw new Error(`${file} 里没有 mcpServers 映射`);
	return servers;
}
/**
* 编辑一个 MCP 服务器。
*
* @throws 目标只读 / 行不在文件里 / 名字冲突或非法 —— 都带明确中文原因，端点直接透传。
*/
async function updateServer(deps, input) {
	const { ctx, registry, policy } = deps;
	const ref = registry.refFor(input.serverName, void 0);
	if (!ref) throw new Error(`未知 MCP server：${input.serverName}`);
	const target = await resolveWritableTarget(ref);
	if (target.kind === "readonly") throw readonlyError(input.serverName, target);
	const renameRequested = input.patch.serverName !== void 0 && input.patch.serverName !== ref.serverName;
	if (target.kind === "project" && renameRequested) throw new Error(`项目级 MCP 的名字由 ${target.file} 里的配置键决定（当前挂载名 ${ref.serverName}），面板不支持改名；请直接编辑该文件。`);
	const nextName = renameRequested ? input.patch.serverName : ref.serverName;
	if (!SERVER_NAME_PATTERN.test(nextName)) throw new Error(`serverName "${nextName}" 需匹配 [A-Za-z0-9_-]{1,32}`);
	if (renameRequested) {
		if (registry.refFor(nextName, void 0)) throw new Error(`serverName "${nextName}" 已被占用（dsh-mcp-client 的名字全进程唯一）`);
	}
	let patchText;
	let projectParsed;
	if (target.kind === "patch") {
		patchText = await readFile(target.file, "utf8").catch((error) => {
			throw new Error(`读取 ${target.file} 失败：${messageOf(error)}`);
		});
		if (!findRowBlock(patchText, target.rowId)) throw new Error(`${target.file} 里找不到 "- id: ${target.rowId}" 这一行（可能被手工改过），未做任何改动`);
	} else {
		projectParsed = await readJsonFile(target.file);
		const servers = mcpServersOf(projectParsed, target.file);
		if (!(target.key in servers)) throw new Error(`${target.file} 里找不到 server "${target.key}"（可能被手工改过），未做任何改动`);
	}
	const base = target.kind === "patch" ? patchBaseFromLoader(deps, ref) : projectBaseFrom(projectParsed, target.key, target.file);
	const runtimeConfig = toClientConfig(mergeConfig(base, unmaskEcho(input.patch, base)));
	if (target.kind === "patch") {
		const text = patchText;
		const existing = readConfigBlock(text, target.rowId);
		const generated = new Map(configKeyBodies(runtimeConfig).map((item) => [item.name, item]));
		const inputs = [];
		const used = /* @__PURE__ */ new Set();
		for (const key of existing?.keys ?? []) {
			if (key.dynamic) {
				inputs.push({
					name: key.name,
					body: dedentLines(key.lines)
				});
				used.add(key.name);
				continue;
			}
			const fresh = generated.get(key.name);
			if (fresh) {
				inputs.push(fresh);
				used.add(key.name);
				continue;
			}
			if (KNOWN_CONFIG_KEYS.has(key.name)) continue;
			inputs.push({
				name: key.name,
				body: dedentLines(key.lines)
			});
		}
		for (const item of configKeyBodies(runtimeConfig)) if (!used.has(item.name)) inputs.push(item);
		const rewritten = replaceRowConfig(text, target.rowId, inputs);
		if (!rewritten.changed) throw new Error(`${target.file} 里这一行没有可替换的 config 块（可能是内联写法），请直接编辑该文件`);
		await writeFileAtomic(target.file, rewritten.text);
	} else {
		const parsed = projectParsed;
		const servers = mcpServersOf(parsed, target.file);
		servers[target.key] = toClientConfigWithoutName(runtimeConfig);
		parsed.mcpServers = servers;
		await writeFileAtomic(target.file, `${JSON.stringify(parsed, null, 2)}\n`);
		await remountQuietly(ctx, policy, target.workspace);
	}
	let applied = false;
	try {
		const entry = ctx.loader.resolve(ref.entryId);
		if (entry && isMcpEntry(entry)) {
			await entry.update({ config: runtimeConfig });
			applied = true;
		}
	} catch (error) {
		ctx.logger.debug?.(`dsh-mcp-router: runtime update for "${ref.serverName}" skipped (${messageOf(error)})`);
	}
	if (nextName !== ref.serverName) await policy.renameServer(ref.serverName, nextName, ref.workspace);
	await registry.refreshNow();
	const result = {
		serverName: ref.serverName,
		file: target.file,
		applied
	};
	if (nextName !== ref.serverName) result.renamedTo = nextName;
	return result;
}
/** 项目 mcp.json 的 server 值不写 serverName（键即名字，挂载时会由 projectServerName 生成）。 */
function toClientConfigWithoutName(patch) {
	const config = toClientConfig(patch);
	delete config.serverName;
	return config;
}
/**
* 删除一个 MCP 服务器：写文件 → 卸载 loader 行 → 清理策略。预设组合行一律拒绝。
*
* @throws 目标只读 / 文件里找不到该行（都不做部分修改）。
*/
async function removeServer(deps, input) {
	const { ctx, registry, policy } = deps;
	const ref = registry.refFor(input.serverName, void 0);
	if (!ref) throw new Error(`未知 MCP server：${input.serverName}`);
	const target = await resolveWritableTarget(ref);
	if (target.kind === "readonly") throw readonlyError(input.serverName, target);
	if (target.kind === "patch") {
		const removed = removeRowBlock(await readFile(target.file, "utf8").catch((error) => {
			throw new Error(`读取 ${target.file} 失败：${messageOf(error)}`);
		}), target.rowId);
		if (!removed.removed) throw new Error(`${target.file} 里找不到 "- id: ${target.rowId}" 这一行（可能被手工删除），未做任何改动`);
		await writeFileAtomic(target.file, removed.text);
	} else {
		const parsed = await readJsonFile(target.file);
		const servers = parsed.mcpServers;
		if (servers === null || typeof servers !== "object" || Array.isArray(servers)) throw new Error(`${target.file} 里没有 mcpServers 映射`);
		const map = servers;
		if (!(target.key in map)) throw new Error(`${target.file} 里找不到 server "${target.key}"（可能被手工改过）`);
		delete map[target.key];
		parsed.mcpServers = map;
		await writeFileAtomic(target.file, `${JSON.stringify(parsed, null, 2)}\n`);
		await remountQuietly(ctx, policy, target.workspace);
	}
	let unloaded = false;
	try {
		await ctx.loader.remove(ref.entryId);
		unloaded = true;
	} catch (error) {
		ctx.logger.debug?.(`dsh-mcp-router: loader remove for "${ref.serverName}" skipped (${messageOf(error)})`);
	}
	if (await policy.clear(ref.serverName, ref.workspace)) ctx.logger.info?.(`dsh-mcp-router: cleared policy of removed MCP "${ref.serverName}"`);
	await registry.refreshNow();
	return {
		serverName: ref.serverName,
		file: target.file,
		unloaded
	};
}
async function describeServer(deps, input) {
	const { registry } = deps;
	const ref = registry.refFor(input.serverName, void 0);
	if (!ref) throw new Error(`未知 MCP server：${input.serverName}`);
	const target = await resolveWritableTarget(ref);
	let config = { serverName: ref.serverName };
	if (target.kind === "patch") config = patchBaseFromLoader(deps, ref);
	else if (target.kind === "project") config = projectBaseFrom(await readJsonFile(target.file), target.key, target.file);
	let keys = [];
	if (target.kind === "patch") {
		const text = await readFile(target.file, "utf8").catch(() => "");
		keys = ((text ? readConfigBlock(text, target.rowId) : void 0)?.keys ?? []).map((key) => ({
			name: key.name,
			dynamic: key.dynamic
		}));
	} else if (target.kind === "project") keys = Object.keys(config).map((name) => ({
		name,
		dynamic: false
	}));
	const detail = {
		serverName: ref.serverName,
		target,
		config,
		keys
	};
	if (target.kind === "readonly") detail.readonly = `声明在预设组合文件 ${basename(target.file) || target.file}（只读）`;
	return detail;
}
//#endregion
//#region src/routes.ts
/**
* HTTP 路由层：策略读写、启停意图、预设列表与诊断端点（前缀 `/api/dsh-mcp-router`）。
*
* 设计（P2-6 收敛）：`handle`/`handleAny` 统一 method 校验 / 异步错误响应 /
* `{ok:true}` 包装；写操作要求 `x-panel-token` 与本进程随机令牌一致（阻断跨源 /
* DNS-rebinding 对本地控制端点的盲写），GET 只读端点保持开放。
*
* 端点与职责：
* - `GET  /state`        面板视图（注册表行 × 策略 × 预设隔离后的生效档位）
* - `GET  /presets`      可关联的 agent 预设列表
* - `POST /policy`       写策略（档位 / 预设关联 / 工具级禁用），支持批量
* - `POST /policy/commit` 立即应用 next-session 模式积压的待生效意图（有缓存代价）
* - `GET/POST /config`   生效时机（immediate / next-session）
* - `POST /mcp/add`、`POST /mcp/preview`  快速迁移（粘贴 mcpServers JSON）
* - `GET  /debug`、`POST /debug/collect`  运维诊断
*/
const API_PREFIX = "/api/dsh-mcp-router";
/** 旧前缀（独立分叉前为 /api/mcp-panel，0.3.1 及以前为 /api/runtime-inventory），保留兼容 */
const LEGACY_API_PREFIXES = ["/api/mcp-panel", "/api/runtime-inventory"];
/** 进程级随机令牌：写操作（策略/config）要求客户端在 x-panel-token 头携带。 */
const PANEL_TOKEN = randomBytes(32).toString("hex");
/** readBody 体积上限：防无界 body 累积（本地 DoS 向量）。 */
const MAX_BODY_BYTES = 65536;
function json(res, code, body) {
	res.statusCode = code;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
}
function ok(res, data) {
	json(res, 200, {
		ok: true,
		...data
	});
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const decoder = new StringDecoder("utf8");
		let body = "";
		let bytes = 0;
		let settled = false;
		const onData = (chunk) => {
			if (settled) return;
			const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
			bytes += buf.length;
			if (bytes > MAX_BODY_BYTES) {
				settled = true;
				cleanup();
				req.resume();
				reject(/* @__PURE__ */ new Error(`body exceeds ${MAX_BODY_BYTES} bytes`));
				return;
			}
			body += decoder.write(buf);
		};
		const onEnd = () => {
			if (settled) return;
			settled = true;
			body += decoder.end();
			cleanup();
			resolve(body);
		};
		const onError = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
		};
		req.on("data", onData);
		req.on("end", onEnd);
		req.on("error", onError);
	});
}
function queryParam(url, key) {
	const m = new RegExp(`[?&]${key}=([^&]+)`).exec(url);
	return m ? decodeURIComponent(m[1]) : void 0;
}
/** 写操作 token 校验（x-panel-token === 本进程随机令牌）。 */
function tokenOk(req) {
	return req.headers["x-panel-token"] === PANEL_TOKEN;
}
/** 端点样板：method 校验 + 异步执行 + {ok:true} 包装 + 统一错误码（POST 参数错 400 / GET 服务错 500）。
* guarded=true 时要求 x-panel-token 匹配（写操作鉴权）。 */
function handle(method, run, guarded = false) {
	return (req, res) => {
		if (req.method !== method) {
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
			return;
		}
		if (guarded && !tokenOk(req)) {
			json(res, 401, {
				ok: false,
				error: "unauthorized"
			});
			return;
		}
		Promise.resolve(run(req)).then((data) => ok(res, data)).catch((error) => json(res, method === "POST" ? 400 : 500, {
			ok: false,
			error: messageOf(error)
		}));
	};
}
/**
* 同 path 多 method 路由：webServer 的 exact 路由按 path 唯一（同 path 重复注册
* 会中断后续注册），因此 GET+POST 共存的端点必须合并为单个 handler 内部分发。
* guardPosts=true 时仅 POST 需要 x-panel-token。
*/
function handleAny(entries, guardPosts = false) {
	return (req, res) => {
		const entry = entries.find((e) => e.method === req.method);
		if (!entry) {
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
			return;
		}
		handle(entry.method, entry.run, guardPosts && entry.method === "POST")(req, res);
	};
}
/**
* 路由写文件队列：串行化 appendGlobalPatch / writeProjectMcp 的「读-改-写」。
* 并发 POST（或多会话同时添加）若各自以旧内容为基底写盘，
* 先写者的内容会被后写者整体覆盖丢失 → 全部走同一 Promise 链。
*/
let fileWriteChain = Promise.resolve();
/**
* 定位 profile 的用户 patch 层（<profile>/cordis.patch.yml）。
* 根树 backing 文件是 <profile>/cordis.yml（每次启动重置为 []），
* patch 与其同目录；从任一 root 树 entry 的 tree.filename 反推。
*/
function profilePatchPath(ctx) {
	for (const entry of ctx.loader.entries()) {
		const file = (entry.parent?.tree)?.filename;
		if (typeof file === "string" && basename(file) === "cordis.yml") return join(dirname(file), "cordis.patch.yml");
	}
	throw new Error("无法定位 profile 补丁文件 cordis.patch.yml（未找到 cordis.yml 根树；请确认 profile 已正常挂载后重试）");
}
/** 已存在检查：loader 存活行、注册表全部来源行（含预设 standing 行）、patch 文本里已有同 id。 */
function existingRowIds(ctx, registry, patchText) {
	const ids = /* @__PURE__ */ new Set();
	for (const entry of ctx.loader.entries()) {
		if (!isMcpEntry(entry)) continue;
		ids.add(String(entry.options.id));
	}
	try {
		for (const ref of registry.snapshot().all.values()) {
			ids.add(ref.entryId);
			ids.add(`mcp-${ref.serverName}`);
		}
	} catch {}
	for (const line of patchText.split(/\r?\n/)) {
		const m = /^\s*-?\s*id:\s*([^\s]+)\s*$/.exec(line);
		if (m) ids.add(m[1]);
	}
	return ids;
}
/** 追加 `- insert:` patch 块到 profile cordis.patch.yml（串行排队 + 原子写 + 跟随原换行风格）。 */
function appendGlobalPatch(ctx, yamlBlock) {
	const run = fileWriteChain.then(async () => {
		const file = profilePatchPath(ctx);
		const existing = await readFile(file, "utf8").catch(() => "");
		const sep = existing.includes("\r\n") ? "\r\n" : "\n";
		const next = (existing.length > 0 && !existing.endsWith("\n") ? existing + sep : existing) + yamlBlock.replace(/\r?\n/g, sep);
		await writeFile(`${file}.tmp`, next, "utf8");
		await rename(`${file}.tmp`, file);
		return { file };
	});
	fileWriteChain = run.catch(() => void 0);
	return run;
}
/** 把 servers 合并写入 <workspace>/.dsh/mcps/mcp.json（新建 server 覆盖同名旧值；读-改-写串行化）。 */
function writeProjectMcp(workspace, servers) {
	const run = fileWriteChain.then(async () => {
		const mcpsDir = join(workspace, ".dsh", "mcps");
		const file = join(mcpsDir, "mcp.json");
		await mkdir(mcpsDir, { recursive: true });
		let existing = {};
		try {
			const parsed = JSON.parse(await readFile(file, "utf8"));
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
		} catch {}
		let map = {};
		if (existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)) map = existing.mcpServers;
		for (const [name, server] of Object.entries(servers)) map[name] = server;
		const payload = {
			...existing,
			mcpServers: map
		};
		await writeFile(`${file}.tmp`, JSON.stringify(payload, null, 2), "utf8");
		await rename(`${file}.tmp`, file);
		return { file };
	});
	fileWriteChain = run.catch(() => void 0);
	return run;
}
/** 全局添加：写入 profile patch + 立即挂载到 loader（粘贴即用，重启由 patch 承接）。 */
async function addGlobalMcp(ctx, registry, servers) {
	const file = profilePatchPath(ctx);
	const existingIds = existingRowIds(ctx, registry, await readFile(file, "utf8").catch(() => ""));
	const toAdd = /* @__PURE__ */ new Map();
	const skipped = [];
	for (const row of serversToRows(servers)) {
		if (existingIds.has(row.id)) {
			skipped.push(String(row.config.serverName));
			continue;
		}
		toAdd.set(row.id, row);
	}
	const rows = [...toAdd.values()];
	if (rows.length === 0) return {
		file,
		added: 0,
		skipped
	};
	const mounted = [];
	for (const row of rows) try {
		await ctx.loader.create(row);
		mounted.push(row);
	} catch (error) {
		skipped.push(String(row.config.serverName));
		ctx.logger.warn?.(`dsh-mcp-router: 全局 MCP "${row.config.serverName}" 挂载失败: ${messageOf(error)}`);
	}
	if (mounted.length === 0) return {
		file,
		added: 0,
		skipped
	};
	await appendGlobalPatch(ctx, serversToPatchYaml(serversFromRows(mounted)));
	return {
		file,
		added: mounted.length,
		skipped
	};
}
/** 从已挂载行重建 McpServers（落盘 patch 用；避免把未挂载成功的行写进去）。 */
function serversFromRows(rows) {
	const servers = {};
	for (const row of rows) {
		const config = row.config;
		servers[config.serverName] = config;
	}
	return servers;
}
function normalizeUpdate(raw) {
	const serverName = typeof raw.serverName === "string" ? raw.serverName.trim() : "";
	if (serverName.length === 0) throw new Error("serverName is required");
	const workspace = typeof raw.workspace === "string" && raw.workspace.length > 0 ? raw.workspace : void 0;
	const patch = {};
	if (raw.exposure !== void 0) {
		if (!isExposure(raw.exposure)) throw new Error(`invalid exposure: ${String(raw.exposure)}`);
		patch.exposure = raw.exposure;
	}
	if (raw.presets !== void 0) patch.presets = normalizePresetScope(raw.presets);
	if (raw.disabledTools !== void 0) patch.disabledTools = (Array.isArray(raw.disabledTools) ? raw.disabledTools : []).filter((v) => typeof v === "string" && v.length > 0).sort();
	if (Object.keys(patch).length === 0) throw new Error("至少需要 exposure / presets / disabledTools 之一");
	return workspace === void 0 ? {
		serverName,
		patch
	} : {
		serverName,
		workspace,
		patch
	};
}
function makeRoutes(deps) {
	const { ctx, hostCtx, caches, catalogRuntime, config, controller, registry, policy, triggerSnapshot } = deps;
	const { mcpCache, invalidateMcp } = caches;
	const cachedMcp = (sessionId) => {
		const key = sessionId ?? "*";
		pruneExpired(mcpCache, Date.now());
		const hit = mcpCache.get(key);
		if (hit && Date.now() - hit.at < 6e4) return hit.promise;
		const promise = collectMcp({
			ctx,
			caches,
			catalogRuntime,
			registry,
			policy,
			controller
		}, sessionId).catch((error) => {
			mcpCache.delete(key);
			throw error;
		});
		mcpCache.set(key, {
			at: Date.now(),
			promise
		});
		return promise;
	};
	/** 当前面板会话的 preset id 与工作空间（预设关联 UI 的「当前会话」标注）。 */
	const sessionScopeOf = (sessionId) => {
		const agent = resolveAgent(hostCtx, sessionId);
		const remembered = lastSessionScope();
		return {
			presetId: agentPresetId(hostCtx, agent) ?? remembered.presetId,
			workspace: agentWorkspace(agent) ?? remembered.workspace
		};
	};
	async function listPresets(sessionId) {
		const { presetId } = sessionScopeOf(sessionId);
		try {
			return {
				presets: (await hostCtx.agentPresets.list()).map((preset) => {
					const row = { id: preset.id };
					if (preset.name !== void 0) row.name = preset.name;
					if (preset.description !== void 0) row.description = preset.description;
					if (preset.broken !== void 0) row.broken = preset.broken;
					return row;
				}),
				current: presetId ?? null
			};
		} catch (error) {
			return {
				presets: [],
				current: presetId ?? null,
				error: messageOf(error)
			};
		}
	}
	const routes = [
		{
			kind: "exact",
			path: `${API_PREFIX}/state`,
			handler: handle("GET", async (req) => {
				const sessionId = queryParam(req.url ?? "", "session");
				return { state: await cachedMcp(sessionId) };
			})
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/presets`,
			handler: handle("GET", async (req) => {
				return await listPresets(queryParam(req.url ?? "", "session"));
			})
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/policy`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				const updates = Array.isArray(parsed.updates) ? parsed.updates : [];
				if (updates.length === 0) throw new Error("updates array is required (non-empty)");
				const applyMode = parsed.applyMode === "next-session" || parsed.applyMode === "immediate" ? parsed.applyMode : stateApplyMode(await readState());
				let applied = false;
				let count = 0;
				const failures = [];
				for (const raw of updates) try {
					const { serverName, workspace, patch } = normalizeUpdate(raw);
					if (catalogRuntime.runtimeServers.has(serverName) && patch.exposure !== void 0) throw new Error(`"${serverName}" 由插件提供，档位固定为「进程常驻」，不支持调整`);
					const result = await policy.set({
						serverName,
						workspace,
						patch,
						applyMode
					});
					applied = applied || result.applied;
					count += 1;
				} catch (error) {
					failures.push({
						serverName: String(raw?.serverName ?? "?"),
						error: messageOf(error)
					});
				}
				if (count > 0) {
					await registry.refreshNow();
					invalidateMcp();
				}
				return {
					applied,
					count,
					failed: failures.length,
					failures,
					applyMode
				};
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/policy/commit`,
			handler: handle("POST", async (req) => {
				if (JSON.parse(await readBody(req) || "{}").confirm !== true) throw new Error("commit 需要显式确认：body 传 { \"confirm\": true }（本操作会让当前会话下一轮 100% miss 前缀缓存，费率约为命中价的 5~12.5 倍）");
				const applied = await policy.commitPending();
				await registry.refreshNow();
				invalidateMcp();
				return { applied };
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/toolToggle`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				if (typeof parsed.serverName !== "string" || parsed.serverName.length === 0) throw new Error("serverName is required");
				if (typeof parsed.toolName !== "string" || parsed.toolName.length === 0) throw new Error("toolName is required");
				const ref = registry.refFor(parsed.serverName, void 0);
				const workspace = typeof parsed.workspace === "string" && parsed.workspace.length > 0 ? parsed.workspace : ref?.workspace;
				const current = policy.effective(parsed.serverName, workspace).disabledTools;
				const disabled = Boolean(parsed.disabled);
				const next = disabled ? [.../* @__PURE__ */ new Set([...current, parsed.toolName])].sort() : current.filter((name) => name !== parsed.toolName);
				await policy.set({
					serverName: parsed.serverName,
					workspace,
					patch: { disabledTools: next },
					applyMode: stateApplyMode(await readState())
				});
				await registry.refreshNow();
				invalidateMcp();
				return {
					serverName: parsed.serverName,
					toolName: parsed.toolName,
					disabled,
					disabledTools: next
				};
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/toolBulk`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				const serverName = typeof parsed.serverName === "string" ? parsed.serverName.trim() : "";
				if (serverName.length === 0) throw new Error("serverName is required");
				if (typeof parsed.disabled !== "boolean") throw new Error("disabled (boolean) is required");
				const ref = registry.refFor(serverName, void 0);
				const workspace = typeof parsed.workspace === "string" && parsed.workspace.length > 0 ? parsed.workspace : ref?.workspace;
				const known = (catalogRuntime.catalog[serverName]?.tools ?? []).map((tool) => String(tool.name));
				if (known.length === 0) throw new Error(`"${serverName}" 当前没有工具目录快照（可能从未启动过），无法批量启停工具；请先启动该 server 或刷新面板`);
				const resolved = resolveToolBulkTargets(parsed.toolNames, known);
				if (resolved.error) throw new Error(resolved.error);
				const current = new Set(policy.effective(serverName, workspace).disabledTools);
				for (const name of resolved.targets) if (parsed.disabled) current.add(name);
				else current.delete(name);
				const next = [...current].sort();
				await policy.set({
					serverName,
					workspace,
					patch: { disabledTools: next },
					applyMode: stateApplyMode(await readState())
				});
				await registry.refreshNow();
				invalidateMcp();
				return {
					serverName,
					disabled: parsed.disabled,
					disabledTools: next,
					disabledCount: next.length,
					changed: resolved.targets.length,
					ignoredToolNames: resolved.ignored
				};
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/config`,
			handler: handleAny([{
				method: "GET",
				run: async () => {
					return {
						applyMode: stateApplyMode(await readState()),
						middleLayer: config.middleLayer !== false,
						defaultExposure: config.defaultExposure ?? "name-only"
					};
				}
			}, {
				method: "POST",
				run: async (req) => {
					const parsed = JSON.parse(await readBody(req) || "{}");
					const state = await readState();
					state.config ??= {};
					if (parsed.applyMode === "immediate" || parsed.applyMode === "next-session") state.config.applyMode = parsed.applyMode;
					await writeState(state);
					return { applyMode: stateApplyMode(state) };
				}
			}], true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/token`,
			handler: handle("GET", async () => ({ token: PANEL_TOKEN }))
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/debug`,
			handler: handle("GET", async () => {
				const catalog = {};
				for (const [server, info] of Object.entries(catalogRuntime.catalog)) catalog[server] = {
					tools: info.tools.length,
					fetchedAt: info.fetchedAt,
					source: info.source
				};
				const scopeDiag = { error: null };
				try {
					const scopeKey = await resolveCollectScopeKey(hostCtx, void 0);
					const scoped = scopeKey ? getSchemasView(hostCtx, caches, scopeKey, DOMAIN_TTL_MS) : [];
					const globalView = getSchemasView(hostCtx, caches, void 0, DOMAIN_TTL_MS);
					const mcpNames = (scopeKey ? mergeSchemas(scoped, globalView) : scoped).map((s) => String(s?.name ?? "")).filter((name) => name.startsWith("mcp__"));
					scopeDiag.scopeKeyType = scopeKey ? typeof scopeKey : null;
					scopeDiag.scopeKeySource = scopeKeySource();
					scopeDiag.scopedTotal = scoped.length;
					scopeDiag.globalTotal = globalView.length;
					scopeDiag.mergedMcpTools = mcpNames.length;
					scopeDiag.scopedMcpSample = mcpNames.slice(0, 20);
				} catch (error) {
					scopeDiag.error = messageOf(error);
				}
				const snapshot = registry.snapshot();
				return {
					diag: catalogRuntime.diag,
					catalog,
					scopeDiag,
					registry: {
						...registry.diagnostics(),
						servers: [...snapshot.all.values()].map((ref) => ({
							serverName: ref.serverName,
							source: ref.source,
							disabled: ref.disabled,
							running: ref.running,
							exposure: policy.effective(ref.serverName, ref.workspace).exposure
						}))
					},
					policy: policy.diagnostics()
				};
			})
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/debug/collect`,
			handler: handle("POST", async () => {
				await triggerSnapshot();
				return { diag: catalogRuntime.diag };
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/detail`,
			handler: handle("GET", async (req) => {
				const url = req.url ?? "";
				const serverName = queryParam(url, "serverName");
				if (typeof serverName !== "string" || serverName.length === 0) throw new Error("serverName is required");
				const workspace = queryParam(url, "workspace");
				const detail = await describeServer({
					ctx: hostCtx,
					registry,
					policy
				}, {
					serverName,
					workspace
				});
				return {
					...detail,
					config: maskConfigSecrets(detail.config)
				};
			})
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/update`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				const serverName = typeof parsed.serverName === "string" ? parsed.serverName.trim() : "";
				if (serverName.length === 0) throw new Error("serverName is required");
				if (parsed.patch === null || typeof parsed.patch !== "object" || Array.isArray(parsed.patch)) throw new Error("patch object is required");
				const workspace = typeof parsed.workspace === "string" && parsed.workspace.length > 0 ? parsed.workspace : void 0;
				const result = await updateServer({
					ctx: hostCtx,
					registry,
					policy
				}, {
					serverName,
					workspace,
					patch: parsed.patch
				});
				invalidateMcp();
				return result;
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/remove`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				const serverName = typeof parsed.serverName === "string" ? parsed.serverName.trim() : "";
				if (serverName.length === 0) throw new Error("serverName is required");
				const workspace = typeof parsed.workspace === "string" && parsed.workspace.length > 0 ? parsed.workspace : void 0;
				const result = await removeServer({
					ctx: hostCtx,
					registry,
					policy
				}, {
					serverName,
					workspace
				});
				invalidateMcp();
				return result;
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/scan`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				const { workspace } = sessionScopeOf(void 0);
				const workspaceForSources = getActiveWorkspace() ?? workspace;
				const builtin = knownMcpSources({
					home: homedir(),
					workspace: workspaceForSources
				});
				const extraPaths = (Array.isArray(parsed.paths) ? parsed.paths : []).filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
				const seen = /* @__PURE__ */ new Set();
				const candidates = [];
				for (const source of builtin) {
					if (seen.has(source.path)) continue;
					seen.add(source.path);
					const entry = {
						id: source.id,
						label: source.label,
						file: source.path,
						supported: source.supported
					};
					if (source.note !== void 0) entry.note = source.note;
					candidates.push(entry);
				}
				for (const file of extraPaths) {
					if (seen.has(file)) continue;
					seen.add(file);
					candidates.push({
						id: `custom:${file}`,
						label: file,
						file,
						supported: true
					});
				}
				const existing = [...registry.snapshot().all.keys()];
				const isExisting = (name) => existing.includes(name) || existing.some((server) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9a-f]{8}$`).test(server));
				const sources = [];
				for (const candidate of candidates) {
					if (!candidate.supported) {
						sources.push({
							...candidate,
							exists: false,
							skipped: candidate.note ?? "本版本不支持该格式"
						});
						continue;
					}
					let text;
					try {
						text = await readFile(candidate.file, "utf8");
					} catch {
						sources.push({
							...candidate,
							exists: false
						});
						continue;
					}
					const result = parseExternalMcpConfig(text);
					sources.push({
						...candidate,
						exists: true,
						format: result.format ?? null,
						errors: result.errors,
						warnings: result.warnings,
						servers: result.servers.map((server) => ({
							name: server.name,
							transport: server.config.transport,
							summary: describeImportedServer(server),
							enabled: server.enabled,
							notes: server.notes,
							config: server.config,
							existing: isExisting(server.name)
						}))
					});
				}
				return {
					sources,
					workspace: workspaceForSources ?? null
				};
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/preview`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				if (typeof parsed.json !== "string" || parsed.json.trim().length === 0) throw new Error("json is required");
				const { servers, errors, warnings } = parseMcpServersJson(parsed.json);
				if (errors.length > 0) throw new Error(errors.join("；"));
				if (Object.keys(servers).length === 0) throw new Error("未解析出任何 MCP server");
				return {
					names: Object.keys(servers),
					yaml: serversToPatchYaml(servers),
					warnings
				};
			}, true)
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/mcp/add`,
			handler: handle("POST", async (req) => {
				const parsed = JSON.parse(await readBody(req) || "{}");
				if (typeof parsed.json !== "string" || parsed.json.trim().length === 0) throw new Error("json is required");
				const target = parsed.target === "project" ? "project" : "global";
				const { servers, errors, warnings } = parseMcpServersJson(parsed.json);
				if (errors.length > 0) throw new Error(`转换失败：${errors.join("；")}`);
				if (Object.keys(servers).length === 0) throw new Error("没有可添加的 MCP server");
				if (target === "global") {
					const result = await addGlobalMcp(ctx, registry, servers);
					if (result.added === 0) throw new Error(`全部跳过（已存在或挂载失败）：${result.skipped.join("、") || "未知原因"}`);
					await registry.refreshNow();
					invalidateMcp();
					const names = Object.keys(servers).filter((name) => !result.skipped.includes(name));
					return {
						target,
						...result,
						names,
						warnings
					};
				}
				let workspace = typeof parsed.workspace === "string" && parsed.workspace.length > 0 ? parsed.workspace : void 0;
				if (!workspace) workspace = getActiveWorkspace() ?? sessionScopeOf(void 0).workspace;
				if (typeof workspace !== "string" || workspace.length === 0) throw new Error("project 目标需要 workspace（当前会话工作空间）");
				const written = await writeProjectMcp(workspace, servers);
				await remountWorkspace(ctx, workspace, policy);
				await registry.refreshNow();
				invalidateMcp();
				const names = Object.keys(servers).map((name) => projectServerName(workspace, name));
				return {
					target: "project",
					...written,
					workspace,
					added: Object.keys(servers).length,
					names,
					warnings
				};
			}, true)
		}
	];
	return [...routes, ...LEGACY_API_PREFIXES.flatMap((prefix) => routes.map((route) => ({
		...route,
		path: route.path.replace(API_PREFIX, prefix)
	})))];
}
//#endregion
//#region src/preset-mcp.ts
var preset_mcp_exports = /* @__PURE__ */ __exportAll({
	firstMatchServerName: () => firstMatchServerName,
	listAllPresetMcpRows: () => listAllPresetMcpRows,
	listPresetMcpRows: () => listPresetMcpRows,
	parsePresetMcpText: () => parsePresetMcpText
});
/** 短 rowId 回落 serverName（preset 文本缺 serverName 键时用；覆盖已知例外）。 */
function fallbackServerName(rowId) {
	if (rowId === "mcp-anki") return "anki-mcp";
	return rowId.replace(/^mcp-/, "");
}
/**
* 从 preset 组合文件文本解析某 rowId 的 serverName（v1 状态迁移用）。
*
* @param text - 组合文件文本；`null` 表示文件不可读 → 回落命名约定（`mcp-x` → `x`，
*   已知例外 `mcp-anki` → `anki-mcp`）。
* @returns serverName；文件可读但**不含该行**时返回 undefined（该行已失效，调用方
*   应记入 unresolved 而非猜测）。
*/
function firstMatchServerName(text, rowId) {
	if (text === null) return fallbackServerName(rowId);
	const hit = parsePresetMcpText(text).get(rowId);
	return hit ? hit.serverName : void 0;
}
/**
* 解析 preset 组合文本，抽取全部 `mcp-*` 行的 serverName/transport/超时。
* 纯文本正则（preset 文件结构稳定）：按 `^- id:` 切块，块内抓三个键。
* 键锚定行首（防注释/长键误命中）；值允许可选双引号（YAML `"stdio"` 形态）。
* 纯函数，可被 selftest 直接覆盖。
*/
function parsePresetMcpText(text) {
	const out = /* @__PURE__ */ new Map();
	const blocks = String(text ?? "").split(/(?=^- id:\s*)/m);
	for (const block of blocks) {
		const idMatch = /^-\s*id:\s*"?([^"\s]+)"?\s*$/m.exec(block);
		if (!idMatch) continue;
		const rowId = idMatch[1];
		if (!rowId.startsWith("mcp-")) continue;
		const sn = /^\s*serverName:\s*"?([A-Za-z0-9_-]+)"?\s*(?:#.*)?$/m.exec(block);
		const tr = /^\s*transport:\s*"?(\S+?)"?\s*(?:#.*)?$/m.exec(block);
		const tm = /^\s*toolCallTimeoutMs:\s*"?(\d+)"?\s*(?:#.*)?$/m.exec(block);
		const parsed = {
			serverName: sn ? sn[1] : fallbackServerName(rowId),
			transport: tr ? tr[1] : null
		};
		if (tm) {
			const n = Number(tm[1]);
			if (Number.isFinite(n) && n > 0) parsed.toolCallTimeoutMs = n;
		}
		out.set(rowId, parsed);
	}
	return out;
}
async function readInventory(ctx) {
	const inventory = await ctx.agentPresets.compositionInventory();
	return Array.isArray(inventory) ? inventory : [];
}
/** 该 preset 的 standing 组合文件路径（resolve 失败返回空串）。 */
async function presetPathOf(ctx, presetId) {
	const resolved = await ctx.agentPresets.resolve(presetId);
	return String(resolved?.path ?? "");
}
/** 把 inventory 的 MCP 行 + preset 文本配置合并为 PresetMcpRow。 */
function mergeRows(inventoryRows, parsed, file) {
	const rows = [];
	for (const r of inventoryRows) {
		if (String(r?.moduleName ?? "") !== "@deepseek-ai/dsh-mcp-client") continue;
		const entryId = String(r?.entryId ?? "");
		if (!entryId) continue;
		const rowId = entryId.split(":").pop() ?? entryId;
		const info = parsed.get(rowId);
		const serverName = info?.serverName ?? fallbackServerName(rowId);
		const disabled = r?.enabled === false;
		const running = r?.fiberState !== void 0 && r?.fiberState !== null;
		const row = {
			entryId,
			rowId,
			serverName,
			transport: info?.transport ?? null,
			disabled,
			running,
			file
		};
		if (info?.toolCallTimeoutMs !== void 0) row.toolCallTimeoutMs = info.toolCallTimeoutMs;
		rows.push(row);
	}
	return rows;
}
/**
* 列出某 preset 在 standing 组合中的全部 MCP 行。
* inventory 给 entryId/enabled/fiberState，preset 文本给 serverName/transport/超时。
*/
async function listPresetMcpRows(ctx, presetId) {
	const found = (await readInventory(ctx)).find((c) => String(c?.id ?? "") === presetId);
	if (!found) throw new Error(`preset "${presetId}" not in compositionInventory`);
	const presetPath = await presetPathOf(ctx, presetId);
	if (!presetPath) throw new Error(`preset "${presetId}" has no path`);
	const presets = ctx.agentPresets;
	const text = String(await presets.read(presetId));
	return {
		rows: mergeRows(found.rows ?? [], parsePresetMcpText(text), presetPath),
		presetPath
	};
}
/**
* 全量列出**所有** preset 的 standing MCP 行（注册表快照用）。
*
* 装配必须按「当前会话的 preset」精确判定一个 MCP 行的运行状态，而 rc.1 下这些行
* 不在 `ctx.loader.entries()` 里，只能一次扫全量再按 presetId 分桶。无 MCP 行的
* preset 直接跳过（避免无谓的 read 与文件 IO）。
*/
async function listAllPresetMcpRows(ctx) {
	const inventory = await readInventory(ctx);
	const presets = ctx.agentPresets;
	const out = [];
	for (const entry of inventory) {
		const presetId = String(entry?.id ?? "");
		if (!presetId) continue;
		const mcpRows = (entry.rows ?? []).filter((r) => String(r?.moduleName ?? "") === MCP_CLIENT_NAME);
		if (mcpRows.length === 0) continue;
		let file;
		try {
			file = await presetPathOf(ctx, presetId);
		} catch {
			continue;
		}
		if (!file) continue;
		let text;
		try {
			text = String(await presets.read(presetId));
		} catch {
			continue;
		}
		for (const row of mergeRows(mcpRows, parsePresetMcpText(text), file)) out.push({
			...row,
			presetId
		});
	}
	return out;
}
//#endregion
//#region src/domain/policy.ts
/**
* 策略层 —— 插件唯一的「每个 MCP 可见性/可用性」真源。
*
* 两份内存表：
* - **intent**：用户意图（持久化到 state.json 的 `servers` / `projects` 分区）。
* - **effective**：当前运行时生效值（装配层、`dsh_mcp_search`、`dsh_mcp_call` 只读这一份）。
*
* 生效时机（`applyMode`）：
* - `immediate`（默认）：`set()` 同时更新两份，并通知 `onEffectiveChanged` 调整进程状态。
* - `next-session`：只更新 intent 并落盘；effective 在会话边界（`commitPending()`）
*   或重启后提升 —— 当前会话的工具集/前缀保持不变（零缓存失效）。
*
* 启动时执行一次 v1 → v2 迁移（`domain/exposure.ts` 的纯函数 + 这里的文件解析包装），
* 原文件备份为 `state.v1.json`。
*/
/** 策略键：全局用空 workspace，项目级用其工作空间根。 */
function keyOf(serverName, workspace) {
	return `${workspace ?? ""}\u0000${serverName}`;
}
function createPolicyStore(options) {
	const { ctx } = options;
	const fallbackExposure = options.fallbackExposure ?? "name-only";
	const intent = /* @__PURE__ */ new Map();
	const effective = /* @__PURE__ */ new Map();
	const pending = /* @__PURE__ */ new Set();
	let loaded = false;
	let version = null;
	let migrated = null;
	let lastError = null;
	const diagnosticsUnresolved = [];
	const slot = (table, key) => {
		const hit = table.get(key);
		if (hit) return hit;
		const created = defaultPolicy(fallbackExposure);
		table.set(key, created);
		return created;
	};
	/** intent → effective 的纯拷贝（保持两份表独立，便于 pending 判定）。 */
	function promote(keys) {
		const changes = [];
		for (const key of keys) {
			const desired = intent.get(key);
			if (!desired) continue;
			const previous = effective.get(key);
			const next = {
				exposure: desired.exposure,
				presets: {
					mode: desired.presets.mode,
					ids: [...desired.presets.ids]
				},
				disabledTools: [...desired.disabledTools]
			};
			effective.set(key, next);
			changes.push({
				serverName: key.slice(key.indexOf("\0") + 1),
				workspace: key.slice(0, key.indexOf("\0")) || void 0,
				policy: next,
				previous
			});
		}
		return changes;
	}
	function loadFromState(state) {
		for (const [serverName, raw] of Object.entries(state.servers ?? {})) {
			const entry = { ...normalizePolicy(raw, fallbackExposure) };
			if (typeof raw?.applied === "boolean" || raw?.applied === null) entry.applied = raw.applied;
			intent.set(keyOf(serverName), entry);
		}
		for (const [workspace, table] of Object.entries(state.projects ?? {})) for (const [serverName, raw] of Object.entries(table ?? {})) {
			const entry = { ...normalizePolicy(raw, fallbackExposure) };
			if (typeof raw?.applied === "boolean" || raw?.applied === null) entry.applied = raw.applied;
			intent.set(keyOf(serverName, workspace), entry);
		}
	}
	/** 把两份表写回 state.json 的 v2 分区（并清除 v1 遗留字段）。 */
	function toState(state) {
		const servers = {};
		const projects = {};
		for (const [key, policy] of intent) {
			const at = key.indexOf("\0");
			const workspace = key.slice(0, at);
			const serverName = key.slice(at + 1);
			if (workspace.length === 0) servers[serverName] = policy;
			else (projects[workspace] ??= {})[serverName] = policy;
		}
		const next = {
			...state,
			version: 2,
			servers,
			projects
		};
		delete next.mcp;
		delete next.projectMcp;
		delete next.toolDisabled;
		delete next.projectToolDisabled;
		if (next.config) delete next.config.autoManage;
		return next;
	}
	/** v1 → v2 迁移（纯函数 + 文件解析包装）；返回迁移条数。 */
	async function migrate(state) {
		const autoManage = state.config?.autoManage === true;
		const files = new Set(Object.keys(state.mcp ?? {}));
		const texts = /* @__PURE__ */ new Map();
		for (const file of files) try {
			texts.set(file, await readFile(file, "utf8"));
		} catch {
			texts.set(file, null);
		}
		const result = migrateV1Policies({
			mcp: state.mcp,
			projectMcp: state.projectMcp,
			toolDisabled: state.toolDisabled,
			projectToolDisabled: state.projectToolDisabled
		}, (file, rowId) => firstMatchServerName(texts.get(file) ?? null, rowId), autoManage);
		for (const [serverName, policy] of Object.entries(result.servers)) if (!intent.has(keyOf(serverName))) intent.set(keyOf(serverName), { ...policy });
		for (const [workspace, table] of Object.entries(result.projects)) for (const [serverName, policy] of Object.entries(table)) {
			const key = keyOf(serverName, workspace);
			if (!intent.has(key)) intent.set(key, { ...policy });
		}
		for (const [file, rows] of Object.entries(state.mcp ?? {})) for (const [rowId, row] of Object.entries(rows ?? {})) {
			const serverName = firstMatchServerName(texts.get(file) ?? null, rowId);
			if (!serverName) continue;
			const entry = intent.get(keyOf(serverName));
			if (entry && entry.applied === void 0 && row && typeof row.lastApplied === "boolean") entry.applied = row.lastApplied;
		}
		diagnosticsUnresolved.push(...result.unresolved);
		return result.migrated;
	}
	return {
		async load() {
			if (loaded) return;
			try {
				const state = await readState();
				version = typeof state.version === "number" ? state.version : null;
				if (version !== 2 && hasV1PolicyData(state)) {
					try {
						const raw = await readFile(stateFilePath(), "utf8");
						await mkdir(stateDir(), { recursive: true });
						await writeFile(`${stateDir()}/state.v1.json`, raw, {
							encoding: "utf8",
							mode: 384
						});
					} catch (error) {
						ctx.logger.warn?.(`dsh-mcp-router: state v1 backup failed: ${messageOf(error)}`);
					}
					loadFromState(state);
					migrated = await migrate(state);
					await writeState(toState(state));
					ctx.logger.info?.(`dsh-mcp-router: migrated ${migrated} state entr(ies) to v2`);
				} else {
					loadFromState(state);
					if (version !== 2) await writeState(toState(state));
				}
				promote([...intent.keys()]);
				loaded = true;
			} catch (error) {
				lastError = messageOf(error);
				loaded = true;
				ctx.logger.warn?.(`dsh-mcp-router: policy load failed: ${lastError}`);
			}
		},
		effective(serverName, workspace) {
			return effective.get(keyOf(serverName, workspace)) ?? defaultPolicy(fallbackExposure);
		},
		intent(serverName, workspace) {
			return intent.get(keyOf(serverName, workspace));
		},
		isPending(serverName, workspace) {
			return pending.has(keyOf(serverName, workspace));
		},
		list() {
			const rows = [];
			for (const [key, policy] of intent) {
				const at = key.indexOf("\0");
				const workspace = key.slice(0, at);
				const row = {
					serverName: key.slice(at + 1),
					policy,
					effective: effective.get(key) ?? defaultPolicy(fallbackExposure),
					pending: pending.has(key),
					configured: true
				};
				if (workspace.length > 0) row.workspace = workspace;
				rows.push(row);
			}
			rows.sort((a, b) => a.serverName.localeCompare(b.serverName));
			return rows;
		},
		async set(input) {
			const key = keyOf(input.serverName, input.workspace);
			const current = slot(intent, key);
			const entry = { ...normalizePolicy({
				exposure: input.patch.exposure ?? current.exposure,
				presets: input.patch.presets ?? current.presets,
				disabledTools: input.patch.disabledTools ?? current.disabledTools
			}, fallbackExposure) };
			if (input.applied !== void 0) entry.applied = input.applied;
			else if (current.applied !== void 0) entry.applied = current.applied;
			intent.set(key, entry);
			const immediate = input.applyMode === "immediate";
			let changes = [];
			if (immediate) {
				pending.delete(key);
				changes = promote([key]);
			} else pending.add(key);
			await writeState(toState(await readState()));
			if (changes.length > 0) try {
				await options.onEffectiveChanged?.(changes);
			} catch (error) {
				ctx.logger.warn?.(`dsh-mcp-router: apply process state failed: ${messageOf(error)}`);
			}
			return {
				applied: immediate,
				policy: entry
			};
		},
		async commitPending() {
			if (pending.size === 0) return 0;
			const keys = [...pending];
			pending.clear();
			const changes = promote(keys);
			await writeState(toState(await readState()));
			try {
				await options.onEffectiveChanged?.(changes);
			} catch (error) {
				ctx.logger.warn?.(`dsh-mcp-router: apply process state failed: ${messageOf(error)}`);
			}
			return changes.length;
		},
		async renameServer(oldName, newName, workspace) {
			const fromKey = keyOf(oldName, workspace);
			const toKey = keyOf(newName, workspace);
			if (fromKey === toKey) return false;
			const entry = intent.get(fromKey);
			if (!entry) return false;
			const prefix = `mcp__${oldName}__`;
			const disabledTools = entry.disabledTools.map((name) => name.startsWith(prefix) ? `mcp__${newName}__${name.slice(prefix.length)}` : name);
			const next = {
				...entry,
				disabledTools
			};
			intent.delete(fromKey);
			effective.delete(fromKey);
			const wasPending = pending.delete(fromKey);
			intent.set(toKey, next);
			effective.set(toKey, {
				exposure: next.exposure,
				presets: {
					mode: next.presets.mode,
					ids: [...next.presets.ids]
				},
				disabledTools: [...next.disabledTools]
			});
			if (wasPending) pending.add(toKey);
			await writeState(toState(await readState()));
			return true;
		},
		async clear(serverName, workspace) {
			const key = keyOf(serverName, workspace);
			const had = intent.delete(key);
			effective.delete(key);
			pending.delete(key);
			if (!had) return false;
			await writeState(toState(await readState()));
			return true;
		},
		async adoptFromFile(serverName, workspace, fileDisabled) {
			const key = keyOf(serverName, workspace);
			if (intent.has(key)) return void 0;
			const entry = { ...defaultPolicy(fileDisabled === true ? "hidden" : "name-only") };
			if (fileDisabled !== null) entry.applied = fileDisabled;
			intent.set(key, entry);
			effective.set(key, {
				exposure: entry.exposure,
				presets: { ...entry.presets },
				disabledTools: [...entry.disabledTools]
			});
			await writeState(toState(await readState()));
			return entry;
		},
		async markApplied(serverName, workspace, applied) {
			const key = keyOf(serverName, workspace);
			const entry = intent.get(key);
			if (!entry) return;
			entry.applied = applied;
			await writeState(toState(await readState()));
		},
		diagnostics() {
			return {
				loaded,
				version,
				configured: intent.size,
				migrated,
				unresolved: [...diagnosticsUnresolved],
				lastError
			};
		}
	};
}
//#endregion
//#region src/domain/registry.ts
const EMPTY_SNAPSHOT = {
	all: /* @__PURE__ */ new Map(),
	byPreset: /* @__PURE__ */ new Map(),
	at: 0
};
/** 刷新去抖窗口（tools/change 风暴期合并）。 */
const REFRESH_DEBOUNCE_MS = 150;
/** 从 loader entry 构造 ref。 */
function refFromEntry(entry) {
	const serverName = serverNameOf(entry);
	const cfg = mcpEntryConfig(entry);
	const rawTimeout = cfg?.toolCallTimeoutMs;
	const workspace = projectServerOwner(serverName);
	const tree = entry.parent?.tree;
	const ref = {
		serverName,
		entryId: entry.id,
		rowId: entry.options.id,
		source: workspace !== void 0 ? "project" : "loader",
		disabled: Boolean(entry.disabled),
		running: entry.fiber !== void 0,
		transport: cfg?.transport === void 0 || cfg.transport === null ? null : String(cfg.transport)
	};
	if (typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout > 0) ref.toolCallTimeoutMs = rawTimeout;
	if (typeof tree?.filename === "string" && tree.filename.length > 0) ref.file = tree.filename;
	if (workspace !== void 0) ref.workspace = workspace;
	return ref;
}
/**
* 创建注册表。
*
* @param ctx - 插件 apply 的 host ctx（用于 loader/preset 读取与事件订阅）。
* @param onRefreshed - 快照更新后的回调（面板缓存失效等）。
*/
function createRegistry(ctx, onRefreshed) {
	let snapshot = EMPTY_SNAPSHOT;
	let refreshing = false;
	let pending = false;
	let timer;
	const diag = {
		refreshes: 0,
		lastAt: null,
		lastError: null,
		loaderRows: 0,
		presetRows: 0,
		presets: 0
	};
	async function rebuild() {
		if (refreshing) {
			pending = true;
			return;
		}
		refreshing = true;
		try {
			const all = /* @__PURE__ */ new Map();
			let loaderRows = 0;
			for (const entry of ctx.loader.entries()) {
				if (!isMcpEntry(entry)) continue;
				loaderRows += 1;
				const ref = refFromEntry(entry);
				if (!all.has(ref.serverName)) all.set(ref.serverName, ref);
			}
			const byPreset = /* @__PURE__ */ new Map();
			let presetRows = 0;
			try {
				const rows = await listAllPresetMcpRows(ctx);
				for (const row of rows) {
					presetRows += 1;
					let bucket = byPreset.get(row.presetId);
					if (!bucket) {
						bucket = /* @__PURE__ */ new Map();
						byPreset.set(row.presetId, bucket);
					}
					const ref = {
						serverName: row.serverName,
						entryId: row.entryId,
						rowId: row.rowId,
						source: "preset",
						disabled: row.disabled,
						running: row.running,
						transport: row.transport,
						file: row.file,
						presetId: row.presetId
					};
					if (row.toolCallTimeoutMs !== void 0) ref.toolCallTimeoutMs = row.toolCallTimeoutMs;
					if (!bucket.has(row.serverName)) bucket.set(row.serverName, ref);
					if (!all.has(row.serverName)) all.set(row.serverName, ref);
				}
			} catch (error) {
				diag.lastError = `preset rows: ${messageOf(error)}`;
			}
			snapshot = {
				all,
				byPreset,
				at: Date.now()
			};
			diag.refreshes += 1;
			diag.lastAt = snapshot.at;
			diag.loaderRows = loaderRows;
			diag.presetRows = presetRows;
			diag.presets = byPreset.size;
			onRefreshed?.();
		} catch (error) {
			diag.lastError = messageOf(error);
		} finally {
			refreshing = false;
			if (pending) {
				pending = false;
				rebuild();
			}
		}
	}
	function schedule() {
		if (timer) return;
		timer = ctx.timeout(() => {
			timer = void 0;
			rebuild();
		}, REFRESH_DEBOUNCE_MS);
	}
	return {
		snapshot: () => snapshot,
		refFor(serverName, presetId) {
			if (typeof presetId === "string" && presetId.length > 0) {
				const hit = snapshot.byPreset.get(presetId)?.get(serverName);
				if (hit) return hit;
			}
			return snapshot.all.get(serverName);
		},
		refresh: async () => {
			schedule();
		},
		refreshNow: () => rebuild(),
		diagnostics: () => ({ ...diag }),
		install() {
			const offTools = ctx.root.on("tools/change", () => schedule());
			const offDispose = ctx.root.on("loader/partial-dispose", () => schedule());
			const offSession = ctx.root.on("agent/created", () => {
				schedule();
			});
			return () => {
				offTools();
				offDispose();
				offSession();
				timer?.();
				timer = void 0;
			};
		}
	};
}
//#endregion
//#region src/domain/assembly.ts
/** name-only 索引段的段名（唯一，避免与其它插件冲突）。 */
const SERVER_INDEX_SECTION = "dsh-mcp-router:server-index";
/** 索引段在工具区之后的偏移（`TOOLS_SDK` 顺序号 + 10）。 */
const SERVER_INDEX_ORDER_OFFSET = 10;
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
function countSearchableHidden(hiddenNames, hasTools) {
	if (hasTools === void 0) return hiddenNames.length;
	let count = 0;
	for (const serverName of hiddenNames) if (hasTools(serverName)) count += 1;
	return count;
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
* @param nameOnly - 进程常驻索引段的 server 列表（原地追加）。
* @param runtime - 运行时发现的 server 及工具数。
* @param isReady - 就绪判定（由上层提供，缺省视为未就绪）。
*/
function mergeRuntimeIntoPlan(byServer, nameOnly, runtime, isReady, exposureOf) {
	for (const [serverName, info] of runtime) {
		if (byServer.has(serverName)) continue;
		if (info.tools <= 0) continue;
		if (isReady === void 0 || !isReady(serverName)) continue;
		const exposure = exposureOf?.(serverName) ?? "name-only";
		if (exposure === "off") continue;
		byServer.set(serverName, exposure);
		if (exposure === "name-only") nameOnly.push(serverName);
	}
}
/** 计算某 server 的有效曝光（先作用域、再档位）。装配层与中间层共用。 */
function exposureForRef(deps, ref, presetId, workspace) {
	if (ref.workspace !== void 0 && !sameWorkspace(ref.workspace, workspace)) return "off";
	return decideExposure({
		policy: deps.policy.effective(ref.serverName, ref.workspace),
		running: ref.running && !ref.disabled,
		aiActive: deps.isAiActive(ref.serverName),
		presetId
	});
}
/**
* 构建一次装配的判定计划（同步；装配 waterfall 与 section provider 共用）。
*
* @param context - 装配上下文（`agent` 由 dsh-agent 注入到 AssembleContext）。
*/
function buildAssemblyPlan(deps, context) {
	const presetId = agentPresetId(deps.ctxForPreset, context?.agent);
	const workspace = agentWorkspace(context?.agent);
	const byServer = /* @__PURE__ */ new Map();
	const nameOnly = [];
	const hidden = [];
	for (const ref of deps.registry.snapshot().all.values()) {
		const effective = exposureForRef(deps, ref, presetId, workspace);
		byServer.set(ref.serverName, effective);
		if (effective === "name-only") nameOnly.push(ref.serverName);
		else if (effective === "hidden") hidden.push(ref.serverName);
	}
	const hiddenCount = countSearchableHidden(hidden, deps.hasTools);
	mergeRuntimeIntoPlan(byServer, nameOnly, deps.runtimeServers?.() ?? /* @__PURE__ */ new Map(), deps.isRuntimeReady, deps.runtimeExposureOf);
	nameOnly.sort((a, b) => a.localeCompare(b));
	return {
		presetId,
		workspace,
		byServer,
		nameOnly,
		hiddenCount
	};
}
/** 渲染 name-only 的服务器索引段（无内容时返回空串，不贡献 token）。 */
function renderServerIndex(deps, plan) {
	if (plan.nameOnly.length === 0 && plan.hiddenCount === 0) return "";
	const lines = [];
	if (plan.nameOnly.length > 0) {
		lines.push("## MCP 路由器");
		lines.push("");
		lines.push(" MCP 服务器已就绪但未把工具清单注入上下文，按需调用。用 `dsh_mcp_call`（`server` + `tool` + `arguments`）直接调用；不确定工具名时用 `dsh_mcp_search` 传 `server` 查看该服务器的工具清单。");
	}
	lines.push("");
	if (plan.hiddenCount > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(`另有 ${plan.hiddenCount} 个 MCP 服务器未在提示词中列出，可用 \`dsh_mcp_search\` 以关键词检索。`);
	}
	return lines.join("\n");
}
/**
* 安装装配层：一个 assemble 监听器 + 一个 name-only 索引段。
* 返回合并 disposer（插件卸载时全部归还）。
*/
function installAssembly(ctx, depsRaw) {
	const deps = {
		...depsRaw,
		ctxForPreset: ctx
	};
	const planFor = (context) => {
		const plan = buildAssemblyPlan(deps, context);
		try {
			deps.onPlan?.(plan);
		} catch {}
		return plan;
	};
	const disposers = [];
	disposers.push(ctx.effect(() => {
		return ctx.root.on("system-prompt/assemble", (assembly, context, next) => {
			if (!assembly || !Array.isArray(assembly.tools)) return next();
			const plan = planFor(context);
			if (plan.byServer.size === 0) return next();
			assembly.tools = assembly.tools.filter((tool) => {
				const name = String(tool?.name ?? "");
				if (!name.startsWith("mcp__")) return true;
				const server = serverOfMcp(name);
				if (server === null) return true;
				if (plan.byServer.get(server) === void 0) return true;
				return false;
			});
			return next();
		});
	}, "dsh-mcp-router: assembly filter"));
	disposers.push(ctx.effect(() => ctx.systemPrompt.section({
		name: SERVER_INDEX_SECTION,
		order: ctx.systemPrompt.getSectionOrder("TOOLS_SDK") + SERVER_INDEX_ORDER_OFFSET,
		text: (context) => renderServerIndex(deps, planFor(context))
	}), "dsh-mcp-router: server index section"));
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/index.ts
/**
* dsh-mcp-router — Host 半区入口（接线层）。
*
* 插件唯一职责：**决定每个 MCP 服务器对哪个会话以什么粒度可见，并在不可见时按需调用它**。
* 本文件只做组装与生命周期，各层职责见：
* - `domain/exposure.ts`  四档语义 + 预设关联隔离 + v1 迁移（纯逻辑）
* - `domain/policy.ts`    策略真源（意图/生效两份 + 持久化 + 启动迁移）
* - `domain/registry.ts`  MCP 行来源归一（loader / preset standing / 项目级）
* - `domain/assembly.ts`  唯一装配注入点（工具过滤 + 进程常驻索引段）
* - `mcpcall.ts`          中间层（dsh_mcp_search / dsh_mcp_call）+ 保活回收
* - `collect.ts`/`routes.ts` 面板数据与 HTTP 端点
*
* 两条历史铁律（实测事故得出，勿改）：
* 1. 运行期**禁止**写 agent preset 组合文件 —— dsh-agent-presets 用 {mtimeMs,size} stamp
*    检测文件变化并重挂 standing，旧实例不 dispose → serverName 全冲突、会话创建失败。
*    因此启停意图只写 state.json，由 `syncPresetFiles` 在启动早期（standing 未挂载）物化。
* 2. `tools.schemas(scope)` 必须传 scope 对象（`scopeOf(agent.ctx)` 或 agent 对象本身）；
*    传 agent 之外的键会落回全局视图，导致 mcp 工具「不存在」。
*/
const name = "dsh-mcp-router";
const inject = [
	"tools",
	"agents",
	"agentPresets",
	"loader",
	"systemPrompt",
	"timer"
];
const Config = Schema.object({
	keepAliveMs: Schema.number().min(1e3).description("MCP 保活空闲回收窗口（ms）").default(3e4),
	searchLimitDefault: Schema.number().min(1).description("dsh_mcp_search 缺省 top-K").default(5),
	searchLimitMax: Schema.number().min(1).description("dsh_mcp_search top-K 上限").default(10),
	serverSummary: Schema.dict(Schema.string()).description("MCP 能力摘要表（serverName → 一句话）"),
	defaultExposure: Schema.union([
		"name-only",
		"hidden",
		"off"
	]).description("未配置 MCP 的默认档位").default("name-only"),
	middleLayer: Schema.boolean().description("注册 dsh_mcp_search / dsh_mcp_call 中间层工具").default(true),
	adoptRuntimeServers: Schema.boolean().description("接管插件内嵌 MCP（采集后过滤工具、按需调用；关闭则保持旧行为）").default(true)
});
/** 私有 catalog / state 持久化目录。 */
const CATALOG_DIR = join(stateDir());
/** dsh_mcp_call 注册/调用的默认超时（读 entry config toolCallTimeoutMs，缺省回退）。 */
const DEFAULT_TOOL_TIMEOUT_MS = 6e4;
/** tools/change 后增量快照的去抖窗口。 */
const CATALOG_SNAPSHOT_DEBOUNCE_MS = 150;
/** catalog 持久化写盘防抖（P1-3）：tools/change 风暴期合并写盘。 */
const CATALOG_PERSIST_DEBOUNCE_MS = 300;
/** 从 loader entries 反查某 serverName 对应的 mcp 行（serverName 取自 config）。 */
function findMcpEntry(ctx, serverName) {
	for (const entry of ctx.loader.entries()) {
		if (!isMcpEntry(entry)) continue;
		if (serverNameOf(entry) === serverName) return entry;
	}
}
/** server 自己的注册/调用超时阈值。 */
function serverTimeoutMs(ctx, serverName) {
	const entry = findMcpEntry(ctx, serverName);
	if (!entry) return DEFAULT_TOOL_TIMEOUT_MS;
	const t = mcpEntryConfig(entry)?.toolCallTimeoutMs;
	return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : DEFAULT_TOOL_TIMEOUT_MS;
}
function sameToolList(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) if (a[i].name !== b[i].name || a[i].description !== b[i].description) return false;
	return true;
}
/** 原子写回 catalog.json；失败保留 dirty 标记以在下次重试。
* P1-3：写盘后 CATALOG_PERSIST_DEBOUNCE_MS 内的新变更延迟合并（ctx.timeout 绑 ctx，
* 卸载自动清理）；正在写盘时置 dirty 排队（finally 补一次）。 */
async function persistCatalog(next, runtime) {
	if (runtime.persisting) {
		runtime.dirty = true;
		return;
	}
	if (!runtime.dirty) return;
	const ctx = next();
	if (runtime.lastPersistAt !== null && Date.now() - runtime.lastPersistAt < CATALOG_PERSIST_DEBOUNCE_MS) {
		runtime.persistTimer?.();
		runtime.persistTimer = ctx.timeout(() => {
			runtime.persistTimer = void 0;
			persistCatalog(next, runtime);
		}, CATALOG_PERSIST_DEBOUNCE_MS);
		return;
	}
	runtime.persisting = true;
	try {
		await saveCatalog(CATALOG_DIR, runtime.catalog);
		runtime.dirty = false;
		runtime.lastPersistAt = Date.now();
	} catch (error) {
		ctx.logger.warn(`dsh-mcp-router: catalog persist failed: ${messageOf(error)}`);
	} finally {
		runtime.persisting = false;
		if (runtime.dirty) persistCatalog(next, runtime);
	}
}
/**
* 解析 scope 并取 schema 视图（preset 层共享，任一 standing 即可）。
*
* 关键坑（v0.4.1 + 2026-08-27）：HTTP/apply ctx 下 agents/standingKeyFor 视图
* 受限（roots/list 空或服务不可解析）。统一走 collect.resolveCollectScopeKey 的
* 进程级缓存：apply 早期预热一次，快照与面板路径共用同一 standing scope key。
*/
async function resolveScopeSchemas(ctx, caches) {
	const scopeKey = await resolveCollectScopeKey(ctx, void 0);
	if (scopeKey === void 0) return [];
	return getSchemasView(ctx, caches, scopeKey, 500);
}
/**
* 对所有当前 enabled 的 mcp server 重新快照（三来源统一：loader / preset / project）。
*
* 2026-09-23（移植上游 c0855f9）：采集与 prune 都必须以**注册表快照**为准。此前只看
* `ctx.loader.entries()`，而预设 standing 行不在 loader 里 —— 结果是预设行的工具目录
* 永远采不到，且 prune 的 alive 集合一旦只含 loader 行，就会把预设行已有的 last-good
* 快照一并删掉（本部署预设行是主力形态，影响面比上游更大）。
*/
async function snapshotEnabled(ctx, runtime, caches, registry) {
	runtime.diag.snapshots += 1;
	if (!runtime.loaded) {
		runtime.diag.lastAt = Date.now();
		runtime.diag.lastError = "skipped: catalog not loaded yet";
		return;
	}
	try {
		const next = { ...runtime.catalog };
		let changed = false;
		let rootsCount = 0;
		let listCount = 0;
		try {
			rootsCount = ctx.agents.roots().length;
			listCount = ctx.agents.list().length;
		} catch {
			rootsCount = -1;
			listCount = -1;
		}
		runtime.diag.lastAgentRoots = rootsCount;
		runtime.diag.lastAgentList = listCount;
		const schemas = await resolveScopeSchemas(ctx, caches);
		runtime.diag.lastSchemasTotal = schemas.length;
		let mcpTools = 0;
		for (const schema of schemas) if (String(schema.name ?? "").startsWith("mcp__")) mcpTools += 1;
		runtime.diag.lastMcpTools = mcpTools;
		runtime.diag.lastScope = mcpTools > 0;
		const refs = registry.snapshot().all;
		const runtimeDiscovery = discoverRuntimeServers(schemas, new Set(refs.keys()));
		runtime.diag.lastRuntimeServers = [...runtimeDiscovery.servers.keys()];
		for (const serverName of runtimeDiscovery.servers.keys()) {
			let tools;
			try {
				tools = snapshotFromSchemas(schemas, serverName);
			} catch {
				continue;
			}
			const prev = next[serverName];
			if (prev && prev.source === "live" && sameToolList(prev.tools, tools)) continue;
			if (tools.length === 0) continue;
			next[serverName] = {
				tools,
				fetchedAt: Date.now(),
				source: "live"
			};
			changed = true;
		}
		for (const ref of refs.values()) {
			if (ref.disabled) continue;
			const serverName = ref.serverName;
			let tools;
			try {
				tools = snapshotFromSchemas(schemas, serverName);
			} catch {
				continue;
			}
			const prev = next[serverName];
			if (prev && prev.source === "live" && sameToolList(prev.tools, tools)) continue;
			if (tools.length === 0) continue;
			next[serverName] = {
				tools,
				fetchedAt: Date.now(),
				source: "live"
			};
			changed = true;
		}
		const alive = new Set(refs.keys());
		for (const serverName of runtimeDiscovery.servers.keys()) alive.add(serverName);
		if (alive.size > 0) {
			for (const key of Object.keys(next)) if (!alive.has(key)) {
				delete next[key];
				changed = true;
			}
		}
		runtime.catalog = next;
		const nowAt = Date.now();
		runtime.runtimeServers = new Map([...runtimeDiscovery.servers.entries()].map(([serverName, tools]) => [serverName, {
			tools,
			at: nowAt
		}]));
		if (changed) {
			runtime.dirty = true;
			persistCatalog(() => ctx, runtime);
		}
		runtime.diag.lastAt = Date.now();
		runtime.diag.lastError = null;
	} catch (error) {
		runtime.diag.lastError = messageOf(error);
		runtime.diag.lastAt = Date.now();
	}
}
/** 空 catalog 运行时（启动早期）。 */
function createCatalogRuntime() {
	return {
		catalog: {},
		dirty: false,
		persisting: false,
		loaded: false,
		lastPersistAt: null,
		persistTimer: void 0,
		tokenCache: /* @__PURE__ */ new Map(),
		runtimeServers: /* @__PURE__ */ new Map(),
		diag: {
			toolsChangeEvents: 0,
			snapshots: 0,
			lastError: null,
			lastAt: null,
			lastMcpTools: null,
			lastSchemasTotal: null,
			lastScope: null,
			lastAgentRoots: null,
			lastAgentList: null,
			loadedAt: null,
			loadedServers: null,
			lastRuntimeServers: null,
			lastAssemblyNameOnly: null,
			lastAssemblyHidden: null
		}
	};
}
function apply(ctx, config = {}) {
	const caches = createDomainCaches();
	const catalogRuntime = createCatalogRuntime();
	const fallbackExposure = config.defaultExposure ?? "name-only";
	/** P2：接管插件内嵌 MCP（默认开）；关闭时装配层拿不到 runtime 表，行为回到旧版。 */
	const adoptRuntimeServers = config.adoptRuntimeServers !== false;
	const registry = createRegistry(ctx, () => caches.invalidateMcp());
	ctx.effect(() => registry.install(), "dsh-mcp-router: registry events");
	const policy = createPolicyStore({
		ctx,
		fallbackExposure,
		onEffectiveChanged: (changes) => applyProcessState(ctx, registry, changes, () => controllerRef)
	});
	let controllerRef;
	const control = buildMcpControl(ctx, catalogRuntime, config, caches, registry, policy, (serverName) => controllerRef?.isAiEnabled(serverName) ?? false);
	const controller = createMcpCallController(ctx, control);
	controllerRef = controller;
	rebuildOwnersFromState(ctx).catch((error) => {
		ctx.logger.warn(`dsh-mcp-router: 重建项目 MCP owner 映射失败: ${messageOf(error)}`);
	});
	loadCatalog(CATALOG_DIR).then((catalog) => {
		catalogRuntime.catalog = catalog;
		catalogRuntime.loaded = true;
		catalogRuntime.diag.loadedAt = Date.now();
		catalogRuntime.diag.loadedServers = Object.keys(catalog).length;
		snapshotEnabled(ctx, catalogRuntime, caches, registry);
	}, () => {
		catalogRuntime.catalog = {};
		catalogRuntime.loaded = true;
		catalogRuntime.diag.loadedAt = Date.now();
		catalogRuntime.diag.loadedServers = 0;
	});
	(async () => {
		await registry.refreshNow();
		await policy.load();
		try {
			const count = await syncPresetFiles({
				ctx,
				registry,
				policy
			});
			if (count > 0) ctx.logger.info(`dsh-mcp-router: materialized ${count} MCP row state(s) into preset composition`);
		} catch (error) {
			ctx.logger.warn(`dsh-mcp-router: preset sync skipped: ${messageOf(error)}`);
		}
		await registry.refreshNow();
	})().catch((error) => {
		ctx.logger.warn(`dsh-mcp-router: startup sequence failed: ${messageOf(error)}`);
	});
	const disposeAssembly = installAssembly(ctx, {
		registry,
		policy,
		isAiActive: (serverName) => controller.isAiEnabled(serverName),
		summaryOf: (serverName) => summaryOf(serverName, config, catalogRuntime),
		runtimeServers: () => adoptRuntimeServers ? catalogRuntime.runtimeServers : /* @__PURE__ */ new Map(),
		isRuntimeReady: (serverName) => (catalogRuntime.catalog[serverName]?.tools.length ?? 0) > 0,
		hasTools: (serverName) => (catalogRuntime.catalog[serverName]?.tools.length ?? 0) > 0,
		runtimeExposureOf: () => "name-only",
		onPlan: (plan) => {
			catalogRuntime.diag.lastAssemblyNameOnly = plan.nameOnly;
			catalogRuntime.diag.lastAssemblyHidden = plan.hiddenCount;
		}
	});
	ctx.effect(() => disposeAssembly, "dsh-mcp-router: assembly teardown");
	const disposeProjectMcp = installProjectMcp(ctx, policy);
	ctx.effect(() => disposeProjectMcp, "dsh-mcp-router: project mcp teardown");
	if (config.middleLayer !== false) {
		const disposeTools = installMcpControlTools(ctx, control, controller);
		const offReaper = controller.startIdleReaper();
		ctx.effect(() => () => {
			offReaper();
			disposeTools();
		}, "dsh-mcp-router: middle layer teardown");
	}
	ctx.effect(() => {
		let scheduled = false;
		const invalidate = () => caches.invalidateMcp();
		const offTools = ctx.root.on("tools/change", () => {
			catalogRuntime.diag.toolsChangeEvents += 1;
			invalidate();
			registry.refresh();
			if (scheduled) return;
			scheduled = true;
			ctx.timeout(() => {
				scheduled = false;
				snapshotEnabled(ctx, catalogRuntime, caches, registry);
			}, CATALOG_SNAPSHOT_DEBOUNCE_MS);
		});
		const offLoader = ctx.root.on("loader/partial-dispose", () => {
			invalidate();
			registry.refresh();
		});
		return () => {
			offTools();
			offLoader();
		};
	}, "dsh-mcp-router: catalog snapshot + registry refresh");
	snapshotEnabled(ctx, catalogRuntime, caches, registry).catch(() => {});
	ctx.effect(() => {
		let guard = false;
		return ctx.root.on("agent/created", (payload) => {
			rememberSessionScope(agentPresetId(ctx, payload?.agent), agentWorkspace(payload?.agent));
			if (guard) return void 0;
			guard = true;
			(async () => {
				const applied = await policy.commitPending();
				await registry.refreshNow();
				if (applied > 0) {
					caches.invalidateMcp();
					ctx.logger.info(`dsh-mcp-router: applied ${applied} pending MCP change(s) at session boundary`);
				}
			})().catch((error) => {
				ctx.logger.warn(`dsh-mcp-router: session-boundary apply failed: ${messageOf(error)}`);
			}).finally(() => {
				guard = false;
			});
		});
	}, "dsh-mcp-router: session-boundary apply");
	ctx.inject(["webServer"], (httpCtx) => {
		httpCtx.effect(() => {
			const disposers = makeRoutes({
				ctx: httpCtx,
				hostCtx: ctx,
				caches,
				catalogRuntime,
				config,
				controller,
				registry,
				policy,
				triggerSnapshot: () => snapshotEnabled(httpCtx, catalogRuntime, caches, registry)
			}).map((route) => httpCtx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-mcp-router: routes");
	});
}
/** 控制层依赖（McpControlCtx）：封闭 catalog/loader/state/registry/policy 的 IO。 */
function buildMcpControl(ctx, runtime, config, caches, registry, policy, isAiActive) {
	const presetTimeoutCache = /* @__PURE__ */ new Map();
	const assemblyDeps = {
		ctxForPreset: ctx,
		registry,
		policy,
		isAiActive,
		summaryOf: () => void 0
	};
	const accessFor = (serverName, presetId, workspace) => {
		const ref = registry.refFor(serverName, presetId);
		const effectivePolicy = policy.effective(serverName, ref?.workspace);
		if (!ref) {
			if (runtime.runtimeServers.has(serverName)) return {
				effective: "name-only",
				policy: effectivePolicy,
				presetId,
				blockedBy: "none"
			};
			return {
				effective: "off",
				policy: effectivePolicy,
				presetId,
				blockedBy: "unknown"
			};
		}
		const effective = exposureForRef(assemblyDeps, ref, presetId, workspace);
		const workspaceMismatch = ref.workspace !== void 0 && !sameWorkspace(ref.workspace, workspace);
		return {
			effective,
			policy: effectivePolicy,
			ref,
			presetId,
			blockedBy: effective === "off" ? offReason(effectivePolicy, presetId, workspaceMismatch) : "none"
		};
	};
	const accessOf = (serverName, agent) => accessFor(serverName, agentPresetId(ctx, agent), agentWorkspace(agent));
	return {
		keepAliveMs: config.keepAliveMs ?? 3e4,
		searchLimitDefault: config.searchLimitDefault ?? 5,
		searchLimitMax: config.searchLimitMax ?? 10,
		serverSummary: config.serverSummary ?? {},
		getCatalog: () => runtime.catalog,
		setCatalog: (catalog) => {
			runtime.catalog = catalog;
		},
		persistCatalog: () => persistCatalog(() => ctx, runtime),
		resolveEntry: (serverName) => findMcpEntry(ctx, serverName),
		accessOf,
		accessFor,
		presetIdOf: (agent) => agentPresetId(ctx, agent),
		serverTimeoutMs: (serverName) => serverTimeoutMs(ctx, serverName),
		presetTimeoutMs: async (serverName) => {
			try {
				const ref = registry.refFor(serverName, void 0);
				if (ref?.toolCallTimeoutMs !== void 0) return ref.toolCallTimeoutMs;
				const agent = ctx.agents.roots()[0] ?? ctx.agents.list()[0];
				const presetId = agent ? ctx.agentPresets.composedPreset(agent.ctx) ?? null : null;
				if (!presetId) return void 0;
				const key = `${presetId}\0${serverName}`;
				const hit = presetTimeoutCache.get(key);
				if (hit && Date.now() - hit.at < 6e4) return hit.timeout;
				const { listPresetMcpRows } = await Promise.resolve().then(() => preset_mcp_exports);
				const { rows } = await listPresetMcpRows(ctx, presetId);
				const timeout = rows.find((r) => r.serverName === serverName)?.toolCallTimeoutMs;
				presetTimeoutCache.set(key, {
					at: Date.now(),
					timeout
				});
				return timeout;
			} catch {
				return;
			}
		},
		setAiOwner: (entryId, at) => setStateAiOwner(entryId, at),
		clearAiOwner: (entryId) => clearStateAiOwner(entryId),
		snapshotEnabled: () => snapshotEnabled(ctx, runtime, caches, registry)
	};
}
/** 该 server 的一句话摘要（config 覆盖 > catalog 首条描述）。 */
function summaryOf(serverName, config, runtime) {
	const configured = config.serverSummary?.[serverName];
	if (typeof configured === "string" && configured.length > 0) return configured;
	const first = runtime.catalog[serverName]?.tools?.[0];
	const raw = first ? String(first.description ?? "") : "";
	return raw.length > 0 ? raw : void 0;
}
/**
* 生效策略变化 → 调整 loader 进程状态（`desiredRunning`）。
*
* 只对 loader 行即时生效（entry.update）。预设组合行不在 loader 中，其进程状态由
* 启动早期 `syncPresetFiles` 物化到组合文件后随重启生效 —— 运行期改文件会触发
* dsh-agent-presets 的 standing 重挂事故（见文件头铁律 1）。运行期对预设行的
* 「不可见/不可调用」由装配层与中间层即时保证，与进程状态无关。
*/
async function applyProcessState(ctx, registry, changes, controller) {
	for (const change of changes) {
		const want = desiredRunning(change.policy.exposure);
		if (want) controller()?.markUserEnabled(change.serverName);
		const ref = registry.refFor(change.serverName, void 0);
		if (!ref) continue;
		const wantDisabled = !want;
		try {
			const entry = ctx.loader.resolve(ref.entryId);
			if (!entry || !isMcpEntry(entry)) continue;
			if (Boolean(entry.disabled) === wantDisabled) continue;
			await entry.update({ disabled: wantDisabled });
			ctx.logger.info?.(`dsh-mcp-router: ${change.serverName} → ${want ? "enabled" : "disabled"} (exposure=${change.policy.exposure})`);
		} catch (error) {
			ctx.logger.debug?.(`dsh-mcp-router: process state for "${change.serverName}" not applied (${messageOf(error)})`);
		}
	}
}
//#endregion
export { CONTROL_TOOL_NAMES, Config, MASKED_VALUE, MCP_CALL_TOOL, MCP_SEARCH_TOOL, apply, buildServerListingResult, computeRowDisplay, computeStatus, createPolicyStore, decideExposure, describeServer, desiredRunning, discoverRuntimeServers, findProjectMcpFile, firstMatchServerName, inject, installProjectMcp, isExposure, maskConfigSecrets, materializeTargetOf, mergeSchemas, msgOf, name, normalizeArguments, normalizeToolName, parsePresetMcpText, presetAllows, projectServerName, projectServerOwner, readBody, readState, remountWorkspace, removeRow, removeServer, resolveWritableTarget, rowDisabledState, scanWorkspaceMcp, setRowFlag, syncPresetFiles, unmaskEcho, updateServer, writeState };
