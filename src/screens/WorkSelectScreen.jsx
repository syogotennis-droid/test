import React, { useState, useEffect, useRef } from 'react'
import { getClockInTime } from '../lib/db'
import styles from './WorkSelectScreen.module.css'

const CLOCK_OUT_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費'])
const LEGACY_ITEMS = ['現場', '清掃', '事務', '休憩']

const ITEM_META = {
  'アスレ':      { barColor: '#f0952a' },
  'スイム':      { barColor: '#5aadea' },
  'スイム短期':  { barColor: '#4a9fd4' },
  'スイムベビー': { barColor: '#c77ddb' },
  'スイム成人':  { barColor: '#3a8fc4' },
  'フロント':    { barColor: '#9baab8' },
  'フロント短期': { barColor: '#8a9aaa' },
  '監視':        { barColor: '#d4a520' },
  '監視短期':    { barColor: '#c09515' },
  '研修会':      { barColor: '#4caf50' },
  '清掃':        { barColor: '#5aadea' },
  '事務処理':    { barColor: '#9baab8' },
  'エアロ':      { barColor: '#c090d8' },
  'ドライバー':  { barColor: '#f0952a' },
  '選手引率':    { barColor: '#d4a520' },
  '休憩':        { barColor: '#c090d8' },
  '現場':        { barColor: '#f0952a' },
  '事務':        { barColor: '#9baab8' },
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

function fmtMinutes(mins) {
  if (mins == null || isNaN(mins)) return ''
  if (mins === 0) return '0分'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h}時間${m}分`
  if (h > 0) return `${h}時間`
  return `${m}分`
}

function fmtDisplay(mins) {
  if (!mins) return '0分'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h}時間${m}分`
  if (h > 0) return `${h}時間`
  return `${m}分`
}

