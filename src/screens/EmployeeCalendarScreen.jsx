import React, { useState, useEffect, useCallback } from 'react'
import { getLogs, saveSessionWorkReport, getSessionWorkReportsForUser, CLOCK_OUT_HIDDEN } from '../lib/db'
import styles from './EmployeeCalendarScreen.module.css'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function getMonthRange(year, month) {
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(year, month + 1, 0).getDate()
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)
  return days
}

function buildDayMap(logs, year, month) {
  const map = {}
  const byDaySession = {}
  const noSessionLogs = {}

  logs.forEach(log => {
    const [y, m, d] = log.date.split('-').map(Number)
    if (y !== year || m !== month + 1) return
    if (log.session_id) {
      if (!byDaySession[d]) byDaySession[d] = {}
      if (!byDaySession[d][log.session_id]) byDaySession[d][log.session_id] = { in: '', out: '', ts: '' }
      const entry = byDaySession[d][log.session_id]
      if (log.log_type === '出勤') { entry.in = (log.time || '').substring(0, 5); entry.ts = log.timestamp || '' }
      else if (log.log_type === '退勤') entry.out = (log.time || '').substring(0, 5)
    } else {
      if (!noSessionLogs[d]) noSessionLogs[d] = { ins: [], outs: [] }
      if (log.log_type === '出勤') noSessionLogs[d].ins.push({ time: (log.time || '').substring(0, 5), ts: log.timestamp || '' })
      else if (log.log_type === '退勤') noSessionLogs[d].outs.push((log.time || '').substring(0, 5))
    }
  })

  const allDays = new Set([...Object.keys(byDaySession), ...Object.keys(noSessionLogs)].map(Number))
  allDays.forEach(d => {
    const sessions = []
    Object.entries(byDaySession[d] || {}).forEach(([sid, s]) => {
      sessions.push({ sessionId: sid, in: s.in, out: s.out, ts: s.ts })
    })
    const legacy = noSessionLogs[d]
    if (legacy) {
      const sortedIns = [...legacy.ins].sort((a, b) => a.time.localeCompare(b.time))
      const sortedOuts = [...legacy.outs].sort()
      const n = Math.max(sortedIns.length, sortedOuts.length)
      for (let i = 0; i < n; i++) {
        sessions.push({ sessionId: null, in: sortedIns[i]?.time || '', out: sortedOuts[i] || '', ts: sortedIns[i]?.ts || '' })
      }
    }
    sessions.sort((a, b) => (a.in || a.ts || '').localeCompare(b.in || b.ts || ''))
    map[d] = sessions
  })
  return map
}

