import React, { useState, useEffect } from 'react'
import { getLogs } from '../lib/db'
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
  logs.forEach(log => {
    const [y, m, d] = log.date.split('-').map(Number)
    if (y !== year || m !== month + 1) return
    if (!map[d]) map[d] = { ins: [], outs: [], workType: '' }
    if (log.log_type === '出勤') map[d].ins.push(log.time || '')
    else if (log.log_type === '退勤') {
      map[d].outs.push(log.time || '')
      if (log.work_type) map[d].workType = log.work_type
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

function DayModal({ day, year, month, entry, onClose }) {
  const inTime = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
  const outTime = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
  const duration = timeDiff(inTime, outTime)
  const workTypes = parseWorkType(entry?.workType || '')

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalDate}>{year}年{month + 1}月{day}日</div>
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
        <button className={styles.modalClose} onClick={onClose}>閉じる</button>
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

  useEffect(() => {
    setLoading(true)
    const { from, to } = getMonthRange(year, month)
    getLogs({ dateFrom: from, dateTo: to, userId: user.id })
      .then(data => { setLogs(data); setLoading(false) })
  }, [year, month, user.id])

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
            const duration = worked && outTime ? timeDiff(inTime, outTime) : ''
            const dow = new Date(year, month, d).getDay()
            return (
              <div
                key={d}
                className={[styles.cell, worked ? styles.worked : '', dow === 0 ? styles.sun : dow === 6 ? styles.sat : ''].join(' ')}
                onClick={() => worked && setSelectedDay(d)}
              >
                <div className={styles.dayNum}>{d}</div>
                {inTime && <div className={styles.inTime}>{inTime}</div>}
{outTime && <div className={styles.outTime}>{outTime}</div>}
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
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}
