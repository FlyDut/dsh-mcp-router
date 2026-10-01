// 编辑 / 删除编排自测：文件写回（patch 块、项目 JSON）、只读拒绝、改名迁移、详情初值。
// 用最小 ctx 桩 + 临时 HOME + 真实文件，直接驱动构建产物 lib/index.js 的 domain/mcp-edit。
// 用法：node scripts/selftest-mcp-edit.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// HOME 必须在 import 构建产物之前改（state.ts 在模块加载时求值目录）
const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-mcp-router-edit-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome

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
const checkAsync = async (label, fn) => {
  try {
    await fn()
    console.log(`ok   ${label}`)
  } catch (error) {
    failed = true
    console.log(`FAIL ${label}`)
    console.log(`     ${error && error.message ? error.message : String(error)}`)
  }
}

const index = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

/* ── 固定装置 ─────────────────────────────────────────────────────── */

const profileDir = join(fakeHome, 'profile')
const rootTree = join(profileDir, 'cordis.yml')
const patchFile = join(profileDir, 'cordis.patch.yml')
mkdirSync(profileDir, { recursive: true })
writeFileSync(rootTree, '[]\n', 'utf8')

const PATCH_TEXT = [
  '# 用户 patch 层',
  '- insert:',
  '    - id: mcp-alpha',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        transport: "stdio"',
  '        serverName: "alpha"',
  '        command: "old-cmd"',
  '        args:',
  '          - "--old"',
  "        env:",
  "          TOKEN: !!js '`${process.env.ALPHA_TOKEN}`'",
  '- insert:',
  '    - id: mcp-beta',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        transport: "streamable-http"',
  '        serverName: "beta"',
  '        url: "http://localhost:1111/mcp"',
  '- id: other-plugin',
  '  disabled: true',
].join('\n')
writeFileSync(patchFile, PATCH_TEXT, 'utf8')

/** 项目工作空间 + mcp.json（键 = 原始名，挂载名带路径哈希后缀）。 */
const workspace = join(fakeHome, 'proj')
const mcpsDir = join(workspace, '.dsh', 'mcps')
mkdirSync(mcpsDir, { recursive: true })
const projectFile = join(mcpsDir, 'mcp.json')
writeFileSync(
  projectFile,
  JSON.stringify(
    { mcpServers: { gamma: { transport: 'stdio', command: 'gamma-cmd', args: ['--x'] }, keepme: { transport: 'stdio', command: 'keep' } } },
    null,
    2,
  ) + '\n',
  'utf8',
)
const gammaName = index.projectServerName(workspace, 'gamma')

const updatedCalls = []
const removed = []
const makeCtx = (entries = {}) => ({
  logger: { info() {}, warn() {}, debug() {} },
  agents: { list: () => [], roots: () => [] },
  loader: {
    resolve: (id) => {
      const entry = entries[id]
      if (!entry) throw new Error(`cannot resolve entry "${id}"`)
      return entry
    },
    remove: async (id) => {
      removed.push(id)
    },
  },
})

/** 假 loader 行（形状需满足 isMcpEntry 与 entry.update）。 */
const makeEntry = (id, config) => ({
  id,
  options: { id, name: '@deepseek-ai/dsh-mcp-client', config },
  update: async (options) => {
    updatedCalls.push({ id, options })
  },
})

/** 注册表桩：只需要 refFor / snapshot / refreshNow。 */
const makeRegistry = (refs) => ({
  refFor: (name) => refs.get(name),
  snapshot: () => ({ all: refs, byPreset: new Map(), at: Date.now() }),
  refreshNow: async () => {},
})

const refOf = (over) => ({
  entryId: over.rowId,
  rowId: over.rowId,
  source: 'loader',
  disabled: false,
  running: true,
  transport: 'stdio',
  ...over,
})

