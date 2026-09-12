/**
 * 客户端共享类型（type-only，不产生打包产物）。
 */

/** locale 插槽注入的翻译函数。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string
