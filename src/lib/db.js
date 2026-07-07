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

export const DEFAULT_MIN_WAGE = 1077  // 愛知県 2024年10月改定

export async function getMinWage() {
  try {
    const snap = await getDoc(configDocRef)
    if (snap.exists() && snap.data()?.minWage) return snap.data().minWage
  } catch {}
  return DEFAULT_MIN_WAGE
}

export async function saveMinWage(wage) {
  await setDoc(configDocRef, { minWage: wage }, { merge: true })
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
  // tot_lbl:20 tot_hrs:21 tot_pay:22 pay_lbl:23 pay_rate:24
  const S = {
    title: 1, username: 2, hdr: 3, gap: 4,
    date:  { wd: 5,  sa: 6,  su: 7  },
    dow:   { wd: 8,  sa: 9,  su: 10 },
    time:  { wd: 11, sa: 12, su: 13 },
    hours: { wd: 14, sa: 15, su: 16 },
    pay:   { wd: 17, sa: 18, su: 19 },
    tot_lbl: 20, tot_hrs: 21, tot_pay: 22,
    pay_lbl: 23, pay_rate: 24,
  }

  const STYLES_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<numFmts count="5">',
    '<numFmt numFmtId="164" formatCode="yyyy/m/d"/>',
    '<numFmt numFmtId="165" formatCode="h:mm"/>',
    '<numFmt numFmtId="166" formatCode="0.0"/>',
    '<numFmt numFmtId="167" formatCode="#,##0"/>',
    '<numFmt numFmtId="168" formatCode="[h]&quot;時間&quot;mm&quot;分&quot;"/>',
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
    '<cellXfs count="25">',
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
    '<xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="168" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="168" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 17-19 pay wd/sa/su
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    '<xf numFmtId="167" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    '<xf numFmtId="167" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"><alignment horizontal="right"/></xf>',
    // 20 totals label
    '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 21 totals hours
    '<xf numFmtId="168" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="center"/></xf>',
    // 22 totals pay
    '<xf numFmtId="167" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"><alignment horizontal="right"/></xf>',
    // 23 pay row label: bordered, left aligned text
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="left"/></xf>',
    // 24 pay row hourly rate: bordered, #,##0 format, center
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center"/></xf>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('')

  const minWage = await getMinWage()

  const enc = new TextEncoder()
  const userEntries = users.filter(u => logs.some(l => l.user_id === u.id))
  const sheetXmls = []

  for (const user of userEntries) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    const itemRates = user.itemRates || {}

    // Build byDate first so we can compute monthly hours for filtering
    // Sort by timestamp so later 退勤 records overwrite earlier ones (prevents double-count from duplicate punches)
    const sortedLogs = [...userLogs].sort((a, b) => (a.timestamp || '') < (b.timestamp || '') ? -1 : 1)
    const byDate = {}
    sortedLogs.forEach(log => {
      if (!byDate[log.date]) byDate[log.date] = { ins: [], outs: [], workItems: {} }
      if (log.log_type === '出勤') byDate[log.date].ins.push(log.time || '')
      else if (log.log_type === '退勤') {
        byDate[log.date].outs.push(log.time || '')
        const items = getWorkItems(log)
        if (Object.keys(items).length > 0) {
          byDate[log.date].workItems = { ...items }  // replace entirely; last 退勤 wins
        }
      }
    })

    // Monthly hours split by weekday+sat / sunday per type
    const monthlyWdMins = {}, monthlyWeMins = {}
    Object.entries(byDate).forEach(([dateStr, entry]) => {
      const [y, mo, d] = dateStr.split('-').map(Number)
      const isWe = new Date(y, mo - 1, d).getDay() === 0  // Sunday only
      Object.entries(entry.workItems).forEach(([t, m]) => {
        if (isWe) monthlyWeMins[t] = (monthlyWeMins[t] || 0) + m
        else monthlyWdMins[t] = (monthlyWdMins[t] || 0) + m
      })
    })
    const monthlyMins = {}
    new Set([...Object.keys(monthlyWdMins), ...Object.keys(monthlyWeMins)])
      .forEach(t => { monthlyMins[t] = (monthlyWdMins[t] || 0) + (monthlyWeMins[t] || 0) })

    // Filter: user.workItems types, not EXCL, with actual hours this month
    const workTypes = (user.workItems || [])
      .filter(t => !EXCL.has(t) && (monthlyMins[t] || 0) > 0)

    // Count working days (出勤 or 退勤 exists that day) for 前後5分 min-wage calc
    const workingDays = Object.values(byDate).filter(e => e.ins.length > 0 || e.outs.length > 0).length

    // Table 2 type columns: A=日付, B=曜日, C onwards per type, then 時間計
    let ci = 2
    const typeColMap = {}
    for (const type of workTypes) {
      const hasSunday = !!(itemRates[type]?.sunday)
      const wdCol = colLetter(ci++)
      const suCol = hasSunday ? colLetter(ci++) : null
      typeColMap[type] = { wd: wdCol, su: suCol, hasSunday }
    }
    const typeTotalCol = colLetter(ci++)
    const allTypeCols = workTypes.flatMap(t =>
      typeColMap[t].hasSunday ? [typeColMap[t].wd, typeColMap[t].su] : [typeColMap[t].wd]
    )

    // Row layout (fixed):
    // [表1: 勤務時間]   row4 hdr, 5-35 data, 36 tot, 37 blank
    // [表2: 業務別時間] row38 hdr, 39-69 data, 70 tot, 71 blank
    // [表3: 給与明細]   row72 hdr, 73+ rows
    const T1_HDR = 4, T1_DATA = 5, T1_TOT = 36
    const T2_HDR = 38, T2_DATA = 39, T2_TOT = 70
    const T3_HDR = 72
    const T1_DATA_END = T1_DATA + lastDay - 1
    const T2_DATA_END = T2_DATA + lastDay - 1

    const row1 = `<row r="1" ht="22"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 出勤簿')}</t></is></c></row>`
    const row2 = `<row r="2" ht="18"><c r="A2" s="${S.username}" t="inlineStr"><is><t>${esc('担当者：' + user.name)}</t></is></c></row>`

    const hdrCell = (col, rn, text) =>
      `<c r="${col}${rn}" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`

    // 表1ヘッダー: 勤務時間 (A=日付 B=曜日 C=出勤 D=退勤 E=合計 F=休憩 G=勤務時間 H=準備時間)
    const t1Hdr =
      `<row r="${T1_HDR}" ht="36">` +
      hdrCell('A', T1_HDR, '日付') + hdrCell('B', T1_HDR, '曜日') +
      hdrCell('C', T1_HDR, '出勤') + hdrCell('D', T1_HDR, '退勤') +
      hdrCell('E', T1_HDR, '合計') + hdrCell('F', T1_HDR, '休憩') +
      hdrCell('G', T1_HDR, '勤務時間') + hdrCell('H', T1_HDR, '準備時間') +
      `</row>`

    // 表2ヘッダー: 業務別時間
    const t2HdrCells = [hdrCell('A', T2_HDR, '日付'), hdrCell('B', T2_HDR, '曜日')]
    for (const type of workTypes) {
      const { wd, su, hasSunday } = typeColMap[type]
      if (hasSunday) {
        t2HdrCells.push(
          hdrCell(wd, T2_HDR, type),
          `<c r="${su}${T2_HDR}" s="${S.hdr}" t="inlineStr"><is><t xml:space="preserve">${esc(type)}&#10;（日曜）</t></is></c>`
        )
      } else {
        t2HdrCells.push(hdrCell(wd, T2_HDR, type))
      }
    }
    t2HdrCells.push(hdrCell(typeTotalCol, T2_HDR, '時間計'))
    const t2Hdr = `<row r="${T2_HDR}" ht="42">${t2HdrCells.join('')}</row>`

    // データ行（表1・表2同時に生成）
    const t1Rows = [], t2Rows = []
    for (let d = 1; d <= 31; d++) {
      const r1 = T1_DATA + d - 1
      const r2 = T2_DATA + d - 1
      const isValid = d <= lastDay
      const dow = isValid ? new Date(ym_y, ym_m - 1, d).getDay() : 1
      const isSat = dow === 6, isSun = dow === 0
      const dt = isSun ? 'su' : (isSat ? 'sa' : 'wd')

      if (!isValid) {
        t1Rows.push(`<row r="${r1}">` +
          `<c r="A${r1}" s="${S.date.wd}"/>` + `<c r="B${r1}" s="${S.dow.wd}"/>` +
          `<c r="C${r1}" s="${S.time.wd}"/>` + `<c r="D${r1}" s="${S.time.wd}"/>` +
          `<c r="E${r1}" s="${S.hours.wd}"/>` + `<c r="F${r1}" s="${S.hours.wd}"/>` +
          `<c r="G${r1}" s="${S.hours.wd}"/>` + `<c r="H${r1}" s="${S.hours.wd}"/>` +
          `</row>`)
        const t2e = [`<c r="A${r2}" s="${S.date.wd}"/>`, `<c r="B${r2}" s="${S.dow.wd}"/>`]
        for (const col of allTypeCols) t2e.push(`<c r="${col}${r2}" s="${S.hours.wd}"/>`)
        t2e.push(`<c r="${typeTotalCol}${r2}" s="${S.hours.wd}"/>`)
        t2Rows.push(`<row r="${r2}">${t2e.join('')}</row>`)
      } else {
        const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
        const entry = byDate[dateStr]
        const inStr = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
        const outStr = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
        const wi = entry?.workItems || {}

        // 表1行 (A=日付 B=曜日 C=出勤 D=退勤 E=合計 F=休憩 G=準備時間 H=勤務合計)
        const t1c = []
        t1c.push(`<c r="A${r1}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
        t1c.push(`<c r="B${r1}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)
        if (inStr) {
          const [h, mi] = inStr.split(':').map(Number)
          t1c.push(`<c r="C${r1}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`)
        } else { t1c.push(`<c r="C${r1}" s="${S.time[dt]}"/>`) }
        if (outStr) {
          const [h, mi] = outStr.split(':').map(Number)
          t1c.push(`<c r="D${r1}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`)
        } else { t1c.push(`<c r="D${r1}" s="${S.time[dt]}"/>`) }
        // E: 合計 = 退勤 - 出勤（休憩未控除）
        t1c.push(inStr && outStr
          ? `<c r="E${r1}" s="${S.hours[dt]}"><f>IF(OR(C${r1}="",D${r1}=""),"",MAX(0,D${r1}-C${r1}))</f></c>`
          : `<c r="E${r1}" s="${S.hours[dt]}"/>`)
        // F: 休憩
        const breakMins = wi['休憩'] || 0
        t1c.push(breakMins > 0
          ? `<c r="F${r1}" s="${S.hours[dt]}"><v>${breakMins / 1440}</v></c>`
          : `<c r="F${r1}" s="${S.hours[dt]}"/>`)
        // G: 勤務時間 = 合計 - 休憩
        t1c.push(inStr && outStr
          ? `<c r="G${r1}" s="${S.hours[dt]}"><f>IF(E${r1}="","",E${r1}-F${r1})</f></c>`
          : `<c r="G${r1}" s="${S.hours[dt]}"/>`)
        // H: 準備時間 = 前後5分 = 10分 (出勤 or 退勤がある日のみ)
        const hasAttendance = (inStr || outStr)
        t1c.push(hasAttendance
          ? `<c r="H${r1}" s="${S.hours[dt]}"><v>${10 / 1440}</v></c>`
          : `<c r="H${r1}" s="${S.hours[dt]}"/>`)
        t1Rows.push(`<row r="${r1}">${t1c.join('')}</row>`)

        // 表2行
        const t2c = []
        t2c.push(`<c r="A${r2}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
        t2c.push(`<c r="B${r2}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)
        for (const type of workTypes) {
          const { wd, su, hasSunday } = typeColMap[type]
          const mins = wi[type] || 0
          const hours = mins / 60
          if (hasSunday) {
            if (isSun) {
              t2c.push(`<c r="${wd}${r2}" s="${S.hours[dt]}"/>`)
              t2c.push(mins > 0
                ? `<c r="${su}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>`
                : `<c r="${su}${r2}" s="${S.hours[dt]}"/>`)
            } else {
              t2c.push(mins > 0
                ? `<c r="${wd}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>`
                : `<c r="${wd}${r2}" s="${S.hours[dt]}"/>`)
              t2c.push(`<c r="${su}${r2}" s="${S.hours[dt]}"/>`)
            }
          } else {
            t2c.push(mins > 0
              ? `<c r="${wd}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>`
              : `<c r="${wd}${r2}" s="${S.hours[dt]}"/>`)
          }
        }
        t2c.push(allTypeCols.length > 0
          ? `<c r="${typeTotalCol}${r2}" s="${S.hours[dt]}"><f>SUM(${allTypeCols.map(c => c + r2).join(',')})</f></c>`
          : `<c r="${typeTotalCol}${r2}" s="${S.hours[dt]}"/>`)
        t2Rows.push(`<row r="${r2}">${t2c.join('')}</row>`)
      }
    }

    // 表1合計行 (E=合計 F=休憩 G=準備時間 H=勤務合計)
    const t1Tot =
      `<row r="${T1_TOT}">` +
      `<c r="A${T1_TOT}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>` +
      `<c r="B${T1_TOT}" s="${S.tot_lbl}"/><c r="C${T1_TOT}" s="${S.tot_lbl}"/><c r="D${T1_TOT}" s="${S.tot_lbl}"/>` +
      `<c r="E${T1_TOT}" s="${S.tot_hrs}"><f>SUM(E${T1_DATA}:E${T1_DATA_END})</f></c>` +
      `<c r="F${T1_TOT}" s="${S.tot_hrs}"><f>SUM(F${T1_DATA}:F${T1_DATA_END})</f></c>` +
      `<c r="G${T1_TOT}" s="${S.tot_hrs}"><f>SUM(G${T1_DATA}:G${T1_DATA_END})</f></c>` +
      `<c r="H${T1_TOT}" s="${S.tot_hrs}"><f>SUM(H${T1_DATA}:H${T1_DATA_END})</f></c>` +
      `</row>`

    // 表2合計行
    const t2TotCells = [
      `<c r="A${T2_TOT}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>`,
      `<c r="B${T2_TOT}" s="${S.tot_lbl}"/>`,
    ]
    for (const col of allTypeCols) {
      t2TotCells.push(`<c r="${col}${T2_TOT}" s="${S.tot_hrs}"><f>SUM(${col}${T2_DATA}:${col}${T2_DATA_END})</f></c>`)
    }
    t2TotCells.push(`<c r="${typeTotalCol}${T2_TOT}" s="${S.tot_hrs}"><f>SUM(${typeTotalCol}${T2_DATA}:${typeTotalCol}${T2_DATA_END})</f></c>`)
    const t2Tot = `<row r="${T2_TOT}">${t2TotCells.join('')}</row>`

    // 表3: 給与明細
    const t3Hdr =
      `<row r="${T3_HDR}" ht="32">` +
      `<c r="A${T3_HDR}" s="${S.hdr}" t="inlineStr"><is><t>業務</t></is></c>` +
      `<c r="B${T3_HDR}" s="${S.hdr}" t="inlineStr"><is><t>時間計</t></is></c>` +
      `<c r="C${T3_HDR}" s="${S.hdr}" t="inlineStr"><is><t>時給</t></is></c>` +
      `<c r="D${T3_HDR}" s="${S.hdr}" t="inlineStr"><is><t>給与</t></is></c>` +
      `</row>`

    const payRows = []
    let payRowIdx = T3_HDR + 1
    let totalPayHours = 0
    let totalPayAmount = 0

    for (const type of workTypes) {
      const rateObj = itemRates[type] || {}
      const normalRate = Number(rateObj.normal) || 0
      const sundayRate = Number(rateObj.sunday) || 0
      const hasSunday = !!(itemRates[type]?.sunday)

      if (hasSunday) {
        const wdMins = monthlyWdMins[type] || 0
        const weMins = monthlyWeMins[type] || 0
        if (wdMins > 0) {
          const wdHours = wdMins / 60
          const wdPay = Math.round(wdHours * normalRate)
          totalPayHours += wdHours; totalPayAmount += wdPay
          payRows.push(
            `<row r="${payRowIdx}">` +
            `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(type)}</t></is></c>` +
            `<c r="B${payRowIdx}" s="${S.hours.wd}"><f>${typeColMap[type].wd}${T2_TOT}</f></c>` +
            (normalRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${normalRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
            `<c r="D${payRowIdx}" s="${S.pay.wd}"><f>ROUND(B${payRowIdx}*24*C${payRowIdx},0)</f></c>` +
            `</row>`
          )
          payRowIdx++
        }
        if (weMins > 0) {
          const weHours = weMins / 60
          const wePay = Math.round(weHours * sundayRate)
          totalPayHours += weHours; totalPayAmount += wePay
          payRows.push(
            `<row r="${payRowIdx}">` +
            `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(type + '（日曜）')}</t></is></c>` +
            `<c r="B${payRowIdx}" s="${S.hours.wd}"><f>${typeColMap[type].su}${T2_TOT}</f></c>` +
            (sundayRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${sundayRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
            `<c r="D${payRowIdx}" s="${S.pay.wd}"><f>ROUND(B${payRowIdx}*24*C${payRowIdx},0)</f></c>` +
            `</row>`
          )
          payRowIdx++
        }
      } else {
        const totalMins = monthlyMins[type] || 0
        const totalHours = totalMins / 60
        const totalPay = Math.round(totalHours * normalRate)
        totalPayHours += totalHours; totalPayAmount += totalPay
        payRows.push(
          `<row r="${payRowIdx}">` +
          `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(type)}</t></is></c>` +
          `<c r="B${payRowIdx}" s="${S.hours.wd}"><f>${typeColMap[type].wd}${T2_TOT}</f></c>` +
          (normalRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${normalRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
          `<c r="D${payRowIdx}" s="${S.pay.wd}"><f>ROUND(B${payRowIdx}*24*C${payRowIdx},0)</f></c>` +
          `</row>`
        )
        payRowIdx++
      }
    }

    // 前後5分（最低賃金）行
    if (workingDays > 0 && minWage > 0) {
      const prepHours = workingDays * (10 / 60)
      const prepPay = Math.round(prepHours * minWage)
      totalPayHours += prepHours; totalPayAmount += prepPay
      payRows.push(
        `<row r="${payRowIdx}">` +
        `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>準備時間</t></is></c>` +
        `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${prepHours / 24}</v></c>` +
        `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${minWage}</v></c>` +
        `<c r="D${payRowIdx}" s="${S.pay.wd}"><f>ROUND(B${payRowIdx}*24*C${payRowIdx},0)</f></c>` +
        `</row>`
      )
      payRowIdx++
    }

    // 合計行
    const PTR = payRowIdx
    const payTotRow =
      `<row r="${PTR}">` +
      `<c r="A${PTR}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>` +
      `<c r="B${PTR}" s="${S.tot_hrs}"><f>SUM(B${T3_HDR + 1}:B${PTR - 1})</f></c>` +
      `<c r="C${PTR}" s="${S.tot_lbl}"/>` +
      `<c r="D${PTR}" s="${S.tot_pay}"><f>SUM(D${T3_HDR + 1}:D${PTR - 1})</f></c>` +
      `</row>`

    const sheetData = `<sheetData>${row1}${row2}${t1Hdr}${t1Rows.join('')}${t1Tot}${t2Hdr}${t2Rows.join('')}${t2Tot}${t3Hdr}${payRows.join('')}${payTotRow}</sheetData>`
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
