import React, { useEffect, useState } from 'react'
import styles from './CompleteScreen.module.css'

export default function CompleteScreen({ logType, workTypes, user, clockInTime, clockInTimestamp, onDone }) {
  const [now] = useState(() => new Date())

  useEffect(() => {
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [onDone])

  const isClockIn = logType === '出勤'
  const bgColor = isClockIn ? '#2e7d32' : '#1a73e8'

  const currentTimeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

  let workingHours = null
  if (!isClockIn && clockInTimestamp) {
    const diffMs = now - new Date(clockInTimestamp)
    const diffMins = Math.floor(diffMs / 60000)
    const h = Math.floor(diffMins / 60)
    const m = diffMins % 60
    workingHours = h > 0 ? `${h}時間${m}分` : `${m}分`
  }

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
        {workingHours && (
          <div className={[styles.timeRow, styles.totalRow].join(' ')}>
            <span className={styles.timeLabel}>本日の勤務時間</span>
            <span className={styles.timeValueBig}>{workingHours}</span>
          </div>
        )}
      </div>

      {!isClockIn && workTypes && workTypes.length > 0 && (
        <p className={styles.detail}>
          {workTypes.join(' / ')}
        </p>
      )}
      <div className={styles.countdown}>
        <span>まもなく戻ります...</span>
      </div>
    </div>
  )
}
