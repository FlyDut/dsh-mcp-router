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
export { catalogFileFor, listServer, loadCatalog, saveCatalog, searchCatalog, serverOfMcp, snapshotFromSchemas };
