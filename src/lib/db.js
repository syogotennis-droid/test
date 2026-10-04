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
    // a JSON error body means our own server answered (not a Wi-Fi login page or proxy)
    e.fromServer = (res.headers.get('content-type') || '').includes('application/json')
    throw e
  }
  try {
    return await res.json()
  } catch {
    // e.g. a captive-portal page answered 200 with HTML
    const e = new Error(`API ${method} ${path}: unexpected response`)
    e.status = res.status
    e.badResponse = true
    throw e
  }
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

// Items the server keeps answering with an error that isn't a normal "invalid" reply (403/404/413,
// a Wi-Fi login page ...) are set aside after many tries so they can't block the punches behind
// them. They are kept, shown on screen, and put back in the queue when the app is opened again.
const OUTBOX_FAILED_KEY = 'outboxFailed'
const MAX_TRIES = 20
export function getFailedCount() {
  return readJSON(OUTBOX_FAILED_KEY, []).length
}
function requeueFailed() {
  const failed = readJSON(OUTBOX_FAILED_KEY, [])
  if (failed.length === 0) return
  writeJSON(OUTBOX_KEY, [...readJSON(OUTBOX_KEY, []), ...failed.map(x => ({ ...x, tries: 0 }))])
  writeJSON(OUTBOX_FAILED_KEY, [])
  notifyOutbox()
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
      // Keep the item for anything but a clear "invalid" answer from our own server
      // (400/409/422 with a JSON body). Wi-Fi login pages, proxies and 404/403 are retried.
      const invalid = e.fromServer && (e.status === 400 || e.status === 409 || e.status === 422)
      if (!invalid) {
        const answered = !!e.status && e.status < 500 && e.status !== 401 && !e.offline
        if (!answered) return // offline, 401, 5xx: wait and try again later
        const tries = (item.tries || 0) + 1
        if (tries < MAX_TRIES) {
          writeJSON(OUTBOX_KEY, readJSON(OUTBOX_KEY, []).map(x => (x.qid === item.qid ? { ...x, tries } : x)))
          return
        }
        console.error('送信を保留にしました', item, e)
        writeJSON(OUTBOX_FAILED_KEY, [...readJSON(OUTBOX_FAILED_KEY, []), item])
      } else {
        console.error('送信できないデータを破棄しました', item, e)
      }
    }
    writeJSON(OUTBOX_KEY, readJSON(OUTBOX_KEY, []).filter(x => x.qid !== item.qid))
    notifyOutbox()
  }
}

// Call once from the punch app; returns a cleanup function.
export function startOutboxSync() {
  requeueFailed()
  const onOnline = () => flushOutbox()
  window.addEventListener('online', onOnline)
  const t = setInterval(flushOutbox, 30000)
  flushOutbox()
  return () => { window.removeEventListener('online', onOnline); clearInterval(t) }
}

// A shift that started before midnight can still get its punches until OVERNIGHT_UNTIL_HOUR
export const OVERNIGHT_UNTIL_HOUR = 3

