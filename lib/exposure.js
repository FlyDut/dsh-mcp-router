//#region src/domain/exposure.ts
/** 全部档位（面板渲染顺序：从最曝光到最封闭）。 */
const EXPOSURE_VALUES = [
	"native",
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
/** 构造默认策略（未配置过的 server 默认原生注入 = DSH 原本行为）。 */
function defaultPolicy(exposure = "native") {
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
function normalizePolicy(raw, fallbackExposure = "native") {
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
	return exposure === "native" || exposure === "name-only";
}
/**
* 有效曝光判定 —— 装配层、`mcp_search`、`mcp_call`、面板徽标共用这一个函数。
*
* 判定顺序（先隔离、再档位、最后运行态降级）：
* 1. 预设不允许 → `off`（运行时隔离，物理状态不变）；
* 2. `off` / `hidden` 档 → 原样返回；
* 3. `native` / `name-only` 档：进程在跑且非 AI 保活窗口 → 原档；否则降级为
*    `hidden`（进程未跑或正被中间层托管：工具不注入，但仍可经 mcp_call 调用，
*    不静默丢失能力）。
*/
function decideExposure(input) {
	const { policy, running, aiActive, presetId } = input;
	if (!presetAllows(policy.presets, presetId)) return "off";
	switch (policy.exposure) {
		case "off": return "off";
		case "hidden": return "hidden";
		case "native":
		case "name-only": return running && !aiActive ? policy.exposure : "hidden";
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
/** 由有效曝光映射到注入形态。 */
function injectionOf(effective) {
	switch (effective) {
		case "native": return "tools";
		case "name-only": return "name";
		default: return "none";
	}
}
/** 该有效曝光下该 server 的工具是否进入模型目录。 */
function injectsTools(effective) {
	return injectionOf(effective) === "tools";
}
/** 该有效曝光下模型是否可经 mcp_call 调用该 server（`off` 拒绝）。 */
function callableUnder(effective) {
	return effective !== "off";
}
/** 该有效曝光下该 server 是否出现在 mcp_search 的无参摘要表。 */
function listedInSummary(effective) {
	return effective === "native" || effective === "name-only";
}
/** 工具注册全名是否被策略禁用（工具级禁用，native 档下同样生效）。 */
function policyDisablesTool(policy, fullName) {
	if (!policy || policy.disabledTools.length === 0) return false;
	return policy.disabledTools.includes(fullName);
}
/** 取/建可变策略槽（迁移内部用）。 */
function slot(table, key) {
	const hit = table[key];
	if (hit) return hit;
	const created = defaultPolicy("native");
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
*   `desired === false`（用户启用）→ `native`。
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
			slot(servers, serverName).exposure = desired ? stoppedExposure : "native";
			migrated += 1;
		}
	}
	for (const [workspace, perServer] of Object.entries(source.projectMcp ?? {})) {
		if (!perServer || typeof perServer !== "object") continue;
		const table = projects[workspace] ??= {};
		for (const [serverName, desired] of Object.entries(perServer)) {
			if (typeof desired !== "boolean") continue;
			slot(table, serverName).exposure = desired ? stoppedExposure : "native";
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
export { EXPOSURE_VALUES, PRESET_MODES, callableUnder, decideExposure, decideSyncAction, defaultPolicy, desiredRunning, hasV1PolicyData, injectionOf, injectsTools, isExposure, isPresetMode, listedInSummary, migrateV1Policies, normalizePolicy, normalizePresetScope, offReason, policyDisablesTool, presetAllows };
