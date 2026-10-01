// 临时 Node 自测：验证 MCP 中间层控制的纯逻辑（构建产物 lib/*.js）。
// eslint-disable-next-line no-console
// 用法：node scripts/selftest-mcp.mjs （在包根目录运行）
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const catalog = await import(pathToFileURL(join(root, 'lib', 'catalog.js')).href)
const index = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
const convert = await import(pathToFileURL(join(root, 'lib', 'mcp-convert.js')).href)
const sessionParam = await import(pathToFileURL(join(root, 'lib', 'session-param.js')).href)

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

// 控制工具名护栏（上游 PR#16）：名字一旦回到 mcp_ 前缀，claude.ai 订阅网关会把整个
// 请求判 400 并伪报配额耗尽 —— 这是实测过的线上故障，必须由自测锁住。
check('控制工具名护栏：dsh_ 前缀 + 单一事实源（不得以 mcp_ 开头）', () => {
  assert.equal(index.MCP_SEARCH_TOOL, 'dsh_mcp_search')
  assert.equal(index.MCP_CALL_TOOL, 'dsh_mcp_call')
  for (const name of [index.MCP_SEARCH_TOOL, index.MCP_CALL_TOOL]) {
    assert.ok(!name.startsWith('mcp_'), `${name} 不得以 mcp_ 开头`)
    assert.ok(index.CONTROL_TOOL_NAMES.has(name), `${name} 应在 CONTROL_TOOL_NAMES 中`)
  }
  assert.equal(index.CONTROL_TOOL_NAMES.size, 2)
})

// dsh_mcp_call 前缀归一化（2026-08-22 修补：双重前缀缺陷回归测试）
check('normalizeToolName：裸名原样透传', () => {
  assert.equal(index.normalizeToolName('exa', 'web_search_exa'), 'web_search_exa')
})
check('normalizeToolName：注册全名剥一次前缀', () => {
  assert.equal(index.normalizeToolName('exa', 'mcp__exa__web_search_exa'), 'web_search_exa')
})
check('normalizeToolName：双重前缀循环剥净（2026-08-22 缺陷）', () => {
  assert.equal(index.normalizeToolName('mimo-image', 'mcp__mimo-image__mcp__mimo-image__understand_image'), 'understand_image')
})
check('normalizeToolName：其他 server 注册全名快速失败', () => {
  assert.throws(() => index.normalizeToolName('exa', 'mcp__mimo-image__understand_image'), /裸名/)
})

// dsh_mcp_call arguments 归一化 + 错误呈现（2026-08-24 修补：参数双编码与 [object Object] 缺陷回归）
check('normalizeArguments：对象原样透传（同引用）', () => {
  const input = { path: 'a.md', n: 1 }
  assert.equal(index.normalizeArguments(input), input)
})
check('normalizeArguments：单层 JSON 字符串解析为对象', () => {
  assert.deepEqual(index.normalizeArguments('{"path": "README.md"}'), { path: 'README.md' })
})
check('normalizeArguments：双编码字符串循环剥净（2026-08-24 实测缺陷形态）', () => {
  const once = JSON.stringify({ path: 'README.md' })
  assert.deepEqual(index.normalizeArguments(JSON.stringify(once)), { path: 'README.md' })
})
check('normalizeArguments：数组形态 JSON 也接受', () => {
  assert.deepEqual(index.normalizeArguments('[1,2]'), [1, 2])
})
check('normalizeArguments：非法/普通字符串保留原值交由远端报错', () => {
  assert.equal(index.normalizeArguments('{bad json'), '{bad json')
  assert.equal(index.normalizeArguments('plain text'), 'plain text')
})
check('normalizeArguments：null/undefined/空白串归一为空对象', () => {
  assert.deepEqual(index.normalizeArguments(undefined), {})
  assert.deepEqual(index.normalizeArguments(null), {})
  assert.deepEqual(index.normalizeArguments('   '), {})
})
check('normalizeArguments：超过 3 层编码不再继续剥离（防失控）', () => {
  let v = { deep: 1 }
  for (let i = 0; i < 5; i++) v = JSON.stringify(v)
  assert.equal(typeof index.normalizeArguments(v), 'string')
})

check('msgOf：Error 取 message；普通对象输出 JSON 文本而非 [object Object]（2026-08-24 缺陷）', () => {
  assert.equal(index.msgOf(new Error('boom')), 'boom')
  const rendered = index.msgOf({ code: -32602, message: 'missing required path' })
  assert.ok(rendered.includes('missing required path'))
  assert.ok(!rendered.includes('[object Object]'))
  assert.equal(index.msgOf('plain'), 'plain')
})

