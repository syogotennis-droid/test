import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getLogs, getUsers, exportKinmubo, deleteLog, upsertUser, deleteUser,
  updateLogTime, saveLog, saveLogManual, getTodayStatuses, getClockInTimeForDate
} from '../lib/db'
import QRGeneratorScreen from './QRGeneratorScreen'
import styles from './AdminScreen.module.css'

const LOG_TYPE_COLOR = { '出勤': '#2e7d32', '退勤': '#1a73e8' }

function QRImage({ value, size = 200 }) {
  const encoded = encodeURIComponent(value)
  return (
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&bgcolor=ffffff&color=000000&margin=10`}
      alt={value}
      width={size}
      height={size}
    />
  )
}
const WORK_TYPES = ['現場', '清掃', '事務', '休憩']

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function toDateStr(d) {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
}


export default function AdminScreen({ onBack }) {
  const [tab, setTab] = useState('logs')
  const [logs, setLogs] = useState([])
  const [users, setUsers] = useState([])
  const today = toDateStr(new Date())
  const thisMonthFrom = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })()
  const [filterDateFrom, setFilterDateFrom] = useState(today)
  const [filterDateTo, setFilterDateTo] = useState(today)
  const [filterUser, setFilterUser] = useState('')
  const [loading, setLoading] = useState(true)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    const [logData, userData] = await Promise.all([
      getLogs({
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        userId: filterUser || undefined
      }),
      getUsers()
    ])
    setLogs(logData)
    setUsers(userData)
    setLoading(false)
  }, [filterDateFrom, filterDateTo, filterUser])

  useEffect(() => { loadLogs() }, [loadLogs])

  async function handleDeleteLog(id) {
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

      <div className={styles.tabs}>
        <button className={[styles.tab, tab === 'logs' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('logs')}>記録一覧</button>
        <button className={[styles.tab, tab === 'kinmubo' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('kinmubo')}>出勤簿作成</button>
        <button className={[styles.tab, tab === 'users' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('users')}>ユーザー管理</button>
        <button className={[styles.tab, tab === 'qr' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('qr')}>QR印刷</button>
      </div>

      {tab === 'qr' && <QRGeneratorScreen onBack={() => setTab('logs')} />}

      {tab === 'logs' && (
        <LogsTab
          logs={logs}
          users={users}
          userMap={userMap}
          filterDateFrom={filterDateFrom}
          filterDateTo={filterDateTo}
          filterUser={filterUser}
          loading={loading}
          today={today}
          onFilterDates={(from, to) => { setFilterDateFrom(from); setFilterDateTo(to) }}
          onFilterUser={setFilterUser}
          onDeleteLog={handleDeleteLog}
          onRefreshLogs={loadLogs}
        />
      )}

      {tab === 'kinmubo' && <KinmuboTab today={today} />}

      {tab === 'users' && (
        <UsersTab users={users} today={today} onRefresh={loadLogs} />
      )}
    </div>
  )
}

// ─── LogsTab ──────────────────────────────────────────────────────────────────

function LogsTab({
  logs, users, userMap, filterDateFrom, filterDateTo, filterUser, loading,
  today, onFilterDates, onFilterUser, onDeleteLog, onRefreshLogs
}) {
  const [dateMode, setDateMode] = useState('day') // 'all' | 'day' | 'month' | 'custom'
  const [navDate, setNavDate] = useState(today)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [editingLog, setEditingLog] = useState(null)
  const [editTime, setEditTime] = useState('')
  const [modalStep, setModalStep] = useState('edit')
  const [showCreate, setShowCreate] = useState(false)

  function applyMode(mode) {
    setDateMode(mode)
    if (mode === 'all') {
      onFilterDates('', '')
    } else if (mode === 'day') {
      setNavDate(today)
      onFilterDates(today, today)
    } else if (mode === 'month') {
      const d = new Date()
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      onFilterDates(from, today)
    }
  }

  function navDay(delta) {
    const d = new Date(navDate)
    d.setDate(d.getDate() + delta)
    const nd = toDateStr(d)
    setNavDate(nd)
    onFilterDates(nd, nd)
  }

  function applyCustom() {
    const from = customFrom || customTo
    const to = customTo || customFrom
    if (from) onFilterDates(from, to)
  }

  function openModal(log) {
    setEditingLog(log)
    setEditTime(log.time ? log.time.substring(0, 5) : '')
    setModalStep('edit')
  }

  function closeModal() {
    setEditingLog(null)
    setModalStep('edit')
  }

  async function handleConfirmSave() {
    await updateLogTime(editingLog.id, editTime)
    closeModal()
    onRefreshLogs()
  }

  async function handleConfirmDelete() {
    await onDeleteLog(editingLog.id)
    closeModal()
  }

  return (
    <div className={styles.content}>
      {/* Date filter */}
      <div className={styles.dateFilterBar}>
        <div className={styles.datePresets}>
          <button className={[styles.presetBtn, dateMode === 'day' ? styles.activePreset : ''].join(' ')} onClick={() => applyMode('day')}>本日</button>
          <button className={[styles.presetBtn, dateMode === 'month' ? styles.activePreset : ''].join(' ')} onClick={() => applyMode('month')}>今月</button>
          <button className={[styles.presetBtn, dateMode === 'all' ? styles.activePreset : ''].join(' ')} onClick={() => applyMode('all')}>全期間</button>
          <button className={[styles.presetBtn, dateMode === 'custom' ? styles.activePreset : ''].join(' ')} onClick={() => setDateMode('custom')}>期間指定</button>
        </div>

        {dateMode === 'day' && (
          <div className={styles.dayNav}>
            <button className={styles.navBtn} onClick={() => navDay(-1)}>◀</button>
            <span className={styles.navDate}>{navDate}</span>
            <button className={styles.navBtn} onClick={() => navDay(1)} disabled={navDate >= today}>▶</button>
          </div>
        )}

        {dateMode === 'custom' && (
          <div className={styles.customRange}>
            <input type="date" value={customFrom} max={today} onChange={e => setCustomFrom(e.target.value)} className={styles.filterInput} />
            <span className={styles.rangeSep}>〜</span>
            <input type="date" value={customTo} max={today} min={customFrom} onChange={e => setCustomTo(e.target.value)} className={styles.filterInput} />
            <button className={styles.applyBtn} onClick={applyCustom}>適用</button>
          </div>
        )}
      </div>

      {/* User tabs */}
      <div className={styles.userTabs}>
        <button className={[styles.userTab, filterUser === '' ? styles.activeUserTab : ''].join(' ')} onClick={() => onFilterUser('')}>全員</button>
        {users.map(u => (
          <button key={u.id} className={[styles.userTab, filterUser === u.id ? styles.activeUserTab : ''].join(' ')} onClick={() => onFilterUser(u.id)}>
            {u.name}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className={styles.summary}>
        <span className={styles.count}>{logs.length}件</span>
        <div className={styles.summaryActions}>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>＋ 手動作成</button>
        </div>
      </div>

      {/* Log list */}
      <div className={styles.list}>
        {loading && <div className={styles.empty}>読込中...</div>}
        {!loading && logs.length === 0 && <div className={styles.empty}>記録がありません</div>}
        {!loading && logs.map(log => (
          <div key={log.id} className={styles.logItem} onClick={() => openModal(log)}>
            <div className={styles.workBadge} style={{ background: LOG_TYPE_COLOR[log.log_type] || '#888' }}>
              {log.log_type || '-'}
            </div>
            <div className={styles.logInfo}>
              <div className={styles.logUser}>{userMap[log.user_id] || log.user_id}</div>
              <div className={styles.logTime}>{log.date} {log.time}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / confirm modal */}
      {editingLog && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            {modalStep === 'edit' && (
              <>
                <h3>記録を編集</h3>
                <p className={styles.modalLabel}>{userMap[editingLog.user_id] || editingLog.user_id} — {editingLog.log_type}</p>
                <p className={styles.modalLabel}>{editingLog.date}</p>
                <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} className={styles.timeInput} />
                <div className={styles.modalActions}>
                  <button className={styles.saveBtn} onClick={() => setModalStep('confirmSave')}>時間を変更</button>
                  <button className={styles.cancelBtn} onClick={closeModal}>キャンセル</button>
                </div>
                <hr className={styles.modalDivider} />
                <button className={styles.deleteTriggerBtn} onClick={() => setModalStep('confirmDelete')}>この記録を削除する</button>
              </>
            )}
            {modalStep === 'confirmSave' && (
              <>
                <h3>時間変更の確認</h3>
                <p className={styles.modalLabel}>{userMap[editingLog.user_id] || editingLog.user_id} — {editingLog.log_type}</p>
                <p className={styles.modalLabel}>{editingLog.date}</p>
                <p className={styles.confirmMsg}>
                  <span className={styles.oldTime}>{editingLog.time ? editingLog.time.substring(0, 5) : '-'}</span>
                  {' → '}
                  <span className={styles.newTime}>{editTime}</span>
                  {' に変更します'}
                </p>
                <p className={styles.confirmWarn}>この操作は元に戻せません</p>
                <div className={styles.modalActions}>
                  <button className={styles.saveBtn} onClick={handleConfirmSave}>確定する</button>
                  <button className={styles.cancelBtn} onClick={() => setModalStep('edit')}>戻る</button>
                </div>
              </>
            )}
            {modalStep === 'confirmDelete' && (
              <>
                <h3>削除の確認</h3>
                <p className={styles.modalLabel}>{userMap[editingLog.user_id] || editingLog.user_id} — {editingLog.log_type}</p>
                <p className={styles.modalLabel}>{editingLog.date} {editingLog.time}</p>
                <p className={styles.confirmWarn}>この記録を完全に削除します。<br />この操作は元に戻せません。</p>
                <div className={styles.modalActions}>
                  <button className={styles.realDeleteBtn} onClick={handleConfirmDelete}>削除する</button>
                  <button className={styles.cancelBtn} onClick={() => setModalStep('edit')}>戻る</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual create modal */}
      {showCreate && (
        <CreateLogModal
          users={users}
          today={today}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); onRefreshLogs() }}
        />
      )}
    </div>
  )
}

// ─── CreateLogModal ───────────────────────────────────────────────────────────

function CreateLogModal({ users, today, onClose, onSaved }) {
  const nowTime = () => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }

  const [step, setStep] = useState('form') // 'form' | 'confirm'
  const [userId, setUserId] = useState(users[0]?.id || '')
  const [logType, setLogType] = useState('出勤')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState(nowTime)
  // workTimes: { 現場: { on: bool, h: '', m: '' }, ... }
  const [workTimes, setWorkTimes] = useState(
    Object.fromEntries(WORK_TYPES.map(t => [t, { on: false, h: '', m: '' }]))
  )
  const [clockInTime, setClockInTime] = useState(null) // "HH:MM" from DB

  // Fetch 出勤時刻 for selected user+date when logType is 退勤
  useEffect(() => {
    if (logType !== '退勤') { setClockInTime(null); return }
    getClockInTimeForDate(userId, date).then(log => {
      setClockInTime(log ? log.time.substring(0, 5) : null)
    })
  }, [logType, userId, date])

  // 勤務時間 (minutes) = 退勤入力時刻 - 出勤時刻
  const workingMinutes = useMemo(() => {
    if (!clockInTime || !time) return null
    const [h1, m1] = clockInTime.split(':').map(Number)
    const [h2, m2] = time.split(':').map(Number)
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    return diff > 0 ? diff : null
  }, [clockInTime, time])

  // 入力合計 minutes
  const totalInputMinutes = WORK_TYPES.reduce((sum, t) => {
    if (!workTimes[t].on) return sum
    return sum + (parseInt(workTimes[t].h) || 0) * 60 + (parseInt(workTimes[t].m) || 0)
  }, 0)

  function toggleWork(t) {
    setWorkTimes(prev => ({ ...prev, [t]: { ...prev[t], on: !prev[t].on } }))
  }

  function setWorkH(t, v) {
    setWorkTimes(prev => ({ ...prev, [t]: { ...prev[t], h: v } }))
  }

  function setWorkM(t, v) {
    setWorkTimes(prev => ({ ...prev, [t]: { ...prev[t], m: v } }))
  }

  function fillRemaining(t) {
    if (workingMinutes === null) return
    const otherMins = WORK_TYPES.filter(t2 => t2 !== t && workTimes[t2].on).reduce((sum, t2) => {
      return sum + (parseInt(workTimes[t2].h) || 0) * 60 + (parseInt(workTimes[t2].m) || 0)
    }, 0)
    const remaining = workingMinutes - otherMins
    if (remaining <= 0) return
    setWorkH(t, String(Math.floor(remaining / 60)))
    setWorkM(t, String(remaining % 60))
  }

  function buildWorkTypeStr() {
    return WORK_TYPES.filter(t => workTimes[t].on).map(t => {
      const mins = (parseInt(workTimes[t].h) || 0) * 60 + (parseInt(workTimes[t].m) || 0)
      return mins > 0 ? `${t}:${mins}` : t
    }).join(',')
  }

  function workSummary(t) {
    const { h, m } = workTimes[t]
    const hv = parseInt(h) || 0
    const mv = parseInt(m) || 0
    if (hv === 0 && mv === 0) return t
    return `${t} ${hv > 0 ? `${hv}時間` : ''}${mv > 0 ? `${mv}分` : ''}`
  }

  async function handleConfirm() {
    await saveLogManual({
      userId,
      logType,
      date,
      time,
      workType: buildWorkTypeStr()
    })
    onSaved()
  }

  const userName = users.find(u => u.id === userId)?.name || userId
  const selectedWorkTypes = WORK_TYPES.filter(t => workTimes[t].on)

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {step === 'form' && (
          <>
            <h3>手動記録作成</h3>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>担当者</label>
              <select value={userId} onChange={e => setUserId(e.target.value)} className={styles.filterInput}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>種別</label>
              <div className={styles.typeToggle}>
                <button
                  className={[styles.typeBtn, logType === '出勤' ? styles.typeBtnActive : ''].join(' ')}
                  style={logType === '出勤' ? { background: LOG_TYPE_COLOR['出勤'] } : {}}
                  onClick={() => setLogType('出勤')}
                >出勤</button>
                <button
                  className={[styles.typeBtn, logType === '退勤' ? styles.typeBtnActive : ''].join(' ')}
                  style={logType === '退勤' ? { background: LOG_TYPE_COLOR['退勤'] } : {}}
                  onClick={() => setLogType('退勤')}
                >退勤</button>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>日付</label>
              <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={styles.filterInput} />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>時刻</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className={styles.timeInput} />
            </div>

            {logType === '退勤' && (
              <>
                {workingMinutes !== null && (
                  <div className={styles.workTimeBanner}>
                    <span>出勤 {clockInTime}</span>
                    <span className={styles.workTimeBannerSep}>|</span>
                    <span>勤務 <strong>{fmtMinutes(workingMinutes)}</strong></span>
                    {totalInputMinutes > 0 && (
                      <>
                        <span className={styles.workTimeBannerSep}>|</span>
                        <span className={totalInputMinutes === workingMinutes ? styles.totalMatch : styles.totalMismatch}>
                          残り {fmtMinutes(Math.max(0, workingMinutes - totalInputMinutes))}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>作業内容</label>
                  <div className={styles.workTypeList}>
                    {WORK_TYPES.map(t => {
                      const otherMins = workingMinutes !== null
                        ? WORK_TYPES.filter(t2 => t2 !== t && workTimes[t2].on).reduce((sum, t2) =>
                            sum + (parseInt(workTimes[t2].h) || 0) * 60 + (parseInt(workTimes[t2].m) || 0), 0)
                        : 0
                      const remaining = workingMinutes !== null ? workingMinutes - otherMins : null
                      const currentMins = (parseInt(workTimes[t].h) || 0) * 60 + (parseInt(workTimes[t].m) || 0)
                      const showRemainingBtn = remaining !== null && remaining > 0 && currentMins !== remaining
                      return (
                        <div key={t} className={styles.workTypeEntry}>
                          <button
                            className={[styles.workTypeBtn, workTimes[t].on ? styles.workTypeBtnActive : ''].join(' ')}
                            onClick={() => toggleWork(t)}
                          >{t}</button>
                          {workTimes[t].on && (
                            <div className={styles.workTimeInputs}>
                              <input
                                type="number" min="0" max="23" placeholder="0"
                                value={workTimes[t].h}
                                onChange={e => setWorkH(t, e.target.value)}
                                className={styles.workTimeNum}
                              />
                              <span className={styles.workTimeUnit}>時間</span>
                              <input
                                type="number" min="0" max="59" placeholder="0"
                                value={workTimes[t].m}
                                onChange={e => setWorkM(t, e.target.value)}
                                className={styles.workTimeNum}
                              />
                              <span className={styles.workTimeUnit}>分</span>
                              {showRemainingBtn && (
                                <button className={styles.remainingBtn} onClick={() => fillRemaining(t)}>
                                  残り{fmtMinutes(remaining)}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={() => setStep('confirm')}>確認へ</button>
              <button className={styles.cancelBtn} onClick={onClose}>キャンセル</button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <h3>作成内容の確認</h3>
            <div className={styles.confirmTable}>
              <div className={styles.confirmRow}><span>担当者</span><strong>{userName}</strong></div>
              <div className={styles.confirmRow}><span>種別</span>
                <strong style={{ color: LOG_TYPE_COLOR[logType] }}>{logType}</strong>
              </div>
              <div className={styles.confirmRow}><span>日付</span><strong>{date}</strong></div>
              <div className={styles.confirmRow}><span>時刻</span><strong>{time}</strong></div>
              {selectedWorkTypes.length > 0 && (
                <div className={styles.confirmRow}><span>作業</span><strong>{selectedWorkTypes.map(workSummary).join(' / ')}</strong></div>
              )}
            </div>
            <p className={styles.confirmWarn}>この内容で記録を作成します</p>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleConfirm}>作成する</button>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── KinmuboTab ───────────────────────────────────────────────────────────────

function KinmuboTab({ today }) {
  const currentYM = today.substring(0, 7) // "YYYY-MM"
  const [selectedYM, setSelectedYM] = useState(currentYM)
  const [exporting, setExporting] = useState(false)

  function shiftMonth(delta) {
    const [y, m] = selectedYM.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedYM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  async function handleCreate() {
    setExporting(true)
    const [y, m] = selectedYM.split('-').map(Number)
    const dateFrom = `${selectedYM}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const dateTo = `${selectedYM}-${String(lastDay).padStart(2, '0')}`
    const buf = await exportKinmubo({ dateFrom, dateTo })
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `出勤簿_${selectedYM}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  const [displayY, displayM] = selectedYM.split('-').map(Number)

  return (
    <div className={styles.content}>
      <div className={styles.kinmuboPanel}>
        <p className={styles.kinmuboDesc}>対象月を選択して出勤簿を作成します。<br />担当者ごとにシートが分かれたExcelファイルが出力されます。</p>

        <div className={styles.monthSelector}>
          <button className={styles.navBtn} onClick={() => shiftMonth(-1)}>◀</button>
          <span className={styles.monthLabel}>{displayY}年{displayM}月</span>
          <button className={styles.navBtn} onClick={() => shiftMonth(1)} disabled={selectedYM >= currentYM}>▶</button>
        </div>

        <p className={styles.kinmuboNote}>時給はユーザー管理から各担当者ごとに設定してください。</p>

        <button className={styles.kinmuboCreateBtn} onClick={handleCreate} disabled={exporting}>
          {exporting ? '作成中...' : '📥 出勤簿を作成'}
        </button>
      </div>
    </div>
  )
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

function UsersTab({ users, today, onRefresh }) {
  const [statuses, setStatuses] = useState({})
  const [editingUser, setEditingUser] = useState(null)
  const [qrUser, setQrUser] = useState(null)
  const [adding, setAdding] = useState(false)
  const [addId, setAddId] = useState('')
  const [addName, setAddName] = useState('')

  useEffect(() => { loadStatuses() }, [])

  async function loadStatuses() {
    const s = await getTodayStatuses()
    setStatuses(s)
  }

  async function handleAdd() {
    if (!addId.trim() || !addName.trim()) return
    const newUser = { id: addId.trim(), name: addName.trim() }
    await upsertUser(newUser)
    setAdding(false)
    setAddId('')
    setAddName('')
    onRefresh()
    setQrUser(newUser)
  }

  async function handleModalSaved() {
    setEditingUser(null)
    await loadStatuses()
    onRefresh()
  }

  return (
    <div className={styles.content}>
      <div className={styles.summary}>
        <span className={styles.count}>{users.length}名</span>
        <button className={styles.exportBtn} onClick={() => setAdding(true)}>＋ ユーザー追加</button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <input placeholder="ユーザーID (例: USER011)" value={addId} onChange={e => setAddId(e.target.value)} className={styles.filterInput} />
          <input placeholder="氏名" value={addName} onChange={e => setAddName(e.target.value)} className={styles.filterInput} />
          <div className={styles.addActions}>
            <button className={styles.exportBtn} onClick={handleAdd}>保存</button>
            <button className={styles.clearBtn} onClick={() => setAdding(false)}>キャンセル</button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {users.map(user => {
          const isIn = statuses[user.id] === true
          return (
            <div key={user.id} className={styles.userItem}>
              <div className={styles.userAvatar}>👤</div>
              <div className={styles.logInfo}>
                <div className={styles.logUser}>{user.name}</div>
                <div className={styles.logTime}>{user.id}</div>
              </div>

              <div className={styles.statusArea}>
                <span className={[styles.statusBadge, isIn ? styles.statusIn : styles.statusOut].join(' ')}>
                  {isIn ? '出勤中' : '退勤中'}
                </span>
              </div>

              <div className={styles.userActions}>
                <button className={styles.editBtn} onClick={() => setEditingUser(user)}>編集</button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ユーザー追加後のQRモーダル */}
      {qrUser && (
        <div className={styles.modalOverlay} onClick={() => setQrUser(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>ユーザーを追加しました</h3>
            <p className={styles.modalLabel}>{qrUser.name}</p>
            <p className={styles.modalLabel} style={{ fontSize: '0.82rem', color: 'var(--color-subtext)' }}>{qrUser.id}</p>
            <div className={styles.qrCenter}>
              <QRImage value={qrUser.id} size={200} />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={() => { window.print(); }}>🖨 印刷</button>
              <button className={styles.cancelBtn} onClick={() => setQrUser(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <UserEditModal
          user={editingUser}
          isIn={statuses[editingUser.id] === true}
          onClose={() => setEditingUser(null)}
          onSaved={handleModalSaved}
          onDeleted={() => { setEditingUser(null); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── UserEditModal ────────────────────────────────────────────────────────────

function UserEditModal({ user, isIn, onClose, onSaved, onDeleted }) {
  const [step, setStep] = useState('main') // 'main' | 'confirmStatus' | 'confirmDelete'
  const [name, setName] = useState(user.name)
  const [rates, setRates] = useState({ 現場: '', 清掃: '', 事務: '', ...(user.rates || {}) })
  const [dangerOpen, setDangerOpen] = useState(false)

  async function handleSaveName() {
    if (!name.trim()) return
    await upsertUser({ id: user.id, name: name.trim(), rates })
    onSaved()
  }

  async function handleSaveRates() {
    await upsertUser({ id: user.id, name: name || user.name, rates })
    onSaved()
  }

  async function handleConfirmStatus() {
    await saveLog({ userId: user.id, workType: '', logType: isIn ? '退勤' : '出勤' })
    onSaved()
  }

  async function handleConfirmDelete() {
    await deleteUser(user.id)
    onDeleted()
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {step === 'main' && (
          <>
            <h3>{user.name} の編集</h3>

            {/* Name edit */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>氏名</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                className={styles.filterInput}

              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.saveBtn}
                onClick={handleSaveName}
                disabled={!name.trim() || name.trim() === user.name}
              >
                名前を保存
              </button>
            </div>

            <hr className={styles.modalDivider} />

            {/* Rates */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>時給設定</label>
              <div className={styles.ratesGrid}>
                {['現場', '清掃', '事務'].map(t => (
                  <div key={t} className={styles.rateRow}>
                    <label className={styles.rateLabel}>{t}</label>
                    <input
                      type="number" min="0" placeholder="0"
                      value={rates[t]}
                      onChange={e => setRates(r => ({ ...r, [t]: e.target.value }))}
                      className={styles.rateInput}
                    />
                    <span className={styles.rateUnit}>円/時</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSaveRates}>時給を保存</button>
            </div>

            <hr className={styles.modalDivider} />

            {/* Status toggle */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>本日の出勤状態</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={[styles.statusBadge, isIn ? styles.statusIn : styles.statusOut].join(' ')} style={{ fontSize: '1rem', padding: '4px 12px' }}>
                  {isIn ? '出勤中' : '退勤中'}
                </span>
                <button
                  className={styles.toggleTriggerBtn}
                  style={{ color: isIn ? '#1a73e8' : '#2e7d32' }}
                  onClick={() => setStep('confirmStatus')}
                >
                  {isIn ? '退勤中に切り替える' : '出勤中に切り替える'}
                </button>
              </div>
            </div>

            <hr className={styles.modalDivider} />
            <button className={styles.dangerToggleBtn} onClick={() => setDangerOpen(o => !o)}>
              {dangerOpen ? '▼' : '▶'} その他の操作
            </button>
            {dangerOpen && (
              <button className={styles.deleteTriggerBtn} style={{ marginTop: 8 }} onClick={() => setStep('confirmDelete')}>
                このユーザーを削除する
              </button>
            )}

            <hr className={styles.modalDivider} />
            <button className={styles.cancelBtn} onClick={onClose}>閉じる</button>
          </>
        )}

        {step === 'confirmDelete' && (
          <>
            <h3>ユーザー削除の確認</h3>
            <p className={styles.modalLabel}>{user.name}</p>
            <p className={styles.modalLabel} style={{ fontSize: '0.82rem', color: 'var(--color-subtext)' }}>{user.id}</p>
            <p className={styles.confirmWarn}>
              このユーザーと全ての打刻記録を完全に削除します。<br />
              この操作は元に戻せません。
            </p>
            <div className={styles.modalActions}>
              <button className={styles.realDeleteBtn} onClick={handleConfirmDelete}>削除する</button>
              <button className={styles.cancelBtn} onClick={() => setStep('main')}>戻る</button>
            </div>
          </>
        )}

        {step === 'confirmStatus' && (
          <>
            <h3>状態変更の確認</h3>
            <p className={styles.modalLabel}>{user.name}</p>
            <p className={styles.confirmMsg}>
              <span className={styles.oldTime}>{isIn ? '出勤中' : '退勤中'}</span>
              {' → '}
              <span className={styles.newTime}>{isIn ? '退勤中' : '出勤中'}</span>
              {' に変更します'}
            </p>
            <p className={styles.confirmWarn}>この操作は元に戻せません</p>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleConfirmStatus}>確定する</button>
              <button className={styles.cancelBtn} onClick={() => setStep('main')}>戻る</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