const alphaRef = refOf({
  serverName: 'alpha',
  entryId: 'mcp-alpha',
  rowId: 'mcp-alpha',
  file: rootTree,
  toolCallTimeoutMs: 30_000,
})
const betaRef = refOf({
  serverName: 'beta',
  entryId: 'mcp-beta',
  rowId: 'mcp-beta',
  transport: 'streamable-http',
  file: rootTree,
})
const gammaRef = refOf({
  serverName: gammaName,
  entryId: 'projmcp-gamma',
  rowId: 'projmcp-gamma',
  source: 'project',
  workspace,
  file: rootTree,
})
const presetRef = refOf({
  serverName: 'fs',
  entryId: 'include:agent-presets:mcp-filesystem',
  rowId: 'mcp-filesystem',
  source: 'preset',
  presetId: 'standard',
  file: join(fakeHome, '.dsh', '.agent-presets', 'standard', 'agent.cordis.yml'),
})

const refs = new Map([
  ['alpha', alphaRef],
  ['beta', betaRef],
  [gammaName, gammaRef],
  ['fs', presetRef],
])
const registry = makeRegistry(refs)
const policy = index.createPolicyStore({ ctx: makeCtx(), fallbackExposure: 'name-only' })
await policy.load()
await policy.set({ serverName: 'alpha', patch: { exposure: 'hidden', presets: { mode: 'only', ids: ['coding'] } }, applyMode: 'immediate' })

/* ── 只读目标 ─────────────────────────────────────────────────────── */

await checkAsync('resolveWritableTarget：预设行 → readonly（附来源文件）', async () => {
  const target = await index.resolveWritableTarget({ ctx: makeCtx(), registry, policy }, presetRef)
  assert.equal(target.kind, 'readonly')
  assert.equal(target.reason, 'preset')
  assert.ok(target.file.endsWith('agent.cordis.yml'))
})

await checkAsync('updateServer：预设行拒绝并给出「设关闭档位 / 直接改文件」的引导', async () => {
  await assert.rejects(
    () => index.updateServer({ ctx: makeCtx(), registry, policy }, { serverName: 'fs', patch: { command: 'x' } }),
    /预设组合文件/,
  )
})

await checkAsync('removeServer：预设行拒绝（不写任何文件）', async () => {
  const before = readFileSync(patchFile, 'utf8')
  await assert.rejects(() => index.removeServer({ ctx: makeCtx(), registry, policy }, { serverName: 'fs' }), /档位设为「关闭」/)
  assert.equal(readFileSync(patchFile, 'utf8'), before)
})

/* ── 编辑 patch 行 ────────────────────────────────────────────────── */

await checkAsync('updateServer：改写 patch 行 config（command/args 更新、旧键移除、其它行不动）', async () => {
  updatedCalls.length = 0
  const ctx = makeCtx({ 'mcp-alpha': makeEntry('mcp-alpha', { transport: 'stdio', serverName: 'alpha', command: 'old-cmd', args: ['--old'] }) })
  const result = await index.updateServer(
    { ctx, registry, policy },
    { serverName: 'alpha', patch: { command: 'new-cmd', args: ['--new', '--flag'] } },
  )
  assert.equal(result.file, patchFile)
  assert.equal(result.applied, true)
  assert.equal(updatedCalls.length, 1, '应调用 entry.update')
  assert.equal(updatedCalls[0].options.config.command, 'new-cmd')
  assert.deepEqual(updatedCalls[0].options.config.args, ['--new', '--flag'])

  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes('command: "new-cmd"'))
  assert.ok(text.includes('- "--new"') && text.includes('- "--flag"'))
  assert.ok(!text.includes('old-cmd') && !text.includes('--old'))
  assert.ok(text.includes('mcp-beta'), '其它块保留')
  assert.ok(text.includes('other-plugin'), '顶层行保留')
})

await checkAsync('updateServer：!!js 动态键原样保留（不固化成明文）', async () => {
  const text = readFileSync(patchFile, 'utf8')
  assert.ok(text.includes("TOKEN: !!js '`${process.env.ALPHA_TOKEN}`'"), `动态表达式应保留：${text}`)
  // 同时仍然改到了普通键
  assert.ok(text.includes('transport: "stdio"'))
})

