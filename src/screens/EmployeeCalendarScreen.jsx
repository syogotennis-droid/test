import React, { useState, useEffect, useCallback } from 'react'
import { getLogs, saveSessionWorkReport, getSessionWorkReportsForUser, CLOCK_OUT_HIDDEN, pairBreaks, getWeeklyCopies, deleteWeeklyCopy, getLastWeekWork, localToday, itemLabel, sortByItemOrder, isDeletedWorkItem, loadWorkItemDefs } from '../lib/db'
import { useIdleTimeout } from '../lib/useIdleTimeout'
import styles from './EmployeeCalendarScreen.module.css'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']
const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

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
      if (!byDaySession[d][log.session_id]) byDaySession[d][log.session_id] = { in: '', out: '', ts: '', logs: [] }
      const entry = byDaySession[d][log.session_id]
      entry.logs.push(log)
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
      sessions.push({ sessionId: sid, in: s.in, out: s.out, ts: s.ts, breaks: pairBreaks(s.logs) })
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

function objsEqual(a, b) {
  const ka = Object.keys(a).filter(k => (a[k] || 0) > 0).sort()
  const kb = Object.keys(b).filter(k => (b[k] || 0) > 0).sort()
  if (ka.length !== kb.length) return false
  return ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/* ─── 業務入力・編集フォーム（カード＋テンキー） ─── */
function WorkEditMode({ sessionLabel, editableItems: selectable, initialWork, lastWeek, onCancel, onSave, saving }) {
  // items already entered stay editable even if no longer selectable (e.g. deleted)
  const [editableItems] = useState(() => sortByItemOrder([...new Set([
    ...selectable, ...Object.keys(initialWork).filter(t => initialWork[t] > 0),
  ])]))
  const [inputs, setInputs] = useState(() => {
    const init = {}
    Object.entries(initialWork).forEach(([type, mins]) => {
      if (mins > 0) init[type] = { h: Math.floor(mins / 60), m: mins % 60 }
    })
    return init
  })
  const [selectedItem, setSelectedItem] = useState(editableItems[0] || null)
  const [numpadField, setNumpadField] = useState('h')

  const getHM = item => inputs[item] || { h: 0, m: 0 }
  const currentH = selectedItem ? (getHM(selectedItem).h ?? 0) : 0
  const currentM = selectedItem ? (getHM(selectedItem).m ?? 0) : 0

  const totalInputMinutes = editableItems.reduce((s, item) => {
    const v = getHM(item)
    return s + (v.h ?? 0) * 60 + (v.m ?? 0)
  }, 0)

  const currentObj = {}
  editableItems.forEach(item => {
    const v = getHM(item)
    const mins = (v.h ?? 0) * 60 + (v.m ?? 0)
    if (mins > 0) currentObj[item] = mins
  })
  const canSave = !objsEqual(currentObj, initialWork)

  function pressKey(k) {
    if (!selectedItem) return
    setInputs(prev => {
      const cur = prev[selectedItem] || { h: 0, m: 0 }
      if (k === 'C') return { ...prev, [selectedItem]: { h: 0, m: 0 } }
      if (k === '⌫') {
        const curVal = cur[numpadField] ?? 0
        const s = String(curVal)
        const newVal = s.length > 1 ? parseInt(s.slice(0, -1)) : 0
        return { ...prev, [selectedItem]: { ...cur, [numpadField]: newVal } }
      }
      const curVal = cur[numpadField] ?? 0
      const s = (curVal === 0 ? '' : String(curVal)) + k
      const newVal = parseInt(s)
      if (numpadField === 'h' && newVal > 99) return prev
      if (numpadField === 'm' && newVal > 59) return prev
      return { ...prev, [selectedItem]: { ...cur, [numpadField]: newVal } }
    })
  }

  // same weekday / same shift last week (only items this person can enter)
  const lastWeekItems = Object.fromEntries(Object.entries(lastWeek?.items || {}).filter(([t, m]) => m > 0 && editableItems.includes(t)))
  const lastWeekDow = lastWeek ? DOW_LABELS[new Date(lastWeek.date.replace(/-/g, '/')).getDay()] : ''
  const [usedLastWeek, setUsedLastWeek] = useState(false)
  function useLastWeek() {
    if (Object.keys(currentObj).length > 0 && !window.confirm(`入力中の内容を、先週の${lastWeekDow}曜日の内容に置き換えますか？`)) return
    setInputs(Object.fromEntries(Object.entries(lastWeekItems).map(([t, m]) => [t, { h: Math.floor(m / 60), m: m % 60 }])))
    setUsedLastWeek(true)
  }

  return (
    <>
      <div className={styles.editHeader}>
        <div className={styles.editHeaderDate}>{sessionLabel}</div>
        {Object.keys(lastWeekItems).length > 0 && !objsEqual(currentObj, lastWeekItems) && (
          <button type="button" className={styles.lastWeekBtn} onClick={useLastWeek}>先週の{lastWeekDow}曜日と同じ内容を入れる</button>
        )}
      </div>
      {usedLastWeek && (
        <div className={styles.lastWeekBanner}>先週の{lastWeekDow}曜日と同じ内容を入れました。違うときは直して「保存する」</div>
      )}

      <div className={styles.editBody}>
        <div className={styles.editLeftCol}>
          <p className={styles.editColTitle}>業務を選択</p>
          <div className={styles.editItemGrid}>
            {editableItems.map(item => {
              const hm = getHM(item)
              const v = (hm.h ?? 0) * 60 + (hm.m ?? 0)
              const isSel = selectedItem === item
              return (
                <button
                  key={item}
                  className={[
                    styles.editItemBtn,
                    isSel ? styles.editItemBtnSelected : v > 0 ? styles.editItemBtnEntered : ''
                  ].join(' ')}
                  onClick={() => { setSelectedItem(item); setNumpadField('h') }}
                >
                  <span className={styles.editItemName}>{itemLabel(item)}</span>
                  {v > 0 && <span className={styles.editItemTime}>{fmtMins(v)}</span>}
                </button>
              )
            })}
          </div>
          <div className={styles.editLeftActions}>
            <button className={styles.editCancelBtn} onClick={onCancel} disabled={saving}>
              キャンセル
            </button>
            <button
              className={styles.editSaveFinalBtn}
              onClick={() => canSave && !saving && onSave(currentObj)}
              disabled={!canSave || saving}
            >
              {saving ? '保存中' : '保存する'}
            </button>
          </div>
        </div>

        <div className={styles.editRightCol}>
          <div className={styles.editInputTitle}>
            {selectedItem ? `${itemLabel(selectedItem)}の時間を入力` : '業務を選択'}
          </div>

          <div className={styles.hmDisplayRow}>
            <div
              className={[styles.hmBox, numpadField === 'h' ? styles.hmBoxActive : ''].join(' ')}
              onClick={() => setNumpadField('h')}
            >
              {currentH}
            </div>
            <span className={styles.hmUnit}>時間</span>
            <div
              className={[styles.hmBox, numpadField === 'm' ? styles.hmBoxActive : ''].join(' ')}
              onClick={() => setNumpadField('m')}
            >
              {String(currentM).padStart(2, '0')}
            </div>
            <span className={styles.hmUnit}>分</span>
          </div>

          <div className={styles.timeNumGrid}>
            {NUM_KEYS.map((k, i) => (
              <button
                key={i}
                className={[
                  styles.timeNumKey,
                  k === '⌫' ? styles.timeNumDel : '',
                  k === 'C' ? styles.timeNumClear : ''
                ].join(' ')}
                onClick={() => pressKey(k)}
              >{k}</button>
            ))}
          </div>

          <div className={styles.editTotalRow}>
            <span>今回の合計</span>
            <span>{totalInputMinutes > 0 ? fmtMins(totalInputMinutes) : '0分'}</span>
          </div>
        </div>
      </div>
    </>
  )
}

/* ─── 日別詳細モーダル ─── */
function fmtCopyItems(items) {
  return sortByItemOrder(Object.keys(items)).map(t => `${itemLabel(t)} ${fmtMins(items[t])}`).join('・')
}

// Work prepared for an upcoming day by the weekly copy; the employee may remove it
function CopySection({ copy, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const slots = Object.keys(copy).map(Number).sort((a, b) => a - b)
  return (
    <div className={styles.copySection}>
      <div className={styles.copyTitle}>先週からコピーした業務</div>
      {slots.map(n => (
        <div key={n} className={styles.copyLine}>
          {slots.length > 1 && <span className={styles.copySlot}>{n}回目</span>}
          <span>{fmtCopyItems(copy[n])}</span>
        </div>
      ))}
      <div className={styles.copyHint}>退勤時の業務入力に、この内容が入ります</div>
      {confirming ? (
        <div className={styles.copyConfirm}>
          <span>この日の業務予定を削除しますか？</span>
          <button className={styles.copyCancelBtn} onClick={() => setConfirming(false)} disabled={busy}>やめる</button>
          <button className={styles.copyDeleteBtn} disabled={busy}
            onClick={async () => { setBusy(true); try { await onDelete() } catch { alert('削除できません'); setBusy(false) } }}>
            削除する
          </button>
        </div>
      ) : (
        <button className={styles.copyDeleteOutline} onClick={() => setConfirming(true)}>この日の予定を削除（休みなど）</button>
      )}
    </div>
  )
}

// Employees can fix their own work entries for this month and last month only
function editableFrom() {
  const t = localToday()
  const [y, m] = t.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // first day of last month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function DayModal({ day, year, month, sessions, user, sessionWorkItems, copy, onDeleteCopy, onClose, onWorkSaved }) {
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const tooOld = dateStr < editableFrom()
  const editableItems = sortByItemOrder((user?.workItems || []).filter(item => !CLOCK_OUT_HIDDEN.has(item) && !isDeletedWorkItem(item)))
  const canEdit = editableItems.length > 0 && user?.employeeType !== 'salaried' && !tooOld
  const dowLabel = DOW_LABELS[new Date(year, month, day).getDay()]
  const isMulti = sessions.length > 1

  const [editingSessionIdx, setEditingSessionIdx] = useState(null)
  const [saving, setSaving] = useState(false)
  // last week's same weekday / same shift for the shift being edited (null offline or none)
  const [lastWeek, setLastWeek] = useState(null)
  function startEdit(idx) {
    setLastWeek(null)
    setEditingSessionIdx(idx)
    getLastWeekWork(user.id, dateStr, idx + 1).then(r => setLastWeek(r))
  }

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
  const sessionLabel = `${month + 1}月${day}日（${dowLabel}）の業務を入力`

  return (
    <div className={styles.modalOverlay} onClick={editingSessionIdx === null ? onClose : undefined}>
      <div className={[styles.modal, editingSessionIdx !== null ? styles.modalEditing : ''].join(' ')} onClick={e => e.stopPropagation()}>
        {editingSessionIdx !== null ? (
          <WorkEditMode
            sessionLabel={sessionLabel}
            editableItems={editableItems}
            initialWork={editingWork}
            lastWeek={lastWeek}
            onCancel={() => setEditingSessionIdx(null)}
            onSave={handleSave}
            saving={saving}
          />
        ) : (
          <>
            <div className={styles.modalHeader}>
              <span className={styles.modalDate}>{month + 1}月{day}日（{dowLabel}）{isMulti && <span className={styles.modalSessionCount}> {sessions.length}回</span>}</span>
              <button className={styles.modalCloseBtn} onClick={onClose}>✕</button>
            </div>

            <div className={styles.modalBody}>
              {copy && <CopySection copy={copy} onDelete={onDeleteCopy} />}
              {sessions.map((session, idx) => {
                const workData = session.sessionId ? (sessionWorkItems[session.sessionId] || null) : null
                const workEntries = workData ? sortByItemOrder(Object.keys(workData)).map(t => [t, workData[t]]).filter(([, m]) => m > 0) : []
                const hasWork = workEntries.length > 0
                const hasIn = !!session.in
                const isActive = hasIn && !session.out
                const canEditSession = canEdit && hasIn && !!session.sessionId
                const totalWorkMins = workEntries.reduce((s, [, m]) => s + m, 0)

                return (
                  <div key={idx} className={isMulti ? styles.sessionCard : styles.sessionSingle}>

                    <div className={styles.punchLine}>
                      <span className={styles.punchLabel}>打刻</span>
                      <span className={styles.punchTimes}>
                        {session.in || '—'}
                        {' → '}
                        {session.out
                          ? session.out
                          : <span className={styles.punchActive}>勤務中</span>
                        }
                      </span>
                      {isActive
                        ? <span className={styles.statusBadgeActive}>{(session.breaks || []).some(b => b.start && !b.end) ? '休憩中' : '勤務中'}</span>
                        : session.out
                          ? <span className={styles.statusBadgeDone}>退勤済</span>
                          : null
                      }
                    </div>

                    {(session.breaks || []).map((b, bi) => (
                      <div key={bi} className={styles.punchLine}>
                        <span className={styles.punchLabel}>休憩</span>
                        <span className={styles.punchTimes}>{b.start || '—'} 〜 {b.end || <span className={styles.punchActive}>休憩中</span>}</span>
                      </div>
                    ))}

                    <div className={styles.workSection}>
                      <div className={styles.workSectionHeader}>
                        <span className={styles.workLabel}>業務</span>
                        {hasWork
                          ? <span className={styles.workBadgeEntered}>入力済み</span>
                          : <span className={styles.workBadgeEmpty}>未入力</span>
                        }
                      </div>

                      {hasWork && (
                        <>
                          <div className={styles.workEntries}>
                            {workEntries.map(([type, mins]) => (
                              <div key={type} className={styles.workEntry}>
                                <span className={styles.workEntryType}>{itemLabel(type)}</span>
                                <span className={styles.workEntryTime}>{fmtMins(mins)}</span>
                              </div>
                            ))}
                          </div>
                          {workEntries.length > 1 && (
                            <div className={styles.workTotal}>
                              <span>今回の合計</span>
                              <span>{fmtMins(totalWorkMins)}</span>
                            </div>
                          )}
                        </>
                      )}

                      {canEditSession ? (
                        <button
                          className={hasWork ? styles.editWorkBtn : styles.inputWorkBtn}
                          onClick={() => startEdit(idx)}
                        >
                          {hasWork ? '業務を編集' : '業務を入力'}
                        </button>
                      ) : !session.sessionId ? (
                        <span className={styles.legacyHint}>旧データ形式（管理者が入力）</span>
                      ) : tooOld && user?.employeeType !== 'salaried' ? (
                        <span className={styles.legacyHint}>先々月より前の業務は管理者に連絡</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── カレンダー画面（メイン） ─── */
export default function EmployeeCalendarScreen({ user, onBack }) {
  useIdleTimeout(onBack) // left open for 2 minutes → back to the start (the next person must not see this month)
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
  const [copies, setCopies] = useState({}) // { dateStr: { slot: items } } from the weekly copy
  const today = localToday()

  const loadLogs = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    const { from, to } = getMonthRange(year, month)
    const isSal = user?.employeeType === 'salaried'
    Promise.all([
      getLogs({ dateFrom: from, dateTo: to, userId: user.id }),
      isSal ? Promise.resolve(null) : getSessionWorkReportsForUser(user.id),
      isSal ? Promise.resolve({}) : getWeeklyCopies(user.id, from > today ? from : today, to).catch(() => ({})),
      loadWorkItemDefs(), // latest item names
    ]).then(([data, workData, copyData]) => {
      setLogs(data)
      setCopies(copyData || {})
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
  const isNextMonth = (year * 12 + month) === (now.getFullYear() * 12 + now.getMonth() + 1)

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (isNextMonth) return
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
        <button onClick={nextMonth} className={styles.navBtn} disabled={isNextMonth}>▶</button>
      </div>

      {loading ? (
        <div className={styles.loading}>読み込み中</div>
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
            const multiSession = sessions.length > 1
            const dow = new Date(year, month, d).getDay()
            const isSalaried = user?.employeeType === 'salaried'
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const sessionIds = sessions.map(s => s.sessionId).filter(Boolean)
            const copy = !isSalaried && dateStr >= today ? copies[dateStr] : null
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
                className={[styles.cell, inTime ? styles.worked : '', copy && !worked ? styles.planned : '', dow === 0 ? styles.sun : dow === 6 ? styles.sat : ''].join(' ')}
                onClick={() => (worked || copy) && setSelectedDay(d)}
              >
                <div className={styles.dayNum}>{d}</div>
                {multiSession && (
                  <div className={styles.multiCountBadge}>{sessions.length}回勤務</div>
                )}
                {multiSession ? (
                  <div className={styles.multiSessionRows}>
                    {sessions.slice(0, 2).map((s, si) => (
                      <div key={si} className={styles.multiSessionRow}>
                        <span>{s.in || '—'}</span>
                        <span className={styles.multiArrow}>→</span>
                        <span>{s.out || <span className={styles.activeInline}>中</span>}</span>
                      </div>
                    ))}
                    {sessions.length > 2 && <div className={styles.multiMore}>ほか{sessions.length - 2}件</div>}
                  </div>
                ) : (
                  <>
                    {inTime && <div className={styles.inTime}>出 {inTime}</div>}
                    {inTime && outTime && <div className={styles.timeSpacer} />}
                    {outTime && <div className={styles.outTime}>退 {outTime}</div>}
                  </>
                )}
                {workBadgeLabel && <div className={workBadgeClass}>{workBadgeLabel}</div>}
                {copy && !worked && <div className={styles.calCopyBadge}>業務予定あり</div>}
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
          copy={(() => { const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`; return user?.employeeType !== 'salaried' && ds >= today ? copies[ds] : null })()}
          onDeleteCopy={async () => {
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
            await deleteWeeklyCopy(user.id, ds)
            setCopies(prev => { const n = { ...prev }; delete n[ds]; return n })
            if (!(dayMap[selectedDay] || []).length) setSelectedDay(null)
          }}
          onClose={() => setSelectedDay(null)}
          onWorkSaved={handleWorkSaved}
        />
      )}
    </div>
  )
}
