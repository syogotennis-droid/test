import React, { useEffect } from 'react'
import styles from './CompleteScreen.module.css'

export default function CompleteScreen({ logType, workTypes, user, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2500)
    return () => clearTimeout(timer)
  }, [onDone])

  const isClockIn = logType === '出勤'
  const bgColor = isClockIn ? '#2e7d32' : '#1a73e8'

  return (
    <div className={styles.screen} style={{ background: bgColor }}>
      <div className={styles.checkmark}>✓</div>
      <div className={styles.workIcon}>{isClockIn ? '🟢' : '🔴'}</div>
      <h1>{logType}しました</h1>
      {user && (
        <p className={styles.detail}>{user.name} さん</p>
      )}
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
