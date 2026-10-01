// 组合文件文本操作自测：行块定位 / 删除 / config 键读取与替换 / 缩进行标志。
// 走独立构建产物 lib/composition-file.js（纯逻辑，无框架依赖）。
// 用法：node scripts/selftest-composition-file.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cf = await import(pathToFileURL(join(root, 'lib', 'composition-file.js')).href)

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

/** profile patch 形态：每个 server 一个 `- insert:` 块（4 空格缩进的行 id）。 */
const PATCH = [
  '# 用户 patch 层',
  '- insert:',
  '    - id: mcp-Tabby',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        transport: "streamable-http"',
  '        serverName: "Tabby"',
  '        url: "http://localhost:3001/mcp"',
  '- insert:',
  '    - id: mcp-brave-search',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        transport: "stdio"',
  '        serverName: "brave-search"',
  '        command: "npx"',
  '        args:',
  '          - "-y"',
  '          - "@brave/brave-search-mcp-server"',
  '# dsh-mcp-manager:server:mcp-dbhub',
  '- insert:',
  '    - id: mcp-dbhub',
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        transport: "stdio"',
  '        serverName: "dbhub"',
  '        command: "node"',
  '- id: skill-hub',
  '  disabled: false',
].join('\n')

/** preset 组合形态：顶层 `- id:`。 */
const PRESET = [
  '- id: mcp-filesystem',
  "  name: '@deepseek-ai/dsh-mcp-client'",
  '  disabled: true',
  '  config:',
  '    transport: "stdio"',
  '    serverName: "filesystem"',
  '    command: "npx"',
  '- id: other-plugin',
  '  name: some-plugin',
].join('\n')

/* ── 行块定位 ─────────────────────────────────────────────────────── */

check('findRowBlock：patch 文件的缩进行 + 父 insert 块', () => {
  const block = cf.findRowBlock(PATCH, 'mcp-Tabby')
  assert.equal(block.indent, 4)
  assert.equal(block.blockIndent, 0)
  assert.equal(block.blockHead, 1, '父块头应为第 2 行（- insert:）')
  assert.equal(block.sibling, false, '一个 insert 块只有一个子项')
  assert.equal(PATCH.split('\n')[block.endLine].trim(), 'url: "http://localhost:3001/mcp"')
})

check('findRowBlock：普通键值行（如 name）不算块尾边界', () => {
  const block = cf.findRowBlock(PATCH, 'mcp-brave-search')
  assert.equal(PATCH.split('\n')[block.endLine].trim(), '- "@brave/brave-search-mcp-server"')
  assert.equal(block.sibling, false)
})

check('findRowBlock：顶层行（preset 形态）无父块', () => {
  const block = cf.findRowBlock(PRESET, 'mcp-filesystem')
  assert.equal(block.indent, 0)
  assert.equal(block.blockHead, -1)
  assert.equal(PRESET.split('\n')[block.endLine].trim(), 'command: "npx"')
})

check('findRowBlock：不存在的行返回 undefined', () => {
  assert.equal(cf.findRowBlock(PATCH, 'mcp-nope'), undefined)
})

check('findRowBlock：多行 insert 块内视为有兄弟项', () => {
  const multi = ['- insert:', '    - id: mcp-a', '      config:', '        x: 1', '    - id: mcp-b', '      config:', '        y: 2'].join('\n')
  const a = cf.findRowBlock(multi, 'mcp-a')
  assert.equal(a.sibling, true)
  assert.equal(multi.split('\n')[a.endLine].trim(), 'x: 1', '块尾应止于下一个兄弟项之前')
})

/* ── 删除 ─────────────────────────────────────────────────────────── */

check('removeRowBlock：连父 insert 块一起删，且不动其它块', () => {
  const { text, removed } = cf.removeRowBlock(PATCH, 'mcp-Tabby')
  assert.equal(removed, true)
  assert.ok(!text.includes('mcp-Tabby'))
  assert.ok(!text.includes('http://localhost:3001/mcp'))
  assert.ok(text.includes('mcp-brave-search'), '其它块保留')
  assert.ok(text.includes('- id: skill-hub'), '顶层行保留')
  const inserts = (s) => (s.match(/^- insert:$/gm) || []).length
  assert.equal(inserts(PATCH), 3)
  assert.equal(inserts(text), 2, '被删行独占的 insert 头应一并消失')
})

check('removeRowBlock：删除带归属注释的块时注释一并清理', () => {
  const { text } = cf.removeRowBlock(PATCH, 'mcp-dbhub')
  assert.ok(!text.includes('mcp-dbhub'))
  assert.ok(!text.includes('dsh-mcp-manager:server:mcp-dbhub'), '归属注释应被清理')
})