const schemas = [
  { name: 'mcp__cheatengine__read_memory', description: '读取游戏进程内存', parameters: { type: 'object', properties: { addr: { type: 'string' } }, required: ['addr'] } },
  { name: 'mcp__cheatengine__write_memory', description: '写入游戏进程内存', parameters: { type: 'object', properties: { addr: { type: 'string' }, value: { type: 'integer' } } } },
  { name: 'mcp__calcmcp__integrate', description: '数值积分', parameters: { type: 'object', properties: { expression: { type: 'string' } } } },
  { name: 'mcp__calcmcp__eigenvalues', description: '矩阵特征值', parameters: { type: 'object', properties: { matrix_a: { type: 'string' } } } },
  { name: 'ssh_exec', description: '远程执行命令（非 MCP）' },
  { name: 'mcp__chrome__navigate', description: '导航到 URL', parameters: { type: 'object', properties: { url: { type: 'string' } } } },
]

check('snapshotFromSchemas 只取该 server 前缀', () => {
  const ce = catalog.snapshotFromSchemas(schemas, 'cheatengine')
  assert.equal(ce.length, 2)
  assert.deepEqual(ce.map((t) => t.name), ['mcp__cheatengine__read_memory', 'mcp__cheatengine__write_memory'])
  assert.equal(ce[0].description, '读取游戏进程内存')
  assert.ok(ce[0].parameters && typeof ce[0].parameters === 'object')
  // 空 server
  assert.equal(catalog.snapshotFromSchemas(schemas, 'ghost').length, 0)
})

const buildCatalog = () => {
  const known = ['cheatengine', 'calcmcp', 'chrome']
  const c = {}
  for (const server of known) {
    c[server] = { tools: catalog.snapshotFromSchemas(schemas, server), fetchedAt: 1, source: 'live' }
  }
  return c
}

check('searchCatalog 打分排序：描述命中 > 未命中、工具名命中权重高', () => {
  const c = buildCatalog()
  // "integ" 是 mcp__calcmcp__integrate 工具名 token 的前缀 → 命中且最高分
  const hits = catalog.searchCatalog(c, 'integ')
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].server, 'calcmcp')
  assert.equal(hits[0].tool.name, 'mcp__calcmcp__integrate')
  // 工具名命中 "read"（read_memory）
  const readHits = catalog.searchCatalog(c, 'read')
  assert.equal(readHits[0].tool.name, 'mcp__cheatengine__read_memory')
  assert.ok(readHits[0].server === 'cheatengine')
  // 无命中时为空
  assert.equal(catalog.searchCatalog(c, 'zzzznope').length, 0)
})

check('searchCatalog 参数名命中权重', () => {
  const c = buildCatalog()
  // "addr" 是多个工具的参数名；权重 1 但应命中
  const hits = catalog.searchCatalog(c, 'addr', 5)
  assert.ok(hits.length > 0)
  assert.ok(hits.every((h) => ['read_memory', 'write_memory'].includes(h.tool.name.split('__').pop())))
})

check('searchCatalog 空 query 返回空；limit 被尊重', () => {
  const c = buildCatalog()
  assert.equal(catalog.searchCatalog(c, '').length, 0)
  assert.ok(catalog.searchCatalog(c, 'memory', 1).length <= 1)
  // 默认 limit=5
  const all = catalog.searchCatalog(c, 'read write navigate integ matrix addr url', 10)
  assert.ok(all.length >= 4)
})

// ── 会话透传（移植上游 74ed18e）───────────────────────────────────────

check('withSessionParam：有会话才追加；拿不到会话时 URL 与旧版逐字节相同', () => {
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state', 'abc'), '/api/dsh-mcp-router/state?session=abc')
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state?x=1', 'abc'), '/api/dsh-mcp-router/state?x=1&session=abc')
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state', 'a b&c'), '/api/dsh-mcp-router/state?session=a%20b%26c')
  // 降级路径必须与旧请求完全一致（可独立 revert）
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state', undefined), '/api/dsh-mcp-router/state')
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state', ''), '/api/dsh-mcp-router/state')
  assert.equal(sessionParam.withSessionParam('/api/dsh-mcp-router/state', null), '/api/dsh-mcp-router/state')
})

