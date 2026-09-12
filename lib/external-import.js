//#region src/mcp-convert.ts
/** dsh-mcp-client 的 serverName 约束（存活实例全局唯一 + 命名长度）。 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
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
	if (!SERVER_NAME_PATTERN.test(name)) return { error: `server "${name}": serverName 需匹配 [A-Za-z0-9_-]{1,32}` };
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
export { describeImportedServer, knownMcpSources, parseExternalMcpConfig };
