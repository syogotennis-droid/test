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

export async function getOverdueCheckIns(users) {
  const today = getTodayDate()
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fromDate = sevenDaysAgo.toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')

  const q = query(logsCol, where('date', '>=', fromDate))
  const snap = await getDocs(q)
  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

  const overdue = []
  for (const user of users) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    const ins = userLogs.filter(l => l.log_type === '出勤')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    const outs = userLogs.filter(l => l.log_type === '退勤')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    if (ins.length > outs.length) {
      const latestIn = ins[0]
      if (latestIn && latestIn.date < today) {
        overdue.push({ user, date: latestIn.date, time: (latestIn.time || '').substring(0, 5) })
      }
    }
  }
  return overdue
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

// Export monthly attendance register (出勤簿) as XLSX (one sheet per user)
export async function exportKinmubo({ dateFrom, dateTo } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()

  const days = []
  const start = new Date(dateFrom)
  const end = new Date(dateTo)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(
      d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
    )
  }

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
  const wb = XLSX.utils.book_new()

  const [ym_y, ym_m] = (dateFrom || days[0] || '').split('-')
  const yearMonthLabel = ym_y && ym_m ? `${ym_y}年${Number(ym_m)}月` : ''

  for (const user of users) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    if (userLogs.length === 0) continue
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

    const headerRow1 = ['日付', '曜日', '出勤時刻', '退勤時刻', '勤務時間', '休憩時間', '', '現場', '', '清掃', '', '事務', '', '合計日給']
    const headerRow2 = ['',    '',    '',        '',        '',          '',          '', '作業時間', '日給', '作業時間', '日給', '作業時間', '日給', '']

    let totalWorkMins = 0
    let totalKyukeiMins = 0
    const typeTotalMins = { 現場: 0, 清掃: 0, 事務: 0 }
    const typeTotalWage = { 現場: 0, 清掃: 0, 事務: 0 }
    let grandTotalWage = 0

    const rows = days.map(dateStr => {
      const [y, mo, dy] = dateStr.split('-').map(Number)
      const dayName = DAY_NAMES[new Date(y, mo - 1, dy).getDay()]

      const entry = byDate[dateStr]
      const inTime = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
      const outTime = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
      const totalMins = (inTime && outTime) ? Math.max(0, timeDiffMins(inTime, outTime)) : 0
      totalWorkMins += totalMins

      const workMins = parseWorkMins(entry?.workType || '')
      const zeroTypes = KINMUBO_PAID_TYPES.filter(t => workMins[t] === 0)

      const kyukeiMins = workMins['休憩'] !== null && workMins['休憩'] > 0 ? workMins['休憩'] : 0
      const kyukeiHM = kyukeiMins > 0 ? minsToHM(kyukeiMins) : ''
      totalKyukeiMins += kyukeiMins

      const getTypeMins = t => {
        if (workMins[t] === null) return 0
        if (workMins[t] > 0) return workMins[t]
        return zeroTypes.length === 1 ? totalMins : 0
      }

      let dayWage = 0
      const typeCells = []
      for (const t of KINMUBO_PAID_TYPES) {
        if (workMins[t] === null) {
          typeCells.push('', '')
        } else {
          const tMins = getTypeMins(t)
          const tHM = tMins > 0 ? minsToHM(tMins) : (workMins[t] === 0 && zeroTypes.length > 1 ? '○' : '')
          const rate = Number(userRates[t]) || 0
          const wage = rate > 0 && tMins > 0 ? Math.round(tMins / 60 * rate) : ''
          typeTotalMins[t] += tMins
          if (typeof wage === 'number') { typeTotalWage[t] += wage; dayWage += wage }
          typeCells.push(tHM, typeof wage === 'number' ? wage : '')
        }
      }
      grandTotalWage += dayWage

      return [
        dateStr, dayName, inTime, outTime,
        totalMins > 0 ? minsToHM(totalMins) : '',
        kyukeiHM,
        '',
        ...typeCells,
        dayWage > 0 ? dayWage : ''
      ]
    })

    const totalRow = [
      '月合計', '', '', '',
      minsToHM(totalWorkMins) || '',
      minsToHM(totalKyukeiMins) || '',
      '',
      minsToHM(typeTotalMins['現場']) || '', typeTotalWage['現場'] || '',
      minsToHM(typeTotalMins['清掃']) || '', typeTotalWage['清掃'] || '',
      minsToHM(typeTotalMins['事務']) || '', typeTotalWage['事務'] || '',
      grandTotalWage || ''
    ]

    const titleRows = [
      [`${yearMonthLabel} 出勤簿`],
      [`担当者: ${user.name}`],
      []
    ]
    const TITLE_ROWS = 3

    const data = [...titleRows, headerRow1, headerRow2, ...rows, totalRow]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = [
      { wch: 12 }, { wch: 4 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 2 },
      { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }
    ]
    const hr = TITLE_ROWS
    ws['!merges'] = [
      { s: { r: hr, c: 0  }, e: { r: hr+1, c: 0  } },
      { s: { r: hr, c: 1  }, e: { r: hr+1, c: 1  } },
      { s: { r: hr, c: 2  }, e: { r: hr+1, c: 2  } },
      { s: { r: hr, c: 3  }, e: { r: hr+1, c: 3  } },
      { s: { r: hr, c: 4  }, e: { r: hr+1, c: 4  } },
      { s: { r: hr, c: 5  }, e: { r: hr+1, c: 5  } },
      { s: { r: hr, c: 6  }, e: { r: hr+1, c: 6  } },
      { s: { r: hr, c: 7  }, e: { r: hr,   c: 8  } },
      { s: { r: hr, c: 9  }, e: { r: hr,   c: 10 } },
      { s: { r: hr, c: 11 }, e: { r: hr,   c: 12 } },
      { s: { r: hr, c: 13 }, e: { r: hr+1, c: 13 } },
    ]
    XLSX.utils.book_append_sheet(wb, ws, user.name.substring(0, 31))
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['データなし']]), 'データなし')
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
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
