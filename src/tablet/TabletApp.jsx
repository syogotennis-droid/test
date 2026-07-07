import React, { useState, useEffect, useRef } from 'react'
import { initDB, saveLog, isCheckedIn, getClockInTime, getAdminPin, DEFAULT_ADMIN_PIN } from '../lib/db'
import ModeSelectScreen from '../screens/ModeSelectScreen'
import QRScreen from '../screens/QRScreen'
import WorkSelectScreen from '../screens/WorkSelectScreen'
import CompleteScreen from '../screens/CompleteScreen'
import AdminScreen from '../screens/AdminScreen'
import EmployeeCalendarScreen from '../screens/EmployeeCalendarScreen'
import styles from './TabletApp.module.css'

const STATE = {
  LOADING: 'loading',
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

export default function TabletApp() {
  const [state, setState] = useState(STATE.LOADING)
  const [mode, setMode] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [completedInfo, setCompletedInfo] = useState(null)
  const [flashError, setFlashError] = useState(null)
  const [networkError, setNetworkError] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [adminTaps, setAdminTaps] = useState(0)
  const [adminPinMode, setAdminPinMode] = useState(false)
  const [currentAdminPin, setCurrentAdminPin] = useState(DEFAULT_ADMIN_PIN)
  const adminTapTimer = useRef(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setNetworkError('接続タイムアウト。Firestoreのルール期限切れかネットワークを確認してください。')
      setState(STATE.MODE)
    }, 10000)
    initDB()
      .then(() => { clearTimeout(timer); setState(STATE.MODE) })
      .catch(e => { clearTimeout(timer); setNetworkError('初期化エラー: ' + (e?.message || e)); setState(STATE.MODE) })
    getAdminPin().then(p => setCurrentAdminPin(p))

    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  function showFlash(msg) {
    setFlashError(msg)
    setTimeout(() => setFlashError(null), 2800)
  }

  function resetToMode() {
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
    adminTapTimer.current = setTimeout(() => setAdminTaps(0), ADMIN_TAP_TIMEOUT)
  }

  function handleModeSelect(selectedMode) {
    setMode(selectedMode)
    setState(STATE.QR)
  }

  async function handleUserScanned(user) {
    try {
      if (mode === '確認') {
        setCurrentUser(user)
        setState(STATE.CHECK)
        return
      }
      if (mode === '出勤') {
        const alreadyIn = await isCheckedIn(user.id)
        if (alreadyIn) {
          showFlash(`${user.name} さんはすでに出勤中です`)
          setTimeout(resetToMode, 2800)
          return
        }
        await saveLog({ userId: user.id, workType: '', logType: '出勤' })
        setCompletedInfo({ logType: '出勤', workTypes: [], user })
        setState(STATE.COMPLETE)
      } else {
        const checkedIn = await isCheckedIn(user.id)
        if (!checkedIn) {
          showFlash(`${user.name} さんはまだ出勤していません`)
          setTimeout(resetToMode, 2800)
          return
        }
        setCurrentUser(user)
        setState(STATE.WORK)
      }
    } catch (e) {
      setNetworkError('通信エラーが発生しました。ネットワークを確認してください。')
    }
  }

  async function handleWorkComplete(workItems) {
    try {
      const clockIn = await getClockInTime(currentUser.id)
      await saveLog({ userId: currentUser.id, workItems, logType: '退勤' })
      setCompletedInfo({
        logType: '退勤',
        workTypes: Object.keys(workItems).filter(k => workItems[k] > 0),
        user: currentUser,
        clockInTime: clockIn?.time,
        clockInTimestamp: clockIn?.timestamp,
      })
      setState(STATE.COMPLETE)
    } catch (e) {
      setNetworkError('退勤の保存に失敗しました。ネットワークを確認してください。')
    }
  }

  function handleDone() {
    setCurrentUser(null)
    setCompletedInfo(null)
    setMode(null)
    setNetworkError(null)
    setState(STATE.MODE)
  }

  if (state === STATE.LOADING) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>起動中...</span>
        {networkError && (
          <div className={styles.loadingError}>
            <p>{networkError}</p>
            <button onClick={() => window.location.reload()}>再読み込み</button>
          </div>
        )}
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
    <div className={styles.root}>
      {/* オフライン・通信エラーバナー */}
      {(!isOnline || networkError) && (
        <div className={styles.networkBanner}>
          <span className={styles.bannerIcon}>{!isOnline ? '📡' : '⚠️'}</span>
          <span className={styles.bannerText}>
            {!isOnline ? 'オフライン — ネットワークに接続してください' : networkError}
          </span>
          {networkError && (
            <button className={styles.bannerClose} onClick={() => setNetworkError(null)}>✕</button>
          )}
        </div>
      )}

      {state === STATE.MODE && (
        <ModeSelectScreen onSelect={handleModeSelect} />
      )}

      {state === STATE.QR && (
        <QRScreen mode={mode} onUserScanned={handleUserScanned} onCancel={resetToMode} />
      )}

      {state === STATE.WORK && currentUser && (
        <WorkSelectScreen
          user={currentUser}
          onComplete={handleWorkComplete}
          onCancel={resetToMode}
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

      {/* 管理画面への隠しボタン（打刻画面のみ表示、5回タップで開く） */}
      {state === STATE.MODE && (
        <button
          className={styles.adminTrigger}
          onClick={handleAdminTap}
          aria-label="管理"
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

      {/* 一時エラー（出勤済み・未出勤など） */}
      {flashError && (
        <div className={styles.flashOverlay}>
          <span className={styles.flashIcon}>⚠️</span>
          <span className={styles.flashText}>{flashError}</span>
        </div>
      )}
    </div>
  )
}
