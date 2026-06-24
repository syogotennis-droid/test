import React, { useEffect, useState } from 'react'
import { getUsers } from '../lib/db'
import styles from './QRGeneratorScreen.module.css'

const QR_API = (value, size) =>
  `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(value)}&size=${size}x${size}&bgcolor=ffffff&color=000000&margin=6`

function QRImage({ value, size = 200 }) {
  return <img src={QR_API(value, size)} alt={value} width={size} height={size} />
}

function NameLines({ name }) {
  const parts = name.split(/\s+/)
  if (parts.length >= 2) {
    return <>{parts[0]}<br />{parts.slice(1).join(' ')}</>
  }
  return <>{name}</>
}

function printOne(user) {
  const qrUrl = QR_API(user.id, 300)
  const nameParts = user.name.split(/\s+/)
  const nameHtml = nameParts.length >= 2
    ? `${nameParts[0]}<br>${nameParts.slice(1).join(' ')}`
    : user.name

  const win = window.open('', '_blank', 'width=600,height=400')
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: 91mm 55mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 91mm; height: 55mm; display: flex; align-items: center; font-family: sans-serif; background: #fff; }
  .left { flex: 1; padding: 5mm 4mm 5mm 6mm; display: flex; flex-direction: column; justify-content: center; gap: 3mm; }
  .id { font-size: 7pt; font-weight: 600; color: #5b7fa6; letter-spacing: 0.04em; }
  .name { font-size: 18pt; font-weight: 900; color: #1a3f6f; line-height: 1.2; letter-spacing: 0.04em; }
  .right { flex-shrink: 0; padding: 4mm; display: flex; align-items: center; justify-content: center; }
  img { width: 44mm; height: 44mm; display: block; }
</style>
</head><body>
  <div class="left">
    <div class="id">${user.id}</div>
    <div class="name">${nameHtml}</div>
  </div>
  <div class="right"><img src="${qrUrl}" /></div>
</body></html>`)
  win.document.close()
  win.onload = () => { win.focus(); win.print(); win.close() }
}

export default function QRGeneratorScreen({ onBack }) {
  const [users, setUsers] = useState([])

  useEffect(() => {
    getUsers().then(u => setUsers(u.sort((a, b) => a.id.localeCompare(b.id))))
  }, [])

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>←</button>
        <h2>QRカード印刷</h2>
        <button className={styles.printBtn} onClick={() => window.print()}>🖨 一括印刷</button>
      </div>

      <div className={styles.preview}>
        <p className={styles.hint}>A4用紙に1ページ8枚（2列×4行）で印刷されます</p>
        <div className={styles.grid}>
          {users.map(user => (
            <div key={user.id} className={styles.cardWrap}>
              <div className={styles.card}>
                <div className={styles.cardLeft}>
                  <div className={styles.cardId}>{user.id}</div>
                  <div className={styles.cardName}><NameLines name={user.name} /></div>
                </div>
                <div className={styles.cardRight}>
                  <QRImage value={user.id} size={160} />
                </div>
              </div>
              <button className={styles.singlePrintBtn} onClick={() => printOne(user)}>
                🖨 印刷
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
