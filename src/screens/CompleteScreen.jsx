import React, { useEffect, useState } from 'react'
import { answerWeeklyCopy, itemLabel, sortByItemOrder } from '../lib/db'
import styles from './CompleteScreen.module.css'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function itemsText(items) {
  return sortByItemOrder(Object.keys(items)).map(t => `${itemLabel(t)}${fmtMinutes(items[t])}`).join('・')
}

// "先週と同じ業務内容を今週も使いますか？" shown on the first clock-in of the week
function WeeklyCopyQuestion({ offer, user, onAnswered }) {
  const [state, setState] = useState('ask') // ask | saving | done | error
  const [message, setMessage] = useState('')

  async function answer(a) {
    setState('saving')
    try {
      const r = await answerWeeklyCopy(user.id, a)
      setMessage(a === 'use' ? `今週の${r.copiedDays}日分を用意しました。退勤のときに確認してください` : '今週は使いません')
      setState('done')
    } catch {
      setMessage('通信できませんでした。次の出勤のときにもう一度聞きます')
      setState('error')
    }
    onAnswered()
  }

  if (state === 'done' || state === 'error') return <div className={styles.weeklyBox}><div className={styles.weeklyResult}>{message}</div></div>
  return (
    <div className={styles.weeklyBox}>
      <div className={styles.weeklyTitle}>先週と同じ業務内容を今週も使いますか？</div>
      <div className={styles.weeklyList}>
        {offer.days.map(d => {
          const [y, m, dd] = d.date.split('-').map(Number)
          const dow = DOW[new Date(y, m - 1, dd).getDay()]
          return (
            <div key={d.date} className={styles.weeklyRow}>
              <span className={styles.weeklyDow}>{dow}</span>
              <span>{d.slots.length > 1
                ? d.slots.map(s => `${s.slot}回目 ${itemsText(s.items)}`).join(' ／ ')
                : itemsText(d.slots[0].items)}</span>
            </div>
          )
        })}
      </div>
      <div className={styles.weeklyBtns}>
        <button className={styles.weeklyNo} onClick={() => answer('skip')} disabled={state === 'saving'}>使わない</button>
        <button className={styles.weeklyYes} onClick={() => answer('use')} disabled={state === 'saving'}>使う</button>
      </div>
    </div>
  )
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

// logType: '出勤' | '退勤' | '休憩開始' | '休憩終了'
const VIEW = {
  '出勤': { title: '出勤しました', bg: '#2e7d32', icon: '🟢', timeLabel: '出勤時間' },
  '退勤': { title: '退勤しました', bg: '#1a73e8', icon: '🔴', timeLabel: '退勤時間' },
  '休憩開始': { title: '休憩に入りました', bg: '#b45309', icon: '☕', timeLabel: '休憩開始' },
  '休憩終了': { title: '休憩から戻りました', bg: '#2e7d32', icon: '🟢', timeLabel: '戻り時間' },
}

export default function CompleteScreen({ logType, workItems, user, clockInTime, breakInfo, weeklyOffer, onDone }) {
  const [now] = useState(() => new Date())
  // wait for the weekly question to be answered before returning
  const [waiting, setWaiting] = useState(!!weeklyOffer)

  useEffect(() => {
    // unanswered for a minute → go back anyway; it is asked again next clock-in
    if (waiting) { const t = setTimeout(onDone, 60000); return () => clearTimeout(t) }
    const timer = setTimeout(onDone, weeklyOffer ? 3500 : logType === '休憩開始' ? 5000 : 4000)
    return () => clearTimeout(timer)
  }, [onDone, logType, waiting, weeklyOffer])

  const view = VIEW[logType] || VIEW['退勤']
  const isClockOut = logType === '退勤'
  const currentTimeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

  const workEntries = isClockOut && workItems
    ? sortByItemOrder(Object.keys(workItems)).map(t => [t, workItems[t]]).filter(([, m]) => m > 0)
    : []
  const workTotalMins = workEntries.reduce((s, [, m]) => s + m, 0)

  return (
    <div className={styles.screen} style={{ background: view.bg }}>
      <div className={styles.checkmark}>✓</div>
      <div className={styles.workIcon}>{view.icon}</div>
      <h1>{view.title}</h1>
      {user && (
        <p className={styles.detail}>{user.name} さん</p>
      )}

      <div className={styles.timeInfo}>
        {isClockOut && clockInTime && (
          <div className={styles.timeRow}>
            <span className={styles.timeLabel}>出勤時間</span>
            <span className={styles.timeValue}>{clockInTime.substring(0, 5)}</span>
          </div>
        )}
        {logType === '休憩終了' && breakInfo?.start && (
          <div className={styles.timeRow}>
            <span className={styles.timeLabel}>休憩開始</span>
            <span className={styles.timeValue}>{breakInfo.start}</span>
          </div>
        )}
        <div className={styles.timeRow}>
          <span className={styles.timeLabel}>{view.timeLabel}</span>
          <span className={styles.timeValue}>{currentTimeStr}</span>
        </div>
        {breakInfo?.totalMins > 0 && (logType === '休憩終了' || isClockOut) && (
          <div className={[styles.timeRow, styles.totalRow].join(' ')}>
            <span className={styles.timeLabel}>本日の休憩</span>
            <span className={styles.timeValue}>{fmtMinutes(breakInfo.totalMins)}</span>
          </div>
        )}
      </div>

      {weeklyOffer && <WeeklyCopyQuestion offer={weeklyOffer} user={user} onAnswered={() => setWaiting(false)} />}

      {logType === '休憩開始' && (
        <div className={styles.nextHint}>戻ったら「休憩・戻り」を押してください</div>
      )}

      {workEntries.length > 0 && (
        <div className={styles.workSummary}>
          {workEntries.map(([type, mins]) => (
            <div key={type} className={styles.workSummaryRow}>
              <span className={styles.workSummaryType}>{itemLabel(type)}</span>
              <span className={styles.workSummaryTime}>{fmtMinutes(mins)}</span>
            </div>
          ))}
          {workEntries.length > 1 && (
            <div className={[styles.workSummaryRow, styles.workSummaryTotal].join(' ')}>
              <span>合計</span>
              <span>{fmtMinutes(workTotalMins)}</span>
            </div>
          )}
        </div>
      )}

      {!waiting && (
        <div className={styles.countdown}>
          <span>まもなく戻ります...</span>
        </div>
      )}
    </div>
  )
}
