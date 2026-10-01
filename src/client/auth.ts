/**
 * 客户端认证 POST：面板与三个弹窗共用的 token 获取 + 认证请求封装。
 *
 * token 是服务端启动时生成的进程级随机令牌（`GET /token` 下发），用于阻断
 * 其它页面/扩展对写接口的跨源盲写；令牌在进程存活期内不变，模块级缓存
 * Promise 即可（多处并发写只发一次 token 请求，失败按「无令牌」降级 →
 * 服务端拒绝写，由调用方展示错误）。
 */
import { readJson } from './http'

/** 进程级 token 缓存（Promise 缓存：并发调用共享同一次请求）。 */
let tokenPromise: Promise<string | null> | null = null

/** 取面板写接口令牌（失败返回 null，调用方按未授权处理）。 */
export function ensureToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/dsh-mcp-router/token')
      .then((r) => r.json() as Promise<{ token?: string }>)
      .then((b) => b?.token ?? null)
      .catch(() => null)
  }
  return tokenPromise
}

/** 组装认证请求头（JSON + 令牌）。 */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await ensureToken()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-panel-token'] = token
  return headers
}

/** 认证 POST：自动带 token，响应统一走 readJson（非 JSON 时抛 ApiError）。 */
export async function post<T extends { ok: boolean; [key: string]: unknown }>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) })
  return await readJson<T>(res)
}
