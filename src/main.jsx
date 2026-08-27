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
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    setError('')
    if (v.length === 4) {
      if (v === adminPin) { unlock() }
      else { setError('PINが違います'); setTimeout(() => { setPin(''); setError('') }, 800) }
    }
  }

  if (unlocked) return <AdminScreen onBack={() => setUnlocked(false)} />

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
        padding: '48px 44px 36px',
        width: 'min(440px, 92vw)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
        border: '1px solid #dde4ec',
        boxShadow: '0 4px 32px rgba(30,60,100,0.10)'
      }}>
        {/* Lock icon */}
        <div style={{
          width: 60, height: 60, borderRadius: 14,
          background: '#e8f0fb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        {/* Title */}
        <div style={{ fontWeight: 800, fontSize: '1.45rem', color: '#1a3f6f', marginBottom: 6, letterSpacing: '-0.01em' }}>
          管理画面ログイン
        </div>
        <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: 28 }}>
          管理用PINを入力してください
        </div>

        {/* PIN input */}
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="●●●●"
          style={{
            width: '100%', boxSizing: 'border-box',
            height: 58,
            textAlign: 'center', fontSize: '1.9rem', letterSpacing: '0.5em',
            border: error ? '2px solid #dc2626' : focused ? '2px solid #2563eb' : '2px solid #d1d5db',
            borderRadius: 10, padding: '0 12px',
            outline: 'none', fontFamily: 'inherit',
            boxShadow: focused ? '0 0 0 3px rgba(37,99,235,0.18)' : error ? '0 0 0 3px rgba(220,38,38,0.12)' : 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s'
          }}
        />

        {/* Fixed-height error area */}
        <div style={{ height: 22, marginTop: 8, textAlign: 'center' }}>
          {error && <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.875rem' }}>{error}</span>}
        </div>

        {/* Footer divider */}
        <div style={{ width: '100%', borderTop: '1px solid #e5e7eb', marginTop: 20, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af', letterSpacing: '0.03em' }}>管理者専用</span>
        </div>
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
