import React, { useEffect, useRef, useState } from 'react'
import { getUsers } from '../lib/db'
import styles from './QRGeneratorScreen.module.css'

// Simple QR code display using a public API
// In production, generate offline with a library
function QRImage({ value, size = 200 }) {
  const encoded = encodeURIComponent(value)
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&bgcolor=ffffff&color=000000&margin=10`}
      alt={value}
      width={size}
      height={size}
      className={styles.qrImage}
    />
  )
}

export default function QRGeneratorScreen({ onBack }) {
  const [users, setUsers] = useState([])

  useEffect(() => {
    getUsers().then(setUsers)
  }, [])

  function handlePrint() {
    window.print()
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>←</button>
        <h2>QRコード一覧</h2>
        <button className={styles.printBtn} onClick={handlePrint}>🖨 印刷</button>
      </div>

      <div className={styles.grid}>
        {users.map(user => (
          <div key={user.id} className={styles.card}>
            <QRImage value={user.id} size={180} />
            <div className={styles.name}>{user.name}</div>
            <div className={styles.userId}>{user.id}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
