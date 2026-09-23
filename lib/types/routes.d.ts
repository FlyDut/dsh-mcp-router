import type { Context } from '@deepseek-ai/cordis';
import { type DomainCaches } from './collect';
import type { McpCallController } from './mcpcall';
import type { Config } from './index';
import type { CatalogRuntime } from './runtime-types';
import type { PolicyStore } from './domain/policy';
import type { Registry } from './domain/registry';
type Req = import('node:http').IncomingMessage;
type Res = import('node:http').ServerResponse;
export type Route = {
    kind: 'exact';
    path: string;
    handler: (req: Req, res: Res) => void;
};
export interface RoutesDeps {
    /** HTTP 请求 ctx（路由注册在它上面）。 */
    ctx: Context;
    /** 插件 apply ctx（服务视图更完整，如 agentPresets）。 */
    hostCtx: Context;
    caches: DomainCaches;
    catalogRuntime: CatalogRuntime;
    config: Config;
    controller: McpCallController;
    registry: Registry;
    policy: PolicyStore;
    /** 手动触发一次 catalog 采集（调试端点用）。 */
    triggerSnapshot: () => Promise<void>;
}
export declare function readBody(req: Req): Promise<string>;
export declare function makeRoutes(deps: RoutesDeps): Route[];
export {};
