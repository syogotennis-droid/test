// Cloudflare Pages Function — handles all /api/* requests
// D1 binding: DB (configure in Cloudflare Pages dashboard or wrangler.toml)

export async function onRequest(context) {
  const { request, env, params } = context
  const DB = env.DB
  const url = new URL(request.url)
  const route = (params.route || []).join('/')
  const method = request.method
  const sp = url.searchParams

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Device-Token',
  }

  if (method === 'OPTIONS') return new Response(null, { headers: cors })

  function ok(data) {
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  function fail(msg, status = 500, extra = {}) {
    return new Response(JSON.stringify({ error: msg, ...extra }), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    if (route === 'auth/login' && method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'local'
      const now = Date.now()
      const att = await DB.prepare('SELECT fails, locked_until FROM login_attempts WHERE ip = ?').bind(ip).first()
      if (att && att.locked_until > now) {
        return fail('locked', 429, { retryAfterSec: Math.ceil((att.locked_until - now) / 1000) })
      }
      const { pin, device } = await request.json()
      const cfg = await DB.prepare("SELECT value FROM config WHERE key = 'adminPin'").first()
      const adminPin = cfg?.value || env.ADMIN_PIN
      if (!adminPin) return fail('admin_pin_not_configured', 503)
      if (String(pin) !== String(adminPin)) {
        const fails = (att && att.locked_until === 0 ? att.fails : 0) + 1
        if (fails >= MAX_LOGIN_FAILS) {
          await DB.prepare('INSERT OR REPLACE INTO login_attempts (ip, fails, locked_until) VALUES (?, 0, ?)').bind(ip, now + LOCK_MS).run()
          return fail('locked', 429, { retryAfterSec: LOCK_MS / 1000 })
        }
        await DB.prepare('INSERT OR REPLACE INTO login_attempts (ip, fails, locked_until) VALUES (?, ?, 0)').bind(ip, fails).run()
        return fail('wrong_pin', 403, { remaining: MAX_LOGIN_FAILS - fails })
      }
      const role = device ? 'device' : 'admin'
      const token = newToken()
      await DB.batch([
        DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
        DB.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now),
        DB.prepare('INSERT INTO sessions (token, role, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(token, role, now, role === 'admin' ? now + ADMIN_SESSION_MS : null),
      ])
      return ok({ token, role })
    }
    if (route === 'auth/logout' && method === 'POST') {
      const t = request.headers.get('X-Admin-Token')
      if (t) await DB.prepare("DELETE FROM sessions WHERE token = ? AND role = 'admin'").bind(t).run()
      return ok({ ok: true })
    }

    const role = await resolveRole(DB, request)
    const deviceOk = isDeviceRoute(route, method, sp)
    if (role !== 'admin' && !(role === 'device' && deviceOk)) {
      return fail('unauthorized', 401, { need: deviceOk ? 'device' : 'admin' })
    }
    const pubUser = u => (role === 'admin' ? parseUser(u) : publicUser(parseUser(u)))

    // ── Config ────────────────────────────────────────────────────────────
    if (route === 'config' && method === 'GET') {
      const { results } = await DB.prepare('SELECT key, value FROM config').all()
      const cfg = {}
      results.forEach(r => { if (r.key !== 'adminPin') cfg[r.key] = r.value })
      return ok(cfg)
    }
    if (route.startsWith('config/') && method === 'PUT') {
      const key = route.slice(7)
      const body = await request.json()
      await DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(body.value)).run()
      return ok({ ok: true })
    }

    // ── Users ─────────────────────────────────────────────────────────────
    if (route === 'users' && method === 'GET') {
      const pin = sp.get('pin')
      if (pin) {
        const u = await DB.prepare('SELECT * FROM users WHERE pin = ?').bind(pin).first()
        return ok(u ? pubUser(u) : null)
      }
      const { results } = await DB.prepare('SELECT * FROM users').all()
      return ok(results.map(pubUser))
    }
    if (route.startsWith('users/') && method === 'GET') {
      const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(route.slice(6)).first()
      return ok(u ? pubUser(u) : null)
    }
    if (route.startsWith('users/') && method === 'PUT') {
      // merge semantics, same as Firestore setDoc(..., { merge: true })
      const id = route.slice(6)
      const { id: _ignored, ...b } = await request.json()
      const cur = await DB.prepare('SELECT data FROM users WHERE id = ?').bind(id).first()
      const merged = { ...(cur ? JSON.parse(cur.data || '{}') : {}), ...b }
      await DB.prepare('INSERT OR REPLACE INTO users (id, pin, data) VALUES (?, ?, ?)')
        .bind(id, merged.pin || '', JSON.stringify(merged)).run()
      return ok({ ok: true })
    }
    if (route.startsWith('users/') && method === 'DELETE') {
      const id = route.slice(6)
      if (sp.get('docOnly') === 'true') {
        await DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
      } else {
        await DB.batch([
          DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
          DB.prepare('DELETE FROM logs WHERE user_id = ?').bind(id),
        ])
      }
      return ok({ ok: true })
    }

    // ── Logs — special sub-routes first ───────────────────────────────────
    if (route === 'logs/check_in' && method === 'GET') {
      const userId = sp.get('userId')
      const date = sp.get('date') || todayStr()
      const { results } = await DB.prepare(
        "SELECT * FROM logs WHERE user_id = ? AND date = ? AND log_type = '出勤' ORDER BY timestamp ASC"
      ).bind(userId, date).all()
      return ok(results.length ? parseLog(results[results.length - 1]) : null)
    }
    if (route === 'logs/today_statuses' && method === 'GET') {
      const date = sp.get('date') || todayStr()
      const { results } = await DB.prepare(
        'SELECT user_id, log_type FROM logs WHERE date = ?'
      ).bind(date).all()
      const groups = {}
      results.forEach(l => {
        if (!groups[l.user_id]) groups[l.user_id] = { ins: 0, outs: 0 }
        if (l.log_type === '出勤') groups[l.user_id].ins++
        else if (l.log_type === '退勤') groups[l.user_id].outs++
      })
      const map = {}
      Object.entries(groups).forEach(([uid, g]) => { map[uid] = g.ins > g.outs })
      return ok(map)
    }

    // ── Logs — CRUD ────────────────────────────────────────────────────────
    if (route === 'logs' && method === 'GET') {
      const { date, dateFrom, dateTo, userId } = Object.fromEntries(sp)
      const where = [], args = []
      if (dateFrom) { where.push('date >= ?'); args.push(dateFrom) }
      if (dateTo) { where.push('date <= ?'); args.push(dateTo) }
      if (date) { where.push('date = ?'); args.push(date) }
      if (userId) { where.push('user_id = ?'); args.push(userId) }
      const sql = 'SELECT * FROM logs' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY timestamp DESC'
      const { results } = await DB.prepare(sql).bind(...args).all()
      return ok(results.map(parseLog))
    }
    if (route === 'logs' && method === 'POST') {
      const b = await request.json()
      const id = b.id || crypto.randomUUID()
      await DB.prepare(
        'INSERT OR IGNORE INTO logs (id, user_id, log_type, date, time, timestamp, work_type, session_id, synced, first_work, last_work, transport_count, work_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
      ).bind(
        id, b.user_id, b.log_type || '', b.date || '', b.time || '', b.timestamp || '',
        b.work_type || '', b.session_id || null,
        b.first_work || null, b.last_work || null,
        b.transport_count || null,
        b.work_items ? JSON.stringify(b.work_items) : null
      ).run()
      return ok({ id, sessionId: b.session_id })
    }
    if (route.startsWith('logs/') && method === 'PATCH') {
      const id = route.slice(5)
      const b = await request.json()
      const sets = [], args = []
      if ('first_work' in b) { sets.push('first_work = ?'); args.push(b.first_work) }
      if ('last_work' in b) { sets.push('last_work = ?'); args.push(b.last_work) }
      if ('approved_time' in b) { sets.push('approved_time = ?'); args.push(b.approved_time) }
      if ('work_type' in b) { sets.push('work_type = ?'); args.push(b.work_type) }
      if ('work_items' in b) { sets.push('work_items = ?'); args.push(JSON.stringify(b.work_items)) }
      if ('time' in b && !('timestamp' in b)) {
        // compute timestamp from existing log's date
        const log = await DB.prepare('SELECT date FROM logs WHERE id = ?').bind(id).first()
        if (log) {
          sets.push('time = ?', 'timestamp = ?')
          args.push(b.time + ':00', jstIso(log.date, b.time))
        }
      } else {
        if ('time' in b) { sets.push('time = ?'); args.push(b.time) }
        if ('timestamp' in b) { sets.push('timestamp = ?'); args.push(b.timestamp) }
      }
      if (sets.length > 0) {
        args.push(id)
        await DB.prepare(`UPDATE logs SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run()
      }
      return ok({ ok: true })
    }
    if (route.startsWith('logs/') && method === 'DELETE') {
      await DB.prepare('DELETE FROM logs WHERE id = ?').bind(route.slice(5)).run()
      return ok({ ok: true })
    }

    // ── Work Reports ───────────────────────────────────────────────────────
    if (route === 'work_reports/merged' && method === 'GET') {
      const dateFrom = sp.get('dateFrom') || ''
      const dateTo = sp.get('dateTo') || ''
      const [sR, lR] = await Promise.all([
        DB.prepare('SELECT * FROM session_work_reports WHERE date >= ? AND date <= ?').bind(dateFrom, dateTo).all(),
        DB.prepare('SELECT * FROM work_reports WHERE date >= ? AND date <= ?').bind(dateFrom, dateTo).all(),
      ])
      const sessionData = {}, sessionHasValid = new Set()
      sR.results.forEach(d => {
        const key = `${d.user_id}_${d.date}`
        if (!sessionData[key]) sessionData[key] = {}
        const items = JSON.parse(d.items || '{}')
        Object.entries(items).forEach(([t, m]) => {
          if (m > 0) { sessionData[key][t] = (sessionData[key][t] || 0) + m; sessionHasValid.add(key) }
        })
      })
      const legacyData = {}
      lR.results.forEach(d => {
        const items = JSON.parse(d.items || '{}')
        if (Object.values(items).some(m => m > 0)) legacyData[d.id] = items
      })
      const result = {}
      new Set([...Object.keys(sessionData), ...Object.keys(legacyData)]).forEach(k => {
        if (sessionHasValid.has(k)) result[k] = sessionData[k]
        else if (legacyData[k]) result[k] = legacyData[k]
      })
      return ok(result)
    }
    if (route === 'work_reports' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      if (userId && date) {
        const r = await DB.prepare('SELECT items FROM work_reports WHERE user_id = ? AND date = ?').bind(userId, date).first()
        return ok(r ? JSON.parse(r.items || '{}') : {})
      }
      let stmt = 'SELECT * FROM work_reports', args = []
      if (dateFrom && dateTo) { stmt += ' WHERE date >= ? AND date <= ?'; args = [dateFrom, dateTo] }
      const { results } = await DB.prepare(stmt).bind(...args).all()
      const map = {}
      results.forEach(r => { map[r.id] = JSON.parse(r.items || '{}') })
      return ok(map)
    }
    if (route === 'work_reports' && method === 'PUT') {
      const b = await request.json()
      await DB.prepare(
        'INSERT OR REPLACE INTO work_reports (id, user_id, date, items, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(`${b.userId}_${b.date}`, b.userId, b.date, JSON.stringify(b.items || {}), new Date().toISOString()).run()
      return ok({ ok: true })
    }

    // ── Session Work Reports — special sub-routes ──────────────────────────
    if (route === 'session_work_reports/with_sessions' && method === 'GET') {
      const dateFrom = sp.get('dateFrom') || ''
      const dateTo = sp.get('dateTo') || ''
      const { results } = await DB.prepare(
        'SELECT * FROM session_work_reports WHERE date >= ? AND date <= ?'
      ).bind(dateFrom, dateTo).all()
      const map = {}
      results.forEach(d => {
        if (!d.session_id) return
        map[`${d.user_id}_${d.date}_${d.session_id}`] = JSON.parse(d.items || '{}')
      })
      return ok(map)
    }
    if (route === 'session_work_reports/status' && method === 'GET') {
      const { userId, dateFrom, dateTo } = Object.fromEntries(sp)
      const [sR, lR] = await Promise.all([
        DB.prepare('SELECT * FROM session_work_reports WHERE user_id = ?').bind(userId).all(),
        DB.prepare('SELECT * FROM work_reports WHERE user_id = ?').bind(userId).all(),
      ])
      const sessionByDate = {}, sessionItemsByDate = {}
      sR.results.forEach(d => {
        if (d.date < dateFrom || d.date > dateTo) return
        const items = JSON.parse(d.items || '{}')
        if (!Object.values(items).some(m => m > 0)) return
        if (!sessionByDate[d.date]) { sessionByDate[d.date] = []; sessionItemsByDate[d.date] = {} }
        if (d.session_id) sessionByDate[d.date].push(d.session_id)
        Object.entries(items).forEach(([t, v]) => { sessionItemsByDate[d.date][t] = (sessionItemsByDate[d.date][t] || 0) + v })
      })
      const legacyDates = [], legacyItemsByDate = {}
      lR.results.forEach(d => {
        if (d.date < dateFrom || d.date > dateTo) return
        const items = JSON.parse(d.items || '{}')
        if (!Object.values(items).some(m => m > 0)) return
        legacyDates.push(d.date); legacyItemsByDate[d.date] = items
      })
      const conflictDates = []
      legacyDates.forEach(date => {
        if (!sessionByDate[date]) return
        const ses = sessionItemsByDate[date] || {}, leg = legacyItemsByDate[date] || {}
        const sk = Object.keys(ses).sort(), lk = Object.keys(leg).filter(k => leg[k] > 0).sort()
        if (sk.join() !== lk.join() || sk.some(k => ses[k] !== leg[k])) conflictDates.push(date)
      })
      return ok({ sessionByDate, legacyDates, conflictDates })
    }

    // ── Session Work Reports — CRUD ────────────────────────────────────────
    if (route === 'session_work_reports' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      if (userId && date) {
        const { results } = await DB.prepare(
          'SELECT session_id, items FROM session_work_reports WHERE user_id = ? AND date = ?'
        ).bind(userId, date).all()
        const map = {}
        results.forEach(r => { map[r.session_id] = JSON.parse(r.items || '{}') })
        return ok(map)
      }
      if (userId) {
        const [sR, lR] = await Promise.all([
          DB.prepare('SELECT * FROM session_work_reports WHERE user_id = ?').bind(userId).all(),
          DB.prepare('SELECT * FROM work_reports WHERE user_id = ?').bind(userId).all(),
        ])
        const bySession = {}, sessionsByDate = {}
        sR.results.forEach(d => {
          if (!d.session_id) return
          const items = JSON.parse(d.items || '{}')
          bySession[d.session_id] = items
          if (Object.values(items).some(m => m > 0)) {
            if (!sessionsByDate[d.date]) sessionsByDate[d.date] = []
            sessionsByDate[d.date].push(d.session_id)
          }
        })
        const legacyWorkedDates = []
        lR.results.forEach(d => {
          const items = JSON.parse(d.items || '{}')
          if (Object.values(items).some(m => m > 0)) legacyWorkedDates.push(d.date)
        })
        return ok({ bySession, sessionsByDate, legacyWorkedDates })
      }
      if (dateFrom && dateTo) {
        const { results } = await DB.prepare(
          'SELECT * FROM session_work_reports WHERE date >= ? AND date <= ?'
        ).bind(dateFrom, dateTo).all()
        const map = {}
        results.forEach(d => {
          const key = `${d.user_id}_${d.date}`
          if (!map[key]) map[key] = {}
          const items = JSON.parse(d.items || '{}')
          Object.entries(items).forEach(([t, m]) => { map[key][t] = (map[key][t] || 0) + (m || 0) })
        })
        return ok(map)
      }
      return ok({})
    }
    if (route === 'session_work_reports' && method === 'PUT') {
      const b = await request.json()
      const id = `${b.userId}_${b.date}_${b.sessionId}`
      const filtered = Object.fromEntries(Object.entries(b.items || {}).filter(([, m]) => m > 0))
      if (Object.keys(filtered).length > 0) {
        await DB.prepare(
          'INSERT OR REPLACE INTO session_work_reports (id, user_id, date, session_id, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, b.userId, b.date, b.sessionId, JSON.stringify(filtered), new Date().toISOString()).run()
      } else {
        await DB.prepare('DELETE FROM session_work_reports WHERE id = ?').bind(id).run()
      }
      return ok({ ok: true })
    }
    if (route === 'session_work_reports' && method === 'DELETE') {
      const { userId, date, sessionId } = Object.fromEntries(sp)
      if (sessionId) {
        await DB.prepare('DELETE FROM session_work_reports WHERE id = ?').bind(`${userId}_${date}_${sessionId}`).run()
      } else {
        await DB.prepare('DELETE FROM session_work_reports WHERE user_id = ? AND date = ?').bind(userId, date).run()
      }
      return ok({ ok: true })
    }

    // ── Overtime Apps ──────────────────────────────────────────────────────
    if (route === 'overtime_apps' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      if (userId && date) {
        const r = await DB.prepare('SELECT minutes FROM overtime_apps WHERE id = ?').bind(`${userId}_${date}`).first()
        return ok({ minutes: r?.minutes || 0 })
      }
      let stmt = 'SELECT user_id AS userId, date, minutes FROM overtime_apps', args = []
      if (dateFrom && dateTo) { stmt += ' WHERE date >= ? AND date <= ?'; args = [dateFrom, dateTo] }
      const { results } = await DB.prepare(stmt).bind(...args).all()
      return ok(results)
    }
    if (route === 'overtime_apps' && method === 'PUT') {
      const b = await request.json()
      const id = `${b.userId}_${b.date}`
      if (!b.minutes || b.minutes <= 0) {
        await DB.prepare('DELETE FROM overtime_apps WHERE id = ?').bind(id).run()
      } else {
        await DB.prepare('INSERT OR REPLACE INTO overtime_apps (id, user_id, date, minutes) VALUES (?, ?, ?, ?)').bind(id, b.userId, b.date, b.minutes).run()
      }
      return ok({ ok: true })
    }

    // ── Salaried Days ──────────────────────────────────────────────────────
    if (route === 'salaried_days' && method === 'GET') {
      const dateFrom = sp.get('dateFrom') || ''
      const dateTo = sp.get('dateTo') || '9999-99-99'
      const { results } = await DB.prepare(
        'SELECT * FROM salaried_days WHERE date >= ? AND date <= ?'
      ).bind(dateFrom, dateTo).all()
      const map = {}
      results.forEach(r => {
        map[`${r.user_id}_${r.date}`] = { userId: r.user_id, date: r.date, breakMins: r.break_mins, overtimeMins: r.overtime_mins }
      })
      return ok(map)
    }
    if (route === 'salaried_days' && method === 'PUT') {
      const b = await request.json()
      await DB.prepare(
        'INSERT OR REPLACE INTO salaried_days (id, user_id, date, break_mins, overtime_mins) VALUES (?, ?, ?, ?, ?)'
      ).bind(`${b.userId}_${b.date}`, b.userId, b.date, b.breakMins ?? 0, b.overtimeMins ?? 0).run()
      return ok({ ok: true })
    }

    // ── Batch Day Edit ─────────────────────────────────────────────────────
    if (route === 'batch/day_edit' && method === 'POST') {
      const { userId, dateStr, logsToDelete, logsToCreate, logsToUpdate, isSalaried, sessionWorkData, deletedSessionIds } = await request.json()
      const now = new Date().toISOString()
      const stmts = []
      for (const log of (logsToDelete || []))
        stmts.push(DB.prepare('DELETE FROM logs WHERE id = ?').bind(log.id))
      for (const { id, time } of (logsToUpdate || []))
        stmts.push(DB.prepare('UPDATE logs SET time = ?, timestamp = ? WHERE id = ?').bind(time + ':00', jstIso(dateStr, time), id))
      for (const { logType, time, sessionId } of (logsToCreate || [])) {
        const logId = crypto.randomUUID()
        stmts.push(DB.prepare(
          "INSERT INTO logs (id, user_id, log_type, date, time, work_type, session_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0)"
        ).bind(logId, userId, logType, dateStr, time + ':00', sessionId, jstIso(dateStr, time)))
      }
      if (!isSalaried) {
        for (const { sessionId, items } of (sessionWorkData || [])) {
          const rid = `${userId}_${dateStr}_${sessionId}`
          if (Object.values(items || {}).some(m => m > 0)) {
            stmts.push(DB.prepare(
              'INSERT OR REPLACE INTO session_work_reports (id, user_id, date, session_id, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(rid, userId, dateStr, sessionId, JSON.stringify(items), now))
          } else {
            stmts.push(DB.prepare('DELETE FROM session_work_reports WHERE id = ?').bind(rid))
          }
        }
        for (const sessionId of (deletedSessionIds || []))
          stmts.push(DB.prepare('DELETE FROM session_work_reports WHERE id = ?').bind(`${userId}_${dateStr}_${sessionId}`))
      }
      if (stmts.length > 0) await DB.batch(stmts)
      return ok({ ok: true })
    }

    return fail('Not found', 404)
  } catch (e) {
    return fail(e?.message || 'Internal server error')
  }
}

const MAX_LOGIN_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

async function resolveRole(DB, request) {
  const adminT = request.headers.get('X-Admin-Token')
  const deviceT = request.headers.get('X-Device-Token')
  const tokens = [adminT, deviceT].filter(Boolean)
  if (tokens.length === 0) return null
  const now = Date.now()
  const { results } = await DB.prepare(
    `SELECT token, role FROM sessions WHERE token IN (${tokens.map(() => '?').join(',')}) AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(...tokens, now).all()
  if (results.some(r => r.role === 'admin' && r.token === adminT)) return 'admin'
  if (results.some(r => r.role === 'device' && r.token === deviceT)) return 'device'
  return null
}

// What a registered punch tablet may do: punch, look up the scanned employee,
// and view/enter that employee's own work time. Everything else needs admin.
function isDeviceRoute(route, method, sp) {
  if (method === 'GET') {
    if (route === 'users' || route.startsWith('users/')) return true
    if (route === 'logs/check_in' || route === 'logs/today_statuses') return true
    if (route === 'logs' || route === 'session_work_reports') return !!sp.get('userId')
    return false
  }
  if (method === 'POST') return route === 'logs'
  if (method === 'PUT') return route === 'session_work_reports' || route === 'work_reports'
  return false
}

function publicUser(u) {
  return { id: u.id, name: u.name, employeeType: u.employeeType, workItems: u.workItems || [] }
}

// Workers run in UTC; the business runs in JST (UTC+9)
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function todayStr() {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

function jstIso(dateStr, time) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, m] = time.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0) - JST_OFFSET_MS).toISOString()
}

function parseUser(u) {
  return { ...JSON.parse(u.data || '{}'), id: u.id }
}

function parseLog(l) {
  return {
    id: l.id,
    user_id: l.user_id,
    log_type: l.log_type,
    date: l.date,
    time: l.time,
    timestamp: l.timestamp,
    work_type: l.work_type || '',
    session_id: l.session_id || '',
    synced: l.synced || 0,
    approved_time: l.approved_time || null,
    first_work: l.first_work || null,
    last_work: l.last_work || null,
    transport_count: l.transport_count || null,
    work_items: l.work_items ? JSON.parse(l.work_items) : null,
  }
}
