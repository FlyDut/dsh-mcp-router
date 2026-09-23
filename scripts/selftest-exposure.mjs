// 领域纯逻辑自测：曝光档位（exposure）/ 预设关联隔离（presetAllows）/ v1→v2 策略迁移。
// 走独立构建产物 lib/exposure.js（无框架依赖），是「四档 × 预设隔离」语义的回归护栏。
// 用法：node scripts/selftest-exposure.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const x = await import(pathToFileURL(join(root, 'lib', 'exposure.js')).href)

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

/* ── 档位与预设模式的合法性 ───────────────────────────────────────────── */

check('isExposure：四档合法，其余非法', () => {
  for (const value of ['native', 'name-only', 'hidden', 'off']) assert.ok(x.isExposure(value), value)
  for (const value of ['', 'NATIVE', 'auto', null, undefined, 3, {}]) assert.ok(!x.isExposure(value), String(value))
})

check('isPresetMode：三模式合法，其余非法', () => {
  for (const value of ['all', 'only', 'except']) assert.ok(x.isPresetMode(value), value)
  for (const value of ['', 'ALL', 'none', null, 1]) assert.ok(!x.isPresetMode(value), String(value))
})

/* ── 策略规范化（宽容解析，绝不因坏数据抛错）─────────────────────────── */

check('defaultPolicy：默认原生注入 + 全部预设 + 无禁用工具', () => {
  assert.deepEqual(x.defaultPolicy(), { exposure: 'native', presets: { mode: 'all', ids: [] }, disabledTools: [] })
  assert.equal(x.defaultPolicy('hidden').exposure, 'hidden')
})

check('normalizePolicy：非法输入回落默认；fallbackExposure 生效', () => {
  assert.deepEqual(x.normalizePolicy(undefined), x.defaultPolicy())
  assert.deepEqual(x.normalizePolicy(null, 'hidden'), x.defaultPolicy('hidden'))
  assert.equal(x.normalizePolicy({ exposure: 'bogus' }).exposure, 'native')
  assert.equal(x.normalizePolicy({ exposure: 'bogus' }, 'off').exposure, 'off')
})

check('normalizePolicy：ids 去重/去空/排序；mode=all 时清单清空', () => {
  const p = x.normalizePolicy({ exposure: 'name-only', presets: { mode: 'only', ids: ['b', 'a', 'b', '', 7, ' a '] } })
  assert.deepEqual(p.presets, { mode: 'only', ids: ['a', 'b'] })
  const all = x.normalizePolicy({ presets: { mode: 'all', ids: ['x'] } })
  assert.deepEqual(all.presets, { mode: 'all', ids: [] })
})

check('normalizePolicy：disabledTools 仅保留非空字符串并去重排序', () => {
  const p = x.normalizePolicy({ disabledTools: ['mcp__a__z', 'mcp__a__z', '', 5, 'mcp__a__b'] })
  assert.deepEqual(p.disabledTools, ['mcp__a__b', 'mcp__a__z'])
})

/* ── 预设关联判定（运行时隔离核心）──────────────────────────────────── */

const policy = (scope) => x.normalizePolicy({ presets: scope })

check('presetAllows：all 对所有会话（含无 preset）开放', () => {
  const p = policy({ mode: 'all' })
  assert.ok(x.presetAllows(p.presets, 'coding'))
  assert.ok(x.presetAllows(p.presets, undefined))
  assert.ok(x.presetAllows(p.presets, null))
})

check('presetAllows：only 仅名单内；无 preset 会话不可用', () => {
  const p = policy({ mode: 'only', ids: ['coding'] })
  assert.ok(x.presetAllows(p.presets, 'coding'))
  assert.ok(!x.presetAllows(p.presets, 'standard'))
  assert.ok(!x.presetAllows(p.presets, undefined))
  assert.ok(!x.presetAllows(p.presets, null))
})

check('presetAllows：except 排除名单内；无 preset 会话可用', () => {
  const p = policy({ mode: 'except', ids: ['coding'] })
  assert.ok(!x.presetAllows(p.presets, 'coding'))
  assert.ok(x.presetAllows(p.presets, 'standard'))
  assert.ok(x.presetAllows(p.presets, undefined))
  assert.ok(x.presetAllows(p.presets, null))
})

