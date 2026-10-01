/**
 * 添加 MCP 弹窗（表单式）—— 替代早期的「粘贴 mcpServers JSON」输入框。
 *
 * 交互（对齐设计稿 1/2）：类型（stdio / streamable-http）→ 唯一标题 → 随类型切换的
 * 连接字段 →「配置预览」实时显示将写入的 JSON。确认后走既有 `/mcp/add`：
 * 全局写 <profile>/cordis.patch.yml 并立即挂载，项目写
 * <workspace>/.dsh/mcps/mcp.json 并重扫挂载。
 *
 * 表单形状与 `mcp-convert.ts` 的解析口径一致（`type`/`command`/`args`/`env` 或
 * `type`/`url`/`headers`），因此宿主侧无需新增端点；类型直接使用 dsh-mcp-client 的
 * 传输名（`stdio` / `streamable-http`），不暴露 http / sse 等下游别名。
 * `${VAR}` 占位在全局 patch 里转成 `!!js`、项目挂载时解析 process.env。
 */
import React from 'react';
interface Props {
    /** locale 翻译函数（由父级传入，保持与宿主 locale 插槽一致）。 */
    t: (key: string, params?: Record<string, string | number>) => string;
    /** 当前会话工作空间（cwd）；null = 无会话上下文，此时禁止「项目」目标。 */
    workspace: string | null;
    /** 关闭弹窗。 */
    onClose: () => void;
    /** 添加成功（含部分成功）后回调：父级负责刷新 MCP 列表。 */
    onAdded: () => void;
}
export declare function AddMcpModal(props: Props): React.ReactElement;
export {};
