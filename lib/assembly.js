//#region src/domain/exposure.ts
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
/** Windows 下路径比较忽略大小写（c:\ 与 C:\ 视为同一工作区）。 */
function sameWorkspace(a, b) {
	if (a === void 0 || b === void 0) return false;
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
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
* @param nameOnly - 提示词注入索引段的 server 列表（原地追加）。
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
export { SERVER_INDEX_SECTION, buildAssemblyPlan, countSearchableHidden, exposureForRef, installAssembly, mergeRuntimeIntoPlan, renderServerIndex };
