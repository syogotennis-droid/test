import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import QRCode from 'qrcode'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  getLogs, getUsers, exportKinmubo, deleteLog, upsertUser, deleteUser,
  updateLogTime, saveLog, saveLogManual, getTodayStatuses, getClockInTimeForDate,
  resolveUserByPin, saveAdminPin,
  getWorkItems, getRatesForDate, saveOvertimeApp, getOvertimeApp, saveSalariedDay, getSalariedDaysForMonth,
  saveWorkReport, getWorkReport, getWorkReportsForRange,
  generateSessionId, saveSessionWorkReport, getSessionWorkReportsForDate,
  deleteSessionWorkReport, deleteAllSessionWorkReportsForDate,
  getSessionWorkStatusForUserRange, getMergedWorkReportsForRange,
  getSessionWorkReportsWithSessionsForRange, saveDayEditBatch,
  pairBreaks, breakMinutes, BREAK_START, BREAK_END, getTodayPunchState,
  getCommute, getTransportDays, getTransportDayMethods, getCarRates, saveCarRates, computeTransport, attendanceDates,
  COMMUTE_METHODS, carRateForDate, commuteOn, commuteLabel,
  getMinWageHistory, saveMinWageHistory, minWageForDate, getMinWageItems, saveMinWageItems,
  prepTimeRows, planMinWageChange, withRateFrom, ratePeriods,
  getWorkItemDefs, activeWorkItemDefs, itemLabel, sortByItemOrder, isDeletedWorkItem, SYSTEM_ITEMS,
  saveWorkItemDefs, newWorkItemId,
} from '../lib/db'
import QRGeneratorScreen from './QRGeneratorScreen'
import WorkItemSettings from './WorkItemSettings'
import { useWorkItemDefs } from '../lib/useWorkItemDefs'
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

