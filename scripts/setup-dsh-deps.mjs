// 把 DSH 闭包类型链接进本仓库 node_modules，供 tsc/tsdown 解析。
// 目标：~/.dsh/profiles/node_modules/@deepseek-ai（主闭包）
//
// 跨平台（移植上游 31f60ca / PR #17 特性 5b）：Windows 用 `mklink /J`（junction 免管理员），
// POSIX 用目录符号链接 —— 原实现只走 cmd，在 Linux/macOS 上直接失败。
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const home = os.homedir()
const profileNodeModules = join(home, '.dsh', 'profiles', 'node_modules', '@deepseek-ai')
const localScoped = join(root, 'node_modules', '@deepseek-ai')

if (!existsSync(profileNodeModules)) {
  console.error(`closure not found: ${profileNodeModules}`)
  process.exit(1)
}

mkdirSync(localScoped, { recursive: true })

/** 已存在的路径（含指向已删除目标的悬空链接，existsSync 对它返回 false）。 */
function alreadyLinked(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

let created = 0
for (const name of readdirSync(profileNodeModules)) {
  const target = join(profileNodeModules, name)
  const link = join(localScoped, name)
  if (alreadyLinked(link)) continue
  try {
    if (process.platform === 'win32') {
      // Windows: mklink /J 需要 cmd；junction 无需管理员
      execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' })
    } else {
      // POSIX: 相对符号链接，仓库搬迁后仍然有效
      symlinkSync(relative(dirname(link), target), link, 'dir')
    }
    created += 1
    console.log(`linked ${name}`)
  } catch (error) {
    console.error(`failed to link ${name}:`, String(error))
  }
}
console.log(`dsh closure links ready (${created} created)`)
