// 装配层纯逻辑自测：P2 的「运行时 server 合并」规则。
// 核心不变量：**未就绪（catalog 没采到 / 工具数为 0 / 判定函数缺失）一律不过滤**，
// 否则会出现「上下文里看不到、dsh_mcp_call 又调不到」的黑洞。
// 用法：node scripts/selftest-assembly.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assembly = await import(pathToFileURL(join(root, 'lib', 'assembly.js')).href)
const { mergeRuntimeIntoPlan, countSearchableHidden } = assembly

let failed = false
const check = (label, fn) => {
  try {
    fn()
    console.log(`ok   ${label}`)
  } catch (error) {
    failed = true
    console.log(`FAIL ${label}`)
    console.log(`     ${error && error.message ? error.message : String(error)}`)
  }
}

const runtime = (entries) => new Map(Object.entries(entries).map(([k, tools]) => [k, { tools }]))

check('已就绪的运行时 server → 记入 name-only 并进入索引段', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ 'cua-driver-mcp': 64 }), () => true)
  assert.equal(byServer.get('cua-driver-mcp'), 'name-only')
  assert.deepEqual(nameOnly, ['cua-driver-mcp'])
})

check('未就绪 → 完全不处理（fail-open 放行）', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ 'cua-driver-mcp': 64 }), () => false)
  assert.equal(byServer.size, 0)
  assert.deepEqual(nameOnly, [])
})

check('就绪判定函数缺失 → 视为未就绪（不接管）', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ x: 3 }), undefined)
  assert.equal(byServer.size, 0)
})

check('工具数为 0 → 不接管', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ x: 0 }), () => true)
  assert.equal(byServer.size, 0)
})

check('注册表已声明的 server 优先，不被运行时来源覆盖', () => {
  const byServer = new Map([['agent-browser', 'hidden']])
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ 'agent-browser': 156 }), () => true)
  assert.equal(byServer.get('agent-browser'), 'hidden')
  assert.deepEqual(nameOnly, [])
})

check('多个 server：只接管就绪的那个', () => {
  const byServer = new Map()
  const nameOnly = []
  const ready = new Set(['a'])
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ a: 5, b: 7 }), (name) => ready.has(name))
  assert.equal(byServer.get('a'), 'name-only')
  assert.equal(byServer.has('b'), false)
  assert.deepEqual(nameOnly, ['a'])
})

check('空运行时表不产生副作用', () => {
  const byServer = new Map([['k', 'off']])
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, new Map(), () => true)
  assert.deepEqual([...byServer.keys()], ['k'])
  assert.deepEqual(nameOnly, [])
})

/* ── 运行时 server 的档位（面板只开放「仅名称 / 隐藏」）───────────────── */

check('档位隐藏：照样过滤工具，但不进索引段', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ cua: 64 }), () => true, () => 'hidden')
  assert.equal(byServer.get('cua'), 'hidden')
  assert.deepEqual(nameOnly, [])
})

check('档位 off：防御性忽略（插件进程关不掉，避免黑洞）', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ cua: 64 }), () => true, () => 'off')
  assert.equal(byServer.size, 0)
  assert.deepEqual(nameOnly, [])
})

check('档位缺省 → 仅名称', () => {
  const byServer = new Map()
  const nameOnly = []
  mergeRuntimeIntoPlan(byServer, nameOnly, runtime({ cua: 64 }), () => true)
  assert.equal(byServer.get('cua'), 'name-only')
  assert.deepEqual(nameOnly, ['cua'])
})

/* ── 「另有 N 个未列出」的计数口径 ───────────────────────────────────── */

check('hidden 计数只数有工具目录的（未装/未运行不算）', () => {
  const hidden = ['apiflow', 'intellij-idea', 'java-boilerplate', 'jdbg', 'redis', 'Tabby']
  const withTools = new Set(['intellij-idea', 'jdbg'])
  assert.equal(countSearchableHidden(hidden, (name) => withTools.has(name)), 2)
})

check('hidden 计数：全部有目录 → 全数', () => {
  assert.equal(countSearchableHidden(['a', 'b'], () => true), 2)
})

check('hidden 计数：判定函数缺失 → 退回旧口径（配置行数）', () => {
  assert.equal(countSearchableHidden(['a', 'b', 'c'], undefined), 3)
})

check('hidden 计数：空列表 → 0', () => {
  assert.equal(countSearchableHidden([], () => true), 0)
})

console.log(failed ? '\n有失败用例' : '\n全部通过')
process.exit(failed ? 1 : 0)
