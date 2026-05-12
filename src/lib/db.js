import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch
} from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { KINMUBO_TEMPLATE_B64 } from './kinmuboTemplate'
import ExcelJS from 'exceljs'

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAoLuEhUlS3XAqdhPD9nvp_AsdzMjTU09Y",
  authDomain: "qr-pool-40e16.firebaseapp.com",
  projectId: "qr-pool-40e16",
  storageBucket: "qr-pool-40e16.firebasestorage.app",
  messagingSenderId: "578421460230",
  appId: "1:578421460230:web:f52000ecca29083624a287"
}

const firebaseApp = initializeApp(firebaseConfig)
const db = getFirestore(firebaseApp)

const usersCol = collection(db, 'users')
const logsCol = collection(db, 'logs')

function getTodayDate() {
  return new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
}

// Default users seeded on first run
const DEFAULT_USERS = [
  { id: 'USER001', name: '田中 太郎' },
  { id: 'USER002', name: '鈴木 花子' },
  { id: 'USER003', name: '佐藤 次郎' },
  { id: 'USER004', name: '山田 三郎' },
  { id: 'USER005', name: '伊藤 四郎' },
  { id: 'USER006', name: '渡辺 五郎' },
  { id: 'USER007', name: '中村 六郎' },
  { id: 'USER008', name: '小林 七郎' },
  { id: 'USER009', name: '加藤 八郎' },
  { id: 'USER010', name: '吉田 九郎' }
]

export async function initDB() {
  const snap = await getDocs(usersCol)
  if (snap.empty) {
    const batch = writeBatch(db)
    DEFAULT_USERS.forEach(u => {
      batch.set(doc(db, 'users', u.id), { name: u.name })
    })
    await batch.commit()
  }
}

export async function resolveUser(qrValue) {
  const d = await getDoc(doc(db, 'users', qrValue))
  if (!d.exists()) return null
  return { id: d.id, ...d.data() }
}

export async function saveLog({ userId, workType, logType }) {
  const now = new Date()
  const timestamp = now.toISOString()
  const date = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const ref = await addDoc(logsCol, {
    user_id: userId,
    work_type: workType || '',
    log_type: logType || workType || '',
    timestamp,
    date,
    time,
    synced: 0
  })
  return ref.id
}

export async function getClockInTime(userId) {
  const today = getTodayDate()
  const q = query(logsCol, where('date', '==', today))
  const snap = await getDocs(q)
  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(l => l.user_id === userId && l.log_type === '出勤')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  return logs.length > 0 ? logs[logs.length - 1] : null
}

export async function getClockInTimeForDate(userId, date) {
  const q = query(logsCol, where('date', '==', date))
  const snap = await getDocs(q)
  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(l => l.user_id === userId && l.log_type === '出勤')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  return logs.length > 0 ? logs[logs.length - 1] : null
}

export async function isCheckedIn(userId) {
  const today = getTodayDate()
  const q = query(logsCol, where('date', '==', today))
  const snap = await getDocs(q)
  const logs = snap.docs.map(d => d.data()).filter(l => l.user_id === userId)
  const ins = logs.filter(l => l.log_type === '出勤').length
  const outs = logs.filter(l => l.log_type === '退勤').length
  return ins > outs
}

export async function getLogs({ date, dateFrom, dateTo, userId } = {}) {
  let q
  if (dateFrom && dateTo) {
    q = query(logsCol, where('date', '>=', dateFrom), where('date', '<=', dateTo))
  } else if (dateFrom) {
    q = query(logsCol, where('date', '>=', dateFrom))
  } else if (dateTo) {
    q = query(logsCol, where('date', '<=', dateTo))
  } else {
    q = query(logsCol)
  }
  const snap = await getDocs(q)
  let results = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  if (date) results = results.filter(l => l.date === date)
  if (userId) results = results.filter(l => l.user_id === userId)
  return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}

