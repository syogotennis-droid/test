import React, { useEffect, useState } from 'react'
import { getUsers } from '../lib/db'
import styles from './QRGeneratorScreen.module.css'

function QRImage({ value, size = 200 }) {
  const encoded = encodeURIComponent(value)
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&bgcolor=ffffff&color=000000&margin=6`}
      alt={value}
      width={size}
      height={size}
    />
  )
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
        <button className={styles.printBtn} onClick={() => window.print()}>🖨 印刷</button>
      </div>

      <div className={styles.preview}>
        <p className={styles.hint}>A4用紙に1ページ8枚（2列×4行）で印刷されます</p>
        <div className={styles.grid}>
          {users.map(user => (
            <div key={user.id} className={styles.card}>
              <div className={styles.cardLeft}>
                <div className={styles.cardId}>{user.id}</div>
                <div className={styles.cardName}>{user.name}</div>
              </div>
              <div className={styles.cardRight}>
                <QRImage value={user.id} size={160} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
