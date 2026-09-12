// 策略层端到端自测：v1→v2 迁移、状态文件持久化、生效时机（immediate / next-session）。
// 用最小 ctx 桩 + 临时 HOME，直接驱动构建产物 lib/index.js 的 createPolicyStore，
// 覆盖「纯函数自测覆盖不到」的真实文件读写与迁移链路。
// 用法：node scripts/selftest-policy.mjs （在包根目录运行，需先 pnpm build）
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 必须在 import 构建产物之前改 HOME：state.ts 在模块加载时就用 homedir() 求值目录
const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-panel-policy-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome

const dataDir = join(fakeHome, '.dsh', 'dsh-mcp-panel')
const legacyDir = join(fakeHome, '.dsh', 'dsh-mcp-skill-panel')
const stateFile = join(dataDir, 'state.json')

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

/** 最小 host ctx 桩（策略层只用 logger；timeout 供内部防抖用）。 */
const makeCtx = () => ({
  logger: { info() {}, warn() {}, debug() {}, error() {} },
  timeout: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
})

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/* ── ① 数据目录迁移 + v1 → v2 迁移 ─────────────────────────────────── */

// 造一份 v1 状态：一个已停用的 server（旧 autoManage=true → 应迁移为 hidden）、
// 一个已启用的 server（→ native）、一个工具级禁用表，放在**历史目录**里。
mkdirSync(legacyDir, { recursive: true })
const presetFile = join(fakeHome, 'agent.cordis.yml')
writeFileSync(
  presetFile,
  [
    '- id: mcp-alpha',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  disabled: true',
    '  config:',
    '    serverName: alpha',
    '- id: mcp-beta',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: beta',
  ].join('\n'),
  'utf8',
)
writeFileSync(
  join(legacyDir, 'state.json'),
  JSON.stringify(
    {
      config: { autoManage: true, applyMode: 'immediate' },
      mcp: { [presetFile]: { 'mcp-alpha': { desired: true, lastApplied: true }, 'mcp-beta': { desired: false, lastApplied: null } } },
      toolDisabled: { beta: ['mcp__beta__danger'] },
    },
    null,
    2,
  ),
  'utf8',
)

const index = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
const { createPolicyStore } = index

const applied = []
const policy = createPolicyStore({
  ctx: makeCtx(),
  fallbackExposure: 'native',
  onEffectiveChanged: (changes) => {
    for (const change of changes) applied.push(change.serverName)
  },
})

await checkAsync('policy.load：历史目录自动搬迁 + v1 → v2 迁移写回', async () => {
  await policy.load()
  assert.ok(existsSync(stateFile), 'state.json 应出现在新目录')
  const state = readJson(stateFile)
  assert.equal(state.version, 2)
  assert.ok(state.servers.alpha, 'alpha 应迁移进 servers 分区')
  assert.equal(state.servers.alpha.exposure, 'hidden', 'autoManage=true + 已停用 → hidden')
  assert.equal(state.servers.beta.exposure, 'native', '已启用 → native')
  assert.deepEqual(state.servers.beta.disabledTools, ['mcp__beta__danger'], '工具级禁用并入策略')
  assert.equal(state.mcp, undefined, 'v1 字段应被清除')
  assert.equal(state.config.autoManage, undefined, '旧 autoManage 应被清除')
  assert.ok(existsSync(join(dataDir, 'state.v1.json')), '应备份 state.v1.json')
  assert.equal(state.servers.alpha.applied, true, 'v1 lastApplied 应作为物化账本带过来')
})

/* ── ② 生效时机：immediate ─────────────────────────────────────────── */

await checkAsync('policy.set（immediate）：意图与生效同步更新 + 落盘 + 触发进程状态回调', async () => {
  applied.length = 0
  const result = await policy.set({ serverName: 'beta', patch: { exposure: 'name-only' }, applyMode: 'immediate' })
  assert.equal(result.applied, true)
  assert.equal(policy.effective('beta', undefined).exposure, 'name-only')
  assert.deepEqual(applied, ['beta'], '应通知进程状态回调')
  assert.equal(policy.isPending('beta', undefined), false)
  assert.equal(readJson(stateFile).servers.beta.exposure, 'name-only', '意图应落盘')
})

