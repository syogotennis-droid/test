import React, { useState, useEffect, useRef } from 'react'
import { getClockInTime } from '../lib/db'
import styles from './WorkSelectScreen.module.css'

const WORK_TYPES = [
  { id: '現場', label: '現場', icon: '🤸', circleColor: '#fff0dc', barColor: '#f0952a' },
  { id: '事務', label: '事務', icon: '📋', circleColor: '#eef1f5', barColor: '#9baab8' },
  { id: '清掃', label: '清掃', icon: '🧹', circleColor: '#dbeeff', barColor: '#5aadea' },
  { id: '休憩', label: '休憩', icon: '☕', circleColor: '#f0e8f8', barColor: '#c090d8' },
]

function ScanIcon({ size = 48, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
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

function ClockIcon({ size = 34, color = '#34a36f' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2"/>
      <path d="M12 6v6l4 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ExitIcon({ size = 54, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="16 17 21 12 16 7" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="21" y1="12" x2="9" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
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
    <>
      <div className={styles.clockTime}>{time}</div>
      <div className={styles.clockDate}>{date}</div>
    </>
  )
}

function fmtMinutes(mins) {
  if (mins == null || isNaN(mins)) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function NumberPicker({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={styles.pickerBtn} onClick={() => setOpen(true)}>
        {String(value).padStart(2, '0')}
      </button>
      {open && (
        <div className={styles.pickerOverlay} onClick={() => setOpen(false)}>
          <div className={styles.pickerSheet} onClick={e => e.stopPropagation()}>
            <div className={styles.pickerHeader}>{label}を選択</div>
            <div className={styles.pickerGrid}>
              {options.map(n => (
                <button
                  key={n}
                  className={[styles.pickerItem, n === value ? styles.pickerActive : ''].join(' ')}
                  onClick={() => { onChange(n); setOpen(false) }}
                >
                  {String(n).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function WorkSelectScreen({ user, onComplete, onCancel }) {
  const [workTimes, setWorkTimes] = useState({})
  const [saving, setSaving] = useState(false)
  const [workingMinutes, setWorkingMinutes] = useState(null)
  const [timeError, setTimeError] = useState('')
  const [editingType, setEditingType] = useState(null)
  const clockOutRef = useRef(new Date())

  useEffect(() => {
    getClockInTime(user.id).then(log => {
      if (log) {
        const diff = Math.round((clockOutRef.current - new Date(log.timestamp)) / 60000)
        setWorkingMinutes(Math.max(0, diff))
      }
    })
  }, [user.id])

  function isActive(id) {
    const t = workTimes[id]
    return t && (t.h > 0 || t.m > 0)
  }

  function handleCardTap(id) {
    setTimeError('')
    if (!workTimes[id]) setWorkTimes(prev => ({ ...prev, [id]: { h: 0, m: 0 } }))
    setEditingType(id)
  }

  function handleClear(id, e) {
    e.stopPropagation()
    setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
    setTimeError('')
  }

  function setTime(id, field, val) {
    setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  const activeTypes = WORK_TYPES.filter(t => isActive(t.id))

  const totalInputMinutes = activeTypes.reduce((sum, type) => {
    const t = workTimes[type.id] || { h: 0, m: 0 }
    return sum + t.h * 60 + t.m
  }, 0)

  const displayH = workingMinutes != null ? Math.floor(workingMinutes / 60) : 0
  const displayM = workingMinutes != null ? workingMinutes % 60 : 0

  async function handleConfirm() {
    if (activeTypes.length === 0 || saving) return
    if (workingMinutes !== null && totalInputMinutes !== workingMinutes) {
      setTimeError(`合計が勤務時間と一致しません（勤務時間: ${fmtMinutes(workingMinutes)}）`)
      return
    }
    setSaving(true)
    try {
      const workTypeStr = activeTypes
        .map(type => {
          const t = workTimes[type.id] || { h: 0, m: 0 }
          return `${type.id}:${t.h * 60 + t.m}`
        })
        .join(',')
      await onComplete(activeTypes.map(t => t.id), workTypeStr)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  const hourOptions = Array.from({ length: 24 }, (_, i) => i)
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

  return (
    <div className={styles.screen}>

      {/* ヘッダー */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onCancel}>←</button>
          <div className={styles.headerIconBox}>
            <ScanIcon size={30} color="#41b883" />
          </div>
          <span className={styles.headerTitle}>QR勤怠システム</span>
        </div>
        <div className={styles.clockBox}>
          <Clock />
        </div>
      </div>

      {/* メイン */}
      <div className={styles.main}>

        <div className={styles.greeting}>おつかれさまです</div>

        <div className={styles.sectionTitle}>
          <span>作業内容を選択</span>
        </div>

        {/* 作業カード */}
        <div className={styles.workGrid}>
          {WORK_TYPES.map(type => {
            const active = isActive(type.id)
            const t = workTimes[type.id] || { h: 0, m: 0 }
            return (
              <div
                key={type.id}
                className={[styles.workCard, active ? styles.workCardActive : ''].join(' ')}
                onClick={() => handleCardTap(type.id)}
              >
                {active && (
                  <button className={styles.clearBtn} onClick={e => handleClear(type.id, e)}>×</button>
                )}
                <div className={styles.workCardInner}>
                  <div className={styles.workIconCircle} style={{ background: type.circleColor }}>
                    <span className={styles.workIcon}>{type.icon}</span>
                  </div>
                  <div className={styles.workLabel}>{type.label}</div>
                  <div className={styles.workTime}>
                    {active ? (t.h > 0 ? `${t.h}時間` : '') + (t.m > 0 ? `${t.m}分` : '') : ''}
                  </div>
                </div>
                <div className={styles.workCardBar} style={{ background: type.barColor }} />
              </div>
            )
          })}
        </div>

        {/* 合計時間パネル */}
        <div className={styles.totalPanel}>
          <ClockIcon size={44} color="#34a36f" />
          <span className={styles.totalLabel}>合計</span>
          <span className={styles.totalNumber}>{displayH}</span>
          <span className={styles.totalUnit}>時間</span>
          <span className={styles.totalNumber}>{String(displayM).padStart(2, '0')}</span>
          <span className={styles.totalUnit}>分</span>
        </div>

        {timeError && <div className={styles.timeError}>{timeError}</div>}

        <button
          className={[styles.submitButton, (activeTypes.length === 0 || saving) ? styles.submitDisabled : ''].join(' ')}
          onClick={handleConfirm}
          disabled={activeTypes.length === 0 || saving}
        >
          <ExitIcon size={54} color="#fff" />
          <span>{saving ? '記録中...' : '退勤を登録'}</span>
        </button>

      </div>

      {/* 時間入力モーダル */}
      {editingType && (
        <div className={styles.timeModalOverlay} onClick={() => setEditingType(null)}>
          <div className={styles.timeModal} onClick={e => e.stopPropagation()}>
            <div className={styles.timeModalTitle}>{editingType}の時間を入力</div>
            {workingMinutes !== null && (
              <div className={styles.timeModalHint}>
                勤務時間合計: {fmtMinutes(workingMinutes)}
                {activeTypes.filter(t => t.id !== editingType).length > 0 && (
                  <> / 他の合計: {fmtMinutes(activeTypes.filter(t => t.id !== editingType).reduce((sum, type) => {
                    const t = workTimes[type.id] || { h: 0, m: 0 }
                    return sum + t.h * 60 + t.m
                  }, 0))}</>
                )}
              </div>
            )}
            <div className={styles.timeModalRow}>
              <NumberPicker
                value={workTimes[editingType]?.h ?? 0}
                options={hourOptions}
                onChange={val => setTime(editingType, 'h', val)}
                label="時間"
              />
              <span className={styles.timeUnit}>時間</span>
              <NumberPicker
                value={workTimes[editingType]?.m ?? 0}
                options={minuteOptions}
                onChange={val => setTime(editingType, 'm', val)}
                label="分"
              />
              <span className={styles.timeUnit}>分</span>
              {workingMinutes !== null && (() => {
                const otherMins = activeTypes
                  .filter(t => t.id !== editingType)
                  .reduce((sum, type) => {
                    const t = workTimes[type.id] || { h: 0, m: 0 }
                    return sum + t.h * 60 + t.m
                  }, 0)
                const remaining = workingMinutes - otherMins
                if (remaining <= 0) return null
                const rh = Math.floor(remaining / 60)
                const rm = remaining % 60
                const alreadySet = (workTimes[editingType]?.h ?? 0) * 60 + (workTimes[editingType]?.m ?? 0) === remaining
                if (alreadySet) return null
                return (
                  <button
                    className={styles.remainingBtn}
                    onClick={() => { setTime(editingType, 'h', rh); setTime(editingType, 'm', rm) }}
                  >
                    残り{fmtMinutes(remaining)}
                  </button>
                )
              })()}
            </div>
            <button className={styles.timeModalOk} onClick={() => setEditingType(null)}>OK</button>
          </div>
        </div>
      )}

    </div>
  )
}
