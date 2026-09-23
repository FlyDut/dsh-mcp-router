#!/usr/bin/env node
/**
 * 上游水位线检查：按 docs/upstream-port.md 记录的水位线，列出上游新增的提交与分支。
 *
 * 用法：
 *   node scripts/upstream-check.mjs            # 只看已 fetch 的远端状态
 *   node scripts/upstream-check.mjs --fetch    # 先 git fetch upstream --no-tags
 *
 * 退出码：0 = 全部在水位线内；1 = 有上游新提交待评估；2 = 用法/环境错误。
 *
 * 设计要点：水位线是**逐分支**的（upstream/main 的 release 是 squash，不是 feat/* 的
 * 祖先），所以不能拿一个 sha 去 diff 所有分支。已知分支集合直接从文档推导 —— 新增
 * 上游分支会在输出里提示，不需要维护忽略列表。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const docPath = join(root, 'docs', 'upstream-port.md')

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd()
  } catch (error) {
    if (allowFail) return null
    throw new Error(`git ${args.join(' ')} 失败：${error.stderr ?? error.message}`)
  }
}

let doc
try {
  doc = readFileSync(docPath, 'utf8')
} catch {
  console.error(`找不到 ${docPath}`)
  process.exit(2)
}

const block = /<!--\s*upstream-watermarks\n([\s\S]*?)-->/.exec(doc)
if (!block) {
  console.error('docs/upstream-port.md 里缺少 <!-- upstream-watermarks ... --> 块')
  process.exit(2)
}
const marks = block[1]
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [branch, sha] = line.split(/\s+/)
    return { branch, sha }
  })
if (marks.length === 0) {
  console.error('水位线块为空')
  process.exit(2)
}

if (process.argv.includes('--fetch')) {
  console.log('$ git fetch upstream --no-tags')
  try {
    execFileSync('git', ['fetch', 'upstream', '--no-tags'], { cwd: root, stdio: 'inherit' })
  } catch {
    console.error('git fetch upstream 失败（网络 / remote 配置问题）')
    process.exit(2)
  }
}

// 已知分支 = 水位线块里的分支 ∪ 文档正文里出现过的 upstream/<name>
const knownBranches = new Set(marks.map((m) => m.branch))
for (const match of doc.matchAll(/upstream\/([A-Za-z0-9._/-]+)/g)) knownBranches.add(match[1].replace(/[.,;)]+$/, ''))

let pending = 0
console.log(`水位线文档：docs/upstream-port.md`)
console.log('')
console.log(`${'分支'.padEnd(36)} ${'水位线'.padEnd(10)} ${'新增'.padStart(4)}  状态`)
console.log('-'.repeat(76))

for (const { branch, sha } of marks) {
  const ref = `upstream/${branch}`
  const pad = ref.length > 35 ? ref : ref.padEnd(36)
  if (git(['rev-parse', '--verify', '--quiet', ref], { allowFail: true }) === null) {
    console.log(`${pad} ${sha.slice(0, 8).padEnd(10)} ${'—'.padStart(4)}  ref 不存在（先 --fetch）`)
    continue
  }
  if (git(['rev-parse', '--verify', '--quiet', sha], { allowFail: true }) === null) {
    console.log(`${pad} ${sha.slice(0, 8).padEnd(10)} ${'—'.padStart(4)}  水位线对象缺失（先 --fetch）`)
    continue
  }
  const count = Number(git(['rev-list', '--count', `${sha}..${ref}`]) || 0)
  pending += count
  console.log(`${pad} ${sha.slice(0, 8).padEnd(10)} ${String(count).padStart(4)}  ${count > 0 ? '有新增 ↓' : '水位线内'}`)
  if (count > 0) {
    const log = git(['log', '--oneline', '--no-merges', `${sha}..${ref}`])
    for (const line of log.split('\n')) console.log(`        ${line}`)
    const stat = git(['diff', '--shortstat', `${sha}..${ref}`])
    if (stat) console.log(`        ${stat}`)
  }
}

// 上游出现的新分支（文档里从未记录过）
const actual = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/upstream'], { allowFail: true })
if (actual) {
  const fresh = actual
    .split('\n')
    .filter((ref) => ref.startsWith('upstream/') && !ref.endsWith('/HEAD'))
    .map((ref) => ref.slice('upstream/'.length))
    .filter((branch) => !knownBranches.has(branch))
  if (fresh.length > 0) {
    console.log('')
    console.log('上游出现文档里未记录的新分支（需要人工判断是否评估）：')
    for (const branch of fresh) {
      console.log(`  upstream/${branch}  ${git(['log', '-1', '--format=%h %ci %s', `upstream/${branch}`])}`)
    }
  }
}

console.log('')
if (pending === 0) {
  console.log('✅ 全部在水位线内，无需处理。')
  process.exit(0)
}
console.log(`⚠️  共 ${pending} 个上游新提交待评估。评估完成后：`)
console.log('   1) 把要移植的提交按「上游提交 → 本地提交」补进 docs/upstream-port.md 的映射表；')
console.log('   2) 不适用的补进「已评估、明确不适用」表（附理由）；')
console.log('   3) 更新文档顶部 <!-- upstream-watermarks --> 块里的 sha。')
process.exit(1)
