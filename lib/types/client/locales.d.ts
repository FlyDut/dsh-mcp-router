/**
 * 双语字典：zh/en 真双语（不互为别名），语言跟随 DSH 界面设置。
 *
 * 术语约定（三档，均不注入工具 schema）：
 * - name-only  进程常驻：只暴露服务器名，工具经 dsh_mcp_call 按需调用
 * - hidden     隐藏：完全不进上下文，可 dsh_mcp_search 检索、dsh_mcp_call 按需调用
 * - off        关闭：不可见、不可搜索、不可调用
 */
export declare const NS = "dsh-mcp-router";
export declare const en: Record<string, string>;
export declare const zh: Record<string, string>;
