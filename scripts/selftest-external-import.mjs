// 外部 agent 配置导入自测：形态嗅探 + 字段归一化 + 内置源清单。
// 语料取自本机真实文件结构（opencode.json / .zcode/cli/config.json）与常见 harness 形态。
// 用法：node scripts/selftest-external-import.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const imp = await import(pathToFileURL(join(root, 'lib', 'external-import.js')).href)

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

const byName = (result, name) => result.servers.find((s) => s.name === name)

/* ── 形态嗅探 ─────────────────────────────────────────────────────── */

check('opencode：mcp 映射 + type local/remote + command 数组 + environment', () => {
  const text = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    agent: { build: {} },
    mcp: {
      'brave-search': {
        type: 'local',
        command: ['npx', '-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
        enabled: true,
      },
      remoteone: { type: 'remote', url: 'https://example.com/mcp', enabled: true, headers: { Authorization: 'Bearer x' } },
    },
  })
  const result = imp.parseExternalMcpConfig(text)
  assert.equal(result.format, 'opencode')
  const local = byName(result, 'brave-search')
  assert.equal(local.config.transport, 'stdio')
  assert.equal(local.config.command, 'npx')
  assert.deepEqual(local.config.args, ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'])
  assert.ok(local.notes.some((n) => n.includes('command 数组')))
  const remote = byName(result, 'remoteone')
  assert.equal(remote.config.transport, 'streamable-http')
  assert.equal(remote.config.url, 'https://example.com/mcp')
  assert.deepEqual(remote.config.headers, { Authorization: 'Bearer x' })
  assert.ok(remote.notes.some((n) => n.includes('remote')))
})

check('zcode：mcp.servers + type stdio/remote + environment → env', () => {
  const text = JSON.stringify({
    plugins: {},
    mcp: {
      servers: {
        dbhub: {
          enabled: true,
          type: 'stdio',
          command: 'node',
          args: ['/opt/dbhub/server.js', '--config', '/opt/dbhub.toml'],
          environment: { DBHUB_DSN: 'postgres://root@localhost:5256/db' },
        },
        Tabby: { type: 'remote', url: 'http://localhost:3001/sse', enabled: false },
      },
    },
  })
  const result = imp.parseExternalMcpConfig(text)
  assert.equal(result.format, 'zcode')
  const dbhub = byName(result, 'dbhub')
  assert.equal(dbhub.config.command, 'node')
  assert.equal(dbhub.config.args.length, 3)
  assert.deepEqual(dbhub.config.env, { DBHUB_DSN: 'postgres://root@localhost:5256/db' })
  assert.ok(dbhub.notes.some((n) => n.includes('environment')))
  const tabby = byName(result, 'Tabby')
  assert.equal(tabby.enabled, false, 'enabled: false 应被标注')
  assert.ok(tabby.notes.some((n) => n.includes('enabled: false')))
})

check('Claude Code：mcpServers + env + ${VAR} 占位原样保留', () => {
  const text = JSON.stringify({
    mcpServers: {
      exa: { command: 'npx', args: ['-y', 'exa-mcp'], env: { EXA_API_KEY: '${EXA_KEY}' } },
      remote: { type: 'http', url: 'https://api.example.com/mcp' },
    },
  })
  const result = imp.parseExternalMcpConfig(text)
  assert.equal(result.format, 'mcpServers')
  assert.deepEqual(byName(result, 'exa').config.env, { EXA_API_KEY: '${EXA_KEY}' })
  assert.equal(byName(result, 'remote').config.transport, 'streamable-http')
})

check('VS Code：servers 键', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ servers: { vsc: { type: 'stdio', command: 'mcp-server' } } }))
  assert.equal(result.format, 'vscode')
  assert.equal(byName(result, 'vsc').config.transport, 'stdio')
})

check('裸映射：直接给名字 → 配置', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ myserver: { command: 'node', args: ['x.js'] } }))
  assert.equal(result.format, 'bare')
  assert.equal(byName(result, 'myserver').config.command, 'node')
})

/* ── 边界与错误 ───────────────────────────────────────────────────── */

check('坏 JSON：报解析错误且不抛异常', () => {
  const result = imp.parseExternalMcpConfig('{ not json')
  assert.equal(result.servers.length, 0)
  assert.ok(result.errors[0].startsWith('JSON 解析失败'))
})

