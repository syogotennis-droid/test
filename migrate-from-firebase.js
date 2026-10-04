// Firebase (Firestore) → Cloudflare D1 data migration.
// Firestore is only READ (HTTP GET). Nothing in Firebase is changed or deleted.
//
// Usage:
//   node migrate-from-firebase.js --project <firebaseProjectId> --db <d1DatabaseName> [--local] [--dry-run]
//
//   --local    write into the local D1 used by `wrangler pages dev` (for testing)
//   --dry-run  only fetch and write the SQL file; don't touch D1
//
// Safe to run more than once: rows are written with INSERT OR REPLACE using the
// same IDs as Firestore, so a second run just brings D1 up to date.

import { writeFileSync, mkdirSync } from 'fs'
import { wrangler, parseJson } from './wrangler-cli.js'

const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const flag = name => args.includes(name)

const projectId = arg('--project')
const dbName = arg('--db')
const local = flag('--local')
const dryRun = flag('--dry-run')

if (!projectId || (!dbName && !dryRun)) {
  console.log('使い方: node migrate-from-firebase.js --project <FirebaseのプロジェクトID> --db <D1のデータベース名> [--local] [--dry-run]')
  process.exit(1)
}

const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`

function decode(v) {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('timestampValue' in v) return v.timestampValue
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {})
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode)
  return null
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]))
}

async function fetchCollection(name) {
  const docs = []
  let pageToken = ''
  do {
    const url = `${BASE}/${name}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${name} の読み込みに失敗しました (${res.status}): ${await res.text()}`)
    const j = await res.json()
    for (const d of j.documents || []) {
      docs.push({ id: d.name.split('/').pop(), ...decodeFields(d.fields || {}) })
    }
    pageToken = j.nextPageToken || ''
  } while (pageToken)
  return docs
}

function q(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${String(v).replace(/'/g, "''")}'`
}
const json = v => q(JSON.stringify(v ?? {}))

function d1(extra) {
  return wrangler(['d1', 'execute', dbName, local ? '--local' : '--remote', '--yes', ...extra], { capture: true }).out
}

async function main() {
  console.log(`Firebase「${projectId}」からデータを読み込みます（Firebaseのデータは変更しません）`)
  const names = ['users', 'logs', 'work_reports', 'session_work_reports', 'config', 'overtime_apps', 'salaried_days']
  const data = {}
  for (const n of names) {
    data[n] = await fetchCollection(n)
    console.log(`  ${n}: ${data[n].length}件`)
  }

  const sql = []
  for (const u of data.users) {
    const { id, ...rest } = u
    // Merge into an existing row instead of replacing it: settings that only exist on
    // Cloudflare (commute method, etc.) survive a second run; Firebase's values win otherwise.
    // null values are dropped: in a JSON merge patch a null would delete the key on the Cloudflare side
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined))
    sql.push(`INSERT INTO users (id, pin, data) VALUES (${q(id)}, ${q(clean.pin || '')}, ${json(clean)}) ` +
      `ON CONFLICT(id) DO UPDATE SET pin = CASE WHEN excluded.pin != '' THEN excluded.pin ELSE users.pin END, ` +
      `data = json_patch(users.data, excluded.data);`)
  }
  for (const l of data.logs) {
    sql.push(
      'INSERT OR REPLACE INTO logs (id, user_id, log_type, date, time, timestamp, work_type, session_id, synced, approved_time, first_work, last_work, transport_count, work_items) VALUES (' +
      [l.id, l.user_id || '', l.log_type || '', l.date || '', l.time || '', l.timestamp || '', l.work_type || '', l.session_id || '',
        Number(l.synced) || 0, l.approved_time ?? null, l.first_work ?? null, l.last_work ?? null,
        l.transport_count != null ? String(l.transport_count) : null].map(q).join(', ') +
      `, ${l.work_items ? json(l.work_items) : 'NULL'});`
    )
  }
  for (const r of data.work_reports) {
    sql.push(`INSERT OR REPLACE INTO work_reports (id, user_id, date, items, updated_at) VALUES (${[r.id, r.userId || '', r.date || ''].map(q).join(', ')}, ${json(r.items)}, ${q(r.updatedAt || '')});`)
  }
  for (const r of data.session_work_reports) {
    sql.push(`INSERT OR REPLACE INTO session_work_reports (id, user_id, date, session_id, items, updated_at) VALUES (${[r.id, r.userId || '', r.date || '', r.sessionId || ''].map(q).join(', ')}, ${json(r.items)}, ${q(r.updatedAt || '')});`)
  }
  const system = data.config.find(c => c.id === 'system') || {}
  // Never replace a PIN / setting that already exists in D1 (set on Cloudflare or by an earlier run)
  if (system.adminPin) sql.push(`INSERT OR IGNORE INTO config (key, value) VALUES ('adminPin', ${q(String(system.adminPin))});`)
  if (system.minWage) sql.push(`INSERT OR IGNORE INTO config (key, value) VALUES ('minWage', ${q(String(system.minWage))});`)
  for (const r of data.overtime_apps) {
    sql.push(`INSERT OR REPLACE INTO overtime_apps (id, user_id, date, minutes) VALUES (${[r.id, r.userId || '', r.date || '', Number(r.minutes) || 0].map(q).join(', ')});`)
  }
  for (const r of data.salaried_days) {
    sql.push(`INSERT OR REPLACE INTO salaried_days (id, user_id, date, break_mins, overtime_mins) VALUES (${[r.id, r.userId || '', r.date || '', Number(r.breakMins) || 0, Number(r.overtimeMins) || 0].map(q).join(', ')});`)
  }

  mkdirSync('migration-output', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = `migration-output/firebase-${projectId}-${stamp}.sql`
  writeFileSync(file, sql.join('\n') + '\n')
  console.log(`SQLファイルを作成しました: ${file}（${sql.length}行）`)

  if (!system.adminPin) {
    console.log('※ Firebaseに管理者PINの設定がなかったため、管理者PINは設定していません（すでにあるPINはそのまま）。なければ node setup-new-client.js で設定してください。')
  }
  if (dryRun) { console.log('--dry-run のためD1には書き込みません'); return }

  console.log(`D1「${dbName}」（${local ? 'ローカル' : '本番'}）にテーブルを用意しています…`)
  d1(['--file=./schema.sql'])
  console.log('データを書き込んでいます…')
  d1([`--file=./${file}`])

  console.log('件数を確認しています…')
  const tables = { users: 'users', logs: 'logs', work_reports: 'work_reports', session_work_reports: 'session_work_reports', overtime_apps: 'overtime_apps', salaried_days: 'salaried_days' }
  const out = d1(['--json', '--command', 'SELECT ' + Object.keys(tables).map(t => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')])
  const counts = parseJson(out)[0].results[0]
  let ok = true
  for (const t of Object.keys(tables)) {
    const same = counts[t] >= data[t].length
    if (!same) ok = false
    console.log(`  ${same ? 'OK ' : 'NG '} ${t}: Firebase ${data[t].length}件 → D1 ${counts[t]}件`)
  }
  console.log(ok ? '移行が完了しました。' : '件数が合わない項目があります。もう一度実行してください。')
  if (!ok) process.exit(1)
}

main().catch(e => { console.error('エラー:', e.message); process.exit(1) })
