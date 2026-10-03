import { zipSync } from 'fflate'

const ADMIN_TOKEN_KEY = 'adminToken'
const SERVER_ORIGIN_KEY = 'serverOrigin'

// The Android app bundles the web files, so '/api' would point at the app
// itself; it must call the deployed site by absolute URL instead.
function isNativeApp() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
}

export function getServerOrigin() {
  try { return localStorage.getItem(SERVER_ORIGIN_KEY) || import.meta.env?.VITE_SERVER_ORIGIN || '' } catch { return '' }
}

export function setServerOrigin(url) {
  let u = String(url || '').trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//.test(u)) u = 'https://' + u
  try { localStorage.setItem(SERVER_ORIGIN_KEY, u) } catch {}
  return u
}

export function needsServerOrigin() {
  return isNativeApp()
}

function apiBase() {
  return (isNativeApp() ? getServerOrigin() : '') + '/api'
}
const DEVICE_TOKEN_KEY = 'deviceToken'

function getToken(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function setToken(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key) } catch {}
}

function offlineError(cause) {
  const e = new Error('オフラインです')
  e.offline = true
  e.cause = cause
  return e
}

const API_TIMEOUT_MS = 8000

async function api(path, { method = 'GET', query, body } = {}) {
  let url = apiBase() + path
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    if (qs) url += '?' + qs
  }
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  const adminT = getToken(ADMIN_TOKEN_KEY), deviceT = getToken(DEVICE_TOKEN_KEY)
  if (adminT) headers['X-Admin-Token'] = adminT
  if (deviceT) headers['X-Device-Token'] = deviceT
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw offlineError()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal })
  } catch (e) {
    throw offlineError(e)
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    const j = await res.json().catch(() => ({}))
    setToken(j.need === 'device' ? DEVICE_TOKEN_KEY : ADMIN_TOKEN_KEY, null)
    window.dispatchEvent(new CustomEvent('auth-required', { detail: { need: j.need } }))
    throw new Error('認証が必要です')
  }
  if (!res.ok) {
    const e = new Error(`API ${method} ${path} failed (${res.status})`)
    e.status = res.status
    throw e
  }
  return res.json()
}

// ─── Offline support for punching ─────────────────────────────────────────────
// Writes go to a localStorage outbox first and are sent in order; the server
// side is idempotent (client-generated log ids, upserts), so resending is safe.
const OUTBOX_KEY = 'outbox'
const LOCAL_PUNCHES_KEY = 'localPunches'
const TODAY_LOGS_CACHE_KEY = 'todayLogsCache'
const USERS_CACHE_KEY = 'usersCache'

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function notifyOutbox() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('outbox-change'))
}

function enqueue(item) {
  // a newer upsert of the same record replaces an unsent older one
  const box = readJSON(OUTBOX_KEY, []).filter(x => !(item.key && x.key === item.key))
  box.push(item)
  writeJSON(OUTBOX_KEY, box)
  notifyOutbox()
}

export function getPendingCount() {
  return readJSON(OUTBOX_KEY, []).length
}

let flushing = null
export function flushOutbox() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null })
  return flushing
}

async function doFlush() {
  for (;;) {
    const box = readJSON(OUTBOX_KEY, [])
    if (box.length === 0) return
    const item = box[0]
    try {
      await api(item.path, { method: item.method, body: item.body })
    } catch (e) {
      if (e.offline || e.message === '認証が必要です' || (e.status && e.status >= 500)) return
      console.error('送信できないデータを破棄しました', item, e)
    }
    writeJSON(OUTBOX_KEY, readJSON(OUTBOX_KEY, []).filter(x => x.qid !== item.qid))
    notifyOutbox()
  }
}

// Call once from the punch app; returns a cleanup function.
export function startOutboxSync() {
  const onOnline = () => flushOutbox()
  window.addEventListener('online', onOnline)
  const t = setInterval(flushOutbox, 30000)
  flushOutbox()
  return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
}

function rememberLocalPunch(log) {
  const today = getTodayDate()
  const list = readJSON(LOCAL_PUNCHES_KEY, []).filter(l => l.date === today)
  list.push(log)
  writeJSON(LOCAL_PUNCHES_KEY, list)
}

// Today's logs for one user: server copy (or last cached copy when offline)
// plus punches made on this device that the server may not have yet.
export async function getTodayUserLogs(userId) {
  const today = getTodayDate()
  const cache = readJSON(TODAY_LOGS_CACHE_KEY, {})
  let serverLogs
  try {
    serverLogs = await api('/logs', { query: { userId, date: today } })
    cache[userId] = { date: today, logs: serverLogs }
    Object.keys(cache).forEach(k => { if (cache[k].date !== today) delete cache[k] })
    writeJSON(TODAY_LOGS_CACHE_KEY, cache)
  } catch (e) {
    if (!e.offline) throw e
    serverLogs = cache[userId]?.date === today ? cache[userId].logs : []
  }
  const ids = new Set(serverLogs.map(l => l.id))
  const local = readJSON(LOCAL_PUNCHES_KEY, []).filter(l => l.user_id === userId && l.date === today && !ids.has(l.id))
  return [...serverLogs, ...local].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
}

function cacheUsers(users) {
  writeJSON(USERS_CACHE_KEY, users.map(u => ({
    id: u.id, name: u.name, pin: u.pin || '', employeeType: u.employeeType, workItems: u.workItems || [],
    asksTransport: u.asksTransport ?? getCommute(u).asks,
  })))
}

const enc = encodeURIComponent

// ─── Auth ──────────────────────────────────────────────────────────────────────
// Admin PIN is only ever checked on the server. device=true registers this
// device as a punch tablet (no expiry) instead of opening an admin session.
export async function adminLogin(pin, { device = false } = {}) {
  let res, j
  try {
    res = await fetch(apiBase() + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, device }),
    })
    j = await res.json().catch(() => ({}))
  } catch {
    return { ok: false, message: '通信できません。ネット接続を確認してください' }
  }
  if (res.ok) {
    setToken(device ? DEVICE_TOKEN_KEY : ADMIN_TOKEN_KEY, j.token)
    return { ok: true }
  }
  if (res.status === 429) {
    return { ok: false, message: `PINを続けて間違えたため、${Math.ceil(j.retryAfterSec / 60)}分間ロックされています` }
  }
  if (res.status === 403) {
    return { ok: false, message: j.remaining <= 2 ? `PINが違います（あと${j.remaining}回でロック）` : 'PINが違います' }
  }
  if (j.error === 'admin_pin_not_configured') return { ok: false, message: '管理者PINが設定されていません' }
  return { ok: false, message: 'エラーが発生しました' }
}

