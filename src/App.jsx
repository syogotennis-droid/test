import React, { useState, useEffect } from 'react'
import { initDB, saveLog, isCheckedIn, getClockInTime } from './lib/db'
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

const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_TIMEOUT = 3000

export default function App() {
  const [state, setState] = useState(STATE.MODE)
  const [mode, setMode] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [completedInfo, setCompletedInfo] = useState(null)
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

  async function handleWorkComplete(selectedTypes, workTypeStr) {
    const clockIn = await getClockInTime(currentUser.id)
    await saveLog({
      userId: currentUser.id,
      workType: workTypeStr || selectedTypes.join(','),
      logType: '退勤'
    })
    setCompletedInfo({
      logType: '退勤',
      workTypes: selectedTypes,
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
    </div>
  )
}
