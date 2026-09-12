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
/** 原文件的换行风格（默认 LF）。 */
export declare function lineEndingOf(text: string): string;
/** `- id: <rowId>` 所在块的位置信息。 */
export interface RowBlock {
    /** `- id: <rowId>` 行的下标（0-based）。 */
    idLine: number;
    /** 该行的缩进宽度。 */
    indent: number;
    /** 该行所属块的最后一行的下标（含；不含尾部空行）。 */
    endLine: number;
    /** 所属父列表项（通常是 `- insert:`）的行下标；`-1` 表示该行自身是顶层列表项。 */
    blockHead: number;
    /** 父列表项的缩进宽度（`blockHead < 0` 时为 -1）。 */
    blockIndent: number;
    /** 父列表项内是否还有其它 `- id:` 兄弟项（决定删除时能否连父块一起删）。 */
    sibling: boolean;
}
/** 定位一行所在的块；找不到返回 undefined。 */
export declare function findRowBlock(text: string, rowId: string): RowBlock | undefined;
/**
 * 删除一行（含其父 `- insert:` 块，若父块里只有这一行）。
 *
 * 同时删除紧邻其上的、**指向该行**的注释（形如 `# <source>:server:<name>` 或含 rowId）——
 * 这是其它工具写入的归属标记，留下会变成孤儿注释；不匹配的注释（分区标题等）保留。
 *
 * @returns `removed = false` 表示文件里没有该行（调用方应报错而不是假装成功）。
 */
export declare function removeRowBlock(text: string, rowId: string): {
    text: string;
    removed: boolean;
};
/** config 下的一个顶层键（原文片段 + 是否含 `!!js` 动态表达式）。 */
export interface ConfigKey {
    name: string;
    /** 该键的原文行（不含 config 缩进前缀之外的处理；原样来自文件）。 */
    lines: string[];
    /** 该键的值含 `!!js` 表达式（编辑时只读、写回保留原文）。 */
    dynamic: boolean;
    /** 顶层键自身的缩进宽度。 */
    indent: number;
}
/** config 块的定位结果。 */
export interface ConfigBlock {
    /** `config:` 行下标。 */
    line: number;
    /** config 子键的缩进宽度。 */
    indent: number;
    /** 子键区间的结束行（含）。 */
    endLine: number;
    keys: ConfigKey[];
}
/** 定位某行的 `config:` 块并解析其顶层键（文本级，不解析值语义）。 */
export declare function readConfigBlock(text: string, rowId: string): ConfigBlock | undefined;
/** 写回用的一个顶层键：`body` 是**相对 config 子键缩进**的行（自己负责内部缩进）。 */
export interface ConfigKeyInput {
    name: string;
    body: string[];
}
/**
 * 用新的 config 顶层键替换原文（整体替换子键区间，`config:` 行本身保留）。
 *
 * 调用方对 `dynamic` 键传入其原文 body（由 {@link readConfigBlock} 得到的 lines，
 * 去掉公共缩进），即可做到「动态表达式原样保留」。
 *
 * @returns `changed = false` 表示文件里没有该行或没有 config 块（调用方应报错）。
 */
export declare function replaceRowConfig(text: string, rowId: string, keys: ConfigKeyInput[]): {
    text: string;
    changed: boolean;
};
/** 去掉一组行的公共缩进（供 dynamic 键原样回写）。 */
export declare function dedentLines(lines: string[]): string[];
/**
 * 在（任意缩进的）`- id: <rowId>` 行块内写入/移除 `key: value` 标志。
 *
 * 与 `preset.ts` 的 `setRowFlag` 行为一致，但支持缩进行（profile patch 的
 * `    - id: mcp-x`）——现有实现只匹配行首 `- id:`，对 patch 文件无效。
 *
 * 语义：`value=true` 保证标记存在且为 true（已有 `false` 时反转）；`value=false` 移除标记。
 */
export declare function setRowFlagAt(text: string, rowId: string, key: string, value: boolean): string;
/** 读取（任意缩进的）行块内 `key: true/false` 标志；行或键不存在返回 null。 */
export declare function rowFlagAt(text: string, rowId: string, key: string): boolean | null;
/** 该行块的文本是否包含 `!!js` 动态表达式。 */
export declare function rowHasDynamic(text: string, rowId: string): boolean;