export function adminLogout() {
  const t = getToken(ADMIN_TOKEN_KEY)
  setToken(ADMIN_TOKEN_KEY, null)
  if (t) fetch(apiBase() + '/auth/logout', { method: 'POST', headers: { 'X-Admin-Token': t } }).catch(() => {})
}

export function hasAdminSession() {
  return !!getToken(ADMIN_TOKEN_KEY)
}

export function isDeviceRegistered() {
  return !!getToken(DEVICE_TOKEN_KEY)
}

export async function saveAdminPin(newPin) {
  await api('/config/adminPin', { method: 'PUT', body: { value: newPin } })
}

export const DEFAULT_MIN_WAGE = 1077  // 愛知県 2024年10月改定

export async function getMinWage() {
  try {
    const cfg = await api('/config')
    if (Number(cfg.minWage)) return Number(cfg.minWage)
  } catch {}
  return DEFAULT_MIN_WAGE
}

export async function saveMinWage(wage) {
  await api('/config/minWage', { method: 'PUT', body: { value: wage } })
}

export async function saveOvertimeApp(userId, date, minutes) {
  await api('/overtime_apps', { method: 'PUT', body: { userId, date, minutes } })
}

export async function getOvertimeApp(userId, date) {
  try {
    const r = await api('/overtime_apps', { query: { userId, date } })
    return r.minutes || 0
  } catch { return 0 }
}

export async function saveSalariedDay(userId, date, { breakMins, overtimeMins }) {
  await api('/salaried_days', { method: 'PUT', body: { userId, date, breakMins: breakMins ?? 0, overtimeMins: overtimeMins ?? 0 } })
}

export async function getSalariedDaysForMonth(dateFrom, dateTo) {
  try {
    return await api('/salaried_days', { query: { dateFrom, dateTo } })
  } catch { return {} }
}

// Device-local date "YYYY-MM-DD" (the tablets run in Japan time)
export function localToday() {
  return getTodayDate()
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

export async function initDB() {}

export async function resolveUser(qrValue) {
  if (!qrValue) return null
  try {
    return await api(`/users/${enc(qrValue)}`)
  } catch (e) {
    if (!e.offline) throw e
    return readJSON(USERS_CACHE_KEY, []).find(u => u.id === qrValue) || null
  }
}

export async function resolveUserByPin(pin) {
  if (!pin) return null
  try {
    return await api('/users', { query: { pin } })
  } catch (e) {
    if (!e.offline) throw e
    return readJSON(USERS_CACHE_KEY, []).find(u => u.pin && u.pin === pin) || null
  }
}

export async function saveLog({ userId, workType, workItems, logType, transportCount, firstWork, lastWork, sessionId: providedSessionId }) {
  const now = new Date()
  const date = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')
  const time = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const workTypeStr = workItems
    ? Object.entries(workItems).filter(([, m]) => m > 0).map(([t, m]) => `${t}:${m}`).join(',')
    : (workType || '')
  const sessionId = providedSessionId || crypto.randomUUID()
  const id = crypto.randomUUID()
  const log = {
    id,
    user_id: userId,
    work_type: workTypeStr,
    log_type: logType || '',
    timestamp: now.toISOString(),
    date,
    time,
    session_id: sessionId,
    work_items: workItems || null,
    transport_count: transportCount || null,
    first_work: firstWork || null,
    last_work: lastWork || null,
  }
  rememberLocalPunch(log)
  enqueue({ qid: id, path: '/logs', method: 'POST', body: log })
  await flushOutbox()
  return { id, sessionId }
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
  const ins = (await getTodayUserLogs(userId)).filter(l => l.log_type === '出勤')
  return ins.length ? ins[ins.length - 1] : null
}

export async function getClockInTimeForDate(userId, date) {
  return api('/logs/check_in', { query: { userId, date } })
}

// ─── Work Reports (業務時間申告) ────────────────────────────────────────────────

export async function saveWorkReport(userId, dateStr, items) {
  const filtered = Object.fromEntries(Object.entries(items).filter(([, m]) => m > 0))
  const key = `wr:${userId}_${dateStr}`
  enqueue({ qid: crypto.randomUUID(), key, path: '/work_reports', method: 'PUT', body: { userId, date: dateStr, items: filtered } })
  await flushOutbox()
}

export async function getWorkReport(userId, dateStr) {
  return api('/work_reports', { query: { userId, date: dateStr } })
}

export async function getWorkReportsForRange(dateFrom, dateTo) {
  return api('/work_reports', { query: { dateFrom, dateTo } })
}

export function generateSessionId() {
  return crypto.randomUUID()
}

export async function saveSessionWorkReport(userId, dateStr, sessionId, items) {
  const key = `swr:${userId}_${dateStr}_${sessionId}`
  enqueue({ qid: crypto.randomUUID(), key, path: '/session_work_reports', method: 'PUT', body: { userId, date: dateStr, sessionId, items } })
  await flushOutbox()
}

export async function getSessionWorkReportsForDate(userId, dateStr) {
  return api('/session_work_reports', { query: { userId, date: dateStr } })
}

// 従業員カレンダー用: ユーザーの全session_work_reportsとwork_reports
export async function getSessionWorkReportsForUser(userId) {
  const r = await api('/session_work_reports', { query: { userId } })
  const sessionsByDate = {}
  Object.entries(r.sessionsByDate || {}).forEach(([d, ids]) => { sessionsByDate[d] = new Set(ids) })
  return { bySession: r.bySession || {}, sessionsByDate, legacyWorkedDates: new Set(r.legacyWorkedDates || []) }
}

export async function getSessionWorkReportsForRange(dateFrom, dateTo) {
  return api('/session_work_reports', { query: { dateFrom, dateTo } })
}

export async function getSessionWorkStatusForUserRange(userId, dateFrom, dateTo) {
  const r = await api('/session_work_reports/status', { query: { userId, dateFrom, dateTo } })
  const sessionByDate = {}
  Object.entries(r.sessionByDate || {}).forEach(([d, ids]) => { sessionByDate[d] = new Set(ids) })
  return { sessionByDate, legacyDates: new Set(r.legacyDates || []), conflictDates: new Set(r.conflictDates || []) }
}

export async function deleteSessionWorkReport(userId, dateStr, sessionId) {
  try { await api('/session_work_reports', { method: 'DELETE', query: { userId, date: dateStr, sessionId } }) } catch {}
}

export async function deleteAllSessionWorkReportsForDate(userId, dateStr) {
  await api('/session_work_reports', { method: 'DELETE', query: { userId, date: dateStr } })
}

export async function getMergedWorkReportsForRange(dateFrom, dateTo) {
  return api('/work_reports/merged', { query: { dateFrom, dateTo } })
}

export async function getSessionWorkReportsWithSessionsForRange(dateFrom, dateTo) {
  return api('/session_work_reports/with_sessions', { query: { dateFrom, dateTo } })
}

export async function saveDayEditBatch(payload) {
  await api('/batch/day_edit', { method: 'POST', body: payload })
}

export async function isCheckedIn(userId) {
  const logs = await getTodayUserLogs(userId)
  const ins = logs.filter(l => l.log_type === '出勤').length
  const outs = logs.filter(l => l.log_type === '退勤').length
  return ins > outs
}

export async function getLogs({ date, dateFrom, dateTo, userId } = {}) {
  return api('/logs', { query: { date, dateFrom, dateTo, userId } })
}

export async function getUsers() {
  try {
    const users = await api('/users')
    cacheUsers(users)
    return users
  } catch (e) {
    if (!e.offline) throw e
    return readJSON(USERS_CACHE_KEY, [])
  }
}

export async function upsertUser(user) {
  await api(`/users/${enc(user.id)}`, { method: 'PUT', body: user })
}

export async function deleteUserDoc(id) {
  await api(`/users/${enc(id)}`, { method: 'DELETE', query: { docOnly: 'true' } })
}

export async function deleteUser(id) {
  await api(`/users/${enc(id)}`, { method: 'DELETE' })
}

export async function deleteLog(id) {
  await api(`/logs/${enc(id)}`, { method: 'DELETE' })
}

export async function getTodayStatuses() {
  const today = getTodayDate()
  let statuses = {}
  try {
    statuses = await api('/logs/today_statuses', { query: { date: today } })
  } catch (e) {
    if (!e.offline) throw e
    const cache = readJSON(TODAY_LOGS_CACHE_KEY, {})
    Object.entries(cache).forEach(([uid, c]) => {
      if (c.date !== today) return
      const ins = c.logs.filter(l => l.log_type === '出勤').length
      const outs = c.logs.filter(l => l.log_type === '退勤').length
      statuses[uid] = ins > outs
    })
  }
  // punches still waiting in the outbox aren't known to the server yet
  const pendingIds = new Set(readJSON(OUTBOX_KEY, []).map(x => x.qid))
  readJSON(LOCAL_PUNCHES_KEY, [])
    .filter(l => l.date === today && pendingIds.has(l.id))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    .forEach(l => { statuses[l.user_id] = l.log_type !== '退勤' })
  return statuses
}

export async function saveLogManual({ userId, workType, logType, date, time, firstWork, lastWork, sessionId }) {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = time.split(':').map(Number)
  const dt = new Date(y, mo - 1, d, h, m, 0)
  await api('/logs', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      user_id: userId,
      work_type: workType || '',
      log_type: logType,
      timestamp: dt.toISOString(),
      date,
      time: time + ':00',
      session_id: sessionId || null,
      first_work: firstWork || null,
      last_work: lastWork || null,
    },
  })
}

