import React, { useState, useEffect } from 'react'
import { initDB, saveLog, isCheckedIn, getClockInTime, resolveUserByPin } from './lib/db'
import ModeSelectScreen from './screens/ModeSelectScreen'
import QRScreen from './screens/QRScreen'
import WorkSelectScreen from './screens/WorkSelectScreen'
import CompleteScreen from './screens/CompleteScreen'
import AdminScreen from './screens/AdminScreen'
import EmployeeCalendarScreen from './screens/EmployeeCalendarScreen'
import styles from './App.module.css'
import pinStyles from './ConfirmPin.module.css'

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
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

function ConfirmPinOverlay({ onSubmit, onClose }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function pressKey(k) {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (k === '') return
    if (pin.length >= 8) return
    setPin(p => p + k)
    setError('')
  }

  async function handleSubmit() {
    if (!pin || loading) return
    setLoading(true)
    try {
      const user = await resolveUserByPin(pin)
      if (user) {
        onSubmit(user)
      } else {
        setError('PINが一致しません')
        setPin('')
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={pinStyles.overlay}>
      <div className={pinStyles.box}>
        <div className={pinStyles.header}>
          <span className={pinStyles.title}>勤務確認 — PINを入力</span>
        </div>
        <div className={pinStyles.dots}>
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span key={i} className={[pinStyles.dot, i < pin.length ? pinStyles.dotFilled : ''].join(' ')} />
          ))}
        </div>
        {error && <div className={pinStyles.error}>{error}</div>}
        <div className={pinStyles.grid}>
          {PIN_KEYS.map((k, i) => (
            <button
              key={i}
              type="button"
              className={[pinStyles.key, k === '⌫' ? pinStyles.keyDel : k === '' ? pinStyles.keyEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >
              {k}
            </button>
          ))}
        </div>
        <div className={pinStyles.actions}>
          <button type="button" className={pinStyles.cancel} onClick={onClose}>キャンセル</button>
          <button type="button" className={pinStyles.ok} onClick={handleSubmit} disabled={!pin || loading}>
            {loading ? '確認中...' : '確認'}
          </button>
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
  const [confirmPinOpen, setConfirmPinOpen] = useState(false)
  const adminTapTimer = React.useRef(null)

  useEffect(() => {
    initDB().then(() => setDbReady(true))
  }, [])

  function handleModeSelect(selectedMode) {
    if (selectedMode === '確認') {
      setConfirmPinOpen(true)
      return
    }
    setMode(selectedMode)
    setState(STATE.QR)
  }

  function handleConfirmPinSubmit(user) {
    setConfirmPinOpen(false)
    setCurrentUser(user)
    setState(STATE.CHECK)
  }

  async function handleUserScanned(user) {
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

      {confirmPinOpen && (
        <ConfirmPinOverlay
          onSubmit={handleConfirmPinSubmit}
          onClose={() => setConfirmPinOpen(false)}
        />
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
