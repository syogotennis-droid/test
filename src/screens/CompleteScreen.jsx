import React, { useEffect } from 'react'
import styles from './CompleteScreen.module.css'

const WORK_COLOR = {
  '事務': 'var(--color-office)',
  '清掃': 'var(--color-cleaning)',
  '現場': 'var(--color-field)'
}

const WORK_ICON = {
  '事務': '💼',
  '清掃': '🧹',
  '現場': '🏗️'
}

export default function CompleteScreen({ workType, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2000)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div
      className={styles.screen}
      style={{ background: WORK_COLOR[workType] || 'var(--color-success)' }}
    >
      <div className={styles.checkmark}>✓</div>
      <div className={styles.workIcon}>{WORK_ICON[workType]}</div>
      <h1>記録しました</h1>
      <p className={styles.detail}>
        {workType} の記録が完了しました
      </p>
      <div className={styles.countdown}>
        <span>まもなく戻ります...</span>
      </div>
    </div>
  )
}
