/**
 * 编辑 MCP 弹窗：读取该行的可写目标与当前配置，改完写回源文件并同步运行时。
 *
 * - 可写行：全局行（profile patch）/ 项目行（`.dsh/mcps/mcp.json`）
 * - 只读行：预设组合行（`agent.cordis.yml`）——本组件不会打开（卡片按钮已禁用）
 * - 含 `!!js` 动态表达式的字段：以只读形式列出，保存时原样保留、绝不固化成明文
 */
import React from 'react';
import type { McpRow } from '../shared-types';
interface Props {
    t: (key: string, params?: Record<string, string | number>) => string;
    row: McpRow;
    onClose: () => void;
    onSaved: () => void;
}
export declare function EditMcpModal(props: Props): React.ReactElement;
export {};
