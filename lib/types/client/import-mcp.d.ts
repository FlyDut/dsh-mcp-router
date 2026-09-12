/**
 * 从其它 Agent 导入 MCP 弹窗。
 *
 * 流程：自动扫描本机已知来源（opencode / zcode / Claude Code / Cursor / Gemini CLI / 项目级
 * .mcp.json 等，可追加自定义路径）→ 勾选要导入的服务器 → 选目标（全局 / 项目）与导入后的
 * 档位 → 复用现有 `/mcp/add` 落盘并由后端挂载 → 再对新导入项批量 `/policy` 设档位。
 *
 * 扫描是**只读**的：面板不会修改任何源文件，也不会同步源文件后续变化（一次性快照）。
 */
import React from 'react';
interface Props {
    t: (key: string, params?: Record<string, string | number>) => string;
    workspace: string | null;
    defaultExposure: string;
    onClose: () => void;
    onImported: () => void;
}
export declare function ImportMcpModal(props: Props): React.ReactElement;
export {};