await checkAsync('updateServer：改 transport 时切换字段集（stdio → http，去掉 command/args）', async () => {
  const ctx = makeCtx({ 'mcp-alpha': makeEntry('mcp-alpha', { transport: 'stdio', serverName: 'alpha', command: 'new-cmd' }) })
  await index.updateServer(
    { ctx, registry, policy },
    { serverName: 'alpha', patch: { transport: 'streamable-http', url: 'http://localhost:2222/mcp' } },
  )
  const text = readFileSync(patchFile, 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === '- id: mcp-alpha')
  let end = start + 1
  while (end < lines.length && !/^-/.test(lines[end])) end += 1
  const block = lines.slice(start, end).join('\n')
  assert.ok(block.includes('transport: "streamable-http"'), block)
  assert.ok(block.includes('url: "http://localhost:2222/mcp"'), block)
  assert.ok(!block.includes('command:'), `切换 transport 后不应残留 command：${block}`)
  assert.ok(!block.includes('- "--new"'), block)
})

await checkAsync('updateServer：改名重写 config 并迁移策略（工具禁用前缀一并重写）', async () => {
  await policy.set({ serverName: 'alpha', patch: { disabledTools: ['mcp__alpha__danger', 'mcp__other__x'] }, applyMode: 'immediate' })
  const ctx = makeCtx({ 'mcp-alpha': makeEntry('mcp-alpha', { transport: 'streamable-http', serverName: 'alpha' }) })
  const result = await index.updateServer({ ctx, registry, policy }, { serverName: 'alpha', patch: { serverName: 'alpha2' } })
  assert.equal(result.renamedTo, 'alpha2')
  assert.equal(policy.intent('alpha', undefined), undefined, '旧名策略应移除')
  const moved = policy.intent('alpha2', undefined)
  assert.ok(moved, '新名应有策略')
  assert.deepEqual(moved.disabledTools, ['mcp__alpha2__danger', 'mcp__other__x'])
  assert.deepEqual(moved.presets, { mode: 'only', ids: ['coding'] }, '预设关联随名字迁移')
  assert.ok(readFileSync(patchFile, 'utf8').includes('serverName: "alpha2"'))
  // 真实实现里 registry.refreshNow() 会按新配置重建快照；测试桩需手动同步
  refs.delete('alpha')
  refs.set('alpha2', { ...alphaRef, serverName: 'alpha2' })
})

await checkAsync('updateServer：名字非法 / 与已有 server 冲突时拒绝', async () => {
  const ctx = makeCtx({ 'mcp-alpha': makeEntry('mcp-alpha', { transport: 'stdio', serverName: 'alpha2' }) })
  await assert.rejects(
    () => index.updateServer({ ctx, registry, policy }, { serverName: 'alpha2', patch: { serverName: 'bad name!' } }),
    /需匹配/,
  )
  await assert.rejects(
    () => index.updateServer({ ctx, registry, policy }, { serverName: 'alpha2', patch: { serverName: 'beta' } }),
    /已被占用/,
  )
})

await checkAsync('updateServer：文件里找不到该行时报错且不改文件', async () => {
  const before = readFileSync(patchFile, 'utf8')
  const ghost = refOf({ serverName: 'ghost', entryId: 'mcp-ghost', rowId: 'mcp-ghost', file: rootTree })
  const ghostRegistry = makeRegistry(new Map([...refs, ['ghost', ghost]]))
  await assert.rejects(
    () => index.updateServer({ ctx: makeCtx(), registry: ghostRegistry, policy }, { serverName: 'ghost', patch: { command: 'x' } }),
    /找不到/,
  )
  assert.equal(readFileSync(patchFile, 'utf8'), before)
})

/* ── 详情初值 ─────────────────────────────────────────────────────── */

await checkAsync('describeServer：给出可写目标、当前配置与动态键清单', async () => {
  const ctx = makeCtx({ 'mcp-alpha': makeEntry('mcp-alpha', { transport: 'stdio', serverName: 'alpha2', command: 'new-cmd' }) })
  const detail = await index.describeServer({ ctx, registry, policy }, { serverName: 'alpha2' })
  assert.equal(detail.target.kind, 'patch')
  assert.equal(detail.target.rowId, 'mcp-alpha')
  const token = detail.keys.find((k) => k.name === 'env')
  assert.ok(token && token.dynamic === true, 'env 键应标记为动态')
  assert.ok(detail.keys.find((k) => k.name === 'transport' && k.dynamic === false))
})

await checkAsync('describeServer：预设行返回 readonly 说明', async () => {
  const detail = await index.describeServer({ ctx: makeCtx(), registry, policy }, { serverName: 'fs' })
  assert.equal(detail.target.kind, 'readonly')
  assert.ok(detail.readonly.includes('只读'))
})

