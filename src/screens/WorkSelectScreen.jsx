import React, { useState, useEffect, useRef, useMemo } from 'react'
import styles from './WorkSelectScreen.module.css'

const CLOCK_OUT_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費', '休憩'])
const LEGACY_ITEMS = ['現場', '清掃', '事務']

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

export default function WorkSelectScreen({ user, onComplete, onCancel, sessionCount = 1 }) {
  const [workRows, setWorkRows] = useState([{ type: '', h: 0, m: 0 }])
  const [saving, setSaving] = useState(false)
  const lastSelectRef = useRef(null)
  const prevRowCount = useRef(0)

  const userWorkItems = useMemo(() => {
    const base = (user.workItems && user.workItems.length > 0) ? user.workItems : LEGACY_ITEMS
    return base.filter(item => !CLOCK_OUT_HIDDEN.has(item))
  }, [user])

  const selectedTypes = new Set(workRows.map(r => r.type).filter(Boolean))
  const hasMoreTypes = userWorkItems.some(t => !selectedTypes.has(t))

  useEffect(() => {
    if (workRows.length > prevRowCount.current && lastSelectRef.current) {
      lastSelectRef.current.focus()
    }
    prevRowCount.current = workRows.length
  }, [workRows.length])

  function addWorkRow() {
    setWorkRows(prev => [...prev, { type: '', h: 0, m: 0 }])
  }

  function removeWorkRow(ri) {
    setWorkRows(prev => prev.filter((_, i) => i !== ri))
  }

  function updateRow(ri, field, val) {
    setWorkRows(prev => prev.map((r, i) => i === ri ? { ...r, [field]: val } : r))
  }

  const totalMins = workRows.reduce((s, r) => s + (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0), 0)
  const totalH = Math.floor(totalMins / 60)
  const totalM = totalMins % 60

  const hasValidWork = workRows.some(r => r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0))

  async function handleConfirm() {
    if (saving || !hasValidWork) return
    const workItemsObj = {}
    for (const row of workRows) {
      if (!row.type) continue
      const mins = (parseInt(row.h) || 0) * 60 + (parseInt(row.m) || 0)
      if (mins > 0) workItemsObj[row.type] = mins
    }
    setSaving(true)
    try {
      await onComplete(workItemsObj)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onCancel}>←</button>
          <div className={styles.headerTitle}>退勤登録</div>
        </div>
        <div className={styles.clockBox}>
          <Clock />
        </div>
      </div>

      <div className={styles.main}>
        {/* 今回の業務入力 */}
        <div className={styles.workSection}>
          <div className={styles.workSectionHeader}>
            <span className={styles.workSectionLabel}>今回の業務</span>
            {totalMins > 0 && (
              <span className={styles.workTotalInline}>
                今回の合計 {totalH}時間{String(totalM).padStart(2, '0')}分
              </span>
            )}
          </div>

          <div className={styles.workRows}>
            {workRows.map((row, ri) => {
              const isLast = ri === workRows.length - 1
              const availableTypes = userWorkItems.filter(t => t === row.type || !selectedTypes.has(t))
              return (
                <div key={ri} className={styles.workInputRow}>
                  <select
                    ref={isLast ? lastSelectRef : null}
                    className={styles.workTypeSelect}
                    value={row.type}
                    onChange={e => updateRow(ri, 'type', e.target.value)}
                  >
                    <option value="">業務を選択</option>
                    {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    type="number" min="0" max="23"
                    className={styles.workTimeNum}
                    value={row.h === 0 ? '' : row.h}
                    placeholder="0"
                    onChange={e => { const n = parseInt(e.target.value); updateRow(ri, 'h', isNaN(n) ? 0 : Math.max(0, n)) }}
                    onFocus={e => e.target.select()}
                  />
                  <span className={styles.workTimeUnit}>時間</span>
                  <input
                    type="number" min="0" max="59"
                    className={styles.workTimeNum}
                    value={row.m === 0 ? '' : row.m}
                    placeholder="0"
                    onChange={e => { const n = parseInt(e.target.value); updateRow(ri, 'm', isNaN(n) ? 0 : Math.min(59, Math.max(0, n))) }}
                    onFocus={e => e.target.select()}
                  />
                  <span className={styles.workTimeUnit}>分</span>
                  {workRows.length > 1 && (
                    <button className={styles.workRowDel} onClick={() => removeWorkRow(ri)}>×</button>
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.workSectionFooter}>
            {hasMoreTypes && (
              <button className={styles.addWorkBtn} onClick={addWorkRow}>＋ 別の業務を追加</button>
            )}
            {!hasValidWork && (
              <span className={styles.workHint}>業務と時間を入力してください</span>
            )}
          </div>
        </div>

        <div className={styles.bottomRow}>
          <button className={styles.backButton} onClick={onCancel}>← 戻る</button>
          <button
            className={[styles.submitButton, (saving || !hasValidWork) ? styles.submitDisabled : ''].join(' ')}
            onClick={handleConfirm}
            disabled={saving || !hasValidWork}
          >
            <ExitIcon size={54} color="#fff" />
            <span>{saving ? '記録中...' : '退勤を登録'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
