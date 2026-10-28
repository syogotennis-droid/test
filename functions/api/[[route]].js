// Cloudflare Pages Function — handles all /api/* requests
// D1 binding: DB (configure in Cloudflare Pages dashboard or wrangler.toml)

class HttpError extends Error { constructor(msg, status = 400) { super(msg); this.status = status } }

export async function onRequest(context) {
  const { request, env, params } = context
  const DB = env.DB
  const url = new URL(request.url)
  const route = (params.route || []).join('/')
  const method = request.method
  const sp = url.searchParams

  // Only this site itself and the Android app (Capacitor serves it from localhost) may call the API
  // from a browser. Other sites get no CORS header, so the browser blocks them.
  const origin = request.headers.get('Origin')
  const cors = {
    ...(origin && (origin === url.origin || APP_ORIGINS.has(origin)) ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Device-Token',
    'Access-Control-Expose-Headers': 'X-Server-Time',
  }

  if (method === 'OPTIONS') return new Response(null, { headers: cors })

  async function readBody() {
    try { return await request.json() } catch { throw new HttpError('bad_request', 400) }
  }
  // a real calendar date (no 2026-02-30) / a real time of day (no 24:00, 25:99, :60)
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
  const isTime = v => {
    const m = typeof v === 'string' && v.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
    return !!m && +m[1] < 24 && +m[2] < 60 && (m[3] === undefined || +m[3] < 60)
  }
  // a device (punch tablet) may change work input only for this month and last month (JST)
  const tooOldForDevice = (date, role) => {
    if (role !== 'device') return false
    const [y, mo] = todayStr().split('-').map(Number)
    const from = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10)
    return date < from
  }
  const userExists = async id => !!(await DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first())
  const needStr = (v, what) => { if (typeof v !== 'string' || !v) throw new HttpError('bad_' + what, 400); return v }
  // X-Server-Time: the punch tablet compares it with its own clock and warns when that is off
  function ok(data) {
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Server-Time': String(Date.now()) },
    })
  }
  function fail(msg, status = 500, extra = {}) {
    return new Response(JSON.stringify({ error: msg, ...extra }), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Server-Time': String(Date.now()) },
    })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    if (route === 'auth/login' && method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'local'
      const now = Date.now()
      // Count this attempt first, in one statement, so parallel guesses can't share a count
      const att = await DB.prepare(
        `INSERT INTO login_attempts (ip, fails, locked_until) VALUES (?1, 1, 0)
         ON CONFLICT(ip) DO UPDATE SET
           fails = CASE WHEN login_attempts.locked_until > 0 AND login_attempts.locked_until <= ?2 THEN 1 ELSE login_attempts.fails + 1 END,
           locked_until = CASE WHEN login_attempts.locked_until > 0 AND login_attempts.locked_until <= ?2 THEN 0 ELSE login_attempts.locked_until END
         RETURNING fails, locked_until`
      ).bind(ip, now).first()
      const lockNow = async () => {
        await DB.prepare('INSERT OR REPLACE INTO login_attempts (ip, fails, locked_until) VALUES (?, 0, ?)').bind(ip, now + LOCK_MS).run()
        return fail('locked', 429, { retryAfterSec: LOCK_MS / 1000 })
      }
      if (att.locked_until > now) return fail('locked', 429, { retryAfterSec: Math.ceil((att.locked_until - now) / 1000) })
      if (att.fails > MAX_LOGIN_FAILS) return lockNow()
      const { pin, device, label } = await readBody()
      const check = await checkAdminPin(DB, env, pin)
      if (!check) return fail('admin_pin_not_configured', 503)
      if (!check.ok) {
        if (att.fails >= MAX_LOGIN_FAILS) return lockNow()
        return fail('wrong_pin', 403, { remaining: MAX_LOGIN_FAILS - att.fails })
      }
      const role = device ? 'device' : 'admin'
      const token = newToken()
      const stmts = [
        DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
        DB.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now),
        DB.prepare('INSERT INTO sessions (token, role, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(token, role, now, role === 'admin' ? now + ADMIN_SESSION_MS : null),
      ]
      if (role === 'device') {
        stmts.push(DB.prepare('INSERT OR REPLACE INTO device_info (token, label, last_seen) VALUES (?, ?, ?)')
          .bind(token, typeof label === 'string' ? label.trim().slice(0, 40) : '', now))
      }
      // a PIN still stored as it was typed is replaced by its hash at the first correct login
      if (check.upgrade) stmts.push(...adminPinStmts(DB, await hashPin(String(pin))))
      await DB.batch(stmts)
      // shortPin: a PIN set before 6 digits were required (the admin screen asks to change it)
      return ok({ token, role, shortPin: String(pin).length < 6 })
    }
    if (route === 'auth/logout' && method === 'POST') {
      const t = request.headers.get('X-Admin-Token')
      if (t) await DB.prepare("DELETE FROM sessions WHERE token = ? AND role = 'admin'").bind(t).run()
      return ok({ ok: true })
    }

    const role = await resolveRole(DB, request)
    if (role === 'device') context.waitUntil?.(touchDevice(DB, request.headers.get('X-Device-Token')))
    const deviceOk = isDeviceRoute(route, method, sp)
    if (role !== 'admin' && !(role === 'device' && deviceOk)) {
      return fail('unauthorized', 401, { need: deviceOk ? 'device' : 'admin' })
    }
    const pubUser = u => (role === 'admin' ? parseUser(u) : publicUser(parseUser(u)))

    // ── Admin PIN (stored only as a hash) ─────────────────────────────────
    if (route === 'auth/admin_pin' && method === 'PUT') {
      const { pin, revokeDevices } = await readBody()
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) throw new HttpError('bad_pin', 400)
      const stmts = adminPinStmts(DB, await hashPin(pin))
      // optionally sign out every punch tablet (they must be registered again with the new PIN)
      if (revokeDevices) stmts.push(DB.prepare("DELETE FROM sessions WHERE role = 'device'"), DB.prepare('DELETE FROM device_info'))
      await DB.batch(stmts)
      return ok({ ok: true })
    }

    // ── Registered punch tablets ──────────────────────────────────────────
    // id = the first part of the token's SHA-256 (the token itself never leaves the server)
    if (route === 'devices' && method === 'GET') {
      const { results } = await DB.prepare(
        "SELECT s.token, s.created_at, d.label, d.last_seen FROM sessions s LEFT JOIN device_info d ON d.token = s.token WHERE s.role = 'device' ORDER BY s.created_at"
      ).all()
      const mine = request.headers.get('X-Device-Token')
      return ok(await Promise.all(results.map(async r => ({
        id: await deviceId(r.token), label: r.label || '', createdAt: r.created_at, lastSeen: r.last_seen || null, current: r.token === mine,
      }))))
    }
    if (route.startsWith('devices/') && (method === 'DELETE' || method === 'PUT')) {
      const id = route.slice(8)
      const { results } = await DB.prepare("SELECT token FROM sessions WHERE role = 'device'").all()
      let token = null
      for (const r of results) if (await deviceId(r.token) === id) token = r.token
      if (!token) throw new HttpError('not_found', 404)
      if (method === 'DELETE') {
        await DB.batch([DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token), DB.prepare('DELETE FROM device_info WHERE token = ?').bind(token)])
      } else {
        const { label } = await readBody()
        await DB.prepare('INSERT INTO device_info (token, label) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET label = excluded.label')
          .bind(token, typeof label === 'string' ? label.trim().slice(0, 40) : '').run()
      }
      return ok({ ok: true })
    }

    // ── Config ────────────────────────────────────────────────────────────
    if (route === 'config' && method === 'GET') {
      const { results } = await DB.prepare('SELECT key, value FROM config').all()
      const cfg = {}
      results.forEach(r => { if (!SECRET_CONFIG.has(r.key)) cfg[r.key] = r.value })
      return ok(cfg)
    }
    // 業務の管理 (names / groups / order). null = never saved, the app uses its defaults
    if (route === 'work_item_defs' && method === 'GET') {
      const r = await DB.prepare("SELECT value FROM config WHERE key = 'workItemDefs'").first()
      let items = null
      try { items = r ? JSON.parse(r.value) : null } catch {}
      return ok({ items: Array.isArray(items) ? items : null })
    }
    if (route.startsWith('config/') && method === 'PUT') {
      const key = route.slice(7)
      if (SECRET_CONFIG.has(key)) throw new HttpError('forbidden', 403) // changed only through auth/admin_pin
      const body = await readBody()
      await DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, String(body.value)).run()
      return ok({ ok: true })
    }

    // ── Users ─────────────────────────────────────────────────────────────
    // PIN lookup: the PIN goes in the request body, never in the URL (URLs end up in logs and history)
    if (route === 'users/by_pin' && method === 'POST') {
      const { pin } = await readBody()
      if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return ok(null)
      const u = await DB.prepare('SELECT * FROM users WHERE pin = ?').bind(pin).first()
      return ok(u ? pubUser(u) : null)
    }
    if (route === 'users' && method === 'GET') {
      // ID order, same as the Firebase version (saving a user must not move it)
      const { results } = await DB.prepare('SELECT * FROM users ORDER BY id').all()
      return ok(results.map(pubUser))
    }
    if (route.startsWith('users/') && method === 'GET') {
      const qid = route.slice(6)
      // an employee whose ID was changed keeps working with the old QR card (data.formerIds)
      const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(qid).first() ||
        await DB.prepare("SELECT * FROM users WHERE EXISTS (SELECT 1 FROM json_each(users.data, '$.formerIds') WHERE value = ?)").bind(qid).first()
      return ok(u ? pubUser(u) : null)
    }
    if (route.startsWith('users/') && method === 'PUT') {
      // merge semantics, same as Firestore setDoc(..., { merge: true })
      const id = route.slice(6)
      const { id: _ignored, ...b } = await readBody()
      const cur = await DB.prepare('SELECT data FROM users WHERE id = ?').bind(id).first()
      if (sp.get('new') === '1' && cur) throw new HttpError('user_exists', 409)
      // an old ID of someone else (their old QR card still opens their record) can't be given to a new person
      if (sp.get('new') === '1' && await DB.prepare("SELECT 1 AS x FROM users WHERE EXISTS (SELECT 1 FROM json_each(users.data, '$.formerIds') WHERE value = ?)").bind(id).first()) throw new HttpError('user_exists', 409)
      const merged = { ...(cur ? parseJson(cur.data, {}) : {}), ...b }
      // a PIN calls up exactly one person (checked when the PIN is set, so other changes to someone
      // who already shares a PIN from earlier data still save)
      if ('pin' in b && merged.pin) {
        if (typeof merged.pin !== 'string' || !/^\d{4}$/.test(merged.pin)) throw new HttpError('bad_pin', 400)
        if (await DB.prepare('SELECT 1 AS x FROM users WHERE pin = ? AND id <> ?').bind(merged.pin, id).first()) throw new HttpError('pin_taken', 409)
      }
      await DB.prepare('INSERT OR REPLACE INTO users (id, pin, data) VALUES (?, ?, ?)')
        .bind(id, merged.pin || '', JSON.stringify(merged)).run()
      return ok({ ok: true })
    }
    if (route.startsWith('users/') && method === 'DELETE') {
      const id = route.slice(6)
      if (sp.get('docOnly') === 'true') {
        await DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
      } else {
        // everything that belongs to the user, so a later user with the same ID starts clean
        await DB.batch(['users WHERE id', ...['logs', 'work_reports', 'session_work_reports', 'overtime_apps', 'salaried_days',
          'transport_days', 'transport_day_methods', 'weekly_copies', 'weekly_copy_answers', 'work_plans'].map(t => `${t} WHERE user_id`)]
          .map(t => DB.prepare(`DELETE FROM ${t} = ?`).bind(id)))
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
      // between 0:00 and 3:00 a shift that started yesterday is still running
      const dates = [date]
      if (date === todayStr() && jstHour() < OVERNIGHT_UNTIL_HOUR) dates.push(addDays(date, -1))
      const { results } = await DB.prepare(
        `SELECT user_id, date, log_type FROM logs WHERE date IN (${dates.map(() => '?').join(',')})`
      ).bind(...dates).all()
      const groups = {}
      results.forEach(l => {
        const k = l.user_id + '|' + l.date
        if (!groups[k]) groups[k] = { uid: l.user_id, ins: 0, outs: 0 }
        if (l.log_type === '出勤') groups[k].ins++
        else if (l.log_type === '退勤') groups[k].outs++
      })
      const map = {}
      Object.values(groups).forEach(g => { map[g.uid] = map[g.uid] || g.ins > g.outs })
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
      const b = await readBody()
      if (!LOG_TYPES.has(b.log_type)) return fail('invalid log_type', 400)
      needStr(b.user_id, 'user_id')
      if (!isDate(b.date) || !isTime(b.time) || Number.isNaN(Date.parse(b.timestamp))) throw new HttpError('bad_datetime', 400)
      // the date/time must describe the same moment as the timestamp (JST), give or take 2 minutes
      if (Math.abs(Date.parse(jstIso(b.date, b.time)) - Date.parse(b.timestamp)) > 2 * 60 * 1000) throw new HttpError('bad_datetime', 400)
      if (!(await userExists(b.user_id))) throw new HttpError('unknown_user', 400)
      const id = typeof b.id === 'string' && b.id ? b.id : crypto.randomUUID()
      // a resend of a punch that is already stored is fine (same id)
      if (await DB.prepare('SELECT 1 AS x FROM logs WHERE id = ?').bind(id).first()) return ok({ id, sessionId: b.session_id })
      // no second clock-in while a shift of that day is still open (more clock-ins than clock-outs
      // that day, the same rule the punch tablet uses, so old-format logs without a shift id count too),
      // and no second clock-out of one shift. The check is part of the INSERT itself, so two tablets
      // punching at the same moment can't both get through.
      const cond = b.log_type === '出勤'
        ? "(SELECT COUNT(*) FROM logs WHERE user_id = ? AND date = ? AND log_type = '出勤') <= " +
          "(SELECT COUNT(*) FROM logs WHERE user_id = ? AND date = ? AND log_type = '退勤')"
        : b.log_type === '退勤' && b.session_id
          ? "NOT EXISTS (SELECT 1 FROM logs WHERE user_id = ? AND session_id = ? AND log_type = '退勤') AND " + HAS_CLOCK_IN
          : b.session_id ? HAS_CLOCK_IN : '1'
      // a break / clock-out needs the clock-in of its shift (an offline tablet may have clocked in someone
      // who was already working: that clock-in is refused, and so are the punches that followed it)
      const condArgs = b.log_type === '出勤' ? [b.user_id, b.date, b.user_id, b.date]
        : b.log_type === '退勤' && b.session_id ? [b.user_id, b.session_id, b.user_id, b.session_id]
        : b.session_id ? [b.user_id, b.session_id] : []
      const res = await DB.prepare(
        'INSERT OR IGNORE INTO logs (id, user_id, log_type, date, time, timestamp, work_type, session_id, synced, first_work, last_work, transport_count, work_items) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ? WHERE ' + cond
      ).bind(
        id, b.user_id, b.log_type, b.date, b.time, b.timestamp,
        b.work_type || '', b.session_id || null,
        b.first_work || null, b.last_work || null,
        b.transport_count || null,
        b.work_items ? JSON.stringify(b.work_items) : null,
        ...condArgs
      ).run()
      if (!res.meta?.changes) {
        // the same punch sent twice at once: the other request stored it
        if (await DB.prepare('SELECT 1 AS x FROM logs WHERE id = ?').bind(id).first()) return ok({ id, sessionId: b.session_id })
        if (b.log_type === '出勤') throw new HttpError('already_working', 409)
        if (!(await DB.prepare("SELECT 1 AS x FROM logs WHERE user_id = ? AND session_id = ? AND log_type = '出勤'").bind(b.user_id, b.session_id).first())) throw new HttpError('no_clock_in', 409)
        if (b.log_type === '退勤' && b.session_id) throw new HttpError('already_out', 409)
      }
      return ok({ id, sessionId: b.session_id })
    }
    if (route.startsWith('logs/') && method === 'PATCH') {
      const id = route.slice(5)
      const b = await readBody()
      if ('time' in b && !isTime(b.time)) throw new HttpError('bad_time', 400)
      if ('timestamp' in b && (typeof b.timestamp !== 'string' || Number.isNaN(Date.parse(b.timestamp)))) throw new HttpError('bad_datetime', 400)
      if ('work_items' in b && b.work_items !== null && typeof b.work_items !== 'object') throw new HttpError('bad_work_items', 400)
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
          args.push(b.time.slice(0, 5) + ':00', jstIso(log.date, b.time))
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
        const items = parseJson(d.items, {})
        Object.entries(items).forEach(([t, m]) => {
          if (m > 0) { sessionData[key][t] = (sessionData[key][t] || 0) + m; sessionHasValid.add(key) }
        })
      })
      const legacyData = {}
      lR.results.forEach(d => {
        const items = parseJson(d.items, {})
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
        return ok(r ? parseJson(r.items, {}) : {})
      }
      let stmt = 'SELECT * FROM work_reports', args = []
      if (dateFrom && dateTo) { stmt += ' WHERE date >= ? AND date <= ?'; args = [dateFrom, dateTo] }
      const { results } = await DB.prepare(stmt).bind(...args).all()
      const map = {}
      results.forEach(r => { map[r.id] = parseJson(r.items, {}) })
      return ok(map)
    }
    if (route === 'work_reports' && method === 'PUT') {
      const b = await readBody()
      needStr(b.userId, 'userId')
      if (!isDate(b.date)) throw new HttpError('bad_date', 400)
      if (tooOldForDevice(b.date, role)) throw new HttpError('too_old', 422)
      if (!(await userExists(b.userId))) throw new HttpError('unknown_user', 400)
      const items = cleanItems(b.items)
      // same protection as session_work_reports: an older queued entry must not overwrite a later admin fix
      const at = clientTime(b.clientTs)
      if (at) {
        const cur = await DB.prepare('SELECT updated_at FROM work_reports WHERE id = ?').bind(`${b.userId}_${b.date}`).first()
        if (cur?.updated_at && cur.updated_at > at) return ok({ ok: true, skipped: true })
      }
      await DB.prepare(
        'INSERT OR REPLACE INTO work_reports (id, user_id, date, items, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(`${b.userId}_${b.date}`, b.userId, b.date, JSON.stringify(items), at || new Date().toISOString()).run()
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
        map[`${d.user_id}_${d.date}_${d.session_id}`] = parseJson(d.items, {})
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
        const items = parseJson(d.items, {})
        if (!Object.values(items).some(m => m > 0)) return
        if (!sessionByDate[d.date]) { sessionByDate[d.date] = []; sessionItemsByDate[d.date] = {} }
        if (d.session_id) sessionByDate[d.date].push(d.session_id)
        Object.entries(items).forEach(([t, v]) => { sessionItemsByDate[d.date][t] = (sessionItemsByDate[d.date][t] || 0) + v })
      })
      const legacyDates = [], legacyItemsByDate = {}
      lR.results.forEach(d => {
        if (d.date < dateFrom || d.date > dateTo) return
        const items = parseJson(d.items, {})
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
        results.forEach(r => { map[r.session_id] = parseJson(r.items, {}) })
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
          const items = parseJson(d.items, {})
          bySession[d.session_id] = items
          if (Object.values(items).some(m => m > 0)) {
            if (!sessionsByDate[d.date]) sessionsByDate[d.date] = []
            sessionsByDate[d.date].push(d.session_id)
          }
        })
        const legacyWorkedDates = []
        lR.results.forEach(d => {
          const items = parseJson(d.items, {})
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
          const items = parseJson(d.items, {})
          Object.entries(items).forEach(([t, m]) => { map[key][t] = (map[key][t] || 0) + (m || 0) })
        })
        return ok(map)
      }
      return ok({})
    }
    if (route === 'session_work_reports' && method === 'PUT') {
      const b = await readBody()
      needStr(b.userId, 'userId'); needStr(b.sessionId, 'sessionId')
      if (!isDate(b.date)) throw new HttpError('bad_date', 400)
      if (tooOldForDevice(b.date, role)) throw new HttpError('too_old', 422)
      if (!(await userExists(b.userId))) throw new HttpError('unknown_user', 400)
      const id = `${b.userId}_${b.date}_${b.sessionId}`
      const filtered = cleanItems(b.items)
      // A tablet that was offline sends what the employee entered at clientTs. If an admin
      // changed this session after that moment, the older entry must not overwrite it.
      const at = clientTime(b.clientTs)
      if (at) {
        const cur = await DB.prepare('SELECT updated_at FROM session_work_reports WHERE id = ?').bind(id).first()
        if (cur?.updated_at && cur.updated_at > at) return ok({ ok: true, skipped: true })
      }
      if (Object.keys(filtered).length > 0) {
        await DB.prepare(
          'INSERT OR REPLACE INTO session_work_reports (id, user_id, date, session_id, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, b.userId, b.date, b.sessionId, JSON.stringify(filtered), at || new Date().toISOString()).run()
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
      const b = await readBody()
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
      const b = await readBody()
      await DB.prepare(
        'INSERT OR REPLACE INTO salaried_days (id, user_id, date, break_mins, overtime_mins) VALUES (?, ?, ?, ?, ?)'
      ).bind(`${b.userId}_${b.date}`, b.userId, b.date, b.breakMins ?? 0, b.overtimeMins ?? 0).run()
      return ok({ ok: true })
    }

    // ── Last week's work (先週の同じ曜日・同じ回) ──────────────────────────────
    // For the "先週の◯曜日と同じ内容を入れる" button (clock-out screen and 勤務確認).
    // slot = the n-th clock-in of the day. → { date, items } (items {} when nothing was entered)
    if (route === 'last_week_work' && method === 'GET') {
      const userId = sp.get('userId'), date = sp.get('date'), slot = Number(sp.get('slot'))
      needStr(userId, 'userId')
      if (!isDate(date) || !Number.isInteger(slot) || slot < 1) throw new HttpError('bad_query', 400)
      const lastDate = addDays(date, -7)
      const day = (await lastWeekSlots(DB, userId, mondayOf(date), lastDate)).find(d => d.date === lastDate)
      const found = day?.slots.find(x => x.slot === slot)
      return ok({ date: lastDate, items: found ? found.items : {} })
    }

    // Work entered on recent days, per shift, newest first (the "日付を選んでコピー" list).
    // → [{ date, slot, items }] for the 62 days up to `date` (only shifts with work entered)
    if (route === 'recent_work' && method === 'GET') {
      const userId = sp.get('userId'), date = sp.get('date')
      needStr(userId, 'userId')
      if (!isDate(date)) throw new HttpError('bad_query', 400)
      const days = await workSlots(DB, userId, addDays(date, -62), date)
      return ok(days.reverse().flatMap(d => [...d.slots].reverse().map(x => ({ date: d.date, slot: x.slot, items: x.items }))))
    }

    // ── Weekly copy (週コピー) ─────────────────────────────────────────────
    // What last week looked like, offered at the first clock-out of the week.
    if (route === 'weekly_copy/offer' && method === 'GET') {
      const userId = sp.get('userId'), date = sp.get('date') || todayStr()
      const weekStart = mondayOf(date)
      const answered = await DB.prepare('SELECT answer FROM weekly_copy_answers WHERE id = ?').bind(`${userId}_${weekStart}`).first()
      if (answered) return ok({ offer: false, weekStart, answer: answered.answer })
      // only days of this week that are still ahead (today included) can be prepared
      const days = (await lastWeekSlots(DB, userId, weekStart)).filter(d => addDays(d.date, 7) >= date)
      return ok({ offer: days.length > 0, weekStart, days })
    }
    if (route === 'weekly_copy/answer' && method === 'POST') {
      const { userId, date, answer } = await readBody()
      if (answer !== 'use' && answer !== 'skip') return fail('invalid answer', 400)
      needStr(userId, 'userId')
      if (!isDate(date)) throw new HttpError('bad_date', 400)
      const weekStart = mondayOf(date)
      const now = new Date().toISOString()
      // Only the first answer of the week counts (a double tap or a second tablet changes nothing)
      if (await DB.prepare('SELECT 1 AS x FROM weekly_copy_answers WHERE id = ?').bind(`${userId}_${weekStart}`).first()) {
        return ok({ ok: true, already: true, copiedDays: 0 })
      }
      // the answer and the copies are written together (all or nothing)
      const stmts = [DB.prepare('INSERT OR IGNORE INTO weekly_copy_answers (id, user_id, week_start, answer, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(`${userId}_${weekStart}`, userId, weekStart, answer, now)]
      let copiedDays = 0
      if (answer === 'use') {
        for (const d of await lastWeekSlots(DB, userId, weekStart)) {
          const target = addDays(d.date, 7)
          if (target < date) continue // days of this week that already passed
          copiedDays++
          for (const { slot, items } of d.slots) {
            // never replace what is already there for this day
            // only if the answer stored for the week is "use" (another tablet may have answered "skip" a moment earlier)
            stmts.push(DB.prepare(
              'INSERT OR IGNORE INTO weekly_copies (id, user_id, date, slot, items, updated_at) SELECT ?, ?, ?, ?, ?, ? ' +
              "WHERE EXISTS (SELECT 1 FROM weekly_copy_answers WHERE id = ? AND answer = 'use')"
            ).bind(`${userId}_${target}_${slot}`, userId, target, slot, JSON.stringify(items), now, `${userId}_${weekStart}`))
          }
        }
      }
      await DB.batch(stmts)
      const stored = await DB.prepare('SELECT answer, created_at FROM weekly_copy_answers WHERE id = ?').bind(`${userId}_${weekStart}`).first()
      if (stored && (stored.answer !== answer || stored.created_at !== now)) return ok({ ok: true, already: true, copiedDays: 0 })
      return ok({ ok: true, copiedDays })
    }
    if (route === 'weekly_copies' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      const where = ['user_id = ?'], args = [userId]
      if (date) { where.push('date = ?'); args.push(date) }
      if (dateFrom) { where.push('date >= ?'); args.push(dateFrom) }
      if (dateTo) { where.push('date <= ?'); args.push(dateTo) }
      const { results } = await DB.prepare(`SELECT date, slot, items FROM weekly_copies WHERE ${where.join(' AND ')}`).bind(...args).all()
      const map = {}
      results.forEach(r => { (map[r.date] = map[r.date] || {})[r.slot] = parseJson(r.items, {}) })
      return ok(map)
    }
    if (route === 'weekly_copies' && method === 'DELETE') {
      await DB.prepare('DELETE FROM weekly_copies WHERE user_id = ? AND date = ?').bind(sp.get('userId'), sp.get('date')).run()
      return ok({ ok: true })
    }

    // ── Transport days (本日の交通費) ───────────────────────────────────────
    if (route === 'transport_days' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      const where = [], args = []
      if (userId) { where.push('user_id = ?'); args.push(userId) }
      if (date) { where.push('date = ?'); args.push(date) }
      if (dateFrom) { where.push('date >= ?'); args.push(dateFrom) }
      if (dateTo) { where.push('date <= ?'); args.push(dateTo) }
      const { results } = await DB.prepare('SELECT user_id, date, eligible FROM transport_days' + (where.length ? ' WHERE ' + where.join(' AND ') : ''))
        .bind(...args).all()
      const map = {}
      results.forEach(r => { map[`${r.user_id}_${r.date}`] = !!r.eligible })
      return ok(map)
    }
    if (route === 'transport_days' && method === 'PUT') {
      const b = await readBody()
      needStr(b.userId, 'userId')
      if (!isDate(b.date)) throw new HttpError('bad_date', 400)
      if (tooOldForDevice(b.date, role)) throw new HttpError('too_old', 422)
      if (!(await userExists(b.userId))) throw new HttpError('unknown_user', 400)
      const now = new Date().toISOString()
      await DB.batch([transportStmt(DB, b.userId, b.date, !!b.eligible, now), transportMethodsStmt(DB, b.userId, b.date, b.eligible ? b.methods : null, now)])
      return ok({ ok: true })
    }
    // methods used on each day (people with two or more commute methods)
    if (route === 'transport_day_methods' && method === 'GET') {
      const { userId, date, dateFrom, dateTo } = Object.fromEntries(sp)
      const where = [], args = []
      if (userId) { where.push('user_id = ?'); args.push(userId) }
      if (date) { where.push('date = ?'); args.push(date) }
      if (dateFrom) { where.push('date >= ?'); args.push(dateFrom) }
      if (dateTo) { where.push('date <= ?'); args.push(dateTo) }
      const { results } = await DB.prepare('SELECT user_id, date, methods FROM transport_day_methods' + (where.length ? ' WHERE ' + where.join(' AND ') : ''))
        .bind(...args).all()
      const map = {}
      results.forEach(r => { try { map[`${r.user_id}_${r.date}`] = JSON.parse(r.methods) } catch {} })
      return ok(map)
    }

    // ── Batch Day Edit ─────────────────────────────────────────────────────
    if (route === 'batch/day_edit' && method === 'POST') {
      const body = await readBody()
      const { userId, dateStr, logsToDelete, logsToCreate, logsToUpdate, isSalaried, sessionWorkData, deletedSessionIds, transportEligible, deleteAllReports } = body
      needStr(userId, 'userId')
      if (!isDate(dateStr)) throw new HttpError('bad_date', 400)
      if ((logsToCreate || []).some(l => !LOG_TYPES.has(l.logType))) return fail('invalid log_type', 400)
      if ([...(logsToUpdate || []), ...(logsToCreate || [])].some(l => !isTime(l.time))) throw new HttpError('bad_time', 400)
      // a time after midnight of a shift that started on dateStr (nextDay) belongs to the following calendar day
      const stamp = (time, nextDay) => jstIso(nextDay ? addDays(dateStr, 1) : dateStr, time)
      const now = new Date().toISOString()
      const stmts = []
      if (typeof transportEligible === 'boolean') {
        stmts.push(transportStmt(DB, userId, dateStr, transportEligible, now))
        stmts.push(transportMethodsStmt(DB, userId, dateStr, transportEligible ? body.transportMethods : null, now))
      }
      for (const log of (logsToDelete || []))
        stmts.push(DB.prepare('DELETE FROM logs WHERE id = ?').bind(log.id))
      for (const { id, time, nextDay } of (logsToUpdate || []))
        stmts.push(DB.prepare('UPDATE logs SET time = ?, timestamp = ? WHERE id = ?').bind(time.slice(0, 5) + ':00', stamp(time, nextDay), id))
      for (const { logType, time, sessionId, nextDay } of (logsToCreate || [])) {
        const logId = crypto.randomUUID()
        stmts.push(DB.prepare(
          "INSERT INTO logs (id, user_id, log_type, date, time, work_type, session_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0)"
        ).bind(logId, userId, logType, dateStr, time.slice(0, 5) + ':00', sessionId, stamp(time, nextDay)))
      }
      if (deleteAllReports) stmts.push(DB.prepare('DELETE FROM session_work_reports WHERE user_id = ? AND date = ?').bind(userId, dateStr))
      if (!isSalaried) {
        for (const { sessionId, items } of (sessionWorkData || [])) {
          const rid = `${userId}_${dateStr}_${sessionId}`
          const clean = cleanItems(items)
          if (Object.keys(clean).length > 0) {
            stmts.push(DB.prepare(
              'INSERT OR REPLACE INTO session_work_reports (id, user_id, date, session_id, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(rid, userId, dateStr, sessionId, JSON.stringify(clean), now))
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
    if (e instanceof HttpError) return fail(e.message, e.status)
    console.error(e)
    return fail('server_error', 500)
  }
}

const MAX_LOGIN_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000

// The site itself is allowed separately (same origin); these are the Android app's origins
const APP_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost'])
// never sent to the app, never written through PUT config/:key
const SECRET_CONFIG = new Set(['adminPin', 'adminPinHash'])

function parseJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback } catch { return fallback }
}

// clientTs of a queued entry (when it was typed on the tablet). A tablet clock that runs ahead
// must not make its entry look newer than a later fix by the admin, so it is never after now.
function clientTime(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  if (Number.isNaN(t)) return null
  return new Date(Math.min(t, Date.now())).toISOString()
}

const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

function newToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

// ── Admin PIN hash ─────────────────────────────────────────────────────────────
// Stored as "pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>" in config.adminPinHash.
// setup-new-client.js writes the same format. Few iterations: the free plan allows ~10ms of CPU.
const PIN_ITERATIONS = 2000
async function pbkdf2Hex(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)))
}
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${PIN_ITERATIONS}$${hex(salt)}$${await pbkdf2Hex(pin, salt, PIN_ITERATIONS)}`
}
function sameText(a, b) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
// → null (no PIN set) or { ok, upgrade } (upgrade: the PIN is still stored as typed)
async function checkAdminPin(DB, env, pin) {
  const { results } = await DB.prepare("SELECT key, value FROM config WHERE key IN ('adminPinHash', 'adminPin')").all()
  const get = k => results.find(r => r.key === k)?.value
  const p = typeof pin === 'string' || typeof pin === 'number' ? String(pin) : ''
  const stored = get('adminPinHash')
  if (stored) {
    const [alg, iter, salt, hash] = stored.split('$')
    const n = Number(iter)
    if (alg !== 'pbkdf2-sha256' || !Number.isInteger(n) || n < 1 || !/^[0-9a-f]+$/.test(salt || '') || !hash) return { ok: false }
    const saltBytes = new Uint8Array(salt.match(/../g).map(x => parseInt(x, 16)))
    return { ok: sameText(await pbkdf2Hex(p, saltBytes, n), hash) }
  }
  const plain = get('adminPin') || env.ADMIN_PIN
  if (!plain) return null
  const ok = sameText(p, String(plain))
  return { ok, upgrade: ok && !!get('adminPin') }
}
function adminPinStmts(DB, hash) {
  return [
    DB.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('adminPinHash', ?)").bind(hash),
    DB.prepare("DELETE FROM config WHERE key = 'adminPin'"),
  ]
}

// ── Registered punch tablets ───────────────────────────────────────────────────
async function deviceId(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).slice(0, 16)
}
// "last used" for the device list, written at most every 10 minutes
const DEVICE_SEEN_EVERY_MS = 10 * 60 * 1000
function touchDevice(DB, token) {
  const now = Date.now()
  return DB.prepare(
    'INSERT INTO device_info (token, last_seen) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET last_seen = excluded.last_seen ' +
    'WHERE device_info.last_seen IS NULL OR device_info.last_seen < ?'
  ).bind(token, now, now - DEVICE_SEEN_EVERY_MS).run().catch(() => {})
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
    if (route === 'work_item_defs') return true
    if (route === 'logs/check_in' || route === 'logs/today_statuses') return true
    if (route === 'logs' || route === 'session_work_reports') return !!sp.get('userId')
    // the employee's own transport choice / weekly copy
    if (route === 'transport_days' || route === 'transport_day_methods') return !!(sp.get('userId') && sp.get('date'))
    if (route === 'weekly_copy/offer' || route === 'weekly_copies' || route === 'last_week_work' || route === 'recent_work') return !!sp.get('userId')
    return false
  }
  if (method === 'POST') return route === 'logs' || route === 'weekly_copy/answer' || route === 'users/by_pin'
  if (method === 'PUT') return route === 'session_work_reports' || route === 'work_reports' || route === 'transport_days'
  // an employee may remove a day prepared by the weekly copy (e.g. off sick); never punches
  if (method === 'DELETE') return route === 'weekly_copies' && !!(sp.get('userId') && sp.get('date'))
  return false
}

const HAS_CLOCK_IN = "EXISTS (SELECT 1 FROM logs WHERE user_id = ? AND session_id = ? AND log_type = '出勤')"

const LOG_TYPES = new Set(['出勤', '退勤', '休憩開始', '休憩終了'])

function publicUser(u) {
  // pin is included so the tablet can match PINs while offline
  return {
    id: u.id, name: u.name, pin: u.pin || '', employeeType: u.employeeType, workItems: u.workItems || [],
    asksTransport: asksTransport(u), transportOptions: u.employeeType === 'salaried' ? [] : commuteMethodsOf(u).filter(k => k !== 'legacy'), formerIds: Array.isArray(u.formerIds) ? u.formerIds : [],
  }
}

// Whether the clock-out screen should ask "本日の交通費". Must match
// getCommute() in src/lib/db.js.
function commuteMethodsOf(u) {
  // the settings valid today (a change saved in advance with a later start date doesn't count yet)
  const date = todayStr()
  const hist = Array.isArray(u.commuteHistory) ? [...u.commuteHistory].sort((a, b) => (a.from || '').localeCompare(b.from || '')) : []
  let e = null
  for (const h of hist) if (!h.from || h.from <= date) e = h
  if (!e) e = { methods: u.commuteMethods, method: u.commuteMethod, km: u.commuteKm, oneWayKm: u.commuteOneWayKm, legacyKm: u.commuteDistanceKm, amount: u.itemRates?.['交通費']?.amount }
  if (e.methods && typeof e.methods === 'object') {
    return COMMUTE_KEYS.filter(k => e.methods[k] && (k === 'public' ? Number(e.methods[k].amount) > 0 : Number(e.methods[k].km) > 0))
  }
  const m = e.method === 'bus' || e.method === 'train' ? 'public' : e.method
  if (m === 'walk' || m === 'none') return []
  if (m === 'car' || m === 'bike') return Number(e.km) > 0 || Number(e.oneWayKm) > 0 || Number(e.legacyKm) > 0 ? [m] : []
  return Number(e.amount) > 0 ? [m === 'public' ? 'public' : 'legacy'] : []
}

// Whether the clock-out screen should ask "本日の交通費". Must match getCommute() in src/lib/db.js.
function asksTransport(u) {
  if (u.employeeType === 'salaried') return false
  return commuteMethodsOf(u).length > 0
}

const COMMUTE_KEYS = ['car', 'bike', 'public']
function transportMethodsStmt(DB, userId, date, methods, now) {
  const list = Array.isArray(methods) ? [...new Set(methods.filter(m => COMMUTE_KEYS.includes(m)))] : []
  return list.length
    ? DB.prepare('INSERT OR REPLACE INTO transport_day_methods (id, user_id, date, methods, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(`${userId}_${date}`, userId, date, JSON.stringify(list), now)
    : DB.prepare('DELETE FROM transport_day_methods WHERE id = ?').bind(`${userId}_${date}`)
}

function transportStmt(DB, userId, date, eligible, now) {
  // eligible is the default, so only "not eligible" needs a row
  return eligible
    ? DB.prepare('DELETE FROM transport_days WHERE id = ?').bind(`${userId}_${date}`)
    : DB.prepare('INSERT OR REPLACE INTO transport_days (id, user_id, date, eligible, updated_at) VALUES (?, ?, ?, 0, ?)')
      .bind(`${userId}_${date}`, userId, date, now)
}

function mondayOf(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow)
}

// Last week's actual work per day and per session order:
// [{ date, slots: [{ slot, items }] }]. Sessions are ordered by clock-in time.
async function lastWeekSlots(DB, userId, weekStart, onlyDate = null) {
  return workSlots(DB, userId, onlyDate || addDays(weekStart, -7), onlyDate || addDays(weekStart, -1))
}

// Work entered per day and per shift between two dates: [{ date, slots: [{ slot, items }] }]
// (slot = the n-th clock-in of the day, ordered by time)
async function workSlots(DB, userId, from, to) {
  const [logsR, repR] = await Promise.all([
    DB.prepare("SELECT date, time, session_id FROM logs WHERE user_id = ? AND date >= ? AND date <= ? AND log_type = '出勤'").bind(userId, from, to).all(),
    DB.prepare('SELECT date, session_id, items FROM session_work_reports WHERE user_id = ? AND date >= ? AND date <= ?').bind(userId, from, to).all(),
  ])
  const reports = {}
  repR.results.forEach(r => { reports[r.session_id] = cleanItems(parseJson(r.items, {}), false) })
  const byDate = {}
  logsR.results.filter(l => l.session_id).forEach(l => { (byDate[l.date] = byDate[l.date] || []).push(l) })
  const out = []
  Object.keys(byDate).sort().forEach(date => {
    const slots = byDate[date]
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
      .map((l, i) => ({ slot: i + 1, items: reports[l.session_id] || {} }))
      .filter(s => Object.keys(s.items).length > 0)
    if (slots.length > 0) out.push({ date, slots })
  })
  return out
}

// Work minutes per item: positive whole minutes, at most one day per item
// strict=false (reading stored data): skip anything odd instead of failing the request
function cleanItems(items, strict = true) {
  const out = {}
  for (const [t, m] of Object.entries(items || {})) {
    const n = Math.round(Number(m))
    if (!t || t.length > 60 || !Number.isFinite(n)) { if (strict) throw new HttpError('bad_items', 400); continue }
    if (n > 1440) { if (strict) throw new HttpError('bad_minutes', 400); continue }
    if (n > 0) out[t] = n
  }
  return out
}

function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10)
}

// Workers run in UTC; the business runs in JST (UTC+9)
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// A punch made from 0:00 up to this hour (JST) can still finish yesterday's shift
const OVERNIGHT_UNTIL_HOUR = 0 // 日をまたぐ勤務は扱わない（0 = 0時を過ぎたら前日の勤務を続けない）
function jstHour() {
  return new Date(Date.now() + JST_OFFSET_MS).getUTCHours()
}

function todayStr() {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

function jstIso(dateStr, time) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, m] = time.split(':').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0) - JST_OFFSET_MS).toISOString()
}

function parseUser(u) {
  return { ...parseJson(u.data, {}), id: u.id }
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
    work_items: l.work_items ? parseJson(l.work_items, null) : null,
  }
}
