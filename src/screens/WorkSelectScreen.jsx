import React, { useState, useRef } from 'react'
import { itemLabel, workItemDef, isDeletedWorkItem, sortByItemOrder, commuteLabel } from '../lib/db'
import { answerWeeklyCopyAtClockOut } from '../lib/punchFlow'
import { useIdleTimeout } from '../lib/useIdleTimeout'
import styles from './WorkSelectScreen.module.css'

const CLOCK_OUT_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費'])
const DEFAULT_BAR = '#9baab8'

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
  '現場':        { barColor: '#f0952a' },
  '事務':        { barColor: '#9baab8' },
}

function barColor(key) {
  return ITEM_META[key]?.barColor || DEFAULT_BAR
}

// Label of a member inside its group card (通常 / 短期 ...)
function variantLabel(member) {
  return workItemDef(member)?.variant || itemLabel(member)
}

// Cards in the order set on the 業務の管理 screen. Items of the same group
// share one card when the user has two or more of them.
function getDisplayCards(userWorkItems) {
  const base = userWorkItems || []
  const filtered = sortByItemOrder(base.filter(item => !CLOCK_OUT_HIDDEN.has(item) && !isDeletedWorkItem(item)))
  const groupOf = id => workItemDef(id)?.group || null

  const cards = []
  const doneGroups = new Set()
  for (const item of filtered) {
    const g = groupOf(item)
    if (!g) { cards.push({ type: 'single', id: item }); continue }
    if (doneGroups.has(g)) continue
    doneGroups.add(g)
    const members = filtered.filter(m => groupOf(m) === g)
    cards.push(members.length > 1 ? { type: 'group', key: g, members } : { type: 'single', id: item })
  }
  return cards
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

function fmtMinutes(mins) {
  if (!mins) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

const TIME_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

// Hours/minutes keypad. Right after a box is chosen, the first digit replaces what is there
// (1時間 → press 2 → 2時間, not 12時間). C clears the box; out-of-range digits show the limit.
function useTimeKeypad(h0, m0) {
  const [hStr, setHStr] = useState(h0 > 0 ? String(h0) : '')
  const [mStr, setMStr] = useState(m0 > 0 ? String(m0) : '')
  const [focus, setFocusRaw] = useState('h')
  const [fresh, setFresh] = useState(true)
  const [hint, setHint] = useState('')
  const setFocus = f => { setFocusRaw(f); setFresh(true); setHint('') }
  const reset = (h, m) => { setHStr(h > 0 ? String(h) : ''); setMStr(m > 0 ? String(m) : ''); setFocus('h') }
  function pressKey(k) {
    const cur = focus === 'h' ? hStr : mStr, set = focus === 'h' ? setHStr : setMStr, max = focus === 'h' ? 23 : 59
    setHint('')
    if (k === '⌫') { set(cur.slice(0, -1)); setFresh(false); return }
    if (k === 'C') { set(''); setFresh(false); return }
    if (k === '') return
    const next = fresh ? k : cur + k
    if (parseInt(next) > max) { setHint(focus === 'h' ? '時間は23まで' : '分は59まで'); return }
    set(next.replace(/^0+(?=\d)/, ''))
    setFresh(false)
  }
  return { hStr, mStr, focus, setFocus, pressKey, hint, reset }
}

function TimeInputModal({ item, workTimes, onSetTime, onClose }) {
  const initial = workTimes[item] || { h: 0, m: 0 }
  const { hStr, mStr, focus, setFocus, pressKey, hint } = useTimeKeypad(initial.h, initial.m)

  function handleOk() {
    onSetTime(item, 'h', parseInt(hStr) || 0)
    onSetTime(item, 'm', parseInt(mStr) || 0)
    onClose()
  }

  return (
    <div className={styles.timeModalOverlay} onClick={onClose}>
      <div className={styles.timeModal} onClick={e => e.stopPropagation()}>
        <div className={styles.timeModalTitle}>{itemLabel(item)}の時間を入力</div>
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
        </div>
        <div className={styles.timeHint}>{hint}</div>
        <div className={styles.timeNumGrid}>
          {TIME_KEYS.map((k, i) => (
            <button
              key={i}
              className={[styles.timeNumKey, k === '⌫' ? styles.timeNumDel : k === 'C' ? styles.timeNumClear : ''].join(' ')}
              onClick={() => pressKey(k)}
              aria-label={k === 'C' ? 'クリア' : k === '⌫' ? '1文字消す' : undefined}
            >{k}</button>
          ))}
        </div>
        <button className={styles.timeModalOk} onClick={handleOk}>OK</button>
      </div>
    </div>
  )
}

function SubPickerModal({ groupKey, members, workTimes, onSetTime, onClear, onClose }) {
  const [editing, setEditing] = useState(null)
  const { hStr, mStr, focus, setFocus, pressKey, hint, reset } = useTimeKeypad(0, 0)

  function commitCurrent() {
    if (editing) {
      onSetTime(editing, 'h', parseInt(hStr) || 0)
      onSetTime(editing, 'm', parseInt(mStr) || 0)
    }
  }

  function selectVariant(m) {
    commitCurrent()
    const t = workTimes[m] || { h: 0, m: 0 }
    setEditing(m)
    reset(t.h, t.m)
  }

  return (
    <div className={styles.subPickerOverlay} onClick={onClose}>
      <div className={styles.subPickerBox} onClick={e => e.stopPropagation()}>
        <div className={styles.subPickerTitle}>{groupKey}</div>

        <div className={editing ? styles.subPickerSplit : ''}>
          <div className={styles.subPickerList}>
            {members.map(m => {
              const t = workTimes[m]
              const active = t && (t.h > 0 || t.m > 0)
              const isEditing = editing === m
              return (
                <div key={m} className={styles.subPickerRow}>
                  <button
                    className={[styles.subPickerItem, active ? styles.subPickerItemActive : '', isEditing ? styles.subPickerItemEditing : ''].join(' ')}
                    onClick={() => selectVariant(m)}
                  >
                    <span>{variantLabel(m)}</span>
                    {active && <span className={styles.subPickerTime}>{fmtMinutes(t.h * 60 + t.m)}</span>}
                    
                  </button>
                  {active && !isEditing && (
                    <button className={styles.subPickerClear} onClick={() => onClear(m)}>×</button>
                  )}
                </div>
              )
            })}
          </div>

          {editing && (
            <div className={styles.subPickerInputArea}>
              <div className={styles.subPickerInputLabel}>{variantLabel(editing)}</div>
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
              </div>
              <div className={styles.timeHint}>{hint}</div>
              <div className={styles.timeNumGrid}>
                {TIME_KEYS.map((k, i) => (
                  <button
                    key={i}
                    className={[styles.timeNumKey, k === '⌫' ? styles.timeNumDel : k === 'C' ? styles.timeNumClear : ''].join(' ')}
                    onClick={() => pressKey(k)}
                    aria-label={k === 'C' ? 'クリア' : k === '⌫' ? '1文字消す' : undefined}
                  >{k}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button className={styles.timeModalOk} onClick={() => { commitCurrent(); onClose() }}>OK</button>
      </div>
    </div>
  )
}

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function itemsText(items) {
  return sortByItemOrder(Object.keys(items)).map(t => `${itemLabel(t)} ${fmtMinutes(items[t])}`).join('・')
}

// "先週と同じ業務内容を今週も使いますか？" — asked before the work input on the
// first clock-out of the week. Leaving with 戻る leaves it unanswered (asked again).
function WeeklyCopyQuestion({ user, offer, onAnswer, onCancel }) {
  const [busy, setBusy] = useState(false)
  async function answer(a) {
    if (busy) return
    setBusy(true)
    await onAnswer(a)
  }
  return (
    <div className={styles.weeklyWrap}>
      <div className={styles.weeklyBox}>
        <div className={styles.weeklyName}>{user.name} さん</div>
        <div className={styles.weeklyTitle}>先週と同じ業務内容を今週も使いますか？</div>
        <div className={styles.weeklyList}>
          {offer.days.map(d => {
            const [y, m, dd] = d.date.split('-').map(Number)
            return (
              <div key={d.date} className={styles.weeklyRow}>
                <span className={styles.weeklyDow}>{DOW[new Date(y, m - 1, dd).getDay()]}</span>
                <span>{d.slots.length > 1
                  ? d.slots.map(s => `${s.slot}回目 ${itemsText(s.items)}`).join(' ／ ')
                  : itemsText(d.slots[0].items)}</span>
              </div>
            )
          })}
        </div>
        <div className={styles.weeklyHint}>「使う」で、今週の同じ曜日の業務入力に先週の内容が入ります</div>
        <div className={styles.weeklyBtns}>
          <button className={styles.weeklyNo} onClick={() => answer('skip')} disabled={busy}>使わない</button>
          <button className={styles.weeklyYes} onClick={() => answer('use')} disabled={busy}>使う</button>
        </div>
      </div>
      <button className={styles.backButton} onClick={onCancel} disabled={busy}>戻る</button>
    </div>
  )
}

export default function WorkSelectScreen({ user, ctx = {}, onComplete, onCancel }) {
  const displayCards = getDisplayCards(user.workItems)
  const [saving, setSaving] = useState(false)
  // left alone for 2 minutes → back to the start; nothing is clocked out (asked again next time)
  useIdleTimeout(onCancel, { enabled: !saving })
  const allFlatItems = displayCards.flatMap(c => c.type === 'single' ? [c.id] : c.members)

  // pre-filled from the weekly copy; only items this user can select
  const toWorkTimes = prefill => {
    const init = {}
    Object.entries(prefill || {}).forEach(([t, mins]) => {
      if (allFlatItems.includes(t) && mins > 0) init[t] = { h: Math.floor(mins / 60), m: mins % 60 }
    })
    return init
  }
  const [workTimes, setWorkTimes] = useState(() => toWorkTimes(ctx.prefill))
  const [prefilled, setPrefilled] = useState(() => Object.keys(toWorkTimes(ctx.prefill)).length > 0)
  const [asking, setAsking] = useState(!!ctx.weeklyOffer)
  const [weeklyMsg, setWeeklyMsg] = useState('')

  async function handleWeeklyAnswer(answer) {
    try {
      const r = await answerWeeklyCopyAtClockOut(ctx, answer)
      // what was already entered for this shift (prefillIsSaved) is left as it is
      if (answer === 'use' && !ctx.prefillIsSaved) {
        const wt = toWorkTimes(r.prefill)
        setWorkTimes(wt)
        setPrefilled(Object.keys(wt).length > 0)
        // nothing for today (e.g. last week only had later days): say what was prepared
        if (Object.keys(wt).length === 0) setWeeklyMsg(`今週${r.copiedDays}日分を用意（今日の分なし）`)
      }
    } catch {
      setWeeklyMsg('通信エラー。次の退勤時にもう一度確認します')
    }
    setAsking(false)
  }
  const [transportEligible, setTransportEligible] = useState(ctx.transportDefault ?? true)
  const transportOptions = ctx.transportOptions || []
  const [transportMethods, setTransportMethods] = useState(ctx.transportMethodsDefault || [])
  const toggleMethod = k => setTransportMethods(prev => (prev.includes(k)
    ? (prev.length > 1 ? prev.filter(x => x !== k) : prev) // at least one stays checked
    : [...prev, k]))
  const [editingItem, setEditingItem] = useState(null)
  const [subPickerGroup, setSubPickerGroup] = useState(null)

  function isActive(id) {
    const t = workTimes[id]
    return t && (t.h > 0 || t.m > 0)
  }

  function handleCardTap(id) {
    if (!workTimes[id]) setWorkTimes(prev => ({ ...prev, [id]: { h: 0, m: 0 } }))
    setEditingItem(id)
  }

  function handleClear(id, e) {
    e.stopPropagation()
    setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })
  }

  function setTime(id, field, val) {
    setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  const activeItems = allFlatItems.filter(id => isActive(id))

  const totalInputMinutes = activeItems.reduce((sum, id) => {
    const t = workTimes[id] || { h: 0, m: 0 }
    return sum + t.h * 60 + t.m
  }, 0)
  const displayH = Math.floor(totalInputMinutes / 60)
  const displayM = totalInputMinutes % 60

  // 戻る after entering work times asks first (the entries are not saved); with nothing
  // changed it goes straight back. The 2-minute idle return stays as it is (shared tablet).
  const initialTimes = useRef(JSON.stringify(toWorkTimes(ctx.prefill)))
  const enteredTimes = JSON.stringify(Object.fromEntries(activeItems.map(id => [id, workTimes[id]])))
  function handleBack() {
    if (activeItems.length > 0 && enteredTimes !== initialTimes.current &&
      !window.confirm('入力した業務時間は保存されません。\n退勤せずに戻りますか？')) return
    onCancel()
  }

  const [saveError, setSaveError] = useState('')
  async function handleConfirm() {
    if (saving) return
    const workItemsObj = {}
    activeItems.forEach(id => {
      const t = workTimes[id] || { h: 0, m: 0 }
      workItemsObj[id] = t.h * 60 + t.m
    })
    setSaving(true)
    setSaveError('')
    try {
      await onComplete(workItemsObj, ctx.asksTransport ? { transportEligible, transportMethods } : {})
    } catch (e) {
      console.error(e)
      // keep what was entered; tell why it was not registered
      setSaveError(e?.message && /[ぁ-んァ-ヶ一-龥]/.test(e.message) ? e.message : '退勤を登録できませんでした。入力内容は残っています。通信を確認して、もう一度押してください')
      setSaving(false)
    }
  }

  if (asking) {
    return (
      <div className={styles.screen}>
        <WeeklyCopyQuestion user={user} offer={ctx.weeklyOffer} onAnswer={handleWeeklyAnswer} onCancel={onCancel} />
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        {(ctx.clockIn || prefilled || weeklyMsg) && (
          <div className={styles.infoBar}>
            <span className={styles.infoName}>{user.name} さん</span>
            {ctx.slot > 1 && <span className={styles.infoSlot}>本日{ctx.slot}回目</span>}
            {ctx.clockIn?.time && <span>出勤 {ctx.clockIn.time.substring(0, 5)}</span>}
            {ctx.breakTotal > 0 && <span>休憩 {fmtMinutes(ctx.breakTotal)}</span>}
            {ctx.onBreak && <span className={styles.infoWarn}>休憩中のまま退勤します</span>}
            {prefilled && <span className={styles.infoPlan}>{ctx.prefillIsSaved ? '入力済みの内容を表示（違う場合は修正）' : '先週の内容を入力済み（違う場合は修正）'}</span>}
            {weeklyMsg && <span className={styles.infoPlan}>{weeklyMsg}</span>}
          </div>
        )}
        <div className={styles.workGrid}>
          {displayCards.map(card => {
            if (card.type === 'single') {
              const id = card.id
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
                    <div className={styles.workLabel}>{itemLabel(id)}</div>
                    {active && (
                      <div className={styles.workCardTime}>
                        {fmtMinutes((workTimes[id]?.h ?? 0) * 60 + (workTimes[id]?.m ?? 0))}
                      </div>
                    )}
                  </div>
                  <div className={styles.workCardBar} style={{ background: barColor(id) }} />
                </div>
              )
            }
            const { key, members } = card
            const activeMember = members.find(m => isActive(m))
            return (
              <div
                key={key}
                className={[styles.workCard, activeMember ? styles.workCardActive : ''].join(' ')}
                onClick={() => setSubPickerGroup(card)}
              >
                {activeMember && (
                  <button
                    className={styles.clearBtn}
                    aria-label={`${key}の入力をすべて消す`}
                    onClick={e => {
                      e.stopPropagation()
                      const entered = members.filter(m => isActive(m))
                      // more than one entry in this group → say what will be cleared
                      if (entered.length > 1 && !window.confirm(`${key}の入力（${entered.map(m => variantLabel(m)).join('・')}）をすべて消しますか？`)) return
                      setWorkTimes(prev => { const copy = { ...prev }; members.forEach(m => { delete copy[m] }); return copy })
                    }}
                  >×</button>
                )}
                <div className={styles.workCardInner}>
                  <div className={styles.workLabel}>{key}</div>
                  {activeMember && (
                    <div className={styles.workCardSub}>
                      {members.filter(m => isActive(m)).map(m => (
                        <span key={m}>{variantLabel(m)}: {fmtMinutes((workTimes[m]?.h ?? 0) * 60 + (workTimes[m]?.m ?? 0))}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.workCardBar} style={{ background: barColor(members[0]) }} />
              </div>
            )
          })}
        </div>

        <div className={styles.totalPanel}>
          <ClockIcon size={44} color="#34a36f" />
          <span className={styles.totalLabel}>合計</span>
          <span className={styles.totalNumber}>{displayH}</span>
          <span className={styles.totalUnit}>時間</span>
          <span className={styles.totalNumber}>{String(displayM).padStart(2, '0')}</span>
          <span className={styles.totalUnit}>分</span>
        </div>

        {saveError && <div className={styles.saveError} role="alert">{saveError}</div>}
        {displayCards.length === 0 && (
          <div className={styles.skipHint}>業務が未設定です。そのまま退勤できます（管理者に連絡）</div>
        )}
        {displayCards.length > 0 && activeItems.length === 0 && (
          <div className={styles.skipHint}>業務時間は後から「勤務確認」で入力できます</div>
        )}

        {ctx.asksTransport && (
          <div className={styles.transportRow} role="radiogroup" aria-label="本日の交通費">
            <span className={styles.transportLabel}>本日の交通費</span>
            <button
              type="button"
              role="radio"
              aria-checked={transportEligible}
              className={[styles.transportBtn, transportEligible ? styles.transportBtnOn : ''].join(' ')}
              onClick={() => setTransportEligible(true)}
            >{transportEligible ? '✓ ' : ''}あり</button>
            <button
              type="button"
              role="radio"
              aria-checked={!transportEligible}
              className={[styles.transportBtn, !transportEligible ? styles.transportBtnOff : ''].join(' ')}
              onClick={() => setTransportEligible(false)}
            >{!transportEligible ? '✓ ' : ''}なし</button>
          </div>
        )}
        {ctx.asksTransport && transportEligible && transportOptions.length > 1 && (
          <div className={styles.transportMethods} role="group" aria-label="今日使った通勤方法">
            <span className={styles.transportMethodsLabel}>今日使ったもの</span>
            {transportOptions.map(k => (
              <button key={k} type="button" role="checkbox" aria-checked={transportMethods.includes(k)}
                className={[styles.transportMethodBtn, transportMethods.includes(k) ? styles.transportMethodOn : ''].join(' ')}
                onClick={() => toggleMethod(k)}>
                <span className={styles.transportMethodBox}>{transportMethods.includes(k) ? '✓' : ''}</span>{commuteLabel(k)}
              </button>
            ))}
          </div>
        )}

        <div className={styles.bottomRow}>
          <button className={styles.backButton} onClick={handleBack} disabled={saving}>戻る</button>
          <button
            className={[styles.submitButton, saving ? styles.submitDisabled : ''].join(' ')}
            onClick={handleConfirm}
            disabled={saving}
          >
            <ExitIcon size={54} color="#fff" />
            <span>{saving ? '記録中' : '退勤登録'}</span>
          </button>
        </div>
      </div>

      {subPickerGroup && (
        <SubPickerModal
          groupKey={subPickerGroup.key}
          members={subPickerGroup.members}
          workTimes={workTimes}
          onSetTime={setTime}
          onClear={id => setWorkTimes(prev => { const copy = { ...prev }; delete copy[id]; return copy })}
          onClose={() => setSubPickerGroup(null)}
        />
      )}

      {editingItem && (
        <TimeInputModal
          item={editingItem}
          workTimes={workTimes}
          onSetTime={setTime}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  )
}
