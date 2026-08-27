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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#f6fbf8' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px 24px', width: 'min(340px, 92vw)', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.3rem', color: '#1a3f6f' }}>管理画面 — PINを入力</div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={handleChange}
          placeholder="●●●●"
          style={{ textAlign: 'center', fontSize: '1.8rem', letterSpacing: '0.4em', border: '2px solid #d1d5db', borderRadius: 10, padding: '12px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
        />
        {error && <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
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
