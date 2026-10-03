// Punch flow shared by the browser kiosk (App.jsx) and the Android app
// (TabletApp.jsx): decides what a scan means from the employee's current state.
import {
  getTodayPunchState, saveLog, BREAK_START, BREAK_END, pairBreaks, breakMinutes,
  getWeeklyCopyForSlot, getWeeklyCopyOffer, getTransportDay, saveTransportDay,
  saveSessionWorkReport, saveWorkReport, localToday, getCommute, loadWorkItemDefs, answerWeeklyCopy,
} from './db.js'

function nowHM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Total break minutes today, counting an open break as ending now
function todayBreakMinutes(logs) {
  const bySession = {}
  logs.forEach(l => { if (l.session_id) (bySession[l.session_id] = bySession[l.session_id] || []).push(l) })
  const now = nowHM()
  return Object.values(bySession).reduce((sum, ls) => {
    const breaks = pairBreaks(ls).map(b => (b.startLog && !b.endLog ? { ...b, end: now } : b))
    return sum + breakMinutes(breaks)
  }, 0)
}

export function asksTransport(user) {
  return user.asksTransport ?? getCommute(user).asks
}

const fail = message => ({ kind: 'error', message })
const done = info => ({ kind: 'complete', info })

async function endBreak(user, ps) {
  await saveLog({ userId: user.id, logType: BREAK_END, sessionId: ps.sessionId })
  return done({ logType: BREAK_END, user, breakInfo: { start: ps.openBreak?.start, totalMins: todayBreakMinutes(ps.logs) } })
}

// mode: '出勤' | '退勤' | '休憩'
// → { kind: 'error', message } | { kind: 'complete', info } | { kind: 'work', ctx }
export async function handlePunch(mode, user) {
  const ps = await getTodayPunchState(user.id)

  if (mode === '出勤') {
    // 出勤 never doubles as "back from break": the button keeps one meaning
    if (ps.state === 'break') return fail(`${user.name} さんは休憩中です。戻るときは「休憩・戻り」を押してください`)
    if (ps.state === 'working') return fail(`${user.name} さんはすでに出勤中です`)
    await saveLog({ userId: user.id, workType: '', logType: '出勤' })
    return done({ logType: '出勤', user })
  }

  if (mode === '休憩') {
    if (ps.state === 'off') return fail(`${user.name} さんはまだ出勤していません`)
    if (!ps.sessionId) return fail('休憩を記録できませんでした。管理者に連絡してください')
    if (ps.state === 'break') return endBreak(user, ps)
    await saveLog({ userId: user.id, logType: BREAK_START, sessionId: ps.sessionId })
    return done({ logType: BREAK_START, user })
  }

  // 退勤
  if (ps.state === 'off') return fail(`${user.name} さんはまだ出勤していません`)
  const breakTotal = todayBreakMinutes(ps.logs)
  if (user.employeeType === 'salaried') {
    if (ps.state === 'break') await saveLog({ userId: user.id, logType: BREAK_END, sessionId: ps.sessionId })
    await saveLog({ userId: user.id, workItems: {}, logType: '退勤', sessionId: ps.sessionId })
    return done({ logType: '退勤', workItems: {}, user, clockInTime: ps.clockIn?.time, breakInfo: { totalMins: breakTotal } })
  }

  const date = localToday()
  const asks = asksTransport(user)
  // this clock-out closes the n-th session of the day → the n-th copied slot
  const slot = ps.logs.filter(l => l.log_type === '出勤').length
  // first clock-out of the week: the work screen first asks whether to reuse
  // last week's work (null when already answered, nothing to copy or offline)
  const [prefill, savedTransport, offer] = await Promise.all([
    getWeeklyCopyForSlot(user.id, date, slot),
    asks ? getTransportDay(user.id, date) : null,
    getWeeklyCopyOffer(user.id),
    loadWorkItemDefs(), // latest names / order for the work cards
  ])
  return {
    kind: 'work',
    ctx: {
      user, date, sessionId: ps.sessionId, clockIn: ps.clockIn, onBreak: ps.state === 'break',
      breakTotal, prefill, slot, weeklyOffer: offer?.offer ? offer : null,
      asksTransport: asks, transportDefault: savedTransport ?? true,
      sessionCount: ps.logs.filter(l => l.log_type === '退勤').length + 1,
    },
  }
}

// Answer to the weekly copy question on the work screen.
// → { copiedDays, prefill } (prefill: this session's copied items, or null)
export async function answerWeeklyCopyAtClockOut(ctx, answer) {
  const r = await answerWeeklyCopy(ctx.user.id, answer)
  const prefill = answer === 'use' ? await getWeeklyCopyForSlot(ctx.user.id, ctx.date, ctx.slot) : null
  return { copiedDays: r.copiedDays || 0, prefill }
}

export async function finishClockOut(ctx, workItems, { transportEligible } = {}) {
  const userId = ctx.user.id
  if (ctx.onBreak) await saveLog({ userId, logType: BREAK_END, sessionId: ctx.sessionId })
  await saveLog({ userId, logType: '退勤', sessionId: ctx.sessionId })
  if (ctx.sessionId) await saveSessionWorkReport(userId, ctx.date, ctx.sessionId, workItems)
  else await saveWorkReport(userId, ctx.date, workItems)
  if (ctx.asksTransport && typeof transportEligible === 'boolean') await saveTransportDay(userId, ctx.date, transportEligible)
  return { logType: '退勤', workItems, user: ctx.user, clockInTime: ctx.clockIn?.time, breakInfo: { totalMins: ctx.breakTotal } }
}
