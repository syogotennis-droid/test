import React, { useState } from 'react'
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
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  if (unlocked) {
    return <AdminScreen onBack={() => setUnlocked(false)} />
  }

  function press(k) {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (k === '') return
    if (pin.length >= 6) return
    const next = pin + k
    setPin(next)
    setError('')
    if (next.length === 6) {
      if (next === ADMIN_PIN) { setUnlocked(true) }
      else { setError('PINが違います'); setPin('') }
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: '#f6fbf8' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '36px 32px 32px', width: 'min(380px, 92vw)', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.3rem', color: '#1a3f6f' }}>管理画面</div>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '0.95rem' }}>PINを入力してください</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #9baab8', background: i < pin.length ? '#1a5fa8' : 'transparent', display: 'inline-block' }} />
          ))}
        </div>
        {error && <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {keys.map((k, i) => (
            <button key={i} onClick={() => press(k)} disabled={k === ''} style={{ height: 64, border: '2px solid #e2e8f0', borderRadius: 12, background: k === '⌫' ? '#fee2e2' : '#f8fafc', fontSize: '1.6rem', fontWeight: 700, color: k === '⌫' ? '#dc2626' : '#1a3f6f', cursor: k === '' ? 'default' : 'pointer', opacity: k === '' ? 0 : 1 }}>
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
