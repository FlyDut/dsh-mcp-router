/**
 * 双语字典：zh/en 真双语（不互为别名），语言跟随 DSH 界面设置。
 *
 * 术语约定（四档）：
 * - native     原生注入：工具清单直接进上下文（DSH 原生方式）
 * - name-only  仅名称：只暴露服务器名，工具经 mcp_call 按需调用
 * - hidden     隐藏：完全不进上下文，可 mcp_search 检索、mcp_call 按需调用
 * - off        关闭：不可见、不可搜索、不可调用
 */
export declare const NS = "mcp-panel";
export declare const en: Record<string, string>;
export declare const zh: Record<string, string>;
