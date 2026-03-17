import React, { useState, useEffect } from 'react'
import { initDB } from './lib/db'
import QRScreen from './screens/QRScreen'
import WorkSelectScreen from './screens/WorkSelectScreen'
import CompleteScreen from './screens/CompleteScreen'
import AdminScreen from './screens/AdminScreen'
import styles from './App.module.css'

// App states
const STATE = {
  QR: 'qr',
  WORK: 'work',
  COMPLETE: 'complete',
  ADMIN: 'admin'
}

// Tap the admin area 5 times to open admin panel
const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_TIMEOUT = 3000

export default function App() {
  const [state, setState] = useState(STATE.QR)
  const [currentUser, setCurrentUser] = useState(null)
  const [workType, setWorkType] = useState(null)
  const [dbReady, setDbReady] = useState(false)
  const [adminTaps, setAdminTaps] = useState(0)
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
    initDB().then(() => setDbReady(true))
  }, [])

  function handleUserScanned(user) {
    setCurrentUser(user)
    setState(STATE.WORK)
  }

  function handleWorkComplete(type) {
    setWorkType(type)
    setState(STATE.COMPLETE)
  }

  function handleDone() {
    setCurrentUser(null)
    setWorkType(null)
    setState(STATE.QR)
  }

  function handleCancel() {
    setCurrentUser(null)
    setState(STATE.QR)
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
      {state === STATE.QR && (
        <QRScreen onUserScanned={handleUserScanned} />
      )}

      {state === STATE.WORK && currentUser && (
        <WorkSelectScreen
          user={currentUser}
          onComplete={handleWorkComplete}
          onCancel={handleCancel}
        />
      )}

      {state === STATE.COMPLETE && (
        <CompleteScreen workType={workType} onDone={handleDone} />
      )}

      {/* Secret admin button - tiny tap target in bottom-right corner */}
      {(state === STATE.QR) && (
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
