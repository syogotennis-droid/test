import React, { useState } from 'react'
import { adminLogin, needsServerOrigin, getServerOrigin, setServerOrigin } from '../lib/db'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export default function DeviceSetupScreen({ onDone }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const askUrl = needsServerOrigin()
  const [url, setUrl] = useState(getServerOrigin)

  function press(k) {
    if (checking || k === '') return
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (pin.length >= 4) return
    setPin(p => p + k)
    setError('')
  }

  async function confirm() {
    if (pin.length !== 4 || checking) return
    if (askUrl && !url.trim()) { setError('サーバーのURLを入力してください'); return }
    if (askUrl) setUrl(setServerOrigin(url))
    setChecking(true)
    const r = await adminLogin(pin, { device: true })
    setChecking(false)
    if (r.ok) onDone()
    else { setError(askUrl && r.message.startsWith('通信できません') ? 'サーバーに接続できません。URLとネット接続を確認してください' : r.message); setPin('') }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px 24px', width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 2px 16px rgba(30,60,100,0.08)' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.15rem', color: '#1a3f6f' }}>この端末を打刻用に登録</div>
        <div style={{ fontSize: '0.85rem', color: '#4b5563', lineHeight: 1.6 }}>
          この端末はまだ登録されていません。管理者PINを入力すると、この端末で打刻できるようになります。登録は最初の1回だけです。
        </div>
        {askUrl && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem', fontWeight: 700, color: '#374151' }}>
            サーバーのURL
            <input
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              value={url}
              onChange={e => { setUrl(e.target.value); setError('') }}
              placeholder="https://〇〇.pages.dev"
              style={{ height: 44, border: '1.5px solid #d1d5db', borderRadius: 8, padding: '0 10px', fontSize: '0.95rem', fontFamily: 'inherit' }}
            />
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #9baab8', background: i < pin.length ? '#1a5fa8' : 'transparent', display: 'inline-block' }} />
          ))}
        </div>
        {error && <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {KEYS.map((k, i) => (
            <button key={i} onClick={() => press(k)} disabled={k === ''} style={{ height: 56, border: '2px solid #e2e8f0', borderRadius: 10, background: k === '⌫' ? '#fee2e2' : '#f8fafc', fontSize: '1.4rem', fontWeight: 700, color: k === '⌫' ? '#dc2626' : '#1a3f6f', cursor: k === '' ? 'default' : 'pointer', opacity: k === '' ? 0 : 1 }}>
              {k}
            </button>
          ))}
        </div>
        <button onClick={confirm} disabled={pin.length !== 4 || checking} style={{ height: 48, border: 'none', borderRadius: 10, background: '#1a5fa8', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', opacity: pin.length !== 4 || checking ? 0.4 : 1 }}>
          {checking ? '確認中…' : '登録する'}
        </button>
      </div>
    </div>
  )
}
