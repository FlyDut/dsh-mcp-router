/**
 * MCP 管理面板：统计头 + 中间层说明 + 生效时机 + 服务器卡片列表 + 添加 MCP 弹窗。
 *
 * 数据流：`GET /state`（注册表行 × 策略 × 预设隔离后的生效档位）与 `GET /presets`
 * 并行拉取；写操作统一走 `submit()`（携带进程级 x-panel-token）。
 * 样式全部 JS 内联（宿主全局 CSS 可能覆盖注入的 class），颜色走 --dsw-alias-* 主题变量。
 */
import React from 'react';
interface Props {
    /** 由 locale 插槽注入：NS 字典的翻译函数 */
    t: (key: string, params?: Record<string, string | number>) => string;
    close?: () => void;
}
export declare function McpPanelSection(props: Props): React.ReactElement;
export {};
