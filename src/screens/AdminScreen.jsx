import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import QRCode from 'qrcode'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  getLogs, getUsers, exportKinmubo, deleteLog, upsertUser, deleteUser,
  updateLogTime, saveLog, saveLogManual, getTodayStatuses, getClockInTimeForDate,
  resolveUserByPin, PAY_ITEMS, saveAdminPin, getMinWage, saveMinWage, DEFAULT_MIN_WAGE,
  getWorkItems
} from '../lib/db'
import QRGeneratorScreen from './QRGeneratorScreen'
import styles from './AdminScreen.module.css'

const LOG_TYPE_COLOR = { '出勤': '#2e7d32', '退勤': '#1a73e8' }

function QRImage({ value, size = 200 }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(url => setSrc(url))
  }, [value, size])
  return src
    ? <img src={src} alt={value} width={size} height={size} />
    : <div style={{ width: size, height: size, background: '#eee', borderRadius: 4 }} />
}
const WORK_TYPES = ['現場', '清掃', '事務', '休憩']
const WORK_HIDDEN = new Set(['準備', '有給', '固定手当', '交通費'])
const LEGACY_WORK_ITEMS = ['現場', '清掃', '事務', '休憩']

function getWorkItemsForUser(workItems) {
  const base = (workItems && workItems.length > 0) ? workItems : LEGACY_WORK_ITEMS
  const filtered = base.filter(item => !WORK_HIDDEN.has(item))
  if (!filtered.includes('休憩')) filtered.push('休憩')
  return filtered
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function toDateStr(d) {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
}


export default function AdminScreen({ onBack }) {
  const [tab, setTab] = useState('calendar')
  const [users, setUsers] = useState([])
  const today = toDateStr(new Date())

  useEffect(() => {
    getUsers().then(setUsers)
  }, [])

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <div className={styles.headerBrand}>
          <span className={styles.headerTitle}>QR勤怠管理</span>
          <span className={styles.headerSub}>管理画面</span>
        </div>
        <button className={styles.backBtn} onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          打刻画面へ戻る
        </button>
      </div>

      <div className={styles.tabs}>
        <button className={[styles.tab, tab === 'calendar' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('calendar')}>記録一覧</button>
        <button className={[styles.tab, tab === 'kinmubo' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('kinmubo')}>出勤簿作成</button>
        <button className={[styles.tab, tab === 'users' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('users')}>ユーザー管理</button>
        <button className={[styles.tab, tab === 'qr' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('qr')}>QR印刷</button>
        <button className={[styles.tab, tab === 'settings' ? styles.activeTab : ''].join(' ')} onClick={() => setTab('settings')}>設定</button>
      </div>

      {tab === 'qr' && <QRGeneratorScreen onBack={() => setTab('calendar')} />}
      {tab === 'calendar' && <CalendarTab users={users} today={today} />}
      {tab === 'kinmubo' && <KinmuboTab today={today} />}
      {tab === 'users' && <UsersTab users={users} today={today} onRefresh={() => getUsers().then(setUsers)} />}
      {tab === 'settings' && <SettingsTab />}
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
  const [showEditTimeNumpad, setShowEditTimeNumpad] = useState(false)

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
    setShowEditTimeNumpad(false)
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
                <input
                  type="time"
                  className={styles.numpadTrigger}
                  value={editTime}
                  onChange={e => setEditTime(e.target.value)}
                  style={{ fontFamily: 'inherit', cursor: 'text' }}
                />
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

// ─── CalendarTab ─────────────────────────────────────────────────────────────

const CAL_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)
  return days
}

function buildDayMap(logs, year, month) {
  const map = {}
  logs.forEach(log => {
    const [y, m, d] = log.date.split('-').map(Number)
    if (y !== year || m !== month + 1) return
    if (!map[d]) map[d] = { ins: [], outs: [], workType: '', hasWorkItems: false }
    if (log.log_type === '出勤') map[d].ins.push(log.time || '')
    else if (log.log_type === '退勤') {
      map[d].outs.push(log.time || '')
      if (log.work_type) map[d].workType = log.work_type
      const wi = getWorkItems(log)
      if (Object.entries(wi).some(([t, mins]) => t !== '休憩' && mins > 0)) {
        map[d].hasWorkItems = true
      }
    }
  })
  return map
}

function timeDiffStr(t1, t2) {
  if (!t1 || !t2) return ''
  const [h1, m1] = t1.split(':').map(Number)
  const [h2, m2] = t2.split(':').map(Number)
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (diff <= 0) return ''
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`
}

function CalendarTab({ users, today }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedUser, setSelectedUser] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null)

  useEffect(() => {
    if (users.length > 0 && !selectedUser) setSelectedUser(users[0])
  }, [users])

  useEffect(() => {
    if (!selectedUser) return
    setLoading(true)
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    getLogs({ dateFrom: from, dateTo: to, userId: selectedUser.id })
      .then(data => { setLogs(data); setLoading(false) })
  }, [selectedUser, year, month])

  function refreshLogs() {
    if (!selectedUser) return
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    getLogs({ dateFrom: from, dateTo: to, userId: selectedUser.id }).then(setLogs)
  }

  const days = getCalendarDays(year, month)
  const dayMap = buildDayMap(logs, year, month)
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (isCurrentMonth) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  const pad = n => String(n).padStart(2, '0')

  return (
    <div className={styles.content}>
      {/* 職員選択 */}
      <div className={styles.calSection}>
        <div className={styles.calSectionLabel}>職員を選択</div>
        <div className={styles.userTabsWrap}>
          {users.map(u => (
            <button key={u.id} className={[styles.userTab, selectedUser?.id === u.id ? styles.activeUserTab : ''].join(' ')} onClick={() => setSelectedUser(u)}>
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {/* カレンダーカード */}
      <div className={styles.calCard}>
        <div className={styles.calMonthNav}>
          <button className={styles.navBtn} onClick={prevMonth}>◀</button>
          <span className={styles.navDate}>{year}年{month + 1}月</span>
          <button className={styles.navBtn} onClick={nextMonth} disabled={isCurrentMonth}>▶</button>
        </div>

        {loading ? (
          <div className={styles.empty}>読込中...</div>
        ) : (
          <div className={styles.calGrid}>
            {CAL_DAY_LABELS.map((d, i) => (
              <div key={d} className={[styles.calDayLabel, i === 0 ? styles.calSun : i === 6 ? styles.calSat : ''].join(' ')}>{d}</div>
            ))}
            {days.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} className={styles.calEmpty} />
              const entry = dayMap[d]
              const inTime = entry ? (entry.ins.sort()[0] || '').substring(0, 5) : ''
              const outTime = entry ? (entry.outs.sort().reverse()[0] || '').substring(0, 5) : ''
              const worked = !!inTime
              const needsAlert = !!inTime && !!outTime && !entry?.hasWorkItems
              const dow = new Date(year, month, d).getDay()
              return (
                <div
                  key={d}
                  className={[styles.calCell, needsAlert ? styles.calAlert : worked ? styles.calWorked : '', dow === 0 ? styles.calSunCell : dow === 6 ? styles.calSatCell : ''].join(' ')}
                  onClick={() => setSelectedDay(d)}
                >
                  <div className={styles.calDayNum}>{d}</div>
                  {worked && <div className={styles.calIn}>出勤 {inTime}</div>}
                  {outTime && <div className={styles.calOut}>退勤 {outTime}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedDay !== null && selectedUser && (
        <DayEditModal
          user={selectedUser}
          year={year}
          month={month}
          day={selectedDay}
          dayLogs={logs.filter(l => l.date === `${year}-${pad(month + 1)}-${pad(selectedDay)}`)}
          onClose={() => setSelectedDay(null)}
          onSaved={() => { setSelectedDay(null); refreshLogs() }}
        />
      )}
    </div>
  )
}

// ─── CreateLogModal ───────────────────────────────────────────────────────────

function CreateLogModal({ users, today, defaultUserId, onClose, onSaved }) {
  const nowTime = () => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }

  const [step, setStep] = useState('form') // 'form' | 'confirm'
  const [showTimeNumpad, setShowTimeNumpad] = useState(false)
  const [userId, setUserId] = useState(defaultUserId || users[0]?.id || '')
  const [logType, setLogType] = useState('出勤')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState(nowTime)
  const [workTimes, setWorkTimes] = useState({})
  const [editingWorkItem, setEditingWorkItem] = useState(null)
  const [clockInTime, setClockInTime] = useState(null) // "HH:MM" from DB

  const userWorkItems = useMemo(() => getWorkItemsForUser(users.find(u => u.id === userId)?.workItems), [userId, users])

  // userId変更時にworkTimesをリセット
  useEffect(() => { setWorkTimes({}) }, [userId])

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

  const totalInputMinutes = Object.values(workTimes).reduce((sum, t) => sum + t.h * 60 + t.m, 0)

  function buildWorkTypeStr() {
    return Object.entries(workTimes)
      .filter(([, t]) => t.h > 0 || t.m > 0)
      .map(([type, t]) => { const mins = t.h * 60 + t.m; return mins > 0 ? `${type}:${mins}` : type })
      .join(',')
  }

  function workSummary(t) {
    const tw = workTimes[t]
    if (!tw || (tw.h === 0 && tw.m === 0)) return t
    return `${t} ${tw.h > 0 ? `${tw.h}時間` : ''}${tw.m > 0 ? `${tw.m}分` : ''}`
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
  const selectedWorkTypes = userWorkItems.filter(t => workTimes[t] && (workTimes[t].h > 0 || workTimes[t].m > 0))

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
              <input
                type="time"
                className={styles.numpadTrigger}
                value={time}
                onChange={e => setTime(e.target.value)}
                style={{ fontFamily: 'inherit', cursor: 'text' }}
              />
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
                  <div className={styles.workCards}>
                    {userWorkItems.map(t => {
                      const active = workTimes[t] && (workTimes[t].h > 0 || workTimes[t].m > 0)
                      return (
                        <div
                          key={t}
                          className={[styles.wCard, active ? styles.wCardActive : ''].join(' ')}
                          onClick={() => {
                            if (!workTimes[t]) setWorkTimes(prev => ({ ...prev, [t]: { h: 0, m: 0 } }))
                            setEditingWorkItem(t)
                          }}
                        >
                          {active && (
                            <button
                              className={styles.wClearBtn}
                              onClick={e => { e.stopPropagation(); setWorkTimes(prev => { const c = { ...prev }; delete c[t]; return c }) }}
                            >×</button>
                          )}
                          <div className={styles.wCardLabel}>{t}</div>
                          {active && <div className={styles.wCardTime}>{fmtMinutes(workTimes[t].h * 60 + workTimes[t].m)}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {editingWorkItem && (
                  <WorkTimeInputModal
                    item={editingWorkItem}
                    workTimes={workTimes}
                    workingMinutes={workingMinutes}
                    onSetTime={(id, field, val) => setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))}
                    onClose={() => setEditingWorkItem(null)}
                  />
                )}
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

// ─── DayEditModal ─────────────────────────────────────────────────────────────

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function parseWorkType(wt) {
  const result = {}
  if (!wt) return result
  wt.split(',').forEach(entry => {
    const [type, minsStr] = entry.split(':')
    if (type) {
      const mins = parseInt(minsStr) || 0
      result[type] = { h: Math.floor(mins / 60), m: mins % 60 }
    }
  })
  return result
}

function DayEditModal({ user, year, month, day, dayLogs, onClose, onSaved }) {
  const pad = n => String(n).padStart(2, '0')
  const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
  const dow = new Date(year, month, day).getDay()
  const dateLabel = `${year}年${month + 1}月${day}日（${DOW_LABELS[dow]}）`

  const inLog = dayLogs.find(l => l.log_type === '出勤')
  const outLog = dayLogs.find(l => l.log_type === '退勤')
  const hasExisting = dayLogs.length > 0

  const [inTime, setInTime] = useState(inLog?.time?.substring(0, 5) || '')
  const [outTime, setOutTime] = useState(outLog?.time?.substring(0, 5) || '')
  const [workTimes, setWorkTimes] = useState(() => parseWorkType(outLog?.work_type || ''))
  const [step, setStep] = useState('form') // 'form' | 'confirm' | 'confirmDelete'
  const [activeTimeField, setActiveTimeField] = useState(null) // 'in' | 'out' | null
  const [editingWorkItem, setEditingWorkItem] = useState(null)

  const workingMinutes = useMemo(() => {
    if (!inTime || !outTime) return null
    const [h1, m1] = inTime.split(':').map(Number)
    const [h2, m2] = outTime.split(':').map(Number)
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    return diff > 0 ? diff : null
  }, [inTime, outTime])

  const userWorkItems = useMemo(() => getWorkItemsForUser(user?.workItems), [user])
  const totalInputMinutes = Object.values(workTimes).reduce((sum, t) => sum + t.h * 60 + t.m, 0)

  function setWorkTime(id, field, val) {
    setWorkTimes(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  function buildWorkTypeStr() {
    return Object.entries(workTimes)
      .filter(([, t]) => t.h > 0 || t.m > 0)
      .map(([type, t]) => { const mins = t.h * 60 + t.m; return mins > 0 ? `${type}:${mins}` : type })
      .join(',')
  }

  async function handleConfirm() {
    for (const log of dayLogs) await deleteLog(log.id)
    if (inTime) await saveLogManual({ userId: user.id, logType: '出勤', date: dateStr, time: inTime, workType: '' })
    if (outTime) await saveLogManual({ userId: user.id, logType: '退勤', date: dateStr, time: outTime, workType: buildWorkTypeStr() })
    onSaved()
  }

  async function handleDelete() {
    for (const log of dayLogs) await deleteLog(log.id)
    onSaved()
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalLg} onClick={e => e.stopPropagation()}>
        {step === 'form' && (
          <>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalHeaderTitle}>勤務記録の編集</div>
                <div className={styles.modalHeaderSub}>{dateLabel} ・ {user.name}</div>
              </div>
              <button className={styles.modalCloseBtn} onClick={onClose}>✕</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.timeRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>出勤時刻</label>
                  <input
                    type="time"
                    className={styles.numpadTrigger}
                    value={inTime}
                    onChange={e => setInTime(e.target.value)}
                    style={{ fontFamily: 'inherit', cursor: 'text' }}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>退勤時刻</label>
                  <input
                    type="time"
                    className={styles.numpadTrigger}
                    value={outTime}
                    onChange={e => setOutTime(e.target.value)}
                    style={{ fontFamily: 'inherit', cursor: 'text' }}
                  />
                </div>
              </div>

              {outTime && workingMinutes !== null && (
                <div className={styles.workTimeCard}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>勤務時間 <strong>{fmtMinutes(workingMinutes)}</strong></span>
                  {totalInputMinutes > 0 && (
                    <>
                      <span className={styles.workTimeSep}>|</span>
                      <span className={totalInputMinutes === workingMinutes ? styles.totalMatch : styles.totalMismatch}>
                        残り {fmtMinutes(Math.max(0, workingMinutes - totalInputMinutes))}
                      </span>
                    </>
                  )}
                </div>
              )}

              {outTime && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>作業内容</label>
                  <div className={styles.workCards}>
                    {userWorkItems.map(t => {
                      const active = workTimes[t] && (workTimes[t].h > 0 || workTimes[t].m > 0)
                      return (
                        <div
                          key={t}
                          className={[styles.wCard, active ? styles.wCardActive : ''].join(' ')}
                          onClick={() => {
                            if (!workTimes[t]) setWorkTimes(prev => ({ ...prev, [t]: { h: 0, m: 0 } }))
                            setEditingWorkItem(t)
                          }}
                        >
                          {active && (
                            <button
                              className={styles.wClearBtn}
                              onClick={e => { e.stopPropagation(); setWorkTimes(prev => { const c = { ...prev }; delete c[t]; return c }) }}
                            >×</button>
                          )}
                          <div className={styles.wCardLabel}>{t}</div>
                          {active && <div className={styles.wCardTime}>{fmtMinutes(workTimes[t].h * 60 + workTimes[t].m)}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {editingWorkItem && (
                <WorkTimeInputModal
                  item={editingWorkItem}
                  workTimes={workTimes}
                  workingMinutes={workingMinutes}
                  onSetTime={setWorkTime}
                  onClose={() => setEditingWorkItem(null)}
                />
              )}

              {hasExisting && (
                <>
                  <hr className={styles.modalDivider} />
                  <button className={styles.deleteTriggerBtn} onClick={() => setStep('confirmDelete')}>この日の記録を削除する</button>
                </>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={onClose}>キャンセル</button>
              <button className={styles.saveBtn} onClick={() => setStep('confirm')} disabled={!inTime && !outTime}>保存する</button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>保存内容の確認</div>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.confirmTable}>
                <div className={styles.confirmRow}><span>担当者</span><strong>{user.name}</strong></div>
                <div className={styles.confirmRow}><span>日付</span><strong>{dateLabel}</strong></div>
                {inTime && <div className={styles.confirmRow}><span>出勤</span><strong style={{ color: '#2e7d32' }}>{inTime}</strong></div>}
                {outTime && <div className={styles.confirmRow}><span>退勤</span><strong style={{ color: '#c62828' }}>{outTime}</strong></div>}
                {buildWorkTypeStr() && <div className={styles.confirmRow}><span>作業</span><strong>{buildWorkTypeStr().split(',').map(e => { const [t, m] = e.split(':'); return m ? `${t} ${fmtMinutes(Number(m))}` : t }).join(' / ')}</strong></div>}
              </div>
              {hasExisting && <p className={styles.confirmWarn}>既存の記録を上書きします</p>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
              <button className={styles.saveBtn} onClick={handleConfirm}>確定する</button>
            </div>
          </>
        )}

        {step === 'confirmDelete' && (
          <>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>削除の確認</div>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalLabel}>{dateLabel} の記録をすべて削除します</p>
              <p className={styles.confirmWarn}>この操作は元に戻せません</p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
              <button className={styles.realDeleteBtn} onClick={handleDelete}>削除する</button>
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
    try {
      const [y, m] = selectedYM.split('-').map(Number)
      const dateFrom = `${selectedYM}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const dateTo = `${selectedYM}-${String(lastDay).padStart(2, '0')}`
      const buf = await exportKinmubo({ dateFrom, dateTo })
      const fileName = `出勤簿_${selectedYM}.xlsx`

      if (Capacitor.isNativePlatform()) {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        })
        await Share.share({ title: fileName, url: result.uri })
      } else {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      alert('エクスポートに失敗しました: ' + (e?.message || e))
    } finally {
      setExporting(false)
    }
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

// ─── NumpadOverlay ────────────────────────────────────────────────────────────

// ─── SettingsTab ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [minWage, setMinWage] = useState(String(DEFAULT_MIN_WAGE))
  const [wageSaved, setWageSaved] = useState(false)
  const [wageError, setWageError] = useState('')

  useEffect(() => {
    getMinWage().then(w => setMinWage(String(w)))
  }, [])

  async function handleSave() {
    if (newPin.length !== 4) { setError('4桁のPINを入力してください'); return }
    if (newPin !== confirmPin) { setError('PINが一致しません'); setConfirmPin(''); return }
    try {
      await saveAdminPin(newPin)
      setSaved(true)
      setNewPin('')
      setConfirmPin('')
      setError('')
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('保存に失敗しました')
    }
  }

  async function handleSaveWage() {
    const w = Number(minWage)
    if (!Number.isInteger(w) || w < 1) { setWageError('正しい金額を入力してください'); return }
    try {
      await saveMinWage(w)
      setWageSaved(true)
      setWageError('')
      setTimeout(() => setWageSaved(false), 3000)
    } catch {
      setWageError('保存に失敗しました')
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px' }}>
    <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* PIN変更 */}
      <div>
        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1a3f6f', marginBottom: 16 }}>管理者PIN変更</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: '0.88rem', color: '#555', fontWeight: 700, marginBottom: 6 }}>新しいPIN（4桁）</div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={e => { setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              autoComplete="new-password"
              style={{ height: 52, width: '100%', boxSizing: 'border-box', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '1.4rem', textAlign: 'center', letterSpacing: '0.4em', outline: 'none', padding: '0 12px', background: '#f8fafc', color: '#1a3f6f' }}
            />
          </div>
          <div>
            <div style={{ fontSize: '0.88rem', color: '#555', fontWeight: 700, marginBottom: 6 }}>確認（もう一度）</div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              autoComplete="new-password"
              style={{ height: 52, width: '100%', boxSizing: 'border-box', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '1.4rem', textAlign: 'center', letterSpacing: '0.4em', outline: 'none', padding: '0 12px', background: '#f8fafc', color: '#1a3f6f' }}
            />
          </div>
          {error && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
          {saved && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.9rem' }}>✓ PINを変更しました（全デバイスに反映）</div>}
          <button
            onClick={handleSave}
            disabled={newPin.length !== 4 || confirmPin.length !== 4}
            style={{ height: 52, background: '#1a5fa8', border: 'none', borderRadius: 12, color: '#fff', fontSize: '1.05rem', fontWeight: 800, cursor: 'pointer', opacity: (newPin.length !== 4 || confirmPin.length !== 4) ? 0.4 : 1 }}
          >
            PINを変更する
          </button>
          <div style={{ fontSize: '0.8rem', color: '#9baab8' }}>変更後は次回PIN入力から新しいPINが有効になります</div>
        </div>
      </div>

      {/* 最低賃金設定 */}
      <div>
        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1a3f6f', marginBottom: 16 }}>最低賃金設定</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: '0.88rem', color: '#555', fontWeight: 700, marginBottom: 6 }}>最低賃金（円/時）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                inputMode="numeric"
                value={minWage}
                onChange={e => { setMinWage(e.target.value.replace(/[^\d]/g, '')); setWageError('') }}
                style={{ height: 52, flex: 1, border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '1.3rem', textAlign: 'center', outline: 'none', padding: '0 12px', background: '#f8fafc', color: '#1a3f6f', boxSizing: 'border-box' }}
              />
              <span style={{ color: '#555', fontWeight: 700, whiteSpace: 'nowrap' }}>円/時</span>
            </div>
          </div>
          {wageError && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>{wageError}</div>}
          {wageSaved && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.9rem' }}>✓ 最低賃金を保存しました</div>}
          <button
            onClick={handleSaveWage}
            disabled={!minWage || Number(minWage) < 1}
            style={{ height: 52, background: '#1a5fa8', border: 'none', borderRadius: 12, color: '#fff', fontSize: '1.05rem', fontWeight: 800, cursor: 'pointer', opacity: (!minWage || Number(minWage) < 1) ? 0.4 : 1 }}
          >
            最低賃金を保存する
          </button>
          <div style={{ fontSize: '0.8rem', color: '#9baab8' }}>出勤日の前後5分分の給与計算に使用されます（出勤簿Excel）</div>
        </div>
      </div>
    </div>
    </div>
  )
}

const NUMPAD_KEYS     = ['1','2','3','4','5','6','7','8','9','','0','⌫']
const NUMPAD_KEYS_DEC = ['1','2','3','4','5','6','7','8','9','.','0','⌫']

function NumpadOverlay({ title, initialValue = '', maxLength = 10, decimal = false, pinMode = false, onConfirm, onClose }) {
  const [val, setVal] = useState(String(initialValue))

  function pressKey(k) {
    if (k === '⌫') { setVal(v => v.slice(0, -1)); return }
    if (k === '') return
    if (k === '.' && val.includes('.')) return
    if (val.length >= maxLength) return
    const next = val + k
    setVal(next)
    if (pinMode && next.length === maxLength) {
      onConfirm(next)
      onClose()
    }
  }

  function handleChange(e) {
    const raw = e.target.value
    const pattern = decimal ? /^[\d.]*$/ : /^\d*$/
    if (!pattern.test(raw)) return
    if (decimal && (raw.match(/\./g) || []).length > 1) return
    if (raw.length <= maxLength) setVal(raw)
  }

  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const keys = decimal ? NUMPAD_KEYS_DEC : NUMPAD_KEYS

  return (
    <div className={styles.numpadOverlay} onClick={onClose}>
      <div className={styles.numpadBox} onClick={e => e.stopPropagation()}>
        <div className={styles.numpadTitle}>{title}</div>
        {pinMode ? (
          <div style={{display:'flex',justifyContent:'center',gap:12,padding:'8px 0 4px'}}>
            {Array.from({length:maxLength}).map((_,i) => (
              <span key={i} style={{width:14,height:14,borderRadius:'50%',border:'2px solid #9baab8',background:i<val.length?'#1a5fa8':'transparent',display:'inline-block'}}/>
            ))}
          </div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            inputMode={decimal ? 'decimal' : 'numeric'}
            value={val}
            onChange={handleChange}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onConfirm(val); onClose() }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            className={styles.numpadDisplay}
            style={{ border: 'none', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        )}
        <div className={styles.numpadGrid} onMouseDown={e => e.preventDefault()}>
          {keys.map((k, i) => (
            <button
              key={i}
              className={[styles.numpadKey, k === '⌫' ? styles.numpadDel : k === '' ? styles.numpadEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >{k}</button>
          ))}
        </div>
        <div className={styles.numpadActions}>
          <button className={styles.numpadCancel} onClick={onClose}>キャンセル</button>
          {!pinMode && <button className={styles.numpadOk} onClick={() => { onConfirm(val); onClose() }}>OK</button>}
        </div>
      </div>
    </div>
  )
}

// ─── WorkTimeInputModal ───────────────────────────────────────────────────────

function WorkTimeInputModal({ item, workTimes, workingMinutes, onSetTime, onClose }) {
  const initial = workTimes[item] || { h: 0, m: 0 }
  const [digits, setDigits] = useState(() => {
    const { h, m } = initial
    if (h === 0 && m === 0) return ''
    return String(h).padStart(2, '0') + String(m).padStart(2, '0')
  })
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const activeItems = Object.keys(workTimes).filter(id => workTimes[id] && (workTimes[id].h > 0 || workTimes[id].m > 0))
  const otherMins = activeItems.filter(id => id !== item).reduce((sum, id) => {
    const t = workTimes[id] || { h: 0, m: 0 }
    return sum + t.h * 60 + t.m
  }, 0)
  const remaining = workingMinutes != null ? workingMinutes - otherMins : null

  const parsed = parseTimeDigits(digits)
  const display = formatTimeDigits(digits)
  const curH = parsed ? parsed.h : 0
  const curM = parsed ? parsed.m : 0
  const alreadySet = remaining != null && curH * 60 + curM === remaining

  function pressKey(k) {
    if (k === '⌫') { setDigits(d => d.slice(0, -1)); return }
    if (k === '') return
    const next = digits + k
    if (parseTimeDigits(next) === null) return
    setDigits(next)
  }

  function handleConfirm() {
    if (digits !== '' && !parsed?.complete) return
    onSetTime(item, 'h', curH)
    onSetTime(item, 'm', curM)
    onClose()
  }

  function applyRemaining() {
    if (remaining == null) return
    onSetTime(item, 'h', Math.floor(remaining / 60))
    onSetTime(item, 'm', remaining % 60)
    onClose()
  }

  return (
    <div className={styles.numpadOverlay} onClick={e => { e.stopPropagation(); onClose() }}>
      <div className={styles.numpadBox} onClick={e => e.stopPropagation()}>
        <div className={styles.numpadTitle}>{item}</div>
        <input
          ref={inputRef}
          type="text"
          inputMode="none"
          readOnly
          value={display}
          onKeyDown={e => {
            if (/^\d$/.test(e.key)) { e.preventDefault(); pressKey(e.key) }
            else if (e.key === 'Backspace') { e.preventDefault(); pressKey('⌫') }
            else if (e.key === 'Enter' && (digits === '' || parsed?.complete)) { e.preventDefault(); handleConfirm() }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
          className={styles.numpadDisplay}
          style={{ border: 'none', outline: 'none', width: '100%', boxSizing: 'border-box', cursor: 'default', caretColor: 'transparent' }}
        />
        {remaining != null && remaining > 0 && !alreadySet && (
          <button className={styles.remainingBtnInline} onClick={applyRemaining}>
            残り{fmtMinutes(remaining)}を入力
          </button>
        )}
        <div className={styles.numpadGrid} onMouseDown={e => e.preventDefault()}>
          {NUMPAD_KEYS.map((k, i) => (
            <button
              key={i}
              className={[styles.numpadKey, k === '⌫' ? styles.numpadDel : k === '' ? styles.numpadEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >{k}</button>
          ))}
        </div>
        <div className={styles.numpadActions}>
          <button className={styles.numpadCancel} onClick={onClose}>キャンセル</button>
          <button className={styles.numpadOk} onClick={handleConfirm} disabled={digits !== '' && !parsed?.complete}>OK</button>
        </div>
      </div>
    </div>
  )
}

// ─── TimeNumpadOverlay ────────────────────────────────────────────────────────

// digits: up to 3 or 4 digit string. first digit ≥3 → 1-digit hour (H:MM), else 2-digit (HH:MM)
function parseTimeDigits(d) {
  if (!d || d.length === 0) return { h: 0, m: 0, complete: false }
  const first = parseInt(d[0])
  if (first >= 3) {
    const h = first
    if (d.length === 1) return { h, m: 0, complete: false }
    if (parseInt(d[1]) > 5) return null
    if (d.length === 2) return { h, m: parseInt(d[1]) * 10, complete: false }
    const m = parseInt(d.slice(1))
    return m > 59 ? null : { h, m, complete: true }
  } else {
    if (d.length === 1) return { h: first, m: 0, complete: false }
    const h = parseInt(d.slice(0, 2))
    if (h > 23) return null
    if (d.length === 2) return { h, m: 0, complete: false }
    if (parseInt(d[2]) > 5) return null
    if (d.length === 3) return { h, m: parseInt(d[2]) * 10, complete: false }
    const m = parseInt(d.slice(2))
    return m > 59 ? null : { h, m, complete: true }
  }
}

function formatTimeDigits(d) {
  if (!d || d.length === 0) return '--:--'
  const first = parseInt(d[0])
  if (first >= 3) {
    return `${d[0]}:${d.slice(1).padEnd(2, '-')}`
  }
  return `${d.slice(0, 2).padEnd(2, '-')}:${d.slice(2).padEnd(2, '-')}`
}

function TimeNumpadOverlay({ title, initialValue = '', onConfirm, onClose }) {
  const [digits, setDigits] = useState(() => {
    if (initialValue && /^\d{2}:\d{2}$/.test(initialValue)) {
      return initialValue.replace(':', '')
    }
    return ''
  })
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const parsed = parseTimeDigits(digits)
  const display = formatTimeDigits(digits)

  function pressKey(k) {
    if (k === '⌫') { setDigits(d => d.slice(0, -1)); return }
    if (k === '') return
    const next = digits + k
    if (parseTimeDigits(next) === null) return
    setDigits(next)
  }

  function handleConfirm() {
    if (!parsed?.complete) return
    onConfirm(`${String(parsed.h).padStart(2, '0')}:${String(parsed.m).padStart(2, '0')}`)
    onClose()
  }

  return (
    <div className={styles.numpadOverlay} onClick={e => { e.stopPropagation(); onClose() }}>
      <div className={styles.numpadBox} onClick={e => e.stopPropagation()}>
        <div className={styles.numpadTitle}>{title}</div>
        <input
          ref={inputRef}
          type="text"
          inputMode="none"
          readOnly
          value={display}
          onKeyDown={e => {
            if (/^\d$/.test(e.key)) { e.preventDefault(); pressKey(e.key) }
            else if (e.key === 'Backspace') { e.preventDefault(); pressKey('⌫') }
            else if (e.key === 'Enter' && parsed?.complete) { e.preventDefault(); handleConfirm() }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
          className={styles.numpadDisplay}
          style={{ border: 'none', outline: 'none', width: '100%', boxSizing: 'border-box', cursor: 'default', caretColor: 'transparent' }}
        />
        <div className={styles.numpadGrid} onMouseDown={e => e.preventDefault()}>
          {NUMPAD_KEYS.map((k, i) => (
            <button
              key={i}
              className={[styles.numpadKey, k === '⌫' ? styles.numpadDel : k === '' ? styles.numpadEmpty : ''].join(' ')}
              onClick={() => pressKey(k)}
              disabled={k === ''}
            >{k}</button>
          ))}
        </div>
        <div className={styles.numpadActions}>
          <button className={styles.numpadCancel} onClick={onClose}>キャンセル</button>
          <button className={styles.numpadOk} onClick={handleConfirm} disabled={!parsed?.complete}>OK</button>
        </div>
      </div>
    </div>
  )
}

// ─── UserEditModal ────────────────────────────────────────────────────────────

const ASSIGNABLE_ITEMS = PAY_ITEMS.filter(p => !['有給', '固定手当', '休憩', '準備'].includes(p))

function UserEditModal({ user, isIn, onClose, onSaved, onDeleted }) {
  const [step, setStep] = useState('main')
  const [name, setName] = useState(user.name)
  const [pin, setPin] = useState(user.pin || '')
  const [pinError, setPinError] = useState('')
  const [workItems, setWorkItems] = useState(user.workItems || [])
  const [itemRates, setItemRates] = useState(() => {
    const r = {}
    ASSIGNABLE_ITEMS.forEach(item => {
      const ur = user.itemRates?.[item] || {}
      r[item] = {
        normal: ur.normal != null ? String(ur.normal) : '',
        sunday: ur.sunday != null ? String(ur.sunday) : '',
        amount: ur.amount != null ? String(ur.amount) : '',
      }
    })
    return r
  })
  // Per-item sunday multipliers (only set for items with sunday premium)
  const [multipliers, setMultipliers] = useState(() => {
    const m = {}
    ASSIGNABLE_ITEMS.forEach(item => {
      const ur = user.itemRates?.[item]
      if (ur?.sunday != null && String(ur.sunday) !== '') {
        if (ur.multiplier != null) {
          m[item] = String(ur.multiplier)
        } else if (ur.normal && Number(ur.normal) > 0) {
          m[item] = String(Math.round((Number(ur.sunday) / Number(ur.normal)) * 100) / 100)
        } else {
          m[item] = '1.1'
        }
      }
    })
    return m
  })
  const [dangerOpen, setDangerOpen] = useState(false)
  const [numpad, setNumpad] = useState(null) // { title, field, item, decimal, maxLength, initialValue }

  function toggleWorkItem(item) {
    setWorkItems(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    )
  }

  function setRate(item, field, val) {
    if (field === 'multiplier') {
      setMultipliers(prev => ({ ...prev, [item]: val }))
      setItemRates(prev => {
        const normalVal = prev[item]?.normal
        const sunday = normalVal === '' || normalVal == null || val === ''
          ? '' : String(Math.round(Number(normalVal) * Number(val)))
        return { ...prev, [item]: { ...prev[item], sunday } }
      })
    } else {
      setItemRates(prev => {
        const updated = { ...prev, [item]: { ...prev[item], [field]: val } }
        if (field === 'normal' && multipliers[item] != null) {
          updated[item].sunday = val === '' ? '' : String(Math.round(Number(val) * Number(multipliers[item])))
        }
        return updated
      })
    }
  }

  function buildItemRates() {
    const result = {}
    ASSIGNABLE_ITEMS.forEach(item => {
      const r = itemRates[item] || {}
      if (item === '交通費') {
        if (r.amount !== '') result[item] = { amount: Number(r.amount) }
      } else {
        const entry = {}
        if (r.normal !== '') entry.normal = Number(r.normal)
        if (r.sunday !== '') entry.sunday = Number(r.sunday)
        if (multipliers[item] != null) entry.multiplier = Number(multipliers[item])
        if (Object.keys(entry).length > 0) result[item] = entry
      }
    })
    return result
  }

  async function handleSaveName() {
    if (!name.trim()) return
    await upsertUser({ id: user.id, name: name.trim(), workItems, itemRates: buildItemRates(), pin })
    onSaved()
  }

  async function handleSavePin() {
    setPinError('')
    if (pin) {
      const existing = await resolveUserByPin(pin)
      if (existing && existing.id !== user.id) {
        setPinError('このPINは使用中です')
        return
      }
    }
    await upsertUser({ id: user.id, name: user.name, workItems, itemRates: buildItemRates(), pin })
    onSaved()
  }

  async function handleSaveItems() {
    await upsertUser({ id: user.id, name: name || user.name, workItems, itemRates: buildItemRates(), pin })
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

            {/* PIN設定 */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>PINコード</label>
              <button
                className={styles.numpadTrigger}
                onClick={() => setNumpad({ title: 'PINコード', field: 'pin', maxLength: 4, pinMode: true })}
              >
                {pin || <span className={styles.numpadTriggerPlaceholder}>未設定</span>}
              </button>
              <div className={styles.formHint}>4桁（未入力の場合はPINで打刻できません）</div>
              {pinError && <div className={styles.pinErrorMsg}>{pinError}</div>}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSavePin}>
                PINを保存
              </button>
            </div>

            <hr className={styles.modalDivider} />

            {/* Work items + rates */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>作業項目・時給</label>
              <div className={styles.itemRatesList}>
                {ASSIGNABLE_ITEMS.map(item => {
                  const checked = workItems.includes(item)
                  const r = itemRates[item] || {}
                  const isTransport = item === '交通費'
                  const isAutoItem = item === '準備'
                  return (
                    <div key={item} className={[styles.itemRateRow, checked ? styles.itemRateRowActive : ''].join(' ')}>
                      <label className={styles.itemRateCheck}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleWorkItem(item)}
                        />
                        <span className={styles.itemRateName}>
                          {item}{isAutoItem ? <span className={styles.itemRateTag}>自動</span> : ''}
                        </span>
                      </label>
                      {checked && (
                        <div className={styles.itemRateInputs}>
                          {isTransport ? (
                            <div className={styles.rateRow}>
                              <input
                                className={styles.numpadTriggerSm}
                                type="text"
                                inputMode="numeric"
                                value={r.amount}
                                onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setRate(item, 'amount', e.target.value) }}
                              />
                              <span className={styles.rateUnit}>円/回</span>
                            </div>
                          ) : (
                            <>
                              <div className={styles.rateRow}>
                                <span className={styles.rateRowLabel}>時給</span>
                                <input
                                  className={styles.numpadTriggerSm}
                                  type="text"
                                  inputMode="numeric"
                                  value={r.normal}
                                  onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setRate(item, 'normal', e.target.value) }}
                                />
                                <span className={styles.rateUnit}>円</span>
                              </div>
                              {multipliers[item] != null && (
                                <div className={styles.rateRow}>
                                  <span className={styles.rateRowLabel}>日曜</span>
                                  <span className={styles.rateMultSign}>×</span>
                                  <input
                                    className={styles.numpadTriggerXs}
                                    type="text"
                                    inputMode="decimal"
                                    value={multipliers[item] || ''}
                                    onChange={e => { const v = e.target.value; if (/^[\d.]{0,5}$/.test(v) && (v.match(/\./g)||[]).length <= 1) setRate(item, 'multiplier', v) }}
                                  />
                                  <span className={[styles.numpadTriggerSm, styles.rateInputReadOnly].join(' ')}>
                                    {r.sunday || '0'}
                                  </span>
                                  <span className={styles.rateUnit}>円</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={handleSaveItems}>作業項目・時給を保存</button>
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

      {numpad && (
        <NumpadOverlay
          title={numpad.title}
          initialValue={
            numpad.field === 'pin' ? ''
            : numpad.field === 'multiplier' ? (multipliers[numpad.item] || '')
            : (itemRates[numpad.item]?.[numpad.field] || '')
          }
          maxLength={numpad.maxLength}
          decimal={!!numpad.decimal}
          pinMode={!!numpad.pinMode}
          onConfirm={val => {
            if (numpad.field === 'pin') {
              setPin(val)
            } else if (numpad.field === 'multiplier') {
              setRate(numpad.item, 'multiplier', val)
            } else {
              setRate(numpad.item, numpad.field, val)
            }
          }}
          onClose={() => setNumpad(null)}
        />
      )}
      </div>
    </div>
  )
}
