import React, { useEffect, useState } from 'react'
import { getPendingCount } from '../lib/db'

export default function SyncStatus() {
  const [pending, setPending] = useState(getPendingCount)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const update = () => { setPending(getPendingCount()); setOnline(navigator.onLine) }
    window.addEventListener('outbox-change', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('outbox-change', update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online && pending === 0) return null

  const text = !online
    ? `オフライン：打刻はこの端末に保存され、通信が戻ると自動で送信されます${pending ? `（未送信 ${pending}件）` : ''}`
    : `未送信の打刻 ${pending}件 — 自動で再送しています`

  return (
    <div role="status" style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 150, maxWidth: 'calc(100vw - 80px)', background: online ? '#fef3c7' : '#fee2e2', color: online ? '#92400e' : '#991b1b', border: `1px solid ${online ? '#fcd34d' : '#fca5a5'}`, borderRadius: 10, padding: '8px 12px', fontSize: '0.85rem', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      {text}
    </div>
  )
}