check('removeRowBlock：保留无关注释（分区标题等）', () => {
  const { text } = cf.removeRowBlock(PATCH, 'mcp-Tabby')
  assert.ok(text.includes('# 用户 patch 层'))
})

check('removeRowBlock：preset 形态删单个顶层行', () => {
  const { text, removed } = cf.removeRowBlock(PRESET, 'mcp-filesystem')
  assert.equal(removed, true)
  assert.ok(!text.includes('mcp-filesystem'))
  assert.ok(text.includes('other-plugin'))
})

check('removeRowBlock：多行 insert 块内只删自己那一项', () => {
  const multi = ['- insert:', '    - id: mcp-a', '      config:', '        x: 1', '    - id: mcp-b', '      config:', '        y: 2'].join('\n')
  const { text } = cf.removeRowBlock(multi, 'mcp-a')
  assert.ok(!text.includes('mcp-a'))
  assert.ok(text.includes('mcp-b'))
  assert.ok(text.includes('- insert:'), '父块因还有兄弟项而保留')
})

check('removeRowBlock：行不存在时 removed=false 且文本不变', () => {
  const { text, removed } = cf.removeRowBlock(PATCH, 'mcp-nope')
  assert.equal(removed, false)
  assert.equal(text, PATCH)
})

check('removeRowBlock：CRLF 文件保持 CRLF', () => {
  const crlf = PATCH.replace(/\n/g, '\r\n')
  const { text } = cf.removeRowBlock(crlf, 'mcp-Tabby')
  assert.ok(text.includes('\r\n'))
  assert.ok(!text.includes('\n\n'), '不应出现独立 LF')
})

check('removeRowBlock：不留连续空行', () => {
  const withBlanks = ['- insert:', '    - id: mcp-x', '      config:', '        a: 1', '', '', '- insert:', '    - id: mcp-y', '      config:', '        b: 2'].join('\n')
  const { text } = cf.removeRowBlock(withBlanks, 'mcp-x')
  assert.ok(!/\n\s*\n\s*\n/.test(text), `不应有 2 个以上连续空行：${JSON.stringify(text)}`)
})

/* ── config 读取与替换 ───────────────────────────────────────────── */

check('readConfigBlock：解析顶层键与嵌套序列', () => {
  const config = cf.readConfigBlock(PATCH, 'mcp-brave-search')
  assert.deepEqual(config.keys.map((k) => k.name), ['transport', 'serverName', 'command', 'args'])
  const args = config.keys.find((k) => k.name === 'args')
  assert.equal(args.lines.length, 3, 'args 应含键行 + 两个序列项')
  assert.equal(args.dynamic, false)
})

check('readConfigBlock：!!js 值标记为 dynamic', () => {
  const text = [
    '- id: mcp-x',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    transport: "stdio"',
    '    serverName: "x"',
    "    env:",
    "      TOKEN: !!js '`${process.env.TOKEN}`'",
    '    cwd: "/tmp"',
  ].join('\n')
  const config = cf.readConfigBlock(text, 'mcp-x')
  assert.equal(config.keys.find((k) => k.name === 'env').dynamic, true)
  assert.equal(config.keys.find((k) => k.name === 'cwd').dynamic, false)
  assert.ok(cf.rowHasDynamic(text, 'mcp-x'))
  assert.ok(!cf.rowHasDynamic(PATCH, 'mcp-brave-search'))
})

check('readConfigBlock：内联 config 无可解析键', () => {
  const text = ['- id: mcp-x', '  config: { transport: "stdio" }'].join('\n')
  const config = cf.readConfigBlock(text, 'mcp-x')
  assert.equal(config.keys.length, 0)
})

check('replaceRowConfig：替换普通键、保留 dynamic 键原文', () => {
  const text = [
    '- id: mcp-x',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    transport: "stdio"',
    '    serverName: "x"',
    "    env:",
    "      TOKEN: !!js '`${process.env.TOKEN}`'",
    '    command: "old"',
    '- id: mcp-y',
    '  config:',
    '    serverName: "y"',
  ].join('\n')
  const config = cf.readConfigBlock(text, 'mcp-x')
  const keepDynamic = config.keys.filter((k) => k.dynamic).map((k) => ({ name: k.name, body: cf.dedentLines(k.lines) }))
  const { text: next, changed } = cf.replaceRowConfig(text, 'mcp-x', [
    { name: 'transport', body: ['transport: "streamable-http"'] },
    { name: 'serverName', body: ['serverName: "x"'] },
    { name: 'url', body: ['url: "http://localhost:9999/mcp"'] },
    ...keepDynamic,
  ])
  assert.equal(changed, true)
  assert.ok(next.includes('transport: "streamable-http"'))
  assert.ok(next.includes('url: "http://localhost:9999/mcp"'))
  assert.ok(!next.includes('command: "old"'), '未列出的旧键应被移除')
  assert.ok(next.includes("TOKEN: !!js '`${process.env.TOKEN}`'"), 'dynamic 键原文保留')
  assert.ok(next.includes('- id: mcp-y') && next.includes('serverName: "y"'), '其它行不受影响')
})

