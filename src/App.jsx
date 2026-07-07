import React, { useState, useEffect } from 'react'
import { initDB, saveLog, isCheckedIn, getClockInTime, getAdminPin, DEFAULT_ADMIN_PIN } from './lib/db'
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
const ADMIN_TAP_TIMEOUT = 3000

function AdminPinOverlay({ onSuccess, onClose, adminPin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫']
  function press(k) {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (k === '') return
    if (pin.length >= 4) return
    setPin(p => p + k)
    setError('')
  }
  function confirm() {
    if (pin.length !== 4) { setError('4桁で入力してください'); return }
    if (pin === adminPin) { onSuccess() }
    else { setError('PINが違います'); setPin('') }
  }
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
      <div style={{background:'#fff',borderRadius:20,padding:'28px 24px 24px',width:'min(340px,92vw)',display:'flex',flexDirection:'column',gap:16}}>
        <div style={{textAlign:'center',fontWeight:800,fontSize:'1.1rem',color:'#1a3f6f'}}>管理画面 — PINを入力</div>
        <div style={{display:'flex',justifyContent:'center',gap:8,flexWrap:'wrap'}}>
          {Array.from({length:4}).map((_,i) => (
            <span key={i} style={{width:12,height:12,borderRadius:'50%',border:'2px solid #9baab8',background:i<pin.length?'#1a5fa8':'transparent',display:'inline-block'}}/>
          ))}
        </div>
        {error && <div style={{textAlign:'center',color:'#dc2626',fontWeight:700,fontSize:'0.9rem'}}>{error}</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {keys.map((k,i) => (
            <button key={i} onClick={() => press(k)} disabled={k===''} style={{height:56,border:'2px solid #e2e8f0',borderRadius:10,background:k==='⌫'?'#fee2e2':'#f8fafc',fontSize:'1.4rem',fontWeight:700,color:k==='⌫'?'#dc2626':'#1a3f6f',cursor:k===''?'default':'pointer',opacity:k===''?0:1}}>
              {k}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,height:44,border:'2px solid #d1d5db',borderRadius:10,background:'#fff',color:'#374151',fontWeight:700,cursor:'pointer'}}>キャンセル</button>
          <button onClick={confirm} disabled={pin.length !== 4} style={{flex:2,height:44,border:'none',borderRadius:10,background:'#1a5fa8',color:'#fff',fontWeight:800,fontSize:'1rem',cursor:'pointer',opacity:pin.length!==4?0.4:1}}>確認 →</button>
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
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
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
      setCurrentUser(user)
      setState(STATE.WORK)
    }
  }

  async function handleWorkComplete(workItems) {
    const clockIn = await getClockInTime(currentUser.id)
    await saveLog({
      userId: currentUser.id,
      workItems,
      logType: '退勤'
    })
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
    return <AdminScreen onBack={handleDone} />
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
          onSuccess={() => { setAdminPinMode(false); setState(STATE.ADMIN) }}
          onClose={() => { setAdminPinMode(false); setAdminTaps(0) }}
        />
      )}
    </div>
  )
}