check('presetAllows：only 空名单 = 对所有会话不可用；except 空名单 = 全开放', () => {
  assert.ok(!x.presetAllows(policy({ mode: 'only', ids: [] }).presets, 'coding'))
  assert.ok(!x.presetAllows(policy({ mode: 'only', ids: [] }).presets, undefined))
  assert.ok(x.presetAllows(policy({ mode: 'except', ids: [] }).presets, 'coding'))
})

/* ── 档位 → 进程期望状态 ─────────────────────────────────────────────── */

check('desiredRunning：native/name-only 运行，hidden/off 停用', () => {
  assert.equal(x.desiredRunning('native'), true)
  assert.equal(x.desiredRunning('name-only'), true)
  assert.equal(x.desiredRunning('hidden'), false)
  assert.equal(x.desiredRunning('off'), false)
})

/* ── 有效曝光判定（真值表）─────────────────────────────────────────── */

const decide = (exposure, running, aiActive, presetId, scope = { mode: 'all' }) =>
  x.decideExposure({ policy: x.normalizePolicy({ exposure, presets: scope }), running, aiActive, presetId })

check('decideExposure：native 运行中 → native（原生注入）', () => {
  assert.equal(decide('native', true, false, 'coding'), 'native')
})

check('decideExposure：native 未运行 / AI 保活中 → 降级 hidden（仍可 dsh_mcp_call）', () => {
  assert.equal(decide('native', false, false, 'coding'), 'hidden')
  assert.equal(decide('native', true, true, 'coding'), 'hidden')
})

check('decideExposure：name-only 运行中 → name-only；未运行 → hidden', () => {
  assert.equal(decide('name-only', true, false, 'coding'), 'name-only')
  assert.equal(decide('name-only', false, false, 'coding'), 'hidden')
  assert.equal(decide('name-only', true, true, 'coding'), 'hidden')
})

check('decideExposure：hidden 恒定 hidden（与运行态无关，保活中也不变）', () => {
  assert.equal(decide('hidden', false, false, 'coding'), 'hidden')
  assert.equal(decide('hidden', true, false, 'coding'), 'hidden')
  assert.equal(decide('hidden', true, true, 'coding'), 'hidden')
})

check('decideExposure：off 恒定 off（运行时也不可调用）', () => {
  assert.equal(decide('off', false, false, 'coding'), 'off')
  assert.equal(decide('off', true, true, 'coding'), 'off')
})

check('decideExposure：预设隔离优先于一切档位（含 native 运行中）', () => {
  const only = { mode: 'only', ids: ['coding'] }
  assert.equal(decide('native', true, false, 'standard', only), 'off')
  assert.equal(decide('name-only', true, false, undefined, only), 'off')
  assert.equal(decide('hidden', true, false, 'standard', only), 'off')
  assert.equal(decide('native', true, false, 'coding', only), 'native')
})

check('decideExposure：except 模式下被排除的预设不可用，其他可用', () => {
  const except = { mode: 'except', ids: ['coding'] }
  assert.equal(decide('native', true, false, 'coding', except), 'off')
  assert.equal(decide('native', true, false, 'standard', except), 'native')
  assert.equal(decide('native', true, false, undefined, except), 'native')
})

/* ── 档位派生语义 ───────────────────────────────────────────────────── */

check('injectionOf / injectsTools：仅 native 注入工具', () => {
  assert.equal(x.injectionOf('native'), 'tools')
  assert.equal(x.injectionOf('name-only'), 'name')
  assert.equal(x.injectionOf('hidden'), 'none')
  assert.equal(x.injectionOf('off'), 'none')
  assert.deepEqual(['native', 'name-only', 'hidden', 'off'].map(x.injectsTools), [true, false, false, false])
})

check('callableUnder：off 不可调用，其余可调用', () => {
  assert.deepEqual(['native', 'name-only', 'hidden', 'off'].map(x.callableUnder), [true, true, true, false])
})

check('listedInSummary：native/name-only 进摘要表，hidden/off 不进', () => {
  assert.deepEqual(['native', 'name-only', 'hidden', 'off'].map(x.listedInSummary), [true, true, false, false])
})

