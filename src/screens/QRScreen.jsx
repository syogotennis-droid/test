import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { resolveUser, resolveUserByPin } from '../lib/db'
import styles from './QRScreen.module.css'

const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

function PinOverlay({ mode, onSubmit, onClose }) {
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
    <div className={styles.pinOverlay}>
      <div className={styles.pinBox}>
        <div className={styles.pinHeader}>
          <span className={styles.pinIcon}>{mode === '出勤' ? '🟢' : '🔴'}</span>
          <span className={styles.pinTitle}>{mode} — PINを入力</span>
        </div>

        <div className={styles.pinDots}>
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span key={i} className={[styles.pinDot, i < pin.length ? styles.pinDotFilled : ''].join(' ')} />
          ))}
        </div>

        {error && <div className={styles.pinError}>{error}</div>}

        <div className={styles.pinGrid}>
          {PIN_KEYS.map((k, i) => (
            <button
              key={i}
              className={[styles.pinKey, k === '⌫' ? styles.pinKeyDel : k === '' ? styles.pinKeyEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >
              {k}
            </button>
          ))}
        </div>

        <div className={styles.pinActions}>
          <button className={styles.pinCancel} onClick={onClose}>キャンセル</button>
          <button
            className={styles.pinOk}
            onClick={handleSubmit}
            disabled={!pin || loading}
          >
            {loading ? '確認中...' : '確認'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function QRScreen({ mode, onUserScanned, onCancel }) {
  const scannerRef = useRef(null)
  const instanceRef = useRef(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [pinMode, setPinMode] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const qrId = 'qr-reader'
    let qr
    try {
      qr = new Html5Qrcode(qrId)
    } catch (err) {
      setError('カメラを初期化できませんでした。\nPINで入力してください。\n(' + (err?.message || String(err)) + ')')
      return
    }
    instanceRef.current = qr

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 280 },
      aspectRatio: 1.0
    }

    const startWithSpec = (spec) => qr.start(spec, config, handleScan, () => {})

    const handleCameraError = (err) => {
      console.error(err)
      const msg = err?.message || ''
      if (msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed') || msg.includes('NotFound')) {
        setError('カメラへのアクセスが許可されていません。\nPINで入力するか、ブラウザのカメラ権限を確認してください。')
      } else {
        setError(`カメラを起動できませんでした。\nPINで入力するか、ページを再読み込みしてください。\n(${msg})`)
      }
    }

    // Try to enumerate cameras and pick front-facing one explicitly (more reliable on Android)
    Html5Qrcode.getCameras()
      .then(cameras => {
        if (!cameras || cameras.length === 0) throw new Error('no cameras')
        // Look for front camera by label, otherwise take last camera (front is usually last on Android)
        const front = cameras.find(c => /front|selfie|user/i.test(c.label))
          || (cameras.length > 1 ? cameras[cameras.length - 1] : null)
          || cameras[0]
        return startWithSpec(front.id)
      })
      .catch(() => startWithSpec({ facingMode: 'user' }))
      .catch(() => startWithSpec({ facingMode: 'environment' }))
      .catch(() => startWithSpec(true))
      .then(() => setScanning(true))
      .catch(handleCameraError)

    return () => {
      qr.isScanning && qr.stop().catch(() => {})
    }
  }, [])

  async function handleScan(decoded) {
    if (processingRef.current) return
    processingRef.current = true

    try {
      const user = await resolveUser(decoded.trim())
      if (user) {
        if (instanceRef.current?.isScanning) {
          await instanceRef.current.stop()
        }
        onUserScanned(user)
      } else {
        setError(`未登録のQRコードです:\n${decoded}`)
        setTimeout(() => {
          setError(null)
          processingRef.current = false
        }, 2000)
      }
    } catch (e) {
      processingRef.current = false
    }
  }

  async function handlePinSubmit(user) {
    if (instanceRef.current?.isScanning) {
      await instanceRef.current.stop()
    }
    onUserScanned(user)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1>
          <span className={mode === '出勤' ? styles.modeIn : styles.modeOut}>{mode}</span>
          <span className={styles.headerSub}> — QRコードを枠内に収めてください</span>
        </h1>
      </div>

      <div className={styles.scannerWrap}>
        <div id="qr-reader" className={styles.scanner} ref={scannerRef} />
        {/* ガイド枠 */}
        <svg className={styles.scanGuide} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <path d="M25,35 L25,25 L35,25" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          <path d="M65,25 L75,25 L75,35" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          <path d="M25,65 L25,75 L35,75" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          <path d="M65,75 L75,75 L75,65" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
        {!scanning && !error && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>カメラを起動中...</span>
          </div>
        )}
        {error && (
          <div className={styles.errorOverlay}>
            <span className={styles.errorIcon}>⚠️</span>
            <span style={{ whiteSpace: 'pre-line' }}>{error}</span>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 14, cursor: 'pointer' }}
            >
              再読み込み
            </button>
          </div>
        )}
      </div>

      <div className={styles.bottomBtns}>
        <button className={styles.backBtn} onClick={onCancel}>← 戻る</button>
        <button className={styles.pinBtn} onClick={() => setPinMode(true)}>🔢 PINで入力</button>
      </div>

      {pinMode && (
        <PinOverlay
          mode={mode}
          onSubmit={handlePinSubmit}
          onClose={() => setPinMode(false)}
        />
      )}
    </div>
  )
}
