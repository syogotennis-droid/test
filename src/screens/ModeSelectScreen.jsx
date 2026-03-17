import React from 'react'
import styles from './ModeSelectScreen.module.css'

export default function ModeSelectScreen({ onSelect }) {
  return (
    <div className={styles.screen}>
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
