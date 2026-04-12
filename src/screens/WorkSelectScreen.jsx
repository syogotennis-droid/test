import React, { useState, useEffect, useRef } from 'react'
import { getClockInTime } from '../lib/db'
import styles from './WorkSelectScreen.module.css'

const WORK_TYPES = [
  { id: '現場', label: '現場', icon: '🏗️', cls: 'field' },
  { id: '清掃', label: '清掃', icon: '🧹', cls: 'cleaning' },
  { id: '事務', label: '事務', icon: '💼', cls: 'office' },
  { id: '休憩', label: '休憩', icon: '☕', cls: 'break' }
]

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function NumberPicker({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button className={styles.pickerBtn} onClick={() => setOpen(true)}>
        {value}
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
                  {n}
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
  const [selected, setSelected] = useState([])
  const [workTimes, setWorkTimes] = useState({})
  const [saving, setSaving] = useState(false)
  const [workingMinutes, setWorkingMinutes] = useState(null)
  const [timeError, setTimeError] = useState('')
  const clockOutRef = useRef(new Date())

  useEffect(() => {
    getClockInTime(user.id).then(log => {
      if (log) {
        const diff = Math.round((clockOutRef.current - new Date(log.timestamp)) / 60000)
        setWorkingMinutes(Math.max(0, diff))
      }
    })
  }, [user.id])

  function toggleType(id) {
    setTimeError('')
    if (selected.includes(id)) {
      setSelected(prev => prev.filter(t => t !== id))
      setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
    } else {
      setSelected(prev => [...prev, id])
      setWorkTimes(prev => ({ ...prev, [id]: { h: 0, m: 0 } }))
    }
  }

  function setTime(id, field, val) {
    setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
    setTimeError('')
  }

  const totalInputMinutes = selected.reduce((sum, id) => {
    const t = workTimes[id] || { h: 0, m: 0 }
    return sum + t.h * 60 + t.m
  }, 0)

  async function handleConfirm() {
    if (selected.length === 0 || saving) return
    const zeroTypes = selected.filter(id => {
      const t = workTimes[id] || { h: 0, m: 0 }
      return t.h === 0 && t.m === 0
    })
    if (zeroTypes.length > 0) {
      setTimeError(`時間が0の作業があります：${zeroTypes.join('、')}`)
      return
    }
    if (workingMinutes !== null && totalInputMinutes !== workingMinutes) {
      setTimeError(`合計が勤務時間と一致しません（勤務時間: ${fmtMinutes(workingMinutes)}）`)
      return
    }
    setSaving(true)
    try {
      const workTypeStr = selected
        .map(id => {
          const t = workTimes[id] || { h: 0, m: 0 }
          return `${id}:${t.h * 60 + t.m}`
        })
        .join(',')
      await onComplete(selected, workTypeStr)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  const isConfirmDisabled = selected.length === 0 || saving
  const hourOptions = Array.from({ length: 24 }, (_, i) => i)
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

  return (
    <div className={styles.screen}>
      <div className={styles.userBadge}>
        <span className={styles.userIcon}>👤</span>
        <div>
          <div className={styles.userName}>{user.name}</div>
          <div className={styles.userId}>{user.id}</div>
        </div>
      </div>

      <h1>退勤 — 作業内容を選択</h1>
      <p>今日の作業内容を選んでください（複数可）</p>

      {workingMinutes !== null && (
        <div className={styles.workingTimeSummary}>
          <span className={styles.wtLabel}>勤務時間</span>
          <span className={styles.wtValue}>{fmtMinutes(workingMinutes)}</span>
          {selected.length > 0 && (
            <>
              <span className={styles.wtSep}>|</span>
              <span className={styles.wtLabel}>残り</span>
              <span className={[
                styles.wtValue,
                totalInputMinutes === workingMinutes ? styles.totalMatch : styles.totalMismatch
              ].join(' ')}>{fmtMinutes(Math.max(0, workingMinutes - totalInputMinutes))}</span>
            </>
          )}
        </div>
      )}

      <div className={styles.buttons}>
        {WORK_TYPES.map(type => (
          <div key={type.id} className={styles.workTypeGroup}>
            <div
              className={[
                styles.workBtn,
                styles[type.cls],
                selected.includes(type.id) ? styles.selected : ''
              ].join(' ')}
            >
              <span className={styles.workIcon}>{type.icon}</span>
              <span className={styles.workLabel}>{type.label}</span>
              <button
                className={[
                  styles.checkboxBtn,
                  selected.includes(type.id) ? styles.checkboxChecked : ''
                ].join(' ')}
                onClick={() => toggleType(type.id)}
              >
                {selected.includes(type.id) ? '✓' : ''}
              </button>
            </div>

            {selected.includes(type.id) && (
              <div className={styles.timeInputRow}>
                <NumberPicker
                  value={workTimes[type.id]?.h ?? 0}
                  options={hourOptions}
                  onChange={val => setTime(type.id, 'h', val)}
                  label="時間"
                />
                <span className={styles.timeUnit}>時間</span>
                <NumberPicker
                  value={workTimes[type.id]?.m ?? 0}
                  options={minuteOptions}
                  onChange={val => setTime(type.id, 'm', val)}
                  label="分"
                />
                <span className={styles.timeUnit}>分</span>
                {workingMinutes !== null && (() => {
                  const otherMins = selected
                    .filter(id => id !== type.id)
                    .reduce((sum, id) => {
                      const t = workTimes[id] || { h: 0, m: 0 }
                      return sum + t.h * 60 + t.m
                    }, 0)
                  const remaining = workingMinutes - otherMins
                  if (remaining <= 0) return null
                  const rh = Math.floor(remaining / 60)
                  const rm = remaining % 60
                  const alreadySet = (workTimes[type.id]?.h ?? 0) * 60 + (workTimes[type.id]?.m ?? 0) === remaining
                  if (alreadySet) return null
                  return (
                    <button
                      className={styles.remainingBtn}
                      onClick={() => {
                        setTime(type.id, 'h', rh)
                        setTime(type.id, 'm', rm)
                        setTimeError('')
                      }}
                    >
                      残り{fmtMinutes(remaining)}
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      {timeError && <p className={styles.timeError}>{timeError}</p>}

      <button
        className={[styles.confirmBtn, isConfirmDisabled ? styles.disabled : ''].join(' ')}
        onClick={handleConfirm}
        disabled={isConfirmDisabled}
      >
        {saving ? '記録中...' : '退勤を確定'}
      </button>

      <button className={styles.cancelBtn} onClick={onCancel}>
        ← 戻る
      </button>
    </div>
  )
}
