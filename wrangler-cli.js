// Runs the project's wrangler with an argument list (no shell), so SQL with
// spaces, quotes or parentheses reaches wrangler intact on Windows too.
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = dirname(fileURLToPath(import.meta.url))
const WRANGLER_JS = process.env.WRANGLER_JS || join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

export function wrangler(args, { capture = false, allowFail = false, cwd } = {}) {
  if (!existsSync(WRANGLER_JS)) {
    throw new Error('wrangler が見つかりません。先に npm install --legacy-peer-deps を実行してください')
  }
  const r = spawnSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  const ok = r.status === 0
  if (!ok && !allowFail) {
    if (capture) process.stderr.write((r.stdout || '') + (r.stderr || ''))
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} が失敗しました`)
  }
  return { ok, out: r.stdout || '' }
}

// wrangler prints a banner before --json output
export function parseJson(out) {
  return JSON.parse(out.slice(out.search(/[[{]/)))
}