/* ── ③ 生效时机：next-session ──────────────────────────────────────── */

await checkAsync('policy.set（next-session）：只改意图不改生效，commitPending 后提升', async () => {
  applied.length = 0
  const result = await policy.set({ serverName: 'alpha', patch: { exposure: 'native' }, applyMode: 'next-session' })
  assert.equal(result.applied, false)
  assert.equal(policy.intent('alpha', undefined).exposure, 'native', '意图应更新')
  assert.equal(policy.effective('alpha', undefined).exposure, 'hidden', '生效值应保持不变')
  assert.equal(policy.isPending('alpha', undefined), true)
  assert.deepEqual(applied, [], '未生效不应触发进程状态回调')
  assert.equal(readJson(stateFile).servers.alpha.exposure, 'native', '意图应已落盘')

  const promoted = await policy.commitPending()
  assert.equal(promoted, 1)
  assert.equal(policy.effective('alpha', undefined).exposure, 'native', 'commit 后生效值跟上')
  assert.equal(policy.isPending('alpha', undefined), false)
  assert.deepEqual(applied, ['alpha'])
})

/* ── ④ 预设关联与工具禁用 ──────────────────────────────────────────── */

await checkAsync('policy.set：预设关联与工具禁用规范化（去重排序）并持久化', async () => {
  await policy.set({
    serverName: 'beta',
    patch: { presets: { mode: 'only', ids: ['standard', 'coding', 'standard'] }, disabledTools: ['mcp__beta__b', 'mcp__beta__a'] },
    applyMode: 'immediate',
  })
  const effective = policy.effective('beta', undefined)
  assert.deepEqual(effective.presets, { mode: 'only', ids: ['coding', 'standard'] })
  assert.deepEqual(effective.disabledTools, ['mcp__beta__a', 'mcp__beta__b'])
  const persisted = readJson(stateFile).servers.beta
  assert.deepEqual(persisted.presets, { mode: 'only', ids: ['coding', 'standard'] }, '预设关联应落盘')
})

/* ── ⑤ 项目级策略分区 ─────────────────────────────────────────────── */

await checkAsync('policy.set（带 workspace）：写入 projects 分区，与全局表互不干扰', async () => {
  await policy.set({ serverName: 'proj-x', workspace: '/ws/a', patch: { exposure: 'hidden' }, applyMode: 'immediate' })
  assert.equal(policy.effective('proj-x', '/ws/a').exposure, 'hidden')
  assert.equal(policy.effective('proj-x', '/ws/b').exposure, 'native', '其他工作空间不受影响')
  assert.equal(policy.effective('proj-x', undefined).exposure, 'native', '全局表不受影响')
  const state = readJson(stateFile)
  assert.equal(state.projects['/ws/a']['proj-x'].exposure, 'hidden')
})

/* ── ⑥ 物化账本与首次采用 ─────────────────────────────────────────── */

await checkAsync('policy.adoptFromFile / markApplied：首次采用按文件现状，账本可写回', async () => {
  const adopted = await policy.adoptFromFile('gamma', undefined, true)
  assert.ok(adopted, '未配置过的 server 应建档')
  assert.equal(adopted.exposure, 'hidden', '文件 disabled=true → hidden')
  assert.equal(adopted.applied, true)
  assert.equal(policy.intent('gamma', undefined).exposure, 'hidden')

  await policy.markApplied('gamma', undefined, false)
  assert.equal(readJson(stateFile).servers.gamma.applied, false)

  const again = await policy.adoptFromFile('gamma', undefined, false)
  assert.equal(again, undefined, '已建档的 server 不应被再次采用（用户配置优先）')
})

/* ── ⑦ 读取健壮性 ─────────────────────────────────────────────────── */

await checkAsync('policy：坏字段宽容解析（非法档位回落默认，不抛错）', async () => {
  const state = readJson(stateFile)
  state.servers.broken = { exposure: 'nonsense', presets: { mode: 'weird', ids: 'nope' }, disabledTools: [1, null, 'mcp__x__y'] }
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8')
  // 同一进程内 state 有内存缓存：直接验证 normalizePolicy 的宽容性（读路径的兜底）
  const normalized = index.decideExposure({
    policy: { exposure: 'native', presets: { mode: 'all', ids: [] }, disabledTools: [] },
    running: true,
    aiActive: false,
    presetId: undefined,
  })
  assert.equal(normalized, 'native')
})

