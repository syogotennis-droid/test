import React, { useState, useEffect } from 'react'
import { StatusBar, Style } from '@capacitor/status-bar'
import { initDB, adminLogin, adminLogout, isDeviceRegistered, startOutboxSync } from './lib/db'
import { handlePunch, finishClockOut } from './lib/punchFlow'
import ModeSelectScreen from './screens/ModeSelectScreen'
import QRScreen from './screens/QRScreen'
import WorkSelectScreen from './screens/WorkSelectScreen'
import CompleteScreen from './screens/CompleteScreen'
import AdminScreen from './screens/AdminScreen'
import EmployeeCalendarScreen from './screens/EmployeeCalendarScreen'
import DeviceSetupScreen from './screens/DeviceSetupScreen'
import SyncStatus from './screens/SyncStatus'
import styles from './App.module.css'

const STATE = {
  MODE: 'mode',
  QR: 'qr',
  WORK: 'work',
  COMPLETE: 'complete',
  ADMIN: 'admin',
  CHECK: 'check',
}

const ADMIN_TAP_COUNT = 1
const ADMIN_SESSION_KEY = 'adminSessionExpiry'
const ADMIN_SESSION_DURATION = 30 * 60 * 1000 // 30分
const ADMIN_TAP_TIMEOUT = 3000

