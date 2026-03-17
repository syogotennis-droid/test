import React, { useState } from 'react'
import { saveLog } from '../lib/db'
import styles from './WorkSelectScreen.module.css'

const WORK_TYPES = [
  { id: '事務', label: '事務', icon: '💼', cls: 'office' },
  { id: '清掃', label: '清掃', icon: '🧹', cls: 'cleaning' },
  { id: '現場', label: '現場', icon: '🏗️', cls: 'field' }
]

export default function WorkSelectScreen({ user, onComplete, onCancel }) {
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    if (!selected || saving) return
    setSaving(true)
    try {
      await saveLog({ userId: user.id, workType: selected })
      onComplete(selected)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.userBadge}>
        <span className={styles.userIcon}>👤</span>
        <div>
          <div className={styles.userName}>{user.name}</div>
          <div className={styles.userId}>{user.id}</div>
        </div>
      </div>

      <h1>作業内容を選択</h1>
      <p>今日の作業内容を選んでください</p>

      <div className={styles.buttons}>
        {WORK_TYPES.map(type => (
          <button
            key={type.id}
            className={[
              styles.workBtn,
              styles[type.cls],
              selected === type.id ? styles.selected : ''
            ].join(' ')}
            onClick={() => setSelected(type.id)}
          >
            <span className={styles.workIcon}>{type.icon}</span>
            <span className={styles.workLabel}>{type.label}</span>
            {selected === type.id && (
              <span className={styles.check}>✓</span>
            )}
          </button>
        ))}
      </div>

      <button
        className={[styles.confirmBtn, !selected ? styles.disabled : ''].join(' ')}
        onClick={handleConfirm}
        disabled={!selected || saving}
      >
        {saving ? '記録中...' : '確定'}
      </button>

      <button className={styles.cancelBtn} onClick={onCancel}>
        ← 戻る
      </button>
    </div>
  )
}
