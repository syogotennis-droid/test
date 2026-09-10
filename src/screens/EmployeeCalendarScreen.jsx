import React, { useState, useEffect, useCallback } from 'react'
import { getLogs, saveSessionWorkReport, getSessionWorkReportsForDate, getSessionWorkStatusForUserRange, CLOCK_OUT_HIDDEN } from '../lib/db'
import styles from './EmployeeCalendarScreen.module.css'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

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
    const daySessionMap = byDaySession[d] || {}
    Object.entries(daySessionMap).forEach(([sid, s]) => {
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

/* ─── 保存確認モーダル ─── */
function ConfirmSaveModal({ year, month, day, totalInputMinutes, editableItems, inputs, saving, onBack, onSave }) {
  const enteredItems = editableItems
    .map(item => {
      const v = inputs[item]
      const mins = v ? (v.h ?? 0) * 60 + (v.m ?? 0) : 0
      return { name: item, mins }
    })
    .filter(e => e.mins > 0)

  return (
    <div className={styles.confirmOverlay}>
      <div className={styles.confirmModal}>
        <div className={styles.confirmHeader}>
          <span className={styles.confirmTitle}>入力内容を確認</span>
          <span className={styles.confirmDate}>{year}年{month + 1}月{day}日</span>
        </div>

        <div className={styles.confirmBreakdown}>
          {enteredItems.length === 0 ? (
            <div className={styles.confirmEmpty}>入力された業務はありません</div>
          ) : (
            enteredItems.map(e => (
              <div key={e.name} className={styles.confirmItem}>
                <span className={styles.confirmItemName}>{e.name}</span>
                <span className={styles.confirmItemTime}>{fmtMins(e.mins)}</span>
              </div>
            ))
          )}
        </div>

        <div className={styles.confirmTotal}>
          <span>合計</span>
          <span>{fmtMins(totalInputMinutes) || '0分'}</span>
        </div>

        <div className={styles.confirmActions}>
          <button className={styles.confirmBackBtn} onClick={onBack} disabled={saving}>
            入力画面に戻る
          </button>
          <button className={styles.confirmSaveBtn} onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : 'この内容で保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── 日別詳細モーダル ─── */
function DayModal({ day, year, month, sessions, user, onClose, onSaved }) {
  const editableItems = (user?.workItems || []).filter(item => !CLOCK_OUT_HIDDEN.has(item))
  const canEdit = editableItems.length > 0 && user?.employeeType !== 'salaried'
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const [sessionWorkReports, setSessionWorkReports] = useState({})
  const [loadingWork, setLoadingWork] = useState(true)
  const [editingSessionIdx, setEditingSessionIdx] = useState(null)
  const [inputs, setInputs] = useState({})
  const [selectedItem, setSelectedItem] = useState(null)
  const [numpadField, setNumpadField] = useState('h')
  const [saving, setSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    setLoadingWork(true)
    getSessionWorkReportsForDate(user.id, dateStr)
      .then(reports => { setSessionWorkReports(reports); setLoadingWork(false) })
      .catch(() => setLoadingWork(false))
  }, [user.id, dateStr])

  function startEditing(sessionIdx) {
    const session = sessions[sessionIdx]
    const existingWork = session?.sessionId ? (sessionWorkReports[session.sessionId] || {}) : {}
    const initial = {}
    editableItems.forEach(item => {
      const mins = existingWork[item] || 0
      initial[item] = { h: Math.floor(mins / 60), m: mins % 60 }
    })
    setInputs(initial)
    setSelectedItem(editableItems[0] || null)
    setNumpadField('h')
    setEditingSessionIdx(sessionIdx)
  }

  const getHM = item => inputs[item] || { h: 0, m: 0 }
  const currentH = selectedItem ? (getHM(selectedItem).h ?? 0) : 0
  const currentM = selectedItem ? (getHM(selectedItem).m ?? 0) : 0

  const totalInputMinutes = editableItems.reduce(
    (s, item) => { const v = getHM(item); return s + (v.h ?? 0) * 60 + (v.m ?? 0) }, 0
  )

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

  function handleSave() { setShowConfirm(true) }

  async function handleDoSave() {
    const session = sessions[editingSessionIdx]
    if (!session?.sessionId) {
      alert('セッションIDがないため保存できません')
      return
    }
    setSaving(true)
    const workItems = {}
    editableItems.forEach(item => {
      const v = getHM(item)
      const mins = (v.h ?? 0) * 60 + (v.m ?? 0)
      if (mins > 0) workItems[item] = mins
    })
    try {
      await saveSessionWorkReport(user.id, dateStr, session.sessionId, workItems)
      setSessionWorkReports(prev => ({ ...prev, [session.sessionId]: workItems }))
      setShowConfirm(false)
      setEditingSessionIdx(null)
      onSaved()
    } catch (e) {
      alert('保存に失敗しました: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const isEditing = editingSessionIdx !== null

  return (
    <>
      <div className={styles.modalOverlay} onClick={isEditing ? undefined : onClose}>
        <div
          className={[styles.modal, isEditing ? styles.modalEditing : ''].join(' ')}
          onClick={e => e.stopPropagation()}
        >
          {!isEditing ? (
            <>
              <div className={styles.modalDate}>{year}年{month + 1}月{day}日</div>
              {loadingWork ? (
                <div className={styles.modalLoadingText}>読込中...</div>
              ) : (
                sessions.map((session, idx) => {
                  const workItems = session.sessionId ? (sessionWorkReports[session.sessionId] || null) : null
                  const workEntries = workItems ? Object.entries(workItems).filter(([, m]) => m > 0) : []
                  return (
                    <div key={idx} className={styles.sessionCard}>
                      <div className={styles.sessionCardHeader}>
                        <span className={styles.sessionCardNum}>{idx + 1}回目</span>
                        <span className={styles.sessionCardTime}>
                          {session.in || '—'}{' → '}
                          {session.out
                            ? session.out
                            : <span className={styles.sessionCardActive}>勤務中</span>
                          }
                        </span>
                      </div>
                      {workEntries.length > 0 ? (
                        workEntries.map(([type, mins]) => (
                          <div key={type} className={styles.sessionWorkRow}>
                            <span className={styles.sessionWorkType}>{type}</span>
                            <span className={styles.sessionWorkTime}>{fmtMins(mins)}</span>
                          </div>
                        ))
                      ) : (
                        <div className={styles.sessionNoWork}>業務未入力</div>
                      )}
                      {canEdit && session.sessionId && (
                        <button className={styles.editWorkBtn} onClick={() => startEditing(idx)}>
                          {workEntries.length > 0 ? '業務内訳を修正' : '業務内訳を入力'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
              <button className={styles.modalClose} onClick={onClose}>閉じる</button>
            </>
          ) : (
            <>
              {/* ── ヘッダー ── */}
              <div className={styles.editHeader}>
                <div className={styles.editHeaderDate}>
                  {year}年{month + 1}月{day}日 — {editingSessionIdx + 1}回目
                </div>
                <div className={styles.editHeaderStats}>
                  <span className={styles.editStatItem}>
                    <span className={styles.editStatLabel}>入力済み</span>
                    <span className={styles.editStatValue}>
                      {totalInputMinutes > 0 ? fmtMins(totalInputMinutes) : '0分'}
                    </span>
                  </span>
                </div>
              </div>

              {/* ── ボディ（左右2カラム） ── */}
              <div className={styles.editBody}>

                {/* 左：業務選択 */}
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
                          <span className={styles.editItemName}>{item}</span>
                          {v > 0 && <span className={styles.editItemTime}>{fmtMins(v)}</span>}
                        </button>
                      )
                    })}
                  </div>
                  <button className={styles.editSaveFinalBtn} onClick={handleSave} disabled={saving}>
                    保存する
                  </button>
                </div>

                {/* 右：入力エリア */}
                <div className={styles.editRightCol}>
                  <div className={styles.editInputTitle}>
                    {selectedItem ? `${selectedItem}の時間を入力` : '業務を選択してください'}
                  </div>

                  {/* 時間：分 入力ボックス */}
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

                  <div className={styles.editRightActions}>
                    <button className={styles.editCancelBtn} onClick={() => setEditingSessionIdx(null)}>
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {isEditing && showConfirm && (
        <ConfirmSaveModal
          year={year}
          month={month}
          day={day}
          totalInputMinutes={totalInputMinutes}
          editableItems={editableItems}
          inputs={inputs}
          saving={saving}
          onBack={() => setShowConfirm(false)}
          onSave={handleDoSave}
        />
      )}
    </>
  )
}

export default function EmployeeCalendarScreen({ user, onBack }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(null)
  const [sessionWorkStatus, setSessionWorkStatus] = useState({})

  const loadLogs = useCallback(() => {
    setLoading(true)
    const { from, to } = getMonthRange(year, month)
    const isSal = user?.employeeType === 'salaried'
    Promise.all([
      getLogs({ dateFrom: from, dateTo: to, userId: user.id }),
      isSal ? Promise.resolve({}) : getSessionWorkStatusForUserRange(user.id, from, to)
    ]).then(([data, workStatus]) => {
      setLogs(data)
      setSessionWorkStatus(workStatus)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [year, month, user.id, user?.employeeType])

  useEffect(() => { loadLogs() }, [loadLogs])

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
      ) : (
        <div className={styles.calGrid}>
          {DAY_LABELS.map((d, i) => (
            <div
              key={d}
              className={[styles.dayLabel, i === 0 ? styles.sun : i === 6 ? styles.sat : ''].join(' ')}
            >{d}</div>
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
                } else if (workedSessions?.size > 0) {
                  workBadgeLabel = '業務入力済'; workBadgeClass = styles.calWorkBadgeTeal
                } else {
                  workBadgeLabel = '業務未入力'; workBadgeClass = styles.calWorkBadgeOrange
                }
              }
            }

            return (
              <div
                key={d}
                className={[
                  styles.cell,
                  inTime ? styles.worked : '',
                  dow === 0 ? styles.sun : dow === 6 ? styles.sat : ''
                ].join(' ')}
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
          onClose={() => setSelectedDay(null)}
          onSaved={() => { loadLogs(); setSelectedDay(null) }}
        />
      )}
    </div>
  )
}
