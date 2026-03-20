import Dexie from 'dexie'
import * as XLSX from 'xlsx'

// IndexedDB database definition
const db = new Dexie('QRAttendanceDB')

db.version(1).stores({
  users: 'id, name',
  logs: '++id, user_id, work_type, timestamp, date, synced'
})

db.version(2).stores({
  users: 'id, name',
  logs: '++id, user_id, work_type, log_type, timestamp, date, synced'
})

// Default users seeded from QR codes
// In production, QR codes encode the user ID string
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

// Seed default users on first run
export async function initDB() {
  const count = await db.users.count()
  if (count === 0) {
    await db.users.bulkPut(DEFAULT_USERS)
  }
}

// Resolve a QR scan value to a user object
// QR codes encode plain user IDs (e.g. "USER001")
export async function resolveUser(qrValue) {
  const user = await db.users.get(qrValue)
  return user || null
}

// Save a work log entry
export async function saveLog({ userId, workType, logType }) {
  const now = new Date()
  const timestamp = now.toISOString()
  const date = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  const id = await db.logs.add({
    user_id: userId,
    work_type: workType || '',
    log_type: logType || workType || '',
    timestamp,
    date,
    time,
    synced: 0
  })
  return id
}

// Get the most recent clock-in record for a user today
export async function getClockInTime(userId) {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const logs = await db.logs.where('date').equals(today).toArray()
  const clockIns = logs
    .filter(l => l.user_id === userId && l.log_type === '出勤')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  return clockIns.length > 0 ? clockIns[clockIns.length - 1] : null
}

// Check if a user is currently checked in (more check-ins than check-outs today)
export async function isCheckedIn(userId) {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const logs = await db.logs.where('date').equals(today).toArray()
  const userLogs = logs.filter(l => l.user_id === userId)
  const ins = userLogs.filter(l => l.log_type === '出勤').length
  const outs = userLogs.filter(l => l.log_type === '退勤').length
  return ins > outs
}

// Fetch all logs with optional filters
export async function getLogs({ date, dateFrom, dateTo, userId } = {}) {
  let query = db.logs.orderBy('timestamp').reverse()
  const results = await query.toArray()

  return results.filter(log => {
    if (date && log.date !== date) return false
    if (dateFrom && log.date < dateFrom) return false
    if (dateTo && log.date > dateTo) return false
    if (userId && log.user_id !== userId) return false
    return true
  })
}

// Get all users
export async function getUsers() {
  return db.users.toArray()
}

// Add or update a user
export async function upsertUser(user) {
  return db.users.put(user)
}

// Delete a user and all their logs
export async function deleteUser(id) {
  const logIds = await db.logs.where('user_id').equals(id).primaryKeys()
  await db.logs.bulkDelete(logIds)
  return db.users.delete(id)
}

// Delete a log entry
export async function deleteLog(id) {
  return db.logs.delete(id)
}