/* ── 删除 ─────────────────────────────────────────────────────────── */

await checkAsync('removeServer：删除 patch 块 + 卸载 loader 行 + 清理策略', async () => {
  removed.length = 0
  const result = await index.removeServer({ ctx: makeCtx(), registry, policy }, { serverName: 'alpha2' })
  assert.equal(result.file, patchFile)
  assert.equal(result.unloaded, true)
  assert.deepEqual(removed, ['mcp-alpha'])
  assert.equal(policy.effective('alpha2', undefined).exposure, 'name-only', '策略应被清理回默认')

  const text = readFileSync(patchFile, 'utf8')
  assert.ok(!text.includes('mcp-alpha'))
  assert.ok(!text.includes('alpha2'))
  assert.ok(!text.includes('ALPHA_TOKEN'), '动态键随行一起消失')
  assert.ok(text.includes('mcp-beta') && text.includes('other-plugin'))
  const inserts = (text.match(/^- insert:$/gm) || []).length
  assert.equal(inserts, 1, '被删行独占的 insert 头应一并消失')
})

await checkAsync('removeServer：行不存在时报错且不改文件', async () => {
  const before = readFileSync(patchFile, 'utf8')
  await assert.rejects(() => index.removeServer({ ctx: makeCtx(), registry, policy }, { serverName: 'alpha2' }), /找不到/)
  assert.equal(readFileSync(patchFile, 'utf8'), before)
})

await checkAsync('updateServer：项目行编辑写回 mcp.json（其它键不动）', async () => {
  const ctx = makeCtx()
  await index.updateServer({ ctx, registry, policy }, { serverName: gammaName, patch: { args: ['--changed'] } })
  const parsed = JSON.parse(readFileSync(projectFile, 'utf8'))
  assert.deepEqual(parsed.mcpServers.gamma.args, ['--changed'])
  assert.deepEqual(parsed.mcpServers.keepme, { transport: 'stdio', command: 'keep' }, '其它键不动')
})

await checkAsync('findProjectMcpFile：由挂载名反查来源文件与原始键名', async () => {
  const found = await index.findProjectMcpFile(workspace, gammaName)
  assert.ok(found, '应能定位')
  assert.equal(found.file, projectFile)
  assert.equal(found.key, 'gamma')
  assert.equal(await index.findProjectMcpFile(workspace, 'nonexistent-12345678'), undefined)
})

await checkAsync('removeServer：项目行删除对应 JSON 键（并保留其它键与格式）', async () => {
  removed.length = 0
  const ctx = makeCtx()
  const result = await index.removeServer({ ctx, registry, policy }, { serverName: gammaName })
  assert.equal(result.file, projectFile)
  const parsed = JSON.parse(readFileSync(projectFile, 'utf8'))
  assert.ok(!('gamma' in parsed.mcpServers), 'gamma 键应被删除')
  assert.ok('keepme' in parsed.mcpServers, '其它键保留')
  assert.ok(readFileSync(projectFile, 'utf8').endsWith('\n'), '保持结尾换行')
})

// ── 回显脱敏与写侧哨兵还原（移植上游 0b16e6f；两者必须成对） ─────────────

check('maskConfigSecrets：env/headers 键名保留、值置哨兵；其余字段原样', () => {
  const masked = index.maskConfigSecrets({
    serverName: 'demo',
    transport: 'stdio',
    command: 'node',
    env: { API_KEY: 'sk-real-secret', DEBUG: '1' },
    headers: { Authorization: 'Bearer real' },
  })
  assert.deepEqual(masked.env, { API_KEY: index.MASKED_VALUE, DEBUG: index.MASKED_VALUE })
  assert.deepEqual(masked.headers, { Authorization: index.MASKED_VALUE })
  assert.equal(masked.command, 'node', '非敏感字段不动')
  assert.equal(masked.serverName, 'demo')
  // 非字典形态的 env（异常输入）不应被改写
  assert.equal(index.maskConfigSecrets({ env: 'oops' }).env, 'oops')
})