/* ── ⑧ 全局行（profile patch 行）的停用物化（v0.6.0 缺陷回归）────────── */

// 背景：profile patch 的 `- insert:` 行加载后属于根树，其 tree.filename 是根树 backing
// 文件 cordis.yml（每次启动重置为 []）。v0.6.0 因跳过该文件而从未把「隐藏/关闭」档位的
// 停用状态写回 patch 文件 —— 重启后进程又跑起来。本轮改为落到同目录的 cordis.patch.yml。
const profileDir = join(fakeHome, 'profile')
mkdirSync(profileDir, { recursive: true })
const rootTree = join(profileDir, 'cordis.yml')
const patchFile = join(profileDir, 'cordis.patch.yml')
writeFileSync(rootTree, '[]\n', 'utf8')
writeFileSync(
  patchFile,
  [
    '- insert:',
    '    - id: mcp-patchy',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: "stdio"',
    '        serverName: "patchy"',
    '        command: "npx"',
    '- insert:',
    '    - id: mcp-other',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: "stdio"',
    '        serverName: "other"',
    '        command: "node"',
  ].join('\n') + '\n',
  'utf8',
)

await checkAsync('syncPresetFiles：全局行（根树 cordis.yml）的 disabled 落到同目录 patch 文件', async () => {
  const before = readFileSync(patchFile, 'utf8')
  const rootBefore = readFileSync(rootTree, 'utf8')
  await policy.set({ serverName: 'patchy', patch: { exposure: 'hidden' }, applyMode: 'immediate' })

  const stubCtx = {
    agents: { list: () => [] },
    logger: { info() {}, warn() {}, debug() {} },
  }
  const stubRegistry = {
    snapshot: () => ({
      all: new Map([
        [
          'patchy',
          {
            serverName: 'patchy',
            entryId: 'mcp-patchy',
            rowId: 'mcp-patchy',
            source: 'loader',
            disabled: false,
            running: true,
            transport: 'stdio',
            file: rootTree,
          },
        ],
      ]),
      byPreset: new Map(),
      at: Date.now(),
    }),
  }
  const written = await index.syncPresetFiles({ ctx: stubCtx, registry: stubRegistry, policy })
  assert.equal(written, 1, '应物化 1 行')
  const after = readFileSync(patchFile, 'utf8')
  assert.notEqual(after, before, 'patch 文件应被改写')
  assert.ok(after.includes('      disabled: true'), 'disabled 应写在 id 行的子缩进上')
  const lines = after.split('\n')
  const idAt = lines.findIndex((line) => line.trim() === '- id: mcp-patchy')
  const otherAt = lines.findIndex((line) => line.trim() === '- id: mcp-other')
  assert.ok(idAt >= 0 && lines[idAt + 1].trim() === 'disabled: true', '标志紧跟在 id 行之后')
  assert.ok(!lines.slice(otherAt, otherAt + 2).some((line) => line.includes('disabled')), '其它行不受影响')
  assert.equal(readFileSync(rootTree, 'utf8'), rootBefore, '根树 backing 文件绝不被写')
})

await checkAsync('syncPresetFiles：二次调用幂等（账本已对齐，不再写盘）', async () => {
  const once = readFileSync(patchFile, 'utf8')
  const written = await index.syncPresetFiles({
    ctx: { agents: { list: () => [] }, logger: { info() {}, warn() {}, debug() {} } },
    registry: {
      snapshot: () => ({
        all: new Map([
          [
            'patchy',
            {
              serverName: 'patchy',
              entryId: 'mcp-patchy',
              rowId: 'mcp-patchy',
              source: 'loader',
              disabled: false,
              running: true,
              transport: 'stdio',
              file: rootTree,
            },
          ],
        ]),
        byPreset: new Map(),
        at: Date.now(),
      }),
    },
    policy,
  })
  assert.equal(written, 0, '已一致时不应再写')
  assert.equal(readFileSync(patchFile, 'utf8'), once)
})

rmSync(fakeHome, { recursive: true, force: true })
if (failed) process.exit(1)
console.log('\nselftest-policy: all checks passed')