export async function updateLogTime(id, timeStr) {
  await api(`/logs/${enc(id)}`, { method: 'PATCH', body: { time: timeStr } })
}

// Returns the applicable { normal, sunday } rates for a given date given a user's itemRates entry for one type
export function getRatesForDate(rateObj, dateStr) {
  const history = rateObj?.rateHistory
  if (!history || history.length === 0) {
    return { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
  }
  const sorted = [...history].sort((a, b) => {
    if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1
    return a.from.localeCompare(b.from)
  })
  let result = { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
  for (const e of sorted) { if (!e.from || e.from <= dateStr) result = { normal: Number(e.normal) || 0, sunday: Number(e.sunday) || 0 } }
  return result
}

// ─── Breaks (休憩・中抜け) ─────────────────────────────────────────────────────
// A break is a 休憩開始 / 休憩終了 pair inside one work session (same
// session_id), so a break doesn't start a new session (no extra 準備時間, no
// work input when stepping out).

export const BREAK_START = '休憩開始'
export const BREAK_END = '休憩終了'

// Pairs break logs of ONE session in time order → [{ start, end, startLog, endLog }]
export function pairBreaks(sessionLogs) {
  const sorted = [...sessionLogs]
    .filter(l => l.log_type === BREAK_START || l.log_type === BREAK_END)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
  const out = []
  for (const l of sorted) {
    const t = (l.time || '').substring(0, 5)
    if (l.log_type === BREAK_START) out.push({ start: t, end: '', startLog: l, endLog: null })
    else {
      const open = [...out].reverse().find(b => !b.endLog)
      if (open) { open.end = t; open.endLog = l } else out.push({ start: '', end: t, startLog: null, endLog: l })
    }
  }
  return out
}

export function breakMinutes(breaks) {
  return breaks.reduce((sum, b) => {
    if (!b.start || !b.end) return sum
    const [h1, m1] = b.start.split(':').map(Number)
    const [h2, m2] = b.end.split(':').map(Number)
    return sum + Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1))
  }, 0)
}

// Where the employee stands right now: 'off' | 'working' | 'break'
export async function getTodayPunchState(userId) {
  const logs = await getTodayUserLogs(userId)
  const ins = logs.filter(l => l.log_type === '出勤')
  const outs = logs.filter(l => l.log_type === '退勤').length
  if (ins.length <= outs) return { state: 'off', logs }
  const clockIn = ins[ins.length - 1]
  const sessionId = clockIn.session_id || null
  const breaks = sessionId ? pairBreaks(logs.filter(l => l.session_id === sessionId)) : []
  const openBreak = breaks.find(b => b.startLog && !b.endLog) || null
  return { state: openBreak ? 'break' : 'working', logs, clockIn, sessionId, breaks, openBreak }
}