function AdminPinOverlay({ onSuccess, onClose }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const inputRef = React.useRef(null)

  React.useEffect(() => { inputRef.current?.focus() }, [])

  async function handleChange(e) {
    if (checking) return
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    setError('')
    if (v.length === 4) {
      setChecking(true)
      const r = await adminLogin(v)
      setChecking(false)
      if (r.ok) onSuccess()
      else { setError(r.message); setPin('') }
    }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
      <div style={{background:'#fff',borderRadius:20,padding:'28px 24px 24px',width:'min(320px,88vw)',display:'flex',flexDirection:'column',gap:16}}>
        <div style={{textAlign:'center',fontWeight:800,fontSize:'1.1rem',color:'#1a3f6f'}}>管理画面 — PINを入力</div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
          placeholder="●●●●"
          style={{textAlign:'center',fontSize:'1.8rem',letterSpacing:'0.4em',border:'2px solid #d1d5db',borderRadius:10,padding:'12px',outline:'none',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}}
        />
        {error && <div style={{textAlign:'center',color:'#dc2626',fontWeight:700,fontSize:'0.9rem'}}>{error}</div>}
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,height:44,border:'2px solid #d1d5db',borderRadius:10,background:'#fff',color:'#374151',fontWeight:700,cursor:'pointer'}}>キャンセル</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(STATE.MODE)
  const [mode, setMode] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [completedInfo, setCompletedInfo] = useState(null)
  const [error, setError] = useState(null)
  const [dbReady, setDbReady] = useState(false)
  const [adminTaps, setAdminTaps] = useState(0)
  const [adminPinMode, setAdminPinMode] = useState(false)
  const [deviceReady, setDeviceReady] = useState(isDeviceRegistered)
  const [workCtx, setWorkCtx] = useState(null)
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
    StatusBar.hide().catch(() => {})
    const timer = setTimeout(() => setDbReady(true), 8000)
    initDB()
      .then(() => { clearTimeout(timer); setDbReady(true) })
      .catch(err => { clearTimeout(timer); console.error('DB init error:', err); setDbReady(true) })
    const onAuthRequired = e => {
      if (e.detail?.need === 'device') { setDeviceReady(false); return }
      try { localStorage.removeItem(ADMIN_SESSION_KEY) } catch {}
      setState(s => (s === STATE.ADMIN ? STATE.MODE : s))
    }
    window.addEventListener('auth-required', onAuthRequired)
    const stopSync = startOutboxSync()
    return () => {
      stopSync()
      clearTimeout(timer)
      window.removeEventListener('auth-required', onAuthRequired)
    }
  }, [])

  function handleModeSelect(selectedMode) {
    setMode(selectedMode)
    setState(STATE.QR)
  }

  function showError(message) {
    setError(message)
    setTimeout(() => {
      setError(null)
      setMode(null)
      setState(STATE.MODE)
    }, 2500)
  }

  async function handleUserScanned(user) {
    if (mode === '確認') {
      setCurrentUser(user)
      setState(STATE.CHECK)
      return
    }
    try {
      const r = await handlePunch(mode, user)
      if (r.kind === 'error') { showError(r.message); return }
      if (r.kind === 'complete') { setCompletedInfo(r.info); setState(STATE.COMPLETE); return }
      setWorkCtx(r.ctx)
      setCurrentUser(user)
      setState(STATE.WORK)
    } catch (e) {
      console.error(e)
      showError('記録できませんでした。もう一度お試しください')
    }
  }

  async function handleWorkComplete(workItems, options) {
    const info = await finishClockOut(workCtx, workItems, options)
    setCompletedInfo(info)
    setWorkCtx(null)
    setState(STATE.COMPLETE)
  }

  function handleDone() {
    setWorkCtx(null)
    setCurrentUser(null)
    setCompletedInfo(null)
    setMode(null)
    setState(STATE.MODE)
  }

  function handleCancel() {
    setCurrentUser(null)
    setMode(null)
    setState(STATE.MODE)
  }

  function handleAdminTap() {
    if (adminTapTimer.current) clearTimeout(adminTapTimer.current)
    const newCount = adminTaps + 1
    setAdminTaps(newCount)
    if (newCount >= ADMIN_TAP_COUNT) {
      // always ask for the PIN: an earlier admin login in this browser must not open it for an employee
      setAdminTaps(0)
      setAdminPinMode(true)
      return
    }
    adminTapTimer.current = setTimeout(() => {
      setAdminTaps(0)
    }, ADMIN_TAP_TIMEOUT)
  }

  if (!dbReady) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>起動中...</span>
      </div>
    )
  }

  if (!deviceReady) {
    return <DeviceSetupScreen onDone={() => setDeviceReady(true)} />
  }

  if (state === STATE.ADMIN) {
    return <AdminScreen isTablet={true} onBack={() => {
      try { localStorage.removeItem(ADMIN_SESSION_KEY) } catch {}
      adminLogout()
      handleDone()
    }} />
  }

  if (state === STATE.CHECK && currentUser) {
    return <EmployeeCalendarScreen user={currentUser} onBack={handleDone} />
  }

  return (
    <div className={styles.container}>
      {state === STATE.MODE && (
        <ModeSelectScreen onSelect={handleModeSelect} />
      )}

      {state === STATE.QR && (
        <QRScreen mode={mode} onUserScanned={handleUserScanned} onCancel={handleCancel} />
      )}

      {state === STATE.WORK && currentUser && workCtx && (
        <WorkSelectScreen
          user={currentUser}
          ctx={workCtx}
          onComplete={handleWorkComplete}
          onCancel={handleCancel}
        />
      )}

      {state === STATE.COMPLETE && completedInfo && (
        <CompleteScreen
          logType={completedInfo.logType}
          workItems={completedInfo.workItems}
          user={completedInfo.user}
          clockInTime={completedInfo.clockInTime}
          breakInfo={completedInfo.breakInfo}
          onDone={handleDone}
        />
      )}

      <SyncStatus />

      {error && (
        <div className={styles.errorOverlay}>
          <span className={styles.errorIcon}>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {state === STATE.MODE && (
        <button
          className={styles.adminTrigger}
          onClick={handleAdminTap}
          aria-label="管理"
          title={adminTaps > 0 ? `あと${ADMIN_TAP_COUNT - adminTaps}回` : '管理'}
        >
          {adminTaps > 0 ? `${ADMIN_TAP_COUNT - adminTaps}` : '⚙'}
        </button>
      )}

      {adminPinMode && (
        <AdminPinOverlay
          onSuccess={() => {
            try { localStorage.setItem(ADMIN_SESSION_KEY, String(Date.now() + ADMIN_SESSION_DURATION)) } catch {}
            setAdminPinMode(false)
            setState(STATE.ADMIN)
          }}
          onClose={() => { setAdminPinMode(false); setAdminTaps(0) }}
        />
      )}
    </div>
  )
}
