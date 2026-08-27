import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import TabletApp from './tablet/TabletApp.jsx'
import AdminScreen from './screens/AdminScreen.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { getAdminPin, DEFAULT_ADMIN_PIN } from './lib/db.js'
import './styles/global.css'

const ADMIN_SESSION_KEY = 'adminSessionExpiry'
const ADMIN_SESSION_DURATION = 30 * 60 * 1000

function AdminRoute() {
  const [adminPin, setAdminPin] = useState(DEFAULT_ADMIN_PIN)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [checking, setChecking] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = React.useRef(null)

  const isSessionValid = () => {
    try { const e = localStorage.getItem(ADMIN_SESSION_KEY); return e && Date.now() < Number(e) } catch { return false }
  }
  const [unlocked, setUnlocked] = useState(() => isSessionValid())

  useEffect(() => { getAdminPin().then(p => setAdminPin(p)) }, [])
  useEffect(() => { if (!unlocked) setTimeout(() => inputRef.current?.focus(), 50) }, [unlocked])

  function unlock() {
    try { localStorage.setItem(ADMIN_SESSION_KEY, String(Date.now() + ADMIN_SESSION_DURATION)) } catch {}
    setUnlocked(true)
  }

  function handleChange(e) {
    const v = e.target.value
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\D/g, '')
      .slice(0, 4)
    setPin(v)
    if (error) setError('')
  }

  function handleSubmit() {
    if (pin.length < 4 || checking) return
    setChecking(true)
    if (pin === adminPin) {
      unlock()
    } else {
      setError('PINが正しくありません。もう一度入力してください。')
      setPin('')
      setChecking(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  if (unlocked) return <AdminScreen onBack={() => {
    try { localStorage.removeItem(ADMIN_SESSION_KEY) } catch {}
    setUnlocked(false)
    setPin('')
    setError('')
    setChecking(false)
    setShowPin(false)
    setFocused(false)
  }} />

  const hasError = !!error
  const canSubmit = pin.length === 4 && !checking
  const borderColor = hasError ? '#dc2626' : focused ? '#2563eb' : '#d1d5db'
  const inputShadow = focused
    ? (hasError ? '0 0 0 3px rgba(220,38,38,0.14)' : '0 0 0 3px rgba(37,99,235,0.16)')
    : 'none'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100dvh',
      background: 'linear-gradient(160deg, #ffffff 0%, #e8f0f7 100%)',
      fontFamily: 'inherit'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 14,
        padding: '32px 36px 28px',
        width: 'min(400px, 92vw)',
        border: '1px solid #dde4ec',
        boxShadow: '0 2px 16px rgba(30,60,100,0.08)'
      }}>
        {/* Lock icon */}
        <div style={{ marginBottom: 12, lineHeight: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        {/* Title */}
        <div style={{ fontWeight: 800, fontSize: '1.4rem', color: '#111827', marginBottom: 5 }}>
          管理画面ログイン
        </div>
        <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 24 }}>
          管理用PINを入力してください
        </div>

        {/* Label */}
        <label
          htmlFor="admin-pin-input"
          style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}
        >
          管理用PIN
        </label>

        {/* Input + eye toggle */}
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            id="admin-pin-input"
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleSubmit() }
              else if (e.key === 'Escape') { e.preventDefault(); setPin(''); setError('') }
            }}
            placeholder="4桁のPINを入力"
            style={{
              width: '100%', boxSizing: 'border-box',
              height: 50,
              fontSize: '1rem',
              paddingLeft: 12, paddingRight: 44,
              border: `1.5px solid ${borderColor}`,
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              background: '#fff',
              color: '#111827',
              boxShadow: inputShadow,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          />
          {/* Show / hide toggle */}
          <button
            type="button"
            tabIndex={0}
            onMouseDown={e => e.preventDefault()}
            onClick={() => setShowPin(v => !v)}
            aria-label={showPin ? 'PINを隠す' : 'PINを表示'}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4, lineHeight: 0,
            }}
          >
            {showPin ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <path d="m14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </div>

        {/* Error area (reserved height prevents layout shift) */}
        <div style={{ minHeight: 24, marginTop: 6, marginBottom: 14 }}>
          {hasError && (
            <span style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 500 }}>
              {error}
            </span>
          )}
        </div>

        {/* Login button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: '100%',
            height: 46,
            background: canSubmit ? '#2563eb' : '#bfdbfe',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: '0.95rem',
            fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = '#1d4ed8' }}
          onMouseLeave={e => { if (canSubmit) e.currentTarget.style.background = '#2563eb' }}
          onFocus={e => { e.currentTarget.style.outline = '2px solid #2563eb'; e.currentTarget.style.outlineOffset = '2px' }}
          onBlur={e => { e.currentTarget.style.outline = 'none' }}
        >
          {checking ? '確認中…' : 'ログイン'}
        </button>
      </div>
    </div>
  )
}

// Capacitorネイティブ（Android APK）は常にタブレットモード
const isNative = !!(window?.Capacitor?.isNativePlatform?.())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isNative ? (
        <TabletApp />
      ) : (
        <BrowserRouter>
          <Routes>
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="/tablet/*" element={<TabletApp />} />
            <Route path="/*" element={<App />} />
          </Routes>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>
)