// ─── Work plans (勤務予定) ────────────────────────────────────────────────────

export async function getWorkPlans(userId, dateFrom, dateTo) {
  return api('/work_plans', { query: { userId, dateFrom, dateTo } })
}

// Today's plan for the clock-out screen; null when unknown (e.g. offline)
export async function getWorkPlanForDay(userId, date) {
  try {
    const r = await api('/work_plans', { query: { userId, date } })
    const items = r[date]?.items
    return items && Object.keys(items).length > 0 ? items : null
  } catch { return null }
}

export async function saveWorkPlan(userId, date, items) {
  await api('/work_plans', { method: 'PUT', body: { userId, date, items } })
}

export async function copyWorkPlans({ userId, weekStart, weeks, overwriteCopied = false, dryRun = false }) {
  return api('/work_plans/copy', { method: 'POST', body: { userId, weekStart, weeks, overwriteCopied, dryRun, minDate: getTodayDate() } })
}

// ─── Commute / transport (通勤・交通費) ────────────────────────────────────────

export const COMMUTE_METHODS = [
  { key: 'car', label: '車' },
  { key: 'bus', label: 'バス' },
  { key: 'train', label: '電車' },
  { key: 'walk', label: '徒歩' },
  { key: 'none', label: '交通費なし' },
]

// Users saved before commute methods existed have no commuteMethod; they keep
// the old behaviour (daily amount × days). Must match asksTransport() in the API.
export function getCommute(user) {
  const method = user?.commuteMethod || null
  const amount = Number(user?.itemRates?.['交通費']?.amount) || 0
  const distance = Number(user?.commuteDistanceKm) || 0
  const label = COMMUTE_METHODS.find(m => m.key === method)?.label || '未設定'
  let asks
  if (user?.employeeType === 'salaried') asks = false
  else if (method === 'walk' || method === 'none') asks = false
  else if (method === 'car') asks = distance > 0
  else asks = amount > 0
  return { method, label, amount, distance, asks }
}