export async function getUsers() {
  const snap = await getDocs(usersCol)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function upsertUser(user) {
  const { id, ...data } = user
  await setDoc(doc(db, 'users', id), data, { merge: true })
}

export async function deleteUser(id) {
  const q = query(logsCol, where('user_id', '==', id))
  const snap = await getDocs(q)
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, 'users', id))
  await batch.commit()
}

export async function deleteLog(id) {
  await deleteDoc(doc(db, 'logs', id))
}

export async function seedSampleData() {
  const users = await getUsers()
  if (users.length === 0) return 0

  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setMonth(start.getMonth() - 3)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  const SEED_TYPES = ['現場', '清掃', '事務']

  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
  function pad(n) { return String(n).padStart(2, '0') }
  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

  const allDocs = []

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    const workRate = (dow === 0 || dow === 6) ? 0.15 : 0.72

    for (const user of users) {
      if (Math.random() > workRate) continue

      const dateStr = fmtDate(d)
      const inH = rnd(8, 9)
      const inM = inH === 9 ? rnd(0, 30) : rnd(0, 59)
      const outH = rnd(17, 19)
      const outM = outH === 19 ? rnd(0, 30) : rnd(0, 59)
      const totalMins = (outH * 60 + outM) - (inH * 60 + inM)

      const typeCount = Math.random() < 0.4 ? 2 : 1
      const shuffled = [...SEED_TYPES].sort(() => Math.random() - 0.5)
      const chosen = shuffled.slice(0, typeCount)
      const workTypeStr = typeCount === 1
        ? `${chosen[0]}:${totalMins}`
        : (() => {
            const split = rnd(Math.floor(totalMins * 0.3), Math.floor(totalMins * 0.7))
            return `${chosen[0]}:${split},${chosen[1]}:${totalMins - split}`
          })()

      const inDt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), inH, inM, 0)
      const outDt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), outH, outM, 0)

      allDocs.push({ user_id: user.id, work_type: '', log_type: '出勤', timestamp: inDt.toISOString(), date: dateStr, time: `${pad(inH)}:${pad(inM)}:00`, synced: 0 })
      allDocs.push({ user_id: user.id, work_type: workTypeStr, log_type: '退勤', timestamp: outDt.toISOString(), date: dateStr, time: `${pad(outH)}:${pad(outM)}:00`, synced: 0 })
    }
  }

  for (let i = 0; i < allDocs.length; i += 400) {
    const batch = writeBatch(db)
    allDocs.slice(i, i + 400).forEach(data => batch.set(doc(logsCol), data))
    await batch.commit()
  }

  return allDocs.length
}

export async function getTodayStatuses() {
  const today = getTodayDate()
  const q = query(logsCol, where('date', '==', today))
  const snap = await getDocs(q)
  const groups = {}
  snap.docs.forEach(d => {
    const l = d.data()
    if (!groups[l.user_id]) groups[l.user_id] = { ins: 0, outs: 0 }
    if (l.log_type === '出勤') groups[l.user_id].ins++
    else if (l.log_type === '退勤') groups[l.user_id].outs++
  })
  const result = {}
  for (const [uid, g] of Object.entries(groups)) {
    result[uid] = g.ins > g.outs
  }
  return result
}

export async function saveLogManual({ userId, workType, logType, date, time }) {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = time.split(':').map(Number)
  const dt = new Date(y, mo - 1, d, h, m, 0)
  await addDoc(logsCol, {
    user_id: userId,
    work_type: workType || '',
    log_type: logType,
    timestamp: dt.toISOString(),
    date,
    time: time + ':00',
    synced: 0
  })
}

export async function updateLogTime(id, timeStr) {
  const d = await getDoc(doc(db, 'logs', id))
  if (!d.exists()) return
  const logData = d.data()
  const [year, month, day] = logData.date.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  const dt = new Date(year, month - 1, day, h, m, 0)
  await updateDoc(doc(db, 'logs', id), {
    time: timeStr + ':00',
    timestamp: dt.toISOString()
  })
}

// ─── Excel export helpers ──────────────────────────────────────────────────────

