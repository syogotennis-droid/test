import React, { useState, useEffect } from 'react'
import styles from './ModeSelectScreen.module.css'

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  return (
    <div className={styles.clock}>
      <div className={styles.clockTime}>{time}</div>
      <div className={styles.clockDate}>{date}</div>
    </div>
  )
}

export default function ModeSelectScreen({ onSelect }) {
  return (
    <div className={styles.screen}>
      <Clock />
      <div className={styles.header}>
        <div className={styles.icon}>📋</div>
        <h1>勤怠登録</h1>
        <p>出勤・退勤を選択してください</p>
      </div>

      <div className={styles.buttons}>
        <button
          className={`${styles.modeBtn} ${styles.clockIn}`}
          onClick={() => onSelect('出勤')}
        >
          <span className={styles.modeIcon}>🟢</span>
          <span className={styles.modeLabel}>出勤</span>
        </button>

        <button
          className={`${styles.modeBtn} ${styles.clockOut}`}
          onClick={() => onSelect('退勤')}
        >
          <span className={styles.modeIcon}>🔴</span>
          <span className={styles.modeLabel}>退勤</span>
        </button>
      </div>
    </div>
  )
}
