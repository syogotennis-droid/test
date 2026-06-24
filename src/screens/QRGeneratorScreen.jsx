import React, { useEffect, useState } from 'react'
import { getUsers } from '../lib/db'
import styles from './QRGeneratorScreen.module.css'

const QR_API = (value, size) =>
  `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(value)}&size=${size}x${size}&bgcolor=ffffff&color=000000&margin=6`

function QRImage({ value, size = 200 }) {
  return <img src={QR_API(value, size)} alt={value} width={size} height={size} />
}

const CARD_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: sans-serif; background: #fff; }
  .card {
    width: 91mm; height: 55mm;
    position: relative;
    display: inline-flex; flex-direction: column;
    align-items: center; justify-content: center;
    border: 0.3mm solid #ccc;
    vertical-align: top;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .id { position: absolute; top: 4mm; left: 5mm; font-size: 10pt; font-weight: 700; color: #1a5fa8; letter-spacing: 0.04em; }
  .qr { width: 34mm; height: 34mm; }
  .name { margin-top: 1mm; font-size: 20pt; font-weight: 900; color: #1a5fa8; letter-spacing: 0.06em; }
`

function cardHtml(user) {
  return `<div class="card">
  <div class="id">${user.id}</div>
  <img class="qr" src="${QR_API(user.id, 400)}" />
  <div class="name">${user.name}</div>
</div>`
}

function openPrintWindow(users) {
  const isSingle = users.length === 1
  const win = window.open('', '_blank', 'width=700,height=500')

  const pageStyle = isSingle
    ? `@page { size: 91mm 55mm; margin: 0; }
       html, body { width: 91mm; height: 55mm; overflow: hidden; }`
    : `@page { margin: 8mm; }
       body { margin: 0; }
       .wrap { display: grid; grid-template-columns: repeat(auto-fill, 91mm); gap: 3mm; }`

  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  ${pageStyle}
  ${CARD_CSS}
</style>
</head><body>
${isSingle
    ? cardHtml(users[0])
    : `<div class="wrap">${users.map(cardHtml).join('')}</div>`
  }
</body></html>`)
  win.document.close()
  win.onload = () => { win.focus(); win.print(); win.close() }
}

function printOne(user) {
  openPrintWindow([user])
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
        <h2>QRコード一覧</h2>
        <button className={styles.printBtn} onClick={() => openPrintWindow(users)}>🖨 一括印刷</button>
      </div>

      <div className={styles.grid}>
        {users.map(user => (
          <div key={user.id} className={styles.cardWrap}>
            <div className={styles.card}>
              <QRImage value={user.id} size={180} />
              <div className={styles.name}>{user.name}</div>
              <div className={styles.userId}>{user.id}</div>
            </div>
            <button className={styles.singlePrintBtn} onClick={() => printOne(user)}>
              🖨 印刷
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
