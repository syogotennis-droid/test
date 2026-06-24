import React, { useState, useEffect, useRef } from 'react'
import { getClockInTime } from '../lib/db'
import styles from './WorkSelectScreen.module.css'

const CLOCK_OUT_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費'])

const LEGACY_ITEMS = ['現場', '清掃', '事務', '休憩']

const ITEM_META = {
  'アスレ':      { icon: '🏋️', circleColor: '#fff0dc', barColor: '#f0952a' },
  'スイム':      { icon: '🏊', circleColor: '#dbeeff', barColor: '#5aadea' },
  'スイム短期':  { icon: '🏊', circleColor: '#c8e8ff', barColor: '#4a9fd4' },
  'スイムベビー': { icon: '👶', circleColor: '#fce4ff', barColor: '#c77ddb' },
  'スイム成人':  { icon: '🏊', circleColor: '#d8f0ff', barColor: '#3a8fc4' },
  'フロント':    { icon: '🖥️', circleColor: '#eef1f5', barColor: '#9baab8' },
  'フロント短期': { icon: '🖥️', circleColor: '#e4e8ef', barColor: '#8a9aaa' },
  '監視':        { icon: '👁️', circleColor: '#fff8dc', barColor: '#d4a520' },
  '監視短期':    { icon: '👁️', circleColor: '#fdf5c8', barColor: '#c09515' },
  '研修会':      { icon: '📚', circleColor: '#e8f5e9', barColor: '#4caf50' },
  '清掃':        { icon: '🧹', circleColor: '#dbeeff', barColor: '#5aadea' },
  '事務処理':    { icon: '📋', circleColor: '#eef1f5', barColor: '#9baab8' },
  'エアロ':      { icon: '💃', circleColor: '#f0e8f8', barColor: '#c090d8' },
  'ドライバー':  { icon: '🚗', circleColor: '#fff0dc', barColor: '#f0952a' },
  '選手引率':    { icon: '🏅', circleColor: '#fff8dc', barColor: '#d4a520' },
  '休憩':        { icon: '☕', circleColor: '#f0e8f8', barColor: '#c090d8' },
  '現場':        { icon: '🤸', circleColor: '#fff0dc', barColor: '#f0952a' },
  '事務':        { icon: '📋', circleColor: '#eef1f5', barColor: '#9baab8' },
}

const ITEM_GROUPS = {
  'スイム':  ['スイム', 'スイム短期', 'スイム成人', 'スイムベビー'],
  'フロント': ['フロント', 'フロント短期'],
  '監視':    ['監視', '監視短期'],
}

function variantLabel(groupKey, member) {
  if (member === groupKey) return '通常'
  return member.replace(groupKey, '').trim()
}

function getDisplayCards(userWorkItems) {
  const base = (userWorkItems && userWorkItems.length > 0) ? userWorkItems : LEGACY_ITEMS
  const filtered = base.filter(item => !CLOCK_OUT_HIDDEN.has(item))
  if (!filtered.includes('休憩')) filtered.push('休憩')

  const cards = []
  const used = new Set()
  const doneGroups = new Set()

  for (const item of filtered) {
    if (used.has(item)) continue
    let pushed = false
    for (const [groupKey, groupMembers] of Object.entries(ITEM_GROUPS)) {
      if (!doneGroups.has(groupKey) && groupMembers.includes(item)) {
        const matching = groupMembers.filter(m => filtered.includes(m))
        if (matching.length > 1) {
          cards.push({ type: 'group', key: groupKey, members: matching })
          matching.forEach(m => used.add(m))
        } else {
          cards.push({ type: 'single', id: item })
          used.add(item)
        }
        doneGroups.add(groupKey)
        pushed = true
        break
      }
    }
    if (!pushed) {
      cards.push({ type: 'single', id: item })
      used.add(item)
    }
  }
  return cards
}

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

const TIME_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

