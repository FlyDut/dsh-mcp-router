// 运行时发现纯逻辑自测：注册表之外的 MCP server 识别（全量接管的地基）。
// 用法：node scripts/selftest-runtime.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const index = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
const { discoverRuntimeServers } = index

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

const schemas = (...names) => names.map((name) => ({ name, description: '', parameters: {} }))

check('已知 server 被排除，未知 server 被识别', () => {
  const known = new Set(['agent-browser', 'github'])
  const r = discoverRuntimeServers(
    schemas(
      'mcp__agent-browser__open',
      'mcp__github__issues',
      'mcp__cua-driver-mcp__click',
      'mcp__cua-driver-mcp__type_text',
      'mcp__cua-driver-mcp__screenshot',
    ),
    known,
  )
  assert.deepEqual([...r.servers.keys()], ['cua-driver-mcp'])
  assert.equal(r.servers.get('cua-driver-mcp'), 3)
  assert.equal(r.mcpTools, 5)
})

check('非 mcp__ 前缀一律忽略（native 工具不参与）', () => {
  const r = discoverRuntimeServers(
    schemas('cua_driver_native__click', 'bash', 'dsh_mcp_call', 'mcp__x__y'),
    new Set(),
  )
  assert.deepEqual([...r.servers.keys()], ['x'])
  assert.equal(r.mcpTools, 1)
})

check('畸形工具名跳过（与装配层「不误伤」口径一致）', () => {
  const r = discoverRuntimeServers(schemas('mcp__broken', 'mcp__', 'mcp__a__b'), new Set())
  assert.deepEqual([...r.servers.keys()], ['a'])
  assert.equal(r.mcpTools, 3, 'mcp__ 前缀计数仍在，但畸形名不进 server 表')
})

check('空视图与全已知视图都返回空表', () => {
  assert.equal(discoverRuntimeServers([], new Set()).servers.size, 0)
  const known = new Set(['a'])
  const r = discoverRuntimeServers(schemas('mcp__a__x', 'mcp__a__y'), known)
  assert.equal(r.servers.size, 0)
  assert.equal(r.mcpTools, 2)
})

check('同一 server 多工具累加计数', () => {
  const r = discoverRuntimeServers(
    schemas('mcp__ctx7__a', 'mcp__ctx7__b', 'mcp__ctx7__c', 'mcp__ctx7__d'),
    new Set(),
  )
  assert.equal(r.servers.get('ctx7'), 4)
})

check('schema 缺 name / name 非字符串不抛错', () => {
  const r = discoverRuntimeServers([{}, { name: undefined }, { name: 42 }, { name: 'mcp__ok__t' }], new Set())
  assert.deepEqual([...r.servers.keys()], ['ok'])
})

console.log(failed ? '\n有失败用例' : '\n全部通过')
process.exit(failed ? 1 : 0)
