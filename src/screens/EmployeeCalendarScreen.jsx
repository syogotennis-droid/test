import React, { useState, useEffect, useCallback } from 'react'
import { getLogs, updateLogWorkItems, CLOCK_OUT_HIDDEN } from '../lib/db'
import styles from './EmployeeCalendarScreen.module.css'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

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
  // logs are sorted desc by timestamp, so first encountered per day = latest
  logs.forEach(log => {
    const [y, m, d] = log.date.split('-').map(Number)
    if (y !== year || m !== month + 1) return
    if (!map[d]) map[d] = { ins: [], outs: [], workType: '', outLog: null }
    if (log.log_type === '出勤') map[d].ins.push(log.time || '')
    else if (log.log_type === '退勤') {
      map[d].outs.push(log.time || '')
      if (log.work_type) map[d].workType = log.work_type
      if (!map[d].outLog) map[d].outLog = log
    }
  })
  return map
}

function timeDiff(t1, t2) {
  if (!t1 || !t2) return ''
  const [h1, m1] = t1.split(':').map(Number)
  const [h2, m2] = t2.split(':').map(Number)
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (diff <= 0) return ''
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`
}

function timeDiffMins(t1, t2) {
  if (!t1 || !t2) return null
  const [h1, m1] = t1.split(':').map(Number)
  const [h2, m2] = t2.split(':').map(Number)
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
  return diff > 0 ? diff : null
}

function fmtMinsDisplay(mins) {
  if (!mins) return '0分'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h}時間${m}分`
  if (h > 0) return `${h}時間`
  return `${m}分`
}

const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