check('readCurrentSession：无 hook / hook 抛错 / 非字符串 一律降级 undefined', () => {
  assert.equal(sessionParam.readCurrentSession({}), undefined)
  assert.equal(sessionParam.readCurrentSession({ useSessions: 'not-a-hook' }), undefined)
  assert.equal(
    sessionParam.readCurrentSession({ useSessions: () => 'sess-1' }),
    'sess-1',
    'selector 取到字符串即返回',
  )
  assert.equal(sessionParam.readCurrentSession({ useSessions: () => ({ nope: true }) }), undefined)
  assert.equal(sessionParam.readCurrentSession({ useSessions: () => '' }), undefined)
  assert.equal(
    sessionParam.readCurrentSession({
      useSessions: () => {
        throw new Error('no session store')
      },
    }),
    undefined,
    'hook 抛错必须降级而不是冒泡',
  )
})

check('dsh_mcp_search server=X：默认只回能力摘要（前 5 个预览），不返回全表', () => {
  const tools = []
  for (let i = 0; i < 120; i += 1) {
    tools.push({ name: `mcp__big__tool_${String(i).padStart(3, '0')}`, description: `工具 ${i}` })
  }
  const out = index.buildServerListingResult({ server: 'big', found: true, visible: tools, all: false })
  assert.equal(out.count, 120, 'count 是可见总数')
  assert.equal(out.preview.length, 5, '默认只预览 5 个')
  assert.equal(out.truncated, true)
  assert.ok(!('tools' in out), '默认不得回吐全表字段')
  assert.equal(out.preview[0].name, 'tool_000', '预览用裸名（供 dsh_mcp_call 直接调用）')
  assert.ok(JSON.stringify(out).length < 2000, `摘要必须远小于全表（实际 ${JSON.stringify(out).length} 字节）`)
})

check('dsh_mcp_search server=X + all:true：分页且 count=总数、hasMore/页上限正确', () => {
  const tools = []
  for (let i = 0; i < 45; i += 1) tools.push({ name: `mcp__big__t${i}`, description: '' })
  const first = index.buildServerListingResult({ server: 'big', found: true, visible: tools, all: true })
  assert.equal(first.count, 45, 'count 仍是总数，不是页大小')
  assert.equal(first.limit, 20, '默认页大小 20')
  assert.equal(first.tools.length, 20)
  assert.equal(first.hasMore, true)
  const last = index.buildServerListingResult({ server: 'big', found: true, visible: tools, all: true, offset: 40 })
  assert.equal(last.tools.length, 5)
  assert.equal(last.hasMore, false, '末页 hasMore=false')
  const capped = index.buildServerListingResult({ server: 'big', found: true, visible: tools, all: true, pageSize: 999 })
  assert.equal(capped.limit, 100, '页大小上限 100')
})

check('dsh_mcp_search server=X：空清单 / 未找到 server 的摘要形态', () => {
  const empty = index.buildServerListingResult({ server: 'ghost', found: false, visible: [], all: false })
  assert.equal(empty.count, 0)
  assert.equal(empty.truncated, false)
  assert.equal(empty.hint, null)
  assert.deepEqual(empty.preview, [])
})

check('listServer 三态：found/totalCount/本页；未知 server found=false（不再返回 undefined）', () => {
  const c = buildCatalog()
  const chrome = catalog.listServer(c, 'chrome')
  assert.equal(chrome.found, true)
  assert.equal(chrome.totalCount, 1)
  assert.equal(chrome.limit, null, '未传 limit = 不分页')
  assert.equal(chrome.tools.length, 1)
  assert.equal(chrome.tools[0].name, 'mcp__chrome__navigate')
  assert.equal(chrome.tools[0].description, '导航到 URL')
  const missing = catalog.listServer(c, 'nope')
  assert.equal(missing.found, false)
  assert.equal(missing.totalCount, 0)
  assert.deepEqual(missing.tools, [])
})

check('listServer 分页：totalCount 不受页大小影响（b8b87f9 口径）+ offset/hasMore', () => {
  const c = buildCatalog()
  const first = catalog.listServer(c, 'cheatengine', { limit: 1 })
  assert.equal(first.totalCount, 2, 'count 必须是总数，不是页大小')
  assert.equal(first.tools.length, 1)
  assert.equal(first.limit, 1)
  const second = catalog.listServer(c, 'cheatengine', { offset: 1, limit: 1 })
  assert.equal(second.totalCount, 2)
  assert.equal(second.tools.length, 1)
  assert.notEqual(second.tools[0].name, first.tools[0].name, 'offset 生效')
  const beyond = catalog.listServer(c, 'cheatengine', { offset: 99 })
  assert.deepEqual(beyond.tools, [])
  assert.equal(beyond.totalCount, 2)
})

