/** 取面板写接口令牌（失败返回 null，调用方按未授权处理）。 */
export declare function ensureToken(): Promise<string | null>;
/** 组装认证请求头（JSON + 令牌）。 */
export declare function authHeaders(): Promise<Record<string, string>>;
/** 认证 POST：自动带 token，响应统一走 readJson（非 JSON 时抛 ApiError）。 */
export declare function post<T extends {
    ok: boolean;
    [key: string]: unknown;
}>(path: string, payload: Record<string, unknown>): Promise<T>;