check('replaceRowConfig：保持缩进风格（子键 = config 缩进 + 2）', () => {
  const { text: next } = cf.replaceRowConfig(PATCH, 'mcp-Tabby', [{ name: 'transport', body: ['transport: "stdio"'] }])
  assert.ok(next.includes('\n        transport: "stdio"'))
})

check('replaceRowConfig：行或 config 不存在时 changed=false', () => {
  assert.equal(cf.replaceRowConfig(PATCH, 'mcp-nope', [{ name: 'a', body: ['a: 1'] }]).changed, false)
  const inline = ['- id: mcp-x', '  config: { a: 1 }'].join('\n')
  assert.equal(cf.replaceRowConfig(inline, 'mcp-x', [{ name: 'a', body: ['a: 2'] }]).changed, false)
})

/* ── 缩进行标志（disabled 物化） ─────────────────────────────────── */

check('setRowFlagAt：patch 缩进行插入 / 反转 / 移除', () => {
  const added = cf.setRowFlagAt(PATCH, 'mcp-Tabby', 'disabled', true)
  assert.ok(added.includes('\n      disabled: true'), '标志使用 id 行缩进 + 2')
  assert.equal(cf.rowFlagAt(added, 'mcp-Tabby', 'disabled'), true)
  assert.equal(cf.rowFlagAt(added, 'mcp-brave-search', 'disabled'), null, '其它行不受影响')

  const removed = cf.setRowFlagAt(added, 'mcp-Tabby', 'disabled', false)
  assert.equal(cf.rowFlagAt(removed, 'mcp-Tabby', 'disabled'), null)
  assert.equal(cf.setRowFlagAt(removed, 'mcp-Tabby', 'disabled', false), removed, '移除幂等')

  const once = cf.setRowFlagAt(PATCH, 'mcp-Tabby', 'disabled', true)
  assert.equal(cf.setRowFlagAt(once, 'mcp-Tabby', 'disabled', true), once, '重复置 true 幂等')
})

check('setRowFlagAt：已有 disabled: false 时反转为 true', () => {
  const text = ['- insert:', '    - id: mcp-x', '      disabled: false', '      config:', '        a: 1'].join('\n')
  const next = cf.setRowFlagAt(text, 'mcp-x', 'disabled', true)
  assert.equal(cf.rowFlagAt(next, 'mcp-x', 'disabled'), true)
  assert.ok(!next.includes('disabled: false'))
})

check('setRowFlagAt / rowFlagAt：preset 形态（无缩进）同样工作', () => {
  const added = cf.setRowFlagAt(PRESET, 'other-plugin', 'disabled', true)
  assert.ok(added.includes('\n  disabled: true'))
  assert.equal(cf.rowFlagAt(added, 'other-plugin', 'disabled'), true)
  assert.equal(cf.rowFlagAt(PRESET, 'mcp-filesystem', 'disabled'), true, '读取既有标志')
  assert.equal(cf.rowFlagAt(PRESET, 'nope', 'disabled'), null)
})

check('setRowFlagAt：行不存在时抛错（调用方需感知）', () => {
  assert.throws(() => cf.setRowFlagAt(PATCH, 'mcp-nope', 'disabled', true), /not found/)
})

check('setRowFlagAt：CRLF 文件往返保持 CRLF 且逐字节还原（原 smoke.mjs 场景）', () => {
  const crlf = PATCH.replace(/\n/g, '\r\n')
  const disabled = cf.setRowFlagAt(crlf, 'mcp-Tabby', 'disabled', true)
  assert.equal(cf.rowFlagAt(disabled, 'mcp-Tabby', 'disabled'), true, 'CRLF 下禁用生效')
  assert.ok(disabled.includes('\r\n'), 'CRLF 应保持')
  assert.equal(cf.rowFlagAt(disabled, 'mcp-brave-search', 'disabled'), null, '其它行不受影响')
  const restored = cf.setRowFlagAt(disabled, 'mcp-Tabby', 'disabled', false)
  assert.equal(restored, crlf, '恢复后应与原文逐字节一致')
})

/* ── dedentLines ─────────────────────────────────────────────────── */

check('dedentLines：去掉公共缩进并忽略空行', () => {
  assert.deepEqual(cf.dedentLines(['    a: 1', '      - x', '', '    b: 2']), ['a: 1', '  - x', '', 'b: 2'])
  assert.deepEqual(cf.dedentLines(['a: 1']), ['a: 1'])
  assert.deepEqual(cf.dedentLines([]), [])
})

if (failed) process.exit(1)
console.log('\nselftest-composition-file: all checks passed')
