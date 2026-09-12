/**
 * 客户端 HTTP 工具：统一读 JSON 与错误描述。
 *
 * 为什么需要它：`res.json()` 在服务端返回非 JSON（HTML、纯文本、空体）时会抛出
 * 浏览器原生的 `JSON.parse: unexpected keyword at line 1 column 1` —— 用户完全看不出
 * 发生了什么。最常见的成因是**插件刚更新但 dsh web 没重启**：client 产物是按请求
 * 从磁盘读的（所以界面是新的），host 侧代码却是启动时加载的（所以新端点不存在，
 * 请求落到未注册路径上被回以 401 纯文本）。这里把它翻译成可操作的提示。
 */
import type { Translate } from './types';
/** 带 HTTP 状态码的接口错误。 */
export declare class ApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
/** 读取 JSON 响应；非 JSON 时抛 {@link ApiError}（带状态码）。 */
export declare function readJson<T>(res: Response): Promise<T>;
/** 把任意异常转成给用户看的一句话（含「重启 dsh web」的引导）。 */
export declare function describeError(error: unknown, t: Translate): string;
