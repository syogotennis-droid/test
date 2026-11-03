#!/usr/bin/env node
// 業務・時給・交通費をまとめて入れる（新しい施設の立ち上げ用。名簿の登録のあとに使う）
//
//   node import-rates.js <案件ID> <時給.csv>            入れる（確認のあと実行）
//   node import-rates.js <案件ID> <時給.csv> --dry-run  入れる内容を表示するだけ
//
// CSV は「氏名,区分,項目,値1,値2」の5列（1行目は見出し）。
//   区分「業務」  : 項目＝業務名、値1＝時給、値2＝日曜時給（なければ空）
//   区分「交通費」: 項目＝車・バイク・公共交通機関・定期、値1＝距離（km）か金額（公共交通機関は1日、定期は1か月）
//
// 従業員は氏名で探す（空白の有無・全角半角の空白は区別しない）。見つからない人・社員は入れずに表示する。
// 担当業務は今の担当に足すだけ（外さない）。時給は「適用開始日」からの時給として履歴に足す。
// 交通費は、その人の通勤設定を CSV の内容にして、適用開始日つきで履歴に残す。
// 業務の一覧にない業務名は、業務の管理に追加する。
// 車・バイクの単価が1件もないときは、--car-base（1Lの金額。初期値174）と燃費（車8・バイク13）で登録する。

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { randomBytes } from 'crypto'
import { wrangler, parseJson } from './wrangler-cli.js'

const args = process.argv.slice(2)
const opt = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null }
const dryRun = args.includes('--dry-run')
const local = args.includes('--local') // development only: the local database
const [idArg, file] = args.filter(a => !a.startsWith('--'))
const FROM = opt('from') || '2026-11-04'
const CAR_BASE = Number(opt('car-base') || 174)
if (!idArg || !file || !/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
  console.error('使い方: node import-rates.js <案件ID> <時給.csv> [--from=YYYY-MM-DD] [--dry-run]')
  process.exit(1)
}
const DB = local ? 'qr-attendance-db' : 'kintai-' + idArg.replace(/^kintai-/, '')
const WHERE = local ? '--local' : '--remote'
const q = v => `'${String(v).replace(/'/g, "''")}'`
const norm = s => String(s || '').replace(/[\s　]+/g, '')
const COMMUTE = { '車': 'car', 'バイク': 'bike', '公共交通機関': 'public', '定期': 'pass' }
// the same rule as 業務の管理 (src/lib/db.js SYSTEM_ITEMS)
const RESERVED = new Set(['休憩', '準備', '交通費', '有給', '固定手当'])
const DEFAULT_DEFS = [
  'アスレ', ['スイム', 'スイム', '通常'], ['スイム短期', 'スイム', '短期'], ['スイム成人', 'スイム', '成人'], ['スイムベビー', 'スイム', 'ベビー'],
  ['フロント', 'フロント', '通常'], ['フロント短期', 'フロント', '短期'], ['監視', '監視', '通常'], ['監視短期', '監視', '短期'],
  '研修会', '清掃', '事務処理', 'エアロ', 'ドライバー', '選手引率',
].map(d => (Array.isArray(d) ? { id: d[0], name: d[0], group: d[1], variant: d[2] } : { id: d, name: d }))

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(r => rl.question(question, a => { rl.close(); r(a.trim()) }))
}
const d1 = sql => parseJson(wrangler(['d1', 'execute', DB, WHERE, '--json', '--command', sql], { capture: true }).out)[0].results

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const people = new Map(), errors = []
  lines.slice(1).forEach((line, i) => {
    const [name, kind, item, v1, v2] = line.split(',').map(s => (s || '').trim())
    const n = i + 2
    if (!name) return errors.push(`${n}行目: 氏名が空です`)
    const p = people.get(norm(name)) || { name, rates: [], commute: {} }
    people.set(norm(name), p)
    if (kind === '業務') {
      const normal = Number(v1), sunday = v2 === '' ? 0 : Number(v2)
      if (!item || RESERVED.has(item)) errors.push(`${n}行目: 業務名「${item}」は使えません`)
      else if (!(normal > 0) || !(sunday >= 0)) errors.push(`${n}行目: 時給が数字ではありません`)
      else if (p.rates.some(r => r.item === item)) errors.push(`${n}行目: ${name}さんの「${item}」が2回あります`)
      else p.rates.push({ item, normal, sunday })
    } else if (kind === '交通費') {
      const key = COMMUTE[item], v = Number(v1)
      if (!key) errors.push(`${n}行目: 交通費の項目は 車・バイク・公共交通機関・定期（${item}）`)
      else if (!(v > 0)) errors.push(`${n}行目: 交通費の値が数字ではありません`)
      else p.commute[key] = key === 'car' || key === 'bike' ? { km: v } : { amount: v }
    } else errors.push(`${n}行目: 区分は「業務」か「交通費」（${kind || '空'}）`)
  })
  return { people: [...people.values()], errors }
}

