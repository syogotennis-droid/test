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

const QRIcon = () => (
  <svg className={styles.qrIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none" />
    <path d="M14 14h3v3h-3z" fill="currentColor" stroke="none" />
    <path d="M17 17h4" /><path d="M21 14v3" />
    <path d="M14 17v4" />
  </svg>
)

export default function ModeSelectScreen({ onSelect }) {
  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <div className={styles.title}>QR 勤怠システム</div>
        <Clock />
      </div>

      <div className={styles.buttons}>
        <button className={`${styles.modeBtn} ${styles.clockIn}`} onClick={() => onSelect('出勤')}>
          <div className={styles.iconWrap}><QRIcon /></div>
          <span className={styles.modeLabel}>出勤</span>
        </button>

        <button className={`${styles.modeBtn} ${styles.clockOut}`} onClick={() => onSelect('退勤')}>
          <div className={styles.iconWrap}><QRIcon /></div>
          <span className={styles.modeLabel}>退勤</span>
        </button>
      </div>
    </div>
  )
}
