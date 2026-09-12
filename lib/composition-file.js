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
/** 该行块的文本是否包含 `!!js` 动态表达式。 */
function rowHasDynamic(text, rowId) {
	const block = findRowBlock(text, rowId);
	if (!block) return false;
	const lines = text.split(/\r?\n/);
	for (let i = block.idLine; i <= block.endLine; i += 1) if (lines[i].includes("!!js")) return true;
	return false;
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//#endregion
export { dedentLines, findRowBlock, lineEndingOf, readConfigBlock, removeRowBlock, replaceRowConfig, rowFlagAt, rowHasDynamic, setRowFlagAt };