check('searchCatalog scopedTo：只在指定 server 内检索；未知 server 返回空', () => {
  const c = buildCatalog()
  const allHits = catalog.searchCatalog(c, 'read', 10)
  assert.ok(allHits.length > 0)
  const scoped = catalog.searchCatalog(c, 'read', 10, 'cheatengine')
  assert.ok(scoped.length > 0, 'scoped 应命中 cheatengine 的工具')
  assert.ok(scoped.every((h) => h.server === 'cheatengine'), 'scoped 不得返回其它 server')
  // iamge 类关键词在 chrome 内无命中 → 空，但 server 存在（与「server 不存在」区分靠 listServer）
  assert.equal(catalog.searchCatalog(c, 'read', 10, 'chrome').length, 0)
  assert.equal(catalog.searchCatalog(c, 'read', 10, 'no-such-server').length, 0)
})

check('serverOfMcp 解析 server 名', () => {
  assert.equal(catalog.serverOfMcp('mcp__cheatengine__read_memory'), 'cheatengine')
  assert.equal(catalog.serverOfMcp('ssh_exec'), null)
  assert.equal(catalog.serverOfMcp('mcp__chrome__navigate'), 'chrome')
})

// 持久化往返：临时目录
await checkAsync('catalog 持久化往返（临时目录）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-selftest-'))
  try {
    const c = buildCatalog()
    await catalog.saveCatalog(dir, c)
    const loaded = await catalog.loadCatalog(dir)
    assert.deepEqual(Object.keys(loaded).sort(), Object.keys(c).sort())
    assert.deepEqual(loaded.cheatengine.tools.map((t) => t.name), c.cheatengine.tools.map((t) => t.name))
    assert.equal(loaded.chrome.tools[0].description, '导航到 URL')
    assert.equal(loaded.calcmcp.fetchedAt, undefined || 1 || loaded.calcmcp.fetchedAt) // 字段存在即可
    // 原子写：不应留下 tmp 文件
    assert.throws(() => readFileSync(join(dir, 'catalog.json.tmp'), 'utf8'))
    // 文件确实存在
    readFileSync(join(dir, 'catalog.json'), 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('loadCatalog 缺失目录返回空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-selftest-'))
  try {
    const loaded = await catalog.loadCatalog(dir)
    assert.deepEqual(loaded, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// setRowFlag 不动（回归护栏）
check('setRowFlag 行为不变', () => {
  const text = '- id: a\n  name: x\n- id: b\n  name: y\n'
  const withFlag = index.setRowFlag(text, 'a', 'disabled', true)
  assert.ok(withFlag.includes('  disabled: true'))
  assert.ok(withFlag.includes('- id: a'))
  const back = index.setRowFlag(withFlag, 'a', 'disabled', false)
  assert.equal(back, text)
  // 未知行抛错
  assert.throws(() => index.setRowFlag(text, 'zzz', 'disabled', true))
})

check('setRowFlag：已有 disabled: false 时置 true 必须反转（2026-08-27 obsidian 设置丢失事故回归）', () => {
  // preset 原文 obsidian 行自带 disabled: false，用户面板关闭（desired=true）
  const text = '- id: mcp-obsidian\n  disabled: false\n'
  const out = index.setRowFlag(text, 'mcp-obsidian', 'disabled', true)
  assert.notEqual(out, text, 'must not be a no-op')
  assert.ok(out.includes('  disabled: true'), out)
  assert.ok(!out.includes('disabled: false'), out)
  assert.equal(index.rowDisabledState(out, 'mcp-obsidian'), true)
  // 幂等：已是 true 再置 true 不变
  assert.equal(index.setRowFlag(out, 'mcp-obsidian', 'disabled', true), out)
  // 反转后再移除 → 回到无标记
  const removed = index.setRowFlag(out, 'mcp-obsidian', 'disabled', false)
  assert.ok(!removed.includes('disabled: true'))
  assert.equal(index.rowDisabledState(removed, 'mcp-obsidian'), null)
})

check('mergeSchemas：agent scope ∪ 全局视图，按 name 去重不重复计数（filesystem 无工具事故回归）', () => {
  const scoped = [
    { name: 'mcp__calcmcp__add', description: 'a' },
    { name: 'mcp__calcmcp__sub', description: 'b' },
  ]
  const globalView = [
    { name: 'mcp__filesystem__read_text_file', description: 'fs' },
    { name: 'mcp__calcmcp__add', description: 'dup-scoped' }, // 与 scoped 重名 → 丢弃
  ]
  const merged = index.mergeSchemas(scoped, globalView)
  assert.equal(merged.length, 3, 'scoped 2 + global 新增 1（重名去重）')
  assert.ok(merged.some((s) => s.name === 'mcp__filesystem__read_text_file'), '全局视图工具应并入')
  assert.equal(merged.filter((s) => s.name === 'mcp__calcmcp__add').length, 1, '重名只保留 scoped 一份')
  // 无全局视图 → 原样返回
  assert.equal(index.mergeSchemas(scoped, []), scoped)
})

check('computeStatus：表驱动四态（active 以 liveTools 真实注册为准，catalog 快照不参与）', () => {
  const cases = [
    // [disabled, running, liveTools, expected]
    [false, true, 14, 'active'],   // 启用 + 注册工具 → active
    [false, true, 0, 'idle'],      // 启用 + 无注册（catalog 有旧快照也判 idle，防掩盖故障现场）
    [true, true, 14, 'disabled'],  // 停用优先
    [true, false, 14, 'disabled'],
    [false, false, 0, 'failed'],   // 未运行
    [false, false, 14, 'failed'],
  ]
  for (const [disabled, running, liveTools, expected] of cases) {
    const got = index.computeStatus(disabled, running, liveTools)
    assert.equal(got, expected, `computeStatus(${disabled}, ${running}, ${liveTools}) -> ${got}, expected ${expected}`)
  }
})

// computeRowDisplay：数字诚实口径（移植上游 78142f6 —— 零注册不得被目录快照伪装成健康）
check('computeRowDisplay：启用+在跑+零注册不回填 catalog，停用/未运行仍可回填', () => {
  const base = { liveTools: 0, liveTokens: 0, catalogTools: 4, catalogTokens: 120 }
  // 启用 + 在跑 + 零注册 → 0/0 + unregistered（这正是「假绿」现场）
  assert.deepEqual(index.computeRowDisplay({ ...base, disabled: false, running: true }), {
    tools: 0,
    tokens: 0,
    unregistered: true,
  })
  // 启用 + 在跑 + 有注册 → 用 live 真值
  assert.deepEqual(
    index.computeRowDisplay({ ...base, disabled: false, running: true, liveTools: 14, liveTokens: 900 }),
    { tools: 14, tokens: 900, unregistered: false },
  )
  // 停用（进程可能仍在跑）→ 用 catalog 快照回填，且不算 unregistered
  assert.deepEqual(index.computeRowDisplay({ ...base, disabled: true, running: true }), {
    tools: 4,
    tokens: 120,
    unregistered: false,
  })
  // 未运行 → 同样回填快照，unregistered 由 computeStatus 的 failed 表达
  assert.deepEqual(index.computeRowDisplay({ ...base, disabled: false, running: false }), {
    tools: 4,
    tokens: 120,
    unregistered: false,
  })
})

// rowDisabledState / setRowFlag（可维护性批次 P1-1 拆出 preset.ts 后的回归护栏）
check('rowDisabledState / setRowFlag：组合文件 disabled 行读写', () => {
  const comp = '- id: mcp-a\n  name: "@deepseek-ai/dsh-mcp-client"\n  disabled: true\n  config:\n    serverName: aaa\n- id: b\n'
  assert.equal(index.rowDisabledState(comp, 'mcp-a'), true)
  assert.equal(index.rowDisabledState(comp, 'b'), null)
  assert.equal(index.rowDisabledState('- id: c\n  name: x\n', 'c'), null)
})

// Config schema 含 autoManage 相关字段（构建产物可被实例化）
check('index.Config schema 存在（schemastery Schema）且 inject 含 systemPrompt/timer', () => {
  assert.ok(index.Config) // schemastery Schema 是函数形式
  assert.ok(index.inject.includes('systemPrompt'))
  assert.ok(index.inject.includes('timer'))
})

// ── mcp-convert：mcpServers JSON → dsh-mcp-client 行（快速迁移转换器） ──────────
check('parseMcpServersJson：stdio（command+args）', () => {
  const { servers, errors } = convert.parseMcpServersJson(JSON.stringify({
    mcpServers: { codegraph: { command: 'codegraph', args: ['serve', '--mcp'] } },
  }))
  assert.equal(errors.length, 0)
  const s = servers.codegraph
  assert.equal(s.transport, 'stdio')
  assert.equal(s.command, 'codegraph')
  assert.deepEqual(s.args, ['serve', '--mcp'])
})

check('parseMcpServersJson：http（url+headers 含 ${VAR}）', () => {
  const { servers, errors } = convert.parseMcpServersJson(JSON.stringify({
    mcpServers: { anysearch: { url: 'https://api.anysearch.com/mcp', headers: { Authorization: 'Bearer ${ANYSEARCH_API_KEY}' } } },
  }))
  assert.equal(errors.length, 0)
  const s = servers.anysearch
  assert.equal(s.transport, 'streamable-http')
  assert.equal(s.url, 'https://api.anysearch.com/mcp')
  assert.equal(s.headers.Authorization, 'Bearer ${ANYSEARCH_API_KEY}')
})

check('parseMcpServersJson：兼容 type/transport 显式声明', () => {
  const a = convert.parseMcpServersJson(JSON.stringify({ mcpServers: { x: { type: 'stdio', command: 'a' } } })).servers.x
  assert.equal(a.transport, 'stdio')
  const b = convert.parseMcpServersJson(JSON.stringify({ mcpServers: { y: { transport: 'http', url: 'u' } } })).servers.y
  assert.equal(b.transport, 'streamable-http')
})

check('parseMcpServersJson：接受裸 mcpServers 映射（无外层包裹）', () => {
  const { servers, errors } = convert.parseMcpServersJson(JSON.stringify({ github: { command: 'gh' } }))
  assert.equal(errors.length, 0)
  assert.equal(servers.github.transport, 'stdio')
})

check('parseMcpServersJson：坏 JSON / 非法 serverName / 无法推断传输 → 报错不崩溃', () => {
  assert.ok(convert.parseMcpServersJson('{bad').errors.length > 0)
  const badName = convert.parseMcpServersJson(JSON.stringify({ 'my server!': { command: 'x' } }))
  assert.ok(badName.errors.length > 0)
  assert.equal(badName.servers['my server!'], undefined)
  const noTransport = convert.parseMcpServersJson(JSON.stringify({ z: { port: 123 } }))
  assert.ok(noTransport.errors.length > 0)
})

check('hasEnvRef / toJsTemplate / resolveEnvRefs', () => {
  assert.ok(convert.hasEnvRef('Bearer ${ANYSEARCH_API_KEY}'))
  assert.ok(!convert.hasEnvRef('plain text'))
  assert.equal(convert.toJsTemplate('Bearer ${ANYSEARCH_API_KEY}'), '`Bearer ${process.env.ANYSEARCH_API_KEY}`')
  process.env.__DSH_TEST_TOKEN = 'tok-123'
  assert.equal(convert.resolveEnvRefs('Bearer ${__DSH_TEST_TOKEN}'), 'Bearer tok-123')
  delete process.env.__DSH_TEST_TOKEN
  // 缺失的保留占位符原样
  assert.equal(convert.resolveEnvRefs('Bearer ${NOPE_NOPE}'), 'Bearer ${NOPE_NOPE}')
})

check('serversToRows：id 前缀 + dsh-mcp-client 名称 + config 形状', () => {
  const rows = convert.serversToRows({
    codegraph: { serverName: 'codegraph', transport: 'stdio', command: 'codegraph', args: ['a'], env: { K: 'v' } },
    anysearch: { serverName: 'anysearch', transport: 'streamable-http', url: 'u', headers: { Authorization: 'Bearer ${X}' } },
  })
  assert.equal(rows.length, 2)
  const cg = rows.find((r) => r.id === 'mcp-codegraph')
  assert.equal(cg.name, '@deepseek-ai/dsh-mcp-client')
  assert.equal(cg.config.transport, 'stdio')
  assert.equal(cg.config.command, 'codegraph')
  assert.deepEqual(cg.config.args, ['a'])
  const as = rows.find((r) => r.id === 'mcp-anysearch')
  assert.equal(as.config.transport, 'streamable-http')
  assert.equal(as.config.url, 'u')
  // 自定义前缀
  assert.equal(convert.serversToRows({ c: { serverName: 'c', transport: 'stdio', command: 'x' } }, 'projmcp-abc')[0].id, 'projmcp-abc-c')
})

check('serversToPatchYaml：生成 - insert: 块且 ${VAR} → !!js 表达式', () => {
  const yaml = convert.serversToPatchYaml({
    anysearch: { serverName: 'anysearch', transport: 'streamable-http', url: 'https://api.anysearch.com/mcp', headers: { Authorization: 'Bearer ${ANYSEARCH_API_KEY}' } },
    plain: { serverName: 'plain', transport: 'stdio', command: 'echo', args: ['hi'] },
  })
  assert.ok(yaml.includes('- insert:'))
  assert.ok(yaml.includes("id: mcp-anysearch"))
  assert.ok(yaml.includes("name: '@deepseek-ai/dsh-mcp-client'"))
  // 环境变量插值 → !!js 模板表达式（loader 加载时求值）
  assert.ok(yaml.includes("!!js '`Bearer ${process.env.ANYSEARCH_API_KEY}`'"))
  // 无插值的普通字符串保持 JSON 引号形式
  assert.ok(yaml.includes('command: "echo"'))
  assert.ok(yaml.includes('  - "hi"'))
  // 每段 - insert: 块结构完整（两个 server 两段）
  assert.equal(yaml.split('- insert:').length - 1, 2)
})

check('parseMcpServersJson：非字符串 env/headers 值 → 字符串转换 + warnings（不再静默丢弃）', () => {
  const { servers, errors, warnings } = convert.parseMcpServersJson(
    JSON.stringify({
      mcpServers: {
        demo: { command: 'demo', args: [1, 'ok'], env: { PORT: 3000, TOKEN: { bad: 1 }, OK: 'yes' } },
      },
    }),
  )
  assert.equal(errors.length, 0)
  assert.equal(servers.demo.env.PORT, '3000')
  assert.equal(servers.demo.env.OK, 'yes')
  assert.deepEqual(servers.demo.args, ['1', 'ok'])
  assert.ok(warnings.length >= 2, `expected >=2 warnings, got ${warnings.length}`)
  assert.ok(warnings.some((w) => w.includes('PORT')))
  assert.ok(warnings.some((w) => w.includes('TOKEN')))
})

check('toJsTemplate：单引号转义 \\\'，经 YAML 单引号标量翻倍后往返还原（不丢/多引号）', () => {
  // toJsTemplate 输出 JS 转义 \'  → YAML !!js '...' 包装时 '' 翻倍 → YAML 解析回 \' → JS 求值还原 '
  const template = convert.toJsTemplate("a'b ${VAR}")
  assert.ok(template.includes("a\\'b ${process.env.VAR}"), template)
  const yaml = convert.serversToPatchYaml({
    q: { serverName: 'q', transport: 'stdio', command: 'echo', env: { K: "a'b ${VAR}" } },
  })
  // YAML 单引号标量中 '' 是字面 ' 的转义；\ 保持原样 → 最终 JS 表达式含 \'（合法转义）
  assert.ok(yaml.includes("!!js '`a\\''b ${process.env.VAR}`'"), 'yaml scalar keeps escaped quote')
})

// ── project-mcp：工作空间 .dsh/mcps 扫描（根目录先读、子目录覆盖去重） ──────────
await checkAsync('scanWorkspaceMcp：根目录 + 子目录都读，子目录覆盖根目录同名 server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-scan-'))
  try {
    const mk = await import('node:fs/promises')
    // 根目录 mcp.json：codegraph（根）+ anysearch
    await mk.mkdir(join(dir, '.dsh', 'mcps'), { recursive: true })
    await mk.writeFile(
      join(dir, '.dsh', 'mcps', 'mcp.json'),
      JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph-root' }, anysearch: { url: 'http://root' } } }),
    )
    // 子目录 a：覆盖 codegraph（command 变 codegraph-sub）+ 新增 github
    await mk.mkdir(join(dir, '.dsh', 'mcps', 'a'), { recursive: true })
    await mk.writeFile(
      join(dir, '.dsh', 'mcps', 'a', 'mcp.json'),
      JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph-sub' }, github: { command: 'gh' } } }),
    )
    // 子目录 b：新增 exa
    await mk.mkdir(join(dir, '.dsh', 'mcps', 'b'), { recursive: true })
    await mk.writeFile(join(dir, '.dsh', 'mcps', 'b', 'mcp.json'), JSON.stringify({ mcpServers: { exa: { url: 'http://exa' } } }))

    const warnings = []
    const servers = await index.scanWorkspaceMcp(dir, (msg) => warnings.push(msg))
    // 三个来源的 server 都在（根 2 + 子 a 2 + 子 b 1 = 4 个去重后）
    assert.deepEqual(Object.keys(servers).sort(), ['anysearch', 'codegraph', 'exa', 'github'])
    // 子目录覆盖根目录：codegraph 用子目录 a 的 command
    assert.equal(servers.codegraph.command, 'codegraph-sub')
    assert.equal(servers.codegraph.transport, 'stdio')
    // 根目录保留未被覆盖的
    assert.equal(servers.anysearch.url, 'http://root')
    assert.equal(warnings.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('scanWorkspaceMcp：无 .dsh/mcps 目录 → 空；坏 JSON 跳过并告警', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-scan-'))
  try {
    // 无目录 → 空
    assert.deepEqual(await index.scanWorkspaceMcp(dir), {})
    // 坏 JSON → 跳过 + warn
    const mk = await import('node:fs/promises')
    await mk.mkdir(join(dir, '.dsh', 'mcps'), { recursive: true })
    await mk.writeFile(join(dir, '.dsh', 'mcps', 'mcp.json'), '{bad json')
    const warnings = []
    const servers = await index.scanWorkspaceMcp(dir, (msg) => warnings.push(msg))
    assert.deepEqual(servers, {})
    assert.ok(warnings.length > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// 工具级禁用已并入策略层（domain/exposure.ts 的 policyDisablesTool，见 selftest-exposure.mjs）

// ── projectServerName：项目 MCP 的 serverName 加路径哈希前缀（同名不同路径拆成独立服务） ──
check('projectServerName：不同工作区同名 server 得到不同 serverName（哈希后缀隔离）', () => {
  const a = index.projectServerName('C:\\ws-a', 'codegraph')
  const b = index.projectServerName('C:\\ws-b', 'codegraph')
  // 后缀不同 → 不再是同一 server → 各自独立实例，路径参数互不干扰
  assert.notEqual(a, b)
  // 合法 serverName：原名 + '-' + 8 位 hex 后缀，长度 ≤32、字符集合法
  for (const name of [a, b]) {
    assert.ok(/^[A-Za-z0-9_-]{1,23}-[0-9a-f]{8}$/.test(name), `invalid: ${name}`)
    assert.ok(name.length <= 32)
  }
  // 原名前置更可读
  assert.ok(a.startsWith('codegraph-'), `expected name-first form: ${a}`)
  // 确定性：同一工作区恒等
  assert.equal(index.projectServerName('C:\\ws-a', 'codegraph'), a)
  // 长度约束：超长原名的 serverName 截断到 ≤32
  const long = index.projectServerName('C:\\ws-a', 'this-is-a-very-very-very-long-server-name-abcdef')
  assert.ok(long.length <= 32)
})

// ── rc.1 standing 组合 preset 行解析（空面板修复A 回归护栏） ──
check('parsePresetMcpText：抽取 mcp-* 行 serverName/transport/超时 + mcp-anki 例外', () => {
  const text = [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '- id: mcp-filesystem',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: filesystem',
    '    transport: stdio',
    '    command: npx',
    '- id: mcp-anki',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  disabled: true',
    '  config:',
    '    serverName: anki-mcp',
    '    transport: stdio',
    '- id: mcp-mimo-image',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  disabled: true',
    '  config:',
    '    serverName: mimo-image',
    '    transport: stdio',
    '    toolCallTimeoutMs: 300000',
  ].join('\n')
  const parsed = index.parsePresetMcpText(text)
  assert.equal(parsed.size, 3)
  assert.equal(parsed.get('mcp-filesystem').serverName, 'filesystem')
  assert.equal(parsed.get('mcp-filesystem').transport, 'stdio')
  assert.equal(parsed.get('mcp-anki').serverName, 'anki-mcp')
  assert.equal(parsed.get('mcp-mimo-image').toolCallTimeoutMs, 300000)
  // 非 mcp-* 行不收录
  assert.equal(parsed.get('persona'), undefined)
})

check('parsePresetMcpText：缺 serverName 键时回落（mcp-anki→anki-mcp，其余去前缀）', () => {
  const text = '- id: mcp-anki\n  name: x\n- id: mcp-foo\n  name: x\n  config:\n    transport: stdio\n'
  const parsed = index.parsePresetMcpText(text)
  assert.equal(parsed.get('mcp-anki').serverName, 'anki-mcp')
  assert.equal(parsed.get('mcp-foo').serverName, 'foo')
})

check('parsePresetMcpText：引号值去引号 + transport 缺席为 null', () => {
  const text = '- id: mcp-q\n  name: x\n  config:\n    serverName: "quoted-srv"\n    transport: "stdio"\n- id: mcp-notransport\n  name: x\n  config:\n    serverName: plain-srv\n'
  const parsed = index.parsePresetMcpText(text)
  assert.equal(parsed.get('mcp-q').serverName, 'quoted-srv')
  assert.equal(parsed.get('mcp-q').transport, 'stdio')
  assert.equal(parsed.get('mcp-notransport').transport, null)
})

if (failed) {
  console.log('\nselftest: FAILED')
  process.exit(1)
}
console.log('\nselftest-mcp: all checks passed')
