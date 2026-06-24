import React, { useState, useEffect } from 'react'
import { getTodayStatuses, getUsers } from '../lib/db'
import styles from './ModeSelectScreen.module.css'

// 名東区上社 の座標
const LAT = 35.174
const LON = 137.018

function wmoEmoji(code) {
  if (code === 0)            return '☀️'
  if (code <= 1)             return '🌤️'
  if (code <= 3)             return '⛅'
  if (code <= 48)            return '🌫️'
  if (code <= 67)            return '🌧️'
  if (code <= 77)            return '❄️'
  if (code <= 82)            return '🌧️'
  if (code <= 86)            return '❄️'
  return '⛈️'
}

async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=weathercode&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FTokyo&forecast_days=1`
  const res = await fetch(url)
  const data = await res.json()
  const codes = data.hourly.weathercode
  const amCode = Math.max(...codes.slice(6, 12))
  const pmCode = Math.max(...codes.slice(12, 18))
  const tMax = Math.round(data.daily.temperature_2m_max[0])
  const tMin = Math.round(data.daily.temperature_2m_min[0])
  return { am: wmoEmoji(amCode), pm: wmoEmoji(pmCode), tMax, tMin }
}

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

function Clock({ weather }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const time     = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const year     = now.toLocaleDateString('ja-JP', { year: 'numeric' })
  const monthDay = now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <>
      <div className={styles.headerLeft}>
        <div className={styles.dateBox}>
          <div className={styles.dateYear}>{year}</div>
          <div className={styles.dateMonthDay}>{monthDay}</div>
        </div>
        {weather && (
          <div className={styles.weatherBox}>
            <span className={styles.weatherItem}><span className={styles.weatherLabel}>午前</span>{weather.am}</span>
            <span className={styles.weatherItem}><span className={styles.weatherLabel}>午後</span>{weather.pm}</span>
            <span className={styles.weatherTemp}>
              <span className={styles.weatherTempHigh}>{weather.tMax}°</span>
              <span className={styles.weatherTempSep}>/</span>
              <span className={styles.weatherTempLow}>{weather.tMin}°</span>
            </span>
          </div>
        )}
      </div>
      <div className={styles.clockTime}>{time}</div>
    </>
  )
}

export default function ModeSelectScreen({ onSelect }) {
  const [checkedInCount, setCheckedInCount] = useState(0)
  const [weather, setWeather] = useState(null)

  useEffect(() => {
    async function fetchCount() {
      const [statuses, users] = await Promise.all([getTodayStatuses(), getUsers()])
      setCheckedInCount(users.filter(u => statuses[u.id]).length)
    }
    fetchCount()
    const t = setInterval(fetchCount, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    fetchWeather().then(setWeather).catch(() => {})
  }, [])

  return (
    <div className={styles.screen}>

      {/* ヘッダー */}
      <div className={styles.header}>
        <Clock weather={weather} />
      </div>

      {/* メインエリア */}
      <div className={styles.main}>

        {/* 出勤・退勤ボタン */}
        <div className={styles.mainBtns}>
          <button className={`${styles.modeBtn} ${styles.clockIn}`} onClick={() => onSelect('出勤')}>
            <div className={styles.iconCircle}>
              <ScanIcon size={96} color="#16a34a" />
            </div>
            <span className={styles.modeLabel}>出勤</span>
          </button>
          <button className={`${styles.modeBtn} ${styles.clockOut}`} onClick={() => onSelect('退勤')}>
            <div className={styles.iconCircle}>
              <ScanIcon size={96} color="#dc2626" />
            </div>
            <span className={styles.modeLabel}>退勤</span>
          </button>
        </div>

        {/* 下部ステータスパネル */}
        <div className={styles.bottomPanel}>
          <button className={styles.confirmBtn} onClick={() => onSelect('確認')}>
            <div className={styles.iconCircleSmall}>
              <ScanIcon size={28} color="#555" />
            </div>
            <span className={styles.scanHintText}>勤務確認</span>
          </button>
          <div className={styles.statusPanel}>
            <span className={styles.statusIconLarge}>👥</span>
            <div>
              <div className={styles.statusLabel}>本日の状況</div>
              <div className={styles.statusValue}>出勤中 {checkedInCount}名</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