function TimeInputModal({ item, workTimes, workingMinutes, activeItems, onSetTime, onClose }) {
  const initial = workTimes[item] || { h: 0, m: 0 }
  const [hStr, setHStr] = useState(initial.h > 0 ? String(initial.h) : '')
  const [mStr, setMStr] = useState(initial.m > 0 ? String(initial.m) : '')
  const [focus, setFocus] = useState('h')

  const h = parseInt(hStr) || 0
  const m = parseInt(mStr) || 0

  const otherMins = activeItems
    .filter(id => id !== item)
    .reduce((sum, id) => {
      const t = workTimes[id] || { h: 0, m: 0 }
      return sum + t.h * 60 + t.m
    }, 0)
  const remaining = workingMinutes != null ? workingMinutes - otherMins : null
  const rh = remaining != null ? Math.floor(remaining / 60) : 0
  const rm = remaining != null ? remaining % 60 : 0
  const alreadySet = remaining != null && h * 60 + m === remaining

  function pressKey(k) {
    if (k === '⌫') {
      if (focus === 'h') setHStr(s => s.slice(0, -1))
      else setMStr(s => s.slice(0, -1))
      return
    }
    if (k === '') return
    if (focus === 'h') {
      const next = hStr + k
      if (parseInt(next) > 23) return
      setHStr(next)
    } else {
      const next = mStr + k
      if (parseInt(next) > 59) return
      setMStr(next)
    }
  }

  function handleOk() {
    onSetTime(item, 'h', h)
    onSetTime(item, 'm', m)
    onClose()
  }

  return (
    <div className={styles.timeModalOverlay} onClick={onClose}>
      <div className={styles.timeModal} onClick={e => e.stopPropagation()}>
        <div className={styles.timeModalTitle}>{item}の時間を入力</div>
        {workingMinutes !== null && (
          <div className={styles.timeModalHint}>
            勤務時間合計: {fmtMinutes(workingMinutes)}
            {activeItems.filter(id => id !== item).length > 0 && (
              <> / 他の合計: {fmtMinutes(otherMins)}</>
            )}
          </div>
        )}
        <div className={styles.timeDisplayRow}>
          <button
            className={[styles.timeDisplayBox, focus === 'h' ? styles.timeDisplayActive : ''].join(' ')}
            onClick={() => setFocus('h')}
          >
            <span className={styles.timeDisplayNum}>{hStr || '0'}</span>
            <span className={styles.timeDisplayUnit}>時間</span>
          </button>
          <span className={styles.timeDisplaySep}>:</span>
          <button
            className={[styles.timeDisplayBox, focus === 'm' ? styles.timeDisplayActive : ''].join(' ')}
            onClick={() => setFocus('m')}
          >
            <span className={styles.timeDisplayNum}>{mStr || '0'}</span>
            <span className={styles.timeDisplayUnit}>分</span>
          </button>
          {remaining != null && remaining > 0 && !alreadySet && (
            <button
              className={styles.remainingBtn}
              onClick={() => { setHStr(rh > 0 ? String(rh) : ''); setMStr(rm > 0 ? String(rm) : '') }}
            >
              残り{fmtMinutes(remaining)}
            </button>
          )}
        </div>
        <div className={styles.timeNumGrid}>
          {TIME_KEYS.map((k, i) => (
            <button
              key={i}
              className={[styles.timeNumKey, k === '⌫' ? styles.timeNumDel : k === '' ? styles.timeNumEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >{k}</button>
          ))}
        </div>
        <button className={styles.timeModalOk} onClick={handleOk}>OK</button>
      </div>
    </div>
  )
}

function SubPickerModal({ groupKey, members, workTimes, onSelect, onClear, onClose }) {
  return (
    <div className={styles.subPickerOverlay} onClick={onClose}>
      <div className={styles.subPickerBox} onClick={e => e.stopPropagation()}>
        <div className={styles.subPickerTitle}>{groupKey}</div>
        <div className={styles.subPickerList}>
          {members.map(m => {
            const t = workTimes[m]
            const active = t && (t.h > 0 || t.m > 0)
            return (
              <div key={m} className={styles.subPickerRow}>
                <button
                  className={[styles.subPickerItem, active ? styles.subPickerItemActive : ''].join(' ')}
                  onClick={() => onSelect(m)}
                >
                  <span>{variantLabel(groupKey, m)}</span>
                  {active && <span className={styles.subPickerTime}>{fmtMinutes(t.h * 60 + t.m)}</span>}
                </button>
                {active && (
                  <button className={styles.subPickerClear} onClick={() => onClear(m)}>×</button>
                )}
              </div>
            )
          })}
        </div>
        <button className={styles.subPickerCancel} onClick={onClose}>閉じる</button>
      </div>
    </div>
  )
}

export default function WorkSelectScreen({ user, onComplete, onCancel }) {
  const [workTimes, setWorkTimes] = useState({})
  const [saving, setSaving] = useState(false)
  const [workingMinutes, setWorkingMinutes] = useState(null)
  const [timeError, setTimeError] = useState('')
  const [editingItem, setEditingItem] = useState(null)
  const [subPickerGroup, setSubPickerGroup] = useState(null)
  const clockOutRef = useRef(new Date())

  const displayCards = getDisplayCards(user.workItems)
  const allFlatItems = displayCards.flatMap(c => c.type === 'single' ? [c.id] : c.members)

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
    setEditingItem(id)
  }

  function handleClear(id, e) {
    e.stopPropagation()
    setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
    setTimeError('')
  }

  function setTime(id, field, val) {
    setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  const activeItems = allFlatItems.filter(id => isActive(id))

  const totalInputMinutes = activeItems.reduce((sum, id) => {
    const t = workTimes[id] || { h: 0, m: 0 }
    return sum + t.h * 60 + t.m
  }, 0)

  const displayH = workingMinutes != null ? Math.floor(workingMinutes / 60) : 0
  const displayM = workingMinutes != null ? workingMinutes % 60 : 0

  async function handleConfirm() {
    if (activeItems.length === 0 || saving) return
    if (workingMinutes !== null && totalInputMinutes !== workingMinutes) {
      setTimeError(`合計が勤務時間と一致しません（勤務時間: ${fmtMinutes(workingMinutes)}）`)
      return
    }
    setSaving(true)
    try {
      const workItemsObj = {}
      activeItems.forEach(id => {
        const t = workTimes[id] || { h: 0, m: 0 }
        workItemsObj[id] = t.h * 60 + t.m
      })
      await onComplete(workItemsObj)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>

      {/* メイン */}
      <div className={styles.main}>

        {/* 作業カード */}
        <div className={styles.workGrid}>
          {displayCards.map(card => {
            if (card.type === 'single') {
              const id = card.id
              const meta = ITEM_META[id] || { barColor: '#9baab8' }
              const active = isActive(id)
              return (
                <div
                  key={id}
                  className={[styles.workCard, active ? styles.workCardActive : ''].join(' ')}
                  onClick={() => handleCardTap(id)}
                >
                  {active && (
                    <button className={styles.clearBtn} onClick={e => handleClear(id, e)}>×</button>
                  )}
                  <div className={styles.workCardInner}>
                    <div className={styles.workLabel}>{id}</div>
                  </div>
                  <div className={styles.workCardBar} style={{ background: meta.barColor }} />
                </div>
              )
            }
            // type === 'group'
            const { key, members } = card
            const activeMember = members.find(m => isActive(m))
            const meta = ITEM_META[key] || { barColor: '#9baab8' }
            return (
              <div
                key={key}
                className={[styles.workCard, activeMember ? styles.workCardActive : ''].join(' ')}
                onClick={() => setSubPickerGroup(card)}
              >
                {activeMember && (
                  <button
                    className={styles.clearBtn}
                    onClick={e => { e.stopPropagation(); members.forEach(m => handleClear(m, { stopPropagation: () => {} })) }}
                  >×</button>
                )}
                <div className={styles.workCardInner}>
                  <div className={styles.workLabel}>{key}</div>
                  {activeMember && (
                    <div className={styles.workCardSub}>
                      {members.filter(m => isActive(m)).map(m => (
                        <span key={m}>{variantLabel(key, m)}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.workCardBar} style={{ background: meta.barColor }} />
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

        <div className={styles.bottomRow}>
          <button className={styles.backButton} onClick={onCancel}>← 戻る</button>
          <button
            className={[styles.submitButton, (activeItems.length === 0 || saving) ? styles.submitDisabled : ''].join(' ')}
            onClick={handleConfirm}
            disabled={activeItems.length === 0 || saving}
          >
            <ExitIcon size={54} color="#fff" />
            <span>{saving ? '記録中...' : '退勤を登録'}</span>
          </button>
        </div>

      </div>

      {/* サブ選択モーダル（グループカードタップ時） */}
      {subPickerGroup && (
        <SubPickerModal
          groupKey={subPickerGroup.key}
          members={subPickerGroup.members}
          workTimes={workTimes}
          onSelect={id => {
            setSubPickerGroup(null)
            handleCardTap(id)
          }}
          onClear={id => {
            setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
          }}
          onClose={() => setSubPickerGroup(null)}
        />
      )}

      {/* 時間入力モーダル */}
      {editingItem && (
        <TimeInputModal
          item={editingItem}
          workTimes={workTimes}
          workingMinutes={workingMinutes}
          activeItems={activeItems}
          onSetTime={setTime}
          onClose={() => setEditingItem(null)}
        />
      )}

    </div>
  )
}
