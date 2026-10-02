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
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (method === 'OPTIONS') return new Response(null, { headers: cors })

  function ok(data) {
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  function fail(msg, status = 500) {
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // ── Config ────────────────────────────────────────────────────────────
    if (route === 'config' && method === 'GET') {
      const { results } = await DB.prepare('SELECT key, value FROM config').all()
      const cfg = {}
      results.forEach(r => { cfg[r.key] = r.value })
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
        return ok(u ? parseUser(u) : null)
      }
      const { results } = await DB.prepare('SELECT * FROM users').all()
      return ok(results.map(parseUser))
    }
    if (route.startsWith('users/') && method === 'GET') {
      const id = route.slice(6)
      const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
      return ok(u ? parseUser(u) : null)
    }
    if (route.startsWith('users/') && method === 'PUT') {
      const id = route.slice(6)
      const b = await request.json()
      await DB.prepare(
        'INSERT OR REPLACE INTO users (id, name, employee_type, work_items, item_rates, pin, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        id, b.name || '', b.employeeType || 'hourly',
        JSON.stringify(b.workItems || []), JSON.stringify(b.itemRates || {}),
        b.pin || '', b.email || ''
      ).run()
      return ok({ ok: true })
    }
    if (route.startsWith('users/') && method === 'DELETE') {
      const id = route.slice(6)
      const docOnly = sp.get('docOnly') === 'true'
      if (docOnly) {
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
    if (route === 'logs/is_checked_in' && method === 'GET') {
      const userId = sp.get('userId')
      const date = todayStr()
      const { results } = await DB.prepare(
        'SELECT log_type FROM logs WHERE user_id = ? AND date = ?'
      ).bind(userId, date).all()
      const ins = results.filter(l => l.log_type === '出勤').length
      const outs = results.filter(l => l.log_type === '退勤').length
      return ok({ checkedIn: ins > outs })
    }
    if (route === 'logs/today_statuses' && method === 'GET') {
      const date = todayStr()
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
      let stmt, args = []
      if (dateFrom && dateTo) { stmt = 'SELECT * FROM logs WHERE date >= ? AND date <= ?'; args = [dateFrom, dateTo] }
      else if (dateFrom) { stmt = 'SELECT * FROM logs WHERE date >= ?'; args = [dateFrom] }
      else if (dateTo) { stmt = 'SELECT * FROM logs WHERE date <= ?'; args = [dateTo] }
      else { stmt = 'SELECT * FROM logs' }
      const { results } = await DB.prepare(stmt).bind(...args).all()
      let logs = results.map(parseLog)
      if (date) logs = logs.filter(l => l.date === date)
      if (userId) logs = logs.filter(l => l.user_id === userId)
      logs.sort((a, b) => (b.timestamp || '') < (a.timestamp || '') ? -1 : 1)
      return ok(logs)
    }
    if (route === 'logs' && method === 'POST') {
      const b = await request.json()
      const id = b.id || crypto.randomUUID()
      await DB.prepare(
        'INSERT INTO logs (id, user_id, log_type, date, time, timestamp, work_type, session_id, synced, first_work, last_work, transport_count, work_items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
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
          const [y, mo, d] = log.date.split('-').map(Number)
          const [h, m] = b.time.split(':').map(Number)
          const dt = new Date(y, mo - 1, d, h, m, 0)
          sets.push('time = ?', 'timestamp = ?')
          args.push(b.time + ':00', dt.toISOString())
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
      for (const { id, time } of (logsToUpdate || [])) {
        const [y, mo, d] = dateStr.split('-').map(Number)
        const [h, m] = time.split(':').map(Number)
        const dt = new Date(y, mo - 1, d, h, m, 0)
        stmts.push(DB.prepare('UPDATE logs SET time = ?, timestamp = ? WHERE id = ?').bind(time + ':00', dt.toISOString(), id))
      }
      for (const { logType, time, sessionId } of (logsToCreate || [])) {
        const logId = crypto.randomUUID()
        const [y, mo, d] = dateStr.split('-').map(Number)
        const [h, m] = time.split(':').map(Number)
        const dt = new Date(y, mo - 1, d, h, m, 0)
        stmts.push(DB.prepare(
          "INSERT INTO logs (id, user_id, log_type, date, time, work_type, session_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0)"
        ).bind(logId, userId, logType, dateStr, time + ':00', sessionId, dt.toISOString()))
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

    // ── Init (migration helper) ────────────────────────────────────────────
    if (route === 'init' && method === 'POST') {
      return ok({ ok: true })
    }

    return fail('Not found', 404)
  } catch (e) {
    return fail(e?.message || 'Internal server error')
  }
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseUser(u) {
  return {
    id: u.id,
    name: u.name,
    employeeType: u.employee_type || 'hourly',
    workItems: JSON.parse(u.work_items || '[]'),
    itemRates: JSON.parse(u.item_rates || '{}'),
    pin: u.pin || '',
    email: u.email || '',
  }
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