export async function getCarRates() {
  try {
    const cfg = await api('/config')
    const list = JSON.parse(cfg.carRates || '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export async function saveCarRates(list) {
  await api('/config/carRates', { method: 'PUT', body: { value: JSON.stringify(list) } })
}

export function carRateForDate(carRates, dateStr) {
  const sorted = [...carRates].sort((a, b) => (a.from || '').localeCompare(b.from || ''))
  let rate = 0
  for (const e of sorted) if (!e.from || e.from <= dateStr) rate = Number(e.rate) || 0
  return rate
}

// Transport pay rows for the given eligible days. Car: distance × the unit
// price valid on each day (a new price only affects days from its start date).
export function computeTransport(user, eligibleDates, carRates = []) {
  const c = getCommute(user)
  const days = [...eligibleDates].sort()
  if (days.length === 0) return []
  if (c.method === 'walk' || c.method === 'none') return []
  if (c.method === 'car') {
    if (!c.distance) return []
    const groups = []
    for (const d of days) {
      const rate = carRateForDate(carRates, d)
      const last = groups[groups.length - 1]
      if (last && last.rate === rate) last.days++
      else groups.push({ rate, days: 1 })
    }
    return groups.map(g => {
      const daily = c.distance * g.rate
      return {
        label: `交通費（車 ${c.distance}km × ${g.rate}円）`,
        excelLabel: `交通費（車 ${c.distance}km×${g.rate}円/km・${g.days}日）`,
        days: g.days, rate: Math.round(daily * 100) / 100, pay: Math.round(g.days * daily),
      }
    })
  }
  if (!c.amount) return []
  return [{ label: '交通費', excelLabel: `交通費（${days.length}日）`, days: days.length, rate: c.amount, pay: Math.round(days.length * c.amount) }]
}

export async function getTransportDays(dateFrom, dateTo) {
  return api('/transport_days', { query: { dateFrom, dateTo } })
}

// The employee's choice already saved for today (true/false), or null
export async function getTransportDay(userId, date) {
  try {
    const r = await api('/transport_days', { query: { userId, date } })
    const v = r[`${userId}_${date}`]
    return v === undefined ? null : v
  } catch { return null }
}

export async function saveTransportDay(userId, date, eligible) {
  enqueue({ qid: crypto.randomUUID(), key: `td:${userId}_${date}`, path: '/transport_days', method: 'PUT', body: { userId, date, eligible } })
  await flushOutbox()
}

// Days that count as attendance: at least one session with both 出勤 and 退勤
export function attendanceDates(byDate) {
  return Object.keys(byDate).filter(ds => byDate[ds].sessions.some(s => s.inLog && s.outLog))
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

  function prevDateStr(dateStr) {
    const d = new Date(dateStr); d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Returns { normal, sunday } applicable for a given date
  function getRatesForDateLocal(rateObj, dateStr) {
    const history = rateObj?.rateHistory
    if (!history || history.length === 0) {
      return { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
    }
    const sorted = [...history].sort((a, b) => {
      if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1
      return a.from.localeCompare(b.from)
    })
    let result = { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
    for (const e of sorted) { if (!e.from || e.from <= dateStr) result = { normal: Number(e.normal) || 0, sunday: Number(e.sunday) || 0 } }
    return result
  }

  // Returns array of rate periods [{ fromDate, toDate, normal, sunday }] covering the month
  function getMonthRatePeriods(rateObj, y, m) {
    const pad2 = n => String(n).padStart(2, '0')
    const monthStart = `${y}-${pad2(m)}-01`
    const lastD = new Date(y, m, 0).getDate()
    const monthEnd = `${y}-${pad2(m)}-${pad2(lastD)}`
    const defR = { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
    const history = rateObj?.rateHistory
    if (!history || history.length === 0) return [{ fromDate: monthStart, toDate: monthEnd, ...defR }]
    const sorted = [...history].filter(e => !e.from || e.from <= monthEnd).sort((a, b) => {
      if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1
      return a.from.localeCompare(b.from)
    })
    if (sorted.length === 0) return [{ fromDate: monthStart, toDate: monthEnd, ...defR }]
    const baseCandidates = sorted.filter(e => !e.from || e.from <= monthStart)
    const base = baseCandidates.length > 0 ? baseCandidates[baseCandidates.length - 1] : sorted[0]
    const inMonthEntries = sorted.filter(e => e.from && e.from > monthStart && e.from <= monthEnd)
    const periods = []
    let curFrom = monthStart, curNormal = Number(base?.normal) || defR.normal, curSunday = Number(base?.sunday) || defR.sunday
    for (const e of inMonthEntries) {
      const prev = prevDateStr(e.from)
      if (prev >= curFrom) periods.push({ fromDate: curFrom, toDate: prev, normal: curNormal, sunday: curSunday })
      curFrom = e.from; curNormal = Number(e.normal) || 0; curSunday = Number(e.sunday) || 0
    }
    periods.push({ fromDate: curFrom, toDate: monthEnd, normal: curNormal, sunday: curSunday })
    return periods
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
    timeWrap: 25,
  }

  const STYLES_XML = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<numFmts count="5">',
    '<numFmt numFmtId="164" formatCode="yyyy/m/d"/>',
    '<numFmt numFmtId="165" formatCode="h:mm"/>',
    '<numFmt numFmtId="166" formatCode="0.0"/>',
    '<numFmt numFmtId="167" formatCode="#,##0"/>',
    '<numFmt numFmtId="168" formatCode="[h]時間mm分"/>',
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
    '<cellXfs count="26">',
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
    // 25 multi-session text cell: bordered, center, wrapText
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('')

  const minWage = await getMinWage()

  function roundUp15str(t) {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const tot = h * 60 + m, rem = tot % 15
    const r = rem === 0 ? tot : tot + (15 - rem)
    return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
  }
  function roundDown15str(t) {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const r = Math.floor((h * 60 + m) / 15) * 15
    return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`
  }

  const enc = new TextEncoder()

  // Fetch work_reports: prefer session data over legacy, merge correctly
  const [allWorkReports, allSessionWorkBySession, transportFlags, carRates] = await Promise.all([
    getMergedWorkReportsForRange(dateFrom || '', dateTo || ''),
    getSessionWorkReportsWithSessionsForRange(dateFrom || '', dateTo || ''),
    getTransportDays(dateFrom || '', dateTo || '9999-12-31'),
    getCarRates(),
  ])
  const dayCountCells = (row, cells) => cells.map(([col, text]) =>
    `<c r="${col}${row}" s="${S.username}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`).join('')

  const userEntries = users.filter(u =>
    logs.some(l => l.user_id === u.id) ||
    Object.keys(allWorkReports).some(k => k.startsWith(`${u.id}_`))
  )
  const sheetXmls = []
  const summaryData = { types: {} }

  for (const user of userEntries) {
    const userLogs = logs.filter(l => l.user_id === user.id)
    const itemRates = user.itemRates || {}

    // Build byDate first so we can compute monthly hours for filtering
    // Sort by timestamp so later 退勤 records overwrite earlier ones (prevents double-count from duplicate punches)
    const sortedLogs = [...userLogs].sort((a, b) => (a.timestamp || '') < (b.timestamp || '') ? -1 : 1)
    const byDate = {}
    sortedLogs.forEach(log => {
      if (!byDate[log.date]) byDate[log.date] = { pendingIn: null, sessions: [] }
      if (log.log_type === '出勤') {
        byDate[log.date].pendingIn = log
      } else if (log.log_type === '退勤') {
        byDate[log.date].sessions.push({
          inLog: byDate[log.date].pendingIn,
          outLog: log,
          workItems: getWorkItems(log),
          firstWork: log.first_work || null,
          lastWork: log.last_work || null,
        })
        byDate[log.date].pendingIn = null
      }
    })
    // Handle unpaired clock-ins (still checked in)
    Object.values(byDate).forEach(entry => {
      if (entry.pendingIn) {
        entry.sessions.push({ inLog: entry.pendingIn, outLog: null, workItems: {}, firstWork: null, lastWork: null })
        entry.pendingIn = null
      }
    })

    // Salaried employees: attendance only (日付・曜日・QR出勤・QR退勤)
    if (user.employeeType === 'salaried') {
      const WB_NS_SAL = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
      const WB_REL_SAL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
      const hdrCellSal = (col, rn, text) => `<c r="${col}${rn}" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`

      const T1_HDR_SAL = 4, T1_DATA_SAL = 5

      const t1HdrSal =
        `<row r="${T1_HDR_SAL}" ht="36">` +
        hdrCellSal('A', T1_HDR_SAL, '日付') + hdrCellSal('B', T1_HDR_SAL, '曜日') +
        hdrCellSal('C', T1_HDR_SAL, '出勤打刻') + hdrCellSal('D', T1_HDR_SAL, '退勤打刻') +
        `</row>`

      const t1RowsSal = []
      let r1sal = T1_DATA_SAL

      for (let d = 1; d <= lastDay; d++) {
        const ds = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
        const dow = new Date(ym_y, ym_m - 1, d).getDay()
        const isSat = dow === 6, isSun = dow === 0
        const dt = isSun ? 'su' : (isSat ? 'sa' : 'wd')
        const sessions = byDate[ds]?.sessions || []
        const completedSessions = sessions.filter(s => s.inLog && s.outLog)
        const hasCompleted = completedSessions.length > 0

        const t1c = []
        t1c.push(`<c r="A${r1sal}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
        t1c.push(`<c r="B${r1sal}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)

        let rowHtAttr = ''
        if (hasCompleted) {
          const allInTimes = completedSessions.map(s => s.inLog.time.substring(0, 5))
          const allOutTimes = completedSessions.map(s => s.outLog.time.substring(0, 5))
          if (allInTimes.length === 1) {
            const [ih, im] = allInTimes[0].split(':').map(Number)
            const [oh, om] = allOutTimes[0].split(':').map(Number)
            t1c.push(`<c r="C${r1sal}" s="${S.time[dt]}"><v>${excelTime(ih, im)}</v></c>`)
            t1c.push(`<c r="D${r1sal}" s="${S.time[dt]}"><v>${excelTime(oh, om)}</v></c>`)
          } else {
            rowHtAttr = ` ht="${15 * allInTimes.length + 5}" customHeight="1"`
            const inXml = allInTimes.map(t => esc(t)).join('&#10;')
            const outXml = allOutTimes.map(t => esc(t)).join('&#10;')
            t1c.push(`<c r="C${r1sal}" s="${S.timeWrap}" t="inlineStr"><is><t xml:space="preserve">${inXml}</t></is></c>`)
            t1c.push(`<c r="D${r1sal}" s="${S.timeWrap}" t="inlineStr"><is><t xml:space="preserve">${outXml}</t></is></c>`)
          }
        } else {
          const hasIn = sessions.some(s => s.inLog)
          if (hasIn) {
            const firstIn = (sessions[0].inLog?.time || '').substring(0, 5)
            if (firstIn) { const [ih, im] = firstIn.split(':').map(Number); t1c.push(`<c r="C${r1sal}" s="${S.time[dt]}"><v>${excelTime(ih, im)}</v></c>`) }
            else t1c.push(`<c r="C${r1sal}" s="${S.time[dt]}"/>`)
          } else {
            t1c.push(`<c r="C${r1sal}" s="${S.time[dt]}"/>`)
          }
          t1c.push(`<c r="D${r1sal}" s="${S.time[dt]}"/>`)
        }
        t1RowsSal.push(`<row r="${r1sal}"${rowHtAttr}>${t1c.join('')}</row>`)
        r1sal++
      }

      const row1sal = `<row r="1" ht="22"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 出勤簿（社員）')}</t></is></c></row>`
      const row2sal = `<row r="2" ht="18"><c r="A2" s="${S.username}" t="inlineStr"><is><t>${esc('担当者：' + user.name)}</t></is></c>` +
        dayCountCells(2, [['C', `出勤日数：${attendanceDates(byDate).length}日`]]) + `</row>`
      const sheetDataSal = `<sheetData>${row1sal}${row2sal}${t1HdrSal}${t1RowsSal.join('')}</sheetData>`
      const colsXmlSal = `<cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="8" customWidth="1"/><col min="3" max="4" width="14" customWidth="1"/></cols>`
      sheetXmls.push(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="${WB_NS_SAL}" xmlns:r="${WB_REL_SAL}">` +
        `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
        `${colsXmlSal}${sheetDataSal}</worksheet>`
      )
      continue
    }

    // Extract work reports for this user (pay calculation source)
    const userWorkReports = {}
    Object.entries(allWorkReports).forEach(([key, items]) => {
      if (key.startsWith(`${user.id}_`)) {
        const dateStr = key.slice(user.id.length + 1)
        if (Object.values(items).some(m => m > 0)) userWorkReports[dateStr] = items
      }
    })

    // Build dailyTypeMinsSplit from work_reports
    const dailyTypeMinsSplit = {}
    Object.entries(userWorkReports).forEach(([dateStr, items]) => {
      const [yr, mo, d] = dateStr.split('-').map(Number)
      const isWe = new Date(yr, mo - 1, d).getDay() === 0
      Object.entries(items).forEach(([t, mm]) => {
        if (!mm) return
        if (!dailyTypeMinsSplit[dateStr]) dailyTypeMinsSplit[dateStr] = {}
        if (!dailyTypeMinsSplit[dateStr][t]) dailyTypeMinsSplit[dateStr][t] = { wd: 0, we: 0 }
        if (isWe) dailyTypeMinsSplit[dateStr][t].we += mm
        else dailyTypeMinsSplit[dateStr][t].wd += mm
      })
    })

    // workTypes: user.workItems types present in work_reports, not EXCL
    const workReportTypeSet = new Set(
      Object.values(userWorkReports).flatMap(items => Object.keys(items).filter(t => !EXCL.has(t)))
    )
    const workTypes = (user.workItems || []).filter(t => !EXCL.has(t) && workReportTypeSet.has(t))

    // workingDays = days with work report AND ≥1 completed QR session (spec 7)
    let workingDays = 0
    let totalCompletedSessions = 0
    const workingDates = []
    Object.entries(userWorkReports).forEach(([dateStr, items]) => {
      if (!Object.values(items).some(m => m > 0)) return
      const entry = byDate[dateStr]
      const completedSess = entry ? entry.sessions.filter(s => s.inLog && s.outLog) : []
      if (completedSess.length > 0) { workingDays++; workingDates.push(dateStr); totalCompletedSessions += completedSess.length }
    })
    // 交通費対象日 = 勤務日のうち、本人が「支給なし」にしていない日
    const transportDates = workingDates.filter(d => transportFlags[`${user.id}_${d}`] !== false)
    const commute = getCommute(user)

    // Accumulate global summary data from work_reports
    for (const type of workTypes) {
      if (!summaryData.types[type]) summaryData.types[type] = { mins: 0, pay: 0 }
      Object.entries(dailyTypeMinsSplit).forEach(([dateStr, typeMap]) => {
        const dm = typeMap[type]; if (!dm) return
        const { wd, we } = dm
        const r = getRatesForDateLocal(itemRates[type], dateStr)
        summaryData.types[type].mins += wd + we
        summaryData.types[type].pay += Math.round(wd / 60 * r.normal) + (r.sunday ? Math.round(we / 60 * r.sunday) : Math.round(we / 60 * r.normal))
      })
    }

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

    // Table 1: QR打刻記録 (one row per session, or empty row if no sessions that day)
    const T1_HDR = 4, T1_DATA = 5
    const dayRowsT1 = []
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
      const entry = byDate[dateStr]
      dayRowsT1.push({ d, dateStr, sessions: entry?.sessions || [] })
    }
    const totalDataRows = dayRowsT1.reduce((s, dr) => s + Math.max(1, dr.sessions.length), 0)
    const T1_TOT = T1_DATA + totalDataRows
    const T1_DATA_END = T1_TOT - 1

    // Table 2: 業務時間申告 (one row per calendar day from work_reports)
    const T2_HDR = T1_TOT + 2
    const T2_DATA = T2_HDR + 1
    const T2_TOT = T2_DATA + lastDay
    const T2_DATA_END = T2_TOT - 1

    const T3_HDR = T2_TOT + 2

    const row1 = `<row r="1" ht="22"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 出勤簿')}</t></is></c></row>`
    const row2 = `<row r="2" ht="18"><c r="A2" s="${S.username}" t="inlineStr"><is><t>${esc('担当者：' + user.name)}</t></is></c>` +
      dayCountCells(2, [
        ['C', `出勤日数：${attendanceDates(byDate).length}日`],
        ...(commute.asks ? [['D', `交通費対象：${transportDates.length}日`]] : []),
      ]) + `</row>`

    const hdrCell = (col, rn, text) =>
      `<c r="${col}${rn}" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`

    // 表1ヘッダー（打刻記録）
    const t1Hdr =
      `<row r="${T1_HDR}" ht="36">` +
      hdrCell('A', T1_HDR, '日付') + hdrCell('B', T1_HDR, '曜日') +
      hdrCell('C', T1_HDR, '出勤打刻') + hdrCell('D', T1_HDR, '退勤打刻') +
      `</row>`

    // 表2ヘッダー（業務時間申告）
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

    // 表1データ行（打刻記録、1セッション=1行）
    const t1Rows = []
    let r1 = T1_DATA
    for (const dr of dayRowsT1) {
      const { d, dateStr, sessions } = dr
      const dow = new Date(ym_y, ym_m - 1, d).getDay()
      const isSat = dow === 6, isSun = dow === 0
      const dt = isSun ? 'su' : (isSat ? 'sa' : 'wd')
      const sessionsToShow = sessions.length > 0 ? sessions : [null]
      const numSessions = sessions.length

      sessionsToShow.forEach((session, si) => {
        const isFirst = si === 0
        const t1c = []
        if (isFirst) {
          t1c.push(`<c r="A${r1}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
          t1c.push(`<c r="B${r1}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)
        } else {
          t1c.push(`<c r="A${r1}" s="${S.date[dt]}"/>`, `<c r="B${r1}" s="${S.dow[dt]}"/>`)
        }
        if (session) {
          const inStr = session.inLog?.time?.substring(0, 5) || ''
          const outStr = session.outLog?.time?.substring(0, 5) || ''
          if (inStr) { const [h, mi] = inStr.split(':').map(Number); t1c.push(`<c r="C${r1}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`) }
          else t1c.push(`<c r="C${r1}" s="${S.time[dt]}"/>`)
          if (outStr) { const [h, mi] = outStr.split(':').map(Number); t1c.push(`<c r="D${r1}" s="${S.time[dt]}"><v>${excelTime(h, mi)}</v></c>`) }
          else t1c.push(`<c r="D${r1}" s="${S.time[dt]}"/>`)
        } else {
          t1c.push(`<c r="C${r1}" s="${S.time[dt]}"/>`, `<c r="D${r1}" s="${S.time[dt]}"/>`)
        }
        t1Rows.push(`<row r="${r1}">${t1c.join('')}</row>`)
        r1++
      })
    }

    // 表1合計行
    const t1Tot =
      `<row r="${T1_TOT}">` +
      `<c r="A${T1_TOT}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>` +
      `<c r="B${T1_TOT}" s="${S.tot_lbl}"/>` +
      `<c r="C${T1_TOT}" s="${S.tot_lbl}"/>` +
      `<c r="D${T1_TOT}" s="${S.tot_lbl}"/>` +
      `</row>`

    // 表2データ行（業務時間申告、1日=1行）
    const t2Rows = []
    let r2 = T2_DATA
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${ym_y_str}-${ym_m_str}-${String(d).padStart(2, '0')}`
      const dow = new Date(ym_y, ym_m - 1, d).getDay()
      const isSat = dow === 6, isSun = dow === 0
      const dt = isSun ? 'su' : (isSat ? 'sa' : 'wd')
      const t2c = []
      t2c.push(`<c r="A${r2}" s="${S.date[dt]}"><v>${excelDate(ym_y, ym_m, d)}</v></c>`)
      t2c.push(`<c r="B${r2}" s="${S.dow[dt]}" t="inlineStr"><is><t>${DOW_NAMES[dow]}</t></is></c>`)
      const items = userWorkReports[dateStr] || {}
      for (const type of workTypes) {
        const { wd: wdCol, su: suCol, hasSunday } = typeColMap[type]
        const mins = items[type] || 0
        const hours = mins / 60
        if (hasSunday) {
          if (isSun) {
            t2c.push(`<c r="${wdCol}${r2}" s="${S.hours[dt]}"/>`)
            t2c.push(mins > 0 ? `<c r="${suCol}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>` : `<c r="${suCol}${r2}" s="${S.hours[dt]}"/>`)
          } else {
            t2c.push(mins > 0 ? `<c r="${wdCol}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>` : `<c r="${wdCol}${r2}" s="${S.hours[dt]}"/>`)
            t2c.push(`<c r="${suCol}${r2}" s="${S.hours[dt]}"/>`)
          }
        } else {
          t2c.push(mins > 0 ? `<c r="${wdCol}${r2}" s="${S.hours[dt]}"><v>${hours / 24}</v></c>` : `<c r="${wdCol}${r2}" s="${S.hours[dt]}"/>`)
        }
      }
      t2c.push(allTypeCols.length > 0
        ? `<c r="${typeTotalCol}${r2}" s="${S.hours[dt]}"><f>SUM(${allTypeCols.map(c => c + r2).join(',')})</f></c>`
        : `<c r="${typeTotalCol}${r2}" s="${S.hours[dt]}"/>`)
      t2Rows.push(`<row r="${r2}">${t2c.join('')}</row>`)
      r2++
    }

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

    // Helper: sum work_report mins for a type within a date range
    function periodMins(type, fromDate, toDate) {
      let wd = 0, we = 0
      Object.entries(dailyTypeMinsSplit).forEach(([ds, tm]) => {
        if (ds >= fromDate && ds <= toDate && tm[type]) { wd += tm[type].wd; we += tm[type].we }
      })
      return { wd, we }
    }

    for (const type of workTypes) {
      const rateObj = itemRates[type] || {}
      const hasSunday = !!(rateObj.sunday)
      const periods = getMonthRatePeriods(rateObj, ym_y, ym_m)
      const multiPeriod = periods.length > 1

      for (const period of periods) {
        const { fromDate, toDate, normal: normalRate, sunday: sundayRate } = period
        const mins = periodMins(type, fromDate, toDate)

        // Date range label suffix (only when rate changes mid-month)
        const rangeLabel = multiPeriod
          ? `（${fromDate.slice(5).replace('-', '/')}〜${toDate.slice(5).replace('-', '/')}）`
          : ''

        if (hasSunday) {
          if (mins.wd > 0) {
            const pay = Math.round(mins.wd / 60 * normalRate)
            totalPayHours += mins.wd / 60; totalPayAmount += pay
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(type + rangeLabel)}</t></is></c>` +
              `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${mins.wd / 60 / 24}</v></c>` +
              (normalRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${normalRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
              `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${pay}</v></c>` +
              `</row>`
            ); payRowIdx++
          }
          if (mins.we > 0) {
            const pay = Math.round(mins.we / 60 * sundayRate)
            totalPayHours += mins.we / 60; totalPayAmount += pay
            const suLabel = type + rangeLabel + '（日曜）'
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(suLabel)}</t></is></c>` +
              `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${mins.we / 60 / 24}</v></c>` +
              (sundayRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${sundayRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
              `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${pay}</v></c>` +
              `</row>`
            ); payRowIdx++
          }
        } else {
          const total = mins.wd + mins.we
          if (total > 0) {
            const pay = Math.round(total / 60 * normalRate)
            totalPayHours += total / 60; totalPayAmount += pay
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(type + rangeLabel)}</t></is></c>` +
              `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${total / 60 / 24}</v></c>` +
              (normalRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${normalRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
              `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${pay}</v></c>` +
              `</row>`
            ); payRowIdx++
          }
        }
      }
    }

    // 交通費行
    for (const t of computeTransport(user, transportDates, carRates)) {
      totalPayAmount += t.pay
      payRows.push(
        `<row r="${payRowIdx}">` +
        `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(t.excelLabel)}</t></is></c>` +
        `<c r="B${payRowIdx}" s="${S.pay_lbl}"/>` +
        `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${t.rate}</v></c>` +
        `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${t.pay}</v></c>` +
        `</row>`
      )
      payRowIdx++
    }

    // 前後5分（最低賃金）行
    if (totalCompletedSessions > 0 && minWage > 0) {
      const prepHours = totalCompletedSessions * (10 / 60)
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
    const maxColIdx = Math.max(4, ci) // 4 = col D (last T1 column)
    // bestFit="1" lets Excel auto-size columns to content on open (no ####### ever)
    const colsXml =
      `<cols>` +
      `<col min="1" max="1" width="13" customWidth="1"/>` +
      `<col min="2" max="${maxColIdx}" width="20" bestFit="1"/>` +
      `</cols>`
    const WB_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const WB_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    sheetXmls.push(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${WB_NS}" xmlns:r="${WB_REL_NS}">` +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `${colsXml}${sheetData}</worksheet>`
    )
  }

  // Build "集計" summary sheet (inserted as sheet1)
  {
    const WB_NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const WB_REL_S = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const shdrCell = (col, rn, text) =>
      `<c r="${col}${rn}" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`
    const summaryTypeEntries = Object.entries(summaryData.types)
    const totalTypeMins = summaryTypeEntries.reduce((s, [, v]) => s + v.mins, 0)
    const totalTypePay = summaryTypeEntries.reduce((s, [, v]) => s + v.pay, 0)
    let sumRows = ''
    sumRows += `<row r="1" ht="22"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${esc(yearMonthLabel + ' 業務別集計')}</t></is></c></row>`
    sumRows += `<row r="2" ht="36">${shdrCell('A', 2, '単価種別')}${shdrCell('B', 2, '時間合計')}${shdrCell('C', 2, '金額合計')}</row>`
    let sr = 3
    for (const [label, v] of summaryTypeEntries) {
      sumRows += `<row r="${sr}">` +
        `<c r="A${sr}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(label)}</t></is></c>` +
        `<c r="B${sr}" s="${S.tot_hrs}"><v>${v.mins / 1440}</v></c>` +
        `<c r="C${sr}" s="${S.tot_pay}"><v>${v.pay}</v></c>` +
        `</row>`
      sr++
    }
    sumRows += `<row r="${sr}">` +
      `<c r="A${sr}" s="${S.tot_lbl}" t="inlineStr"><is><t>合計</t></is></c>` +
      `<c r="B${sr}" s="${S.tot_hrs}"><f>SUM(B3:B${sr - 1})</f><v>0</v></c>` +
      `<c r="C${sr}" s="${S.tot_pay}"><f>SUM(C3:C${sr - 1})</f><v>0</v></c>` +
      `</row>`
    const summarySheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${WB_NS_S}" xmlns:r="${WB_REL_S}">` +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="3" width="20" bestFit="1"/></cols>` +
      `<sheetData>${sumRows}</sheetData></worksheet>`
    sheetXmls.unshift(summarySheetXml)
  }

  // Build XLSX package from scratch (no template needed)
  const WB_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const WB_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  const N = userEntries.length

  // sheet1 = 集計, sheet2..N+1 = user sheets
  const sheetEls =
    `<sheet name="集計" sheetId="1" r:id="rId1"/>` +
    userEntries.map((u, i) =>
      `<sheet name="${esc(u.name.substring(0, 31))}" sheetId="${i + 2}" r:id="rId${i + 2}"/>`
    ).join('')
  const wbXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${WB_NS}" xmlns:r="${WB_REL}">` +
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="14400" windowHeight="8100"/></bookViews>` +
    `<sheets>${sheetEls}</sheets>` +
    `<calcPr fullCalcOnLoad="1"/>` +
    `</workbook>`

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${WB_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    userEntries.map((_, i) =>
      `<Relationship Id="rId${i + 2}" Type="${WB_REL}/worksheet" Target="worksheets/sheet${i + 2}.xml"/>`
    ).join('') +
    `<Relationship Id="rId${N + 2}" Type="${WB_REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${N + 3}" Type="${WB_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`

  const ctXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WS_CT}"/>` +
    userEntries.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 2}.xml" ContentType="${WS_CT}"/>`).join('') +
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
