import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
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
import { zipSync } from 'fflate'

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCKm6AYwlgw9aAtY4xICdbLcmIz6ZuMb3o",
  authDomain: "kamiyashiro-swim-c6f20.firebaseapp.com",
  projectId: "kamiyashiro-swim-c6f20",
  storageBucket: "kamiyashiro-swim-c6f20.firebasestorage.app",
  messagingSenderId: "340386787852",
  appId: "1:340386787852:web:1fc745bde363c4b7347429"
}

const firebaseApp = initializeApp(firebaseConfig)
let db
try {
  db = initializeFirestore(firebaseApp, { localCache: persistentLocalCache() })
} catch {
  db = getFirestore(firebaseApp)
}

const usersCol = collection(db, 'users')
const logsCol = collection(db, 'logs')
const configDocRef = doc(db, 'config', 'system')

export const DEFAULT_ADMIN_PIN = '260701'

export async function getAdminPin() {
  try {
    const snap = await getDoc(configDocRef)
    if (snap.exists() && snap.data()?.adminPin) return snap.data().adminPin
  } catch {}
  return DEFAULT_ADMIN_PIN
}

export async function saveAdminPin(newPin) {
  await setDoc(configDocRef, { adminPin: newPin }, { merge: true })
}

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
  { id: 'USER001', name: '永谷 仁美', workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理','エアロ'],
    itemRates: { 'アスレ':{normal:1480,sunday:1628},'スイム':{normal:1480,sunday:1776},'スイム短期':{normal:1628},'スイムベビー':{normal:1480,sunday:1628},'スイム成人':{normal:1480,sunday:1628},'フロント':{normal:1480,sunday:1628},'フロント短期':{normal:1628},'監視':{normal:1480,sunday:1628},'監視短期':{normal:1628},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'エアロ':{normal:1480,sunday:1628},'準備':{normal:1140},'交通費':{amount:1140} } },
  { id: 'USER002', name: '夫馬 紀子', workItems: ['スイム','スイム短期','スイム成人','フロント','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1420,sunday:1704},'スイム短期':{normal:1562},'スイム成人':{normal:1420,sunday:1562},'フロント':{normal:1420,sunday:1562},'監視':{normal:1420,sunday:1562},'監視短期':{normal:1562},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:1140} } },
  { id: 'USER003', name: '木村 千明', workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理','エアロ'],
    itemRates: { 'アスレ':{normal:1420,sunday:1562},'スイム':{normal:1420,sunday:1704},'スイム短期':{normal:1562},'スイムベビー':{normal:1420,sunday:1562},'スイム成人':{normal:1420,sunday:1562},'フロント':{normal:1420,sunday:1562},'フロント短期':{normal:1540},'監視':{normal:1420,sunday:1562},'監視短期':{normal:1562},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'エアロ':{normal:1420,sunday:1562},'準備':{normal:1140},'交通費':{amount:135.3} } },
  { id: 'USER004', name: '杉山 健太郎', workItems: ['ドライバー','研修会'],
    itemRates: { 'ドライバー':{normal:1500},'研修会':{normal:1000},'準備':{normal:1140} } },
  { id: 'USER005', name: '上出 哲哉', workItems: ['ドライバー'],
    itemRates: { 'ドライバー':{normal:1300},'準備':{normal:1140},'交通費':{amount:86.1} } },
  { id: 'USER006', name: '加藤 英民', workItems: ['ドライバー'],
    itemRates: { 'ドライバー':{normal:1500},'準備':{normal:1140},'交通費':{amount:492} } },
  { id: 'USER007', name: '福田 伊左男', workItems: ['ドライバー'],
    itemRates: { 'ドライバー':{normal:1300},'準備':{normal:1140},'交通費':{amount:360.8} } },
  { id: 'USER008', name: '鈴木 和美', workItems: ['ドライバー'],
    itemRates: { 'ドライバー':{normal:1500},'準備':{normal:1140},'交通費':{amount:106.6} } },
  { id: 'USER009', name: '桐山 健一', workItems: ['ドライバー'],
    itemRates: { 'ドライバー':{normal:1300},'準備':{normal:1140},'交通費':{amount:492} } },
  { id: 'USER010', name: '中山 文香', workItems: ['フロント','フロント短期','研修会','清掃','事務処理'],
    itemRates: { 'フロント':{normal:1390,sunday:1529},'フロント短期':{normal:1529},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER011', name: '東條 曉美', workItems: ['スイム','スイム短期','スイムベビー','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1154,sunday:1384.8},'スイム短期':{normal:1269.4},'スイムベビー':{normal:1040,sunday:1144},'フロント':{normal:1230,sunday:1353},'フロント短期':{normal:1353},'監視':{normal:1230,sunday:1353},'監視短期':{normal:1353},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER012', name: '大澤 京子', workItems: ['スイム','スイム短期','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1140,sunday:1368},'スイム短期':{normal:1254},'フロント':{normal:1410,sunday:1551},'フロント短期':{normal:1551},'監視':{normal:1380,sunday:1518},'監視短期':{normal:1518},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER013', name: '田中 真粧美', workItems: ['フロント','フロント短期','研修会','清掃','事務処理'],
    itemRates: { 'フロント':{normal:1280,sunday:1408},'フロント短期':{normal:1408},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:400} } },
  { id: 'USER014', name: '野田 陽子', workItems: ['フロント','フロント短期','研修会','清掃','事務処理'],
    itemRates: { 'フロント':{normal:1154,sunday:1269.4},'フロント短期':{normal:1269.4},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER015', name: '和田 那美', workItems: ['アスレ','フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'アスレ':{normal:1154,sunday:1269.4},'フロント':{normal:1154,sunday:1269.4},'フロント短期':{normal:1269.4},'監視':{normal:1154,sunday:1269.4},'監視短期':{normal:1269.4},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER016', name: '鈴木 清隆', workItems: ['スイム','スイム短期','スイム成人','監視','研修会','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1420,sunday:1704},'スイム短期':{normal:1562},'スイム成人':{normal:1420,sunday:1562},'監視':{normal:1090,sunday:1199},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:200.9} } },
  { id: 'USER017', name: '滋野 峰子', workItems: ['スイム','スイム短期','スイムベビー','研修会','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1140,sunday:1368},'スイム短期':{normal:1254},'スイムベビー':{normal:1154,sunday:1269.4},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:1020} } },
  { id: 'USER018', name: '岡田 利奈', workItems: ['スイム','スイム短期','スイムベビー','スイム成人','監視','研修会','清掃','事務処理','選手引率'],
    itemRates: { 'スイム':{normal:1350,sunday:1620},'スイム短期':{normal:1485},'スイムベビー':{normal:1350,sunday:1485},'スイム成人':{normal:1350,sunday:1485},'監視':{normal:1350,sunday:1485},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'選手引率':{normal:1140},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER019', name: '緒方 幸代', workItems: ['アスレ','スイム','スイム短期','スイムベビー','スイム成人','フロント','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'アスレ':{normal:1470,sunday:1617},'スイム':{normal:1470,sunday:1764},'スイム短期':{normal:1764},'スイムベビー':{normal:1470,sunday:1617},'スイム成人':{normal:1470,sunday:1617},'フロント':{normal:1470,sunday:1617},'監視':{normal:1470,sunday:1617},'監視短期':{normal:1617},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:840} } },
  { id: 'USER020', name: 'アルベス・エゴン', workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1140,sunday:1368},'スイム短期':{normal:1254},'監視':{normal:1140,sunday:1254},'監視短期':{normal:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER021', name: '池戸 柊生', workItems: ['監視','監視短期','清掃','事務処理'],
    itemRates: { '監視':{normal:1140,sunday:1254},'監視短期':{normal:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER022', name: '矢野 快晟', workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1140,sunday:1368},'スイム短期':{normal:1254},'監視':{normal:1140,sunday:1254},'監視短期':{normal:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:1210} } },
  { id: 'USER023', name: '山田 亜美', workItems: ['フロント','フロント短期','監視','監視短期','研修会','清掃','事務処理'],
    itemRates: { 'フロント':{normal:1140,sunday:1254},'フロント短期':{normal:1254},'監視':{normal:1140,sunday:1254},'監視短期':{normal:1254},'研修会':{normal:1140,sunday:1254},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:0} } },
  { id: 'USER024', name: '市野 圭子', workItems: ['スイム','スイム短期','監視','監視短期','清掃','事務処理'],
    itemRates: { 'スイム':{normal:1400,sunday:1680},'スイム短期':{normal:1540},'監視':{normal:1400,sunday:1540},'監視短期':{normal:1540},'清掃':{normal:1140,sunday:1254},'事務処理':{normal:1140,sunday:1254},'準備':{normal:1140},'交通費':{amount:492} } },
]

export async function initDB() {
  const snap = await getDocs(usersCol)
  const existing = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]))
  const batch = writeBatch(db)
  let hasChanges = false

  DEFAULT_USERS.forEach(u => {
    const cur = existing[u.id]
    if (!cur) return
    if (!cur.workItems || cur.workItems.length === 0) {
      batch.update(doc(db, 'users', u.id), { workItems: u.workItems || [], itemRates: u.itemRates || {} })
      hasChanges = true
    } else if (!cur.itemRates) {
      batch.update(doc(db, 'users', u.id), { itemRates: u.itemRates || {} })
      hasChanges = true
    }
  })

  if (hasChanges) await batch.commit()
}

