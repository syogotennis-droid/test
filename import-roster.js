#!/usr/bin/env node
// 名簿（CSV）から従業員をまとめて登録する（新しい施設の立ち上げ用）
//
//   node import-roster.js <案件ID> <名簿.csv>            登録する（確認のあと実行）
//   node import-roster.js <案件ID> <名簿.csv> --dry-run  登録する内容を表示するだけ
//
// 名簿は「従業員ID,氏名,種別」の3列（1行目は見出し）。種別は「社員」か「アルバイト・パート」。
// 追加だけ行う: 同じIDの人がすでにいれば、その人はそのまま（上書きしない）。
// 業務・時給・交通費・PINは空で登録し、あとから管理画面で入れる。

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { wrangler, parseJson } from './wrangler-cli.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const local = args.includes('--local') // development only: the local database
const [idArg, file] = args.filter(a => !a.startsWith('--'))
if (!idArg || !file) {
  console.error('使い方: node import-roster.js <案件ID> <名簿.csv> [--dry-run]')
  process.exit(1)
}
const DB = local ? 'qr-attendance-db' : 'kintai-' + idArg.replace(/^kintai-/, '')
const WHERE = local ? '--local' : '--remote'
const q = v => `'${String(v).replace(/'/g, "''")}'`

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => rl.question(question, a => { rl.close(); r(a.trim()) }))
}

function readRoster(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const rows = []
  const errors = []
  lines.slice(1).forEach((line, i) => {
    const [id, name, type] = line.split(',').map(s => (s || '').trim())
    const n = i + 2
    if (!/^[^\s/?#%]+$/.test(id || '')) errors.push(`${n}行目: 従業員IDが不正です（${id || '空'}）`)
    else if (!name) errors.push(`${n}行目: 氏名が空です`)
    else if (type !== '社員' && type !== 'アルバイト・パート') errors.push(`${n}行目: 種別は「社員」か「アルバイト・パート」（${type || '空'}）`)
    else rows.push({ id, name: name.replace(/[\s　]+/g, ' '), salaried: type === '社員' })
  })
  const dup = rows.map(r => r.id).filter((id, i, a) => a.indexOf(id) !== i)
  if (dup.length) errors.push(`同じ従業員IDが名簿に2回あります: ${[...new Set(dup)].join(', ')}`)
  return { rows, errors }
}

async function main() {
  const { rows, errors } = readRoster(file)
  if (errors.length) { console.error('名簿に直すところがあります:\n  ' + errors.join('\n  ')); process.exit(1) }
  console.log(`\n=== 名簿の登録（${DB}） ===\n`)
  const existing = new Set(parseJson(wrangler(['d1', 'execute', DB, WHERE, '--json', '--command', 'SELECT id FROM users'], { capture: true }).out)[0].results.map(r => r.id))
  const add = rows.filter(r => !existing.has(r.id))
  const skip = rows.filter(r => existing.has(r.id))
  console.log(`名簿 ${rows.length}名: 登録 ${add.length}名（アルバイト・パート ${add.filter(r => !r.salaried).length}名、社員 ${add.filter(r => r.salaried).length}名）`)
  if (skip.length) console.log(`すでに登録済みのため変更しない: ${skip.map(r => r.id).join(', ')}`)
  add.forEach(r => console.log(`  ${r.id}  ${r.name}（${r.salaried ? '社員' : 'アルバイト・パート'}）`))
  if (add.length === 0) { console.log('\n登録する人はいません'); return }
  if (dryRun) { console.log('\n--dry-run のため登録しません'); return }
  if (!local && (await ask(`\nよければ「${DB}」と入力してください: `)) !== DB) { console.log('中止しました'); return }

  // the same fields as 従業員管理 → 従業員を追加 with nothing filled in
  const dataOf = r => r.salaried
    ? { name: r.name, pin: '', employeeType: 'salaried', workItems: [], itemRates: {}, fixedStartTime: '09:00', fixedEndTime: '18:00', monthlySalary: 0, overtimeRate: 0, regularHours: 480, standardBreakMins: 60 }
    : { name: r.name, pin: '', employeeType: 'hourly', workItems: [], itemRates: {}, commuteMethods: {} }
  // INSERT OR IGNORE: someone added in the meantime with the same ID is left as is
  const sql = add.map(r => `INSERT OR IGNORE INTO users (id, pin, data) VALUES (${q(r.id)}, '', ${q(JSON.stringify(dataOf(r)))});`)
  const dir = mkdtempSync(join(tmpdir(), 'roster-'))
  try {
    const f = join(dir, 'roster.sql')
    writeFileSync(f, sql.join('\n') + '\n')
    wrangler(['d1', 'execute', DB, WHERE, '--yes', `--file=${f}`], { capture: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${add.length}名を登録しました。管理画面の「QR印刷」で印刷できます。`)
  console.log('業務・時給・PIN・交通費は、管理画面の「従業員管理」「設定 > 交通費」で入れてください。\n')
}

main().catch(e => { console.error('\nエラー:', e.message); process.exit(1) })