// Get today's check-in status for all users { userId: true/false }
export async function getTodayStatuses() {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const logs = await db.logs.where('date').equals(today).toArray()
  const groups = {}
  logs.forEach(l => {
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

// Manually create a log entry with specified date/time
export async function saveLogManual({ userId, workType, logType, date, time }) {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = time.split(':').map(Number)
  const dt = new Date(y, mo - 1, d, h, m, 0)
  await db.logs.add({
    user_id: userId,
    work_type: workType || '',
    log_type: logType,
    timestamp: dt.toISOString(),
    date,
    time: time + ':00',
    synced: 0
  })
}

// Update the time of a log entry
export async function updateLogTime(id, timeStr) {
  // timeStr is "HH:MM"
  const log = await db.logs.get(id)
  if (!log) return
  const [year, month, day] = log.date.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  const dt = new Date(year, month - 1, day, h, m, 0)
  await db.logs.update(id, {
    time: timeStr + ':00',
    timestamp: dt.toISOString()
  })
}

// Format work_type string for display (handles "現場:90,清掃:30" and "事務,清掃")
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

const KINMUBO_WORK_TYPES = ['現場', '清掃', '事務']

function minsToHM(mins) {
  if (!mins || mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

function timeDiffMins(t1, t2) {
  // "HH:MM" or "HH:MM:SS"
  const [h1, m1] = t1.split(':').map(Number)
  const [h2, m2] = t2.split(':').map(Number)
  return (h2 * 60 + m2) - (h1 * 60 + m1)
}

// Parse work_type string → { '現場': mins|0|null, '清掃': ..., '事務': ... }
// null = not worked, 0 = worked but no time recorded, N = worked N minutes
function parseWorkMins(workType) {
  const result = {}
  KINMUBO_WORK_TYPES.forEach(t => { result[t] = null })
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
// rates = { '現場': number/h, '清掃': number/h, '事務': number/h }
export async function exportKinmubo({ dateFrom, dateTo, rates = {} } = {}) {
  const logs = await getLogs({ dateFrom, dateTo })
  const users = await getUsers()

  // Build list of dates in range
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

    // Group logs by date
    const byDate = {}
    userLogs.forEach(log => {
      if (!byDate[log.date]) byDate[log.date] = { ins: [], outs: [], workType: '' }
      if (log.log_type === '出勤') byDate[log.date].ins.push(log.time || '')
      else if (log.log_type === '退勤') {
        byDate[log.date].outs.push(log.time || '')
        if (log.work_type) byDate[log.date].workType = log.work_type
      }
    })

    // 2-row merged header
    // cols: 日付(0) 曜日(1) 出勤(2) 退勤(3) 勤務時間(4) [spacer](5) 現場×2(6-7) 清掃×2(8-9) 事務×2(10-11) 合計日給(12)
    const headerRow1 = ['日付', '曜日', '出勤時刻', '退勤時刻', '勤務時間', '', '現場', '', '清掃', '', '事務', '', '合計日給']
    const headerRow2 = ['',    '',    '',        '',        '',          '', '作業時間', '日給', '作業時間', '日給', '作業時間', '日給', '']

    // Monthly accumulators
    let totalWorkMins = 0
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
      const zeroTypes = KINMUBO_WORK_TYPES.filter(t => workMins[t] === 0)

      const getTypeMins = t => {
        if (workMins[t] === null) return 0
        if (workMins[t] > 0) return workMins[t]
        return zeroTypes.length === 1 ? totalMins : 0
      }

      let dayWage = 0
      const typeCells = []
      for (const t of KINMUBO_WORK_TYPES) {
        if (workMins[t] === null) {
          typeCells.push('', '')
        } else {
          const tMins = getTypeMins(t)
          const tHM = tMins > 0 ? minsToHM(tMins) : (workMins[t] === 0 && zeroTypes.length > 1 ? '○' : '')
          const rate = Number(rates[t]) || 0
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
        '', // spacer
        ...typeCells,
        dayWage > 0 ? dayWage : ''
      ]
    })

    // Monthly totals row (skip 出勤時刻・退勤時刻・spacer)
    const totalRow = [
      '', '', '', '月合計',
      minsToHM(totalWorkMins) || '',
      '', // spacer
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
    // title rows occupy rows 0-2, headers at rows 3-4
    const TITLE_ROWS = 3

    const data = [...titleRows, headerRow1, headerRow2, ...rows, [], totalRow]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = [
      { wch: 12 }, { wch: 4 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 2 },
      { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }
    ]
    // Merged cells for 2-row header
    const hr = TITLE_ROWS // header group row index
    ws['!merges'] = [
      { s: { r: hr, c: 0  }, e: { r: hr+1, c: 0  } }, // 日付
      { s: { r: hr, c: 1  }, e: { r: hr+1, c: 1  } }, // 曜日
      { s: { r: hr, c: 2  }, e: { r: hr+1, c: 2  } }, // 出勤時刻
      { s: { r: hr, c: 3  }, e: { r: hr+1, c: 3  } }, // 退勤時刻
      { s: { r: hr, c: 4  }, e: { r: hr+1, c: 4  } }, // 勤務時間
      { s: { r: hr, c: 5  }, e: { r: hr+1, c: 5  } }, // spacer
      { s: { r: hr, c: 6  }, e: { r: hr,   c: 7  } }, // 現場
      { s: { r: hr, c: 8  }, e: { r: hr,   c: 9  } }, // 清掃
      { s: { r: hr, c: 10 }, e: { r: hr,   c: 11 } }, // 事務
      { s: { r: hr, c: 12 }, e: { r: hr+1, c: 12 } }, // 合計日給
    ]
    XLSX.utils.book_append_sheet(wb, ws, user.name.substring(0, 31))
  }

  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['データなし']]), 'データなし')
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// Export logs as XLSX (one sheet per user)
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
