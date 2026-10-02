#!/usr/bin/env node
// 案件のセットアップ・デプロイ (Cloudflare Pages + D1)
//
//   node setup-new-client.js                  新しい案件を作る(DB作成→PIN設定→デプロイ)
//   node setup-new-client.js --deploy <案件ID>  既存の案件に最新のコードを反映する
//   node setup-new-client.js --deploy-all     すべての案件に最新のコードを反映する
//
// 案件ID が "abc" なら、Pagesプロジェクト・D1データベースはどちらも "kintai-abc"、
// URL は https://kintai-abc.pages.dev になる。
// 事前に `npx wrangler login` でCloudflareにログインしておくこと。

import { spawnSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createInterface } from 'readline'

const PREFIX = 'kintai-'
// absolute path, because deploys run from a per-client folder
const localBin = resolve('node_modules/.bin/wrangler' + (process.platform === 'win32' ? '.cmd' : ''))
const WRANGLER = process.env.WRANGLER || (existsSync(localBin) ? `"${localBin}"` : 'npx wrangler')

function run(cmd, { capture = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (r.status !== 0 && !allowFail) {
    if (capture) process.stderr.write((r.stdout || '') + (r.stderr || ''))
    throw new Error(`コマンドが失敗しました: ${cmd}`)
  }
  return { ok: r.status === 0, out: r.stdout || '' }
}
const wr = (args, opts) => run(`${WRANGLER} ${args}`, opts)

function parseJson(out) {
  const i = out.search(/[[{]/)
  return JSON.parse(out.slice(i))
}

function checkLogin() {
  const r = wr('whoami --json', { capture: true, allowFail: true })
  if (!r.ok) {
    console.error('Cloudflareにログインしていません。先に次のコマンドを実行してください:\n  npx wrangler login')
    process.exit(1)
  }
}

function findDatabase(dbName) {
  const list = parseJson(wr('d1 list --json', { capture: true }).out)
  return list.find(d => d.name === dbName) || null
}

function listClientIds() {
  const list = parseJson(wr('pages project list --json', { capture: true }).out)
  return list
    .map(p => p.name || p['Project Name'])
    .filter(n => n && n.startsWith(PREFIX))
    .map(n => n.slice(PREFIX.length))
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

let built = false
function build() {
  if (built) return
  console.log('\nビルドしています…')
  run('npm run build')
  built = true
}

// Each client is deployed from its own temp folder holding that client's
// wrangler.toml + the build. The folder must be OUTSIDE this repo: inside it,
// wrangler also picked up the repo's wrangler.toml and bound the wrong D1.
function deploy(id) {
  const name = PREFIX + id
  const db = findDatabase(name)
  if (!db) throw new Error(`D1データベース「${name}」が見つかりません`)
  build()
  const dir = mkdtempSync(join(tmpdir(), `${name}-`))
  cpSync('dist', join(dir, 'dist'), { recursive: true })
  cpSync('functions', join(dir, 'functions'), { recursive: true })
  writeFileSync(join(dir, 'wrangler.toml'), [
    `name = "${name}"`,
    'compatibility_date = "2024-09-25"',
    'pages_build_output_dir = "dist"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${name}"`,
    `database_id = "${db.uuid}"`,
    '',
  ].join('\n'))
  // apply any new tables added since the client was created (IF NOT EXISTS)
  wr(`d1 execute ${name} --remote --yes --file=./schema.sql`, { capture: true })
  console.log(`\n「${name}」にデプロイしています…`)
  const prev = process.cwd()
  process.chdir(dir)
  try {
    wr(`pages deploy dist --project-name ${name} --branch main --commit-dirty=true`)
  } finally {
    process.chdir(prev)
    rmSync(dir, { recursive: true, force: true })
  }
  return `https://${name}.pages.dev`
}

// Line reader that never drops lines that arrive before the prompt is shown
function lineReader() {
  const rl = createInterface({ input: process.stdin })
  const queue = [], waiting = []
  let closed = false
  rl.on('line', l => (waiting.length ? waiting.shift()(l) : queue.push(l)))
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null) })
  return {
    async question(prompt) {
      process.stdout.write(prompt)
      const line = queue.length ? queue.shift() : closed ? null : await new Promise(r => waiting.push(r))
      if (line === null) { console.log('\n入力が終了したため中止します'); process.exit(1) }
      if (!process.stdin.isTTY) process.stdout.write(line + '\n')
      return line
    },
    close: () => rl.close(),
  }
}

async function setupNew() {
  const rl = lineReader()
  console.log('\n=== 新規案件セットアップ（Cloudflare） ===\n')

  let id
  for (;;) {
    id = (await rl.question('案件ID（半角英小文字・数字・ハイフン。例: kamiyashiro）: ')).trim().toLowerCase()
    if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) break
    console.log('  半角英小文字・数字・ハイフンで2文字以上入力してください')
  }
  const name = PREFIX + id

  if (findDatabase(name)) {
    console.error(`\nエラー: 案件「${id}」はすでにあります（データベース「${name}」）。`)
    console.error(`コードを更新するだけなら次のコマンドを使ってください:\n  node setup-new-client.js --deploy ${id}\n`)
    rl.close()
    process.exit(1)
  }

  const fbProject = (await rl.question('Firebaseからデータを引き継ぐ場合は、FirebaseのプロジェクトIDを入力（なければEnter）: ')).trim()

  let pin = ''
  for (;;) {
    pin = (await rl.question(fbProject
      ? '管理者PIN（4桁。Enterで Firebase の設定を引き継ぐ）: '
      : '管理者PIN（4桁の数字）: ')).trim()
    if (fbProject && pin === '') break
    if (!/^\d{4}$/.test(pin)) { console.log('  4桁の数字で入力してください'); continue }
    if (pin === '2607') { console.log('  2607 は以前の初期PINで知られているため使えません'); continue }
    const again = (await rl.question('確認のためもう一度入力: ')).trim()
    if (again === pin) break
    console.log('  PINが一致しません')
  }
  rl.close()

  console.log(`\nD1データベース「${name}」を作成しています…`)
  wr(`d1 create ${name} --location apac`, { capture: true })
  console.log('テーブルを作成しています…')
  wr(`d1 execute ${name} --remote --yes --file=./schema.sql`, { capture: true })

  if (fbProject) {
    console.log('\nFirebaseのデータを引き継ぎます（Firebase側は変更しません）')
    run(`node migrate-from-firebase.js --project ${fbProject} --db ${name}`)
  }
  if (pin) {
    wr(`d1 execute ${name} --remote --yes --command "INSERT OR REPLACE INTO config (key, value) VALUES ('adminPin', ${sqlString(pin)})"`, { capture: true })
    console.log('管理者PINを設定しました')
  }

  console.log(`\nPagesプロジェクト「${name}」を作成しています…`)
  wr(`pages project create ${name} --production-branch main`, { capture: true })

  const url = deploy(id)

  console.log('\n=== セットアップ完了 ===')
  console.log(`URL: ${url}`)
  console.log('  ※ 名前が他と重なった場合、URLの末尾が変わることがあります。上のデプロイ結果に表示されたURLを確認してください。')
  console.log('\n次にやること:')
  console.log(`  1. バックアップ用リポジトリの databases.txt に「${name}」を追加する`)
  console.log('  2. 打刻用タブレットでURLを開き、管理者PINで端末を登録する')
  console.log('     （Androidアプリの場合は、端末登録画面でこのURLを入力する）\n')
}

async function main() {
  checkLogin()
  const args = process.argv.slice(2)
  if (args[0] === '--deploy') {
    const id = (args[1] || '').replace(new RegExp('^' + PREFIX), '')
    if (!id) { console.error('使い方: node setup-new-client.js --deploy <案件ID>'); process.exit(1) }
    const url = deploy(id)
    console.log(`\n反映しました: ${url}`)
  } else if (args[0] === '--deploy-all') {
    const ids = listClientIds()
    if (ids.length === 0) { console.log('案件がありません'); return }
    console.log(`対象: ${ids.join(', ')}`)
    const failed = []
    for (const id of ids) {
      try { deploy(id) } catch (e) { console.error(`  ${id}: ${e.message}`); failed.push(id) }
    }
    console.log(failed.length ? `\n失敗した案件: ${failed.join(', ')}` : '\nすべての案件に反映しました')
    if (failed.length) process.exit(1)
  } else {
    await setupNew()
  }
}

main().catch(e => { console.error('\nエラー:', e.message); process.exit(1) })
