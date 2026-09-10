import React, { useEffect, useState } from 'react'
import styles from './CompleteScreen.module.css'

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

export default function CompleteScreen({ logType, workItems, user, clockInTime, onDone }) {
  const [now] = useState(() => new Date())

  useEffect(() => {
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [onDone])

  const isClockIn = logType === '出勤'
  const bgColor = isClockIn ? '#2e7d32' : '#1a73e8'

  const currentTimeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

  const workEntries = !isClockIn && workItems
    ? Object.entries(workItems).filter(([, m]) => m > 0)
    : []
  const workTotalMins = workEntries.reduce((s, [, m]) => s + m, 0)

  return (
    <div className={styles.screen} style={{ background: bgColor }}>
      <div className={styles.checkmark}>✓</div>
      <div className={styles.workIcon}>{isClockIn ? '🟢' : '🔴'}</div>
      <h1>{logType}しました</h1>
      {user && (
        <p className={styles.detail}>{user.name} さん</p>
      )}

      <div className={styles.timeInfo}>
        {!isClockIn && clockInTime && (
          <div className={styles.timeRow}>
            <span className={styles.timeLabel}>出勤時間</span>
            <span className={styles.timeValue}>{clockInTime.substring(0, 5)}</span>
          </div>
        )}
        <div className={styles.timeRow}>
          <span className={styles.timeLabel}>{isClockIn ? '出勤時間' : '退勤時間'}</span>
          <span className={styles.timeValue}>{currentTimeStr}</span>
        </div>
      </div>

      {workEntries.length > 0 && (
        <div className={styles.workSummary}>
          {workEntries.map(([type, mins]) => (
            <div key={type} className={styles.workSummaryRow}>
              <span className={styles.workSummaryType}>{type}</span>
              <span className={styles.workSummaryTime}>{fmtMinutes(mins)}</span>
            </div>
          ))}
          {workEntries.length > 1 && (
            <div className={[styles.workSummaryRow, styles.workSummaryTotal].join(' ')}>
              <span>合計</span>
              <span>{fmtMinutes(workTotalMins)}</span>
            </div>
          )}
        </div>
      )}

      <div className={styles.countdown}>
        <span>まもなく戻ります...</span>
      </div>
    </div>
  )
}
