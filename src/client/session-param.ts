/**
 * 会话透传：把「当前会话 id」拼进面板请求。
 *
 * 为什么需要（移植上游 74ed18e）：面板此前所有请求都不带 session，host 只能按
 * roots[0] 解析会话 —— 多会话并存时，卡片展示的是**启动期**那个会话的数据，
 * 而不是用户正在用的那个。host 侧早已支持 `?session=`（GET /state、GET /presets），
 * 这里只补前端透传，无新端点、无 host 语义改动。
 *
 * 本模块零依赖（不 import React），因此可以单独构建成 lib/session-param.js 供
 * selftest 直接断言（与 domain/exposure 同一模式）。
 *
 * 硬契约：拿不到会话时返回的 URL 与旧版**逐字节相同**（可独立回退）。
 */

/** 只有在传了非空 session 时才追加 `session=` 查询参数，否则原样返回。 */
export function withSessionParam(path: string, session: string | undefined | null): string {
  if (typeof session !== 'string' || session.length === 0) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}session=${encodeURIComponent(session)}`
}

/** 宿主 `settings.section` 槽位可能注入的会话钩子（selector 形态，防御式声明）。 */
export interface SessionHookProps {
  useSessions?: (select: (state: { current?: unknown } | undefined) => unknown) => unknown
}

/**
 * 从宿主注入的 props 里防御式取当前会话 id。
 *
 * `useSessions` 是宿主提供的 React hook：宿主没注入（旧版宿主 / 非会话页面）时降级为
 * undefined，调用方随之退回**不带 session 的旧请求形态**，因此该接线可独立 revert。
 *
 * 注意：这里按 props 是否带 hook 决定是否调用（hook 的有无在一次挂载内是稳定的，
 * 不会出现两次渲染间 hook 数量变化）。
 */
export function readCurrentSession(props: SessionHookProps): string | undefined {
  const hook = props.useSessions
  if (typeof hook !== 'function') return undefined
  try {
    const value = hook((state) => state?.current)
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}
