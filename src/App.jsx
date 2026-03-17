import React, { useState, useEffect } from 'react'
import { initDB, saveLog, isCheckedIn } from './lib/db'
import ModeSelectScreen from './screens/ModeSelectScreen'
import QRScreen from './screens/QRScreen'
import WorkSelectScreen from './screens/WorkSelectScreen'
import CompleteScreen from './screens/CompleteScreen'
import AdminScreen from './screens/AdminScreen'
import styles from './App.module.css'

const STATE = {
  MODE: 'mode2',
  QR: 'qr',
  WORK: 'work',
  COMPLETE: 'complete',
  ADMIN: 'admin'
}

// Tap the admin area 5 times to open admin panel
const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_TIMEOUT = 3000

export default function App() {
  const [state, setState] = useState('mode2')
  const [mode, setMode] = useState(null)       // '出勤' or '退勤'
  const [currentUser, setCurrentUser] = useState(null)
  const [completedInfo, setCompletedInfo] = useState(null) // { logType, workTypes }
  const [error, setError] = useState(null)
  const [dbReady, setDbReady] = useState(false)
  const [adminTaps, setAdminTaps] = useState(0)
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
    initDB().then(() => setDbReady(true))
  }, [])

  function handleModeSelect(selectedMode) {
    setMode(selectedMode)
    setState(STATE.QR)
  }

  async function handleUserScanned(user) {
    if (mode === '出勤') {
      const alreadyIn = await isCheckedIn(user.id)
      if (alreadyIn) {
        setError(`${user.name} さんは出勤中です`)
        setTimeout(() => {
          setError(null)
          setMode(null)
          setState('mode2')
        }, 2500)
        return
      }
      // Save check-in immediately
      await saveLog({ userId: user.id, workType: '', logType: '出勤' })
      setCompletedInfo({ logType: '出勤', workTypes: [], user })
      setState(STATE.COMPLETE)
    } else {
      // 退勤 — go to work type selection
      setCurrentUser(user)
      setState(STATE.WORK)
    }
  }

  async function handleWorkComplete(selectedTypes) {
    await saveLog({
      userId: currentUser.id,
      workType: selectedTypes.join(','),
      logType: '退勤'
    })
    setCompletedInfo({ logType: '退勤', workTypes: selectedTypes, user: currentUser })
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

  // Secret admin entry: tap corner 5 times
  function handleAdminTap() {
    if (adminTapTimer.current) clearTimeout(adminTapTimer.current)

    const newCount = adminTaps + 1
    setAdminTaps(newCount)

    if (newCount >= ADMIN_TAP_COUNT) {
      setAdminTaps(0)
      setState(STATE.ADMIN)
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
          onDone={handleDone}
        />
      )}

      {error && (
        <div className={styles.errorOverlay}>
          <span className={styles.errorIcon}>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Secret admin button - tiny tap target in bottom-right corner */}
      {(state === STATE.MODE) && (
        <button
          className={styles.adminTrigger}
          onClick={handleAdminTap}
          aria-label="管理"
          title={adminTaps > 0 ? `あと${ADMIN_TAP_COUNT - adminTaps}回` : '管理'}
        >
          {adminTaps > 0 ? `${ADMIN_TAP_COUNT - adminTaps}` : '⚙'}
        </button>
      )}
    </div>
  )
}
