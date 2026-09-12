/**
 * MCP 服务器卡片：档位选择器（四档）+ 预设关联 + 工具级禁用。
 *
 * 交互契约：
 * - 档位是**唯一**的服务器状态控件（同时决定进程期望状态与上下文注入量）；
 * - 预设关联是纯运行时隔离（不改变物理运行状态），三模式 + 预设复选列表；
 * - 工具级禁用在 server 级档位之上按工具精确控制。
 * 所有写操作经父级传入的 `submit`（统一携带 x-panel-token 并处理错误）。
 */
import React from 'react';
import type { McpRow, McpToolInfo, PresetOption } from '../shared-types';
export interface ServerCardProps {
    row: McpRow;
    t: (key: string, params?: Record<string, string | number>) => string;
    /** 可关联的预设列表（不可得时为空数组 + presetsError）。 */
    presets: PresetOption[];
    presetsError?: string;
    busy: boolean;
    toolBusy: Record<string, boolean>;
    /** 提交一次策略更新（父级负责鉴权头、错误提示与刷新）。 */
    submit: (updates: Array<Record<string, unknown>>, key: string) => void;
    /** 工具级禁用开关（走 /mcp/toolToggle）。 */
    toggleTool: (row: McpRow, tool: McpToolInfo) => void;
}
export declare function ServerCard(props: ServerCardProps): React.ReactElement;
