import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import TabletApp from './tablet/TabletApp.jsx'
import AdminScreen from './screens/AdminScreen.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { getAdminPin, DEFAULT_ADMIN_PIN } from './lib/db.js'
import './styles/global.css'

const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

function AdminRoute() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [adminPin, setAdminPin] = useState(DEFAULT_ADMIN_PIN)

  useEffect(() => { getAdminPin().then(p => setAdminPin(p)) }, [])

  if (unlocked) return <AdminScreen onBack={() => setUnlocked(false)} />

  function press(k) {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (k === '') return
    if (pin.length >= 4) return
    const next = pin + k
    setPin(next)
    if (next.length === 4) {
      if (next === adminPin) { setUnlocked(true) }
      else { setError('PINが違います'); setTimeout(() => { setPin(''); setError('') }, 800) }
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#f6fbf8' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px 24px', width: 'min(340px, 92vw)', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.3rem', color: '#1a3f6f' }}>管理画面</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #9baab8', background: i < pin.length ? '#1a5fa8' : 'transparent', display: 'inline-block' }} />
          ))}
        </div>
        {error && <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {PIN_KEYS.map((k, i) => (
            <button key={i} onClick={() => press(k)} disabled={k === ''} style={{ height: 56, border: '2px solid #e2e8f0', borderRadius: 10, background: k === '⌫' ? '#fee2e2' : '#f8fafc', fontSize: '1.4rem', fontWeight: 700, color: k === '⌫' ? '#dc2626' : '#1a3f6f', cursor: k === '' ? 'default' : 'pointer', opacity: k === '' ? 0 : 1 }}>
              {k}
            </button>
          ))}
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