function ExitIcon({ size = 48, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="16 17 21 12 16 7" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="21" y1="12" x2="9" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

function SummaryBar({ workingMinutes, totalInputMinutes }) {
  const remaining = workingMinutes != null ? workingMinutes - totalInputMinutes : null
  const isComplete = remaining === 0
  const isOver = remaining !== null && remaining < 0
  return (
    <div className={styles.summaryBar}>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>勤務時間</span>
        <span className={styles.summaryValue}>
          {workingMinutes != null ? fmtMinutes(workingMinutes) : '—'}
        </span>
      </div>
      <div className={styles.summaryDivider} />
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>入力済み</span>
        <span className={[styles.summaryValue, totalInputMinutes > 0 ? styles.summaryEntered : ''].join(' ')}>
          {fmtMinutes(totalInputMinutes) || '0分'}
        </span>
      </div>
      <div className={styles.summaryDivider} />
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>残り</span>
        {isComplete ? (
          <span className={styles.summaryComplete}>入力が完了しました</span>
        ) : isOver ? (
          <span className={styles.summaryOver}>{fmtMinutes(-remaining)}超過</span>
        ) : (
          <span className={[styles.summaryValue, remaining !== null ? styles.summaryRemaining : ''].join(' ')}>
            {remaining != null ? fmtMinutes(remaining) : '—'}
          </span>
        )}
      </div>
    </div>
  )
}

const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

function NumPad({ minsStr, setMinsStr, maxMins }) {
  function pressKey(k) {
    if (k === '⌫') { setMinsStr(s => s.slice(0, -1)); return }
    if (k === 'C') { setMinsStr(''); return }
    const next = minsStr + k
    if (parseInt(next) > 9999) return
    setMinsStr(next)
  }
  return (
    <div className={styles.timeNumGrid}>
      {NUM_KEYS.map((k, i) => (
        <button
          key={i}
          className={[
            styles.timeNumKey,
            k === '⌫' ? styles.timeNumDel : '',
            k === 'C' ? styles.timeNumClear : '',
          ].join(' ')}
          onClick={() => pressKey(k)}
        >{k}</button>
      ))}
    </div>
  )
}

function QuickBtns({ setMinsStr, maxMins }) {
  const rem = maxMins != null ? maxMins : 0
  return (
    <div className={styles.quickBtns}>
      <button className={styles.quickBtn} onClick={() => setMinsStr('30')}>30分</button>
      <button className={styles.quickBtn} onClick={() => setMinsStr('60')}>1時間</button>
      <button className={styles.quickBtn} onClick={() => setMinsStr('120')}>2時間</button>
      <button
        className={[styles.quickBtn, styles.quickBtnAll, rem <= 0 ? styles.quickBtnDisabled : ''].join(' ')}
        onClick={() => rem > 0 && setMinsStr(String(rem))}
        disabled={rem <= 0}
      >残りすべて</button>
    </div>
  )
}

function TimeInputModal({ item, currentMins, workingMinutes, totalInputMinutes, onConfirm, onClose }) {
  const otherMins = totalInputMinutes - (currentMins || 0)
  const maxMins = workingMinutes != null ? workingMinutes - otherMins : null
  const [minsStr, setMinsStr] = useState(currentMins > 0 ? String(currentMins) : '')
  const value = parseInt(minsStr) || 0
  const isOver = maxMins !== null && value > maxMins
  const overBy = isOver ? value - maxMins : 0
  const canConfirm = value > 0 && !isOver

  return (
    <div className={styles.timeModalOverlay} onClick={onClose}>
      <div className={styles.timeModal} onClick={e => e.stopPropagation()}>
        <div className={styles.timeModalTitle}>{item}の時間</div>
        <div className={styles.minsDisplay}>
          <div className={styles.minsDisplayPrimary}>{fmtDisplay(value)}</div>
          {value > 0 && <div className={styles.minsDisplaySecondary}>{value}分</div>}
        </div>
        <QuickBtns setMinsStr={setMinsStr} maxMins={maxMins} />
        <NumPad minsStr={minsStr} setMinsStr={setMinsStr} maxMins={maxMins} />
        {isOver && (
          <div className={styles.minsError}>残り時間を{overBy}分超えています</div>
        )}
        <div className={styles.timeModalActions}>
          {currentMins > 0 && (
            <button className={styles.timeModalClearBtn} onClick={() => onConfirm(0)}>クリア</button>
          )}
          <button className={styles.timeModalCancel} onClick={onClose}>キャンセル</button>
          <button
            className={[styles.timeModalOk, !canConfirm ? styles.timeModalOkDisabled : ''].join(' ')}
            onClick={() => canConfirm && onConfirm(value)}
            disabled={!canConfirm}
          >確定</button>
        </div>
      </div>
    </div>
  )
}

function SubPickerModal({ groupKey, members, workTimes, workingMinutes, totalInputMinutes, onSetTime, onClear, onClose }) {
  const [editing, setEditing] = useState(null)
  const [minsStr, setMinsStr] = useState('')

  const groupTotal = members.reduce((s, m) => s + (workTimes[m] || 0), 0)
  const outsideTotal = totalInputMinutes - groupTotal
  const otherGroupMins = editing
    ? members.filter(m => m !== editing).reduce((s, m) => s + (workTimes[m] || 0), 0)
    : 0
  const maxMins = workingMinutes != null ? workingMinutes - outsideTotal - otherGroupMins : null

  const currentValue = parseInt(minsStr) || 0
  const isOver = maxMins !== null && currentValue > maxMins
  const overBy = isOver ? currentValue - maxMins : 0

  function commitCurrent() {
    if (editing !== null) {
      onSetTime(editing, parseInt(minsStr) || 0)
    }
  }

  function selectVariant(m) {
    commitCurrent()
    setEditing(m)
    setMinsStr((workTimes[m] || 0) > 0 ? String(workTimes[m]) : '')
  }

  return (
    <div className={styles.subPickerOverlay} onClick={onClose}>
      <div className={styles.subPickerBox} onClick={e => e.stopPropagation()}>
        <div className={styles.subPickerTitle}>{groupKey}</div>
        <div className={editing ? styles.subPickerSplit : ''}>
          <div className={styles.subPickerList}>
            {members.map(m => {
              const mins = workTimes[m] || 0
              const active = mins > 0
              const isEdit = editing === m
              return (
                <div key={m} className={styles.subPickerRow}>
                  <button
                    className={[
                      styles.subPickerItem,
                      active ? styles.subPickerItemActive : '',
                      isEdit ? styles.subPickerItemEditing : '',
                    ].join(' ')}
                    onClick={() => selectVariant(m)}
                  >
                    <span>{variantLabel(groupKey, m)}</span>
                    {active && !isEdit && <span className={styles.subPickerTime}>{fmtMinutes(mins)}</span>}
                    {!active && !isEdit && <span className={styles.subPickerHint}>タップ</span>}
                  </button>
                  {active && !isEdit && (
                    <button className={styles.subPickerClear} onClick={() => onClear(m)}>×</button>
                  )}
                </div>
              )
            })}
          </div>
          {editing && (
            <div className={styles.subPickerInputArea}>
              <div className={styles.subPickerInputLabel}>{variantLabel(groupKey, editing)}</div>
              <div className={styles.minsDisplay}>
                <div className={styles.minsDisplayPrimary}>{fmtDisplay(currentValue)}</div>
                {currentValue > 0 && <div className={styles.minsDisplaySecondary}>{currentValue}分</div>}
              </div>
              <QuickBtns setMinsStr={setMinsStr} maxMins={maxMins} />
              <NumPad minsStr={minsStr} setMinsStr={setMinsStr} maxMins={maxMins} />
              {isOver && <div className={styles.minsError}>残り時間を{overBy}分超えています</div>}
            </div>
          )}
        </div>
        <button className={styles.timeModalOk} onClick={() => { commitCurrent(); onClose() }}>OK</button>
      </div>
    </div>
  )
}

const BREAK_TYPES = new Set(['休憩'])

export default function WorkSelectScreen({ user, onComplete, onCancel }) {
  const [workTimes, setWorkTimes] = useState({})
  const [saving, setSaving] = useState(false)
  const [workingMinutes, setWorkingMinutes] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [subPickerGroup, setSubPickerGroup] = useState(null)
  const [firstWork, setFirstWork] = useState(null)
  const [lastWork, setLastWork] = useState(null)
  const [confirmingBoundary, setConfirmingBoundary] = useState(false)
  const [pendingWorkItems, setPendingWorkItems] = useState(null)
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
    return (workTimes[id] || 0) > 0
  }

  function setTime(id, mins) {
    if (mins > 0) {
      setWorkTimes(prev => ({ ...prev, [id]: mins }))
    } else {
      setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
    }
  }

  const activeItems = allFlatItems.filter(id => isActive(id))
  const workActiveItems = activeItems.filter(id => !BREAK_TYPES.has(id))
  const totalInputMinutes = activeItems.reduce((sum, id) => sum + (workTimes[id] || 0), 0)

  const resolvedFirstWork = workActiveItems.length === 1 ? workActiveItems[0] : firstWork
  const resolvedLastWork = workActiveItems.length === 1 ? workActiveItems[0] : lastWork

  const remaining = workingMinutes != null ? workingMinutes - totalInputMinutes : null
  const isOver = remaining !== null && remaining < 0

  const canSave = !saving && (
    activeItems.length === 0 ||
    workingMinutes === null ||
    totalInputMinutes === workingMinutes
  )

  let saveHint = ''
  if (activeItems.length > 0 && workingMinutes !== null) {
    if (remaining > 0) saveHint = `残り${fmtMinutes(remaining)}を入力してください`
    else if (remaining < 0) saveHint = `${fmtMinutes(-remaining)}超えています`
  }

  async function handleConfirm() {
    if (!canSave || saving) return
    const workItemsObj = {}
    activeItems.forEach(id => { workItemsObj[id] = workTimes[id] || 0 })
    if (workActiveItems.length >= 2) {
      setPendingWorkItems(workItemsObj)
      setConfirmingBoundary(true)
      return
    }
    setSaving(true)
    try {
      await onComplete(workItemsObj, workActiveItems[0] || null, workActiveItems[0] || null)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  async function handleBoundaryConfirm() {
    if (!resolvedFirstWork || !resolvedLastWork) return
    setSaving(true)
    setConfirmingBoundary(false)
    try {
      await onComplete(pendingWorkItems, resolvedFirstWork, resolvedLastWork)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>
      <SummaryBar workingMinutes={workingMinutes} totalInputMinutes={totalInputMinutes} />

      <div className={styles.workGrid}>
        {displayCards.map(card => {
          if (card.type === 'single') {
            const id = card.id
            const meta = ITEM_META[id] || { barColor: '#9baab8' }
            const active = isActive(id)
            return (
              <div
                key={id}
                className={[styles.workCard, active ? styles.workCardEntered : ''].join(' ')}
                onClick={() => setEditingItem(id)}
              >
                {active && (
                  <button
                    className={styles.clearBtn}
                    onClick={e => { e.stopPropagation(); setTime(id, 0) }}
                  >×</button>
                )}
                <div className={styles.workCardInner}>
                  <div className={styles.workLabel}>{id}</div>
                  <div className={[styles.workCardTimeDisplay, active ? styles.workCardTimeEntered : styles.workCardTimeMissing].join(' ')}>
                    {active ? fmtMinutes(workTimes[id]) : '未入力'}
                  </div>
                </div>
                <div className={styles.workCardBar} style={{ background: meta.barColor }} />
              </div>
            )
          }
          const { key, members } = card
          const activeMember = members.find(m => isActive(m))
          const meta = ITEM_META[key] || { barColor: '#9baab8' }
          return (
            <div
              key={key}
              className={[styles.workCard, activeMember ? styles.workCardEntered : ''].join(' ')}
              onClick={() => setSubPickerGroup(card)}
            >
              {activeMember && (
                <button
                  className={styles.clearBtn}
                  onClick={e => { e.stopPropagation(); members.forEach(m => setTime(m, 0)) }}
                >×</button>
              )}
              <div className={styles.workCardInner}>
                <div className={styles.workLabel}>{key}</div>
                {activeMember ? (
                  <div className={styles.workCardSub}>
                    {members.filter(m => isActive(m)).map(m => (
                      <span key={m}>{variantLabel(key, m)}: {fmtMinutes(workTimes[m])}</span>
                    ))}
                  </div>
                ) : (
                  <div className={[styles.workCardTimeDisplay, styles.workCardTimeMissing].join(' ')}>未入力</div>
                )}
              </div>
              <div className={styles.workCardBar} style={{ background: meta.barColor }} />
            </div>
          )
        })}
      </div>

      <div className={styles.bottomRow}>
        <button className={styles.backButton} onClick={onCancel}>← 戻る</button>
        <div className={styles.submitArea}>
          {saveHint && (
            <div className={[styles.saveHint, isOver ? styles.saveHintOver : ''].join(' ')}>{saveHint}</div>
          )}
          <button
            className={[styles.submitButton, !canSave ? styles.submitDisabled : ''].join(' ')}
            onClick={handleConfirm}
            disabled={saving || !canSave}
          >
            <ExitIcon size={44} color="#fff" />
            <span>{saving ? '記録中...' : '退勤を登録'}</span>
          </button>
        </div>
      </div>

      {subPickerGroup && (
        <SubPickerModal
          groupKey={subPickerGroup.key}
          members={subPickerGroup.members}
          workTimes={workTimes}
          workingMinutes={workingMinutes}
          totalInputMinutes={totalInputMinutes}
          onSetTime={setTime}
          onClear={id => setTime(id, 0)}
          onClose={() => setSubPickerGroup(null)}
        />
      )}

      {editingItem && (
        <TimeInputModal
          item={editingItem}
          currentMins={workTimes[editingItem] || 0}
          workingMinutes={workingMinutes}
          totalInputMinutes={totalInputMinutes}
          onConfirm={mins => { setTime(editingItem, mins); setEditingItem(null) }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {confirmingBoundary && (
        <div className={styles.boundaryOverlay}>
          <div className={styles.boundaryModal}>
            <div className={styles.boundaryModalTitle}>業務の順番を確認</div>
            <div className={styles.boundaryModalDesc}>始業・終業時の業務を選択してください。</div>
            <div className={styles.boundaryModalRows}>
              <div className={styles.boundaryModalRow}>
                <span className={styles.boundaryModalLabel}>最初の業務</span>
                <div className={styles.boundaryBtns}>
                  {workActiveItems.map(id => (
                    <button
                      key={id}
                      className={[styles.boundaryBtn, resolvedFirstWork === id ? styles.boundaryBtnActive : ''].join(' ')}
                      onClick={() => setFirstWork(id)}
                    >{id}</button>
                  ))}
                </div>
              </div>
              <div className={styles.boundaryModalRow}>
                <span className={styles.boundaryModalLabel}>最後の業務</span>
                <div className={styles.boundaryBtns}>
                  {workActiveItems.map(id => (
                    <button
                      key={id}
                      className={[styles.boundaryBtn, resolvedLastWork === id ? styles.boundaryBtnActive : ''].join(' ')}
                      onClick={() => setLastWork(id)}
                    >{id}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.boundaryModalActions}>
              <button className={styles.boundaryModalCancel} onClick={() => setConfirmingBoundary(false)}>戻る</button>
              <button
                className={[styles.boundaryModalOk, (!resolvedFirstWork || !resolvedLastWork) ? styles.boundaryModalOkDisabled : ''].join(' ')}
                onClick={handleBoundaryConfirm}
                disabled={!resolvedFirstWork || !resolvedLastWork}
              >退勤を登録</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
