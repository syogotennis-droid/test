import React, { useState, useEffect } from 'react'
import styles from './ModeSelectScreen.module.css'

function ScanIcon({ size = 48, color = '#333' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 19V6h13" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 29v13h13" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M42 19V6H29" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M42 29v13H29" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="14" y="14" width="6" height="6" rx="1" fill={color}/>
      <rect x="28" y="14" width="6" height="6" rx="1" fill={color}/>
      <rect x="14" y="28" width="6" height="6" rx="1" fill={color}/>
      <rect x="21" y="21" width="6" height="6" rx="1" fill={color}/>
      <rect x="28" y="28" width="6" height="6" rx="1" fill={color}/>
    </svg>
  )
}

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
      <div className={styles.topBar}>
        <Clock />
      </div>

      <div className={styles.mainBtns}>
        <button className={`${styles.modeBtn} ${styles.clockIn}`} onClick={() => onSelect('出勤')}>
          <div className={styles.iconCircle}>
            <ScanIcon size={54} color="#2e7d32" />
          </div>
          <span className={styles.modeLabel}>出勤</span>
        </button>

        <button className={`${styles.modeBtn} ${styles.clockOut}`} onClick={() => onSelect('退勤')}>
          <div className={styles.iconCircle}>
            <ScanIcon size={54} color="#c62828" />
          </div>
          <span className={styles.modeLabel}>退勤</span>
        </button>
      </div>

      <div className={styles.bottomBar}>
        <button className={styles.checkBtn} onClick={() => onSelect('確認')}>
          <ScanIcon size={30} color="#555" />
          <span className={styles.checkLabel}>確認</span>
        </button>
      </div>
    </div>
  )
}