check('policyDisablesTool：全名精确匹配；空策略不算禁用', () => {
  const p = x.normalizePolicy({ disabledTools: ['mcp__a__b'] })
  assert.ok(x.policyDisablesTool(p, 'mcp__a__b'))
  assert.ok(!x.policyDisablesTool(p, 'mcp__a__c'))
  assert.ok(!x.policyDisablesTool(undefined, 'mcp__a__b'))
  assert.ok(!x.policyDisablesTool(x.defaultPolicy(), 'mcp__a__b'))
})

/* ── v1 → v2 迁移 ───────────────────────────────────────────────────── */

const resolveRow = (file, rowId) => {
  if (rowId === 'mcp-anki') return 'anki-mcp'
  if (rowId === 'mcp-unknown-orphan') return undefined
  return rowId.replace(/^mcp-/, '')
}

check('hasV1PolicyData：任一 v1 字段非空即需要迁移', () => {
  assert.ok(!x.hasV1PolicyData({}))
  assert.ok(!x.hasV1PolicyData({ mcp: {}, toolDisabled: {} }))
  assert.ok(x.hasV1PolicyData({ toolDisabled: { a: ['x'] } }))
  assert.ok(x.hasV1PolicyData({ projectMcp: { '/ws': { s: true } } }))
  assert.ok(x.hasV1PolicyData({ mcp: { '/p.yml': { 'mcp-a': { desired: true } } } }))
})

check('migrateV1Policies：autoManage=true 时停用态迁移为 hidden，启用态为 native', () => {
  const result = x.migrateV1Policies(
    { mcp: { '/p.yml': { 'mcp-a': { desired: true }, 'mcp-b': { desired: false } } } },
    resolveRow,
    true,
  )
  assert.equal(result.servers.a.exposure, 'hidden')
  assert.equal(result.servers.b.exposure, 'native')
  assert.equal(result.migrated, 2)
  assert.deepEqual(result.unresolved, [])
})

check('migrateV1Policies：autoManage=false 时停用态迁移为 off（旧版无中间层）', () => {
  const result = x.migrateV1Policies({ mcp: { '/p.yml': { 'mcp-a': { desired: true } } } }, resolveRow, false)
  assert.equal(result.servers.a.exposure, 'off')
})

check('migrateV1Policies：rowId → serverName 走解析器（mcp-anki 例外）', () => {
  const result = x.migrateV1Policies(
    { mcp: { '/p.yml': { 'mcp-anki': { desired: true }, 'mcp-filesystem': { desired: false } } } },
    resolveRow,
    true,
  )
  assert.equal(result.servers['anki-mcp'].exposure, 'hidden')
  assert.equal(result.servers.filesystem.exposure, 'native')
})

check('migrateV1Policies：解析不到 serverName 的行进入 unresolved（不静默丢弃）', () => {
  const result = x.migrateV1Policies(
    { mcp: { '/p.yml': { 'mcp-unknown-orphan': { desired: true }, 'mcp-ok': { desired: true } } } },
    resolveRow,
    true,
  )
  assert.deepEqual(result.unresolved, ['/p.yml:mcp-unknown-orphan'])
  assert.equal(result.servers.ok.exposure, 'hidden')
})

check('migrateV1Policies：项目级启停迁移到 projects 分区', () => {
  const result = x.migrateV1Policies(
    { projectMcp: { '/ws-a': { 'srv-1': true, 'srv-2': false } } },
    resolveRow,
    true,
  )
  assert.equal(result.projects['/ws-a']['srv-1'].exposure, 'hidden')
  assert.equal(result.projects['/ws-a']['srv-2'].exposure, 'native')
  assert.equal(result.migrated, 2)
})

check('migrateV1Policies：工具级禁用（全局 + 项目）合并进对应策略', () => {
  const result = x.migrateV1Policies(
    {
      toolDisabled: { exa: ['mcp__exa__b', 'mcp__exa__a'] },
      projectToolDisabled: { '/ws-a': { 'proj-1': ['mcp__proj-1__x'] } },
    },
    resolveRow,
    true,
  )
  assert.deepEqual(result.servers.exa.disabledTools, ['mcp__exa__a', 'mcp__exa__b'])
  assert.deepEqual(result.projects['/ws-a']['proj-1'].disabledTools, ['mcp__proj-1__x'])
})

