import React, { useState, useEffect, useCallback } from 'react'
import { getLogs, getUsers, exportCSV, deleteLog, upsertUser, deleteUser, updateLogTime } from '../lib/db'
import QRGeneratorScreen from './QRGeneratorScreen'
import styles from './AdminScreen.module.css'

const LOG_TYPE_COLOR = {
  '出勤': '#2e7d32',
  '退勤': '#1a73e8'
}

export default function AdminScreen({ onBack }) {
  const [tab, setTab] = useState('logs') // 'logs' | 'users' | 'qr'
  const [logs, setLogs] = useState([])
  const [users, setUsers] = useState([])
  const [filterDate, setFilterDate] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [loading, setLoading] = useState(true)

  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    const [logData, userData] = await Promise.all([
      getLogs({ date: filterDate || undefined, userId: filterUser || undefined }),
      getUsers()
    ])
    setLogs(logData)
    setUsers(userData)
    setLoading(false)
  }, [filterDate, filterUser])

  useEffect(() => { loadLogs() }, [loadLogs])

  async function handleExport() {
    const csv = await exportCSV({ date: filterDate || undefined, userId: filterUser || undefined })
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const dateSuffix = filterDate || today
    a.download = `勤怠記録_${dateSuffix}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDeleteLog(id) {
    if (!confirm('この記録を削除しますか？')) return
    await deleteLog(id)
    loadLogs()
  }

  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]))

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>←</button>
        <h2>管理画面</h2>
        <div />
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={[styles.tab, tab === 'logs' ? styles.activeTab : ''].join(' ')}
          onClick={() => setTab('logs')}
        >
          記録一覧
        </button>
        <button
          className={[styles.tab, tab === 'users' ? styles.activeTab : ''].join(' ')}
          onClick={() => setTab('users')}
        >
          ユーザー管理
        </button>
        <button
          className={[styles.tab, tab === 'qr' ? styles.activeTab : ''].join(' ')}
          onClick={() => setTab('qr')}
        >
          QR印刷
        </button>
      </div>

      {tab === 'qr' && (
        <QRGeneratorScreen onBack={() => setTab('logs')} />
      )}

      {tab === 'logs' && (
        <LogsTab
          logs={logs}
          users={users}
          userMap={userMap}
          filterDate={filterDate}
          filterUser={filterUser}
          loading={loading}
          today={today}
          onFilterDate={setFilterDate}
          onFilterUser={setFilterUser}
          onExport={handleExport}
          onDeleteLog={handleDeleteLog}
          onRefreshLogs={loadLogs}
        />
      )}

      {tab === 'users' && (
        <UsersTab users={users} onRefresh={loadLogs} />
      )}
    </div>
  )
}

function LogsTab({
  logs, users, userMap, filterDate, filterUser, loading,
  today, onFilterDate, onFilterUser, onExport, onDeleteLog, onRefreshLogs
}) {
  const [editingLog, setEditingLog] = useState(null)
  const [editTime, setEditTime] = useState('')

  async function handleSaveTime() {
    if (!editTime || !editingLog) return
    await updateLogTime(editingLog.id, editTime)
    setEditingLog(null)
    onRefreshLogs()
  }

  return (
    <div className={styles.content}>
      {/* Date filter */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label>日付</label>
          <input
            type="date"
            value={filterDate}
            max={today}
            onChange={e => onFilterDate(e.target.value)}
            className={styles.filterInput}
          />
        </div>
        <button className={styles.clearBtn} onClick={() => { onFilterDate(''); onFilterUser('') }}>
          クリア
        </button>
      </div>

      {/* User tabs */}
      <div className={styles.userTabs}>
        <button
          className={[styles.userTab, filterUser === '' ? styles.activeUserTab : ''].join(' ')}
          onClick={() => onFilterUser('')}
        >
          全員
        </button>
        {users.map(u => (
          <button
            key={u.id}
            className={[styles.userTab, filterUser === u.id ? styles.activeUserTab : ''].join(' ')}
            onClick={() => onFilterUser(u.id)}
          >
            {u.name}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className={styles.summary}>
        <span className={styles.count}>{logs.length}件</span>
        <button className={styles.exportBtn} onClick={onExport}>
          📥 CSVエクスポート
        </button>
      </div>

      {/* Log list */}
      <div className={styles.list}>
        {loading && <div className={styles.empty}>読込中...</div>}
        {!loading && logs.length === 0 && (
          <div className={styles.empty}>記録がありません</div>
        )}
        {!loading && logs.map(log => (
          <div
            key={log.id}
            className={styles.logItem}
            onClick={() => { setEditingLog(log); setEditTime(log.time ? log.time.substring(0, 5) : '') }}
          >
            <div
              className={styles.workBadge}
              style={{ background: LOG_TYPE_COLOR[log.log_type] || '#888' }}
            >
              {log.log_type || '-'}
            </div>
            <div className={styles.logInfo}>
              <div className={styles.logUser}>{userMap[log.user_id] || log.user_id}</div>
              <div className={styles.logTime}>{log.date} {log.time}</div>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={e => { e.stopPropagation(); onDeleteLog(log.id) }}
              title="削除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Time edit modal */}
      {editingLog && (
        <div className={styles.modalOverlay} onClick={() => setEditingLog(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>時間を変更</h3>
            <p className={styles.modalLabel}>{userMap[editingLog.user_id] || editingLog.user_id} — {editingLog.log_type}</p>
            <p className={styles.modalLabel}>{editingLog.date}</p>
            <input
              type="time"
              value={editTime}
              onChange={e => setEditTime(e.target.value)}
              className={styles.timeInput}
            />
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSaveTime}>保存</button>
              <button className={styles.cancelBtn} onClick={() => setEditingLog(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UsersTab({ users, onRefresh }) {
  const [editId, setEditId] = useState(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addId, setAddId] = useState('')
  const [addName, setAddName] = useState('')

  async function handleSaveName(userId) {
    if (!newName.trim()) return
    await upsertUser({ id: userId, name: newName.trim() })
    setEditId(null)
    setNewName('')
    onRefresh()
  }

  async function handleDelete(userId) {
    if (!confirm(`ユーザー「${userId}」を削除しますか？\n関連ログは残ります。`)) return
    await deleteUser(userId)
    onRefresh()
  }

  async function handleAdd() {
    if (!addId.trim() || !addName.trim()) return
    await upsertUser({ id: addId.trim(), name: addName.trim() })
    setAdding(false)
    setAddId('')
    setAddName('')
    onRefresh()
  }

  return (
    <div className={styles.content}>
      <div className={styles.summary}>
        <span className={styles.count}>{users.length}名</span>
        <button className={styles.exportBtn} onClick={() => setAdding(true)}>
          ＋ ユーザー追加
        </button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <input
            placeholder="ユーザーID (例: USER011)"
            value={addId}
            onChange={e => setAddId(e.target.value)}
            className={styles.filterInput}
          />
          <input
            placeholder="氏名"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            className={styles.filterInput}
          />
          <div className={styles.addActions}>
            <button className={styles.exportBtn} onClick={handleAdd}>保存</button>
            <button className={styles.clearBtn} onClick={() => setAdding(false)}>キャンセル</button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {users.map(user => (
          <div key={user.id} className={styles.userItem}>
            <div className={styles.userAvatar}>👤</div>
            <div className={styles.logInfo}>
              {editId === user.id ? (
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveName(user.id)}
                  className={styles.editInput}
                  autoFocus
                />
              ) : (
                <div className={styles.logUser}>{user.name}</div>
              )}
              <div className={styles.logTime}>{user.id}</div>
            </div>
            <div className={styles.userActions}>
              {editId === user.id ? (
                <>
                  <button className={styles.saveBtn} onClick={() => handleSaveName(user.id)}>保存</button>
                  <button className={styles.cancelBtn} onClick={() => setEditId(null)}>✕</button>
                </>
              ) : (
                <>
                  <button
                    className={styles.editBtn}
                    onClick={() => { setEditId(user.id); setNewName(user.name) }}
                  >
                    編集
                  </button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(user.id)}>✕</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
