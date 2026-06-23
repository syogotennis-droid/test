import React, { useState, useEffect, useRef } from 'react'
import { initDB, saveLog, isCheckedIn, getClockInTime } from '../lib/db'
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

const ADMIN_TAP_COUNT = 5
const ADMIN_TAP_TIMEOUT = 3000

export default function TabletApp() {
  const [state, setState] = useState(STATE.LOADING)
  const [mode, setMode] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [completedInfo, setCompletedInfo] = useState(null)
  const [flashError, setFlashError] = useState(null)
  const [networkError, setNetworkError] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [adminTaps, setAdminTaps] = useState(0)
  const adminTapTimer = useRef(null)

  useEffect(() => {
    initDB()
      .then(() => setState(STATE.MODE))
      .catch(e => setNetworkError('初期化エラー: ' + (e?.message || e)))

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
      setState(STATE.ADMIN)
      return
    }
    adminTapTimer.current = setTimeout(() => setAdminTaps(0), ADMIN_TAP_TIMEOUT)
  }

  function handleModeSelect(selectedMode) {
    if (selectedMode === '確認') return
    setMode(selectedMode)
    setState(STATE.QR)
  }

  async function handleUserScanned(user) {
    try {
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
