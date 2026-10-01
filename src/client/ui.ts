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
import type { CSSProperties } from 'react'

/** 弹窗遮罩（全屏半透明黑 + 居中）。 */
export const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

/** 弹窗主体：宽度自适应（小屏留 24px 边距）、超高滚动、随主题卡片样式。 */
export function modal(widthPx: number, gap = 12): CSSProperties {
  return {
    width: `min(${widthPx}px, calc(100vw - 48px))`,
    maxHeight: 'calc(100vh - 80px)',
    overflowY: 'auto',
    background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap,
    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
  }
}

/** 弹窗标题（16px/600）。 */
export const title: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }

/** 单行提示（超长截断省略）。 */
export const hintNowrap: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 块状提示（可换行，行高 16px）。 */
export const hintBlock: CSSProperties = { margin: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' }

/** 表单字段标签。 */
export const label: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }

/** 单行排布（可叠加额外属性，如 flexWrap）。 */
export function row(extra?: CSSProperties): CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 8, ...extra }
}

/** 分段切换按钮（active 高亮信息色；padPx 微调左右内边距）。 */
export function tab(active: boolean, padPx = 14): CSSProperties {
  return {
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid',
    borderRadius: 6,
    padding: `4px ${padPx}px`,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
    background: active ? 'color-mix(in srgb, var(--dsw-alias-state-info-primary, #4a90d9) 16%, transparent)' : 'transparent',
    borderColor: active ? 'var(--dsw-alias-state-info-primary, #4a90d9)' : 'var(--dsw-alias-border-l2)',
  }
}

/** 次要按钮（描边）。 */
export const action: CSSProperties = {
  font: 'inherit',
  cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-secondary)',
  borderRadius: 6,
  padding: '5px 14px',
  fontSize: 12,
}

/** 主按钮（实心成功色）。 */
export const primary: CSSProperties = {
  font: 'inherit',
  cursor: 'pointer',
  border: 0,
  borderRadius: 6,
  padding: '5px 16px',
  fontSize: 12,
  color: 'var(--dsw-alias-label-inverse, #fff)',
  background: 'var(--dsw-alias-state-success-primary)',
}

/** 请求进行中（半透明 + 进度光标）。 */
export const disabled: CSSProperties = { opacity: 0.55, cursor: 'progress' }

/** 错误提示条（左缘红条）。 */
export const error: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-primary)',
  background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)',
  borderLeft: '3px solid var(--dsw-alias-state-error-primary)',
  borderRadius: 6,
  padding: '8px 10px',
}

/** 成功提示条（左缘绿条）。 */
export const success: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-primary)',
  background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)',
  borderLeft: '3px solid var(--dsw-alias-state-success-primary)',
  borderRadius: 6,
  padding: '8px 10px',
}

/** 等宽只读代码块（YAML 预览等）。 */
export const pre: CSSProperties = {
  margin: 0,
  maxHeight: 220,
  overflow: 'auto',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  padding: '8px 10px',
  whiteSpace: 'pre-wrap',
}

/** 等宽单行输入框（可叠加额外属性，如 flex: 1）。 */
export function monoInput(extra?: CSSProperties): CSSProperties {
  return {
    font: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 12,
    lineHeight: '18px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 6,
    padding: '6px 8px',
    ...extra,
  }
}

/** 等宽多行文本域（粘贴 JSON 用，可纵向拖高）。 */
export const monoArea: CSSProperties = {
  ...monoInput(),
  padding: '8px 10px',
  resize: 'vertical',
  minHeight: 120,
}

/** 底部按钮排（可叠加额外属性，如 marginTop）。 */
export function footer(extra?: CSSProperties): CSSProperties {
  return { display: 'flex', justifyContent: 'flex-end', gap: 8, ...extra }
}