check('非 MCP 配置（如只有 settings）：明确报「未找到」而不是当成服务器', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ theme: 'dark', fontSize: 12 }))
  assert.equal(result.format, undefined)
  assert.equal(result.servers.length, 0)
  assert.ok(result.errors[0].includes('未找到 MCP 配置'))
})

check('非法 serverName：逐条报错但不影响其它项', () => {
  const result = imp.parseExternalMcpConfig(
    JSON.stringify({ mcpServers: { 'bad name!': { command: 'x' }, good: { command: 'y' } } }),
  )
  assert.equal(result.format, 'mcpServers')
  assert.ok(result.errors.some((e) => e.includes('bad name!')))
  assert.equal(byName(result, 'good').config.command, 'y')
})

check('空 mcp 映射：视为未找到（避免把空对象当源）', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcp: {} }))
  assert.equal(result.servers.length, 0)
  assert.ok(result.errors.length > 0)
})

check('缺少 env/auth 的 remote：url 保留，headers 缺省为空对象', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcp: { r: { type: 'remote', url: 'http://x/mcp' } } }))
  assert.deepEqual(byName(result, 'r').config.headers, {})
})

check('command 数组只有一个元素：无 args', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcp: { one: { type: 'local', command: ['solo'] } } }))
  assert.equal(byName(result, 'one').config.command, 'solo')
  assert.deepEqual(byName(result, 'one').config.args, [])
})

check('command 数组元素含非字符串：只取字符串项', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcp: { mixed: { type: 'local', command: ['cmd', 42, 'arg'] } } }))
  const config = byName(result, 'mixed').config
  assert.equal(config.command, 'cmd')
  assert.deepEqual(config.args, ['arg'])
})

check('enabled 字段不会泄漏进归一化配置', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcp: { a: { type: 'local', command: ['x'], enabled: true } } }))
  assert.ok(!('enabled' in byName(result, 'a').config))
})

check('结果按名字排序（面板列表稳定）', () => {
  const result = imp.parseExternalMcpConfig(JSON.stringify({ mcpServers: { zeta: { command: 'z' }, alpha: { command: 'a' } } }))
  assert.deepEqual(result.servers.map((s) => s.name), ['alpha', 'zeta'])
})

/* ── 内置源清单 ───────────────────────────────────────────────────── */

check('knownMcpSources：含 opencode/zcode，项目源仅在给了工作空间时出现', () => {
  const withoutWorkspace = imp.knownMcpSources({ home: '/home/u' })
  const ids = withoutWorkspace.map((s) => s.id)
  assert.ok(ids.includes('opencode'))
  assert.ok(ids.includes('zcode'))
  assert.ok(!ids.includes('claude-project'))
  assert.equal(withoutWorkspace.find((s) => s.id === 'opencode').path, '/home/u/.config/opencode/opencode.json')
  assert.equal(withoutWorkspace.find((s) => s.id === 'zcode').path, '/home/u/.zcode/cli/config.json')
  assert.equal(withoutWorkspace.find((s) => s.id === 'codex').supported, false)

  const withWorkspace = imp.knownMcpSources({ home: '/home/u', workspace: '/proj/x' })
  const projectIds = withWorkspace.map((s) => s.id)
  assert.ok(projectIds.includes('claude-project'))
  assert.ok(projectIds.includes('vscode-project'))
  assert.equal(withWorkspace.find((s) => s.id === 'claude-project').path, '/proj/x/.mcp.json')
  assert.equal(withWorkspace.find((s) => s.id === 'vscode-project').path, '/proj/x/.vscode/mcp.json')
})

check('knownMcpSources：home 末尾斜杠被归一', () => {
  const sources = imp.knownMcpSources({ home: '/home/u/' })
  assert.equal(sources.find((s) => s.id === 'opencode').path, '/home/u/.config/opencode/opencode.json')
})

check('describeImportedServer：stdio 与 http 各一句', () => {
  const stdio = { name: 'a', config: { serverName: 'a', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }, enabled: true, notes: [] }
  const http = { name: 'b', config: { serverName: 'b', transport: 'streamable-http', url: 'http://x/mcp' }, enabled: true, notes: [] }
  assert.equal(imp.describeImportedServer(stdio), 'stdio: npx -y pkg')
  assert.equal(imp.describeImportedServer(http), 'http: http://x/mcp')
})

if (failed) process.exit(1)
console.log('\nselftest-external-import: all checks passed')
