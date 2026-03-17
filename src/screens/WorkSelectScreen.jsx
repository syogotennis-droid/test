import React, { useState } from 'react'
import styles from './WorkSelectScreen.module.css'

const WORK_TYPES = [
  { id: '事務', label: '事務', icon: '💼', cls: 'office' },
  { id: '清掃', label: '清掃', icon: '🧹', cls: 'cleaning' },
  { id: '現場', label: '現場', icon: '🏗️', cls: 'field' }
]

export default function WorkSelectScreen({ user, onComplete, onCancel }) {
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)

  function toggleType(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  async function handleConfirm() {
    if (selected.length === 0 || saving) return
    setSaving(true)
    try {
      await onComplete(selected)
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

      <h1>退勤 — 作業内容を選択</h1>
      <p>今日の作業内容を選んでください（複数可）</p>

      <div className={styles.buttons}>
        {WORK_TYPES.map(type => (
          <button
            key={type.id}
            className={[
              styles.workBtn,
              styles[type.cls],
              selected.includes(type.id) ? styles.selected : ''
            ].join(' ')}
            onClick={() => toggleType(type.id)}
          >
            <span className={styles.workIcon}>{type.icon}</span>
            <span className={styles.workLabel}>{type.label}</span>
            {selected.includes(type.id) && (
              <span className={styles.check}>✓</span>
            )}
          </button>
        ))}
      </div>

      <button
        className={[styles.confirmBtn, selected.length === 0 ? styles.disabled : ''].join(' ')}
        onClick={handleConfirm}
        disabled={selected.length === 0 || saving}
      >
        {saving ? '記録中...' : '退勤を確定'}
      </button>

      <button className={styles.cancelBtn} onClick={onCancel}>
        ← 戻る
      </button>
    </div>
  )
}