export async function resolveUser(qrValue) {
  const d = await getDoc(doc(db, 'users', qrValue))
  if (!d.exists()) return null
  return { id: d.id, ...d.data() }
}

export async function resolveUserByPin(pin) {
  if (!pin) return null
  const q = query(collection(db, 'users'), where('pin', '==', pin))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
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
  const q = query(logsCol, where('user_id', '==', userId))
  const snap = await getDocs(q)
  const logs = snap.docs.map(d => d.data()).filter(l => l.date === today)
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

// Export monthly attendance register (出勤簿) as XLSX
// Fully dynamic columns: one sheet per user, time and pay sections separated
export async function exportKinmubo({ dateFrom, dateTo } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()

  const [ym_y_str, ym_m_str] = (dateFrom || '').split('-')
  const ym_y = Number(ym_y_str)
  const ym_m = Number(ym_m_str)
  const yearMonthLabel = ym_y && ym_m ? `${ym_y}年${ym_m}月` : ''
  const lastDay = new Date(ym_y, ym_m, 0).getDate()

  function excelDate(y, m, d) {
    return Math.round((new Date(y, m - 1, d) - new Date(1899, 11, 30)) / 86400000)
  }
  function excelTime(h, mi) { return (h * 60 + mi) / 1440 }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  // Convert 0-based column index to Excel letter(s): 0→A, 25→Z, 26→AA …
  function colLetter(n) {
    let s = '', m = n + 1
    while (m > 0) { m--; s = String.fromCharCode(65 + m % 26) + s; m = Math.floor(m / 26) }
    return s
  }

  const EXCL = new Set(['休憩', '準備', '有給', '固定手当', '交通費'])
  const DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土']

  // Cell style indices (matching cellXfs order in STYLES_XML)
  // 0=default 1=title 2=username 3=header 4=gap
  // date:{wd:5,sa:6,su:7} dow:{wd:8,sa:9,su:10}
  // time:{wd:11,sa:12,su:13} hours:{wd:14,sa:15,su:16} pay:{wd:17,sa:18,su:19}
  // tot_lbl:20 tot_hrs:21 tot_pay:22
  const S = {
    title: 1, username: 2, hdr: 3, gap: 4,
    date:  { wd: 5,  sa: 6,  su: 7  },
    dow:   { wd: 8,  sa: 9,  su: 10 },
    time:  { wd: 11, sa: 12, su: 13 },
    hours: { wd: 14, sa: 15, su: 16 },
    pay:   { wd: 17, sa: 18, su: 19 },
    tot_lbl: 20, tot_hrs: 21, tot_pay: 22,
  }

  const STYLES_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<numFmts count="4">',
    '<numFmt numFmtId="164" formatCode="yyyy/m/d"/>',
    '<numFmt numFmtId="165" formatCode="h:mm"/>',
    '<numFmt numFmtId="166" formatCode="0.0"/>',
    '<numFmt numFmtId="167" formatCode="#,##0"/>',
    '</numFmts>',
    '<fonts count="4">',
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="13"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '<font><sz val="11"/><color rgb="FFCC0000"/><name val="Calibri"/></font>',
    '</fonts>',
    '<fills count="6">',
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1A3F6F"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFCFE2F3"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFD9D9"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F4F8"/></patternFill></fill>',
    '</fills>',
    '<borders count="2">',
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>',
    '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>',
    '</borders>',
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '<cellXfs count="23">',
    // 0 default
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    // 1 title
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="left"/></xf>',
    // 2 username
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="left"/></xf>',
    // 3 header cell (dark blue bg, white bold, centered, wrapped)
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    // 4 gap cell
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    // 5-7 date wd/sa/su
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 8-10 dow wd/sa/su (su uses red font)
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 11-13 time wd/sa/su
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 14-16 hours wd/sa/su
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="166" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 17-19 pay wd/sa/su
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    '<xf numFmtId="167" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    '<xf numFmtId="167" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    // 20 totals label
    '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 21 totals hours
    '<xf numFmtId="166" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="center"/></xf>',
    // 22 totals pay
    '<xf numFmtId="167" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="right"/></xf>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('')

  const enc = new TextEncoder()
  const userEntries = users.filter(u => logs.some(l => l.user_id === u.id))
  const sheetXmls = []

  for (const user of userEntries) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    const itemRates = user.itemRates || {}
    const workTypes = (user.workItems || []).filter(t => !EXCL.has(t))

    // Fixed cols: A=0(日付) B=1(曜) C=2(出勤) D=3(退勤) E=4(休憩) F=5(合計) G=6(空白区切り)
    let ci = 7  // next dynamic column index, starts at H

    // Time columns per work type (平日 / 土日 split when sunday rate exists)
    const timeColMap = {}
    for (const type of workTypes) {
      const hasSunday = !!(itemRates[type]?.sunday)
      const wdCol = colLetter(ci++)
      const suCol = hasSunday ? colLetter(ci++) : null
      timeColMap[type] = { wd: wdCol, su: suCol, hasSunday }
    }
    const timeTotalCol = colLetter(ci++)
    const gap2Col = colLetter(ci++)

    // Pay columns per work type (same structure as time columns)
    const payColMap = {}
    for (const type of workTypes) {
      const hasSunday = !!(itemRates[type]?.sunday)
      const wdCol = colLetter(ci++)
      const suCol = hasSunday ? colLetter(ci++) : null
      payColMap[type] = { wd: wdCol, su: suCol, hasSunday }
    }
    const payTotalCol = colLetter(ci++)

    // Flat lists of all time/pay columns for SUM formulas
    const allTimeCols = workTypes.flatMap(t =>
      timeColMap[t].hasSunday ? [timeColMap[t].wd, timeColMap[t].su] : [timeColMap[t].wd]
    )
    const allPayCols = workTypes.flatMap(t =>
      payColMap[t].hasSunday ? [payColMap[t].wd, payColMap[t].su] : [payColMap[t].wd]
    )

    // Build byDate from logs
    const byDate = {}
    userLogs.forEach(log => {
      if (!byDate[log.date]) byDate[log.date] = { ins: [], outs: [], workItems: {} }
      if (log.log_type === '出勤') byDate[log.date].ins.push(log.time || '')
      else if (log.log_type === '退勤') {
        byDate[log.date].outs.push(log.time || '')
        const items = getWorkItems(log)
        Object.entries(items).forEach(([t, m]) => {
          byDate[log.date].workItems[t] = (byDate[log.date].workItems[t] || 0) + m
        })
      }
    })

    // Row 1: title
    const row1 = `<row r="1" ht="22"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 出勤簿')}</t></is></c></row>`
    // Row 2: user name
    const row2 = `<row r="2" ht="18"><c r="A2" s="${S.username}" t="inlineStr"><is><t>${esc('担当者：' + user.name)}</t></is></c></row>`

    // Row 4: headers
    const hdrCell = (col, text) =>
      `<c r="${col}4" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`

    const hdrCells = [
      hdrCell('A', '日付'), hdrCell('B', '曜日'),
      hdrCell('C', '出勤'), hdrCell('D', '退勤'),
      hdrCell('E', '休憩'), hdrCell('F', '合計時間'),
      `<c r="G4" s="${S.gap}"/>`,
    ]
    for (const type of workTypes) {
      const { wd, su, hasSunday } = timeColMap[type]
      if (hasSunday) {
        hdrCells.push(hdrCell(wd, type + '（平）'), hdrCell(su, type + '（土日）'))
      } else {
        hdrCells.push(hdrCell(wd, type))
      }
    }
    hdrCells.push(hdrCell(timeTotalCol, '時間計'), `<c r="${gap2Col}4" s="${S.gap}"/>`)
    for (const type of workTypes) {
      const { wd, su, hasSunday } = payColMap[type]
      if (hasSunday) {
        hdrCells.push(hdrCell(wd, type + '（平）\n給与'), hdrCell(su, type + '（土日）\n給与'))
      } else {
        hdrCells.push(hdrCell(wd, type + '\n給与'))
      }
    }
    hdrCells.push(hdrCell(payTotalCol, '給与計'))
    const row4 = `<row r="4" ht="42">${hdrCells.join('')}</row>`

    // Data rows (rows 5–35, one per day up to 31)
    const DATA_START = 5
    const dataRows = []

    for (let d = 1; d <= 31; d++) {
      const r = DATA_START + d - 1
      const isValid = d <= lastDay
      const dow = isValid ? new Date(ym_y, ym_m - 1, d).getDay() : 1
      const isSat = dow === 6, isSun = dow === 0, isWeekend = isSat || isSun
      const dt = isSun ? 'su' : (isSat ? 'sa' : 'wd')
      const cells = []

      if (!isValid) {
        cells.push(
          `<c r="A${r}" s="${S.date.wd}"/>`, `<c r="B${r}" s="${S.dow.wd}"/>`,
          `<c r="C${r}" s="${S.time.wd}"/>`, `<c r="D${r}" s="${S.time.wd}"/>`,
          `<c r="E${r}" s="${S.hours.wd}"/>`, `<c r="F${r}" s="${S.hours.wd}"/>`,
          `<c r="G${r}" s="${S.gap}"/>`,
        )
        for (const col of allTimeCols) cells.push(`<c r="${col}${r}" s="${S.hours.wd}"/>`)
        cells.push(`<c r="${timeTotalCol}${r}" s="${S.hours.wd}"/>`, `<c r="${gap2Col}${r}" s="${S.gap}"/>`)
        for (const col of allPayCols) cells.push(`<c r="${col}${r}" s="${S.pay.wd}"/>`)
        cells.push(`<c r="${payTotalCol}${r}" s="${S.pay.wd}"/>`)
      } else {
        cells.push(`<c r="A${r}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
        cells.push(`<c r="B${r}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)

        const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
        const entry = byDate[dateStr]
        const inStr = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
        const outStr = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''

        if (inStr) {
          const [h, mi] = inStr.split(':').map(Number)
          cells.push(`<c r="C${r}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`)
        } else { cells.push(`<c r="C${r}" s="${S.time[dt]}"/>`) }
        if (outStr) {
          const [h, mi] = outStr.split(':').map(Number)
          cells.push(`<c r="D${r}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`)
        } else { cells.push(`<c r="D${r}" s="${S.time[dt]}"/>`) }

        const wi = entry?.workItems || {}
        const breakMins = wi['休憩'] || 0
        cells.push(breakMins > 0
          ? `<c r="E${r}" s="${S.hours[dt]}"><v>${breakMins / 60}</v></c>`
          : `<c r="E${r}" s="${S.hours[dt]}"/>`)

        // 合計勤務時間 = (退勤 − 出勤) × 24 − 休憩
        cells.push(inStr && outStr
          ? `<c r="F${r}" s="${S.hours[dt]}"><f>IF(OR(C${r}="",D${r}=""),"",MAX(0,(D${r}-C${r})*24-E${r}))</f></c>`
          : `<c r="F${r}" s="${S.hours[dt]}"/>`)

        cells.push(`<c r="G${r}" s="${S.gap}"/>`)

        // Time columns — split into 平日 / 土日 based on weekend flag
        for (const type of workTypes) {
          const { wd, su, hasSunday } = timeColMap[type]
          const mins = wi[type] || 0
          const hours = mins / 60
          if (hasSunday) {
            if (isWeekend) {
              cells.push(`<c r="${wd}${r}" s="${S.hours[dt]}"/>`)
              cells.push(mins > 0
                ? `<c r="${su}${r}" s="${S.hours[dt]}"><v>${hours}</v></c>`
                : `<c r="${su}${r}" s="${S.hours[dt]}"/>`)
            } else {
              cells.push(mins > 0
                ? `<c r="${wd}${r}" s="${S.hours[dt]}"><v>${hours}</v></c>`
                : `<c r="${wd}${r}" s="${S.hours[dt]}"/>`)
              cells.push(`<c r="${su}${r}" s="${S.hours[dt]}"/>`)
            }
          } else {
            cells.push(mins > 0
              ? `<c r="${wd}${r}" s="${S.hours[dt]}"><v>${hours}</v></c>`
              : `<c r="${wd}${r}" s="${S.hours[dt]}"/>`)
          }
        }

        // 時間計
        cells.push(allTimeCols.length > 0
          ? `<c r="${timeTotalCol}${r}" s="${S.hours[dt]}"><f>SUM(${allTimeCols.map(c => c + r).join(',')})</f></c>`
          : `<c r="${timeTotalCol}${r}" s="${S.hours[dt]}"/>`)

        cells.push(`<c r="${gap2Col}${r}" s="${S.gap}"/>`)

        // Pay columns — user's individual 時給 (normal / sunday) applied per day type
        for (const type of workTypes) {
          const { wd: pwdCol, su: psuCol, hasSunday } = payColMap[type]
          const mins = wi[type] || 0
          const hours = mins / 60
          const rateObj = itemRates[type] || {}
          const normalRate = Number(rateObj.normal) || 0
          const sundayRate = Number(rateObj.sunday) || 0
          if (hasSunday) {
            if (isWeekend) {
              cells.push(`<c r="${pwdCol}${r}" s="${S.pay[dt]}"/>`)
              cells.push(mins > 0 && sundayRate > 0
                ? `<c r="${psuCol}${r}" s="${S.pay[dt]}"><v>${Math.round(hours * sundayRate)}</v></c>`
                : `<c r="${psuCol}${r}" s="${S.pay[dt]}"/>`)
            } else {
              cells.push(mins > 0 && normalRate > 0
                ? `<c r="${pwdCol}${r}" s="${S.pay[dt]}"><v>${Math.round(hours * normalRate)}</v></c>`
                : `<c r="${pwdCol}${r}" s="${S.pay[dt]}"/>`)
              cells.push(`<c r="${psuCol}${r}" s="${S.pay[dt]}"/>`)
            }
          } else {
            const rate = isWeekend ? (sundayRate || normalRate) : normalRate
            cells.push(mins > 0 && rate > 0
              ? `<c r="${pwdCol}${r}" s="${S.pay[dt]}"><v>${Math.round(hours * rate)}</v></c>`
              : `<c r="${pwdCol}${r}" s="${S.pay[dt]}"/>`)
          }
        }

        // 給与計
        cells.push(allPayCols.length > 0
          ? `<c r="${payTotalCol}${r}" s="${S.pay[dt]}"><f>SUM(${allPayCols.map(c => c + r).join(',')})</f></c>`
          : `<c r="${payTotalCol}${r}" s="${S.pay[dt]}"/>`)
      }

      dataRows.push(`<row r="${r}">${cells.join('')}</row>`)
    }

    // Totals row (row 36)
    const DATA_END = DATA_START + lastDay - 1
    const TR = DATA_START + 31
    const tCells = [
      `<c r="A${TR}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>`,
      `<c r="B${TR}" s="${S.tot_lbl}"/>`, `<c r="C${TR}" s="${S.tot_lbl}"/>`, `<c r="D${TR}" s="${S.tot_lbl}"/>`,
      `<c r="E${TR}" s="${S.tot_hrs}"><f>SUM(E${DATA_START}:E${DATA_END})</f></c>`,
      `<c r="F${TR}" s="${S.tot_hrs}"><f>SUM(F${DATA_START}:F${DATA_END})</f></c>`,
      `<c r="G${TR}" s="${S.gap}"/>`,
    ]
    for (const col of allTimeCols) {
      tCells.push(`<c r="${col}${TR}" s="${S.tot_hrs}"><f>SUM(${col}${DATA_START}:${col}${DATA_END})</f></c>`)
    }
    tCells.push(`<c r="${timeTotalCol}${TR}" s="${S.tot_hrs}"><f>SUM(${timeTotalCol}${DATA_START}:${timeTotalCol}${DATA_END})</f></c>`)
    tCells.push(`<c r="${gap2Col}${TR}" s="${S.gap}"/>`)
    for (const col of allPayCols) {
      tCells.push(`<c r="${col}${TR}" s="${S.tot_pay}"><f>SUM(${col}${DATA_START}:${col}${DATA_END})</f></c>`)
    }
    tCells.push(`<c r="${payTotalCol}${TR}" s="${S.tot_pay}"><f>SUM(${payTotalCol}${DATA_START}:${payTotalCol}${DATA_END})</f></c>`)

    const sheetData = `<sheetData>${row1}${row2}${row4}${dataRows.join('')}<row r="${TR}">${tCells.join('')}</row></sheetData>`
    const WB_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const WB_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    sheetXmls.push(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${WB_NS}" xmlns:r="${WB_REL_NS}">${sheetData}</worksheet>`
    )
  }

  // Build XLSX package from scratch (no template needed)
  const WB_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const WB_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  const N = userEntries.length

  const sheetEls = userEntries.map((u, i) =>
    `<sheet name="${esc(u.name.substring(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('')
  const wbXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${WB_NS}" xmlns:r="${WB_REL}">` +
    `<calcPr fullCalcOnLoad="1"/><sheets>${sheetEls}</sheets></workbook>`

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}">` +
    userEntries.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${WB_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join('') +
    `<Relationship Id="rId${N + 1}" Type="${WB_REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${N + 2}" Type="${WB_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`

  const ctXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    userEntries.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${WS_CT}"/>`).join('') +
    `</Types>`

  const relsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${WB_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  const ssXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="${WB_NS}" count="0" uniqueCount="0"/>`

  const out = {
    '[Content_Types].xml': enc.encode(ctXml),
    '_rels/.rels': enc.encode(relsXml),
    'xl/workbook.xml': enc.encode(wbXml),
    'xl/_rels/workbook.xml.rels': enc.encode(wbRels),
    'xl/styles.xml': enc.encode(STYLES_XML),
    'xl/sharedStrings.xml': enc.encode(ssXml),
  }
  sheetXmls.forEach((xml, i) => { out[`xl/worksheets/sheet${i + 1}.xml`] = enc.encode(xml) })

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
