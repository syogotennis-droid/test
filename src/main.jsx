import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import TabletApp from './tablet/TabletApp.jsx'
import AdminScreen from './screens/AdminScreen.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './styles/global.css'

const ADMIN_PIN = '260701'

function AdminRoute() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  if (unlocked) {
    return <AdminScreen onBack={() => setUnlocked(false)} />
  }

  function handleChange(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPin(val)
    setError('')
    if (val.length === 6) {
      if (val === ADMIN_PIN) { setUnlocked(true) }
      else { setError('PINが違います'); setPin('') }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && pin === ADMIN_PIN) setUnlocked(true)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#f6fbf8' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '48px 40px 40px', width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column', gap: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.5rem', color: '#1a3f6f' }}>管理画面</div>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '1rem' }}>PINを入力してください（テンキー対応）</div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          maxLength={6}
          placeholder="••••••"
          style={{ height: 56, fontSize: '1.8rem', textAlign: 'center', letterSpacing: '0.4em', border: '2px solid #e2e8f0', borderRadius: 12, outline: 'none', padding: '0 16px', color: '#1a3f6f', background: '#f8fafc', width: '100%', boxSizing: 'border-box' }}
          autoComplete="off"
        />
        {error && <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: '1rem' }}>{error}</div>}
        <button
          onClick={() => { if (pin === ADMIN_PIN) setUnlocked(true); else { setError('PINが違います'); setPin('') } }}
          style={{ height: 52, background: '#1a5fa8', border: 'none', borderRadius: 12, color: '#fff', fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer' }}
        >
          入力
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
