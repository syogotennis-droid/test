import React, { useEffect, useState } from 'react'
import { getRecentWork, itemLabel, sortByItemOrder } from '../lib/db'
import styles from './CopyFromDay.module.css'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function fmtMins(m) {
  const h = Math.floor(m / 60), mm = m % 60
  return h > 0 ? `${h}時間${mm > 0 ? mm + '分' : ''}` : `${mm}分`
}

// "日付を選んでコピー": recent days' work (newest first) to copy into the input.
// Only items in `selectable` are listed (null: all, for the admin); the shift being entered is left out.
// onPick({ label, items })
export default function CopyFromDay({ userId, date, slot, selectable, onPick, onClose }) {
  const [rows, setRows] = useState(null) // null = loading, false = failed
  useEffect(() => {
    let alive = true
    getRecentWork(userId, date).then(r => { if (alive) setRows(r ?? false) })
    return () => { alive = false }
  }, [userId, date])

  const list = (rows || [])
    .filter(r => !(r.date === date && r.slot === slot))
    .map(r => ({ ...r, items: Object.fromEntries(Object.entries(r.items || {}).filter(([t, m]) => m > 0 && (!selectable || selectable.includes(t)))) }))
    .filter(r => Object.keys(r.items).length > 0)
  // the shift number is shown only on days with more than one shift
  const multi = new Set(list.filter((r, i) => list.some((x, j) => j !== i && x.date === r.date)).map(r => r.date))
  const labelOf = r => {
    const [, m, d] = r.date.split('-').map(Number)
    const dow = DOW[new Date(r.date.replace(/-/g, '/')).getDay()]
    return `${m}/${d}（${dow}）${multi.has(r.date) ? ` ${r.slot}回目` : ''}`
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>コピーする日を選ぶ</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        <div className={styles.body}>
          {rows === null && <div className={styles.note}>読み込み中</div>}
          {rows === false && <div className={styles.note}>読み込めません。通信を確認してください</div>}
          {rows && list.length === 0 && <div className={styles.note}>コピーできる日がありません（最近2か月）</div>}
          {list.map(r => (
            <button key={`${r.date}_${r.slot}`} type="button" className={styles.row}
              onClick={() => onPick({ label: labelOf(r), items: r.items })}>
              <span className={styles.date}>{labelOf(r)}</span>
              <span className={styles.items}>
                {sortByItemOrder(Object.keys(r.items)).map(t => `${itemLabel(t)} ${fmtMins(r.items[t])}`).join('・')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
