#!/usr/bin/env node
// テスト用の案件（kintai-test）の従業員の個人情報を伏せる（外部のテスト担当者に渡す前に使う）
//
//   node anonymize-test-db.js            名前・PINを置き換える（確認のあと実行）
//   node anonymize-test-db.js --dry-run  何人が対象かだけ表示（書き換えない）
//
// - 氏名 → 「テスト 従業員01」「テスト 社員01」（従業員IDの順）
// - PIN → 1001 から順の番号（テスト担当者に渡す一覧を anonymize-output/ に作る）
// - 社員の月給・残業単価 → 0
// 従業員ID・打刻・業務・時給・交通費の設定はそのまま（テストに使うため）。
// 本番の案件には使えない（kintai-test だけ）。何度流しても同じ結果になる。

import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { wrangler, parseJson } from './wrangler-cli.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const local = args.includes('--local') // development only: the local database
const DB = local ? 'qr-attendance-db' : 'kintai-test'
const WHERE = local ? '--local' : '--remote'

const pad = n => String(n).padStart(2, '0')
const q = v => `'${String(v).replace(/'/g, "''")}'`

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => rl.question(question, a => { rl.close(); r(a.trim()) }))
}

async function main() {
  console.log(`\n=== テスト用の個人情報を伏せる（${DB}） ===\n`)
  const out = wrangler(['d1', 'execute', DB, WHERE, '--json', '--command', 'SELECT id, data FROM users'], { capture: true }).out
  const users = parseJson(out)[0].results.map(r => ({ id: r.id, ...JSON.parse(r.data || '{}') }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'ja', { numeric: true }))
  if (users.length === 0) { console.log('従業員がいません'); return }

  let h = 0, s = 0
  const plan = users.map((u, i) => {
    const salaried = u.employeeType === 'salaried'
    const name = salaried ? `テスト 社員${pad(++s)}` : `テスト 従業員${pad(++h)}`
    return { id: u.id, name, pin: String(1001 + i), salaried }
  })
  console.log(`対象: ${users.length}名（アルバイト・パート ${h}名、社員 ${s}名）`)
  console.log('氏名を「テスト 従業員01」などに、PINを 1001 からの番号に置き換えます。社員の月給・残業単価は 0 にします。')
  console.log('打刻・業務・時給・交通費の設定は変えません。元の名前には戻せません（本番のデータには影響しません）。\n')
  if (dryRun) { console.log('--dry-run のため書き換えません'); return }
  if (!local && (await ask(`よければ「${DB}」と入力してください: `)) !== DB) { console.log('中止しました'); return }

  const sql = plan.map(p =>
    `UPDATE users SET pin = ${q(p.pin)}, data = json_set(data, '$.name', ${q(p.name)}, '$.pin', ${q(p.pin)}` +
    (p.salaried ? `, '$.monthlySalary', 0, '$.overtimeRate', 0` : '') +
    `) WHERE id = ${q(p.id)};`)
  const dir = mkdtempSync(join(tmpdir(), 'anonymize-'))
  try {
    const file = join(dir, 'anonymize.sql')
    writeFileSync(file, sql.join('\n') + '\n')
    wrangler(['d1', 'execute', DB, WHERE, '--yes', `--file=${file}`], { capture: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // the list for the testers: ID, new name, PIN (no real names)
  mkdirSync('anonymize-output', { recursive: true })
  const csv = ['従業員ID,氏名,種別,PIN', ...plan.map(p => `${p.id},${p.name},${p.salaried ? '社員' : 'アルバイト・パート'},${p.pin}`)].join('\r\n') + '\r\n'
  const outFile = join('anonymize-output', `${DB}-従業員一覧.csv`)
  writeFileSync(outFile, '﻿' + csv) // BOM so Excel opens it as UTF-8
  console.log(`\n${users.length}名を置き換えました。テスト担当者に渡す一覧: ${outFile}`)
  console.log('（打刻端末に保存された名簿は、次に通信したときに新しい名前に変わります）\n')
}

main().catch(e => { console.error('\nエラー:', e.message); process.exit(1) })
