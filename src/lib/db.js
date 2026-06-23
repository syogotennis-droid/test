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
import { unzipSync, zipSync } from 'fflate'

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

// Pay items for the new payroll system
export const PAY_ITEMS = [
  'アスレ', 'スイム', 'スイム短期', 'スイムベビー', 'スイム成人',
  'フロント', 'フロント短期', '監視', '監視短期', '研修会',
  '清掃', '事務処理', 'エアロ', 'ドライバー', '選手引率',
  '休憩', '準備', '交通費', '有給', '固定手当'
]

// Items that are not shown on the clock-out work selection screen
export const CLOCK_OUT_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費'])

// Default users seeded on first run
const DEFAULT_USERS = [
  { id: 'USER001', name: '永谷 仁美',      workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理','エアロ'] },
  { id: 'USER002', name: '夫馬 紀子',      workItems: ['スイム','スイム短期','スイム成人','フロント','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER003', name: '木村 千明',      workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理','エアロ'] },
  { id: 'USER004', name: '杉山 健太郎',    workItems: ['ドライバー','研修会'] },
  { id: 'USER005', name: '上出 哲哉',      workItems: ['ドライバー'] },
  { id: 'USER006', name: '加藤 英民',      workItems: ['ドライバー'] },
  { id: 'USER007', name: '福田 伊左男',    workItems: ['ドライバー'] },
  { id: 'USER008', name: '鈴木 和美',      workItems: ['ドライバー'] },
  { id: 'USER009', name: '桐山 健一',      workItems: ['ドライバー'] },
  { id: 'USER010', name: '中山 文香',      workItems: ['フロント','フロント短期','研修会','清掃','事務処理'] },
  { id: 'USER011', name: '東條 曉美',      workItems: ['スイム','スイム短期','スイムベビー','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER012', name: '大澤 京子',      workItems: ['スイム','スイム短期','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER013', name: '田中 真粧美',    workItems: ['フロント','フロント短期','研修会','清掃','事務処理'] },
  { id: 'USER014', name: '野田 陽子',      workItems: ['フロント','フロント短期','研修会','清掃','事務処理'] },
  { id: 'USER015', name: '和田 那美',      workItems: ['アスレ','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER016', name: '鈴木 清隆',      workItems: ['スイム','スイム短期','スイム成人','監視','研修会','清掃','事務処理'] },
  { id: 'USER017', name: '滋野 峰子',      workItems: ['スイム','スイム短期','スイムベビー','研修会','清掃','事務処理'] },
  { id: 'USER018', name: '岡田 利奈',      workItems: ['スイム','スイム短期','スイムベビー','スイム成人','監視','研修会','清掃','事務処理','選手引率'] },
  { id: 'USER019', name: '緒方 幸代',      workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER020', name: 'アルベス・エゴン', workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'] },
  { id: 'USER021', name: '池戸 柊生',      workItems: ['監視','監視短期','清掃','事務処理'] },
  { id: 'USER022', name: '矢野 快晟',      workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'] },
  { id: 'USER023', name: '山田 亜美',      workItems: ['フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'] },
  { id: 'USER024', name: '市野 圭子',      workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'] },
]

export async function initDB() {
  const snap = await getDocs(usersCol)
  if (snap.empty) {
    const batch = writeBatch(db)
    DEFAULT_USERS.forEach(u => {
      batch.set(doc(db, 'users', u.id), { name: u.name, workItems: u.workItems || [] })
    })
    await batch.commit()
  }
}

export async function resolveUser(qrValue) {
  const d = await getDoc(doc(db, 'users', qrValue))
  if (!d.exists()) return null
  return { id: d.id, ...d.data() }
}

export async function saveLog({ userId, workType, workItems, logType, transportCount }) {
  const now = new Date()
  const timestamp = now.toISOString()
  const date = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const workTypeStr = workItems
    ? Object.entries(workItems).filter(([, m]) => m > 0).map(([t, m]) => `${t}:${m}`).join(',')
    : (workType || '')
  const logData = {
    user_id: userId,
    work_type: workTypeStr,
    log_type: logType || '',
    timestamp,
    date,
    time,
    synced: 0
  }
  if (workItems) logData.work_items = workItems
  if (transportCount) logData.transport_count = transportCount
  const ref = await addDoc(logsCol, logData)
  return ref.id
}

// Parse work_items from a log entry (handles both new object and legacy string format)
export function getWorkItems(log) {
  if (log?.work_items) return { ...log.work_items }
  if (!log?.work_type) return {}
  const result = {}
  log.work_type.split(',').forEach(entry => {
    const [t, m] = entry.split(':')
    if (t?.trim()) result[t.trim()] = Number(m) || 0
  })
  return result
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
// Uses direct ZIP/XML manipulation to preserve all template styles exactly
export async function exportKinmubo({ dateFrom, dateTo } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()

  const [ym_y_str, ym_m_str] = (dateFrom || '').split('-')
  const ym_y = Number(ym_y_str)
  const ym_m = Number(ym_m_str)
  const yearMonthLabel = ym_y && ym_m ? `${ym_y}年${ym_m}月` : ''
  const lastDay = new Date(ym_y, ym_m, 0).getDate()

  // Excel date serial: days since Dec 30, 1899
  function excelDate(y, m, d) {
    return Math.round((new Date(y, m - 1, d) - new Date(1899, 11, 30)) / 86400000)
  }
  // Excel time fraction: fraction of 24 hours
  function excelTime(h, mi) { return (h * 60 + mi) / 1440 }
  // XML escape
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // Shared string indices for weekday names (in template sharedStrings.xml):
  // 16=金, 17=土, 18=日, 19=月, 20=火, 21=水, 22=木
  // JS getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const DOW_SST = [18, 19, 20, 21, 22, 16, 17]

  // Style IDs per row type (observed from template + styles.xml analysis)
  // "first" = row 5 (first data row, has top border from header row)
  // sat/sun = Saturday/Sunday coloring, wd = regular weekday
  const ST = {
    first: { A:'10', B:'4',  C:'14', D:'14', E:'16', F:'17', G:'17', H:'21', I:'17', J:'21', K:'17', L:'21', M:'16', N:'24' },
    sat:   { A:'11', B:'6',  C:'15', D:'15', E:'18', F:'19', G:'19', H:'22', I:'19', J:'22', K:'19', L:'22', M:'18', N:'25' },
    sun:   { A:'12', B:'7',  C:'15', D:'15', E:'18', F:'19', G:'19', H:'22', I:'19', J:'22', K:'19', L:'22', M:'18', N:'25' },
    wd:    { A:'13', B:'5',  C:'15', D:'15', E:'18', F:'19', G:'19', H:'22', I:'19', J:'22', K:'19', L:'22', M:'18', N:'25' },
  }

  // Decode base64 template to binary
  const b64 = KINMUBO_TEMPLATE_B64
  const raw = atob(b64)
  const tmplBin = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) tmplBin[i] = raw.charCodeAt(i)

  // Unzip template
  const zipFiles = unzipSync(tmplBin)
  const dec = new TextDecoder()
  const enc = new TextEncoder()

  // Parse sheet1.xml to extract structural parts
  const sheet1Xml = dec.decode(zipFiles['xl/worksheets/sheet1.xml'])
  const sdStart = sheet1Xml.indexOf('<sheetData>')
  const sdEnd = sheet1Xml.indexOf('</sheetData>') + '</sheetData>'.length
  const beforeData = sheet1Xml.substring(0, sdStart)
  const afterData = sheet1Xml.substring(sdEnd)

  // Extract row 4 (header row) and row 36 (totals row) from template
  const row4xml = sheet1Xml.match(/<row r="4"[^>]*>[\s\S]*?<\/row>/)?.[0] || ''
  let row36xml = sheet1Xml.match(/<row r="36"[^>]*>[\s\S]*?<\/row>/)?.[0] || ''
  // Adjust SUM range in row 36 for months shorter than 31 days
  if (lastDay < 31) {
    row36xml = row36xml.replace(
      /(<f t="shared" ref="E36:N36" si="3">)SUM\(E5:E35\)(<\/f>)/,
      `$1SUM(E5:E${4 + lastDay})$2`
    )
  }

  const userEntries = users.filter(u => logs.some(l => l.user_id === u.id))
  const sheetXmls = []

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

    // Row 1: title as inline string (avoids shared-string index conflicts across sheets)
    const row1 = `<row r="1" spans="1:14" ht="25.65" customHeight="1" x14ac:dyDescent="0.2">` +
      `<c r="A1" s="27" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 出勤簿')}</t></is></c>` +
      `<c r="B1" s="27"/><c r="C1" s="27"/><c r="D1" s="27"/><c r="E1" s="27"/>` +
      `<c r="F1" s="27"/><c r="G1" s="27"/><c r="H1" s="27"/><c r="I1" s="27"/>` +
      `<c r="J1" s="27"/><c r="K1" s="27"/><c r="L1" s="27"/><c r="M1" s="27"/><c r="N1" s="27"/>` +
      `</row>`

    // Row 2: user name as inline string
    const row2 = `<row r="2" spans="1:14" ht="19.2" customHeight="1" x14ac:dyDescent="0.2">` +
      `<c r="A2" s="28" t="inlineStr"><is><t>${esc('担当者：' + user.name)}</t></is></c>` +
      `<c r="B2" s="28"/><c r="C2" s="28"/><c r="D2" s="28"/><c r="E2" s="28"/>` +
      `<c r="F2" s="28"/><c r="G2" s="28"/><c r="H2" s="28"/><c r="I2" s="28"/><c r="J2" s="28"/>` +
      `<c r="K2" s="29"/><c r="L2" s="29"/><c r="M2" s="29"/><c r="N2" s="29"/>` +
      `</row>`

    // Build data rows 5-35 (days 1-31)
    const dataRows = []
    for (let d = 1; d <= 31; d++) {
      const r = d + 4
      const isFirst = d === 1
      const isValid = d <= lastDay
      const dow = isValid ? new Date(ym_y, ym_m - 1, d).getDay() : 1
      const st = isFirst ? ST.first : (dow === 6 ? ST.sat : dow === 0 ? ST.sun : ST.wd)

      // Shared formulas (row 5 carries the definition, others reference it)
      const eF = isFirst
        ? `<f t="shared" ref="E5:E35" si="0">IF(OR(C5=&quot;&quot;,D5=&quot;&quot;),&quot;&quot;,MAX(0,MOD(D5-C5,1)*24-F5))</f><v/>`
        : `<f t="shared" si="0"/><v/>`
      const mF = isFirst
        ? `<f t="shared" ref="M5:M35" si="1">IF(SUM(G5,I5,K5)=0,&quot;&quot;,SUM(G5,I5,K5))</f><v/>`
        : `<f t="shared" si="1"/><v/>`
      const nF = isFirst
        ? `<f t="shared" ref="N5:N35" si="2">IF(SUM(H5,J5,L5)=0,&quot;&quot;,SUM(H5,J5,L5))</f><v/>`
        : `<f t="shared" si="2"/><v/>`

      // Date and weekday cells
      const aC = isValid ? `<c r="A${r}" s="${st.A}"><v>${excelDate(ym_y, ym_m, d)}</v></c>` : `<c r="A${r}" s="${st.A}"/>`
      const bC = isValid ? `<c r="B${r}" s="${st.B}" t="s"><v>${DOW_SST[dow]}</v></c>` : `<c r="B${r}" s="${st.B}"/>`

      let cC = `<c r="C${r}" s="${st.C}"/>`, dC = `<c r="D${r}" s="${st.D}"/>`
      let fC = `<c r="F${r}" s="${st.F}"/>`
      let gC = `<c r="G${r}" s="${st.G}"/>`, hC = `<c r="H${r}" s="${st.H}"/>`
      let iC = `<c r="I${r}" s="${st.I}"/>`, jC = `<c r="J${r}" s="${st.J}"/>`
      let kC = `<c r="K${r}" s="${st.K}"/>`, lC = `<c r="L${r}" s="${st.L}"/>`

      if (isValid) {
        const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
        const entry = byDate[dateStr]
        const inStr = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
        const outStr = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''

        if (inStr) {
          const [h, mi] = inStr.split(':').map(Number)
          cC = `<c r="C${r}" s="${st.C}"><v>${excelTime(h, mi)}</v></c>`
        }
        if (outStr) {
          const [h, mi] = outStr.split(':').map(Number)
          dC = `<c r="D${r}" s="${st.D}"><v>${excelTime(h, mi)}</v></c>`
        }

        const workMins = parseWorkMins(entry?.workType || '')
        const kyukeiMins = workMins['休憩'] > 0 ? workMins['休憩'] : 0
        const totalMins = (inStr && outStr) ? Math.max(0, timeDiffMins(inStr, outStr)) : 0

        if (kyukeiMins > 0) {
          fC = `<c r="F${r}" s="${st.F}"><v>${kyukeiMins / 60}</v></c>`
        }

        const PAID = [
          { type: '現場', tC: 'G', wC: 'H' },
          { type: '清掃', tC: 'I', wC: 'J' },
          { type: '事務', tC: 'K', wC: 'L' },
        ]
        const zeroTypes = PAID.map(p => p.type).filter(t => workMins[t] === 0)
        const typeMins = t => {
          if (workMins[t] === null) return 0
          if (workMins[t] > 0) return workMins[t]
          return zeroTypes.length === 1 ? totalMins : 0
        }
        for (const { type, tC, wC } of PAID) {
          if (workMins[type] === null) continue
          const tm = typeMins(type)
          if (tm > 0) {
            const rate = Number(userRates[type]) || 0
            if (tC === 'G') {
              gC = `<c r="G${r}" s="${st.G}"><v>${tm / 60}</v></c>`
              if (rate > 0) hC = `<c r="H${r}" s="${st.H}"><v>${Math.round(tm / 60 * rate)}</v></c>`
            } else if (tC === 'I') {
              iC = `<c r="I${r}" s="${st.I}"><v>${tm / 60}</v></c>`
              if (rate > 0) jC = `<c r="J${r}" s="${st.J}"><v>${Math.round(tm / 60 * rate)}</v></c>`
            } else if (tC === 'K') {
              kC = `<c r="K${r}" s="${st.K}"><v>${tm / 60}</v></c>`
              if (rate > 0) lC = `<c r="L${r}" s="${st.L}"><v>${Math.round(tm / 60 * rate)}</v></c>`
            }
          }
        }
      }

      dataRows.push(
        `<row r="${r}" spans="1:14" ht="17.55" customHeight="1" x14ac:dyDescent="0.2">` +
        `${aC}${bC}${cC}${dC}` +
        `<c r="E${r}" s="${st.E}" t="str">${eF}</c>` +
        `${fC}${gC}${hC}${iC}${jC}${kC}${lC}` +
        `<c r="M${r}" s="${st.M}" t="str">${mF}</c>` +
        `<c r="N${r}" s="${st.N}" t="str">${nF}</c>` +
        `</row>`
      )
    }

    const sheetData = `<sheetData>${row1}${row2}${row4xml}${dataRows.join('')}${row36xml}</sheetData>`
    sheetXmls.push(beforeData + sheetData + afterData)
  }

  // Fall back to template if no users with logs
  if (sheetXmls.length === 0) return tmplBin

  // Build output ZIP (copy all template files, then override changed ones)
  const out = { ...zipFiles }

  // Remove cached calculation chain to force Excel to recalculate
  delete out['xl/calcChain.xml']

  // Write sheet XMLs (sheet1.xml, sheet2.xml, ...)
  for (let i = 0; i < sheetXmls.length; i++) {
    out[`xl/worksheets/sheet${i + 1}.xml`] = enc.encode(sheetXmls[i])
  }

  // Update workbook.xml: replace <sheets> list and force full recalc on open
  let wbXml = dec.decode(zipFiles['xl/workbook.xml'])
  const sheetsEl = userEntries
    .map((u, i) => `<sheet name="${esc(u.name.substring(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  wbXml = wbXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsEl}</sheets>`)
  // fullCalcOnLoad forces Excel to recalculate all formulas when opening
  if (!wbXml.includes('fullCalcOnLoad')) {
    wbXml = wbXml.replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"')
  }
  out['xl/workbook.xml'] = enc.encode(wbXml)

  // Update workbook.xml.rels: list sheets + non-sheet relationships
  const N = userEntries.length
  const WB_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const sheetRels = userEntries
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${WB_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')
  const otherRels = [
    `<Relationship Id="rId${N + 1}" Type="${WB_REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId${N + 2}" Type="${WB_REL}/theme" Target="theme/theme1.xml"/>`,
    `<Relationship Id="rId${N + 3}" Type="${WB_REL}/sharedStrings" Target="sharedStrings.xml"/>`,
  ].join('')
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}">${sheetRels}${otherRels}</Relationships>`
  out['xl/_rels/workbook.xml.rels'] = enc.encode(wbRels)

  // Update [Content_Types].xml: list all sheets
  const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  const sheetCTs = userEntries
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${WS_CT}"/>`)
    .join('')
  const ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetCTs +
    `<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`
  out['[Content_Types].xml'] = enc.encode(ctXml)

  return zipSync(out, { level: 6 })
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