async function main() {
  const { people, errors } = readCsv(file)
  if (errors.length) { console.error('CSV に直すところがあります:\n  ' + errors.join('\n  ')); process.exit(1) }
  console.log(`\n=== 業務・時給・交通費の登録（${DB}、${FROM}から） ===\n`)

  const users = d1('SELECT id, data FROM users').map(r => ({ id: r.id, data: JSON.parse(r.data || '{}') }))
  const cfg = Object.fromEntries(d1("SELECT key, value FROM config WHERE key IN ('workItemDefs', 'carRates')").map(r => [r.key, r.value]))
  let defs = cfg.workItemDefs ? JSON.parse(cfg.workItemDefs) : DEFAULT_DEFS.map(d => ({ ...d }))
  const carRates = cfg.carRates ? JSON.parse(cfg.carRates) : []

  // work items: names → ids (adds the ones the list does not have yet)
  const added = []
  const idOf = name => {
    let d = defs.find(x => x.name === name && !x.deleted)
    if (!d) {
      const old = defs.find(x => x.name === name && x.deleted)
      if (old) { delete old.deleted; d = old; added.push(`${name}（削除済みを戻す）`) }
      else { d = { id: 'w_' + randomBytes(5).toString('hex'), name }; defs.push(d); added.push(name) }
    }
    return d.id
  }

  const byName = new Map(users.map(u => [norm(u.data.name), u]))
  const updates = [], notFound = [], salaried = []
  for (const p of people) {
    const u = byName.get(norm(p.name))
    if (!u) { notFound.push(p.name); continue }
    if (u.data.employeeType === 'salaried') { salaried.push(p.name); continue }
    const data = { ...u.data }
    let itemRates = { ...(data.itemRates || {}) }
    const items = new Set(data.workItems || [])
    for (const r of p.rates) {
      const id = idOf(r.item)
      items.add(id)
      // the same as 時給の履歴・変更 in the admin screen (withRateFrom in src/lib/db.js)
      const cur = itemRates[id] || {}
      let hist = Array.isArray(cur.rateHistory) && cur.rateHistory.length ? [...cur.rateHistory]
        : (cur.normal != null ? [{ from: null, normal: Number(cur.normal), ...(cur.sunday ? { sunday: Number(cur.sunday) } : {}) }] : [])
      hist = hist.filter(e => e.from !== FROM)
      hist.push({ from: FROM, normal: r.normal, ...(r.sunday ? { sunday: r.sunday } : {}) })
      hist.sort((a, b) => (!a.from ? -1 : !b.from ? 1 : a.from.localeCompare(b.from)))
      const latest = hist[hist.length - 1]
      itemRates = { ...itemRates, [id]: { ...cur, normal: Number(latest.normal) || 0, sunday: Number(latest.sunday) || 0, rateHistory: hist } }
    }
    data.workItems = [...items]
    data.itemRates = itemRates
    const methods = p.commute
    if (Object.keys(methods).length) {
      data.commuteMethods = methods
      const hist = (Array.isArray(data.commuteHistory) ? data.commuteHistory : []).filter(h => h.from !== FROM)
      data.commuteHistory = [...hist, { from: FROM, methods }].sort((a, b) => (a.from || '').localeCompare(b.from || ''))
    }
    updates.push({ id: u.id, name: u.data.name, data, p })
  }

  const label = { car: '車', bike: 'バイク', public: '公共交通機関', pass: '定期' }
  updates.forEach(({ id, name, p }) => {
    const c = Object.entries(p.commute).map(([k, v]) => `${label[k]} ${v.km != null ? v.km + 'km' : v.amount + '円' + (k === 'pass' ? '/月' : '/日')}`).join('・') || '交通費なし'
    console.log(`  ${id} ${name}：業務 ${p.rates.length}件（${p.rates.map(r => `${r.item} ${r.normal}${r.sunday ? '/日曜' + r.sunday : ''}`).join('、')}）／${c}`)
  })
  console.log(`\n入れる人：${updates.length}名`)
  if (added.length) console.log(`業務の管理に追加する業務：${added.join('、')}`)
  const needCar = updates.some(u => u.p.commute.car || u.p.commute.bike) && carRates.length === 0
  if (needCar) console.log(`交通費の単価がないので登録する：${FROM}から 金額${CAR_BASE}円・車の燃費8（${(CAR_BASE / 8).toFixed(3)}円/km）・バイクの燃費13`)
  if (notFound.length) console.log(`\n名簿にいないため入れない人：${notFound.join('、')}`)
  if (salaried.length) console.log(`社員のため入れない人：${salaried.join('、')}`)
  if (updates.length === 0) { console.log('\n入れる人はいません'); return }
  if (dryRun) { console.log('\n--dry-run のため登録しません'); return }
  if (!local && (await ask(`\nよければ「${DB}」と入力してください: `)) !== DB) { console.log('中止しました'); return }

  const sql = updates.map(u => `UPDATE users SET data = ${q(JSON.stringify(u.data))} WHERE id = ${q(u.id)};`)
  sql.push(`INSERT OR REPLACE INTO config (key, value) VALUES ('workItemDefs', ${q(JSON.stringify(defs))});`)
  if (needCar) {
    const entry = { from: FROM, base: CAR_BASE, carKmPerL: 8, bikeKmPerL: 13, rate: CAR_BASE / 8, bikeRate: CAR_BASE / 13 }
    sql.push(`INSERT OR REPLACE INTO config (key, value) VALUES ('carRates', ${q(JSON.stringify([entry]))});`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'rates-'))
  try {
    const f = join(dir, 'rates.sql')
    writeFileSync(f, sql.join('\n') + '\n')
    wrangler(['d1', 'execute', DB, WHERE, '--yes', `--file=${f}`], { capture: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${updates.length}名に業務・時給・交通費を入れました。管理画面の「従業員管理」で確認してください。\n`)
}

main().catch(e => { console.error('\nエラー:', e.message); process.exit(1) })
