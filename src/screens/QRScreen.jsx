import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { resolveUser } from '../lib/db'
import styles from './QRScreen.module.css'

export default function QRScreen({ onUserScanned }) {
  const scannerRef = useRef(null)
  const instanceRef = useRef(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    const qrId = 'qr-reader'
    const qr = new Html5Qrcode(qrId)
    instanceRef.current = qr

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 280 },
      aspectRatio: 1.0
    }

    qr.start(
      { facingMode: 'environment' },
      config,
      handleScan,
      () => {}
    )
      .then(() => setScanning(true))
      .catch(err => {
        console.error(err)
        setError('カメラへのアクセスが許可されていません。\nブラウザの設定でカメラを許可してください。')
      })

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
        // Unknown QR — show brief error then resume
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

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <div className={styles.icon}>📱</div>
        <h1>QRをかざしてください</h1>
        <p>個人QRコードを読み取ります</p>
      </div>

      <div className={styles.scannerWrap}>
        <div id="qr-reader" className={styles.scanner} ref={scannerRef} />
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
          </div>
        )}
      </div>

      <p className={styles.hint}>
        QRコードを枠内に合わせると自動で読み取ります
      </p>
    </div>
  )
}