function fmtMins(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`
}

function rowsToObj(rows) {
  const obj = {}
  rows.forEach(r => {
    if (!r.type) return
    const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
    if (mins > 0) obj[r.type] = mins
  })
  return obj
}

function objsEqual(a, b) {
  const ka = Object.keys(a).filter(k => (a[k] || 0) > 0).sort()
  const kb = Object.keys(b).filter(k => (b[k] || 0) > 0).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/* ─── 業務入力・編集フォーム ─── */
function WorkEditMode({ sessionLabel, editableItems, initialWork, onCancel, onSave, saving }) {
  const initRows = () => {
    const entries = Object.entries(initialWork).filter(([, m]) => m > 0)
    if (entries.length === 0) return [{ type: '', h: 0, m: 0 }]
    return entries.map(([type, mins]) => ({ type, h: Math.floor(mins / 60), m: mins % 60 }))
  }
  const [workRows, setWorkRows] = useState(initRows)

  const selectedTypes = new Set(workRows.map(r => r.type).filter(Boolean))
  const hasMoreTypes = editableItems.some(t => !selectedTypes.has(t))
  const canSave = !objsEqual(rowsToObj(workRows), initialWork)

  function addRow() { setWorkRows(prev => [...prev, { type: '', h: 0, m: 0 }]) }
  function removeRow(ri) { setWorkRows(prev => prev.filter((_, i) => i !== ri)) }
  function updateRow(ri, field, val) {
    setWorkRows(prev => prev.map((r, i) => i === ri ? { ...r, [field]: val } : r))
  }

  return (
    <div className={styles.editMode}>
      <div className={styles.editModeHeader}>
        <span className={styles.editModeLabel}>{sessionLabel}</span>
      </div>

      <div className={styles.editRows}>
        {workRows.map((row, ri) => {
          const avail = editableItems.filter(t => t === row.type || !selectedTypes.has(t))
          return (
            <div key={ri} className={styles.editRow}>
              <select
                className={styles.editRowSelect}
                value={row.type}
                onChange={e => updateRow(ri, 'type', e.target.value)}
              >
                <option value="">業務を選択</option>
                {avail.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                type="number" min="0" max="23"
                className={styles.editRowNum}
                value={row.h || ''}
                placeholder="0"
                onChange={e => { const n = parseInt(e.target.value); updateRow(ri, 'h', isNaN(n) ? 0 : Math.max(0, n)) }}
                onFocus={e => e.target.select()}
              />
              <span className={styles.editRowUnit}>時間</span>
              <input
                type="number" min="0" max="59"
                className={styles.editRowNum}
                value={row.m || ''}
                placeholder="0"
                onChange={e => { const n = parseInt(e.target.value); updateRow(ri, 'm', isNaN(n) ? 0 : Math.min(59, Math.max(0, n))) }}
                onFocus={e => e.target.select()}
              />
              <span className={styles.editRowUnit}>分</span>
              {workRows.length > 1 && (
                <button className={styles.editRowDel} onClick={() => removeRow(ri)}>削除</button>
              )}
            </div>
          )
        })}

        {hasMoreTypes && (
          <button className={styles.addRowBtn} onClick={addRow}>＋ 別の業務を追加</button>
        )}
      </div>

      <div className={styles.editActions}>
        <button className={styles.editCancelBtn2} onClick={onCancel} disabled={saving}>キャンセル</button>
        <button
          className={styles.editSaveBtn}
          onClick={() => canSave && !saving && onSave(rowsToObj(workRows))}
          disabled={!canSave || saving}
        >{saving ? '保存中…' : '保存する'}</button>
      </div>
    </div>
  )
}

/* ─── 日別詳細モーダル ─── */
function DayModal({ day, year, month, sessions, user, sessionWorkItems, onClose, onWorkSaved }) {
  const editableItems = (user?.workItems || []).filter(item => !CLOCK_OUT_HIDDEN.has(item))
  const canEdit = editableItems.length > 0 && user?.employeeType !== 'salaried'
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const dowLabel = DOW_LABELS[new Date(year, month, day).getDay()]

  const [editingSessionIdx, setEditingSessionIdx] = useState(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(workItemsObj) {
    const session = sessions[editingSessionIdx]
    if (!session?.sessionId) return
    setSaving(true)
    try {
      await saveSessionWorkReport(user.id, dateStr, session.sessionId, workItemsObj)
      onWorkSaved(session.sessionId, workItemsObj, dateStr)
      setEditingSessionIdx(null)
    } catch {
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const editingSession = editingSessionIdx !== null ? sessions[editingSessionIdx] : null
  const editingWork = editingSession?.sessionId ? (sessionWorkItems[editingSession.sessionId] || {}) : {}

  return (
    <div className={styles.modalOverlay} onClick={editingSessionIdx === null ? onClose : undefined}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {editingSessionIdx !== null ? (
          <WorkEditMode
            sessionLabel={`${editingSessionIdx + 1}回目の業務`}
            editableItems={editableItems}
            initialWork={editingWork}
            onCancel={() => setEditingSessionIdx(null)}
            onSave={handleSave}
            saving={saving}
          />
        ) : (
          <>
            <div className={styles.modalHeader}>
              <span className={styles.modalDate}>{year}年{month + 1}月{day}日（{dowLabel}）</span>
              <button className={styles.modalCloseBtn} onClick={onClose}>✕</button>
            </div>

            <div className={styles.sessionList}>
              {sessions.map((session, idx) => {
                const workData = session.sessionId ? (sessionWorkItems[session.sessionId] || null) : null
                const workEntries = workData ? Object.entries(workData).filter(([, m]) => m > 0) : []
                const hasWork = workEntries.length > 0
                const hasIn = !!session.in
                const isActive = hasIn && !session.out
                const canEditSession = canEdit && hasIn && !!session.sessionId
                const totalWorkMins = workEntries.reduce((s, [, m]) => s + m, 0)

                return (
                  <div key={idx} className={styles.sessionBlock}>
                    <div className={styles.sessionBlockTop}>
                      <span className={styles.sessionNumBadge}>{idx + 1}回目</span>
                      <span className={styles.sessionTimes}>
                        {session.in || '—'}
                        {' → '}
                        {session.out ? session.out : <span className={styles.timeActive}>勤務中</span>}
                      </span>
                      {isActive
                        ? <span className={styles.statusBadgeActive}>勤務中</span>
                        : session.out
                          ? <span className={styles.statusBadgeDone}>退勤済</span>
                          : null
                      }
                    </div>

                    <div className={styles.sessionWorkArea}>
                      {hasWork ? (
                        <>
                          <div className={styles.workAreaHeader}>
                            <span className={styles.workLabel}>業務</span>
                            <span className={styles.workBadgeEntered}>入力済</span>
                          </div>
                          <div className={styles.workEntries}>
                            {workEntries.map(([type, mins]) => (
                              <div key={type} className={styles.workEntry}>
                                <span className={styles.workEntryType}>{type}</span>
                                <span className={styles.workEntryTime}>{fmtMins(mins)}</span>
                              </div>
                            ))}
                          </div>
                          {workEntries.length > 1 && (
                            <div className={styles.workEntryTotal}>今回の合計 {fmtMins(totalWorkMins)}</div>
                          )}
                          {canEditSession && (
                            <button className={styles.editWorkBtn} onClick={() => setEditingSessionIdx(idx)}>
                              業務を編集
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <div className={styles.workAreaHeader}>
                            <span className={styles.workLabel}>業務</span>
                            <span className={styles.workBadgeEmpty}>未入力</span>
                          </div>
                          {canEditSession ? (
                            <button className={styles.inputWorkBtn} onClick={() => setEditingSessionIdx(idx)}>
                              業務を入力
                            </button>
                          ) : !session.sessionId ? (
                            <span className={styles.legacyHint}>旧データ形式（管理者が入力）</span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <button className={styles.modalClose} onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── カレンダー画面（メイン） ─── */
export default function EmployeeCalendarScreen({ user, onBack }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null)
  const [sessionWorkItems, setSessionWorkItems] = useState({})   // { sessionId: items }
  const [sessionWorkStatus, setSessionWorkStatus] = useState({}) // { dateStr: Set<sessionId> }
  const [legacyWorkedDates, setLegacyWorkedDates] = useState(new Set())

  const loadLogs = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    const { from, to } = getMonthRange(year, month)
    const isSal = user?.employeeType === 'salaried'
    Promise.all([
      getLogs({ dateFrom: from, dateTo: to, userId: user.id }),
      isSal ? Promise.resolve(null) : getSessionWorkReportsForUser(user.id)
    ]).then(([data, workData]) => {
      setLogs(data)
      if (workData) {
        setSessionWorkItems(workData.bySession)
        setSessionWorkStatus(workData.sessionsByDate)
        setLegacyWorkedDates(workData.legacyWorkedDates)
      }
      setLoading(false)
    }).catch(() => {
      setLoadError(true)
      setLoading(false)
    })
  }, [year, month, user.id, user?.employeeType])

  useEffect(() => { loadLogs() }, [loadLogs])

  function handleWorkSaved(sessionId, items, dateStr) {
    setSessionWorkItems(prev => ({ ...prev, [sessionId]: items }))
    setSessionWorkStatus(prev => {
      const hasWork = Object.values(items).some(m => m > 0)
      const s = new Set(prev[dateStr] || [])
      if (hasWork) s.add(sessionId)
      else s.delete(sessionId)
      return { ...prev, [dateStr]: s }
    })
  }

  const days = getCalendarDays(year, month)
  const dayMap = buildDayMap(logs, year, month)
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (isCurrentMonth) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>←</button>
        <div className={styles.userName}>{user.name}</div>
        <div />
      </div>

      <div className={styles.monthNav}>
        <button onClick={prevMonth} className={styles.navBtn}>◀</button>
        <span className={styles.monthLabel}>{year}年{month + 1}月</span>
        <button onClick={nextMonth} className={styles.navBtn} disabled={isCurrentMonth}>▶</button>
      </div>

      {loading ? (
        <div className={styles.loading}>読込中...</div>
      ) : loadError ? (
        <div className={styles.loadError}>
          <div>読み込みに失敗しました</div>
          <button className={styles.retryBtn} onClick={loadLogs}>再読み込み</button>
        </div>
      ) : (
        <div className={styles.calGrid}>
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={[styles.dayLabel, i === 0 ? styles.sun : i === 6 ? styles.sat : ''].join(' ')}>{d}</div>
          ))}
          {days.map((d, i) => {
            if (!d) return <div key={`pad-${i}`} className={styles.emptyCell} />
            const sessions = dayMap[d] || []
            const inTime = sessions[0]?.in || ''
            const outTime = [...sessions].map(s => s.out).filter(Boolean).sort().reverse()[0] || ''
            const worked = sessions.length > 0
            const dow = new Date(year, month, d).getDay()
            const isSalaried = user?.employeeType === 'salaried'
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const sessionIds = sessions.map(s => s.sessionId).filter(Boolean)
            const workedSessions = sessionWorkStatus[dateStr]

            let workBadgeLabel = null
            let workBadgeClass = null
            if (!isSalaried && worked) {
              const sessionsWithIn = sessions.filter(s => s.in)
              const outOnlyBroken = sessions.some(s => !s.in && s.out)
              if (outOnlyBroken && sessionsWithIn.length === 0) {
                workBadgeLabel = '打刻要確認'; workBadgeClass = styles.calWorkBadgeRed
              } else if (sessionsWithIn.length > 0) {
                const allActive = sessionsWithIn.every(s => !s.out)
                if (allActive) {
                  workBadgeLabel = '勤務中'; workBadgeClass = styles.calWorkBadgeBlue
                } else if (sessionIds.length > 0) {
                  const coveredCount = sessionIds.filter(id => workedSessions?.has(id)).length
                  if (coveredCount === 0) { workBadgeLabel = '業務未入力'; workBadgeClass = styles.calWorkBadgeOrange }
                  else if (coveredCount === sessionIds.length) { workBadgeLabel = '業務入力済'; workBadgeClass = styles.calWorkBadgeTeal }
                  else { workBadgeLabel = '一部未入力'; workBadgeClass = styles.calWorkBadgeOrange }
                } else {
                  // 旧形式データ
                  if (legacyWorkedDates.has(dateStr)) {
                    workBadgeLabel = '業務入力済'; workBadgeClass = styles.calWorkBadgeTeal
                  } else {
                    workBadgeLabel = '業務未入力'; workBadgeClass = styles.calWorkBadgeOrange
                  }
                }
              }
            }

            return (
              <div
                key={d}
                className={[styles.cell, inTime ? styles.worked : '', dow === 0 ? styles.sun : dow === 6 ? styles.sat : ''].join(' ')}
                onClick={() => worked && setSelectedDay(d)}
              >
                <div className={styles.dayNum}>{d}</div>
                {inTime && <div className={styles.inTime}>出 {inTime}</div>}
                {inTime && outTime && <div className={styles.timeSpacer} />}
                {outTime && <div className={styles.outTime}>退 {outTime}</div>}
                {workBadgeLabel && <div className={workBadgeClass}>{workBadgeLabel}</div>}
              </div>
            )
          })}
        </div>
      )}

      {selectedDay !== null && (
        <DayModal
          day={selectedDay}
          year={year}
          month={month}
          sessions={dayMap[selectedDay] || []}
          user={user}
          sessionWorkItems={sessionWorkItems}
          onClose={() => setSelectedDay(null)}
          onWorkSaved={handleWorkSaved}
        />
      )}
    </div>
  )
}
