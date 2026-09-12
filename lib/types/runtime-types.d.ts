/**
 * 运行时共享类型 —— 从 index.ts 抽出，避免 `collect.ts ↔ index.ts` 的循环依赖
 * （collect 需要 CatalogRuntime 的形状，index 需要 collect 的缓存工厂）。
 */
import type { Catalog } from './catalog';
/** 私有 catalog 内存态 + 持久化 + 采集诊断。 */
export interface CatalogRuntime {
    catalog: Catalog;
    dirty: boolean;
    persisting: boolean;
    /** 磁盘加载是否已完成（完成前跳过采集，防止空快照覆盖磁盘 last-good）。 */
    loaded: boolean;
    /** 最近一次成功写盘时间（防抖合并用）。 */
    lastPersistAt: number | null;
    /** 防抖挂起的写盘 timer（ctx.timeout 创建，ctx 销毁自动清理）。 */
    persistTimer: (() => void) | undefined;
    /** 停用态 token 估算缓存（P2-6）：fetchedAt 不变则复用。 */
    tokenCache: Map<string, {
        fetchedAt: number;
        tokens: number;
    }>;
    /** 诊断计数（debug 端点输出，定位采集链路问题用）。 */
    diag: {
        toolsChangeEvents: number;
        snapshots: number;
        lastError: string | null;
        lastAt: number | null;
        lastMcpTools: number | null;
        lastSchemasTotal: number | null;
        lastScope: boolean | null;
        lastAgentRoots: number | null;
        lastAgentList: number | null;
        loadedAt: number | null;
        loadedServers: number | null;
    };
}