function fmtMins(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`
}

function parseWorkType(wt) {
  if (!wt) return []
  return wt.split(',').map(entry => {
    const [type, minsStr] = entry.split(':')
    return { type: type.trim(), mins: minsStr !== undefined ? Number(minsStr) : null }
  }).filter(e => e.type)
}

function DayModal({ day, year, month, entry, user, onClose, onSaved }) {
  const inTime = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
  const outTime = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
  const duration = timeDiff(inTime, outTime)
  const workTypes = parseWorkType(entry?.workType || '')

  const editableItems = (user?.workItems || []).filter(item => !CLOCK_OUT_HIDDEN.has(item))
  const canEdit = editableItems.length > 0 && entry?.outLog && user?.employeeType !== 'salaried'

  const [editing, setEditing] = useState(false)
  const [inputs, setInputs] = useState({})
  const [selectedItem, setSelectedItem] = useState(null)
  const [saving, setSaving] = useState(false)

  const workingMinutes = timeDiffMins(inTime, outTime)

  useEffect(() => {
    if (!editing) return
    const initial = {}
    parseWorkType(entry?.workType || '').forEach(({ type, mins }) => {
      if (mins) initial[type] = String(mins)
    })
    setInputs(initial)
    setSelectedItem(editableItems[0] || null)
  }, [editing])

  const currentValue = parseInt(inputs[selectedItem] || '0') || 0
  const otherMins = editableItems
    .filter(i => i !== selectedItem)
    .reduce((s, i) => s + (parseInt(inputs[i] || '0') || 0), 0)
  const maxMins = workingMinutes != null ? workingMinutes - otherMins : null
  const isOver = maxMins !== null && currentValue > maxMins

  function pressKey(k) {
    if (!selectedItem) return
    setInputs(prev => {
      const cur = prev[selectedItem] || ''
      if (k === '⌫') return { ...prev, [selectedItem]: cur.slice(0, -1) }
      if (k === 'C') return { ...prev, [selectedItem]: '' }
      const next = cur + k
      if (parseInt(next) > 9999) return prev
      return { ...prev, [selectedItem]: next }
    })
  }

  function setQuick(v) {
    if (!selectedItem) return
    setInputs(prev => ({ ...prev, [selectedItem]: String(v) }))
  }

  async function handleSave() {
    setSaving(true)
    const workItems = {}
    editableItems.forEach(item => {
      const v = parseInt(inputs[item] || '0')
      if (v > 0) workItems[item] = v
    })
    try {
      await updateLogWorkItems(entry.outLog.id, workItems)
      setEditing(false)
      onSaved()
    } catch(e) {
      alert('保存に失敗しました: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={editing ? undefined : onClose}>
      <div className={[styles.modal, editing ? styles.modalEditing : ''].join(' ')} onClick={e => e.stopPropagation()}>
        <div className={styles.modalDate}>{year}年{month + 1}月{day}日</div>

        {!editing ? (
          <>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>出勤</span>
              <span className={styles.modalRowValue} style={{ color: '#2e7d32' }}>{inTime || '—'}</span>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>退勤</span>
              <span className={styles.modalRowValue} style={{ color: '#c62828' }}>{outTime || '—'}</span>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalRowLabel}>勤務時間</span>
              <span className={styles.modalRowValue}>{duration || '—'}</span>
            </div>
            {workTypes.length > 0 && (
              <>
                <div className={styles.modalDivider} />
                {workTypes.map(({ type, mins }) => (
                  <div key={type} className={styles.modalRow}>
                    <span className={styles.modalRowLabel}>{type}</span>
                    <span className={styles.modalRowValue}>{mins !== null ? fmtMins(mins) : '—'}</span>
                  </div>
                ))}
              </>
            )}
            {canEdit && (
              <button className={styles.editWorkBtn} onClick={() => setEditing(true)}>
                {workTypes.length > 0 ? '業務内訳を修正' : '業務内訳を入力'}
              </button>
            )}
            <button className={styles.modalClose} onClick={onClose}>閉じる</button>
          </>
        ) : (
          <>
            <div className={styles.editSplit}>
              {/* 左列：業務アイテム選択 */}
              <div className={styles.editItemList}>
                {editableItems.map(item => {
                  const v = parseInt(inputs[item] || '0') || 0
                  const isSel = selectedItem === item
                  return (
                    <button
                      key={item}
                      className={[
                        styles.editItemBtn,
                        isSel ? styles.editItemBtnSelected : v > 0 ? styles.editItemBtnEntered : ''
                      ].join(' ')}
                      onClick={() => setSelectedItem(item)}
                    >
                      <span className={styles.editItemName}>{item}</span>
                      {v > 0 && <span className={styles.editItemTime}>{fmtMins(v)}</span>}
                    </button>
                  )
                })}
              </div>

              {/* 右列：入力エリア */}
              <div className={styles.editInputArea}>
                <div className={styles.editSelectedTitle}>
                  {selectedItem ? `${selectedItem}` : '業務を選択'}
                </div>

                {workingMinutes != null && selectedItem && (
                  <div className={styles.editRemainingRow}>
                    <span className={styles.editRemainingLabel}>残り</span>
                    <span className={[styles.editRemainingValue, maxMins <= 0 ? styles.editRemainingDone : ''].join(' ')}>
                      {maxMins > 0 ? fmtMins(maxMins) : maxMins === 0 ? '完了' : `${-maxMins}分超過`}
                    </span>
                  </div>
                )}

                {selectedItem && (
                  <>
                    <div className={styles.minsDisplay}>
                      <div className={styles.minsDisplayPrimary}>{fmtMinsDisplay(currentValue)}</div>
                      {currentValue > 0 && <div className={styles.minsDisplaySecondary}>{currentValue}分</div>}
                    </div>
                    <div className={styles.quickBtns}>
                      <button className={styles.quickBtn} onClick={() => setQuick(30)}>30分</button>
                      <button className={styles.quickBtn} onClick={() => setQuick(60)}>1時間</button>
                      <button
                        className={[styles.quickBtn, styles.quickBtnAll, !maxMins || maxMins <= 0 ? styles.quickBtnDisabled : ''].join(' ')}
                        disabled={!maxMins || maxMins <= 0}
                        onClick={() => maxMins > 0 && setQuick(maxMins)}
                      >残り全て</button>
                    </div>
                    <div className={styles.timeNumGrid}>
                      {NUM_KEYS.map((k, i) => (
                        <button
                          key={i}
                          className={[styles.timeNumKey, k === '⌫' ? styles.timeNumDel : '', k === 'C' ? styles.timeNumClear : ''].join(' ')}
                          onClick={() => pressKey(k)}
                        >{k}</button>
                      ))}
                    </div>
                    {isOver && (
                      <div className={styles.minsError}>残り時間を{currentValue - maxMins}分超えています</div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className={styles.workEditActions}>
              <button className={styles.modalClose} onClick={() => setEditing(false)}>キャンセル</button>
              <button className={styles.editWorkSaveBtn} onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function EmployeeCalendarScreen({ user, onBack }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(null)

  const loadLogs = useCallback(() => {
    setLoading(true)
    const { from, to } = getMonthRange(year, month)
    getLogs({ dateFrom: from, dateTo: to, userId: user.id })
      .then(data => { setLogs(data); setLoading(false) })
  }, [year, month, user.id])

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
            <div key={d} className={[styles.dayLabel, i === 0 ? styles.sun : i === 6 ? styles.sat : ''].join(' ')}>{d}</div>
          ))}
          {days.map((d, i) => {
            if (!d) return <div key={`pad-${i}`} className={styles.emptyCell} />
            const entry = dayMap[d]
            const inTime = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
            const outTime = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
            const worked = !!inTime
            const dow = new Date(year, month, d).getDay()
            const hasNoWorkType = entry?.outLog && !entry.workType && user?.employeeType !== 'salaried' && (user?.workItems || []).filter(i => !CLOCK_OUT_HIDDEN.has(i)).length > 0
            return (
              <div
                key={d}
                className={[styles.cell, hasNoWorkType ? styles.noWork : worked ? styles.worked : '', dow === 0 ? styles.sun : dow === 6 ? styles.sat : ''].join(' ')}
                onClick={() => worked && setSelectedDay(d)}
              >
                <div className={styles.dayNum}>{d}</div>
                {inTime && <div className={styles.inTime}>出 {inTime}</div>}
                {inTime && outTime && <div className={styles.timeSpacer} />}
                {outTime && <div className={styles.outTime}>退 {outTime}</div>}
                {hasNoWorkType && <div className={styles.noWorkBadge}>未入力</div>}
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
          entry={dayMap[selectedDay]}
          user={user}
          onClose={() => setSelectedDay(null)}
          onSaved={() => { loadLogs(); setSelectedDay(null) }}
        />
      )}
    </div>
  )
}