// Items that can be chosen for new input (deleted items excluded), in the set order
function getWorkItemsForUser(workItems) {
  const base = (workItems && workItems.length > 0) ? workItems : LEGACY_WORK_ITEMS
  const filtered = sortByItemOrder(base.filter(item => !WORK_HIDDEN.has(item) && !isDeletedWorkItem(item)))
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

function toHalf(s) {
  return String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
}

function getTodayJst() {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

function fmtJaDate(dateStr) {
  if (!dateStr) return '—'
  const [y, mo, d] = dateStr.split('-').map(Number)
  return `${y}年${mo}月${d}日`
}

function fmtJaDateShort(dateStr) {
  if (!dateStr) return '—'
  const [, mo, d] = dateStr.split('-').map(Number)
  return `${mo}月${d}日`
}

const SIDEBAR_ITEMS = [
  {
    key: 'calendar',
    label: '記録一覧',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    key: 'kinmubo',
    label: '出勤簿作成',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    key: 'users',
    label: '従業員管理',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    key: 'qr',
    label: 'QR印刷',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        <line x1="14" y1="14" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="21" y1="14" x2="21" y2="14"/>
        <line x1="14" y1="17" x2="14" y2="17"/><line x1="17" y1="17" x2="17" y2="17"/><line x1="21" y1="17" x2="21" y2="17"/>
        <line x1="14" y1="21" x2="14" y2="21"/><line x1="17" y1="21" x2="17" y2="21"/><line x1="21" y1="21" x2="21" y2="21"/>
      </svg>
    ),
  },
  {
    key: 'settings',
    label: '設定',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
  },
]

export default function AdminScreen({ onBack, isTablet = false }) {
  const [tab, setTab] = useState('calendar')
  const [users, setUsers] = useState([])
  const today = toDateStr(new Date())
  useWorkItemDefs({ load: true }) // re-render everything when item names / order change

  useEffect(() => {
    getUsers().then(setUsers)
  }, [])

  return (
    <div className={styles.screen}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          管理メニュー
        </div>
        <nav className={styles.sidebarNav}>
          {SIDEBAR_ITEMS.map(item => (
            <button
              key={item.key}
              className={[styles.sidebarItem, tab === item.key ? styles.sidebarItemActive : ''].join(' ')}
              onClick={() => setTab(item.key)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button className={styles.sidebarBackBtn} onClick={onBack}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            ログアウト
          </button>
        </div>
      </aside>

      <div className={styles.mainContent}>
        {tab === 'qr' && <QRGeneratorScreen onBack={() => setTab('calendar')} />}
        {tab === 'calendar' && <CalendarTab users={users} today={today} isTablet={isTablet} />}
        {tab === 'kinmubo' && <KinmuboTab today={today} />}
        {tab === 'users' && <UsersTab users={users} today={today} onRefresh={() => getUsers().then(setUsers)} isTablet={isTablet} />}
        {tab === 'settings' && <SettingsTab users={users} onUsersChanged={() => getUsers().then(setUsers)} />}
      </div>
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
        {loading && <div className={styles.empty}>読み込み中</div>}
        {!loading && logs.length === 0 && <div className={styles.empty}>記録なし</div>}
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
                <p className={styles.confirmWarn}>元に戻せません</p>
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
                <p className={styles.confirmWarn}>この記録を完全に削除します。<br />元に戻せません。</p>
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
  while (days.length % 7 !== 0) days.push(null) // 末尾を7の倍数に揃える
  return days
}

function buildDayMap(logs, year, month, sessionWorkStatus) {
  const map = {}
  // Group by session_id first
  const byDaySession = {}
  const noSessionLogs = {}
  logs.forEach(log => {
    const [y, m, d] = log.date.split('-').map(Number)
    if (y !== year || m !== month + 1) return
    if (!map[d]) map[d] = {}
    if (log.session_id) {
      if (!byDaySession[d]) byDaySession[d] = {}
      if (!byDaySession[d][log.session_id]) byDaySession[d][log.session_id] = { in: '', out: '', ts: '', logs: [] }
      const entry = byDaySession[d][log.session_id]
      entry.logs.push(log)
      if (log.log_type === '出勤') { entry.in = (log.time || '').substring(0, 5); entry.ts = log.timestamp || '' }
      else if (log.log_type === '退勤') { entry.out = (log.time || '').substring(0, 5) }
    } else {
      if (!noSessionLogs[d]) noSessionLogs[d] = { ins: [], outs: [] }
      if (log.log_type === '出勤') noSessionLogs[d].ins.push({ time: (log.time || '').substring(0, 5), ts: log.timestamp || '' })
      else if (log.log_type === '退勤') noSessionLogs[d].outs.push((log.time || '').substring(0, 5))
    }
  })

  const allDays = new Set([...Object.keys(byDaySession), ...Object.keys(noSessionLogs)].map(Number))
  allDays.forEach(d => {
    const sessions = []
    // Session_id based
    const daySessionMap = byDaySession[d] || {}
    Object.entries(daySessionMap).forEach(([sid, s]) => {
      const breaks = pairBreaks(s.logs)
      sessions.push({ sessionId: sid, in: s.in, out: s.out, ts: s.ts, onBreak: !s.out && breaks.some(b => b.startLog && !b.endLog) })
    })
    // Legacy (no session_id): pair by index
    const legacy = noSessionLogs[d]
    if (legacy) {
      const sortedIns = [...legacy.ins].sort((a, b) => a.time.localeCompare(b.time))
      const sortedOuts = [...legacy.outs].sort()
      const n = Math.max(sortedIns.length, sortedOuts.length)
      for (let i = 0; i < n; i++) {
        sessions.push({ sessionId: null, in: sortedIns[i]?.time || '', out: sortedOuts[i] || '', ts: sortedIns[i]?.ts || '' })
      }
    }
    sessions.sort((a, b) => (a.in || a.ts || '').localeCompare(b.in || b.ts || ''))
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const workDoneSessionIds = sessionWorkStatus?.sessionByDate?.[dateStr] || new Set()
    const hasLegacyWork = sessionWorkStatus?.legacyDates?.has?.(dateStr) || false
    const hasWorkConflict = sessionWorkStatus?.conflictDates?.has?.(dateStr) || false
    map[d] = { sessions, workDoneSessionIds, hasLegacyWork, hasWorkConflict }
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

function CalendarTab({ users, today, isTablet }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedUser, setSelectedUser] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null)
  const [sessionWorkStatus, setSessionWorkStatus] = useState({})

  useEffect(() => {
    if (users.length > 0 && !selectedUser) setSelectedUser(users[0])
  }, [users])

  // Each load is tagged; an answer for a person or month that is no longer selected is dropped,
  // so the calendar never shows someone else's records under the selected name.
  const loadSeq = React.useRef(0)
  const [calLoadError, setCalLoadError] = useState('')
  const [userQuery, setUserQuery] = useState('')
  function loadMonth({ clear }) {
    if (!selectedUser) return
    const seq = ++loadSeq.current
    if (clear) { setLogs([]); setSessionWorkStatus({}); setLoading(true) }
    setCalLoadError('')
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    Promise.all([
      getLogs({ dateFrom: from, dateTo: to, userId: selectedUser.id }),
      getSessionWorkStatusForUserRange(selectedUser.id, from, to)
    ]).then(([data, workStatus]) => {
      if (seq !== loadSeq.current) return
      setLogs(data); setSessionWorkStatus(workStatus); setLoading(false)
    }).catch(() => {
      if (seq !== loadSeq.current) return
      setLogs([]); setSessionWorkStatus({}); setLoading(false)
      setCalLoadError('記録を読み込めませんでした。通信を確認して「再読み込み」を押してください')
    })
  }
  useEffect(() => { loadMonth({ clear: true }) }, [selectedUser, year, month])

  function refreshLogs() { loadMonth({ clear: false }) }

  const days = getCalendarDays(year, month)
  const weekCount = days.length / 7
  const dayMap = buildDayMap(logs, year, month, sessionWorkStatus)
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()
  const todayDay = now.getDate()
  const todayYear = now.getFullYear()
  const todayMonth = now.getMonth()

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
    <div className={styles.calContent}>
      {/* 職員選択 */}
      <div className={styles.calSection}>
        <div className={styles.calSectionLabel}>従業員を選択</div>
        <input className={styles.userSearchInput} value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="氏名・IDで検索" aria-label="従業員を検索" />
        <div className={styles.userTabsWrap}>
          {users.filter(u => !userQuery.trim() || u.name.includes(userQuery.trim()) || u.id.toLowerCase().includes(userQuery.trim().toLowerCase()) || u.id === selectedUser?.id).map(u => (
            <button key={u.id} className={[styles.userTab, selectedUser?.id === u.id ? styles.activeUserTab : ''].join(' ')} onClick={() => setSelectedUser(u)}>
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {/* カレンダーカード */}
      <div className={styles.calCard}>
        <div className={styles.calMonthNav}>
          <div className={styles.calMonthGroup}>
            <button className={styles.navBtn} onClick={prevMonth}>◀</button>
            <span className={styles.navDate}>{year}年{month + 1}月</span>
            <button className={styles.navBtn} onClick={nextMonth} disabled={isCurrentMonth}>▶</button>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}>読み込み中</div>
        ) : calLoadError ? (
          <div className={styles.empty}>
            <div style={{ color: '#b91c1c', fontWeight: 700, marginBottom: 10 }}>{calLoadError}</div>
            <button className={styles.navBtn} onClick={() => loadMonth({ clear: true })}>再読み込み</button>
          </div>
        ) : (
          <div className={styles.calGrid} style={{ gridTemplateRows: `auto repeat(${weekCount}, minmax(84px, auto))` }}>
            {CAL_DAY_LABELS.map((d, i) => (
              <div key={d} className={[styles.calDayLabel, i === 0 ? styles.calSun : i === 6 ? styles.calSat : ''].join(' ')}>{d}</div>
            ))}
            {days.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} className={styles.calEmpty} />
              const entry = dayMap[d]
              const sessions = entry?.sessions || []
              const inTime = sessions[0]?.in || ''
              const worked = !!inTime
              const multiSession = sessions.length > 1
              const dow = new Date(year, month, d).getDay()
              const isToday = d === todayDay && year === todayYear && month === todayMonth
              const MAX_SHOW = Math.min(2, sessions.length)
              const extraCount = Math.max(0, sessions.length - MAX_SHOW)
              const hiddenActive = sessions.slice(MAX_SHOW).some(s => !s.out)
              const workDoneSessionIds = entry?.workDoneSessionIds || new Set()
              const hasLegacyWork = entry?.hasLegacyWork || false
              const hasWorkConflict = entry?.hasWorkConflict || false
              // Work status badge for non-salaried: check if all completed sessions have work reports
              const isSalUser = selectedUser?.employeeType === 'salaried'
              let calWorkBadgeClass = null, calWorkBadgeText = null
              if (!isSalUser && worked) {
                const sessionsWithIn = sessions.filter(s => s.in)
                const outOnlyBroken = sessions.some(s => !s.in && s.out)
                if (outOnlyBroken && sessionsWithIn.length === 0) {
                  calWorkBadgeClass = styles.calWorkBadgeRed; calWorkBadgeText = '打刻要確認'
                } else if (sessionsWithIn.length > 0) {
                  const allActive = sessionsWithIn.every(s => !s.out)
                  const anyActive = sessionsWithIn.some(s => !s.out)
                  const allHaveWork = sessionsWithIn.every(s => s.sessionId && workDoneSessionIds.has(s.sessionId))
                  const anyHaveWork = sessionsWithIn.some(s => s.sessionId && workDoneSessionIds.has(s.sessionId))
                  if (hasWorkConflict) { calWorkBadgeClass = styles.calWorkBadgeRed; calWorkBadgeText = '要確認' }
                  else if (allActive) { calWorkBadgeClass = styles.calWorkBadgeBlue; calWorkBadgeText = '勤務中' }
                  else if (allHaveWork) { calWorkBadgeClass = styles.calWorkBadgeGreen; calWorkBadgeText = '業務入力済' }
                  else if (anyHaveWork) { calWorkBadgeClass = styles.calWorkBadgeOrange; calWorkBadgeText = '一部未入力' }
                  else if (hasLegacyWork) { calWorkBadgeClass = styles.calWorkBadgeGreen; calWorkBadgeText = '旧データあり' }
                  else { calWorkBadgeClass = styles.calWorkBadgeOrange; calWorkBadgeText = anyActive ? '勤務中' : '業務未入力' }
                }
              }
              return (
                <div
                  key={d}
                  className={[styles.calCell, worked ? styles.calWorked : '', dow === 0 ? styles.calSunCell : dow === 6 ? styles.calSatCell : '', isToday ? styles.calTodayCell : ''].join(' ')}
                  onClick={() => setSelectedDay(d)}
                >
                  <div className={styles.calDayHeader}>
                    <div className={[styles.calDayNum, isToday ? styles.calDayNumToday : ''].join(' ')}>{d}</div>
                    {multiSession && <span className={styles.calCountLabel}>{sessions.length}回勤務</span>}
                  </div>
                  {multiSession ? (
                    <div className={styles.calSessions}>
                      {sessions.slice(0, MAX_SHOW).map((s, idx) => (
                        <div key={idx} className={styles.calSessionRow}>
                          <span className={styles.calSessionIn}>{s.in}</span>
                          <span className={styles.calSessionArrow}>→</span>
                          {s.out
                            ? <span className={styles.calSessionTime}>{s.out}</span>
                            : <span className={styles.calSessionActive}>{s.onBreak ? '休憩中' : '勤務中'}</span>
                          }
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <button
                          className={styles.calMoreBtn}
                          onClick={e => { e.stopPropagation(); setSelectedDay(d) }}
                        >
                          ほか{extraCount}件{hiddenActive ? '・勤務中' : ''}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {inTime && (
                        <div className={styles.calOneLiner}>
                          {inTime}{' → '}
                          {sessions[0]?.out
                            ? sessions[0].out
                            : <span className={styles.calActiveInline}>{sessions[0]?.onBreak ? '休憩中' : '勤務中'}</span>
                          }
                        </div>
                      )}
                    </>
                  )}
                  {calWorkBadgeClass && <div className={calWorkBadgeClass}>{calWorkBadgeText}</div>}
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
          isTablet={isTablet}
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
    if (!tw || (tw.h === 0 && tw.m === 0)) return itemLabel(t)
    return `${itemLabel(t)} ${tw.h > 0 ? `${tw.h}時間` : ''}${tw.m > 0 ? `${tw.m}分` : ''}`
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
                          <div className={styles.wCardLabel}>{itemLabel(t)}</div>
                          {active && <div className={styles.wCardTime}>{fmtMinutes(workTimes[t].h * 60 + workTimes[t].m)}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {editingWorkItem && (
                  <PcWorkTimeInputModal
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

function parseTimeInput(str) {
  if (!str) return ''
  const s = str.trim()
  const colonMatch = s.match(/^(\d{1,2}):(\d{2})$/)
  if (colonMatch) {
    const h = parseInt(colonMatch[1]), m = parseInt(colonMatch[2])
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    return ''
  }
  const digits = s.replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.length <= 2) {
    const h = parseInt(digits)
    if (h <= 23) return `${String(h).padStart(2, '0')}:00`
    return ''
  }
  if (digits.length === 3) {
    const h = parseInt(digits[0]), m = parseInt(digits.slice(1))
    if (h <= 9 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    return ''
  }
  if (digits.length === 4) {
    const h = parseInt(digits.slice(0, 2)), m = parseInt(digits.slice(2))
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    return ''
  }
  return ''
}

function TimeTextInput({ value, onChange, className, placeholder }) {
  const [raw, setRaw] = useState(value || '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setRaw(value || '') }, [value, focused])
  function handleBlur() {
    setFocused(false)
    const parsed = parseTimeInput(raw)
    setRaw(parsed)
    onChange(parsed)
  }
  return (
    <input
      type="text"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={handleBlur}
      onFocus={e => { setFocused(true); e.target.select() }}
      placeholder={placeholder || '--:--'}
      className={className}
    />
  )
}

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

// JST calendar date of an ISO timestamp (to tell whether a punch was made after midnight)
function jstDateOf(ts) {
  const t = Date.parse(ts)
  return Number.isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 10)
}
// minutes since midnight of the shift's date; next=true means "after midnight, the following day"
function absMin(time, next) {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return (next ? 1440 : 0) + h * 60 + m
}

// A break time is "after midnight" when marked so, or when the shift ends after midnight and
// the time is earlier than the clock-in time (e.g. 23:50 in → 00:05 break end).
function breakIsNext(flag, time, inTime, outNext) {
  if (!time || !inTime) return !!flag
  return outNext ? time < inTime : !!flag // within a shift of under 24h, earlier than the clock-in means after midnight
}

function DayEditModal({ user, year, month, day, dayLogs, onClose, onSaved, isTablet }) {
  const pad = n => String(n).padStart(2, '0')
  const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
  const dow = new Date(year, month, day).getDay()
  const dateLabel = `${year}年${month + 1}月${day}日（${DOW_LABELS[dow]}）`
  const isSalaried = user?.employeeType === 'salaried'

  function initHM(timeStr) {
    if (!timeStr) return { h: '', m: '' }
    const [hStr, mStr] = timeStr.split(':')
    const hv = parseInt(hStr), mv = parseInt(mStr)
    return { h: isNaN(hv) ? '' : String(hv), m: isNaN(mv) ? '' : String(mv) }
  }

  function buildInitialSessions() {
    // Group by session_id first
    const sessionMap = {}
    const noSessionLogs = []
    dayLogs.forEach(log => {
      if (log.session_id) {
        if (!sessionMap[log.session_id]) sessionMap[log.session_id] = { inLog: null, outLog: null, logs: [] }
        sessionMap[log.session_id].logs.push(log)
        if (log.log_type === '出勤') sessionMap[log.session_id].inLog = log
        else if (log.log_type === '退勤') sessionMap[log.session_id].outLog = log
      } else {
        noSessionLogs.push(log)
      }
    })

    const result = []
    // Session_id grouped entries
    Object.entries(sessionMap).forEach(([sid, { inLog, outLog, logs }]) => {
      const inHM = initHM(inLog?.time?.substring(0, 5))
      const outHM = initHM(outLog?.time?.substring(0, 5))
      const next = l => !!l && jstDateOf(l.timestamp) > dateStr // made after midnight of this shift's date
      const outNext = next(outLog)
      const breaks = pairBreaks(logs).map((b, bi) => {
        const sHM = initHM(b.start), eHM = initHM(b.end)
        return {
          key: `${sid}-b${bi}`, sH: sHM.h, sM: sHM.m, eH: eHM.h, eM: eHM.m,
          origStart: b.start, origEnd: b.end, startLogId: b.startLog?.id || null, endLogId: b.endLog?.id || null,
          sNext: next(b.startLog), eNext: next(b.endLog),
        }
      })
      result.push({
        inH: inHM.h, inM: inHM.m, outH: outHM.h, outM: outHM.m,
        outNext, origOutNext: outNext,
        origInTime: inLog?.time?.substring(0, 5) || '',
        origOutTime: outLog?.time?.substring(0, 5) || '',
        inLogId: inLog?.id || null,
        outLogId: outLog?.id || null,
        sessionId: sid,
        breaks,
        sortKey: inLog?.time || outLog?.time || ''
      })
    })

    // Legacy logs without session_id: pair by index
    const sorted = [...noSessionLogs].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    const ins = sorted.filter(l => l.log_type === '出勤')
    const outs = sorted.filter(l => l.log_type === '退勤')
    const n = Math.max(ins.length, outs.length)
    for (let i = 0; i < n; i++) {
      const inLog = ins[i] || null
      const outLog = outs[i] || null
      const inHM = initHM(inLog?.time?.substring(0, 5))
      const outHM = initHM(outLog?.time?.substring(0, 5))
      const outNext = !!outLog && jstDateOf(outLog.timestamp) > dateStr
      result.push({
        inH: inHM.h, inM: inHM.m, outH: outHM.h, outM: outHM.m,
        outNext, origOutNext: outNext,
        origInTime: inLog?.time?.substring(0, 5) || '',
        origOutTime: outLog?.time?.substring(0, 5) || '',
        inLogId: inLog?.id || null,
        outLogId: outLog?.id || null,
        sessionId: generateSessionId(),
        breaks: [],
        legacy: true,
        sortKey: inLog?.time || outLog?.time || ''
      })
    }

    result.sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || ''))
    return result
  }

  const initialSessionsRef = useRef(buildInitialSessions())
  const [sessions, setSessions] = useState(() => initialSessionsRef.current)
  // sessionWorkRows: { [sessionId]: [{ type, h, m }] }
  const [sessionWorkRows, setSessionWorkRows] = useState({})
  const [legacyWorkItems, setLegacyWorkItems] = useState({})
  const [workItemsLoaded, setWorkItemsLoaded] = useState(false)
  const [hasConflict, setHasConflict] = useState(false)
  const [step, setStep] = useState('form')
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(true)
  const [validationErrors, setValidationErrors] = useState([])
  const [editingTimeField, setEditingTimeField] = useState(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState(null)
  const [deletedSessionIds, setDeletedSessionIds] = useState([])
  const [pendingFocusSessionId, setPendingFocusSessionId] = useState(null)
  const [clearedPunches, setClearedPunches] = useState([]) // punches that the save will delete because the time was cleared
  const lastWorkSelectRef = useRef(null)
  const initialWorkRowsSnapshot = useRef({})
  // the methods registered for that day (two or more → choose which ones were used)
  const dayCommute = commuteOn(user, dateStr)
  const asksTransport = user?.employeeType !== 'salaried' && dayCommute.list.length > 0
  const dayOptions = dayCommute.list.filter(m => m.key !== 'legacy').map(m => m.key)
  const [transportInit, setTransportInit] = useState(null) // null = loading / not applicable
  const [transportCur, setTransportCur] = useState(true)
  const [methodsInit, setMethodsInit] = useState([])
  const [methodsCur, setMethodsCur] = useState([])

  useEffect(() => {
    if (!asksTransport) return
    Promise.all([getTransportDays(dateStr, dateStr), dayOptions.length > 1 ? getTransportDayMethods(dateStr, dateStr) : {}])
      .then(([map, mm]) => {
        const v = map[`${user.id}_${dateStr}`] !== false; setTransportInit(v); setTransportCur(v)
        const saved = (mm[`${user.id}_${dateStr}`] || []).filter(k => dayOptions.includes(k))
        const m = saved.length ? saved : dayOptions.slice(0, 1)
        setMethodsInit(m); setMethodsCur(m)
      })
      .catch(() => {})
  }, [user.id, dateStr, asksTransport])
  const transportChanged = transportInit !== null && (transportCur !== transportInit || (dayOptions.length > 1 && [...methodsCur].sort().join() !== [...methodsInit].sort().join()))

  useEffect(() => {
    if (isSalaried) { setWorkItemsLoaded(true); return }
    const initSess = initialSessionsRef.current
    Promise.all([
      getSessionWorkReportsForDate(user.id, dateStr),
      getWorkReport(user.id, dateStr)
    ]).then(([sessionReports, legacyItems]) => {
      const rows = {}
      const snapshot = {}
      for (const s of initSess) {
        const items = sessionReports[s.sessionId] || {}
        const savedRows = Object.entries(items)
          .map(([type, mins]) => ({ type, h: Math.floor(mins / 60), m: mins % 60 }))
        rows[s.sessionId] = savedRows.length > 0 ? savedRows : [{ type: '', h: 0, m: 0 }]
        snapshot[s.sessionId] = { ...items }
      }
      initialWorkRowsSnapshot.current = snapshot
      setSessionWorkRows(rows)
      setLegacyWorkItems(legacyItems)
      // Detect conflict: both session and legacy data exist with different content
      const hasLeg = Object.values(legacyItems).some(m => m > 0)
      const hasSess = Object.values(sessionReports).some(items => Object.values(items).some(m => m > 0))
      if (hasLeg && hasSess) {
        const sessMerged = {}
        Object.values(sessionReports).forEach(items => {
          Object.entries(items).forEach(([t, m]) => { sessMerged[t] = (sessMerged[t] || 0) + m })
        })
        const sk = Object.keys(sessMerged).sort(), lk = Object.keys(legacyItems).filter(k => legacyItems[k] > 0).sort()
        setHasConflict(sk.join() !== lk.join() || sk.some(k => sessMerged[k] !== legacyItems[k]))
      } else {
        setHasConflict(false)
      }
      setWorkItemsLoaded(true)
    }).catch(() => {
      setWorkItemsLoaded(true)
    })
  }, [user.id, dateStr, isSalaried])

  useEffect(() => {
    if (pendingFocusSessionId && lastWorkSelectRef.current) {
      lastWorkSelectRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      lastWorkSelectRef.current.focus()
      setPendingFocusSessionId(null)
    }
  }, [pendingFocusSessionId, sessionWorkRows])

  const userWorkItems = useMemo(() => {
    const all = getWorkItemsForUser(user?.workItems)
    return all.filter(t => t !== '休憩')
  }, [user])

  function hmToTimeStr(h, m) {
    if (h === '') return ''
    const hv = parseInt(h)
    if (isNaN(hv) || hv < 0 || hv > 23) return ''
    const mv = parseInt(m)
    if (isNaN(mv) || mv < 0 || mv > 59) return ''
    return `${String(hv).padStart(2, '0')}:${String(mv).padStart(2, '0')}`
  }

  const sessionTimes = sessions.map(s => ({
    inTime: hmToTimeStr(s.inH, s.inM),
    outTime: hmToTimeStr(s.outH, s.outM),
  }))

  function updateSession(si, field, val) {
    setSessions(prev => prev.map((s, i) => i === si ? { ...s, [field]: val } : s))
  }

  const breakTimes = s => (s.breaks || []).map(b => ({ start: hmToTimeStr(b.sH, b.sM), end: hmToTimeStr(b.eH, b.eM) }))

  function updateBreak(si, bi, field, val) {
    setSessions(prev => prev.map((s, i) => i === si ? { ...s, breaks: s.breaks.map((b, j) => j === bi ? { ...b, [field]: val } : b) } : s))
  }

  function addBreak(si) {
    setSessions(prev => prev.map((s, i) => i === si
      ? { ...s, breaks: [...(s.breaks || []), { key: `new-${generateSessionId()}`, sH: '', sM: '', eH: '', eM: '', origStart: '', origEnd: '', startLogId: null, endLogId: null, sNext: false, eNext: false }] }
      : s))
  }

  function removeBreak(si, bi) {
    setSessions(prev => prev.map((s, i) => i === si ? { ...s, breaks: s.breaks.filter((_, j) => j !== bi) } : s))
  }

  function addSession() {
    const sessionId = generateSessionId()
    setSessions(prev => [...prev, { inH: '', inM: '', outH: '', outM: '', outNext: false, origOutNext: false, origInTime: '', origOutTime: '', sessionId, breaks: [] }])
    setSessionWorkRows(prev => ({ ...prev, [sessionId]: [{ type: '', h: 0, m: 0 }] }))
  }

  function tryRemoveSession(sessionId) {
    setPendingDeleteSessionId(sessionId)
    setStep('confirmDeleteSession')
  }

  function doRemoveSession(sessionId) {
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    setSessionWorkRows(prev => { const next = { ...prev }; delete next[sessionId]; return next })
    setDeletedSessionIds(prev => [...prev, sessionId])
    setPendingDeleteSessionId(null)
    setStep('form')
  }

  function updateWorkRow(sessionId, ri, field, val) {
    setSessionWorkRows(prev => ({
      ...prev,
      [sessionId]: (prev[sessionId] || []).map((r, i) => i === ri ? { ...r, [field]: val } : r)
    }))
  }

  function addWorkRow(sessionId) {
    setSessionWorkRows(prev => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] || []), { type: '', h: 0, m: 0 }]
    }))
    setPendingFocusSessionId(sessionId)
  }

  function getWorkRowError(row) {
    if (row.type && (parseInt(row.h) || 0) === 0 && (parseInt(row.m) || 0) === 0) {
      return '業務時間を入力'
    }
    return null
  }

  function removeWorkRow(sessionId, ri) {
    setSessionWorkRows(prev => {
      const rows = (prev[sessionId] || []).filter((_, i) => i !== ri)
      return { ...prev, [sessionId]: rows.length > 0 ? rows : [{ type: '', h: 0, m: 0 }] }
    })
  }

  const workHasData = sessions.some(s =>
    (sessionWorkRows[s.sessionId] || []).some(r => r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0))
  )
  const hasLegacyData = Object.values(legacyWorkItems).some(m => m > 0)
  const hasQrSessions = dayLogs.length > 0
  const canShowDelete = hasQrSessions || workHasData || hasLegacyData

  const dayTotalMins = sessions.reduce((total, s) => {
    return total + (sessionWorkRows[s.sessionId] || []).reduce((sum, r) => sum + (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0), 0)
  }, 0)

  function fmtWorkTotal(mins) {
    const h = Math.floor(mins / 60), m = mins % 60
    return `${h}時間${String(m).padStart(2, '0')}分`
  }

  function validate() {
    const errs = []
    for (let si = 0; si < sessions.length; si++) {
      const s = sessions[si]
      const pfx = sessions.length > 1 ? `${si + 1}回目：` : ''
      if (s.inH !== '' && (isNaN(parseInt(s.inH)) || parseInt(s.inH) > 23)) errs.push(`${pfx}出勤の時は0〜23`)
      if (s.inM !== '' && parseInt(s.inM) > 59) errs.push(`${pfx}出勤の分は0〜59`)
      if (s.outH !== '' && (isNaN(parseInt(s.outH)) || parseInt(s.outH) > 23)) errs.push(`${pfx}退勤の時は0〜23`)
      if (s.outM !== '' && parseInt(s.outM) > 59) errs.push(`${pfx}退勤の分は0〜59`)
      // an hour without minutes (or the other way round) would silently delete the punch
      if ((s.inH !== '') !== (s.inM !== '')) errs.push(`${pfx}出勤の${s.inH !== '' ? '分' : '時'}が空欄です`)
      if ((s.outH !== '') !== (s.outM !== '')) errs.push(`${pfx}退勤の${s.outH !== '' ? '分' : '時'}が空欄です`)
      const isNew = !s.origInTime && !s.origOutTime
      const inT = hmToTimeStr(s.inH, s.inM), outT = hmToTimeStr(s.outH, s.outM)
      if (isNew && !inT && outT) errs.push(`${pfx}出勤時刻を入力`)
      const aIn = absMin(inT, false), aOut = absMin(outT, s.outNext)
      if (aIn != null && aOut != null && aOut < aIn) {
        errs.push(`${pfx}退勤が出勤より前です`)
      }
      if (aIn != null && aOut != null && aOut - aIn > 24 * 60) errs.push(`${pfx}出勤から退勤まで24時間を超えています`)
      const brs = []
      breakTimes(s).forEach(({ start, end }, bi) => {
        const bp = `${pfx}休憩${(s.breaks || []).length > 1 ? bi + 1 : ''}：`
        const b = s.breaks[bi]
        const aS = absMin(start, breakIsNext(b.sNext, start, inT, s.outNext)), aE = absMin(end, breakIsNext(b.eNext, end, inT, s.outNext))
        if ((b.sH !== '') !== (b.sM !== '') || (b.eH !== '') !== (b.eM !== '')) errs.push(`${bp}時と分の片方が空欄です`)
        else if ((b.sH !== '' && !start) || (b.eH !== '' && !end)) errs.push(`${bp}時刻が不正です`)
        else if (!start && end) errs.push(`${bp}開始時刻を入力`)
        else if (aS != null && aE != null && aE < aS) errs.push(`${bp}終了が開始より前です`)
        else if (aS != null && aIn != null && aS < aIn) errs.push(`${bp}出勤より前です`)
        else if (aOut != null && ((aE != null && aE > aOut) || (aS != null && aS > aOut))) errs.push(`${bp}退勤より後です`)
        else if (aS != null) brs.push([aS, aE ?? aS, bp])
      })
      brs.sort((x, y) => x[0] - y[0])
      for (let k = 1; k < brs.length; k++) if (brs[k][0] < brs[k - 1][1]) errs.push(`${pfx}休憩が重なっています`)
      if (!isSalaried) {
        const rows = sessionWorkRows[s.sessionId] || []
        const typesSeen = new Set()
        const sessionPfx = sessions.length > 1 ? `${si + 1}回目 業務` : '業務'
        for (let ri = 0; ri < rows.length; ri++) {
          const r = rows[ri]
          const rpfx = `${sessionPfx}${ri + 1}行目：`
          if (r.h !== '' && r.h !== 0 && isNaN(parseInt(r.h))) errs.push(`${rpfx}時間に数値を入力`)
          const mv = parseInt(r.m)
          if (r.m !== '' && r.m !== 0 && !isNaN(mv) && (mv < 0 || mv > 59)) errs.push(`${rpfx}分は0〜59`)
          if (!r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0)) errs.push(`${rpfx}業務種別を選択`)
          if (r.type && (parseInt(r.h) || 0) === 0 && (parseInt(r.m) || 0) === 0) errs.push(`${rpfx}業務時間を入力`)
          if (r.type) {
            if (typesSeen.has(r.type)) errs.push(`${sessionPfx}：「${itemLabel(r.type)}」が複数行に登録されています`)
            typesSeen.add(r.type)
          }
        }
      }
    }
    // two shifts can't overlap in time
    const spans = sessions.map((x, i) => {
      const a = absMin(sessionTimes[i].inTime, false), b2 = absMin(sessionTimes[i].outTime, x.outNext)
      return a != null && b2 != null ? [a, b2, i + 1] : null
    }).filter(Boolean).sort((x, y) => x[0] - y[0])
    for (let k = 1; k < spans.length; k++) {
      if (spans[k][0] < spans[k - 1][1]) errs.push(`${spans[k - 1][2]}回目と${spans[k][2]}回目の時間が重なっています`)
    }
    return errs
  }

  function computeLogDiff() {
    const initialSessions = initialSessionsRef.current
    const logsToDelete = [], logsToUpdate = [], logsToCreate = [], cleared = []
    for (let si = 0; si < sessions.length; si++) {
      const s = sessions[si]
      const { inTime, outTime } = sessionTimes[si]
      const orig = initialSessions.find(o => o.sessionId === s.sessionId)
      if (orig?.inLogId) {
        if (inTime && inTime !== orig.origInTime) logsToUpdate.push({ id: orig.inLogId, time: inTime })
        else if (!inTime) { logsToDelete.push({ id: orig.inLogId }); cleared.push(`${si + 1}回目の出勤`) }
      } else if (inTime) {
        logsToCreate.push({ logType: '出勤', time: inTime, sessionId: s.sessionId })
      }
      if (orig?.outLogId) {
        if (outTime && (outTime !== orig.origOutTime || !!s.outNext !== !!orig.origOutNext)) logsToUpdate.push({ id: orig.outLogId, time: outTime, nextDay: !!s.outNext })
        else if (!outTime) { logsToDelete.push({ id: orig.outLogId }); cleared.push(`${si + 1}回目の退勤`) }
      } else if (outTime) {
        logsToCreate.push({ logType: '退勤', time: outTime, sessionId: s.sessionId, nextDay: !!s.outNext })
      }
      // breaks of this session
      const curBreaks = s.breaks || []
      const times = breakTimes(s)
      for (const ob of (orig?.breaks || [])) {
        if (!curBreaks.some(b => b.key === ob.key)) {
          if (ob.startLogId) logsToDelete.push({ id: ob.startLogId })
          if (ob.endLogId) logsToDelete.push({ id: ob.endLogId })
        }
      }
      curBreaks.forEach((b, bi) => {
        const { start, end } = times[bi]
        const pairs = [[b.startLogId, b.origStart, start, BREAK_START], [b.endLogId, b.origEnd, end, BREAK_END]]
        for (const [logId, origT, t, type] of pairs) {
          if (logId) {
            const nd = breakIsNext(type === BREAK_START ? b.sNext : b.eNext, t, inTime, s.outNext)
            if (t && (t !== origT || nd !== (type === BREAK_START ? !!b.sNext : !!b.eNext))) logsToUpdate.push({ id: logId, time: t, nextDay: nd })
            else if (!t) { logsToDelete.push({ id: logId }); cleared.push(`${si + 1}回目の休憩`) }
          } else if (t) {
            logsToCreate.push({ logType: type, time: t, sessionId: s.sessionId, nextDay: breakIsNext(type === BREAK_START ? b.sNext : b.eNext, t, inTime, s.outNext) })
          }
        }
      })
    }
    for (const deletedSid of deletedSessionIds) {
      const orig = initialSessions.find(o => o.sessionId === deletedSid)
      if (orig?.inLogId) logsToDelete.push({ id: orig.inLogId })
      if (orig?.outLogId) logsToDelete.push({ id: orig.outLogId })
      for (const ob of (orig?.breaks || [])) {
        if (ob.startLogId) logsToDelete.push({ id: ob.startLogId })
        if (ob.endLogId) logsToDelete.push({ id: ob.endLogId })
      }
    }
    return { logsToDelete, logsToUpdate, logsToCreate, cleared }
  }

  // closing with unsaved edits asks first (✕, outside tap, キャンセル)
  function requestClose() {
    if (!saving) {
      let dirty = false
      try {
        // same test as the save button: something would actually be saved
        const d = computeLogDiff()
        dirty = d.logsToDelete.length > 0 || d.logsToUpdate.length > 0 || d.logsToCreate.length > 0 ||
          (workItemsLoaded && !isSalaried && hasWorkDataChanged()) || transportChanged
      } catch { dirty = true }
      if (dirty && !window.confirm('入力した内容を破棄して閉じますか？')) return
    }
    onClose()
  }

  function hasWorkDataChanged() {
    const initial = initialWorkRowsSnapshot.current
    for (const s of sessions) {
      const rows = sessionWorkRows[s.sessionId] || []
      const cur = {}
      for (const r of rows) {
        if (!r.type) continue
        const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
        if (mins > 0) cur[r.type] = mins
      }
      const init = initial[s.sessionId] || {}
      const ck = Object.keys(cur).sort(), ik = Object.keys(init).sort()
      if (ck.join() !== ik.join() || ck.some(k => cur[k] !== init[k])) return true
    }
    for (const sid of deletedSessionIds) {
      if (Object.keys(initial[sid] || {}).length > 0) return true
    }
    return false
  }

  const errorsRef = React.useRef(null)
  function handleTryConfirm() {
    const errs = validate()
    if (errs.length > 0) {
      setValidationErrors(errs)
      // the list is below the sessions: bring it into view
      setTimeout(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
      return
    }
    setValidationErrors([])
    const { logsToDelete, logsToUpdate, logsToCreate, cleared } = computeLogDiff()
    const logChanged = logsToDelete.length > 0 || logsToUpdate.length > 0 || logsToCreate.length > 0
    const workChanged = !isSalaried && hasWorkDataChanged()
    setHasChanges(logChanged || workChanged || transportChanged)
    setClearedPunches([...new Set(cleared)])
    setStep('confirm')
  }

  async function handleConfirm() {
    if (saving) return
    if (!hasChanges) { onClose(); return }
    setSaving(true)
    try {
      const { logsToDelete, logsToUpdate, logsToCreate } = computeLogDiff()
      const rowsToItems = rows => {
        const items = {}
        for (const r of rows) {
          if (!r.type) continue
          const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
          if (mins > 0) items[r.type] = mins
        }
        return items
      }
      // Only sessions whose work rows were changed here are sent. Untouched sessions must not
      // be overwritten (the employee may have entered work on the tablet while this was open).
      const initialWork = initialWorkRowsSnapshot.current
      const sameItems = (a, b) => {
        const ak = Object.keys(a).sort(), bk = Object.keys(b).sort()
        return ak.join() === bk.join() && ak.every(k => a[k] === b[k])
      }
      const sessionWorkData = isSalaried ? [] : sessions
        .map(s => ({ sessionId: s.sessionId, items: rowsToItems(sessionWorkRows[s.sessionId] || []) }))
        .filter(x => !sameItems(x.items, initialWork[x.sessionId] || {}))
      await saveDayEditBatch({
        userId: user.id, dateStr,
        logsToDelete, logsToCreate, logsToUpdate,
        isSalaried,
        sessionWorkData,
        deletedSessionIds,
        ...(transportChanged ? { transportEligible: transportCur, ...(dayOptions.length > 1 && transportCur ? { transportMethods: methodsCur } : {}) } : {}),
      })
      onSaved()
    } catch (err) {
      setSaving(false)
      setValidationErrors(['保存できません。再度実行してください'])
      setStep('form')
    }
  }

  async function handleDelete() {
    try {
      // read the day again: a tablet may have added punches since this window was opened
      const fresh = await getLogs({ userId: user.id, date: dateStr })
      await saveDayEditBatch({
        userId: user.id, dateStr,
        logsToDelete: fresh.map(l => ({ id: l.id })), logsToCreate: [], logsToUpdate: [],
        isSalaried, sessionWorkData: [], deletedSessionIds: [],
        transportEligible: true, // removes a 支給なし mark of that day too
        deleteAllReports: true,
      })
      if (!isSalaried) { try { await saveWorkReport(user.id, dateStr, {}) } catch {} }
      onSaved()
    } catch {
      alert('削除できません。通信を確認して再度実行してください')
    }
  }

  function renderSessionPunchInputs(s, si) {
    const { inTime, outTime } = sessionTimes[si]
    const inHInvalid = s.inH !== '' && (isNaN(parseInt(s.inH)) || parseInt(s.inH) > 23)
    const inMInvalid = s.inM !== '' && parseInt(s.inM) > 59
    const outHInvalid = s.outH !== '' && (isNaN(parseInt(s.outH)) || parseInt(s.outH) > 23)
    const outMInvalid = s.outM !== '' && parseInt(s.outM) > 59
    const isIncomplete = inTime && !outTime
    if (isTablet) {
      return (
        <div className={styles.dayEditPunchRow}>
          <span className={styles.dayEditPunchTimeLabel}>出勤</span>
          <button className={styles.numpadTrigger} onClick={() => setEditingTimeField({ si, field: 'in' })}>{inTime || '──:──'}</button>
          <span className={styles.dayEditPunchArrow}>→</span>
          <span className={styles.dayEditPunchTimeLabel}>退勤</span>
          <button className={[styles.numpadTrigger, isIncomplete ? styles.numpadTriggerMuted : ''].join(' ')}
            onClick={() => setEditingTimeField({ si, field: 'out' })}>
            {outTime || (isIncomplete ? '勤務中' : '──:──')}
          </button>
        {s.outNext && <span className={styles.dayEditNextDay}>翌日</span>}
        </div>
      )
    }
    return (
      <div className={styles.dayEditPunchRow}>
        <span className={styles.dayEditPunchTimeLabel}>出勤</span>
        <input type="text" inputMode="numeric" maxLength={2} value={s.inH}
          onChange={e => updateSession(si, 'inH', toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--"
          className={[styles.dayEditHmNum, inHInvalid ? styles.dayEditHmNumErr : ''].join(' ')} />
        <span className={styles.dayEditHmUnit}>時</span>
        <input type="text" inputMode="numeric" maxLength={2} value={s.inM}
          onChange={e => updateSession(si, 'inM', toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--"
          className={[styles.dayEditHmNum, inMInvalid ? styles.dayEditHmNumErr : ''].join(' ')} />
        <span className={styles.dayEditHmUnit}>分</span>
        <span className={styles.dayEditPunchArrow}>→</span>
        <span className={styles.dayEditPunchTimeLabel}>退勤</span>
        <input type="text" inputMode="numeric" maxLength={2} value={s.outH}
          onChange={e => updateSession(si, 'outH', toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--"
          className={[styles.dayEditHmNum, outHInvalid ? styles.dayEditHmNumErr : ''].join(' ')} />
        <span className={styles.dayEditHmUnit}>時</span>
        <input type="text" inputMode="numeric" maxLength={2} value={s.outM}
          onChange={e => updateSession(si, 'outM', toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--"
          className={[styles.dayEditHmNum, outMInvalid ? styles.dayEditHmNumErr : ''].join(' ')} />
        <span className={styles.dayEditHmUnit}>分</span>
        {s.outNext && <span className={styles.dayEditNextDay}>翌日</span>}
        {isIncomplete && <span className={styles.dayEditIncomplete}>退勤未打刻</span>}
      </div>
    )
  }

  function renderBreakRows(s, si) {
    const { inTime } = sessionTimes[si]
    const list = s.breaks || []
    if (s.legacy || (!inTime && list.length === 0)) return null
    const times = breakTimes(s)
    const hmInput = (bi, hField, mField, b) => (
      <>
        <input type="text" inputMode="numeric" maxLength={2} value={b[hField]}
          onChange={e => updateBreak(si, bi, hField, toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--" className={styles.dayEditHmNum} />
        <span className={styles.dayEditHmUnit}>時</span>
        <input type="text" inputMode="numeric" maxLength={2} value={b[mField]}
          onChange={e => updateBreak(si, bi, mField, toHalf(String(e.target.value)).replace(/\D/g, '').slice(0, 2))}
          onFocus={e => { if (e.target.value) e.target.select() }} placeholder="--" className={styles.dayEditHmNum} />
        <span className={styles.dayEditHmUnit}>分</span>
      </>
    )
    return (
      <div className={styles.dayEditBreaks}>
        {list.map((b, bi) => (
          <div key={b.key} className={[styles.dayEditPunchRow, styles.dayEditBreakRow].join(' ')}>
            <span className={styles.dayEditPunchTimeLabel}>休憩</span>
            {isTablet ? (
              <>
                <button className={styles.numpadTrigger} onClick={() => setEditingTimeField({ si, bi, field: 'bs' })}>{times[bi].start || '──:──'}</button>
                <span className={styles.dayEditPunchArrow}>〜</span>
                <button className={styles.numpadTrigger} onClick={() => setEditingTimeField({ si, bi, field: 'be' })}>{times[bi].end || (times[bi].start ? '休憩中' : '──:──')}</button>
              </>
            ) : (
              <>
                {hmInput(bi, 'sH', 'sM', b)}
                <span className={styles.dayEditPunchArrow}>〜</span>
                {hmInput(bi, 'eH', 'eM', b)}
                {times[bi].start && !times[bi].end && <span className={styles.dayEditIncomplete}>戻り未打刻</span>}
              </>
            )}
            <button className={styles.dayEditBreakDel} onClick={() => removeBreak(si, bi)} title="この休憩を削除">×</button>
          </div>
        ))}
        <button className={styles.dayEditBreakAdd} onClick={() => addBreak(si)}>＋ 休憩を追加</button>
      </div>
    )
  }

  const isEmpty = sessions.length === 0 && !hasLegacyData

  return (
    <div className={styles.modalOverlay} onClick={requestClose}>
      <div className={isEmpty ? styles.modalDayEditCompact : step === 'form' ? [styles.modalLg, styles.modalDayEditForm].join(' ') : [styles.modalLg, styles.modalDayEditConfirm].join(' ')} onClick={e => e.stopPropagation()}>
        {step === 'form' && (
          <>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalHeaderTitle}>勤務記録の編集</div>
                <div className={styles.modalHeaderSub}>{dateLabel} ・ {user.name}</div>
              </div>
              <button className={styles.modalCloseBtn} onClick={requestClose} tabIndex={-1}>✕</button>
            </div>

            <div className={styles.modalBody}>
              {/* ── Per-session cards ── */}
              {sessions.length === 0 ? (
                <div className={styles.dayEditEmptyState}>
                  
                  <div className={styles.dayEditEmptyText}>打刻記録なし</div>
                  <button className={styles.dayEditAddPrimaryBtn} onClick={addSession}>＋ 打刻を追加</button>
                </div>
              ) : (
                <>
                  {sessions.map((s, si) => {
                    const { inTime, outTime } = sessionTimes[si]
                    const isNewSession = !initialSessionsRef.current.some(o => o.sessionId === s.sessionId)
                    const rows = sessionWorkRows[s.sessionId] || []
                    const sessionTotalMins = rows.reduce((sum, r) => sum + (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0), 0)
                    const selectedSessionTypes = new Set(rows.map(r => r.type).filter(Boolean))
                    const hasMoreSessionTypes = userWorkItems.some(t => !selectedSessionTypes.has(t))
                    const isBlankNew = isNewSession && !inTime && !outTime
                    // Punch status badge
                    let punchBadgeClass, punchBadgeText
                    if (isBlankNew) { punchBadgeClass = styles.dayEditBadgeNew; punchBadgeText = '新しい打刻' }
                    else if (!inTime && !outTime) { punchBadgeClass = styles.dayEditBadgeGrey; punchBadgeText = '未打刻' }
                    else if (inTime && outTime) { punchBadgeClass = styles.dayEditBadgeGreen; punchBadgeText = '退勤済' }
                    else { punchBadgeClass = styles.dayEditBadgeBlue; punchBadgeText = '勤務中' }
                    // Work status badge: skip for blank new sessions, non-salaried only, after load
                    let workBadgeClass, workBadgeText
                    if (!isSalaried && workItemsLoaded && !isBlankNew) {
                      const hasValidWork = rows.some(r => r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0))
                      const hasWorkErr = rows.some(r => getWorkRowError(r))
                      if (hasWorkErr) { workBadgeClass = styles.dayEditBadgeRed; workBadgeText = '入力要確認' }
                      else if (hasValidWork) { workBadgeClass = styles.dayEditBadgeTeal; workBadgeText = '業務入力済' }
                      else { workBadgeClass = styles.dayEditBadgeOrange; workBadgeText = '業務未入力' }
                    }
                    return (
                      <div key={s.sessionId} className={styles.dayEditSessionCard}>
                        <div className={styles.dayEditSessionCardHeader}>
                          <div className={styles.dayEditSessionBadges}>
                            <span className={styles.sessionNoBadge}>{si + 1}回目</span>
                            <span className={punchBadgeClass}>{punchBadgeText}</span>
                            {workBadgeClass && <span className={workBadgeClass}>{workBadgeText}</span>}
                          </div>
                          <button className={styles.dayEditSessionDelBtn} onClick={() => tryRemoveSession(s.sessionId)}>この勤務回を削除</button>
                        </div>
                        <div className={styles.dayEditSessionCardBody}>
                          {renderSessionPunchInputs(s, si)}
                          {renderBreakRows(s, si)}
                          {!isSalaried && !inTime && (workItemsLoaded || isNewSession) && (
                            <div className={styles.dayEditWorkSectionHint}>出勤時刻を入力すると業務を登録できます</div>
                          )}
                          {!isSalaried && inTime && (
                            !workItemsLoaded ? (
                              <div className={styles.dayEditSectionLoading}>読み込み中</div>
                            ) : (
                              <>
                                <div className={styles.dayEditWorkRows}>
                                  <div className={styles.dayEditWorkTableHeader}>
                                    <span className={styles.dayEditWorkColType}>業務</span>
                                    <span className={styles.dayEditWorkColTime}>時間</span>
                                    <span className={styles.dayEditWorkColOp}></span>
                                  </div>
                                  {rows.map((row, ri) => {
                                    const isLastRow = rows.length === 1
                                    const isNewRow = pendingFocusSessionId === s.sessionId && ri === rows.length - 1
                                    // a saved item that can no longer be chosen (e.g. deleted) stays visible
                                    const availableTypes = [
                                      ...(row.type && !userWorkItems.includes(row.type) ? [row.type] : []),
                                      ...userWorkItems.filter(t => t === row.type || !selectedSessionTypes.has(t)),
                                    ]
                                    const mInvalid = row.m !== '' && row.m !== 0 && (parseInt(row.m) < 0 || parseInt(row.m) > 59)
                                    const rowErr = getWorkRowError(row)
                                    return (
                                      <div key={ri} className={styles.dayEditWorkRow}>
                                        <select
                                          ref={isNewRow ? lastWorkSelectRef : null}
                                          className={styles.dayEditWorkTypeSelect}
                                          value={row.type}
                                          onChange={e => updateWorkRow(s.sessionId, ri, 'type', e.target.value)}
                                        >
                                          <option value="">業務を選択</option>
                                          {availableTypes.map(t => <option key={t} value={t}>{itemLabel(t)}</option>)}
                                        </select>
                                        <div className={styles.dayEditWorkTimeCell}>
                                          <input type="number" min="0" max="23"
                                            className={styles.dayEditWorkNum}
                                            value={row.h === 0 ? '' : row.h} placeholder="0"
                                            onChange={e => updateWorkRow(s.sessionId, ri, 'h', parseInt(e.target.value.replace(/[^\d]/g, '')) || 0)}
                                            onFocus={e => e.target.select()} />
                                          <span className={styles.dayEditWorkUnit}>時間</span>
                                          <input type="number" min="0" max="59"
                                            className={[styles.dayEditWorkNum, mInvalid ? styles.dayEditWorkNumErr : ''].join(' ')}
                                            value={row.m === 0 ? '' : row.m} placeholder="0"
                                            onChange={e => { const n = parseInt(e.target.value.replace(/[^\d]/g, '')); updateWorkRow(s.sessionId, ri, 'm', isNaN(n) ? 0 : n) }}
                                            onFocus={e => e.target.select()} />
                                          <span className={styles.dayEditWorkUnit}>分</span>
                                        </div>
                                        {!isLastRow && (
                                          <button className={styles.dayEditWorkRowDelSmall} onClick={() => removeWorkRow(s.sessionId, ri)} title="削除">×</button>
                                        )}
                                        {rowErr && <div className={styles.dayEditWorkRowErr}>{rowErr}</div>}
                                      </div>
                                    )
                                  })}
                                </div>
                                <div className={styles.dayEditWorkFooter}>
                                  {hasMoreSessionTypes && (
                                    <button className={styles.dayEditAddWorkBtn} onClick={() => addWorkRow(s.sessionId)}>＋ 業務を追加</button>
                                  )}
                                  <div className={styles.dayEditSessionTotal}>
                                    <span>今回の合計</span>
                                    <strong>{fmtWorkTotal(sessionTotalMins)}</strong>
                                  </div>
                                </div>
                              </>
                            )
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <button className={styles.dayEditAddOutlineBtn} onClick={addSession}>＋ 打刻を追加</button>
                </>
              )}

              {/* ── 旧データ（打刻回未設定） ── */}
              {!isSalaried && hasLegacyData && (
                <div className={styles.dayEditLegacySection}>
                  <div className={styles.dayEditLegacyTitle}>旧データ（打刻回未設定）</div>
                  {Object.entries(legacyWorkItems).filter(([, m]) => m > 0).map(([type, mins]) => (
                    <div key={type} className={styles.dayEditLegacyItem}>{itemLabel(type)}：{fmtWorkTotal(mins)}</div>
                  ))}
                </div>
              )}

              {hasConflict && (
                <div className={styles.dayEditConflictWarning}>
                  ⚠ 旧形式とセッション別の業務時間が両方存在します。集計に使用する内容を確認してください。
                </div>
              )}

              {asksTransport && transportInit !== null && (
                <div className={styles.dayEditTransport}>
                  <span className={styles.dayEditTransportLabel}>この日の交通費</span>
                  <div className={styles.dayEditTransportBtns}>
                    <button className={[styles.dayEditTransportBtn, transportCur ? styles.dayEditTransportOn : ''].join(' ')} onClick={() => setTransportCur(true)}>あり</button>
                    <button className={[styles.dayEditTransportBtn, !transportCur ? styles.dayEditTransportOff : ''].join(' ')} onClick={() => setTransportCur(false)}>なし</button>
                  </div>
                  {transportCur && dayOptions.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginTop: 8 }}>
                      <span style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 700 }}>使ったもの</span>
                      {dayOptions.map(k => (
                        <label key={k} className={styles.commuteCheck} style={{ minWidth: 0 }}>
                          <input type="checkbox" checked={methodsCur.includes(k)}
                            onChange={e => setMethodsCur(prev => e.target.checked ? [...prev, k] : (prev.length > 1 ? prev.filter(x => x !== k) : prev))} />
                          {commuteLabel(k)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {validationErrors.length > 0 && (
                <div className={styles.dayEditErrors} ref={errorsRef} role="alert">
                  {validationErrors.map((e, i) => <div key={i} className={styles.dayEditErrorItem}>⚠ {e}</div>)}
                </div>
              )}

              {canShowDelete && (
                <>
                  <hr className={styles.modalDivider} />
                  <button className={styles.deleteTriggerBtn} onClick={() => setStep('confirmDelete')}>
                    この日の打刻と業務時間をすべて削除
                  </button>
                </>
              )}

              {isTablet && editingTimeField && (
                <TimeNumpadOverlay
                  title={{ in: '出勤時刻', out: '退勤時刻', bs: '休憩開始', be: '休憩終了（戻り）' }[editingTimeField.field]}
                  initialValue={
                    editingTimeField.field === 'in' ? sessionTimes[editingTimeField.si].inTime
                      : editingTimeField.field === 'out' ? sessionTimes[editingTimeField.si].outTime
                        : breakTimes(sessions[editingTimeField.si])[editingTimeField.bi]?.[editingTimeField.field === 'bs' ? 'start' : 'end'] || ''
                  }
                  onConfirm={val => {
                    const [h, m] = val.split(':')
                    const si = editingTimeField.si
                    if (editingTimeField.field === 'bs' || editingTimeField.field === 'be') {
                      const [hf, mf] = editingTimeField.field === 'bs' ? ['sH', 'sM'] : ['eH', 'eM']
                      updateBreak(si, editingTimeField.bi, hf, String(parseInt(h)))
                      updateBreak(si, editingTimeField.bi, mf, String(parseInt(m)))
                    } else if (editingTimeField.field === 'in') {
                      setSessions(prev => prev.map((s, i) => i === si ? { ...s, inH: String(parseInt(h)), inM: String(parseInt(m)) } : s))
                    } else {
                      setSessions(prev => prev.map((s, i) => i === si ? { ...s, outH: String(parseInt(h)), outM: String(parseInt(m)) } : s))
                    }
                    setEditingTimeField(null)
                  }}
                  onClose={() => setEditingTimeField(null)}
                />
              )}
            </div>

            <div className={styles.modalFooter}>
              {!isSalaried && workItemsLoaded && dayTotalMins > 0 && (
                <div className={styles.dayEditFooterTotal}>
                  <span className={styles.dayEditFooterTotalLabel}>1日の合計</span>
                  <strong className={styles.dayEditFooterTotalValue}>{fmtWorkTotal(dayTotalMins)}</strong>
                </div>
              )}
              <div className={styles.dayEditFooterBtns}>
                {(() => {
                  const { logsToDelete: _ld, logsToUpdate: _lu, logsToCreate: _lc } = computeLogDiff()
                  const canSave = _ld.length > 0 || _lu.length > 0 || _lc.length > 0
                    || (workItemsLoaded && !isSalaried && hasWorkDataChanged()) || transportChanged
                  return (
                    <>
                      {validationErrors.length > 0 && (
                        <button type="button" onClick={() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                          style={{ background: 'none', border: 'none', color: '#b91c1c', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', marginRight: 'auto' }}>
                          入力エラー {validationErrors.length}件
                        </button>
                      )}
                      <button className={styles.cancelBtn} onClick={requestClose}>キャンセル</button>
                      <button
                        className={styles.saveBtn}
                        onClick={handleTryConfirm}
                        disabled={!canSave}
                        style={!canSave ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                      >確認へ</button>
                    </>
                  )
                })()}
              </div>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>保存内容の確認</div>
              <div className={styles.modalHeaderSub}>{user.name} ｜ {dateLabel}</div>
            </div>
            <div className={styles.modalBody}>
              {!hasChanges ? (
                <div className={styles.confirmNoChanges}>変更なし</div>
              ) : (
                <p className={styles.confirmInfoNote}>この日の勤務記録を更新します</p>
              )}
              {hasChanges && clearedPunches.length > 0 && (
                <div className={styles.confirmClearedWarn}>時刻を空にしたため、次の打刻を削除します：{clearedPunches.join('、')}</div>
              )}
              {hasChanges && sessions.map((s, si) => {
                const { inTime, outTime } = sessionTimes[si]
                const rows = sessionWorkRows[s.sessionId] || []
                const sessionTotalMins = rows.reduce((sum, r) => sum + (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0), 0)
                const hasContent = inTime || outTime || rows.some(r => r.type)
                if (!hasContent) return null
                return (
                  <div key={s.sessionId} className={styles.confirmSessionCard}>
                    <div className={styles.confirmSessionCardBody}>
                      <div className={styles.confirmSessionRow}>
                        <span className={styles.sessionNoBadge}>{si + 1}回目</span>
                        {!isSalaried && inTime && outTime && sessionTotalMins === 0 && <strong style={{ color: '#b45309' }}>業務未入力</strong>}
                      </div>
                      {inTime && (
                        <div className={styles.confirmSessionRow}>
                          <span>出勤</span><strong>{inTime}</strong>
                        </div>
                      )}
                      {outTime && (
                        <div className={styles.confirmSessionRow}>
                          <span>退勤</span><strong>{s.outNext ? '翌日 ' : ''}{outTime}</strong>
                        </div>
                      )}
                      {inTime && !outTime && (
                        <div className={styles.confirmSessionRow}>
                          <span>退勤</span><span className={styles.confirmUnpunched}>未打刻</span>
                        </div>
                      )}
                      {breakTimes(s).filter(b => b.start || b.end).map((b, bi) => (
                        <div key={`b${bi}`} className={styles.confirmSessionRow}>
                          <span>休憩</span><strong>{b.start || '--:--'} 〜 {b.end || '戻り未打刻'}</strong>
                        </div>
                      ))}
                      {!isSalaried && rows.filter(r => r.type).map((r, ri) => {
                        const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
                        return (
                          <div key={ri} className={styles.confirmSessionRow}>
                            <span>{itemLabel(r.type)}</span><strong>{fmtMinutes(mins)}</strong>
                          </div>
                        )
                      })}
                      {!isSalaried && sessionTotalMins > 0 && (
                        <div className={styles.confirmSessionRowTotal}>
                          <span>この回の合計</span><strong>{fmtWorkTotal(sessionTotalMins)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {hasChanges && transportChanged && (
                <div className={styles.confirmDayTotal}>
                  <span>この日の交通費</span><strong>{transportCur ? `あり${dayOptions.length > 1 ? `（${methodsCur.map(commuteLabel).join('・')}）` : ''}` : 'なし'}</strong>
                </div>
              )}
              {!isSalaried && hasChanges && dayTotalMins > 0 && (
                <div className={styles.confirmDayTotal}>
                  <span>1日の合計</span><strong>{fmtWorkTotal(dayTotalMins)}</strong>
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <div className={styles.dayEditFooterBtns}>
                <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻って修正</button>
                {hasChanges
                  ? <button className={styles.saveBtn} onClick={handleConfirm} disabled={saving}>{saving ? '保存中' : '保存する'}</button>
                  : <button className={styles.cancelBtn} onClick={onClose}>閉じる</button>
                }
              </div>
            </div>
          </>
        )}

        {step === 'confirmDelete' && (
          <>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>削除の確認</div>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.confirmTable}>
                <div className={styles.confirmRow}><span>対象従業員</span><strong>{user.name}</strong></div>
                <div className={styles.confirmRow}><span>削除する日付</span><strong>{dateLabel}</strong></div>
              </div>
              <p className={styles.confirmWarn}>この日の打刻と業務時間をすべて削除します。元に戻せません。</p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
              <button className={styles.realDeleteBtn} onClick={handleDelete}>すべて削除する</button>
            </div>
          </>
        )}

        {step === 'confirmDeleteSession' && (() => {
          const pendingRows = pendingDeleteSessionId ? (sessionWorkRows[pendingDeleteSessionId] || []) : []
          const hasWorkInSession = pendingRows.some(r => r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0))
          const pendingIdx = sessions.findIndex(s => s.sessionId === pendingDeleteSessionId)
          const pendingTime = pendingIdx >= 0 ? sessionTimes[pendingIdx] : { inTime: '', outTime: '' }
          const inLabel = pendingTime.inTime || '未入力'
          const outLabel = pendingTime.outTime || '未入力'
          return (
            <>
              <div className={styles.modalHeader}>
                <div className={styles.modalHeaderTitle}>勤務回を削除</div>
              </div>
              <div className={styles.modalBody}>
                <p className={styles.confirmPunchTimeInfo}>{user.name}・{dateLabel}・{pendingIdx + 1}回目</p>
                <p className={styles.confirmPunchTimeInfo}>出勤 {inLabel} → 退勤 {outLabel}</p>
                <p className={styles.confirmWarn}>
                  {hasWorkInSession
                    ? '業務時間も登録済みです。打刻と業務時間の両方を削除します。'
                    : '元に戻せません。'}
                </p>
              </div>
              <div className={styles.modalFooter}>
                <button className={styles.cancelBtn} onClick={() => { setPendingDeleteSessionId(null); setStep('form') }}>戻る</button>
                <button className={styles.realDeleteBtn} onClick={() => doRemoveSession(pendingDeleteSessionId)}>削除する</button>
              </div>
            </>
          )
        })()}

      </div>
    </div>
  )
}

// ─── KinmuboTab ───────────────────────────────────────────────────────────────

function KinmuboTab({ today }) {
  const currentYM = today.substring(0, 7)
  const [selectedYM, setSelectedYM] = useState(currentYM)
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [salariedSaveMsg, setSalariedSaveMsg] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [salariedDayEdits, setSalariedDayEdits] = useState({})
  const [salariedDaysData, setSalariedDaysData] = useState({})

  function timeStrToMinsK(s) {
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  }
  function minsToTimeStrK(m) {
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  function shiftMonth(delta) {
    const [y, m] = selectedYM.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setSelectedYM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  useEffect(() => {
    let cancelled = false
    setPreviewLoading(true)
    setPreview(null)
    setExpandedIds(new Set())
    setSearchQuery('')
    setLoadError('')
    const [y, m] = selectedYM.split('-').map(Number)
    const dateFrom = `${selectedYM}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const dateTo = `${selectedYM}-${String(lastDay).padStart(2, '0')}`
    Promise.all([getLogs({ dateFrom, dateTo }), getUsers(), getMinWageHistory(), getSalariedDaysForMonth(dateFrom, dateTo), getMergedWorkReportsForRange(dateFrom, dateTo), getSessionWorkReportsWithSessionsForRange(dateFrom, dateTo), getTransportDays(dateFrom, dateTo), getCarRates(), getTransportDayMethods(dateFrom, dateTo)])
      .then(([logs, users, minWageHistory, salDays, workReports, sessionWorkBySession, transportFlags, carRates, transportMethods]) => {
        if (cancelled) return
        setSalariedDaysData(salDays)
        setSalariedDayEdits({})
        setPreview(buildPreview(logs, users, minWageHistory, salDays, workReports, sessionWorkBySession, transportFlags, carRates, transportMethods))
        setPreviewLoading(false)
      })
      .catch(() => { if (!cancelled) { setPreviewLoading(false); setLoadError('データを読み込めません。通信を確認し、再読み込みしてください') } })
    return () => { cancelled = true }
  }, [selectedYM])

  function buildPreview(logs, users, minWageHistory, salariedDays = {}, workReports = {}, sessionWorkBySession = {}, transportFlags = {}, carRates = [], transportMethods = {}) {
    const transportRows = (user, dates) =>
      computeTransport(user, dates.filter(d => transportFlags[`${user.id}_${d}`] !== false), carRates, transportMethods)
        .map(t => ({ label: t.label, parentType: '交通費', isMultiPeriod: false, dayType: null, mins: null, days: t.days, rate: t.rate, pay: t.pay }))
    const EXCL = new Set(['休憩', '準備', '有給', '固定手当', '交通費'])
    const userEntries = users.filter(u =>
      logs.some(l => l.user_id === u.id) || Object.keys(workReports).some(k => k.slice(0, -11) === u.id)
    )
    return userEntries.map(user => {
      const userLogs = logs.filter(l => l.user_id === user.id)
      const itemRates = user.itemRates || {}
      const sortedLogs = [...userLogs].sort((a, b) => (a.timestamp || '') < (b.timestamp || '') ? -1 : 1)
      const byDate = {}
      sortedLogs.forEach(log => {
        if (!byDate[log.date]) byDate[log.date] = { pendingIn: null, sessions: [] }
        if (log.log_type === '出勤') {
          byDate[log.date].pendingIn = log
        } else if (log.log_type === '退勤') {
          byDate[log.date].sessions.push({
            inLog: byDate[log.date].pendingIn,
            outLog: log,
            workItems: getWorkItems(log),
            firstWork: log.first_work || null,
            lastWork: log.last_work || null,
          })
          byDate[log.date].pendingIn = null
        }
      })
      Object.values(byDate).forEach(entry => {
        if (entry.pendingIn) {
          entry.sessions.push({ inLog: entry.pendingIn, outLog: null, workItems: {}, firstWork: null, lastWork: null })
          entry.pendingIn = null
        }
      })

      // breaks punched within each session (休憩開始/休憩終了 share the session_id)
      const breakMinsOf = session => {
        const sid = session.outLog?.session_id || session.inLog?.session_id
        return sid ? breakMinutes(pairBreaks(userLogs.filter(l => l.session_id === sid))) : 0
      }
      Object.values(byDate).forEach(entry => entry.sessions.forEach(se => { se.breakMins = breakMinsOf(se) }))

      // ─── Salaried employee handling ───
      if (user.employeeType === 'salaried') {
        const regularHoursMins = user.regularHours || 0
        const standardBreakMinsVal = user.standardBreakMins || 0

        const dailySalariedRows = []
        let salWorkingDays = 0
        Object.keys(byDate).sort().forEach(ds => {
          const entry = byDate[ds]
          const completedSessions = entry.sessions.filter(s => s.inLog && s.outLog)
          const hasIn = entry.sessions.some(s => s.inLog)
          if (completedSessions.length > 0) {
            salWorkingDays++
            const firstIn = completedSessions[0].inLog.time.substring(0, 5)
            const lastOut = completedSessions[completedSessions.length - 1].outLog.time.substring(0, 5)
            const dayData = salariedDays[`${user.id}_${ds}`] || {}
            const punchedBreak = completedSessions.reduce((sum, se) => sum + se.breakMins, 0)
            const breakMins = dayData.breakMins ?? (punchedBreak > 0 ? punchedBreak : standardBreakMinsVal)
            const overtimeMins = dayData.overtimeMins || 0
            dailySalariedRows.push({ ds, firstIn, lastOut, breakMins, punchedBreak, overtimeMins, completed: true })
          } else if (hasIn) {
            const firstIn = (entry.sessions[0].inLog?.time || '').substring(0, 5)
            dailySalariedRows.push({ ds, firstIn, lastOut: null, breakMins: 0, overtimeMins: 0, completed: false })
          }
        })

        const totalOvertimeMins = dailySalariedRows.filter(r => r.completed).reduce((s, r) => s + r.overtimeMins, 0)
        const totalWorkMins = salWorkingDays * regularHoursMins + totalOvertimeMins
        // 社員 are only tracked for attendance here: no pay rows, so nothing of theirs
        // is added to 給与合計 or 業務別集計
        const rows = []
        const totalPay = 0
        const incompleteDays = dailySalariedRows.filter(r => !r.completed).length
        return { user, workingDays: salWorkingDays, attendanceDays: salWorkingDays, transportDays: null, incompleteDays, totalWorkMins, rows, totalPay, byDate, isSalariedUser: true, dailySalariedRows }
      }

      // ─── Hourly employee handling ───

      // Extract work reports for this user
      const userWorkReports = {}
      Object.entries(workReports).forEach(([key, items]) => {
        if (key.slice(0, -11) === user.id) {
          const dateStr = key.slice(-10)
          if (Object.values(items).some(m => m > 0)) userWorkReports[dateStr] = items
        }
      })

      // Merge work-report-only dates into byDate and attach workReportItems
      Object.keys(userWorkReports).forEach(dateStr => {
        if (!byDate[dateStr]) byDate[dateStr] = { pendingIn: null, sessions: [] }
      })
      Object.entries(byDate).forEach(([dateStr, entry]) => {
        entry.workReportItems = userWorkReports[dateStr] || {}
        entry.sessions.forEach(session => {
          const sid = session.outLog?.session_id || session.inLog?.session_id
          const key = sid ? `${user.id}_${dateStr}_${sid}` : null
          session.perSessionWork = key ? (sessionWorkBySession[key] || null) : null
        })
      })

      // workingDays = days with work report AND ≥1 completed QR session (spec 7)
      let workingDays = 0
      let totalCompletedSessions = 0
      const inconsistentDates = []
      const workingDates = []
      const prepSessionDates = []
      Object.entries(userWorkReports).forEach(([dateStr, items]) => {
        if (!Object.values(items).some(m => m > 0)) return
        const entry = byDate[dateStr]
        const completedSess = entry ? entry.sessions.filter(s => s.inLog && s.outLog) : []
        if (completedSess.length > 0) {
          workingDays++
          workingDates.push(dateStr)
          totalCompletedSessions += completedSess.length
          completedSess.forEach(() => prepSessionDates.push(dateStr))
        }
        else inconsistentDates.push(dateStr)
      })
      // 出勤日数: days with a completed punch (出勤＋退勤). 交通費対象日数: days that
      // count for transport (worked days the employee didn't mark 支給なし).
      const attendanceDays = attendanceDates(byDate).length
      const transportDates = workingDates.filter(d => transportFlags[`${user.id}_${d}`] !== false)

      // Build daily type minutes split from work_reports
      const dailyTypeMinsSplit = {}
      Object.entries(userWorkReports).forEach(([dateStr, items]) => {
        const [yr, mo, d] = dateStr.split('-').map(Number)
        const isWe = new Date(yr, mo - 1, d).getDay() === 0
        Object.entries(items).forEach(([t, mm]) => {
          if (!mm) return
          if (!dailyTypeMinsSplit[dateStr]) dailyTypeMinsSplit[dateStr] = {}
          if (!dailyTypeMinsSplit[dateStr][t]) dailyTypeMinsSplit[dateStr][t] = { wd: 0, we: 0 }
          if (isWe) dailyTypeMinsSplit[dateStr][t].we += mm
          else dailyTypeMinsSplit[dateStr][t].wd += mm
        })
      })

      // Build pay rows per type, per rate period
      const rows = []
      const allByDateDates = Object.keys(byDate).sort()
      const [ymY, ymM] = allByDateDates[0]?.split('-').map(Number) || [new Date().getFullYear(), new Date().getMonth() + 1]
      // every item reported in this period, even one that was taken off the employee since
      const reportedTypes = new Set()
      Object.values(userWorkReports).forEach(items => Object.keys(items).forEach(t => { if (items[t] > 0 && !EXCL.has(t)) reportedTypes.add(t) }))
      const rangeStart = allByDateDates[0] || `${ymY}-${String(ymM).padStart(2, '0')}-01`
      const rangeEnd = allByDateDates[allByDateDates.length - 1] || rangeStart
      for (const type of sortByItemOrder([...reportedTypes])) {
        const periods = ratePeriods(itemRates[type], rangeStart, rangeEnd)
        const hasSunday = periods.some(p => p.sunday > 0)
        const multiPeriod = periods.length > 1
        for (const period of periods) {
          const { fromDate, toDate, normal: normalRate, sunday: sundayRate } = period
          let wdM = 0, weM = 0
          Object.entries(dailyTypeMinsSplit).forEach(([ds, tm]) => {
            if (ds >= fromDate && ds <= toDate && tm[type]) { wdM += tm[type].wd; weM += tm[type].we }
          })
          const periodRangeLabel = multiPeriod ? `${fromDate.slice(5).replace('-','/')}〜${toDate.slice(5).replace('-','/')}` : ''
          if (hasSunday) {
            if (wdM > 0) rows.push({ label: multiPeriod ? periodRangeLabel : itemLabel(type), parentType: type, isMultiPeriod: multiPeriod, dayType: 'weekday', mins: wdM, days: null, rate: normalRate, pay: Math.round(wdM / 60 * normalRate) })
            if (weM > 0) {
              const sunRate = sundayRate > 0 ? sundayRate : normalRate // no Sunday rate in this period → normal rate
              rows.push({ label: multiPeriod ? periodRangeLabel + '（日曜）' : itemLabel(type) + '（日曜）', parentType: type, isMultiPeriod: multiPeriod, dayType: 'sunday', mins: weM, days: null, rate: sunRate, pay: Math.round(weM / 60 * sunRate) })
            }
          } else {
            const tot = wdM + weM
            if (tot > 0) rows.push({ label: multiPeriod ? periodRangeLabel : itemLabel(type), parentType: type, isMultiPeriod: multiPeriod, dayType: null, mins: tot, days: null, rate: normalRate, pay: Math.round(tot / 60 * normalRate) })
          }
        }
      }
      rows.push(...transportRows(user, workingDates))
      const prepGroups = prepTimeRows(prepSessionDates, minWageHistory)
      prepGroups.forEach(g => rows.push({
        label: prepGroups.length > 1 ? `準備時間（${g.wage}円）` : '準備時間', parentType: '準備時間',
        isMultiPeriod: false, dayType: null, mins: g.mins, days: null, rate: g.wage, pay: g.pay,
      }))
      const totalWorkMins = Object.values(userWorkReports).reduce((s, items) => s + Object.values(items).reduce((ss, m) => ss + m, 0), 0)
      const totalPay = rows.reduce((s, r) => s + (r.pay || 0), 0)
      const transportDays = getCommute(user).asks || rows.some(r => r.parentType === '交通費') ? transportDates.length : null
      // days with a clock-in that has no clock-out (also when another shift of that day is complete)
      const incompleteDays = Object.values(byDate).filter(e => e.sessions.some(se => se.inLog && !se.outLog)).length
      // finished shifts with no work entered (per shift; a day without shift ids counts once if it has no entry at all)
      const hasMins = o => Object.values(o || {}).some(m => m > 0)
      const noWorkSessions = Object.values(byDate).reduce((n, e) => {
        const done = e.sessions.filter(se => se.inLog && se.outLog)
        if (done.length === 0) return n
        if (done.every(se => !se.outLog.session_id && !se.inLog.session_id)) return n + (hasMins(e.workReportItems) ? 0 : 1)
        return n + done.filter(se => !hasMins(se.perSessionWork) && !hasMins(e.workReportItems)).length
      }, 0)
      return { user, workingDays, attendanceDays, transportDays, incompleteDays, noWorkSessions, totalWorkMins, rows, totalPay, byDate, inconsistentDates }
    })
  }

  function fmtMins(mins) {
    if (!mins) return ''
    const h = Math.floor(mins / 60), m = mins % 60
    if (h === 0) return `${m}分`
    return m > 0 ? `${h}時間${m}分` : `${h}時間`
  }

  function fmtTimeOrDays(row) {
    if (row.mins === null && row.days != null) return `${row.days}日`
    return fmtMins(row.mins)
  }

  function toggleExpand(userId) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function handleSalariedDayChange(userId, ds, field, value) {
    const key = `${userId}_${ds}`
    const merged = {
      breakMins: salariedDayEdits[key]?.breakMins ?? salariedDaysData[key]?.breakMins ?? 0,
      overtimeMins: salariedDayEdits[key]?.overtimeMins ?? salariedDaysData[key]?.overtimeMins ?? 0,
      [field]: value,
    }
    setSalariedDayEdits(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
    setSalariedDaysData(prev => ({ ...prev, [key]: { ...prev[key], userId, date: ds, [field]: value } }))
    setSalariedSaveMsg('保存中')
    try {
      await saveSalariedDay(userId, ds, { breakMins: merged.breakMins, overtimeMins: merged.overtimeMins })
      setSalariedSaveMsg('保存しました')
    } catch {
      setSalariedSaveMsg('保存できませんでした。通信を確認して、もう一度入力してください')
    }
  }

  async function handleCreate() {
    if (exporting) return

    // Warn if any user has data integrity issues
    if (preview) {
      const incomplete = []
      const inconsistent = []
      for (const p of preview) {
        if (p.isSalariedUser && p.dailySalariedRows) {
          for (const row of p.dailySalariedRows) {
            if (!row.completed) {
              const [, mo, dd] = row.ds.split('-').map(Number)
              incomplete.push(`${p.user.name}（${mo}/${dd}）`)
            }
          }
        }
        if (!p.isSalariedUser && p.inconsistentDates?.length > 0) {
          for (const ds of p.inconsistentDates) {
            const [, mo, dd] = ds.split('-').map(Number)
            inconsistent.push(`${p.user.name}（${mo}/${dd}）打刻要確認`)
          }
        }
      }
      // part-timers: a day with punches but no work entered is paid 0 yen (no 準備時間 / 交通費 either)
      const noWork = [], openHourly = []
      for (const p of preview) {
        if (p.isSalariedUser) continue
        Object.keys(p.byDate).sort().forEach(ds => {
          const e = p.byDate[ds], [, mo, dd] = ds.split('-').map(Number)
          if (e.sessions.some(x => x.inLog && x.outLog) && !Object.values(e.workReportItems || {}).some(m => m > 0)) noWork.push(`${p.user.name}（${mo}/${dd}）`)
          if (e.sessions.some(x => x.inLog && !x.outLog)) openHourly.push(`${p.user.name}（${mo}/${dd}）`)
        })
      }
      const warns = []
      if (incomplete.length > 0) warns.push(`打刻未完了（社員）：\n${incomplete.join('\n')}`)
      if (openHourly.length > 0) warns.push(`退勤の打刻がない日（アルバイト・パート）：\n${openHourly.join('\n')}`)
      if (noWork.length > 0) warns.push(`業務入力のない日（給与なし）：\n${noWork.join('\n')}`)
      if (inconsistent.length > 0) warns.push(`業務申告あり・打刻なし：\n${inconsistent.join('\n')}`)
      if (warns.length > 0) {
        const msg = `以下の要確認データがあります：\n\n${warns.join('\n\n')}\n\nこのまま出力しますか？`
        if (!window.confirm(msg)) return
      }
    }

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
        const result = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache })
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
      alert('Excel出力に失敗しました: ' + (e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  const [displayY, displayM] = selectedYM.split('-').map(Number)
  const hasData = preview && preview.length > 0
  const hasIssue = p => p.incompleteDays > 0 || p.noWorkSessions > 0 || (p.inconsistentDates?.length || 0) > 0
  const filteredPreview = preview ? preview.filter(p => p.user.name.includes(searchQuery) && (!onlyIssues || hasIssue(p))) : []
  const totalEmployees = preview ? preview.length : 0
  const totalWorkingDays = preview ? preview.reduce((s, p) => s + p.attendanceDays, 0) : 0
  const totalSalary = preview ? preview.reduce((s, p) => s + p.totalPay, 0) : 0

  const globalSummary = useMemo(() => {
    if (!preview || preview.length === 0) return null
    const typeMap = {}
    for (const { rows } of preview) {
      for (const row of rows) {
        if (row.mins === null || row.parentType === '準備時間') continue
        // by item (not by period label), so a mid-month rate change doesn't create rows without a name
        if (!typeMap[row.parentType]) typeMap[row.parentType] = { mins: 0, pay: 0 }
        typeMap[row.parentType].mins += row.mins
        typeMap[row.parentType].pay += row.pay
      }
    }
    return {
      types: sortByItemOrder(Object.keys(typeMap)).map(t => ({ label: itemLabel(t), mins: typeMap[t].mins, pay: typeMap[t].pay }))
    }
  }, [preview])

  return (
    <div className={styles.calContent}>
      <div className={styles.kinmuboPage}>

        {/* Page header */}
        <div className={styles.kinmuboPageHeader}>
          <h2 className={styles.kinmuboPageTitle}>出勤簿作成</h2>
          <p className={styles.kinmuboPageDesc}>勤務実績・給与の確認とExcel出力</p>
          {loadError && <div className={styles.confirmClearedWarn} style={{ marginTop: 8 }}>{loadError}</div>}
          {salariedSaveMsg && <div role="status" style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 50, padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', background: salariedSaveMsg.startsWith('保存できません') ? '#fef2f2' : '#f0fdf4', color: salariedSaveMsg.startsWith('保存できません') ? '#b91c1c' : '#166534', border: '1px solid ' + (salariedSaveMsg.startsWith('保存できません') ? '#fca5a5' : '#bbf7d0') }}>社員の休憩・残業：{salariedSaveMsg}</div>}
        </div>

        {/* Operation card */}
        <div className={styles.kinmuboOpCard}>
          <div className={styles.kinmuboOpLeft}>
            <span className={styles.kinmuboOpLabel}>対象月</span>
            <div className={styles.monthSelector}>
              <button className={styles.navBtn} onClick={() => shiftMonth(-1)}>◀</button>
              <span className={styles.monthLabel}>{displayY}年{displayM}月</span>
              <button className={styles.navBtn} onClick={() => shiftMonth(1)} disabled={selectedYM >= currentYM}>▶</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button
            className={styles.kinmuboExportBtn}
            onClick={handleCreate}
            disabled={exporting || previewLoading || !hasData}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? '出力中' : 'Excelを出力'}
          </button>
          {!previewLoading && hasData && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>この月の全員分を出力</div>}
          </div>

        </div>

        {/* Summary cards */}
        {!previewLoading && hasData && <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 6px 2px' }}>この月の全体（絞り込みに関係なく全員分）</div>}
        {!previewLoading && hasData && (
          <div className={styles.kinmuboSummaryRow}>
            <div className={styles.kinmuboSummaryCard}>
              <div className={styles.kinmuboSummaryLabel}>対象従業員</div>
              <div className={styles.kinmuboSummaryValue}>{totalEmployees}<span className={styles.kinmuboSummaryUnit}>名</span></div>
            </div>
            <div className={styles.kinmuboSummaryCard}>
              <div className={styles.kinmuboSummaryLabel}>総出勤日数</div>
              <div className={styles.kinmuboSummaryValue}>{totalWorkingDays}<span className={styles.kinmuboSummaryUnit}>日</span></div>
            </div>
            <div className={[styles.kinmuboSummaryCard, styles.kinmuboSummaryCardAccent].join(' ')}>
              <div className={styles.kinmuboSummaryLabel}>給与合計</div>
              <div className={[styles.kinmuboSummaryValue, styles.kinmuboSummaryValueAccent].join(' ')}>
                {totalSalary.toLocaleString()}<span className={styles.kinmuboSummaryUnit}>円</span>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {previewLoading && <div className={styles.kinmuboLoading}>読み込み中</div>}

        {/* Empty */}
        {!previewLoading && preview && !hasData && (
          <div className={styles.kinmuboEmpty}>{displayY}年{displayM}月の勤務記録はありません。</div>
        )}

        {/* Global work type summary */}
        {!previewLoading && hasData && globalSummary && globalSummary.types.length > 0 && (
          <div className={styles.kinmuboGlobalSummary}>
            <div className={styles.kinmuboGlobalSummaryTitle}>業務別集計</div>
            <div className={styles.kinmuboGlobalTableWrap}>
              <table className={styles.kinmuboGlobalTable}>
                <thead>
                  <tr>
                    <th className={styles.kinmuboGlobalTh}>単価種別</th>
                    <th className={[styles.kinmuboGlobalTh, styles.kinmuboGlobalThNum].join(' ')}>時間合計</th>
                    <th className={[styles.kinmuboGlobalTh, styles.kinmuboGlobalThNum].join(' ')}>金額合計</th>
                  </tr>
                </thead>
                <tbody>
                  {globalSummary.types.map(({ label, mins, pay }) => (
                    <tr key={label} className={styles.kinmuboGlobalRow}>
                      <td className={styles.kinmuboGlobalTd}>{label}</td>
                      <td className={[styles.kinmuboGlobalTd, styles.kinmuboGlobalTdNum].join(' ')}>{fmtMins(mins)}</td>
                      <td className={[styles.kinmuboGlobalTd, styles.kinmuboGlobalTdNum, styles.kinmuboGlobalTdPay].join(' ')}>{pay.toLocaleString()}円</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={styles.kinmuboGlobalTotRow}>
                    <td className={styles.kinmuboGlobalTotTd}>合計</td>
                    <td className={[styles.kinmuboGlobalTotTd, styles.kinmuboGlobalTdNum].join(' ')}>{fmtMins(globalSummary.types.reduce((s, t) => s + t.mins, 0))}</td>
                    <td className={[styles.kinmuboGlobalTotTd, styles.kinmuboGlobalTdNum, styles.kinmuboGlobalTdPay].join(' ')}>{globalSummary.types.reduce((s, t) => s + t.pay, 0).toLocaleString()}円</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Employee list */}
        {!previewLoading && hasData && (
          <div className={styles.kinmuboListSection}>
            <div className={styles.kinmuboListControls}>
              <input
                type="text"
                className={styles.kinmuboSearch}
                placeholder="一覧を従業員名で絞り込み"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <div className={styles.kinmuboExpandBtns}>
                <label className={styles.kinmuboExpandBtn} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} />要確認のみ
                </label>
                <button className={styles.kinmuboExpandBtn} onClick={() => {
                  setExpandedIds(prev => new Set([...prev, ...filteredPreview.map(p => p.user.id)]))
                }}>表示中を展開</button>
                <button className={styles.kinmuboExpandBtn} onClick={() => {
                  const ids = new Set(filteredPreview.map(p => p.user.id))
                  setExpandedIds(prev => new Set([...prev].filter(id => !ids.has(id))))
                }}>表示中を閉じる</button>
              </div>
            </div>

            {filteredPreview.length === 0 && (
              <div className={styles.kinmuboEmpty}>該当なし</div>
            )}

            {filteredPreview.map(({ user, workingDays, attendanceDays, transportDays, incompleteDays, noWorkSessions, totalWorkMins, rows, totalPay, byDate, isSalariedUser, dailySalariedRows, inconsistentDates }) => {
              const isOpen = expandedIds.has(user.id)
              return (
                <div key={user.id} className={[styles.kinmuboAccordion, isOpen ? styles.kinmuboAccordionOpen : ''].join(' ')}>
                  <button
                    className={styles.kinmuboAccordionHeader}
                    onClick={() => toggleExpand(user.id)}
                    aria-expanded={isOpen}
                  >
                    <span className={styles.kinmuboAccordionName}>{user.name}</span>
                    <span className={styles.kinmuboAccordionMeta}>
                      <span className={styles.kinmuboAccordionDays}>勤務申告：{workingDays}日</span>
                      <span className={styles.kinmuboAccordionSep}> ｜ </span>
                      <span className={styles.kinmuboAccordionDays}>出勤日数：{attendanceDays}日</span>
                      {transportDays != null && (
                        <>
                          <span className={styles.kinmuboAccordionSep}> ｜ </span>
                          <span className={styles.kinmuboAccordionDays}>交通費対象：{transportDays}日</span>
                        </>
                      )}
                      <span className={styles.kinmuboAccordionSep}> ｜ </span>
                      <span className={styles.kinmuboAccordionTime}>申告時間合計：{fmtMins(totalWorkMins) || "0分"}</span>
                    </span>
                    {inconsistentDates?.length > 0 && (
                      <span className={styles.kinmuboAccordionWarn}>打刻要確認 {inconsistentDates.length}件</span>
                    )}
                    {incompleteDays > 0 && (
                      <span className={styles.kinmuboAccordionWarn}>打刻未完了 {incompleteDays}日</span>
                    )}
                    {!isSalariedUser && noWorkSessions > 0 && (
                      <span className={styles.kinmuboAccordionWarn}>業務未入力 {noWorkSessions}回</span>
                    )}
                    {!isSalariedUser && <span className={styles.kinmuboAccordionPay}>給与合計：{totalPay.toLocaleString()}円</span>}
                    <svg
                      className={[styles.kinmuboAccordionChevron, isOpen ? styles.kinmuboAccordionChevronOpen : ''].join(' ')}
                      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>

                  {isOpen && (
                    <div className={styles.kinmuboAccordionBody}>
                      {/* Salaried employee: per-day break/overtime inputs */}
                      {isSalariedUser && dailySalariedRows && dailySalariedRows.length > 0 && (
                        <div className={styles.kinmuboDailySection}>
                          <div className={styles.kinmuboDailySectionTitle}>打刻・勤怠管理</div>
                          <table className={styles.kinmuboDailyTable}>
                            <thead>
                              <tr>
                                <th className={styles.kinmuboDailyTh}>日付</th>
                                <th className={styles.kinmuboDailyTh}>出勤</th>
                                <th className={styles.kinmuboDailyTh}>退勤</th>
                                <th className={styles.kinmuboDailyTh}>状態</th>
                                <th className={styles.kinmuboDailyTh}>休憩時間</th>
                                <th className={styles.kinmuboDailyTh}>所定労働時間</th>
                                <th className={styles.kinmuboDailyTh}>残業時間</th>
                                <th className={styles.kinmuboDailyTh}>合計（所定＋残業）</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dailySalariedRows.map(({ ds, firstIn, lastOut, completed, punchedBreak }) => {
                                const [y, mo, d] = ds.split('-').map(Number)
                                const dow = new Date(y, mo - 1, d).getDay()
                                const dowLabel = ['日','月','火','水','木','金','土'][dow]
                                const isSun = dow === 0, isSat = dow === 6
                                const key = `${user.id}_${ds}`
                                const edits = salariedDayEdits[key] || {}
                                const baseData = salariedDaysData[key] || {}
                                const breakMins = edits.breakMins ?? baseData.breakMins ?? (punchedBreak > 0 ? punchedBreak : (user.standardBreakMins ?? 0))
                                const overtimeMins = edits.overtimeMins ?? baseData.overtimeMins ?? 0
                                const breakH = Math.floor(breakMins / 60)
                                const breakM = breakMins % 60
                                const overH = Math.floor(overtimeMins / 60)
                                const overM = overtimeMins % 60
                                const regularHoursMins = user.regularHours || 0
                                const totalMins = completed ? regularHoursMins + overtimeMins : 0
                                return (
                                  <tr key={ds} className={[
                                    styles.kinmuboDailyRow,
                                    isSun ? styles.kinmuboDailyRowSun : isSat ? styles.kinmuboDailyRowSat : '',
                                  ].filter(Boolean).join(' ')}>
                                    <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyDateTd].join(' ')}>
                                      {`${mo}/${d}（${dowLabel}）`}
                                    </td>
                                    <td className={styles.kinmuboDailyTd} style={{ color: '#2e7d32', fontWeight: 600 }}>
                                      {firstIn || '—'}
                                    </td>
                                    <td className={styles.kinmuboDailyTd} style={{ color: '#c62828', fontWeight: 600 }}>
                                      {lastOut || (completed ? '—' : '')}
                                    </td>
                                    <td className={styles.kinmuboDailyTd}>
                                      {completed
                                        ? <span style={{ color: '#15803d', fontWeight: 700, fontSize: '0.8rem' }}>出勤確定</span>
                                        : <span style={{ color: '#b45309', fontWeight: 700, fontSize: '0.8rem' }}>打刻未完了</span>}
                                    </td>
                                    <td className={styles.kinmuboDailyTd}>
                                      {completed ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                          <input
                                            type="number" min="0" max="23" className={styles.salDayInput}
                                            value={breakH}
                                            onChange={e => {
                                              const newH = parseInt(e.target.value) || 0
                                              handleSalariedDayChange(user.id, ds, 'breakMins', newH * 60 + breakM)
                                            }}
                                          />
                                          <span style={{ fontSize: '0.75rem' }}>時間</span>
                                          <input
                                            type="number" min="0" max="59" className={styles.salDayInput}
                                            value={breakM}
                                            onChange={e => {
                                              const newM = parseInt(e.target.value) || 0
                                              handleSalariedDayChange(user.id, ds, 'breakMins', breakH * 60 + newM)
                                            }}
                                          />
                                          <span style={{ fontSize: '0.75rem' }}>分</span>
                                        </span>
                                      ) : '—'}
                                    </td>
                                    <td className={styles.kinmuboDailyTd} style={{ fontSize: '0.85rem' }}>
                                      {completed ? fmtMins(regularHoursMins) : '—'}
                                    </td>
                                    <td className={styles.kinmuboDailyTd}>
                                      {completed ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                          <input
                                            type="number" min="0" max="23" className={styles.salDayInput}
                                            value={overH}
                                            onChange={e => {
                                              const newH = parseInt(e.target.value) || 0
                                              handleSalariedDayChange(user.id, ds, 'overtimeMins', newH * 60 + overM)
                                            }}
                                          />
                                          <span style={{ fontSize: '0.75rem' }}>時間</span>
                                          <input
                                            type="number" min="0" max="59" className={styles.salDayInput}
                                            value={overM}
                                            onChange={e => {
                                              const newM = parseInt(e.target.value) || 0
                                              handleSalariedDayChange(user.id, ds, 'overtimeMins', overH * 60 + newM)
                                            }}
                                          />
                                          <span style={{ fontSize: '0.75rem' }}>分</span>
                                        </span>
                                      ) : '—'}
                                    </td>
                                    <td className={styles.kinmuboDailyTd} style={{ fontWeight: 700 }}>
                                      {completed && totalMins > 0 ? fmtMins(totalMins) : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {/* 打刻記録: show all dates with punch or work report data */}
                      {!isSalariedUser && Object.keys(byDate).sort().some(ds => byDate[ds].sessions.length > 0 || Object.keys(byDate[ds].workReportItems || {}).length > 0) && (
                        <div className={styles.kinmuboDailySection}>
                          <div className={styles.kinmuboDailySectionTitle}>打刻記録</div>
                          <table className={styles.kinmuboDailyTable}>
                            <thead>
                              <tr>
                                <th className={styles.kinmuboDailyTh} style={{ width: '90px' }}>日付</th>
                                <th className={styles.kinmuboDailyTh} style={{ width: '52px' }}>出勤</th>
                                <th className={styles.kinmuboDailyTh} style={{ width: '52px' }}>退勤</th>
                                <th className={[styles.kinmuboDailyTh, styles.kinmuboDailyContentTh].join(' ')}>業務内容</th>
                                <th className={styles.kinmuboDailyTh} style={{ width: '56px' }}>回合計</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.keys(byDate).sort().filter(ds =>
                                byDate[ds].sessions.length > 0 || Object.keys(byDate[ds].workReportItems || {}).length > 0
                              ).flatMap(ds => {
                                const [y, mo, d] = ds.split('-').map(Number)
                                const dow = new Date(y, mo - 1, d).getDay()
                                const dowLabel = ['日','月','火','水','木','金','土'][dow]
                                const isSun = dow === 0, isSat = dow === 6
                                const entry = byDate[ds]
                                const dateLabel = `${mo}/${d}（${dowLabel}）`
                                const rowClass = [styles.kinmuboDailyRow, isSun ? styles.kinmuboDailyRowSun : isSat ? styles.kinmuboDailyRowSat : ''].filter(Boolean).join(' ')

                                if (entry.sessions.length === 0) {
                                  const legacyItems = entry.workReportItems || {}
                                  const legacyEntries = Object.entries(legacyItems).filter(([, m]) => m > 0)
                                  const legacyContent = legacyEntries.map(([t, m]) => `${itemLabel(t)}: ${fmtMins(m)}`).join(' / ') || '—'
                                  const legacyTotal = legacyEntries.reduce((s, [, m]) => s + m, 0)
                                  return [(
                                    <tr key={ds} className={rowClass}>
                                      <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyDateTd].join(' ')}>{dateLabel}</td>
                                      <td className={styles.kinmuboDailyTd} colSpan={2} style={{ color: '#78716c', fontStyle: 'italic', fontSize: '0.8rem' }}>旧データ（1日合計）</td>
                                      <td className={styles.kinmuboDailyTd} style={{ fontSize: '0.82rem', color: '#475569' }}>{legacyContent}</td>
                                      <td className={styles.kinmuboDailyTd} style={{ fontWeight: 600 }}>{legacyTotal > 0 ? fmtMins(legacyTotal) : '—'}</td>
                                    </tr>
                                  )]
                                }

                                const numSessions = entry.sessions.length
                                return entry.sessions.map((session, si) => {
                                  const inStr = session.inLog?.time?.substring(0, 5) || ''
                                  const outStr = session.outLog?.time?.substring(0, 5) || ''
                                  const perWork = session.perSessionWork
                                  const hasWork = perWork && Object.values(perWork).some(m => m > 0)
                                  const workContent = hasWork
                                    ? sortByItemOrder(Object.keys(perWork)).filter(t => perWork[t] > 0).map(t => `${itemLabel(t)}: ${fmtMins(perWork[t])}`).join(' / ')
                                    : null
                                  const sessionTotal = hasWork ? Object.values(perWork).reduce((s, m) => s + m, 0) : 0
                                  return (
                                    <tr key={`${ds}-${si}`} className={[rowClass, si > 0 ? styles.kinmuboDailyGroupExtra : ''].filter(Boolean).join(' ')}>
                                      {si === 0 && (
                                        <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyDateTd].join(' ')} rowSpan={numSessions}>
                                          <span>{dateLabel}</span>
                                          {numSessions > 1 && <span className={styles.multiSessionBadge}>{numSessions}回</span>}
                                        </td>
                                      )}
                                      <td className={styles.kinmuboDailyTd} style={{ color: '#2e7d32', fontWeight: 600 }}>
                                        {inStr || '—'}
                                      </td>
                                      <td className={styles.kinmuboDailyTd}>
                                        {outStr
                                          ? <span style={{ color: '#c62828', fontWeight: 600 }}>{outStr}</span>
                                          : session.inLog
                                            ? <span style={{ color: '#1d4ed8', fontWeight: 600 }}>勤務中</span>
                                            : <span style={{ color: '#94a3b8' }}>—</span>
                                        }
                                        {session.breakMins > 0 && (
                                          <div style={{ color: '#b45309', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>休憩{fmtMins(session.breakMins)}</div>
                                        )}
                                      </td>
                                      <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyContentTd].join(' ')}>
                                        {hasWork
                                          ? <span style={{ color: '#1e293b', fontSize: '0.82rem' }}>{workContent}</span>
                                          : <span style={{ color: '#92400e', fontSize: '0.8rem' }}>業務未入力</span>
                                        }
                                      </td>
                                      <td className={styles.kinmuboDailyTd} style={{ fontWeight: hasWork ? 600 : 400, color: hasWork ? '#1e293b' : '#94a3b8' }}>
                                        {hasWork ? fmtMins(sessionTotal) : '—'}
                                      </td>
                                    </tr>
                                  )
                                })
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {isSalariedUser ? null : rows.length === 0 ? (
                        <div className={styles.kinmuboNoData}>業務時間の入力なし</div>
                      ) : (
                        <table className={styles.kinmuboDetailTable}>
                          <thead>
                            <tr>
                              <th className={styles.kinmuboDetailTh}>区分</th>
                              <th className={[styles.kinmuboDetailTh, styles.kinmuboDetailRight].join(' ')}>時間・日数</th>
                              <th className={[styles.kinmuboDetailTh, styles.kinmuboDetailRight].join(' ')}>単価</th>
                              <th className={[styles.kinmuboDetailTh, styles.kinmuboDetailRight].join(' ')}>金額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => {
                              const prevParent = i > 0 ? rows[i - 1].parentType : null
                              const needsGroupHeader = r.isMultiPeriod && r.parentType !== prevParent
                              return (
                                <React.Fragment key={i}>
                                  {needsGroupHeader && (
                                    <tr className={styles.kinmuboDetailGroupHeader}>
                                      <td colSpan={4} className={styles.kinmuboDetailGroupTd}>{itemLabel(r.parentType)}</td>
                                    </tr>
                                  )}
                                  <tr className={[styles.kinmuboDetailRow, r.isMultiPeriod ? styles.kinmuboDetailSubRow : ''].join(' ')}>
                                    <td className={[styles.kinmuboDetailTd, r.isMultiPeriod ? styles.kinmuboDetailSubTd : ''].join(' ')}>{r.label}</td>
                                    <td className={[styles.kinmuboDetailTd, styles.kinmuboDetailRight].join(' ')}>{fmtTimeOrDays(r)}</td>
                                    <td className={[styles.kinmuboDetailTd, styles.kinmuboDetailRight].join(' ')}>{r.rate > 0 ? r.rate.toLocaleString() + '円' : '—'}</td>
                                    <td className={[styles.kinmuboDetailTd, styles.kinmuboDetailRight].join(' ')}>{r.pay > 0 ? r.pay.toLocaleString() + '円' : '—'}</td>
                                  </tr>
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td className={styles.kinmuboDetailTd} colSpan={3}>給与合計</td>
                              <td className={[styles.kinmuboDetailTd, styles.kinmuboDetailRight, styles.kinmuboDetailTotPay].join(' ')}>{totalPay.toLocaleString()}円</td>
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

function UsersTab({ users, today, onRefresh, isTablet }) {
  const [statuses, setStatuses] = useState({})
  const [editingUser, setEditingUser] = useState(null)
  const [qrUser, setQrUser] = useState(null)
  const [adding, setAdding] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => { loadStatuses() }, [])

  // null = still loading, 'error' = could not load (never shown as 未出勤 until known)
  const [statusState, setStatusState] = useState(null)
  async function loadStatuses() {
    try {
      const s = await getTodayStatuses()
      setStatuses(s); setStatusState('ok')
    } catch {
      setStatusState(prev => (prev === 'ok' ? 'ok' : 'error'))
    }
  }

  async function handleModalSaved() {
    setEditingUser(null)
    await loadStatuses()
    onRefresh()
  }

  const q = searchQuery.toLowerCase()
  const filtered = users.filter(u => {
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
    const isIn = statuses[u.id] === true
    const matchStatus = statusFilter === 'all'
      || (statusFilter === 'in' && isIn)
      || (statusFilter === 'out' && !isIn)
    const isSal = u.employeeType === 'salaried'
    const matchType = typeFilter === 'all'
      || (typeFilter === 'salaried' && isSal)
      || (typeFilter === 'hourly' && !isSal)
    return matchSearch && matchStatus && matchType
  })
  const isFiltering = !!searchQuery || statusFilter !== 'all' || typeFilter !== 'all'
  const countLabel = isFiltering
    ? `${users.length}名中 ${filtered.length}名を表示`
    : `登録従業員 ${users.length}名`

  return (
    <div className={styles.calContent}>
      <div className={styles.usersPage}>

        {/* Page header */}
        <div className={styles.usersPageHeader}>
          <div>
            <h2 className={styles.kinmuboPageTitle}>従業員管理</h2>
            <p className={styles.kinmuboPageDesc}>従業員・PIN・業務・時給の管理</p>
          </div>
          <button className={styles.kinmuboExportBtn} onClick={() => setAdding(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            従業員を追加
          </button>
        </div>

        {/* Filter card */}
        <div className={styles.usersFilterCard}>
          <input
            type="text"
            className={styles.kinmuboSearch}
            placeholder="氏名・従業員IDで検索"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className={styles.usersStatusFilter}>
            {[['all','すべて'],['in','出勤中'],['out','未出勤']].map(([v,l]) => (
              <button
                key={v}
                className={[styles.usersFilterBtn, statusFilter === v ? styles.usersFilterBtnActive : ''].join(' ')}
                onClick={() => setStatusFilter(v)}
              >{l}</button>
            ))}
          </div>
          <div className={styles.usersStatusFilter}>
            {[['all','全種別'],['hourly','アルバイト・パート'],['salaried','社員']].map(([v,l]) => (
              <button
                key={v}
                className={[styles.usersFilterBtn, typeFilter === v ? styles.usersFilterBtnActive : ''].join(' ')}
                onClick={() => setTypeFilter(v)}
              >{l}</button>
            ))}
          </div>
          <span className={styles.usersCount}>{countLabel}</span>
        </div>

        {/* User table */}
        <div className={styles.usersTableCard}>
          {users.length === 0 ? (
            <div className={styles.kinmuboEmpty}>従業員が登録されていません</div>
          ) : filtered.length === 0 ? (
            <div className={styles.kinmuboEmpty}>該当なし</div>
          ) : (
            <table className={styles.usersTable}>
              <thead>
                <tr>
                  <th className={styles.usersTh}>氏名</th>
                  <th className={styles.usersTh}>従業員ID</th>
                  <th className={styles.usersTh}>本日の状態</th>
                  <th className={styles.usersTh} style={{width:90}}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => {
                  const isIn = statuses[user.id] === true
                  return (
                    <tr
                      key={user.id}
                      className={styles.usersTr}
                      onClick={() => setEditingUser(user)}
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingUser(user) } }}
                    >
                      <td className={styles.usersTd}>
                        <div className={styles.usersNameCell}>
                          <div className={styles.usersAvatar}>{user.name.charAt(0)}</div>
                          <span className={styles.usersName}>{user.name}</span>
                        </div>
                      </td>
                      <td className={styles.usersTd}>
                        <span className={styles.usersId}>{user.id}</span>
                      </td>
                      <td className={styles.usersTd}>
                        <span className={[styles.statusBadge, isIn ? styles.statusIn : styles.statusOut].join(' ')}>
                          {statusState === null ? '確認中' : statusState === 'error' ? '確認できません' : isIn ? '出勤中' : '未出勤'}
                        </span>
                      </td>
                      <td className={styles.usersTd}>
                        <button
                          className={styles.usersEditBtn}
                          onClick={e => { e.stopPropagation(); setEditingUser(user) }}
                        >編集</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {adding && (
        <AddUserModal
          users={users}
          onClose={() => setAdding(false)}
          onAdded={newUser => { setAdding(false); onRefresh(); setQrUser(newUser) }}
        />
      )}

      {qrUser && (
        <div className={styles.modalOverlay} onClick={() => setQrUser(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>従業員を追加しました</h3>
            <p className={styles.modalLabel}>{qrUser.name}</p>
            <p className={styles.modalLabel} style={{ fontSize: '0.82rem', color: 'var(--color-subtext)' }}>{qrUser.id}</p>
            <div className={styles.qrCenter}>
              <QRImage value={qrUser.id} size={200} />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.saveBtn} onClick={() => { window.print() }}>印刷</button>
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
          isTablet={isTablet}
        />
      )}
    </div>
  )
}

// ─── AddUserModal ─────────────────────────────────────────────────────────────

// Next free employee ID: part-timers USER001…USER099, salaried staff USER101…
// (the number after the highest one in use, so a retired person's old QR card never matches a new person)
export function nextUserId(users, employeeType) {
  const salaried = employeeType === 'salaried'
  const ids = (users || []).flatMap(u => [u.id, ...(u.formerIds || [])])
  const nums = ids.map(id => /^USER(\d+)$/i.exec(id || '')).filter(Boolean).map(m => Number(m[1]))
    .filter(n => (salaried ? n >= 101 : n >= 1 && n <= 99))
  let n = nums.length ? Math.max(...nums) + 1 : salaried ? 101 : 1
  const used = new Set(ids.map(id => String(id).toUpperCase()))
  while (used.has(`USER${String(n).padStart(3, '0')}`)) n++
  return `USER${String(n).padStart(3, '0')}`
}

function AddUserModal({ users, onClose, onAdded }) {
  const [addId, setAddId] = useState(() => nextUserId(users, 'hourly'))
  const [idEdited, setIdEdited] = useState(false)
  const [addName, setAddName] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [employeeType, setEmployeeType] = useState('hourly')
  const [workItems, setWorkItems] = useState([])
  const [itemRates, setItemRates] = useState(() => {
    const r = {}
    assignableItems().forEach(item => { r[item] = { normal: '', sunday: '', amount: '' } })
    return r
  })
  const [multipliers, setMultipliers] = useState({})
  const [commuteForm, setCommuteForm] = useState(() => commuteFormFromUser({ commuteMethods: {} }))
  const [carRates, setCarRates] = useState([])
  useEffect(() => { getCarRates().then(setCarRates).catch(() => {}) }, [])
  const [fixedStartTime, setFixedStartTime] = useState('09:00')
  const [fixedEndTime, setFixedEndTime] = useState('18:00')
  const [monthlySalary, setMonthlySalary] = useState('')
  const [overtimeRateSal, setOvertimeRateSal] = useState('')
  const [regularHoursH, setRegularHoursH] = useState('8')   // hours part
  const [regularHoursM, setRegularHoursM] = useState('0')    // minutes part
  const [standardBreakMins, setStandardBreakMins] = useState('60')
  const [saving, setSaving] = useState(false)

  function handlePinChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    setPinError('')
  }

  function toggleWorkItem(item) {
    setWorkItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
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
    assignableItems().forEach(item => {
      const r = itemRates[item] || {}
      if (item === '交通費') {
        if ((r.amount ?? '') !== '') result[item] = { amount: Number(r.amount) }
      } else {
        const entry = {}
        if ((r.normal ?? '') !== '') entry.normal = Number(r.normal)
        if ((r.sunday ?? '') !== '') entry.sunday = Number(r.sunday)
        if (multipliers[item] != null) entry.multiplier = Number(multipliers[item])
        if (Object.keys(entry).length > 0) result[item] = entry
      }
    })
    return result
  }

  async function handleAdd() {
    if (!addId.trim() || !addName.trim() || saving) return
    if (/[\/?#%\s]/.test(addId.trim())) { alert('従業員IDに、空白と / ? # % は使えません'); return }
    if (pin && !/^\d{4}$/.test(pin)) { setPinError('PINは4桁の数字'); return }
    if (employeeType !== 'salaried' && workItems.length === 0 &&
      !window.confirm('担当業務が未選択です（退勤画面に業務が出ません）。\nこのまま追加しますか？')) return
    setSaving(true)
    try {
      if (pin) {
        const existing = await resolveUserByPin(pin)
        if (existing) {
          setPinError(`このPINは${existing.name}さんが使用中です`)
          setSaving(false)
          return
        }
      }
      const newUser = {
        id: addId.trim(), name: addName.trim(), pin, employeeType,
        workItems: employeeType === 'salaried' ? [] : workItems,
        itemRates: employeeType === 'salaried' ? {} : buildItemRates(),
        ...(employeeType !== 'salaried' ? { commuteMethods: commuteMethodsFromForm(commuteForm) } : {}),
        ...(employeeType === 'salaried' ? {
          fixedStartTime, fixedEndTime,
          monthlySalary: Number(monthlySalary) || 0,
          overtimeRate: Number(overtimeRateSal) || 0,
          regularHours: (parseInt(regularHoursH) || 0) * 60 + (parseInt(regularHoursM) || 0),
          standardBreakMins: parseInt(standardBreakMins) || 0,
        } : {}),
      }
      await upsertUser(newUser, { create: true })
      onAdded(newUser)
    } catch(e) {
      alert(e?.status === 409
        ? `従業員ID「${addId.trim()}」は使用済みです。別のIDを入力してください（既存の従業員は変更なし）。`
        : '追加に失敗しました: ' + (e?.message || e))
      setSaving(false)
    }
  }

  const canSave = addId.trim() && addName.trim() && !pinError

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.userEditModal} onClick={e => e.stopPropagation()}>
        <div className={styles.userEditHeader}>
          <div>
            <div className={styles.userEditTitle}>従業員を追加</div>
            <div className={styles.userEditSubtitle}>従業員IDと氏名を入力</div>
          </div>
          <button className={styles.userEditClose} onClick={onClose} aria-label="閉じる">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className={styles.userEditBody}>
          <div className={styles.userEditSection}>
            <div className={styles.userEditSectionTitle}>基本情報</div>
            <div className={styles.userEditGrid2}>
              <div>
                <label className={styles.userEditLabel}>種別</label>
                <div className={styles.empTypeToggle}>
                  <button
                    type="button"
                    className={[styles.empTypeBtn, employeeType === 'hourly' ? styles.empTypeBtnActive : ''].join(' ')}
                    onClick={() => { setEmployeeType('hourly'); if (!idEdited) setAddId(nextUserId(users, 'hourly')) }}
                  >アルバイト・パート</button>
                  <button
                    type="button"
                    className={[styles.empTypeBtn, employeeType === 'salaried' ? styles.empTypeBtnActive : ''].join(' ')}
                    onClick={() => { setEmployeeType('salaried'); if (!idEdited) setAddId(nextUserId(users, 'salaried')) }}
                  >社員</button>
                </div>
              </div>
              <div />
              <div>
                <label className={styles.userEditLabel}>従業員ID <span className={styles.userEditRequired}>必須</span></label>
                <input
                  className={styles.userEditInput}
                  placeholder="例: USER011"
                  value={addId}
                  onChange={e => { setAddId(e.target.value); setIdEdited(true) }}
                  autoFocus
                />
                {!idEdited && <div className={styles.userEditHintText}>次の番号を自動で入れています（アルバイト・パート 001〜、社員 101〜。変更もできます）</div>}
              </div>
              <div>
                <label className={styles.userEditLabel}>氏名 <span className={styles.userEditRequired}>必須</span></label>
                <input
                  className={styles.userEditInput}
                  placeholder="例: 山田 太郎"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && canSave && handleAdd()}
                />
              </div>
              <div>
                <label className={styles.userEditLabel}>PINコード</label>
                <input
                  className={[styles.userEditInput, pinError ? styles.userEditInputErr : ''].join(' ')}
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="4桁（任意）"
                  value={pin}
                  onChange={handlePinChange}
                />
                {pinError
                  ? <div className={styles.userEditErrMsg}>{pinError}</div>
                  : <div className={styles.userEditHintText}>4桁の数字（未設定はPIN打刻不可）</div>
                }
              </div>
            </div>
          </div>

          {/* 作業項目・時給 */}
          {employeeType !== 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>業務・時給</div>
              <div className={styles.workItemTableWrap}>
                <table className={styles.workItemTable}>
                  <thead>
                    <tr>
                      <th className={styles.workItemTh} style={{width:44}}>使用</th>
                      <th className={styles.workItemTh}>業務</th>
                      <th className={styles.workItemTh} style={{width:140}}>基本時給</th>
                      <th className={styles.workItemTh} style={{width:110}}>日曜倍率</th>
                      <th className={styles.workItemTh} style={{width:120}}>日曜時給</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignableItems().filter(item => item !== '交通費').map(item => {
                      const checked = workItems.includes(item)
                      const r = itemRates[item] || {}
                      const isTransport = item === '交通費'
                      return (
                        <tr key={item} className={[styles.workItemRow, checked ? styles.workItemRowActive : ''].join(' ')}>
                          <td className={styles.workItemTd}>
                            <input
                              type="checkbox"
                              className={styles.workItemCheckbox}
                              checked={checked}
                              onChange={() => toggleWorkItem(item)}
                            />
                          </td>
                          <td className={styles.workItemTd}>
                            <span className={[styles.workItemName, !checked ? styles.workItemNameDim : ''].join(' ')}>{itemLabel(item)}</span>
                          </td>
                          {isTransport ? (
                            <>
                              <td className={styles.workItemTd}>
                                <div className={styles.workItemInputWrap}>
                                  <input
                                    className={styles.workItemInput}
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={r.amount}
                                    disabled={!checked}
                                    onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setRate(item, 'amount', e.target.value) }}
                                  />
                                  <span className={styles.workItemUnit}>円/回</span>
                                </div>
                              </td>
                              <td className={styles.workItemTd}><span className={styles.workItemDash}>—</span></td>
                              <td className={styles.workItemTd}><span className={styles.workItemDash}>—</span></td>
                            </>
                          ) : (
                            <>
                              <td className={styles.workItemTd}>
                                <div className={styles.workItemInputWrap}>
                                  <input
                                    className={styles.workItemInput}
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={r.normal}
                                    disabled={!checked}
                                    onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setRate(item, 'normal', e.target.value) }}
                                  />
                                  <span className={styles.workItemUnit}>円</span>
                                </div>
                              </td>
                              <td className={styles.workItemTd}>
                                <div className={styles.workItemInputWrap}>
                                  <input
                                    className={styles.workItemInput}
                                    type="text"
                                    inputMode="decimal"
                                    placeholder=""
                                    value={multipliers[item] || ''}
                                    disabled={!checked}
                                    onChange={e => {
                                      const v = e.target.value
                                      if (/^[\d.]{0,5}$/.test(v) && (v.match(/\./g)||[]).length <= 1) setRate(item, 'multiplier', v)
                                    }}
                                  />
                                  <span className={styles.workItemUnit}>倍</span>
                                </div>
                              </td>
                              <td className={styles.workItemTd}>
                                <span className={[styles.workItemSundayDisplay, !checked ? styles.workItemNameDim : ''].join(' ')}>
                                  {r.sunday ? `${Number(r.sunday).toLocaleString()}円` : '—'}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {employeeType !== 'salaried' && (
            <CommuteSection form={commuteForm} onChange={setCommuteForm} carRates={carRates} isTablet={false} onNumpad={() => {}} />
          )}
        </div>
        <div className={styles.userEditFooter}>
          <div />
          <div className={styles.userEditFooterBtns}>
            <button className={styles.userEditCancelBtn} onClick={onClose}>キャンセル</button>
            <button className={styles.userEditSaveBtn} onClick={handleAdd} disabled={!canSave || saving}>
              {saving ? '追加中' : '従業員を追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── NumpadOverlay ────────────────────────────────────────────────────────────

// ─── MinWageSettings (最低賃金・一括変更) ──────────────────────────────────────

// Changing the minimum wage records it with a start date (準備時間 uses the wage
// valid on each day) and raises the linked work items of everyone whose rate is
// below the new wage. Higher individual rates are never touched, and the raise
// is added to each rate history from the start date, so earlier pay is unchanged.
function MinWageSettings({ onUsersChanged }) {
  const today = getTodayJst()
  const [history, setHistory] = useState(null)
  const [items, setItems] = useState(null)
  const [itemsMsg, setItemsMsg] = useState('')
  const [wageStr, setWageStr] = useState('')
  const [from, setFrom] = useState(today)
  const [plan, setPlan] = useState(null) // { wage, from, rows, keep:Set, higher }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [loadErr, setLoadErr] = useState(false)
  useEffect(() => {
    Promise.all([getMinWageHistory(), getMinWageItems()])
      .then(([h, it]) => { setHistory(h); setItems(it) })
      .catch(() => setLoadErr(true)) // never fall back to empty settings: saving them would erase the real history
  }, [])

  async function removeEntry(e) {
    if (!window.confirm(`${fmtJaDate(e.from)}からの最低賃金 ${Number(e.wage).toLocaleString()}円 を削除します。\nこの日以降の準備時間は前の金額で計算します。\n（従業員の時給は戻りません）`)) return
    try {
      const next = history.filter(x => x.from !== e.from)
      await saveMinWageHistory(next)
      setHistory(next)
      setMsg('削除しました')
    } catch { setErr('削除に失敗しました') }
  }

  const sorted = [...(history || [])].sort((a, b) => (b.from || '').localeCompare(a.from || ''))
  const currentIdx = sorted.findIndex(e => !e.from || e.from <= today)
  const linkable = activeWorkItemDefs().map(d => d.id)

  async function toggleItem(item) {
    const next = items.includes(item) ? items.filter(i => i !== item) : [...items, item]
    setItems(next)
    try { await saveMinWageItems(next); setItemsMsg('保存しました'); setTimeout(() => setItemsMsg(''), 2000) }
    catch { setItemsMsg('保存に失敗しました') }
  }

  async function preview() {
    const wage = Number(wageStr)
    if (!(wage > 0)) { setErr('新しい最低賃金を入力'); return }
    if (!from) { setErr('適用開始日を入力'); return }
    if ((history || []).some(e => e.from === from)) { setErr(`${fmtJaDate(from)}の最低賃金はすでに登録されています`); return }
    setErr('')
    const users = await getUsers()
    const linked = items.filter(i => !isDeletedWorkItem(i)) // deleted items are not raised
    const rows = planMinWageChange(users, linked, wage, from)
    const higher = users.filter(u => u.employeeType !== 'salaried')
      .reduce((n, u) => n + linked.filter(i => (u.workItems || []).includes(i) && getRatesForDate(u.itemRates?.[i], from).normal >= wage).length, 0)
    setPlan({ wage, from, rows, keep: new Set(rows.map((_, k) => k)), higher, users })
  }

  async function apply() {
    setBusy(true)
    try {
      const chosen = plan.rows.filter((_, k) => plan.keep.has(k))
      const byUser = {}
      chosen.forEach(r => { (byUser[r.userId] = byUser[r.userId] || []).push(r) })
      for (const [userId, rs] of Object.entries(byUser)) {
        const u = plan.users.find(x => x.id === userId)
        let itemRates = u.itemRates || {}
        for (const r of rs) itemRates = withRateFrom(itemRates, r.item, plan.from, r.newNormal, r.newSunday)
        await upsertUser({ id: userId, itemRates })
      }
      const next = [...(history || []), { from: plan.from, wage: plan.wage }]
      await saveMinWageHistory(next)
      setHistory(next)
      setMsg(`${fmtJaDate(plan.from)}から最低賃金 ${plan.wage.toLocaleString()}円。時給を${chosen.length}件更新しました`)
      setPlan(null)
      setWageStr('')
      onUsersChanged?.()
    } catch (e) {
      setErr('保存できません。一部の従業員だけ更新された可能性があります。「変更内容を確認」から再度実行してください（更新済みの従業員は変わりません）。')
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { height: 44, border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '1rem', padding: '0 10px', background: '#f8fafc', color: '#1a3f6f', boxSizing: 'border-box', fontFamily: 'inherit' }
  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12 }}>
        準備時間の計算と、下で選んだ業務の時給に使います。変更すると、選んだ業務で時給が新しい最低賃金より低い人だけ、適用開始日から新しい時給になります。
      </div>
      {loadErr && <div style={{ color: '#dc2626', fontWeight: 700, marginBottom: 10 }}>設定を読み込めません。通信を確認し、再読み込みしてください（変更不可）</div>}
      {history === null ? (!loadErr && <div style={{ color: '#94a3b8' }}>読み込み中</div>) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {sorted.map((e, i) => {
            const isFuture = !!(e.from && e.from > today)
            return (
              <div key={e.from || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: i === currentIdx ? '#eff6ff' : '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.9rem' }}>
                <span style={{ minWidth: 110 }}>{e.from ? `${fmtJaDate(e.from)}〜` : '以前から'}</span>
                <strong style={{ color: '#1a3f6f' }}>{Number(e.wage).toLocaleString()}円/時</strong>
                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 700, color: isFuture ? '#b45309' : i === currentIdx ? '#1d4ed8' : '#94a3b8' }}>{isFuture ? '変更予定' : i === currentIdx ? '現在適用中' : '過去'}</span>
                {e.from && (
                  <button onClick={() => removeEntry(e)} style={{ border: '1px solid #fecaca', background: '#fff', color: '#dc2626', borderRadius: 8, padding: '4px 10px', fontWeight: 700, cursor: 'pointer' }}>削除</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ fontSize: '0.85rem', color: '#555', fontWeight: 700, marginBottom: 6 }}>最低賃金に連動する業務 {itemsMsg && <span style={{ color: '#16a34a', marginLeft: 6 }}>{itemsMsg}</span>}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {items && linkable.map(it => (
          <label key={it} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${items.includes(it) ? '#1a5fa8' : '#e2e8f0'}`, background: items.includes(it) ? '#eff6ff' : '#fff', fontSize: '0.88rem', cursor: 'pointer', minHeight: 32 }}>
            <input type="checkbox" checked={items.includes(it)} onChange={() => toggleItem(it)} style={{ width: 18, height: 18 }} />
            {itemLabel(it)}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#555', fontWeight: 700 }}>
          新しい最低賃金（円/時）
          <input type="text" inputMode="numeric" value={wageStr} placeholder="例: 1180"
            onChange={e => { if (/^\d{0,5}$/.test(e.target.value)) { setWageStr(e.target.value); setErr('') } }}
            style={{ ...inputStyle, width: 140 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#555', fontWeight: 700 }}>
          適用開始日
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setErr('') }} style={inputStyle} />
        </label>
        <button onClick={preview} disabled={!wageStr || !items}
          style={{ height: 44, padding: '0 18px', background: '#1a5fa8', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: wageStr ? 1 : 0.4 }}>
          変更内容を確認
        </button>
      </div>
      {err && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem', marginTop: 8 }}>{err}</div>}
      {msg && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.9rem', marginTop: 8 }}>✓ {msg}</div>}

      {plan && (
        <div className={styles.modalOverlay} onClick={() => !busy && setPlan(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>最低賃金の変更内容</h3>
            <p className={styles.modalLabel}>{fmtJaDate(plan.from)}から {minWageForDate(history, plan.from).toLocaleString()}円 → <strong>{plan.wage.toLocaleString()}円</strong></p>
            {plan.from < today && <p className={styles.confirmWarn}>過去の日付です。{fmtJaDate(plan.from)}以降の給与計算も新しい金額になります。</p>}
            {plan.rows.length === 0 ? (
              <p className={styles.modalLabel}>変更対象なし（連動業務の時給はすべて新しい最低賃金以上）</p>
            ) : (
              <div style={{ maxHeight: '45vh', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                {plan.rows.map((r, k) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={plan.keep.has(k)} style={{ width: 18, height: 18 }}
                      onChange={() => setPlan(p => { const keep = new Set(p.keep); keep.has(k) ? keep.delete(k) : keep.add(k); return { ...p, keep } })} />
                    <span style={{ minWidth: 90, fontWeight: 700 }}>{r.name}</span>
                    <span style={{ minWidth: 70 }}>{itemLabel(r.item)}</span>
                    <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {r.oldNormal ? `${r.oldNormal.toLocaleString()}円` : '未設定'} → <strong>{r.newNormal.toLocaleString()}円</strong>
                      {r.newSunday ? <span style={{ color: '#64748b' }}>（日曜 {r.newSunday.toLocaleString()}円）</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {plan.higher > 0 && <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>新しい最低賃金以上の時給 {plan.higher}件は変更しません。</p>}
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setPlan(null)} disabled={busy}>キャンセル</button>
              <button className={styles.saveBtn} onClick={apply} disabled={busy}>{busy ? '保存中' : '変更'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CarRateSettings (車通勤の交通費単価) ──────────────────────────────────────

// A new unit price only applies from its start date, so pay for earlier days
// (already closed months) is not recalculated.
function CarRateSettings() {
  const [rates, setRates] = useState(null)
  const [from, setFrom] = useState(getTodayJst())
  const [baseStr, setBaseStr] = useState('')
  const [carKmStr, setCarKmStr] = useState('8')
  const [bikeKmStr, setBikeKmStr] = useState('13')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const today = getTodayJst()

  const [loadErr, setLoadErr] = useState(false)
  useEffect(() => {
    getCarRates().then(list => {
      setRates(list)
      // the fuel figures rarely change: start from the latest ones
      const last = [...list].sort((a, b) => (b.from || '').localeCompare(a.from || ''))[0]
      if (last?.carKmPerL) setCarKmStr(String(last.carKmPerL))
      if (last?.bikeKmPerL) setBikeKmStr(String(last.bikeKmPerL))
    }).catch(() => setLoadErr(true))
  }, [])

  const sorted = [...(rates || [])].sort((a, b) => (b.from || '').localeCompare(a.from || ''))
  const currentIdx = sorted.findIndex(e => !e.from || e.from <= today)
  const f3 = v => (Number.isFinite(v) && v > 0 ? v.toFixed(3) : '—')
  const base = Number(baseStr), carKm = Number(carKmStr), bikeKm = Number(bikeKmStr)

  async function persist(next, okMsg) {
    try {
      await saveCarRates(next)
      setRates(next)
      setMsg(okMsg)
      setErr('')
      setTimeout(() => setMsg(''), 4000)
    } catch {
      setErr('保存できません。再度実行してください')
    }
  }

  function add() {
    if (!from) { setErr('適用開始日を入力'); return }
    if (!(base > 0)) { setErr('単価の元になる金額を入力'); return }
    if (!(carKm > 0) || !(bikeKm > 0)) { setErr('車・バイクの燃費を入力'); return }
    if ((rates || []).some(e => e.from === from)) { setErr(`${fmtJaDate(from)}の単価はすでに登録されています`); return }
    if (from < today && !window.confirm(`${fmtJaDate(from)}は過去の日付です。この日以降の出勤簿も新しい単価で計算します。`)) return
    const entry = { from, base, carKmPerL: carKm, bikeKmPerL: bikeKm, rate: base / carKm, bikeRate: base / bikeKm }
    persist([...(rates || []), entry], `${fmtJaDate(from)}から 車 ${f3(entry.rate)}円/km・バイク ${f3(entry.bikeRate)}円/km を適用します`)
    setBaseStr('')
  }

  const cell = { padding: '8px 10px', borderBottom: '1px solid #e2e8f0', fontSize: '0.88rem', textAlign: 'right', whiteSpace: 'nowrap' }
  const head = { ...cell, background: '#f1f5f9', color: '#475569', fontWeight: 700, fontSize: '0.8rem' }
  const numIn = w => ({ height: 38, width: w, border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.95rem', padding: '0 8px', textAlign: 'right', boxSizing: 'border-box', fontFamily: 'inherit' })
  const decimal = (setter, v) => { if (/^\d{0,5}(\.\d{0,3})?$/.test(v)) { setter(v); setErr('') } }
  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12 }}>単価 ＝ 金額 ÷ 燃費。1日の交通費 ＝ 通勤距離 × 単価（端数はそのまま、月の合計で四捨五入）。変更は適用開始日以降に反映。</div>
      {loadErr && <div style={{ color: '#dc2626', fontWeight: 700, marginBottom: 10 }}>設定を読み込めません。通信を確認し、再読み込みしてください（変更不可）</div>}
      {rates === null ? (!loadErr && <div style={{ color: '#94a3b8' }}>読み込み中</div>) : (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #e2e8f0' }}>
            <thead>
              <tr>
                <th style={{ ...head, textAlign: 'left' }}>適用開始日</th>
                <th style={head}>金額</th>
                <th style={head}>車</th>
                <th style={head}>バイク</th>
                <th style={{ ...head, textAlign: 'center' }}>状態</th>
                <th style={head}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && <tr><td colSpan={6} style={{ ...cell, textAlign: 'left', color: '#94a3b8' }}>まだ登録されていません</td></tr>}
              {sorted.map((e, i) => {
                const isFuture = !!(e.from && e.from > today)
                const status = isFuture ? '変更予定' : i === currentIdx ? '現在適用中' : '過去'
                return (
                  <tr key={e.from || i} style={{ background: i === currentIdx ? '#eff6ff' : '#fff' }}>
                    <td style={{ ...cell, textAlign: 'left' }}>{e.from ? `${fmtJaDate(e.from)}〜` : '最初から'}</td>
                    <td style={cell}>{e.base ? `${Number(e.base).toLocaleString()}円` : '—'}</td>
                    <td style={cell}><strong>{f3(Number(e.rate))}</strong>{e.carKmPerL ? <span style={{ color: '#94a3b8' }}>（{e.carKmPerL}）</span> : null}</td>
                    <td style={cell}><strong>{f3(Number(e.bikeRate))}</strong>{e.bikeKmPerL ? <span style={{ color: '#94a3b8' }}>（{e.bikeKmPerL}）</span> : null}</td>
                    <td style={{ ...cell, textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: isFuture ? '#b45309' : i === currentIdx ? '#1d4ed8' : '#94a3b8' }}>{status}</td>
                    <td style={cell}>
                      {e.from && (
                        <button onClick={() => { if (isFuture || window.confirm(`${fmtJaDate(e.from)}からの単価を削除します。\nこの日以降の車・バイクの交通費は前の単価で計算します。`)) persist(rates.filter(x => x.from !== e.from), '単価を削除しました') }}
                          style={{ border: 'none', background: 'none', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>削除</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#334155', marginBottom: 6 }}>新しい単価</div>
      <table style={{ borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>適用開始日</th>
            <th style={head}>金額（円）</th>
            <th style={head}>車（燃費）</th>
            <th style={head}>バイク（燃費）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cell, textAlign: 'left' }}><input type="date" value={from} onChange={e => { setFrom(e.target.value); setErr('') }} style={{ ...numIn(150), textAlign: 'left' }} /></td>
            <td style={cell}><input type="text" inputMode="decimal" value={baseStr} placeholder="例: 174" aria-label="金額" onChange={e => decimal(setBaseStr, e.target.value)} style={{ ...numIn(100), background: '#fef9c3' }} /></td>
            <td style={cell}><input type="text" inputMode="decimal" value={carKmStr} aria-label="車の燃費" onChange={e => decimal(setCarKmStr, e.target.value)} style={numIn(70)} /></td>
            <td style={cell}><input type="text" inputMode="decimal" value={bikeKmStr} aria-label="バイクの燃費" onChange={e => decimal(setBikeKmStr, e.target.value)} style={numIn(70)} /></td>
          </tr>
          <tr>
            <td style={{ ...cell, textAlign: 'left', color: '#64748b' }}>単価（円/km）</td>
            <td style={cell}></td>
            <td style={cell}><strong>{base > 0 && carKm > 0 ? f3(base / carKm) : '—'}</strong></td>
            <td style={cell}><strong>{base > 0 && bikeKm > 0 ? f3(base / bikeKm) : '—'}</strong></td>
          </tr>
        </tbody>
      </table>
      <button onClick={add} disabled={!baseStr || rates === null}
        style={{ marginTop: 10, height: 40, padding: '0 18px', background: '#1a5fa8', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: baseStr ? 1 : 0.4 }}>
        単価を追加
      </button>
      {err && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem', marginTop: 8 }}>{err}</div>}
      {msg && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.9rem', marginTop: 8 }}>{msg}</div>}
    </div>
  )
}

// ─── SettingsTab ──────────────────────────────────────────────────────────────

function SettingsTab({ users, onUsersChanged }) {
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (newPin.length !== 4) { setError('4桁のPINを入力'); return }
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

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px' }}>
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* PIN変更 */}
      <SettingsSection id="set-pin" title="管理者PIN変更" summary="管理画面に入るときのPIN">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={SETTINGS_LABEL}>新しいPIN（4桁）</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={e => { setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              autoComplete="new-password"
              style={SETTINGS_PIN_INPUT}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={SETTINGS_LABEL}>確認（もう一度）</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
              autoComplete="new-password"
              style={SETTINGS_PIN_INPUT}
            />
          </label>
          <button
            onClick={handleSave}
            disabled={newPin.length !== 4 || confirmPin.length !== 4}
            style={{ height: 40, padding: '0 20px', background: '#1a5fa8', border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.92rem', fontWeight: 700, cursor: 'pointer', opacity: (newPin.length !== 4 || confirmPin.length !== 4) ? 0.4 : 1 }}
          >
            PINを変更
          </button>
        </div>
        {error && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.88rem', marginTop: 10 }}>{error}</div>}
        {saved && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.88rem', marginTop: 10 }}>PINを変更しました（全端末に反映）</div>}
        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 10 }}>次回のPIN入力から新しいPINが有効</div>
      </SettingsSection>

      <SettingsSection id="set-items" title="業務の管理" summary="業務の追加・名前・グループ・並び順"><WorkItemSettings users={users} /></SettingsSection>

      <SettingsSection id="set-minwage" title="最低賃金" summary="準備時間の計算と、連動する業務の時給"><MinWageSettings onUsersChanged={onUsersChanged} /></SettingsSection>

      <SettingsSection id="set-car" title="交通費単価（車・バイク）" summary="金額 ÷ 燃費 ＝ 1kmあたりの単価"><CarRateSettings /></SettingsSection>
    </div>
    </div>
  )
}

// One settings block that opens when its title is clicked (closed by default; this browser remembers which were open)
function SettingsSection({ id, title, summary, children }) {
  const KEY = 'settingsOpen'
  const [open, setOpen] = useState(() => { try { return (JSON.parse(localStorage.getItem(KEY) || '[]') || []).includes(id) } catch { return false } })
  function toggle() {
    const next = !open
    setOpen(next)
    try {
      const list = new Set(JSON.parse(localStorage.getItem(KEY) || '[]') || [])
      if (next) list.add(id); else list.delete(id)
      localStorage.setItem(KEY, JSON.stringify([...list]))
    } catch {}
  }
  return (
    <section id={id} style={{ ...SETTINGS_CARD, padding: 0 }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
        <span style={{ color: '#64748b', fontSize: '0.9rem', width: 14, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1a3f6f' }}>{title}</span>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{summary}</span>
      </button>
      {open && <div style={{ padding: '0 24px 20px' }}>{children}</div>}
    </section>
  )
}

const SETTINGS_CARD = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '20px 24px' }
const SETTINGS_LABEL = { fontSize: '0.82rem', color: '#475569', fontWeight: 700 }
const SETTINGS_PIN_INPUT = { height: 40, width: 140, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: '1.1rem', textAlign: 'center', letterSpacing: '0.4em', outline: 'none', padding: '0 10px', background: '#fff', color: '#1a3f6f' }

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

// ─── PcWorkTimeInputModal (PC専用: 時間・分を直接入力) ──────────────────────────

function PcWorkTimeInputModal({ item, workTimes, workingMinutes, onSetTime, onClose }) {
  const initial = workTimes[item] || { h: 0, m: 0 }
  const hasExisting = initial.h > 0 || initial.m > 0
  const [h, setH] = useState(hasExisting ? String(initial.h) : '')
  const [m, setM] = useState(hasExisting ? String(initial.m) : '')
  const [error, setError] = useState('')
  const hourRef = useRef(null)
  const minRef = useRef(null)

  useEffect(() => { hourRef.current?.focus() }, [])

  const otherMins = Object.keys(workTimes)
    .filter(id => id !== item && workTimes[id] && (workTimes[id].h > 0 || workTimes[id].m > 0))
    .reduce((sum, id) => sum + workTimes[id].h * 60 + workTimes[id].m, 0)
  const remaining = workingMinutes != null ? workingMinutes - otherMins : null

  const hv = parseInt(h) || 0
  const mv = parseInt(m) || 0
  const totalMins = hv * 60 + mv
  const canSubmit = totalMins > 0 && (remaining == null || totalMins <= remaining)

  function toHalf(v) {
    return v.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  }

  function handleHChange(e) {
    setH(toHalf(e.target.value).replace(/\D/g, ''))
    setError('')
  }

  function handleMChange(e) {
    const raw = toHalf(e.target.value).replace(/\D/g, '')
    if (raw !== '' && parseInt(raw) > 59) { setError('分は0〜59'); return }
    setM(raw)
    setError('')
  }

  function validate() {
    if (totalMins === 0) { setError('0分は登録できません'); return false }
    if (remaining != null && totalMins > remaining) {
      setError(`残り勤務時間（${fmtMinutes(remaining)}）を超えています`)
      return false
    }
    return true
  }

  function handleConfirm() {
    if (!validate()) return
    onSetTime(item, 'h', hv)
    onSetTime(item, 'm', mv)
    onClose()
  }

  function setQuick(mins) {
    setH(String(Math.floor(mins / 60)))
    setM(String(mins % 60))
    setError('')
  }

  const quickOptions = [
    { label: '30分', mins: 30 },
    { label: '1時間', mins: 60 },
    { label: '2時間', mins: 120 },
    ...(remaining != null ? [{ label: '残りすべて', mins: remaining }] : []),
  ]

  return (
    <div className={styles.numpadOverlay} onClick={e => { e.stopPropagation(); onClose() }}>
      <div className={styles.pcWorkTimeBox} onClick={e => e.stopPropagation()}>
        <div className={styles.pcWorkTimeHeader}>
          <div className={styles.pcWorkTimeTitle}>{itemLabel(item)}</div>
          <button className={styles.modalCloseBtn} onClick={onClose} tabIndex={-1}>✕</button>
        </div>

        {remaining != null && (
          <div className={styles.pcWorkTimeRemaining}>
            残り時間：<strong>{fmtMinutes(remaining)}</strong>
          </div>
        )}

        <div className={styles.pcWorkTimeInputRow}>
          <input
            ref={hourRef}
            type="number"
            min="0"
            value={h}
            onChange={handleHChange}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); minRef.current?.focus() }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            placeholder="0"
            className={styles.pcWorkTimeNum}
          />
          <span className={styles.pcWorkTimeUnit}>時間</span>
          <input
            ref={minRef}
            type="number"
            min="0"
            max="59"
            value={m}
            onChange={handleMChange}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            placeholder="0"
            className={styles.pcWorkTimeNum}
          />
          <span className={styles.pcWorkTimeUnit}>分</span>
        </div>

        <div className={styles.pcWorkTimeError}>{error}</div>

        <div className={styles.pcWorkTimeQuick}>
          {quickOptions.map(opt => {
            const disabled = remaining != null && opt.mins > remaining
            return (
              <button
                key={opt.label}
                className={styles.pcQuickBtn}
                onClick={() => { if (!disabled) setQuick(opt.mins) }}
                disabled={disabled}
                tabIndex={-1}
              >{opt.label}</button>
            )
          })}
        </div>

        <div className={styles.pcWorkTimeActions}>
          <button className={styles.cancelBtn} onClick={onClose}>キャンセル</button>
          <button className={styles.saveBtn} onClick={handleConfirm} disabled={!canSubmit}>登録する</button>
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
        <div className={styles.numpadTitle}>{itemLabel(item)}</div>
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

// ─── CommuteSection (通勤・交通費) ────────────────────────────────────────────

// method '' = saved before commute methods existed: keeps the old daily amount
// Commute form state <-> saved settings.
// form = { on, car: { use, km }, bike: { use, km }, public: { use, amount } }
function commuteFormFromUser(user) {
  const c = commuteOn(user || {}, getTodayJst())
  const get = k => c.list.find(m => m.key === k)
  return {
    on: c.list.length > 0,
    car: { use: !!get('car'), km: get('car') ? String(get('car').km) : '' },
    bike: { use: !!get('bike'), km: get('bike') ? String(get('bike').km) : '' },
    public: { use: !!get('public'), amount: get('public') ? String(get('public').amount) : '' },
    legacyAmount: get('legacy')?.amount || 0,
  }
}
function commuteMethodsFromForm(f) {
  if (!f.on) return {}
  const out = {}
  if (f.car.use && Number(f.car.km) > 0) out.car = { km: Number(f.car.km) }
  if (f.bike.use && Number(f.bike.km) > 0) out.bike = { km: Number(f.bike.km) }
  if (f.public.use && Number(f.public.amount) > 0) out.public = { amount: Number(f.public.amount) }
  return out
}

function CommuteSection({ form, onChange, carRates, isTablet, onNumpad, changed, from, onFrom }) {
  const today = getTodayJst()
  const set = (k, patch) => onChange({ ...form, [k]: { ...form[k], ...patch } })
  const noneChecked = form.on && !form.car.use && !form.bike.use && !form.public.use
  const row = (k, label, field, unit, pattern) => {
    const v = form[k][field]
    const rate = k === 'public' ? 0 : carRateForDate(carRates || [], today, k)
    return (
      <div key={k} className={styles.commuteMethodRow}>
        <label className={styles.commuteCheck}>
          <input type="checkbox" checked={form[k].use} onChange={e => set(k, { use: e.target.checked })} />{label}
        </label>
        {form[k].use && (
          <>
            <div className={styles.workItemInputWrap}>
              {isTablet ? (
                <button className={styles.numpadTriggerSm} onClick={() => onNumpad(k)}>{v || '0'}</button>
              ) : (
                <input className={styles.workItemInput} type="text" inputMode={k === 'public' ? 'numeric' : 'decimal'} placeholder="0" value={v}
                  aria-label={`${label}の${k === 'public' ? '1日の金額' : '通勤距離'}`}
                  onChange={e => { if (pattern.test(e.target.value)) set(k, { [field]: e.target.value }) }} />
              )}
              <span className={styles.workItemUnit}>{unit}</span>
            </div>
            <span className={styles.userEditHintText} style={{ margin: 0 }}>
              {k === 'public' ? '1日の金額' : rate > 0
                ? `1日 ＝ ${Number(v) || 0}km × ${rate.toFixed(3)}円 ＝ ${((Number(v) || 0) * rate).toFixed(1)}円`
                : `${label}の単価が未設定です（「設定」の交通費単価）`}
            </span>
          </>
        )}
      </div>
    )
  }
  return (
    <div className={styles.userEditSection}>
      <div className={styles.userEditSectionTitle}>通勤・交通費</div>
      <div>
        <label className={styles.userEditLabel}>交通費</label>
        <div className={styles.commuteToggle} style={{ maxWidth: 320 }}>
          <button type="button" className={[styles.commuteBtn, form.on ? styles.commuteBtnActive : ''].join(' ')} onClick={() => onChange({ ...form, on: true })}>あり</button>
          <button type="button" className={[styles.commuteBtn, !form.on ? styles.commuteBtnActive : ''].join(' ')} onClick={() => onChange({ ...form, on: false })}>なし</button>
        </div>
        {!form.on && <div className={styles.userEditHintText}>交通費なし（退勤時の「本日の交通費」も表示しません）</div>}
      </div>
      {form.on && (
        <div>
          <label className={styles.userEditLabel}>通勤方法（複数選べます。2つ以上のときは、退勤時にその日使ったものを選びます）</label>
          {row('car', '車', 'km', 'km', /^\d{0,4}(\.\d{0,1})?$/)}
          {row('bike', 'バイク', 'km', 'km', /^\d{0,4}(\.\d{0,1})?$/)}
          {row('public', '公共交通機関', 'amount', '円/日', /^\d{0,6}$/)}
          {noneChecked && (form.legacyAmount > 0
            ? <div className={styles.userEditHintText}>以前の設定（1日 {form.legacyAmount}円）で計算中。通勤方法を選ぶと切り替わります</div>
            : <div className={styles.userEditHintText} style={{ color: '#b45309' }}>通勤方法を1つ以上選んでください</div>)}
        </div>
      )}
      {changed && onFrom && (
        <div className={styles.commuteRow}>
          <label className={styles.userEditLabel}>この変更の適用開始日</label>
          <input type="date" className={styles.userEditInput} value={from} onChange={e => onFrom(e.target.value)} />
          <div className={styles.userEditHintText}>この日より前は以前の設定で計算</div>
        </div>
      )}
    </div>
  )
}

// Commute history with one more dated entry. The first change also records the
// settings used until then (from = null), so earlier months keep them.
function commuteHistoryWith(user, entry) {
  let hist = Array.isArray(user.commuteHistory) && user.commuteHistory.length > 0
    ? [...user.commuteHistory]
    : [{
        from: null,
        methods: user.commuteMethods || undefined,
        method: user.commuteMethod || null,
        oneWayKm: Number(user.commuteOneWayKm) || 0,
        amount: Number(user.itemRates?.['交通費']?.amount) || 0,
        legacyKm: Number(user.commuteDistanceKm) || 0,
      }]
  hist = hist.filter(e => e.from !== entry.from)
  hist.push(entry)
  return hist.sort((a, b) => (a.from || '').localeCompare(b.from || ''))
}

// ─── UserEditModal ────────────────────────────────────────────────────────────

// Items that can be assigned on the user screens (deleted ones hidden) + 交通費
function assignableItems() {
  return [...activeWorkItemDefs().map(d => d.id), '交通費']
}

// Every item whose rates must survive a save: deleted items and ones not in
// the list (older data) included, so saving a user never drops a rate.
function rateItems(user) {
  return [...new Set([
    ...getWorkItemDefs().map(d => d.id),
    ...Object.keys(user?.itemRates || {}).filter(k => !SYSTEM_ITEMS.has(k)),
    '交通費',
  ])]
}

function UserEditModal({ user, isIn, onClose, onSaved, onDeleted, isTablet }) {
  const [step, setStep] = useState('main')
  // items assigned when the form opened come first; the others are folded until asked for
  const initialAssigned = useRef(new Set(user.workItems || []))
  const [showUnassigned, setShowUnassigned] = useState(() => (user.workItems || []).length === 0)
  const [name, setName] = useState(user.name)
  const [pin, setPin] = useState(user.pin || '')
  const [pinError, setPinError] = useState('')
  const [workItems, setWorkItems] = useState(user.workItems || [])
  const [rateHistory, setRateHistory] = useState(() => {
    const h = {}
    rateItems(user).forEach(item => {
      if (item === '交通費') return
      const ur = user.itemRates?.[item] || {}
      const hist = ur.rateHistory || []
      if (hist.length === 0 && ur.normal != null) {
        h[item] = [{ from: null, normal: Number(ur.normal), ...(ur.sunday != null ? { sunday: Number(ur.sunday) } : {}) }]
      } else {
        h[item] = hist
      }
    })
    return h
  })
  const [transportAmount, setTransportAmount] = useState(
    user.itemRates?.['交通費']?.amount != null ? String(user.itemRates['交通費'].amount) : ''
  )
  const [commuteForm, setCommuteForm] = useState(() => commuteFormFromUser(user))
  const initialCommute = useRef(JSON.stringify(commuteMethodsFromForm(commuteFormFromUser(user))))
  const [commuteFrom, setCommuteFrom] = useState(getTodayJst())
  // changed = what would be saved differs (a person on older settings who touches nothing keeps them)
  const commuteChanged = JSON.stringify(commuteMethodsFromForm(commuteForm)) !== initialCommute.current
    && !(commuteForm.on && commuteForm.legacyAmount > 0 && Object.keys(commuteMethodsFromForm(commuteForm)).length === 0)
  const [carRates, setCarRates] = useState([])
  useEffect(() => { getCarRates().then(setCarRates).catch(() => {}) }, [])
  const [historyModalItem, setHistoryModalItem] = useState(null)
  const [addRateForm, setAddRateForm] = useState(null) // { item, date, normalStr, multiplierStr, sundayStr }
  const [employeeType, setEmployeeType] = useState(user.employeeType || 'hourly')
  const [fixedStartTime, setFixedStartTime] = useState(user.fixedStartTime || '09:00')
  const [fixedEndTime, setFixedEndTime] = useState(user.fixedEndTime || '18:00')
  const [monthlySalary, setMonthlySalary] = useState(user.monthlySalary != null ? String(user.monthlySalary) : '')
  const [overtimeRateSal, setOvertimeRateSal] = useState(user.overtimeRate != null ? String(user.overtimeRate) : '')
  const [regularHoursH, setRegularHoursH] = useState(String(Math.floor((user.regularHours || 0) / 60)))
  const [regularHoursM, setRegularHoursM] = useState(String((user.regularHours || 0) % 60))
  const [standardBreakMins, setStandardBreakMins] = useState(user.standardBreakMins != null ? String(user.standardBreakMins) : '60')
  const [newUserId, setNewUserId] = useState(user.id)
  const [userIdError, setUserIdError] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [numpad, setNumpad] = useState(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setIsDirty(true)
  }, [name, pin, newUserId, workItems, transportAmount, commuteForm, rateHistory, employeeType, fixedStartTime, fixedEndTime, monthlySalary, overtimeRateSal, regularHoursH, regularHoursM, standardBreakMins])

  function handlePinChange(e) {
    const v = e.target.value
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\D/g, '')
      .slice(0, 4)
    setPin(v)
    setPinError('')
  }

  function toggleWorkItem(item) {
    setWorkItems(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    )
  }

  function buildItemRates() {
    const result = {}
    rateItems(user).forEach(item => {
      if (item === '交通費') {
        if (transportAmount !== '') result[item] = { amount: Number(transportAmount) }
        return
      }
      const hist = rateHistory[item] || []
      if (hist.length === 0) return
      const sorted = [...hist].sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1; return a.from.localeCompare(b.from) })
      const latest = sorted[sorted.length - 1]
      result[item] = { normal: Number(latest.normal) || 0, sunday: Number(latest.sunday) || 0, rateHistory: hist }
    })
    return result
  }

  function prevDay(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr); d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }

  function openAddRateForm(item) {
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    setAddRateForm({ item, date: dateStr, normalStr: '', showMultiplierInput: false, customMultiplierStr: '' })
  }

  function getInheritedEntry(item, selectedDate) {
    const hist = rateHistory[item] || []
    // newest first, the entry without a start date (the oldest) last
    const sorted = [...hist].sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return 1; if (!b.from) return -1; return b.from.localeCompare(a.from) })
    if (!selectedDate) return sorted[0] || null
    return sorted.find(e => !e.from || e.from < selectedDate) || null
  }

  function commitAddRate() {
    if (!addRateForm) return
    const { item, date, normalStr, showMultiplierInput, customMultiplierStr } = addRateForm
    if (!normalStr) return
    if (!date) { alert('適用開始日を入力'); return }
    const existing = rateHistory[item] || []
    if (existing.some(e => e.from === date)) {
      alert(`${fmtJaDate(date)}の時給は登録済みです。変更する場合は表の「削除」で消してから追加してください。`)
      return
    }
    if (date < getTodayJst() &&
      !window.confirm(`${fmtJaDate(date)}は過去の日付です。この日以降の出勤簿も新しい時給で計算します。`)) return
    const normalVal = Number(normalStr)
    const inherited = getInheritedEntry(item, date)
    const inheritedMult = inherited && inherited.normal && inherited.sunday
      ? Math.round(inherited.sunday / inherited.normal * 100) / 100
      : null
    const effectiveMult = showMultiplierInput && customMultiplierStr ? Number(customMultiplierStr) : inheritedMult
    const sunday = normalVal && effectiveMult ? Math.round(normalVal * effectiveMult) : undefined
    const newEntry = { from: date, normal: normalVal }
    if (sunday != null && sunday > 0) newEntry.sunday = sunday
    setRateHistory(prev => {
      const prevExisting = prev[item] || []
      const updated = [...prevExisting, newEntry].sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1; return a.from.localeCompare(b.from) })
      return { ...prev, [item]: updated }
    })
    setAddRateForm(null)
  }

  function deleteRateHistoryEntry(item, entryFrom) {
    if (!entryFrom) { alert('最初の時給は削除不可（変更は新しい時給を追加）'); return }
    const todayStr = getTodayJst()
    if (entryFrom <= todayStr &&
      !window.confirm(`${fmtJaDate(entryFrom)}からの時給を削除します。\nこの日以降の出勤簿は前の時給で計算します。\n（「変更を保存」で確定）`)) return
    setRateHistory(prev => ({ ...prev, [item]: (prev[item] || []).filter(e => e.from !== entryFrom) }))
  }

  async function handleSaveAll() {
    if (!name.trim()) return
    if (pin && !/^\d{4}$/.test(pin)) { setPinError('PINは4桁の数字'); return }
    setSaving(true)
    setPinError('')
    setUserIdError('')
    try {
      if (pin) {
        const existing = await resolveUserByPin(pin)
        if (existing && existing.id !== user.id) {
          setPinError(`このPINは${existing.name}さんが使用中です`)
          setSaving(false)
          return
        }
      }
      await upsertUser({
        id: user.id, name: name.trim(), pin, employeeType,
        // switching to 社員 keeps the hourly items and rates, so switching back loses nothing
        ...(employeeType === 'salaried' ? {} : { workItems, itemRates: buildItemRates() }),
        ...(employeeType !== 'salaried' && commuteChanged ? {
          commuteMethods: commuteMethodsFromForm(commuteForm),
          commuteHistory: commuteHistoryWith(user, { from: commuteFrom, methods: commuteMethodsFromForm(commuteForm) }),
        } : {}),
        ...(employeeType === 'salaried' ? {
          fixedStartTime, fixedEndTime,
          monthlySalary: Number(monthlySalary) || 0,
          overtimeRate: Number(overtimeRateSal) || 0,
          regularHours: (parseInt(regularHoursH) || 0) * 60 + (parseInt(regularHoursM) || 0),
          standardBreakMins: parseInt(standardBreakMins) || 0,
        } : {}),
      })
      setIsDirty(false)
      onSaved()
    } catch(e) {
      alert('保存に失敗しました: ' + (e?.message || e))
      setSaving(false)
    }
  }

  async function handleConfirmStatus() {
    if (isIn) {
      const ps = await getTodayPunchState(user.id)
      if (ps.state === 'break') await saveLog({ userId: user.id, logType: BREAK_END, sessionId: ps.sessionId })
      await saveLog({ userId: user.id, workType: '', logType: '退勤', sessionId: ps.sessionId })
    } else {
      await saveLog({ userId: user.id, workType: '', logType: '出勤' })
    }
    onSaved()
  }

  async function handleConfirmDelete() {
    await deleteUser(user.id)
    onDeleted()
  }

  const XIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )

  if (step === 'confirmDelete') return (
    <div className={styles.modalOverlay} onClick={() => setStep('main')}>
      <div className={styles.userEditModal} onClick={e => e.stopPropagation()} style={{maxWidth: 480}}>
        <div className={styles.userEditHeader}>
          <div>
            <div className={styles.userEditTitle}>従業員削除の確認</div>
            <div className={styles.userEditSubtitle}>{user.name}（{user.id}）</div>
          </div>
          <button className={styles.userEditClose} onClick={() => setStep('main')} aria-label="閉じる"><XIcon /></button>
        </div>
        <div className={styles.userEditBody}>
          <p className={styles.confirmWarn}>
            この従業員と全ての打刻記録を完全に削除します。<br />元に戻せません。
          </p>
        </div>
        <div className={styles.userEditFooter}>
          <div />
          <div className={styles.userEditFooterBtns}>
            <button className={styles.userEditCancelBtn} onClick={() => setStep('main')}>戻る</button>
            <button className={styles.realDeleteBtn} onClick={handleConfirmDelete}>削除する</button>
          </div>
        </div>
      </div>
    </div>
  )

  if (step === 'confirmStatus') return (
    <div className={styles.modalOverlay} onClick={() => setStep('main')}>
      <div className={styles.userEditModal} onClick={e => e.stopPropagation()} style={{maxWidth: 480}}>
        <div className={styles.userEditHeader}>
          <div>
            <div className={styles.userEditTitle}>状態変更の確認</div>
            <div className={styles.userEditSubtitle}>{user.name}</div>
          </div>
          <button className={styles.userEditClose} onClick={() => setStep('main')} aria-label="閉じる"><XIcon /></button>
        </div>
        <div className={styles.userEditBody}>
          <p className={styles.confirmMsg}>
            <span className={styles.oldTime}>{isIn ? '出勤中' : '未出勤'}</span>
            {' → '}
            <span className={styles.newTime}>{isIn ? '未出勤' : '出勤中'}</span>
            {' に変更します'}
          </p>
          <p className={styles.confirmWarn}>元に戻せません</p>
        </div>
        <div className={styles.userEditFooter}>
          <div />
          <div className={styles.userEditFooterBtns}>
            <button className={styles.userEditCancelBtn} onClick={() => setStep('main')}>戻る</button>
            <button className={styles.userEditSaveBtn} onClick={handleConfirmStatus}>確定する</button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.userEditModal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.userEditHeader}>
          <div>
            <div className={styles.userEditTitle}>{user.name} の編集</div>
            <div className={styles.userEditSubtitle}>ID: {user.id}</div>
          </div>
          <button className={styles.userEditClose} onClick={onClose} aria-label="閉じる"><XIcon /></button>
        </div>

        {/* Body */}
        <div className={styles.userEditBody}>

          {/* 基本情報 */}
          <div className={styles.userEditSection}>
            <div className={styles.userEditSectionTitle}>基本情報</div>
            <div className={styles.userEditGrid2}>
              <div>
                <label className={styles.userEditLabel}>種別</label>
                <div className={styles.empTypeToggle}>
                  <button
                    type="button"
                    className={[styles.empTypeBtn, employeeType === 'hourly' ? styles.empTypeBtnActive : ''].join(' ')}
                    onClick={() => setEmployeeType('hourly')}
                  >アルバイト・パート</button>
                  <button
                    type="button"
                    className={[styles.empTypeBtn, employeeType === 'salaried' ? styles.empTypeBtnActive : ''].join(' ')}
                    onClick={() => setEmployeeType('salaried')}
                  >社員</button>
                </div>
              </div>
              <div>
                <label className={styles.userEditLabel}>氏名 <span className={styles.userEditRequired}>必須</span></label>
                <input
                  className={[styles.userEditInput, !name.trim() ? styles.userEditInputErr : ''].join(' ')}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && isDirty && !saving && handleSaveAll()}
                />
              </div>
              <div>
                <label className={styles.userEditLabel}>従業員ID <span className={styles.userEditRequired}>必須</span></label>
                <input
                  className={styles.userEditInput}
                  value={newUserId}
                  readOnly
                  style={{ background: '#f1f5f9', color: '#64748b' }}
                />
                <div className={styles.userEditHintText}>IDは変更不可（QR・打刻記録と紐づくため）</div>
                {(user.formerIds || []).length > 0 && <div className={styles.userEditHintText}>以前のID：{user.formerIds.join('、')}（古いQRカードもそのまま使えます）</div>}
              </div>
              <div>
                <label className={styles.userEditLabel}>PINコード</label>
                {isTablet ? (
                  <button
                    className={[styles.numpadTrigger, pinError ? styles.userEditInputErr : ''].join(' ')}
                    onClick={() => setNumpad({ title: 'PINコード', field: 'pin', maxLength: 4, pinMode: true })}
                    style={{width:'100%', textAlign:'center'}}
                  >
                    {pin || <span className={styles.numpadTriggerPlaceholder}>未設定</span>}
                  </button>
                ) : (
                  <input
                    className={[styles.userEditInput, pinError ? styles.userEditInputErr : ''].join(' ')}
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4桁（未設定も可）"
                    value={pin}
                    onChange={handlePinChange}
                  />
                )}
                {pinError
                  ? <div className={styles.userEditErrMsg}>{pinError}</div>
                  : <div className={styles.userEditHintText}>4桁の数字（未設定はPIN打刻不可）</div>
                }
              </div>
            </div>
          </div>

          {/* 作業項目・時給 */}
          {employeeType !== 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>業務・時給</div>
              <div className={styles.workItemTableWrap}>
                <table className={styles.workItemTable}>
                  <thead>
                    <tr>
                      <th className={styles.workItemTh} style={{width:44}}>使用</th>
                      <th className={styles.workItemTh}>業務</th>
                      <th className={styles.workItemTh} style={{width:170}}>基本時給（現在）</th>
                      <th className={styles.workItemTh} style={{width:110}}>日曜時給</th>
                      <th className={styles.workItemTh} style={{width:120}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const all = assignableItems().filter(item => item !== '交通費')
                      const first = all.filter(i => initialAssigned.current.has(i)), rest = all.filter(i => !initialAssigned.current.has(i))
                      return [...first, ...(showUnassigned ? rest : [])]
                    })().map(item => {
                      const checked = workItems.includes(item)
                      const isTransport = item === '交通費'
                      const hist = rateHistory[item] || []
                      const todayStr = getTodayJst()
                      const sortedHistAsc = [...hist].sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1; return a.from.localeCompare(b.from) })
                      const currentEntry = sortedHistAsc.filter(e => !e.from || e.from <= todayStr).pop() || null
                      const nextEntry = sortedHistAsc.find(e => e.from && e.from > todayStr) || null
                      return (
                        <tr key={item} className={[styles.workItemRow, checked ? styles.workItemRowActive : ''].join(' ')}>
                          <td className={styles.workItemTd}>
                            <input type="checkbox" className={styles.workItemCheckbox} checked={checked} onChange={() => toggleWorkItem(item)} />
                          </td>
                          <td className={styles.workItemTd}>
                            <span className={[styles.workItemName, !checked ? styles.workItemNameDim : ''].join(' ')}>{itemLabel(item)}</span>
                          </td>
                          {isTransport ? (
                            <>
                              <td className={styles.workItemTd}><span className={styles.workItemDash}>—</span></td>
                              <td className={styles.workItemTd}>
                                <div className={styles.workItemInputWrap}>
                                  {isTablet ? (
                                    <button
                                      className={styles.numpadTriggerSm}
                                      disabled={!checked}
                                      onClick={() => checked && setNumpad({ title: '交通費（円/回）', field: 'amount', maxLength: 6 })}
                                    >{transportAmount || '0'}</button>
                                  ) : (
                                    <input
                                      className={styles.workItemInput}
                                      type="text"
                                      inputMode="numeric"
                                      placeholder="0"
                                      value={transportAmount}
                                      disabled={!checked}
                                      onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setTransportAmount(e.target.value) }}
                                    />
                                  )}
                                  <span className={styles.workItemUnit}>円/回</span>
                                </div>
                              </td>
                              <td className={styles.workItemTd}><span className={styles.workItemDash}>—</span></td>
                              <td className={styles.workItemTd}></td>
                            </>
                          ) : (
                            <>
                              <td className={styles.workItemTd}>
                                <div>
                                  <span className={[styles.workItemRateDisplay, !checked ? styles.workItemNameDim : ''].join(' ')}>
                                    {currentEntry?.normal ? `${Number(currentEntry.normal).toLocaleString()}円` : '未設定'}
                                  </span>
                                  {nextEntry && currentEntry?.normal && checked && (
                                    <div className={styles.rateChangePending}>
                                      {fmtJaDateShort(nextEntry.from)}から{Number(nextEntry.normal).toLocaleString()}円に変更予定
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className={styles.workItemTd}>
                                <span className={[styles.workItemRateDisplay, !checked ? styles.workItemNameDim : ''].join(' ')}>
                                  {currentEntry?.sunday ? `${Number(currentEntry.sunday).toLocaleString()}円` : '—'}
                                </span>
                              </td>
                              <td className={styles.workItemTd}>
                                <button
                                  className={styles.rateHistoryBtn}
                                  disabled={!checked}
                                  onClick={() => { if (checked) { setHistoryModalItem(item); setAddRateForm(null) } }}
                                >
                                  履歴・変更
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                    {!showUnassigned && assignableItems().filter(i => i !== '交通費' && !initialAssigned.current.has(i)).length > 0 && (
                      <tr>
                        <td colSpan={5} className={styles.workItemTd}>
                          <button type="button" className={styles.dayEditAddWorkBtn} onClick={() => setShowUnassigned(true)}>
                            担当していない業務を表示（{assignableItems().filter(i => i !== '交通費' && !initialAssigned.current.has(i)).length}件）
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {employeeType !== 'salaried' && (
            <CommuteSection
              form={commuteForm} onChange={setCommuteForm}
              carRates={carRates} isTablet={isTablet}
              changed={commuteChanged} from={commuteFrom} onFrom={setCommuteFrom}
              onNumpad={field => setNumpad(field === 'public'
                ? { title: '公共交通機関・1日の金額（円）', field: 'public', maxLength: 6 }
                : { title: `${field === 'bike' ? 'バイク' : '車'}の通勤距離（km）`, field, maxLength: 6, decimal: true })}
            />
          )}

          {/* 時給履歴モーダル */}
          {historyModalItem && (
            <div className={styles.modalOverlay} onClick={() => { setHistoryModalItem(null); setAddRateForm(null) }}>
              <div className={styles.rateHistoryModal} onClick={e => e.stopPropagation()}>
                <div className={styles.rateHistoryModalHeader}>
                  <div className={styles.rateHistoryModalTitle}>{itemLabel(historyModalItem)} の時給履歴</div>
                  <button className={styles.modalCloseBtn} onClick={() => { setHistoryModalItem(null); setAddRateForm(null) }}>✕</button>
                </div>
                <div className={styles.rateHistoryModalBody}>
                  {(() => {
                    const hist = rateHistory[historyModalItem] || []
                    // Descending order: newest first, null (oldest, no known start) last
                    const sorted = [...hist].sort((a, b) => {
                      if (!a.from && !b.from) return 0
                      if (!a.from) return 1
                      if (!b.from) return -1
                      return b.from.localeCompare(a.from)
                    })
                    if (sorted.length === 0) return <p className={styles.rateHistoryEmpty}>時給が未登録です。「新しい時給を追加」から登録</p>
                    const todayStr = getTodayJst()
                    // Current: first in descending order where from <= today, or from is null
                    const currentIdx = sorted.findIndex(e => !e.from || e.from <= todayStr)
                    return (
                      <div className={styles.rateHistoryTableWrap}>
                        <table className={styles.rateHistoryTable}>
                          <thead>
                            <tr>
                              <th className={styles.rateHistoryTh}>適用開始日</th>
                              <th className={styles.rateHistoryTh}>適用終了日</th>
                              <th className={styles.rateHistoryTh}>基本時給</th>
                              <th className={styles.rateHistoryTh}>日曜倍率</th>
                              <th className={styles.rateHistoryTh}>日曜時給</th>
                              <th className={styles.rateHistoryTh}>状態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((entry, idx) => {
                              // End date = day before the newer entry's from (sorted[idx-1] is newer in descending order)
                              const toDateStr2 = idx === 0 ? null : prevDay(sorted[idx - 1].from)
                              const toDisplay = toDateStr2 ? fmtJaDate(toDateStr2) : '—'
                              const fromDisplay = entry.from ? fmtJaDate(entry.from) : '—'
                              const mult = entry.normal && entry.sunday
                                ? `${Math.round(entry.sunday / entry.normal * 100) / 100}倍`
                                : '—'
                              const isFuture = !!(entry.from && entry.from > todayStr)
                              const isCurrent = idx === currentIdx
                              const status = isFuture ? '変更予定' : isCurrent ? '現在適用中' : '過去'
                              return (
                                <tr key={idx} className={[styles.rateHistoryTr, isCurrent ? styles.rateHistoryCurrentRow : '', isFuture ? styles.rateHistoryFutureRow : ''].join(' ')}>
                                  <td className={styles.rateHistoryTd}>{fromDisplay}</td>
                                  <td className={styles.rateHistoryTd}>{toDisplay}</td>
                                  <td className={styles.rateHistoryTd}>{entry.normal ? `${Number(entry.normal).toLocaleString()}円` : '—'}</td>
                                  <td className={styles.rateHistoryTd}>{mult}</td>
                                  <td className={styles.rateHistoryTd}>{entry.sunday ? `${Number(entry.sunday).toLocaleString()}円` : '—'}</td>
                                  <td className={styles.rateHistoryTd}>
                                    {!isFuture && <span className={isCurrent ? styles.rateHistoryCurrentBadge : styles.rateHistoryPastBadge}>{status}</span>}
                                    {entry.from && <button className={styles.rateHistoryDelBtn} onClick={() => deleteRateHistoryEntry(historyModalItem, entry.from)}>削除</button>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  {addRateForm ? (
                    <div className={styles.addRateFormPanel}>
                      <div className={styles.addRateFormTitle}>新しい時給を追加</div>
                      {(() => {
                        const inherited = getInheritedEntry(addRateForm.item, addRateForm.date)
                        const hasSunday = !!(inherited && inherited.sunday)
                        const inheritedMult = hasSunday
                          ? Math.round(inherited.sunday / inherited.normal * 100) / 100
                          : null
                        const effectiveMult = addRateForm.showMultiplierInput && addRateForm.customMultiplierStr
                          ? Number(addRateForm.customMultiplierStr)
                          : inheritedMult
                        const newNormal = addRateForm.normalStr ? Number(addRateForm.normalStr) : null
                        const computedSunday = newNormal && effectiveMult ? Math.round(newNormal * effectiveMult) : null
                        const prevNormal = inherited?.normal || null
                        const previewDateStr = fmtJaDateShort(addRateForm.date)
                        return (
                          <>
                            <div className={styles.addRateFormGrid}>
                              <div>
                                <label className={styles.formLabel}>適用開始日</label>
                                <input
                                  type="date"
                                  className={styles.dateInput}
                                  value={addRateForm.date}
                                  onChange={e => setAddRateForm(f => ({ ...f, date: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label className={styles.formLabel}>新しい基本時給（円）</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className={styles.dateInput}
                                  placeholder="例: 1600"
                                  value={addRateForm.normalStr}
                                  onChange={e => setAddRateForm(f => ({ ...f, normalStr: e.target.value.replace(/[^\d]/g, '') }))}
                                />
                              </div>
                            </div>
                            <div className={styles.addRateSundayInfo}>
                              {hasSunday ? (
                                <>
                                  <div className={styles.addRateInfoRow}>
                                    <span className={styles.addRateInfoLabel}>日曜倍率</span>
                                    {addRateForm.showMultiplierInput ? (
                                      <>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          className={styles.addRateMultInput}
                                          placeholder=""
                                          value={addRateForm.customMultiplierStr}
                                          onChange={e => {
                                            const v = e.target.value
                                            if (!/^[\d.]{0,5}$/.test(v) || (v.match(/\./g)||[]).length > 1) return
                                            setAddRateForm(f => ({ ...f, customMultiplierStr: v }))
                                          }}
                                        />
                                        <button className={styles.addRateCancelMult} onClick={() => setAddRateForm(f => ({ ...f, showMultiplierInput: false, customMultiplierStr: '' }))}>引き継ぎに戻す</button>
                                      </>
                                    ) : (
                                      <>
                                        <span className={styles.addRateInfoValue}>{inheritedMult}倍（現在の設定を引き継ぎます）</span>
                                        <button className={styles.addRateChangeMult} onClick={() => setAddRateForm(f => ({ ...f, showMultiplierInput: true, customMultiplierStr: String(inheritedMult ?? '') }))}>日曜倍率も変更する</button>
                                      </>
                                    )}
                                  </div>
                                  <div className={styles.addRateInfoRow}>
                                    <span className={styles.addRateInfoLabel}>日曜時給</span>
                                    <span className={styles.addRateInfoValue}>{computedSunday ? `${computedSunday.toLocaleString()}円（自動計算）` : '—'}</span>
                                  </div>
                                </>
                              ) : (
                                <span className={styles.addRateNoSunday}>日曜設定なし</span>
                              )}
                            </div>
                            {newNormal && (
                              <div className={styles.addRatePreview}>
                                {previewDateStr}から{prevNormal ? ` ${prevNormal.toLocaleString()}円 → ` : ' '}{newNormal.toLocaleString()}円
                                {computedSunday ? `（日曜：${computedSunday.toLocaleString()}円）` : ''}
                              </div>
                            )}
                            <div className={styles.addRateFormActions}>
                              <button className={styles.cancelBtn} onClick={() => setAddRateForm(null)}>キャンセル</button>
                              <button className={styles.saveBtn} onClick={commitAddRate} disabled={!addRateForm.normalStr}>時給を変更</button>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <button className={styles.addRateHistoryBtn} onClick={() => openAddRateForm(historyModalItem)}>
                      ＋ 新しい時給を追加
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}


          {/* 本日の出勤状態 */}
          <div className={styles.userEditSection}>
            <div className={styles.userEditSectionTitle}>本日の出勤状態</div>
            <div className={styles.userEditStatusRow}>
              <span className={[styles.statusBadge, isIn ? styles.statusIn : styles.statusOut].join(' ')}>
                {isIn ? '出勤中' : '未出勤'}
              </span>
              <button className={styles.userEditStatusChangeBtn} onClick={() => setStep('confirmStatus')}>
                {isIn ? '退勤にする' : '出勤中にする'}
              </button>
            </div>
          </div>

          {/* その他の操作 */}
          <div className={styles.userEditDangerSection}>
            <button className={styles.userEditDangerToggle} onClick={() => setDangerOpen(o => !o)}>
              <svg
                className={[styles.userEditDangerChevron, dangerOpen ? styles.userEditDangerChevronOpen : ''].join(' ')}
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              その他の操作
            </button>
            {dangerOpen && (
              <div className={styles.userEditDangerBody}>
                <button className={styles.deleteTriggerBtn} onClick={() => setStep('confirmDelete')}>
                  この従業員を削除する
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className={styles.userEditFooter}>
          <div className={styles.userEditDirtyMsg}>
            {isDirty ? '未保存の変更があります' : ''}
          </div>
          <div className={styles.userEditFooterBtns}>
            <button className={styles.userEditCancelBtn} onClick={onClose}>キャンセル</button>
            <button
              className={styles.userEditSaveBtn}
              onClick={handleSaveAll}
              disabled={!name.trim() || saving || !isDirty}
            >
              {saving ? '保存中' : '変更を保存'}
            </button>
          </div>
        </div>
      </div>
      {isTablet && numpad && (
        <NumpadOverlay
          title={numpad.title}
          initialValue={numpad.field === 'pin' ? '' : numpad.field === 'car' || numpad.field === 'bike' ? commuteForm[numpad.field].km : numpad.field === 'public' ? commuteForm.public.amount : transportAmount}
          maxLength={numpad.maxLength}
          decimal={!!numpad.decimal}
          pinMode={!!numpad.pinMode}
          onConfirm={val => {
            if (numpad.field === 'pin') { setPin(val); setPinError('') }
            else if (numpad.field === 'car' || numpad.field === 'bike') setCommuteForm(f => ({ ...f, [numpad.field]: { ...f[numpad.field], km: val } }))
            else if (numpad.field === 'public') setCommuteForm(f => ({ ...f, public: { ...f.public, amount: val } }))
            else setTransportAmount(val)
          }}
          onClose={() => setNumpad(null)}
        />
      )}
    </div>
  )
}
