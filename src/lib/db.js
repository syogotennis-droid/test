import Dexie from 'dexie'

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
export async function getLogs({ date, userId } = {}) {
  let query = db.logs.orderBy('timestamp').reverse()
  const results = await query.toArray()

  return results.filter(log => {
    if (date && log.date !== date) return false
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

// Delete a user
export async function deleteUser(id) {
  return db.users.delete(id)
}

// Delete a log entry
export async function deleteLog(id) {
  return db.logs.delete(id)
}

// Export logs as CSV string
export async function exportCSV({ date, userId } = {}) {
  const logs = await getLogs({ date, userId })
  const users = await getUsers()
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]))

  const header = 'ID,ユーザーID,氏名,作業内容,日付,時刻'
  const rows = logs.map(log =>
    [
      log.id,
      log.user_id,
      userMap[log.user_id] || '',
      log.work_type,
      log.date,
      log.time || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  )

  return [header, ...rows].join('\n')
}

export default db
