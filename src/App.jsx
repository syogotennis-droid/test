import React, { useState, useEffect } from 'react'
import { StatusBar, Style } from '@capacitor/status-bar'
import { initDB, saveLog, isCheckedIn, getClockInTime, getLogs, getAdminPin, DEFAULT_ADMIN_PIN, saveWorkReport, saveSessionWorkReport } from './lib/db'
import ModeSelectScreen from './screens/ModeSelectScreen'
import QRScreen from './screens/QRScreen'
import WorkSelectScreen from './screens/WorkSelectScreen'
import CompleteScreen from './screens/CompleteScreen'
import AdminScreen from './screens/AdminScreen'
import EmployeeCalendarScreen from './screens/EmployeeCalendarScreen'
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

function AdminPinOverlay({ onSuccess, onClose, adminPin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const inputRef = React.useRef(null)

  React.useEffect(() => { inputRef.current?.focus() }, [])

  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    setError('')
    if (v.length === 4) {
      if (v === adminPin) { onSuccess() }
      else { setError('PINが違います'); setPin('') }
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
  const [currentAdminPin, setCurrentAdminPin] = useState(DEFAULT_ADMIN_PIN)
  const [todaySessionCount, setTodaySessionCount] = useState(1)
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
    StatusBar.hide().catch(() => {})
    const timer = setTimeout(() => setDbReady(true), 8000)
    initDB()
      .then(() => { clearTimeout(timer); setDbReady(true) })
      .catch(err => { clearTimeout(timer); console.error('DB init error:', err); setDbReady(true) })
    getAdminPin().then(p => setCurrentAdminPin(p))
    return () => clearTimeout(timer)
  }, [])

  function handleModeSelect(selectedMode) {
    setMode(selectedMode)
    setState(STATE.QR)
  }

  async function handleUserScanned(user) {
    if (mode === '確認') {
      setCurrentUser(user)
      setState(STATE.CHECK)
      return
    }
    if (mode === '出勤') {
      const alreadyIn = await isCheckedIn(user.id)
      if (alreadyIn) {
        setError(`${user.name} さんは出勤中です`)
        setTimeout(() => {
          setError(null)
          setMode(null)
          setState(STATE.MODE)
        }, 2500)
        return
      }
      await saveLog({ userId: user.id, workType: '', logType: '出勤' })
      setCompletedInfo({ logType: '出勤', workTypes: [], user })
      setState(STATE.COMPLETE)
    } else {
      const checkedIn = await isCheckedIn(user.id)
      if (!checkedIn) {
        setError(`${user.name} さんはまだ出勤していません`)
        setTimeout(() => {
          setError(null)
          setMode(null)
          setState(STATE.MODE)
        }, 2500)
        return
      }
      if (user.employeeType === 'salaried') {
        const clockIn = await getClockInTime(user.id)
        await saveLog({ userId: user.id, workItems: {}, logType: '退勤' })
        setCompletedInfo({ logType: '退勤', workTypes: [], user, clockInTime: clockIn?.time, clockInTimestamp: clockIn?.timestamp })
        setState(STATE.COMPLETE)
        return
      }
      // Count today's completed sessions and get current check-in session_id
      try {
        const today = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const todayLogs = await getLogs({ dateFrom: today, dateTo: today })
        const userTodayLogs = todayLogs.filter(l => l.user_id === user.id)
        const outs = userTodayLogs.filter(l => l.log_type === '退勤').length
        setTodaySessionCount(outs + 1) // completed so far + this new one
      } catch { setTodaySessionCount(1) }
      // Read session_id from the current check-in log
      try {
        const clockInLog = await getClockInTime(user.id)
        setCurrentSessionId(clockInLog?.session_id || null)
      } catch { setCurrentSessionId(null) }
      setCurrentUser(user)
      setState(STATE.WORK)
    }
  }

  async function handleWorkComplete(workItems) {
    const clockIn = await getClockInTime(currentUser.id)
    const today = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await saveLog({ userId: currentUser.id, logType: '退勤', sessionId: currentSessionId })
    if (currentSessionId) {
      await saveSessionWorkReport(currentUser.id, today, currentSessionId, workItems)
    } else {
      await saveWorkReport(currentUser.id, today, workItems)
    }
    setCompletedInfo({
      logType: '退勤',
      workTypes: Object.keys(workItems).filter(k => workItems[k] > 0),
      user: currentUser,
      clockInTime: clockIn?.time,
      clockInTimestamp: clockIn?.timestamp
    })
    setState(STATE.COMPLETE)
  }

  function handleDone() {
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
      setAdminTaps(0)
      try {
        const expiry = localStorage.getItem(ADMIN_SESSION_KEY)
        if (expiry && Date.now() < Number(expiry)) {
          setState(STATE.ADMIN)
          return
        }
      } catch {}
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

  if (state === STATE.ADMIN) {
    return <AdminScreen isTablet={true} onBack={() => {
      try { localStorage.removeItem(ADMIN_SESSION_KEY) } catch {}
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

      {state === STATE.WORK && currentUser && (
        <WorkSelectScreen
          user={currentUser}
          onComplete={handleWorkComplete}
          onCancel={handleCancel}
          sessionCount={todaySessionCount}
        />
      )}

      {state === STATE.COMPLETE && completedInfo && (
        <CompleteScreen
          logType={completedInfo.logType}
          workTypes={completedInfo.workTypes}
          user={completedInfo.user}
          clockInTime={completedInfo.clockInTime}
          clockInTimestamp={completedInfo.clockInTimestamp}
          onDone={handleDone}
        />
      )}

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
          adminPin={currentAdminPin}
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
