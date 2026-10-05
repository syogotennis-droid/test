import React, { useEffect, useState } from 'react'
import { getPendingCount, getFailedCount } from '../lib/db'

export default function SyncStatus() {
  const [pending, setPending] = useState(getPendingCount)
  const [failed, setFailed] = useState(getFailedCount)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const update = () => { setPending(getPendingCount()); setFailed(getFailedCount()); setOnline(navigator.onLine) }
    window.addEventListener('outbox-change', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('outbox-change', update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online && pending === 0 && failed === 0) return null

  const text = failed > 0 && online && pending === 0
    ? `未送信の打刻・入力が${failed}件あります。管理者に連絡（端末に保存済み）`
    : !online
    ? `オフライン：打刻は端末に保存し、接続回復後に自動送信${pending ? `（未送信 ${pending}件）` : ''}`
    : `未送信 ${pending}件 — 自動再送中`

  return (
    <div role="status" style={{ position: 'fixed', left: '50%', top: 6, transform: 'translateX(-50%)', zIndex: 150, maxWidth: 'calc(100vw - 32px)', pointerEvents: 'none', background: online ? '#fef3c7' : '#fee2e2', color: online ? '#92400e' : '#991b1b', border: `1px solid ${online ? '#fcd34d' : '#fca5a5'}`, borderRadius: 10, padding: '8px 12px', fontSize: '0.85rem', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      {text}
    </div>
  )
}