export function shiftDate(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function rememberLocalPunch(log) {
  const today = getTodayDate(), yesterday = shiftDate(today, -1)
  const list = readJSON(LOCAL_PUNCHES_KEY, []).filter(l => l.date === today || l.date === yesterday)
  list.push(log)
  writeJSON(LOCAL_PUNCHES_KEY, list)
}

// Logs of one user on one day (default: today): server copy (or last cached copy when
// offline) plus punches made on this device that the server may not have yet.
export async function getTodayUserLogs(userId, date = getTodayDate()) {
  const today = getTodayDate(), yesterday = shiftDate(today, -1)
  const cache = readJSON(TODAY_LOGS_CACHE_KEY, {})
  const ckey = `${userId}|${date}`
  // read before asking the server: a punch sent meanwhile is still counted
  const pendingIds = new Set(readJSON(OUTBOX_KEY, []).map(x => x.qid))
  let serverLogs, online = true
  try {
    serverLogs = await api('/logs', { query: { userId, date } })
    cache[ckey] = { userId, date, logs: serverLogs }
    Object.keys(cache).forEach(k => { if (cache[k].date !== today && cache[k].date !== yesterday) delete cache[k] })
    writeJSON(TODAY_LOGS_CACHE_KEY, cache)
  } catch (e) {
    if (!e.offline) throw e
    online = false
    serverLogs = cache[ckey]?.logs || []
  }
  const ids = new Set(serverLogs.map(l => l.id))
  // Online, the server is the truth: only punches still waiting to be sent are
  // added, so a punch an admin deleted doesn't come back from this device.
  // Offline, the cached copy may be older than punches already sent, so all
  // of this device's punches are added.
  const local = readJSON(LOCAL_PUNCHES_KEY, []).filter(l => l.user_id === userId && l.date === date && !ids.has(l.id)
    && (!online || pendingIds.has(l.id)))
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
    return { ok: false, message: '通信エラー。ネット接続を確認してください' }
  }
  if (res.ok) {
    setToken(device ? DEVICE_TOKEN_KEY : ADMIN_TOKEN_KEY, j.token)
    return { ok: true }
  }
  if (res.status === 429) {
    return { ok: false, message: `PINを連続で間違えたため、${Math.ceil(j.retryAfterSec / 60)}分間ロックされています` }
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

// Minimum wage with start dates, so a new wage never changes earlier days.
// Configs saved before the history existed are read as one entry "from the start".
// Throws when the settings can't be read (callers must not treat that as "no history")
export async function getMinWageHistory() {
  const cfg = await api('/config')
  let list = []
  try { list = JSON.parse(cfg.minWageHistory || '[]') } catch {}
  if (Array.isArray(list) && list.length > 0) return list
  return [{ from: null, wage: Number(cfg.minWage) || DEFAULT_MIN_WAGE }]
}

export function minWageForDate(history, dateStr) {
  const sorted = [...history].sort((a, b) => (a.from || '').localeCompare(b.from || ''))
  let wage = 0
  for (const e of sorted) if (!e.from || e.from <= dateStr) wage = Number(e.wage) || 0
  return wage
}

export async function saveMinWageHistory(list) {
  await api('/config/minWageHistory', { method: 'PUT', body: { value: JSON.stringify(list) } })
  // keep the single legacy value in step with today's wage
  await saveMinWage(minWageForDate(list, getTodayDate()))
}

export const DEFAULT_MIN_WAGE_ITEMS = ['研修会', '清掃', '事務処理']

// Work items whose hourly rate follows the minimum wage
export async function getMinWageItems() {
  const cfg = await api('/config')
  let list = null
  try { list = JSON.parse(cfg.minWageItems || 'null') } catch {}
  return Array.isArray(list) ? list : DEFAULT_MIN_WAGE_ITEMS
}

export async function saveMinWageItems(list) {
  await api('/config/minWageItems', { method: 'PUT', body: { value: JSON.stringify(list) } })
}

// 準備時間 (10 min per completed session) paid at the minimum wage valid on
// each day → [{ mins, wage, pay }], one row per wage
export function prepTimeRows(sessionDates, history) {
  const groups = []
  for (const d of [...sessionDates].sort()) {
    const wage = minWageForDate(history, d)
    const last = groups[groups.length - 1]
    if (last && last.wage === wage) last.mins += 10
    else groups.push({ wage, mins: 10 })
  }
  return groups.filter(g => g.wage > 0).map(g => ({ ...g, pay: Math.round(g.mins / 60 * g.wage) }))
}

// Rate changes for one minimum-wage change. Only linked items whose rate on
// `from` is below the new wage are raised; higher individual rates are left alone.
// → [{ userId, name, item, oldNormal, oldSunday, newNormal, newSunday }]
export function planMinWageChange(users, items, newWage, from) {
  const out = []
  for (const u of users) {
    if (u.employeeType === 'salaried') continue
    for (const item of items) {
      if (!(u.workItems || []).includes(item)) continue
      const cur = getRatesForDate(u.itemRates?.[item], from)
      if (cur.normal >= newWage) continue
      const newSunday = cur.sunday && cur.normal ? Math.round(newWage * cur.sunday / cur.normal) : 0
      out.push({ userId: u.id, name: u.name, item, oldNormal: cur.normal, oldSunday: cur.sunday, newNormal: newWage, newSunday })
    }
  }
  return out
}

// Adds a dated entry to the item's rate history (same shape the user edit
// screen writes), so pay before `from` keeps the old rate.
export function withRateFrom(itemRates, item, from, normal, sunday) {
  const r = itemRates?.[item] || {}
  let hist = Array.isArray(r.rateHistory) && r.rateHistory.length > 0
    ? [...r.rateHistory]
    : (r.normal != null ? [{ from: null, normal: Number(r.normal), ...(r.sunday ? { sunday: Number(r.sunday) } : {}) }] : [])
  hist = hist.filter(e => e.from !== from)
  hist.push({ from, normal, ...(sunday ? { sunday } : {}) })
  hist.sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1; return a.from.localeCompare(b.from) })
  const latest = hist[hist.length - 1]
  return { ...itemRates, [item]: { ...r, normal: Number(latest.normal) || 0, sunday: Number(latest.sunday) || 0, rateHistory: hist } }
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

const p2 = n => String(n).padStart(2, '0')
function dateOf(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
function getTodayDate() {
  return dateOf(new Date())
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

// ─── Work items (業務の管理) ──────────────────────────────────────────────────
// Records store a work item by its id. The items that existed before this
// screen keep their name as id, so no stored data ever needs rewriting; a
// rename only changes the display name. Deleted items stay in the list
// (deleted: true) so past records, rates and the 出勤簿 keep working.
//  { id, name, group?, variant?, deleted? }  — list order = display order

// Calculation items (pay logic depends on them); not managed on the screen
export const SYSTEM_ITEMS = new Set(['休憩', '準備', '交通費', '有給', '固定手当'])

export const DEFAULT_WORK_ITEM_DEFS = [
  { id: 'アスレ', name: 'アスレ' },
  { id: 'スイム', name: 'スイム', group: 'スイム', variant: '通常' },
  { id: 'スイム短期', name: 'スイム短期', group: 'スイム', variant: '短期' },
  { id: 'スイム成人', name: 'スイム成人', group: 'スイム', variant: '成人' },
  { id: 'スイムベビー', name: 'スイムベビー', group: 'スイム', variant: 'ベビー' },
  { id: 'フロント', name: 'フロント', group: 'フロント', variant: '通常' },
  { id: 'フロント短期', name: 'フロント短期', group: 'フロント', variant: '短期' },
  { id: '監視', name: '監視', group: '監視', variant: '通常' },
  { id: '監視短期', name: '監視短期', group: '監視', variant: '短期' },
  { id: '研修会', name: '研修会' },
  { id: '清掃', name: '清掃' },
  { id: '事務処理', name: '事務処理' },
  { id: 'エアロ', name: 'エアロ' },
  { id: 'ドライバー', name: 'ドライバー' },
  { id: '選手引率', name: '選手引率' },
]

const WORK_ITEM_DEFS_KEY = 'workItemDefs'
let workItemDefs = (() => {
  const cached = readJSON(WORK_ITEM_DEFS_KEY, null)
  return Array.isArray(cached) && cached.length > 0 ? cached : DEFAULT_WORK_ITEM_DEFS
})()

function setWorkItemDefsCache(list) {
  workItemDefs = Array.isArray(list) && list.length > 0 ? list : DEFAULT_WORK_ITEM_DEFS
  writeJSON(WORK_ITEM_DEFS_KEY, workItemDefs)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('work-items-change'))
}

// Fetches the latest list (kept on the device for offline use)
export async function loadWorkItemDefs() {
  // not registered / not logged in yet: keep the saved copy
  if (!getToken(DEVICE_TOKEN_KEY) && !getToken(ADMIN_TOKEN_KEY)) return workItemDefs
  try {
    const r = await api('/work_item_defs')
    setWorkItemDefsCache(r?.items)
  } catch {}
  return workItemDefs
}

export async function saveWorkItemDefs(list) {
  await api('/config/workItemDefs', { method: 'PUT', body: { value: JSON.stringify(list) } })
  setWorkItemDefsCache(list)
}

// All items incl. deleted ones, in display order
export function getWorkItemDefs() {
  return workItemDefs
}

export function activeWorkItemDefs() {
  return workItemDefs.filter(d => !d.deleted)
}

export function workItemDef(id) {
  return workItemDefs.find(d => d.id === id) || null
}

export function isDeletedWorkItem(id) {
  return !!workItemDef(id)?.deleted
}

// Display name for a stored id (unknown / legacy ids are shown as they are)
export function itemLabel(id) {
  return workItemDef(id)?.name || id
}

// Sorts ids by the order set on the 業務の管理 screen; unknown ids keep
// their relative order after the known ones.
export function sortByItemOrder(ids) {
  const pos = new Map(workItemDefs.map((d, i) => [d.id, i]))
  return ids
    .map((id, i) => [id, pos.has(id) ? pos.get(id) : workItemDefs.length + i])
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id)
}

export function newWorkItemId() {
  return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export async function initDB() {
  await loadWorkItemDefs()
}

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

export async function saveLog({ userId, workType, workItems, logType, transportCount, firstWork, lastWork, sessionId: providedSessionId, date: shiftDateStr }) {
  const now = new Date()
  // after midnight, punches that continue yesterday's shift are filed under that shift's date
  const date = shiftDateStr || dateOf(now)
  const time = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
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
  // clientTs: when the employee entered it, so an older queued entry can't overwrite a later admin fix
  enqueue({ qid: crypto.randomUUID(), key, path: '/session_work_reports', method: 'PUT', body: { userId, date: dateStr, sessionId, items, clientTs: new Date().toISOString() } })
  await flushOutbox()
}

export async function getSessionWorkReportsForDate(userId, dateStr) {
  return api('/session_work_reports', { query: { userId, date: dateStr } })
}

// 従業員カレンダー用: 従業員の全session_work_reportsとwork_reports
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
  return (await getTodayPunchState(userId)).state !== 'off'
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

// create: true refuses (409 user_exists) when the ID is already taken instead of overwriting that person
export async function upsertUser(user, { create = false } = {}) {
  await api(`/users/${enc(user.id)}`, { method: 'PUT', query: create ? { new: '1' } : undefined, body: user })
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
    const dates = [today, ...(new Date().getHours() < OVERNIGHT_UNTIL_HOUR ? [shiftDate(today, -1)] : [])]
    Object.values(cache).forEach(c => {
      if (!dates.includes(c.date)) return
      const ins = c.logs.filter(l => l.log_type === '出勤').length
      const outs = c.logs.filter(l => l.log_type === '退勤').length
      statuses[c.userId] = statuses[c.userId] || ins > outs
    })
  }
  // punches still waiting in the outbox aren't known to the server yet
  const pendingIds = new Set(readJSON(OUTBOX_KEY, []).map(x => x.qid))
  readJSON(LOCAL_PUNCHES_KEY, [])
    .filter(l => pendingIds.has(l.id))
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

// Rate periods of one item inside [monthStart, monthEnd] → [{ fromDate, toDate, normal, sunday }]
// Each period carries the rates written in that history entry (no borrowing from the latest one).
export function ratePeriods(rateObj, monthStart, monthEnd) {
  const prevDay = d => shiftDate(d, -1)
  const cur = { normal: Number(rateObj?.normal) || 0, sunday: Number(rateObj?.sunday) || 0 }
  const history = rateObj?.rateHistory
  if (!history || history.length === 0) return [{ fromDate: monthStart, toDate: monthEnd, ...cur }]
  const byFrom = (a, b) => (!a.from && !b.from ? 0 : !a.from ? -1 : !b.from ? 1 : a.from.localeCompare(b.from))
  const sorted = [...history].filter(e => !e.from || e.from <= monthEnd).sort(byFrom)
  if (sorted.length === 0) return [{ fromDate: monthStart, toDate: monthEnd, ...cur }]
  const baseCandidates = sorted.filter(e => !e.from || e.from <= monthStart)
  const base = baseCandidates.length > 0 ? baseCandidates[baseCandidates.length - 1] : sorted[0]
  const periods = []
  let curFrom = monthStart, curNormal = Number(base?.normal) || 0, curSunday = Number(base?.sunday) || 0
  for (const e of sorted.filter(e => e.from && e.from > monthStart)) {
    const prev = prevDay(e.from)
    if (prev >= curFrom) periods.push({ fromDate: curFrom, toDate: prev, normal: curNormal, sunday: curSunday })
    curFrom = e.from; curNormal = Number(e.normal) || 0; curSunday = Number(e.sunday) || 0
  }
  periods.push({ fromDate: curFrom, toDate: monthEnd, normal: curNormal, sunday: curSunday })
  return periods
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
// `date` is the day the current shift started on. Between 0:00 and 3:00 a shift
// that began yesterday and has no 退勤 yet is still the current one.
export async function getTodayPunchState(userId) {
  const today = getTodayDate()
  let date = today
  let logs = await getTodayUserLogs(userId, today)
  let ins = logs.filter(l => l.log_type === '出勤')
  let outs = logs.filter(l => l.log_type === '退勤').length
  if (ins.length <= outs && new Date().getHours() < OVERNIGHT_UNTIL_HOUR) {
    const y = shiftDate(today, -1)
    const yLogs = await getTodayUserLogs(userId, y)
    const yIns = yLogs.filter(l => l.log_type === '出勤')
    if (yIns.length > yLogs.filter(l => l.log_type === '退勤').length) {
      date = y; logs = yLogs; ins = yIns; outs = yLogs.filter(l => l.log_type === '退勤').length
    }
  }
  if (ins.length <= outs) return { state: 'off', logs, date }
  const clockIn = ins[ins.length - 1]
  const sessionId = clockIn.session_id || null
  const breaks = sessionId ? pairBreaks(logs.filter(l => l.session_id === sessionId)) : []
  const openBreak = breaks.find(b => b.startLog && !b.endLog) || null
  return { state: openBreak ? 'break' : 'working', logs, date, clockIn, sessionId, breaks, openBreak }
}

// ─── Weekly copy (週コピー) ──────────────────────────────────────────────────
// At the first clock-out of a week the employee is asked whether to reuse last
// week's work. Accepted copies only pre-fill the clock-out input (per day and
// per session order); pay is still calculated from what is actually reported.

// { offer, weekStart, days: [{ date, slots: [{ slot, items }] }] } or null (offline etc.)
export async function getWeeklyCopyOffer(userId, date = getTodayDate()) {
  try { return await api('/weekly_copy/offer', { query: { userId, date } }) } catch { return null }
}

export async function answerWeeklyCopy(userId, answer, date = getTodayDate()) {
  return api('/weekly_copy/answer', { method: 'POST', body: { userId, date, answer } })
}

// { date: { slot: items } }
export async function getWeeklyCopies(userId, dateFrom, dateTo) {
  return api('/weekly_copies', { query: { userId, dateFrom, dateTo } })
}

// items prepared for this day's n-th session, or null (none / offline)
export async function getWeeklyCopyForSlot(userId, date, slot) {
  try {
    const r = await api('/weekly_copies', { query: { userId, date } })
    const items = r[date]?.[slot]
    return items && Object.keys(items).length > 0 ? items : null
  } catch { return null }
}

export async function deleteWeeklyCopy(userId, date) {
  await api('/weekly_copies', { method: 'DELETE', query: { userId, date } })
}

// ─── Commute / transport (通勤・交通費) ────────────────────────────────────────

export const COMMUTE_METHODS = [
  { key: 'car', label: '車' },
  { key: 'bus', label: 'バス' },
  { key: 'train', label: '電車' },
  { key: 'none', label: '交通費なし' },
]

// Commute settings valid on a date. Changes are kept in commuteHistory with a
// start date, so editing someone's commute never changes earlier months.
// Without a history the current fields apply to every date; users saved before
// commute methods existed have no commuteMethod and keep the old behaviour
// (daily amount × days).
//  oneWayKm: car distance one way (×2 for the day)
//  legacyKm: car distance saved by an earlier version as "per day"
export function commuteOn(user, dateStr) {
  const hist = Array.isArray(user?.commuteHistory) ? user.commuteHistory : []
  const sorted = [...hist].sort((a, b) => (a.from || '').localeCompare(b.from || ''))
  let e = null
  for (const h of sorted) if (!h.from || !dateStr || h.from <= dateStr) e = h
  if (!e) {
    e = {
      method: user?.commuteMethod || null,
      oneWayKm: Number(user?.commuteOneWayKm) || 0,
      amount: Number(user?.itemRates?.['交通費']?.amount) || 0,
      legacyKm: Number(user?.commuteDistanceKm) || 0,
    }
  }
  const oneWayKm = Number(e.oneWayKm) || 0
  const legacyKm = Number(e.legacyKm) || 0
  // 徒歩 (older data) is the same as 交通費なし
  return { method: e.method === 'walk' ? 'none' : (e.method || null), oneWayKm, legacyKm, amount: Number(e.amount) || 0, dailyKm: oneWayKm > 0 ? oneWayKm * 2 : legacyKm }
}

// Current settings + whether the clock-out screen asks "本日の交通費".
// Must match asksTransport() in the API.
export function getCommute(user) {
  const c = commuteOn(user, getTodayDate())
  const label = COMMUTE_METHODS.find(m => m.key === c.method)?.label || '未設定'
  let asks
  if (user?.employeeType === 'salaried') asks = false
  else if (c.method === 'none') asks = false
  else if (c.method === 'car') asks = c.dailyKm > 0
  else asks = c.amount > 0
  return { ...c, label, distance: c.dailyKm, asks }
}

export async function getCarRates() {
  const cfg = await api('/config')
  let list = []
  try { list = JSON.parse(cfg.carRates || '[]') } catch {}
  return Array.isArray(list) ? list : []
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

// Transport pay rows for the given eligible days, using the commute settings
// and the car unit price valid on each day.
export function computeTransport(user, eligibleDates, carRates = []) {
  const groups = []
  for (const d of [...eligibleDates].sort()) {
    const c = commuteOn(user, d)
    let g
    if (c.method === 'none') continue
    if (c.method === 'car') {
      if (!c.dailyKm) continue
      const rate = carRateForDate(carRates, d)
      g = { key: `car|${c.oneWayKm}|${c.legacyKm}|${rate}`, car: true, c, rate, daily: c.dailyKm * rate }
    } else {
      if (!c.amount) continue
      g = { key: `amt|${c.amount}`, car: false, c, rate: c.amount, daily: c.amount }
    }
    const found = groups.find(x => x.key === g.key)
    if (found) found.days++
    else groups.push({ ...g, days: 1 })
  }
  const amountGroups = groups.filter(g => !g.car).length
  return groups.map(g => {
    if (g.car) {
      const dist = g.c.oneWayKm > 0 ? `片道${g.c.oneWayKm}km×2` : `${g.c.legacyKm}km`
      return {
        label: `交通費（車 ${dist} × ${g.rate}円）`,
        excelLabel: `交通費（車 ${dist}×${g.rate}円/km・${g.days}日）`,
        days: g.days, rate: Math.round(g.daily * 100) / 100, pay: Math.round(g.days * g.daily),
      }
    }
    return {
      label: amountGroups > 1 ? `交通費（${g.rate}円）` : '交通費',
      excelLabel: amountGroups > 1 ? `交通費（${g.rate}円・${g.days}日）` : `交通費（${g.days}日）`,
      days: g.days, rate: g.rate, pay: Math.round(g.days * g.rate),
    }
  })
}

export async function getTransportDays(dateFrom, dateTo) {
  return api('/transport_days', { query: { dateFrom, dateTo } })
}

// The employee's choice already saved for the day (true/false), or null. A choice still
// waiting in the outbox, or remembered on this device while offline, counts too.
const TRANSPORT_LOCAL_KEY = 'transportChoices'
export async function getTransportDay(userId, date) {
  const key = `${userId}_${date}`
  const pending = readJSON(OUTBOX_KEY, []).find(x => x.key === `td:${key}`)
  if (pending) return !!pending.body.eligible
  try {
    const r = await api('/transport_days', { query: { userId, date } })
    return r[key] === undefined ? null : r[key]
  } catch {
    const v = readJSON(TRANSPORT_LOCAL_KEY, {})[key]
    return v === undefined ? null : v
  }
}

export async function saveTransportDay(userId, date, eligible) {
  const m = readJSON(TRANSPORT_LOCAL_KEY, {})
  m[`${userId}_${date}`] = eligible
  const keys = Object.keys(m)
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => delete m[k])
  writeJSON(TRANSPORT_LOCAL_KEY, m)
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
  // straight from the server: the offline copy of the roster has no rates (pay would be 0)
  const users = await api('/users')
  await loadWorkItemDefs() // latest names / order for the columns

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

  // Rate periods covering the month
  function getMonthRatePeriods(rateObj, y, m) {
    const pad2 = n => String(n).padStart(2, '0')
    const lastD = new Date(y, m, 0).getDate()
    return ratePeriods(rateObj, `${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(lastD)}`)
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
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center"/></xf>',
    // 25 multi-session text cell: bordered, center, wrapText
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('')

  const minWageHistory = await getMinWageHistory()

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
    Object.keys(allWorkReports).some(k => k.slice(0, -11) === u.id)
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
      if (key.slice(0, -11) === user.id) {
        const dateStr = key.slice(-10)
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
    // every item that was reported this month, even if it was taken off the employee since
    const workTypes = sortByItemOrder([...workReportTypeSet])
    const periodsOf = {}
    workTypes.forEach(t => { periodsOf[t] = getMonthRatePeriods(itemRates[t], ym_y, ym_m) })

    // workingDays = days with work report AND ≥1 completed QR session (spec 7)
    let workingDays = 0
    const workingDates = []
    const prepSessionDates = [] // one entry per completed session (準備時間 10 min each)
    Object.entries(userWorkReports).forEach(([dateStr, items]) => {
      if (!Object.values(items).some(m => m > 0)) return
      const entry = byDate[dateStr]
      const completedSess = entry ? entry.sessions.filter(s => s.inLog && s.outLog) : []
      if (completedSess.length > 0) {
        workingDays++
        workingDates.push(dateStr)
        completedSess.forEach(() => prepSessionDates.push(dateStr))
      }
    })
    // 交通費対象日 = 勤務日のうち、本人が「支給なし」にしていない日
    const transportDates = workingDates.filter(d => transportFlags[`${user.id}_${d}`] !== false)
    const commute = getCommute(user)
    const transportRowsX = computeTransport(user, transportDates, carRates)

    // Table 2 type columns: A=日付, B=曜日, C onwards per type, then 時間計
    let ci = 2
    const typeColMap = {}
    for (const type of workTypes) {
      const hasSunday = periodsOf[type].some(p => p.sunday > 0)
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
        ...(commute.asks || transportRowsX.length > 0 ? [['D', `交通費対象：${transportDates.length}日`]] : []),
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
          hdrCell(wd, T2_HDR, itemLabel(type)),
          `<c r="${su}${T2_HDR}" s="${S.hdr}" t="inlineStr"><is><t xml:space="preserve">${esc(itemLabel(type))}&#10;（日曜）</t></is></c>`
        )
      } else {
        t2HdrCells.push(hdrCell(wd, T2_HDR, itemLabel(type)))
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
      const periods = periodsOf[type]
      const hasSunday = periods.some(p => p.sunday > 0)
      const multiPeriod = periods.length > 1
      if (!summaryData.types[type]) summaryData.types[type] = { mins: 0, pay: 0 }
      const sum = summaryData.types[type]

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
            sum.mins += mins.wd; sum.pay += pay
            totalPayHours += mins.wd / 60; totalPayAmount += pay
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(itemLabel(type) + rangeLabel)}</t></is></c>` +
              `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${mins.wd / 60 / 24}</v></c>` +
              (normalRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${normalRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
              `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${pay}</v></c>` +
              `</row>`
            ); payRowIdx++
          }
          if (mins.we > 0) {
            // a period without a Sunday rate pays Sundays at the normal rate
            const sunRate = sundayRate > 0 ? sundayRate : normalRate
            const pay = Math.round(mins.we / 60 * sunRate)
            sum.mins += mins.we; sum.pay += pay
            totalPayHours += mins.we / 60; totalPayAmount += pay
            const suLabel = itemLabel(type) + rangeLabel + '（日曜）'
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(suLabel)}</t></is></c>` +
              `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${mins.we / 60 / 24}</v></c>` +
              (sunRate > 0 ? `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${sunRate}</v></c>` : `<c r="C${payRowIdx}" s="${S.pay_rate}"/>`) +
              `<c r="D${payRowIdx}" s="${S.pay.wd}"><v>${pay}</v></c>` +
              `</row>`
            ); payRowIdx++
          }
        } else {
          const total = mins.wd + mins.we
          if (total > 0) {
            const pay = Math.round(total / 60 * normalRate)
            sum.mins += total; sum.pay += pay
            totalPayHours += total / 60; totalPayAmount += pay
            payRows.push(
              `<row r="${payRowIdx}">` +
              `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${esc(itemLabel(type) + rangeLabel)}</t></is></c>` +
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
    for (const t of transportRowsX) {
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

    // 前後5分（最低賃金）行: 最低賃金はその日に有効な金額で計算
    const prepGroups = prepTimeRows(prepSessionDates, minWageHistory)
    for (const g of prepGroups) {
      const prepHours = g.mins / 60
      totalPayHours += prepHours; totalPayAmount += g.pay
      payRows.push(
        `<row r="${payRowIdx}">` +
        `<c r="A${payRowIdx}" s="${S.pay_lbl}" t="inlineStr"><is><t>${prepGroups.length > 1 ? `準備時間（${g.wage}円）` : '準備時間'}</t></is></c>` +
        `<c r="B${payRowIdx}" s="${S.hours.wd}"><v>${prepHours / 24}</v></c>` +
        `<c r="C${payRowIdx}" s="${S.pay_rate}"><v>${g.wage}</v></c>` +
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
    const sheetDataCached = withCachedValues(sheetData)
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
      `${colsXml}${sheetDataCached}</worksheet>`
    )
  }

  // Build "集計" summary sheet (inserted as sheet1)
  {
    const WB_NS_S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const WB_REL_S = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const shdrCell = (col, rn, text) =>
      `<c r="${col}${rn}" s="${S.hdr}" t="inlineStr"><is><t>${esc(text)}</t></is></c>`
    const summaryTypeEntries = sortByItemOrder(Object.keys(summaryData.types)).map(t => [itemLabel(t), summaryData.types[t]])
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
      `<c r="B${sr}" s="${S.tot_hrs}"><f>SUM(B3:B${sr - 1})</f></c>` +
      `<c r="C${sr}" s="${S.tot_pay}"><f>SUM(C3:C${sr - 1})</f></c>` +
      `</row>`
    const summarySheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${WB_NS_S}" xmlns:r="${WB_REL_S}">` +
      `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="3" width="20" bestFit="1"/></cols>` +
      `${withCachedValues(`<sheetData>${sumRows}</sheetData>`)}</worksheet>`
    sheetXmls.unshift(summarySheetXml)
  }

  // Build XLSX package from scratch (no template needed)
  const WB_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const WB_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
  const N = userEntries.length

  // sheet1 = 集計, sheet2..N+1 = user sheets
  // Excel sheet names: no : \ / ? * [ ], at most 31 characters, unique ignoring case
  const usedNames = new Set(['集計'])
  const sheetName = raw => {
    const base = (String(raw).replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').trim() || 'シート').substring(0, 31)
    let name = base, n = 2
    while (usedNames.has(name.toLowerCase())) { const suffix = `(${n++})`; name = base.substring(0, 31 - suffix.length) + suffix }
    usedNames.add(name.toLowerCase())
    return name
  }
  const sheetEls =
    `<sheet name="集計" sheetId="1" r:id="rId1"/>` +
    userEntries.map((u, i) =>
      `<sheet name="${esc(sheetName(u.name))}" sheetId="${i + 2}" r:id="rId${i + 2}"/>`
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

// Excel の保護ビュー（ダウンロード直後）は数式を再計算しない。数式セルに計算済みの値も書いておき、
// 合計が 0 に見えないようにする。使う数式は SUM(範囲/セル) と ROUND(Bn*24*Cn,0) だけ。
// 数式は上から順に並んでいて、参照先は必ず手前の行にある。
function withCachedValues(sheetData) {
  const colNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  const vals = new Map()
  const val = ref => vals.get(ref) || 0
  const sumArgs = args => args.split(',').reduce((total, part) => {
    const m = part.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/)
    if (!m) return total
    const [, c1, r1, c2 = m[1], r2 = m[2]] = m
    for (let c = colNum(c1); c <= colNum(c2); c++) {
      const col = [...Array(26)].map((_, i) => String.fromCharCode(65 + i))[c - 1]
      for (let r = Number(r1); r <= Number(r2); r++) total += val(col + r)
    }
    return total
  }, 0)
  return sheetData.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/g, (whole, ref, attrs, inner) => {
    if (inner === undefined) return whole
    const f = inner.match(/<f>(.*?)<\/f>/)
    if (!f) {
      const v = inner.match(/<v>(.*?)<\/v>/)
      if (v && !/t="/.test(attrs)) vals.set(ref, Number(v[1]) || 0)
      return whole
    }
    let result = 0
    const sum = f[1].match(/^SUM\((.*)\)$/)
    const round = f[1].match(/^ROUND\(([A-Z]+\d+)\*24\*([A-Z]+\d+),0\)$/)
    if (sum) result = sumArgs(sum[1])
    else if (round) result = Math.round(val(round[1]) * 24 * val(round[2]))
    else return whole
    vals.set(ref, result)
    return `<c r="${ref}"${attrs}><f>${f[1]}</f><v>${result}</v></c>`
  })
}
