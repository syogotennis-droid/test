import React, { useEffect, useState } from 'react'
import { itemLabel, sortByItemOrder } from '../lib/db'
import styles from './CompleteScreen.module.css'

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

// logType: '出勤' | '退勤' | '休憩開始' | '休憩終了'
const VIEW = {
  '出勤': { title: '出勤しました', bg: '#2e7d32', icon: '', timeLabel: '出勤時間' },
  '退勤': { title: '退勤しました', bg: '#1a73e8', icon: '', timeLabel: '退勤時間' },
  '休憩開始': { title: '休憩に入りました', bg: '#b45309', icon: '☕', timeLabel: '休憩開始' },
  '休憩終了': { title: '休憩から戻りました', bg: '#2e7d32', icon: '', timeLabel: '戻り時間' },
}

export default function CompleteScreen({ logType, workItems, user, clockInTime, breakInfo, onDone }) {
  const [now] = useState(() => new Date())

  // count down, then back to the punch screen; 「確認を続ける」 gives 30 more seconds (a shared tablet
  // must not keep someone's record on screen for long)
  const withWork = logType === '退勤' && workItems && Object.values(workItems).some(m => m > 0)
  const [secs, setSecs] = useState(() => (withWork ? 8 : logType === '休憩開始' ? 5 : 4))
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (secs <= 0) { onDone(); return }
    const t = setTimeout(() => setSecs(n => n - 1), 1000)
    return () => clearTimeout(t)
  }, [secs, onDone])

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
      {view.icon && <div className={styles.workIcon}>{view.icon}</div>}
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

      {logType === '休憩開始' && (
        <div className={styles.nextHint}>戻ったら「休憩・戻り」を押す</div>
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

      <div className={styles.countdown}>
        <span>あと{Math.max(secs, 0)}秒で戻ります</span>
      </div>
      {logType !== '出勤' && <div className={styles.completeActions}>
        {!held && <button className={styles.completeBtn} onClick={() => { setHeld(true); setSecs(30) }}>確認を続ける</button>}
        <button className={styles.completeBtn} onClick={onDone}>戻る</button>
      </div>}
    </div>
  )
}