check('migrateV1Policies：启停与工具禁用合并到同一策略（不互相覆盖）', () => {
  const result = x.migrateV1Policies(
    {
      mcp: { '/p.yml': { 'mcp-exa': { desired: true } } },
      toolDisabled: { exa: ['mcp__exa__a'] },
    },
    resolveRow,
    true,
  )
  assert.equal(result.servers.exa.exposure, 'hidden')
  assert.deepEqual(result.servers.exa.disabledTools, ['mcp__exa__a'])
})

check('migrateV1Policies：缺 desired / 非法值不产生条目；重复调用结果稳定', () => {
  const source = { mcp: { '/p.yml': { 'mcp-a': {}, 'mcp-b': { desired: 'yes' } } } }
  const first = x.migrateV1Policies(source, resolveRow, true)
  assert.deepEqual(first.servers, {})
  assert.equal(first.migrated, 0)
  const again = x.migrateV1Policies(source, resolveRow, true)
  assert.deepEqual(again, first)
})

check('migrateV1Policies：输出按键排序（落盘 diff 稳定）', () => {
  const result = x.migrateV1Policies(
    { mcp: { '/p.yml': { 'mcp-z': { desired: true }, 'mcp-a': { desired: true }, 'mcp-m': { desired: true } } } },
    resolveRow,
    true,
  )
  assert.deepEqual(Object.keys(result.servers), ['a', 'm', 'z'])
})

check('migrateV1Policies：空 v1 输入 → 空输出（幂等起点）', () => {
  const result = x.migrateV1Policies({}, resolveRow, true)
  assert.deepEqual(result, { servers: {}, projects: {}, migrated: 0, unresolved: [] })
})

/* ── 工具级批量启停的目标解析（三态契约，上游 PR#17 BLOCK-1）──────────── */

check('resolveToolBulkTargets：undefined = 全部（唯一表示全体的形态）', () => {
  const known = ['mcp__a__t1', 'mcp__a__t2']
  assert.deepEqual(x.resolveToolBulkTargets(undefined, known), { targets: known, ignored: [] })
})

check('resolveToolBulkTargets：显式数组 = 精确集合（[] 是合法空操作，不是「全部」）', () => {
  const known = ['mcp__a__t1', 'mcp__a__t2', 'mcp__a__t3']
  const empty = x.resolveToolBulkTargets([], known)
  assert.deepEqual(empty.targets, [], '显式 [] 绝不能被当成「全部」')
  assert.equal(empty.error, undefined)
  const exact = x.resolveToolBulkTargets(['mcp__a__t2'], known)
  assert.deepEqual(exact.targets, ['mcp__a__t2'])
  assert.deepEqual(exact.ignored, [])
  // 去重 + 未命中项回传（目录漂移可见化）
  const mixed = x.resolveToolBulkTargets(['mcp__a__t1', 'mcp__a__t1', 'mcp__a__gone'], known)
  assert.deepEqual(mixed.targets, ['mcp__a__t1'])
  assert.deepEqual(mixed.ignored, ['mcp__a__gone'])
})

check('resolveToolBulkTargets：非数组 / 非字符串项 / 非空却零命中 → error（不静默降级）', () => {
  const known = ['mcp__a__t1']
  assert.ok(x.resolveToolBulkTargets('mcp__a__t1', known).error, '字符串不是数组 → 拒绝')
  assert.ok(x.resolveToolBulkTargets(null, known).error, 'null → 拒绝')
  assert.ok(x.resolveToolBulkTargets(['mcp__a__t1', 42], known).error, '混入非字符串 → 拒绝')
  assert.ok(x.resolveToolBulkTargets([''], known).error, '空字符串项 → 拒绝')
  const none = x.resolveToolBulkTargets(['mcp__b__x'], known)
  assert.ok(none.error, '非空数组却零命中 → 拒绝（否则用户以为动了 N 条，实际 0 条）')
  assert.deepEqual(none.ignored, ['mcp__b__x'])
})

if (failed) process.exit(1)
console.log('\nselftest-exposure: all checks passed')
