/**
 * 共享内联样式（面板 + 三个弹窗复用）。
 *
 * 为什么内联而不是 class：宿主全局 CSS 可能覆盖注入的 class，内联 style 是
 * 唯一稳定的隔离方式；颜色一律走 --dsw-alias-* 主题变量以跟随宿主主题。
 *
 * 原先四个文件各自维护一份逐字重复的 C 对象（overlay/modal/title/tab/…），
 * 微调要改四处且极易漂移；此处收敛为唯一事实来源，弹窗内保留薄别名层 C 以
 * 免大范围触碰 JSX 引用点。
 */
import type { CSSProperties } from 'react';
/** 弹窗遮罩（全屏半透明黑 + 居中）。 */
export declare const overlay: CSSProperties;
/** 弹窗主体：宽度自适应（小屏留 24px 边距）、超高滚动、随主题卡片样式。 */
export declare function modal(widthPx: number, gap?: number): CSSProperties;
/** 弹窗标题（16px/600）。 */
export declare const title: CSSProperties;
/** 块状提示（可换行，行高 16px）。 */
export declare const hintBlock: CSSProperties;
/** 表单字段标签。 */
export declare const label: CSSProperties;
/** 单行排布（可叠加额外属性，如 flexWrap）。 */
export declare function row(extra?: CSSProperties): CSSProperties;
/** 分段切换按钮（active 高亮信息色；padPx 微调左右内边距）。 */
export declare function tab(active: boolean, padPx?: number): CSSProperties;
/** 次要按钮（描边）。 */
export declare const action: CSSProperties;
/** 主按钮（实心成功色）。 */
export declare const primary: CSSProperties;
/** 请求进行中（半透明 + 进度光标）。 */
export declare const disabled: CSSProperties;
/** 错误提示条（左缘红条）。 */
export declare const error: CSSProperties;
/** 成功提示条（左缘绿条）。 */
export declare const success: CSSProperties;
/** 等宽只读代码块（YAML 预览等）。 */
export declare const pre: CSSProperties;
/** 等宽单行输入框（可叠加额外属性，如 flex: 1）。 */
export declare function monoInput(extra?: CSSProperties): CSSProperties;
/** 等宽多行文本域（粘贴 JSON 用，可纵向拖高）。 */
export declare const monoArea: CSSProperties;
/** 底部按钮排（可叠加额外属性，如 marginTop）。 */
export declare function footer(extra?: CSSProperties): CSSProperties;