check('unmaskEcho：哨兵=保留原值（有 live 恢复 / 无 live 丢弃 / 新值照收 / 删除照删）', () => {
  const live = { env: { API_KEY: 'sk-real', OLD: 'keep' }, headers: { Authorization: 'Bearer real' } }
  const merged = index.unmaskEcho(
    {
      env: { API_KEY: index.MASKED_VALUE, NEW_KEY: 'fresh', GHOST: index.MASKED_VALUE },
      headers: { Authorization: index.MASKED_VALUE },
    },
    live,
  )
  assert.deepEqual(merged.env, { API_KEY: 'sk-real', NEW_KEY: 'fresh' }, '哨兵恢复真值；live 没有的 GHOST 丢弃')
  assert.deepEqual(merged.headers, { Authorization: 'Bearer real' }, 'headers 同样还原')
})

check('脱敏往返：回显→整表单回写 不丢真值、也不把哨兵写进配置', () => {
  const live = { transport: 'stdio', command: 'node', env: { API_KEY: 'sk-real', DEBUG: '1' } }
  const echoed = index.maskConfigSecrets(live)
  // 面板把回显值原样当补丁发回
  const written = index.unmaskEcho(echoed, live)
  assert.deepEqual(written.env, live.env, '真值必须原样保留')
  assert.ok(!JSON.stringify(written).includes(index.MASKED_VALUE), '写回内容不得残留哨兵')
})

// ── readBody 加固（移植上游 0b16e6f） ──────────────────────────────────

async function withHttpServer(handler) {
  const { createServer } = await import('node:http')
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  // close() 只停新连接，会一直等空闲连接；先主动断开再 close，否则 keep-alive 客户端让进程永不退出
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  }
}

async function postChunks(port, chunks) {
  const { request } = await import('node:http')
  return await new Promise((resolve, reject) => {
    const req = request(
      // agent:false 走一次性连接，避免 globalAgent 的 keep-alive 空闲 socket 把进程挂住
      { host: '127.0.0.1', port, method: 'POST', path: '/', agent: false, headers: { 'content-length': chunks.reduce((n, c) => n + c.length, 0) } },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => resolve({ status: res.statusCode, raw }))
      },
    )
    req.on('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
}

await checkAsync('readBody：跨 chunk 切断的多字节 UTF-8 不乱码（StringDecoder）', async () => {
  const srv = await withHttpServer(async (req, res) => {
    try {
      const body = await index.readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ body }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error?.message ?? String(error) }))
    }
  })
  try {
    const text = JSON.stringify({ note: '中文分块：好、测试“引号”与 emoji 🎚️ 必须完整' })
    const payload = Buffer.from(text, 'utf8')
    const chunks = []
    // 每 3 字节切一刀：多字节字符必然被切断在 chunk 边界上
    for (let i = 0; i < payload.length; i += 3) chunks.push(payload.subarray(i, i + 3))
    const result = await postChunks(srv.port, chunks)
    assert.equal(result.status, 200, `期望 200，实际 ${result.status}: ${result.raw}`)
    assert.equal(JSON.parse(result.raw).body, text, '跨 chunk 中文/emoji 必须逐字节还原')
  } finally {
    await srv.close()
  }
})

await checkAsync('readBody：超限返回可读错误（不 destroy socket，客户端能拿到响应）', async () => {
  const srv = await withHttpServer(async (req, res) => {
    try {
      await index.readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error?.message ?? String(error) }))
    }
  })
  try {
    const oversized = Buffer.alloc(70 * 1024, 0x61) // 70KB > 64KB 上限
    const result = await postChunks(srv.port, [oversized])
    assert.equal(result.status, 400, `超限应回 400，实际 ${result.status}`)
    assert.match(result.raw, /body exceeds/, '错误信息应说明超限')
  } finally {
    await srv.close()
  }
})

rmSync(fakeHome, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('\nselftest-mcp-edit: all checks passed')
// 项目行 updateServer/removeServer 的成功路径会触发 remountWorkspace →
// ensureWorkspace，留下常驻 FSWatcher（宿主环境的设计：项目 MCP 热更新）。
// 本 selftest 是短命进程，没有宿主生命周期来停 watcher，故显式退出，
// 避免 _getActiveHandles 挂住事件循环、卡死 package.json 的 selftest 串联链。
process.exit(0)