function formatWorkType(wt) {
  if (!wt) return ''
  return wt.split(',').map(entry => {
    const [type, mins] = entry.split(':')
    if (mins === undefined) return type
    const h = Math.floor(Number(mins) / 60)
    const m = Number(mins) % 60
    return h > 0 ? `${type} ${h}時間${m}分` : `${type} ${m}分`
  }).join(' / ')
}

const KINMUBO_PAID_TYPES = ['現場', '清掃', '事務']

function minsToHM(mins) {
  if (!mins || mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

function timeDiffMins(t1, t2) {
  const [h1, m1] = t1.split(':').map(Number)
  const [h2, m2] = t2.split(':').map(Number)
  return (h2 * 60 + m2) - (h1 * 60 + m1)
}

function parseWorkMins(workType) {
  const result = {}
  ;['現場', '清掃', '事務', '休憩'].forEach(t => { result[t] = null })
  if (!workType) return result
  workType.split(',').forEach(entry => {
    const parts = entry.split(':')
    const type = parts[0].trim()
    if (type in result) {
      result[type] = parts.length > 1 ? Number(parts[1]) : 0
    }
  })
  return result
}

// Export monthly attendance register (出勤簿) as XLSX
// Uses exceljs to fully preserve template styles/borders
export async function exportKinmubo({ dateFrom, dateTo } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()

  const [ym_y_str, ym_m_str] = (dateFrom || '').split('-')
  const ym_y = Number(ym_y_str)
  const ym_m = Number(ym_m_str)
  const yearMonthLabel = ym_y && ym_m ? `${ym_y}年${ym_m}月` : ''
  const lastDay = new Date(ym_y, ym_m, 0).getDate()
  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

  // base64 → ArrayBuffer
  const b64 = KINMUBO_TEMPLATE_B64
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const templateBuffer = bytes.buffer

  // ひな型を読み込んでワークブックを作成
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(templateBuffer)
  const tmplSheet = wb.worksheets[0]

  // ユーザーごとにひな型シートをコピーして作成
  const userEntries = users.filter(u => logs.some(l => l.user_id === u.id))

  if (userEntries.length === 0) {
    // データなし: ひな型をそのまま返す
    return wb.xlsx.writeBuffer()
  }

  for (const user of userEntries) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    const userRates = user.rates || {}

    const byDate = {}
    userLogs.forEach(log => {
      if (!byDate[log.date]) byDate[log.date] = { ins: [], outs: [], workType: '' }
      if (log.log_type === '出勤') byDate[log.date].ins.push(log.time || '')
      else if (log.log_type === '退勤') {
        byDate[log.date].outs.push(log.time || '')
        if (log.work_type) byDate[log.date].workType = log.work_type
      }
    })

    // 新しいシートを追加してひな型の内容をコピー
    const ws = wb.addWorksheet(user.name.substring(0, 31))

    // 列幅をコピー
    tmplSheet.columns.forEach((col, i) => {
      const newCol = ws.getColumn(i + 1)
      if (col.width) newCol.width = col.width
    })

    // 全セルをコピー（値・スタイル・数式）
    tmplSheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
      const newRow = ws.getRow(rowNum)
      if (row.height) newRow.height = row.height
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const newCell = newRow.getCell(colNum)
        // 数式はそのままコピー（キャッシュ結果は除く）
        if (cell.type === ExcelJS.ValueType.Formula) {
          newCell.value = { formula: cell.value.formula }
        } else {
          newCell.value = cell.value
        }
        // スタイルをディープコピー
        if (cell.style) newCell.style = JSON.parse(JSON.stringify(cell.style))
      })
      newRow.commit()
    })

    // マージセルをコピー
    tmplSheet.model.merges && tmplSheet.model.merges.forEach(merge => {
      ws.mergeCells(merge)
    })

    // ── データを書き込む ──

    // タイトル・担当者名
    ws.getCell('A1').value = `${yearMonthLabel} 出勤簿`
    ws.getCell('A2').value = `担当者：${user.name}`

    const DATA_COLS = ['C', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

    for (let d = 1; d <= 31; d++) {
      const r = 4 + d

      if (d > lastDay) {
        // 月の日数を超えた行は日付・曜日をクリア
        ws.getCell(`A${r}`).value = null
        ws.getCell(`B${r}`).value = null
        DATA_COLS.forEach(c => { ws.getCell(`${c}${r}`).value = null })
        continue
      }

      const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
      const dow = new Date(ym_y, ym_m - 1, d).getDay()

      // 日付（Date型で渡すとexceljsが正しくシリアル変換）
      ws.getCell(`A${r}`).value = new Date(ym_y, ym_m - 1, d)
      ws.getCell(`B${r}`).value = DAY_NAMES[dow]

      // データセルを一旦クリア
      DATA_COLS.forEach(c => { ws.getCell(`${c}${r}`).value = null })

      const entry = byDate[dateStr]
      const inStr  = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
      const outStr = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''

      // 出退勤時刻（Excelの時刻シリアル値）
      if (inStr) {
        const [h, mi] = inStr.split(':').map(Number)
        const cell = ws.getCell(`C${r}`)
        cell.value = (h * 60 + mi) / 1440
        cell.numFmt = 'hh:mm'
      }
      if (outStr) {
        const [h, mi] = outStr.split(':').map(Number)
        const cell = ws.getCell(`D${r}`)
        cell.value = (h * 60 + mi) / 1440
        cell.numFmt = 'hh:mm'
      }

      const workMins = parseWorkMins(entry?.workType || '')
      const kyukeiMins = workMins['休憩'] > 0 ? workMins['休憩'] : 0
      const totalMins = (inStr && outStr) ? Math.max(0, timeDiffMins(inStr, outStr)) : 0

      if (kyukeiMins > 0) ws.getCell(`F${r}`).value = Math.round(kyukeiMins) / 60

      const PAID = [
        { type: '現場', tCol: 'G', wCol: 'H' },
        { type: '清掃', tCol: 'I', wCol: 'J' },
        { type: '事務', tCol: 'K', wCol: 'L' },
      ]
      const zeroTypes = PAID.map(p => p.type).filter(t => workMins[t] === 0)
      const getTypeMins = t => {
        if (workMins[t] === null) return 0
        if (workMins[t] > 0) return workMins[t]
        return zeroTypes.length === 1 ? totalMins : 0
      }
      for (const { type, tCol, wCol } of PAID) {
        if (workMins[type] === null) continue
        const tMins = getTypeMins(type)
        if (tMins > 0) {
          ws.getCell(`${tCol}${r}`).value = Math.round(tMins) / 60
          const rate = Number(userRates[type]) || 0
          if (rate > 0) ws.getCell(`${wCol}${r}`).value = Math.round(tMins / 60 * rate)
        }
      }

      // 月が31日未満の場合、合計行のSUM範囲を調整
      if (lastDay < 31) {
        const lastDataRow = 4 + lastDay
        for (const col of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']) {
          ws.getCell(`${col}36`).value = { formula: `SUM(${col}5:${col}${lastDataRow})` }
        }
      }
    }
  }

  // ひな型の元シート（最初のシート）を削除
  wb.removeWorksheet(tmplSheet.id)

  return wb.xlsx.writeBuffer()
}

export async function exportXLSX({ dateFrom, dateTo, userId } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]))

  const wb = XLSX.utils.book_new()
  const targetUsers = userId ? users.filter(u => u.id === userId) : users

  for (const user of targetUsers) {
    const userLogs = logs
      .filter(l => l.user_id === user.id)
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))

    if (userLogs.length === 0 && !userId) continue

    const header = ['ID', 'ユーザーID', '氏名', '種別', '作業内容', '日付', '時刻']
    const rows = userLogs.map(log => [
      log.id,
      log.user_id,
      userMap[log.user_id] || '',
      log.log_type || '',
      formatWorkType(log.work_type),
      log.date,
      log.time || ''
    ])

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    XLSX.utils.book_append_sheet(wb, ws, user.name.substring(0, 31))
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['データなし']]), 'データなし')
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

export default db
