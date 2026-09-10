import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import QRCode from 'qrcode'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  getLogs, getUsers, exportKinmubo, deleteLog, upsertUser, deleteUser,
  updateLogTime, saveLog, saveLogManual, getTodayStatuses, getClockInTimeForDate,
  resolveUserByPin, PAY_ITEMS, saveAdminPin, getMinWage, saveMinWage, DEFAULT_MIN_WAGE,
  getWorkItems, getRatesForDate, saveOvertimeApp, getOvertimeApp, saveSalariedDay, getSalariedDaysForMonth,
  saveWorkReport, getWorkReport, migrateSessionWorkToReports, getWorkReportsForRange
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
    label: 'ユーザー管理',
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
        {tab === 'settings' && <SettingsTab />}
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
  while (days.length % 7 !== 0) days.push(null) // 末尾を7の倍数に揃える
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
  // Build ordered session pairs per day
  Object.values(map).forEach(entry => {
    const sortedIns = [...entry.ins].sort()
    const sortedOuts = [...entry.outs].sort()
    const n = Math.max(sortedIns.length, sortedOuts.length)
    entry.sessions = Array.from({ length: n }, (_, i) => ({
      in: sortedIns[i] ? sortedIns[i].substring(0, 5) : '',
      out: sortedOuts[i] ? sortedOuts[i].substring(0, 5) : '',
    }))
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
  const weekCount = days.length / 7
  const dayMap = buildDayMap(logs, year, month)
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
          <div className={styles.calMonthGroup}>
            <button className={styles.navBtn} onClick={prevMonth}>◀</button>
            <span className={styles.navDate}>{year}年{month + 1}月</span>
            <button className={styles.navBtn} onClick={nextMonth} disabled={isCurrentMonth}>▶</button>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}>読込中...</div>
        ) : (
          <div className={styles.calGrid} style={{ gridTemplateRows: `auto repeat(${weekCount}, clamp(82px, 10vh, 115px))` }}>
            {CAL_DAY_LABELS.map((d, i) => (
              <div key={d} className={[styles.calDayLabel, i === 0 ? styles.calSun : i === 6 ? styles.calSat : ''].join(' ')}>{d}</div>
            ))}
            {days.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} className={styles.calEmpty} />
              const entry = dayMap[d]
              const sessions = entry?.sessions || []
              const inTime = sessions[0]?.in || ''
              const worked = !!inTime
              const needsAlert = worked && sessions.some(s => s.out) && !entry?.hasWorkItems
              const multiSession = sessions.length > 1
              const dow = new Date(year, month, d).getDay()
              const isToday = d === todayDay && year === todayYear && month === todayMonth
              const MAX_SHOW = sessions.length <= 3 ? sessions.length : 2
              const extraCount = sessions.length > 3 ? sessions.length - 2 : 0
              return (
                <div
                  key={d}
                  className={[styles.calCell, needsAlert ? styles.calAlert : worked ? styles.calWorked : '', dow === 0 ? styles.calSunCell : dow === 6 ? styles.calSatCell : '', isToday ? styles.calTodayCell : ''].join(' ')}
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
                          <span className={styles.calSessionNum}>{idx + 1}回目</span>
                          <span className={styles.calSessionIn}>{s.in}</span>
                          <span className={styles.calSessionArrow}>→</span>
                          {s.out
                            ? <span className={styles.calSessionOut}>{s.out}</span>
                            : <span className={styles.calSessionActive}>勤務中</span>
                          }
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <button
                          className={styles.calMoreBtn}
                          onClick={e => { e.stopPropagation(); setSelectedDay(d) }}
                        >
                          ほか{extraCount}件
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {inTime && <div className={styles.calIn}>出勤 {inTime}</div>}
                      {sessions[0]?.out
                        ? <div className={styles.calOut}>退勤 {sessions[0].out}</div>
                        : inTime && <div className={styles.calActive}>勤務中</div>
                      }
                    </>
                  )}
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

  function initSessions() {
    const sorted = [...dayLogs].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    const result = []
    let pendingIn = null
    for (const log of sorted) {
      if (log.log_type === '出勤') {
        pendingIn = log
      } else if (log.log_type === '退勤') {
        const inHM = initHM(pendingIn?.time?.substring(0, 5))
        const outHM = initHM(log.time?.substring(0, 5))
        result.push({ inH: inHM.h, inM: inHM.m, outH: outHM.h, outM: outHM.m,
          origInTime: pendingIn?.time?.substring(0, 5) || '',
          origOutTime: log.time?.substring(0, 5) || '' })
        pendingIn = null
      }
    }
    if (pendingIn) {
      const inHM = initHM(pendingIn.time?.substring(0, 5))
      result.push({ inH: inHM.h, inM: inHM.m, outH: '', outM: '',
        origInTime: pendingIn.time?.substring(0, 5) || '', origOutTime: '' })
    }
    // No auto-empty session — start empty if no logs
    return result
  }

  // workRows: [{ type, h, m }] — type='' means not yet selected
  const [sessions, setSessions] = useState(() => initSessions())
  const [workRows, setWorkRows] = useState([])
  const [workItemsLoaded, setWorkItemsLoaded] = useState(false)
  const [step, setStep] = useState('form')
  const [saving, setSaving] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])
  const [editingTimeField, setEditingTimeField] = useState(null)

  const lastWorkSelectRef = useRef(null)
  const prevWorkRowCount = useRef(0)

  useEffect(() => {
    if (workRows.length > prevWorkRowCount.current && lastWorkSelectRef.current) {
      lastWorkSelectRef.current.focus()
    }
    prevWorkRowCount.current = workRows.length
  }, [workRows.length])

  useEffect(() => {
    if (isSalaried) { setWorkItemsLoaded(true); return }
    getWorkReport(user.id, dateStr).then(items => {
      const rows = Object.entries(items)
        .filter(([, mins]) => mins > 0)
        .map(([type, mins]) => ({ type, h: Math.floor(mins / 60), m: mins % 60 }))
      // Default to one empty row if no saved data (empty rows are filtered on save)
      setWorkRows(rows.length > 0 ? rows : [{ type: '', h: 0, m: 0 }])
      setWorkItemsLoaded(true)
    })
  }, [user.id, dateStr, isSalaried])

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

  function updateSession(si, field, val) {
    setSessions(prev => prev.map((s, i) => i === si ? { ...s, [field]: val } : s))
  }

  function addSession() {
    setSessions(prev => [...prev, { inH: '', inM: '', outH: '', outM: '', origInTime: '', origOutTime: '' }])
  }

  function removeSession(si) {
    setSessions(prev => prev.filter((_, i) => i !== si))
  }

  function updateWorkRow(ri, field, val) {
    setWorkRows(prev => prev.map((r, i) => i === ri ? { ...r, [field]: val } : r))
  }

  function addWorkRow() {
    setWorkRows(prev => [...prev, { type: '', h: 0, m: 0 }])
  }

  function removeWorkRow(ri) {
    setWorkRows(prev => prev.filter((_, i) => i !== ri))
  }

  const sessionTimes = sessions.map(s => ({
    inTime: hmToTimeStr(s.inH, s.inM),
    outTime: hmToTimeStr(s.outH, s.outM),
  }))

  const totalWorkMins = workRows.reduce((sum, r) => {
    return sum + (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
  }, 0)

  const selectedTypes = new Set(workRows.map(r => r.type).filter(Boolean))
  const hasMoreWorkTypes = userWorkItems.some(t => !selectedTypes.has(t))

  // Punch completion status
  const sessionStatuses = sessions.map((s, si) => {
    const allEmpty = s.inH === '' && s.inM === '' && s.outH === '' && s.outM === ''
    if (allEmpty) return 'empty'
    const { inTime, outTime } = sessionTimes[si]
    if (inTime && outTime) return 'complete'
    return 'incomplete'
  })
  const nonEmptySessions = sessionStatuses.filter(st => st !== 'empty')
  const completedSessionCount = sessionStatuses.filter(st => st === 'complete').length
  const inProgressCount = sessionStatuses.filter(st => st === 'incomplete').length
  let punchStatus
  if (nonEmptySessions.length === 0) punchStatus = 'empty'
  else if (inProgressCount > 0) {
    punchStatus = completedSessionCount === 0 ? 'incomplete_only' : 'partial_incomplete'
  } else punchStatus = 'allComplete'
  // workEnabled: at least one session has a valid check-in time
  const hasAnyCheckIn = sessions.some((s, si) => sessionTimes[si].inTime !== '')
  const workEnabled = hasAnyCheckIn
  const workHasData = workRows.some(r => r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0))
  // Summary bar message above both columns
  let punchSummaryBar = null
  if (!isSalaried && nonEmptySessions.length > 0) {
    if (punchStatus === 'allComplete') {
      punchSummaryBar = `QR打刻 ${nonEmptySessions.length}回（すべて完了）→ この日分の業務時間を入力`
    } else if (punchStatus === 'incomplete_only') {
      punchSummaryBar = `QR打刻 ${nonEmptySessions.length}回・勤務中 → この日分の業務時間は途中でも入力できます`
    } else {
      punchSummaryBar = `QR打刻 ${nonEmptySessions.length}回（完了${completedSessionCount}回・勤務中${inProgressCount}回）→ この日分の業務時間を入力`
    }
  }
  // Context note inside work column
  let punchContextMsg = null
  if (nonEmptySessions.length > 1) {
    punchContextMsg = `この日のQR打刻${nonEmptySessions.length}回分の業務時間をまとめて入力します`
  } else if (inProgressCount > 0 && completedSessionCount === 0) {
    punchContextMsg = '現在勤務中の打刻があります。業務時間は途中でも入力できます'
  }

  function fmtWorkTotal(mins) {
    const h = Math.floor(mins / 60), m = mins % 60
    return `${h}時間${String(m).padStart(2, '0')}分`
  }

  function validate() {
    const errs = []
    for (let si = 0; si < sessions.length; si++) {
      const s = sessions[si]
      const pfx = sessions.length > 1 ? `${si + 1}回目：` : ''
      if (s.inH !== '' && (isNaN(parseInt(s.inH)) || parseInt(s.inH) > 23)) errs.push(`${pfx}出勤「時」が不正です（0〜23）`)
      if (s.inM !== '' && parseInt(s.inM) > 59) errs.push(`${pfx}出勤「分」は0〜59で入力してください`)
      if (s.outH !== '' && (isNaN(parseInt(s.outH)) || parseInt(s.outH) > 23)) errs.push(`${pfx}退勤「時」が不正です（0〜23）`)
      if (s.outM !== '' && parseInt(s.outM) > 59) errs.push(`${pfx}退勤「分」は0〜59で入力してください`)
      // New session: only-out without in is an error
      const isNew = !s.origInTime && !s.origOutTime
      const inT = hmToTimeStr(s.inH, s.inM), outT = hmToTimeStr(s.outH, s.outM)
      if (isNew && !inT && outT) errs.push(`${pfx}出勤時刻を入力してください`)
    }
    const typesSeen = new Set()
    for (let ri = 0; ri < workRows.length; ri++) {
      const r = workRows[ri]
      const pfx = `業務${ri + 1}行目：`
      if (r.h !== '' && r.h !== 0 && isNaN(parseInt(r.h))) errs.push(`${pfx}時間に数値を入力してください`)
      const mv = parseInt(r.m)
      if (r.m !== '' && r.m !== 0 && (!isNaN(mv)) && (mv < 0 || mv > 59)) errs.push(`${pfx}分は0〜59で入力してください`)
      if (!r.type && ((parseInt(r.h) || 0) > 0 || (parseInt(r.m) || 0) > 0)) errs.push(`${pfx}業務種別を選択してください`)
      if (r.type) {
        if (typesSeen.has(r.type)) errs.push(`「${r.type}」が複数行に登録されています`)
        typesSeen.add(r.type)
      }
    }
    return errs
  }

  function handleTryConfirm() {
    const errs = validate()
    if (errs.length > 0) { setValidationErrors(errs); return }
    setValidationErrors([])
    // Warn if all sessions cleared but work data remains
    const allSessionsCleared = sessions.length === 0 ||
      sessions.every(s => s.inH === '' && s.inM === '' && s.outH === '' && s.outM === '')
    if (allSessionsCleared && workHasData) {
      setStep('confirmNoSessions')
      return
    }
    setStep('confirm')
  }

  async function handleConfirm() {
    if (saving) return
    setSaving(true)
    for (const log of dayLogs) await deleteLog(log.id)
    for (let si = 0; si < sessions.length; si++) {
      const { inTime, outTime } = sessionTimes[si]
      if (inTime) await saveLogManual({ userId: user.id, logType: '出勤', date: dateStr, time: inTime, workType: '' })
      if (outTime) await saveLogManual({ userId: user.id, logType: '退勤', date: dateStr, time: outTime, workType: '' })
    }
    if (!isSalaried) {
      const flatItems = {}
      for (const r of workRows) {
        if (!r.type) continue
        const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
        if (mins > 0) flatItems[r.type] = mins
      }
      await saveWorkReport(user.id, dateStr, flatItems)
    }
    onSaved()
  }

  async function handleDelete() {
    for (const log of dayLogs) await deleteLog(log.id)
    if (!isSalaried) await saveWorkReport(user.id, dateStr, {})
    onSaved()
  }

  const hasQrSessions = dayLogs.length > 0
  const canShowDelete = hasQrSessions || workHasData

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
              <button className={styles.modalCloseBtn} onClick={onClose} tabIndex={-1}>✕</button>
            </div>

            <div className={styles.modalBody}>
              {punchSummaryBar && (
                <div className={styles.dayEditSummaryBar}>{punchSummaryBar}</div>
              )}
              <div className={styles.dayEditCols}>

                {/* ── 左列: QR打刻記録 ── */}
                <div className={styles.dayEditColLeft}>
                  <div className={styles.dayEditColHeader}>
                    <div className={styles.dayEditColTitle}>QR打刻記録</div>
                    <div className={styles.dayEditColSubtitle}>確認用・給与計算には使用しません</div>
                  </div>

                  {sessions.length === 0 ? (
                    <div className={styles.dayEditEmptyState}>
                      <div className={styles.dayEditEmptyText}>QR打刻記録はありません</div>
                      <button className={styles.dayEditAddOutlineBtn} onClick={addSession}>＋ 打刻を追加</button>
                    </div>
                  ) : (
                    <>
                      {sessions.map((s, si) => {
                        const { inTime, outTime } = sessionTimes[si]
                        const inHInvalid = s.inH !== '' && (isNaN(parseInt(s.inH)) || parseInt(s.inH) > 23)
                        const inMInvalid = s.inM !== '' && parseInt(s.inM) > 59
                        const outHInvalid = s.outH !== '' && (isNaN(parseInt(s.outH)) || parseInt(s.outH) > 23)
                        const outMInvalid = s.outM !== '' && parseInt(s.outM) > 59
                        const isIncomplete = inTime && !outTime
                        return (
                          <div key={si} className={styles.dayEditSessionRow}>
                            <span className={styles.dayEditSessionNum}>{si + 1}回目</span>
                            {isTablet ? (
                              <>
                                <span className={styles.dayEditTimeLabel}>出勤</span>
                                <button className={styles.numpadTrigger} onClick={() => setEditingTimeField({ si, field: 'in' })}>{inTime || '──:──'}</button>
                                <span className={styles.dayEditTimeLabel}>退勤</span>
                                <button className={styles.numpadTrigger} onClick={() => setEditingTimeField({ si, field: 'out' })}>{outTime || '──:──'}</button>
                              </>
                            ) : (
                              <>
                                <span className={styles.dayEditTimeLabel}>出勤</span>
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
                                <span className={styles.dayEditTimeSep}>→</span>
                                <span className={styles.dayEditTimeLabel}>退勤</span>
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
                              </>
                            )}
                            {isIncomplete && <span className={styles.dayEditIncomplete}>退勤未打刻</span>}
                            <button className={styles.dayEditRowDelBtn} onClick={() => removeSession(si)} title="削除">削除</button>
                          </div>
                        )
                      })}
                      <button className={styles.dayEditAddOutlineBtn} onClick={addSession}>＋ 打刻を追加</button>
                    </>
                  )}

                  {isTablet && editingTimeField && (
                    <TimeNumpadOverlay
                      title={editingTimeField.field === 'in' ? '出勤時刻' : '退勤時刻'}
                      initialValue={editingTimeField.field === 'in' ? sessionTimes[editingTimeField.si].inTime : sessionTimes[editingTimeField.si].outTime}
                      onConfirm={val => {
                        const [h, m] = val.split(':')
                        const si = editingTimeField.si
                        if (editingTimeField.field === 'in') {
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

                {/* ── 右列: 業務時間入力（時給従業員のみ） ── */}
                {!isSalaried && (
                  <div className={styles.dayEditColRight}>
                    <div className={styles.dayEditColHeader}>
                      <div className={styles.dayEditColTitle}>業務時間入力</div>
                      <div className={styles.dayEditColSubtitle}>実際に行った業務時間を入力してください。給与計算にはこちらを使用します</div>
                    </div>

                    {/* No check-in: disabled */}
                    {!workEnabled && (
                      <div className={styles.dayEditWorkDisabledArea}>
                        {workHasData && workItemsLoaded ? (
                          <>
                            <div className={styles.dayEditWorkWarnBox}>
                              <div className={styles.dayEditWorkWarnTitle}>出勤打刻がないため、この業務時間は要確認です</div>
                              <div className={styles.dayEditWorkWarnItems}>
                                {workRows.filter(r => r.type && ((parseInt(r.h)||0)*60+(parseInt(r.m)||0) > 0)).map((r, ri) => {
                                  const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
                                  return <div key={ri} className={styles.dayEditWorkWarnItem}>{r.type}：{fmtWorkTotal(mins)}</div>
                                })}
                              </div>
                            </div>
                            <div className={styles.dayEditWorkDisabledMsg}>出勤打刻を追加すると再び編集できます</div>
                          </>
                        ) : (
                          <div className={styles.dayEditWorkDisabledMsg}>
                            業務時間を入力するには、先に出勤打刻が必要です
                          </div>
                        )}
                      </div>
                    )}

                    {workEnabled && !workItemsLoaded && (
                      <div className={styles.dayEditSectionLoading}>読込中...</div>
                    )}

                    {workEnabled && workItemsLoaded && (
                      <>
                        {punchContextMsg && (
                          <div className={styles.dayEditPunchContext}>{punchContextMsg}</div>
                        )}
                        <div className={styles.dayEditWorkTable}>
                          <div className={styles.dayEditWorkTableHeader}>
                            <span className={styles.dayEditWorkColType}>業務</span>
                            <span className={styles.dayEditWorkColTime}>時間</span>
                            <span className={styles.dayEditWorkColOp}></span>
                          </div>
                          {workRows.map((row, ri) => {
                            const isLastRow = ri === workRows.length - 1
                            const availableTypes = userWorkItems.filter(t => t === row.type || !selectedTypes.has(t))
                            const mInvalid = row.m !== '' && row.m !== 0 && (parseInt(row.m) < 0 || parseInt(row.m) > 59)
                            return (
                              <div key={ri} className={styles.dayEditWorkRow}>
                                <select
                                  ref={isLastRow ? lastWorkSelectRef : null}
                                  className={styles.dayEditWorkTypeSelect}
                                  value={row.type}
                                  onChange={e => updateWorkRow(ri, 'type', e.target.value)}
                                >
                                  <option value="">業務を選択</option>
                                  {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <div className={styles.dayEditWorkTimeCell}>
                                  <input type="number" min="0" max="23"
                                    className={styles.dayEditWorkNum}
                                    value={row.h === 0 ? '' : row.h} placeholder="0"
                                    onChange={e => updateWorkRow(ri, 'h', parseInt(e.target.value.replace(/[^\d]/g, '')) || 0)}
                                    onFocus={e => e.target.select()} />
                                  <span className={styles.dayEditWorkUnit}>時間</span>
                                  <input type="number" min="0" max="59"
                                    className={[styles.dayEditWorkNum, mInvalid ? styles.dayEditWorkNumErr : ''].join(' ')}
                                    value={row.m === 0 ? '' : row.m} placeholder="0"
                                    onChange={e => { const n = parseInt(e.target.value.replace(/[^\d]/g, '')); updateWorkRow(ri, 'm', isNaN(n) ? 0 : n) }}
                                    onFocus={e => e.target.select()} />
                                  <span className={styles.dayEditWorkUnit}>分</span>
                                </div>
                                <button className={styles.dayEditRowDelBtn} onClick={() => removeWorkRow(ri)} title="削除">削除</button>
                              </div>
                            )
                          })}
                        </div>
                        {hasMoreWorkTypes && (
                          <button className={styles.dayEditAddBlueBtn} onClick={addWorkRow}>＋ 別の業務を追加</button>
                        )}
                        <div className={styles.dayEditWorkTotal}>
                          <span>業務時間合計</span>
                          <strong>{fmtWorkTotal(totalWorkMins)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {validationErrors.length > 0 && (
                <div className={styles.dayEditErrors}>
                  {validationErrors.map((e, i) => <div key={i} className={styles.dayEditErrorItem}>⚠ {e}</div>)}
                </div>
              )}

              {canShowDelete && (
                <>
                  <hr className={styles.modalDivider} />
                  <button className={styles.deleteTriggerBtn} onClick={() => setStep('confirmDelete')}>
                    この日のQR打刻と業務申告をすべて削除
                  </button>
                </>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={onClose}>キャンセル</button>
              <button className={styles.saveBtn} onClick={handleTryConfirm}>保存する</button>
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
                {sessions.map((s, si) => {
                  const { inTime, outTime } = sessionTimes[si]
                  const label = sessions.length > 1 ? `${si + 1}回目 ` : ''
                  return (
                    <React.Fragment key={si}>
                      {inTime && <div className={styles.confirmRow}><span>{label}出勤</span><strong style={{ color: '#2e7d32' }}>{inTime}</strong></div>}
                      {outTime && <div className={styles.confirmRow}><span>{label}退勤</span><strong style={{ color: '#c62828' }}>{outTime}</strong></div>}
                      {inTime && !outTime && <div className={styles.confirmRow}><span>{label}退勤</span><span style={{ color: '#b45309' }}>未打刻</span></div>}
                    </React.Fragment>
                  )
                })}
                {!isSalaried && workRows.filter(r => r.type).map((r, ri) => {
                  const mins = (parseInt(r.h) || 0) * 60 + (parseInt(r.m) || 0)
                  return <div key={ri} className={styles.confirmRow}><span>{r.type}</span><strong>{fmtMinutes(mins)}</strong></div>
                })}
              </div>
              {dayLogs.length > 0 && <p className={styles.confirmWarn}>既存のQR打刻記録を上書きします</p>}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
              <button className={styles.saveBtn} onClick={handleConfirm} disabled={saving}>{saving ? '保存中...' : '確定する'}</button>
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
                <div className={styles.confirmRow}><span>QRセッション数</span><strong>{dayLogs.filter(l => l.log_type === '出勤').length}件</strong></div>
                <div className={styles.confirmRow}><span>業務申告数</span><strong>{workRows.filter(r => r.type).length}件</strong></div>
              </div>
              <p className={styles.confirmWarn}>この操作は元に戻せません</p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>戻る</button>
              <button className={styles.realDeleteBtn} onClick={handleDelete}>すべて削除する</button>
            </div>
          </>
        )}

        {step === 'confirmNoSessions' && (
          <>
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderTitle}>確認</div>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmWarn}>
                出勤打刻がなくなるため、業務時間だけが残ります。打刻を追加するか、業務時間も削除してください。
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setStep('form')}>打刻を追加する</button>
              <button className={styles.saveBtn} onClick={() => setStep('confirm')}>そのまま続ける</button>
            </div>
          </>
        )}
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
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
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
    const [y, m] = selectedYM.split('-').map(Number)
    const dateFrom = `${selectedYM}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const dateTo = `${selectedYM}-${String(lastDay).padStart(2, '0')}`
    Promise.all([getLogs({ dateFrom, dateTo }), getUsers(), getMinWage(), getSalariedDaysForMonth(dateFrom, dateTo), getWorkReportsForRange(dateFrom, dateTo)])
      .then(([logs, users, minWage, salDays, workReports]) => {
        if (cancelled) return
        setSalariedDaysData(salDays)
        setSalariedDayEdits({})
        setPreview(buildPreview(logs, users, minWage, salDays, workReports))
        setPreviewLoading(false)
      })
      .catch(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [selectedYM])

  function buildPreview(logs, users, minWage, salariedDays = {}, workReports = {}) {
    const EXCL = new Set(['休憩', '準備', '有給', '固定手当', '交通費'])
    const userEntries = users.filter(u =>
      logs.some(l => l.user_id === u.id) || Object.keys(workReports).some(k => k.startsWith(`${u.id}_`))
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

      // ─── Salaried employee handling ───
      if (user.employeeType === 'salaried') {
        const regularHoursMins = user.regularHours || 0
        const standardBreakMinsVal = user.standardBreakMins || 0
        const monthlySal = user.monthlySalary || 0
        const overtimeRate = user.overtimeRate || 0

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
            const breakMins = dayData.breakMins ?? standardBreakMinsVal
            const overtimeMins = dayData.overtimeMins || 0
            dailySalariedRows.push({ ds, firstIn, lastOut, breakMins, overtimeMins, completed: true })
          } else if (hasIn) {
            const firstIn = (entry.sessions[0].inLog?.time || '').substring(0, 5)
            dailySalariedRows.push({ ds, firstIn, lastOut: null, breakMins: 0, overtimeMins: 0, completed: false })
          }
        })

        const totalOvertimeMins = dailySalariedRows.filter(r => r.completed).reduce((s, r) => s + r.overtimeMins, 0)
        const totalWorkMins = salWorkingDays * regularHoursMins + totalOvertimeMins
        const rows = []
        if (monthlySal > 0) rows.push({ label: '基本給', parentType: '基本給', isMultiPeriod: false, dayType: null, mins: null, days: null, rate: 0, pay: monthlySal })
        for (const { ds, overtimeMins } of dailySalariedRows.filter(r => r.completed && r.overtimeMins > 0)) {
          const [, mo, dd] = ds.split('-').map(Number)
          rows.push({ label: `残業（${mo}/${dd}）`, parentType: '残業', isMultiPeriod: false, dayType: null, mins: overtimeMins, days: null, rate: overtimeRate, pay: Math.round(overtimeMins / 60 * overtimeRate) })
        }
        const transport = Number(user.itemRates?.['交通費']?.amount) || 0
        if (transport > 0 && salWorkingDays > 0) rows.push({ label: '交通費', parentType: '交通費', isMultiPeriod: false, dayType: null, mins: null, days: salWorkingDays, rate: transport, pay: Math.round(salWorkingDays * transport) })
        const totalPay = rows.reduce((s, r) => s + (r.pay || 0), 0)
        return { user, workingDays: salWorkingDays, totalWorkMins, rows, totalPay, byDate, isSalariedUser: true, dailySalariedRows }
      }

      // ─── Hourly employee handling ───

      // Extract work reports for this user
      const userWorkReports = {}
      Object.entries(workReports).forEach(([key, items]) => {
        if (key.startsWith(`${user.id}_`)) {
          const dateStr = key.slice(user.id.length + 1)
          if (Object.values(items).some(m => m > 0)) userWorkReports[dateStr] = items
        }
      })

      // Merge work-report-only dates into byDate and attach workReportItems
      Object.keys(userWorkReports).forEach(dateStr => {
        if (!byDate[dateStr]) byDate[dateStr] = { pendingIn: null, sessions: [] }
      })
      Object.entries(byDate).forEach(([dateStr, entry]) => {
        entry.workReportItems = userWorkReports[dateStr] || {}
      })

      // workingDays = days with work report AND ≥1 completed QR session (spec 7)
      let workingDays = 0
      const inconsistentDates = []
      Object.entries(userWorkReports).forEach(([dateStr, items]) => {
        if (!Object.values(items).some(m => m > 0)) return
        const entry = byDate[dateStr]
        const completedSess = entry ? entry.sessions.filter(s => s.inLog && s.outLog) : []
        if (completedSess.length > 0) workingDays++
        else inconsistentDates.push(dateStr)
      })

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
      for (const type of (user.workItems || []).filter(t => !EXCL.has(t))) {
        const rateObj = itemRates[type] || {}
        const hasSunday = !!(rateObj.sunday)
        const history = rateObj?.rateHistory
        let periods
        if (!history || history.length === 0) {
          const fromDate = allByDateDates[0] || `${ymY}-01-01`
          const toDate = allByDateDates[allByDateDates.length - 1] || fromDate
          periods = [{ fromDate, toDate, normal: Number(rateObj.normal) || 0, sunday: Number(rateObj.sunday) || 0 }]
        } else {
          const sorted = [...history].sort((a, b) => { if (!a.from) return -1; if (!b.from) return 1; return a.from.localeCompare(b.from) })
          const monthStart = allByDateDates[0] || `${ymY}-${String(ymM).padStart(2,'0')}-01`
          const monthEnd = allByDateDates[allByDateDates.length - 1] || monthStart
          const defR = { normal: Number(rateObj.normal) || 0, sunday: Number(rateObj.sunday) || 0 }
          const base = sorted.filter(e => !e.from || e.from <= monthStart).pop() || sorted[0]
          const inMonth = sorted.filter(e => e.from && e.from > monthStart && e.from <= monthEnd)
          periods = []
          let cFrom = monthStart, cN = Number(base?.normal) || defR.normal, cS = Number(base?.sunday) || defR.sunday
          for (const e of inMonth) {
            const prev = new Date(e.from); prev.setDate(prev.getDate() - 1)
            const prevStr = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`
            if (prevStr >= cFrom) periods.push({ fromDate: cFrom, toDate: prevStr, normal: cN, sunday: cS })
            cFrom = e.from; cN = Number(e.normal) || 0; cS = Number(e.sunday) || 0
          }
          periods.push({ fromDate: cFrom, toDate: monthEnd, normal: cN, sunday: cS })
        }
        const multiPeriod = periods.length > 1
        for (const period of periods) {
          const { fromDate, toDate, normal: normalRate, sunday: sundayRate } = period
          let wdM = 0, weM = 0
          Object.entries(dailyTypeMinsSplit).forEach(([ds, tm]) => {
            if (ds >= fromDate && ds <= toDate && tm[type]) { wdM += tm[type].wd; weM += tm[type].we }
          })
          const periodRangeLabel = multiPeriod ? `${fromDate.slice(5).replace('-','/')}〜${toDate.slice(5).replace('-','/')}` : ''
          if (hasSunday) {
            if (wdM > 0) rows.push({ label: multiPeriod ? periodRangeLabel : type, parentType: type, isMultiPeriod: multiPeriod, dayType: 'weekday', mins: wdM, days: null, rate: normalRate, pay: Math.round(wdM / 60 * normalRate) })
            if (weM > 0) rows.push({ label: multiPeriod ? periodRangeLabel + '（日曜）' : type + '（日曜）', parentType: type, isMultiPeriod: multiPeriod, dayType: 'sunday', mins: weM, days: null, rate: sundayRate, pay: Math.round(weM / 60 * sundayRate) })
          } else {
            const tot = wdM + weM
            if (tot > 0) rows.push({ label: multiPeriod ? periodRangeLabel : type, parentType: type, isMultiPeriod: multiPeriod, dayType: null, mins: tot, days: null, rate: normalRate, pay: Math.round(tot / 60 * normalRate) })
          }
        }
      }
      const transport = Number(itemRates['交通費']?.amount) || 0
      if (transport > 0 && workingDays > 0) {
        rows.push({ label: '交通費', parentType: '交通費', isMultiPeriod: false, dayType: null, mins: null, days: workingDays, rate: transport, pay: Math.round(workingDays * transport) })
      }
      if (workingDays > 0 && minWage > 0) {
        const prepMins = workingDays * 10
        rows.push({ label: '準備時間', parentType: '準備時間', isMultiPeriod: false, dayType: null, mins: prepMins, days: null, rate: minWage, pay: Math.round(prepMins / 60 * minWage) })
      }
      const totalWorkMins = Object.values(userWorkReports).reduce((s, items) => s + Object.values(items).reduce((ss, m) => ss + m, 0), 0)
      const totalPay = rows.reduce((s, r) => s + (r.pay || 0), 0)
      return { user, workingDays, totalWorkMins, rows, totalPay, byDate, inconsistentDates }
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
    try { await saveSalariedDay(userId, ds, { breakMins: merged.breakMins, overtimeMins: merged.overtimeMins }) } catch {}
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
      const warns = []
      if (incomplete.length > 0) warns.push(`打刻未完了（正社員）：\n${incomplete.join('\n')}`)
      if (inconsistent.length > 0) warns.push(`業務申告あり・打刻なし：\n${inconsistent.join('\n')}`)
      if (warns.length > 0) {
        const msg = `以下の要確認データがあります：\n\n${warns.join('\n\n')}\n\n確認してから出力してください。このまま出力しますか？`
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
      alert('エクスポートに失敗しました: ' + (e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  const [displayY, displayM] = selectedYM.split('-').map(Number)
  const hasData = preview && preview.length > 0
  const filteredPreview = preview ? preview.filter(p => p.user.name.includes(searchQuery)) : []
  const totalEmployees = preview ? preview.length : 0
  const totalWorkingDays = preview ? preview.reduce((s, p) => s + p.workingDays, 0) : 0
  const totalSalary = preview ? preview.reduce((s, p) => s + p.totalPay, 0) : 0

  const globalSummary = useMemo(() => {
    if (!preview || preview.length === 0) return null
    const typeMap = {}
    for (const { rows } of preview) {
      for (const row of rows) {
        if (row.mins === null || row.label === '準備時間') continue
        if (!typeMap[row.label]) typeMap[row.label] = { mins: 0, pay: 0 }
        typeMap[row.label].mins += row.mins
        typeMap[row.label].pay += row.pay
      }
    }
    return {
      types: Object.entries(typeMap).map(([label, v]) => ({ label, mins: v.mins, pay: v.pay }))
    }
  }, [preview])

  return (
    <div className={styles.calContent}>
      <div className={styles.kinmuboPage}>

        {/* Page header */}
        <div className={styles.kinmuboPageHeader}>
          <h2 className={styles.kinmuboPageTitle}>出勤簿作成</h2>
          <p className={styles.kinmuboPageDesc}>対象月の勤務実績と給与を確認し、Excel形式で出力できます。</p>
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
            {exporting ? '出力中…' : 'Excelを出力'}
          </button>
        </div>

        {/* Summary cards */}
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
        {previewLoading && <div className={styles.kinmuboLoading}>読み込み中…</div>}

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
                placeholder="従業員名で検索"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <div className={styles.kinmuboExpandBtns}>
                <button className={styles.kinmuboExpandBtn} onClick={() => {
                  setExpandedIds(prev => new Set([...prev, ...filteredPreview.map(p => p.user.id)]))
                }}>すべて展開</button>
                <button className={styles.kinmuboExpandBtn} onClick={() => {
                  const ids = new Set(filteredPreview.map(p => p.user.id))
                  setExpandedIds(prev => new Set([...prev].filter(id => !ids.has(id))))
                }}>すべて閉じる</button>
              </div>
            </div>

            {filteredPreview.length === 0 && (
              <div className={styles.kinmuboEmpty}>該当する従業員がいません。</div>
            )}

            {filteredPreview.map(({ user, workingDays, totalWorkMins, rows, totalPay, byDate, isSalariedUser, dailySalariedRows, inconsistentDates }) => {
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
                      <span className={styles.kinmuboAccordionTime}>申告時間合計：{fmtMins(totalWorkMins)}</span>
                    </span>
                    {inconsistentDates?.length > 0 && (
                      <span className={styles.kinmuboAccordionWarn}>打刻要確認 {inconsistentDates.length}件</span>
                    )}
                    <span className={styles.kinmuboAccordionPay}>給与合計：{totalPay.toLocaleString()}円</span>
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
                                <th className={styles.kinmuboDailyTh}>QR出勤</th>
                                <th className={styles.kinmuboDailyTh}>QR退勤</th>
                                <th className={styles.kinmuboDailyTh}>状態</th>
                                <th className={styles.kinmuboDailyTh}>休憩時間</th>
                                <th className={styles.kinmuboDailyTh}>所定労働時間</th>
                                <th className={styles.kinmuboDailyTh}>残業時間</th>
                                <th className={styles.kinmuboDailyTh}>合計（所定＋残業）</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dailySalariedRows.map(({ ds, firstIn, lastOut, completed }) => {
                                const [y, mo, d] = ds.split('-').map(Number)
                                const dow = new Date(y, mo - 1, d).getDay()
                                const dowLabel = ['日','月','火','水','木','金','土'][dow]
                                const isSun = dow === 0, isSat = dow === 6
                                const key = `${user.id}_${ds}`
                                const edits = salariedDayEdits[key] || {}
                                const baseData = salariedDaysData[key] || {}
                                const breakMins = edits.breakMins ?? baseData.breakMins ?? (user.standardBreakMins ?? 0)
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
                      {/* QR打刻記録: show all dates with punch or work report data */}
                      {!isSalariedUser && Object.keys(byDate).sort().some(ds => byDate[ds].sessions.length > 0 || Object.keys(byDate[ds].workReportItems || {}).length > 0) && (
                        <div className={styles.kinmuboDailySection}>
                          <div className={styles.kinmuboDailySectionTitle}>QR打刻記録</div>
                          <table className={styles.kinmuboDailyTable}>
                            <thead>
                              <tr>
                                <th className={styles.kinmuboDailyTh}>日付</th>
                                <th className={styles.kinmuboDailyTh}>QR打刻</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.keys(byDate).sort().filter(ds =>
                                byDate[ds].sessions.length > 0 || Object.keys(byDate[ds].workReportItems || {}).length > 0
                              ).map(ds => {
                                const [y, mo, d] = ds.split('-').map(Number)
                                const dow = new Date(y, mo - 1, d).getDay()
                                const dowLabel = ['日','月','火','水','木','金','土'][dow]
                                const isSun = dow === 0, isSat = dow === 6
                                const entry = byDate[ds]
                                const hasSessions = entry.sessions.length > 0
                                if (!hasSessions) {
                                  return (
                                    <tr key={ds} className={[styles.kinmuboDailyRow, isSun ? styles.kinmuboDailyRowSun : isSat ? styles.kinmuboDailyRowSat : ''].filter(Boolean).join(' ')}>
                                      <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyDateTd].join(' ')}>{`${mo}/${d}（${dowLabel}）`}</td>
                                      <td className={styles.kinmuboDailyTd} style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>打刻なし</td>
                                    </tr>
                                  )
                                }
                                return entry.sessions.map((session, si) => {
                                  const inStr = session.inLog?.time?.substring(0, 5) || ''
                                  const outStr = session.outLog?.time?.substring(0, 5) || ''
                                  const numSessions = entry.sessions.length
                                  const punchText = inStr && outStr
                                    ? `出勤 ${inStr} ／ 退勤 ${outStr}`
                                    : inStr ? `出勤 ${inStr}（退勤なし）` : outStr ? `退勤 ${outStr}（出勤なし）` : '—'
                                  return (
                                    <tr key={`${ds}-${si}`} className={[
                                      styles.kinmuboDailyRow,
                                      isSun ? styles.kinmuboDailyRowSun : isSat ? styles.kinmuboDailyRowSat : '',
                                      si > 0 ? styles.kinmuboDailyGroupExtra : '',
                                    ].filter(Boolean).join(' ')}>
                                      {si === 0 && (
                                        <td className={[styles.kinmuboDailyTd, styles.kinmuboDailyDateTd].join(' ')} rowSpan={numSessions}>
                                          <span>{`${mo}/${d}（${dowLabel}）`}</span>
                                          {numSessions > 1 && <span className={styles.multiSessionBadge}>{numSessions}回</span>}
                                        </td>
                                      )}
                                      <td className={styles.kinmuboDailyTd}>{punchText}</td>
                                    </tr>
                                  )
                                })
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {rows.length === 0 ? (
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
                                      <td colSpan={4} className={styles.kinmuboDetailGroupTd}>{r.parentType}</td>
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

  useEffect(() => { loadStatuses() }, [])

  async function loadStatuses() {
    const s = await getTodayStatuses()
    setStatuses(s)
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
    return matchSearch && matchStatus
  })
  const isFiltering = !!searchQuery || statusFilter !== 'all'
  const countLabel = isFiltering
    ? `${users.length}名中 ${filtered.length}名を表示`
    : `登録ユーザー ${users.length}名`

  return (
    <div className={styles.calContent}>
      <div className={styles.usersPage}>

        {/* Page header */}
        <div className={styles.usersPageHeader}>
          <div>
            <h2 className={styles.kinmuboPageTitle}>ユーザー管理</h2>
            <p className={styles.kinmuboPageDesc}>従業員情報、PINコード、作業項目、時給を管理します。</p>
          </div>
          <button className={styles.kinmuboExportBtn} onClick={() => setAdding(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            ユーザーを追加
          </button>
        </div>

        {/* Filter card */}
        <div className={styles.usersFilterCard}>
          <input
            type="text"
            className={styles.kinmuboSearch}
            placeholder="氏名・ユーザーIDで検索"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className={styles.usersStatusFilter}>
            {[['all','すべて'],['in','出勤中'],['out','退勤中']].map(([v,l]) => (
              <button
                key={v}
                className={[styles.usersFilterBtn, statusFilter === v ? styles.usersFilterBtnActive : ''].join(' ')}
                onClick={() => setStatusFilter(v)}
              >{l}</button>
            ))}
          </div>
          <span className={styles.usersCount}>{countLabel}</span>
        </div>

        {/* User table */}
        <div className={styles.usersTableCard}>
          {users.length === 0 ? (
            <div className={styles.kinmuboEmpty}>登録されているユーザーはいません。</div>
          ) : filtered.length === 0 ? (
            <div className={styles.kinmuboEmpty}>該当するユーザーがいません。</div>
          ) : (
            <table className={styles.usersTable}>
              <thead>
                <tr>
                  <th className={styles.usersTh}>氏名</th>
                  <th className={styles.usersTh}>ユーザーID</th>
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
                          {isIn ? '出勤中' : '退勤中'}
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
          onClose={() => setAdding(false)}
          onAdded={newUser => { setAdding(false); onRefresh(); setQrUser(newUser) }}
        />
      )}

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
              <button className={styles.saveBtn} onClick={() => { window.print() }}>🖨 印刷</button>
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

function AddUserModal({ onClose, onAdded }) {
  const [addId, setAddId] = useState('')
  const [addName, setAddName] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [employeeType, setEmployeeType] = useState('hourly')
  const [workItems, setWorkItems] = useState([])
  const [itemRates, setItemRates] = useState(() => {
    const r = {}
    ASSIGNABLE_ITEMS.forEach(item => { r[item] = { normal: '', sunday: '', amount: '' } })
    return r
  })
  const [multipliers, setMultipliers] = useState({})
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

  async function handleAdd() {
    if (!addId.trim() || !addName.trim() || saving) return
    if (pin && !/^\d{4}$/.test(pin)) { setPinError('PINは4桁の数字を入力してください'); return }
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
        ...(employeeType === 'salaried' ? {
          fixedStartTime, fixedEndTime,
          monthlySalary: Number(monthlySalary) || 0,
          overtimeRate: Number(overtimeRateSal) || 0,
          regularHours: (parseInt(regularHoursH) || 0) * 60 + (parseInt(regularHoursM) || 0),
          standardBreakMins: parseInt(standardBreakMins) || 0,
        } : {}),
      }
      await upsertUser(newUser)
      onAdded(newUser)
    } catch(e) {
      alert('追加に失敗しました: ' + (e?.message || e))
      setSaving(false)
    }
  }

  const canSave = addId.trim() && addName.trim() && !pinError

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.userEditModal} onClick={e => e.stopPropagation()}>
        <div className={styles.userEditHeader}>
          <div>
            <div className={styles.userEditTitle}>ユーザーを追加</div>
            <div className={styles.userEditSubtitle}>ユーザーIDと氏名を入力してください</div>
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
                    onClick={() => setEmployeeType('hourly')}
                  >アルバイト・パート</button>
                  <button
                    type="button"
                    className={[styles.empTypeBtn, employeeType === 'salaried' ? styles.empTypeBtnActive : ''].join(' ')}
                    onClick={() => setEmployeeType('salaried')}
                  >社員</button>
                </div>
              </div>
              <div />
              <div>
                <label className={styles.userEditLabel}>ユーザーID <span className={styles.userEditRequired}>必須</span></label>
                <input
                  className={styles.userEditInput}
                  placeholder="例: USER011"
                  value={addId}
                  onChange={e => setAddId(e.target.value)}
                  autoFocus
                />
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
                  : <div className={styles.userEditHintText}>4桁の数字。未設定の場合はPINで打刻できません。</div>
                }
              </div>
            </div>
          </div>

          {/* 社員設定 */}
          {employeeType === 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>社員設定</div>
              <div className={styles.userEditGrid2}>
                <div>
                  <label className={styles.userEditLabel}>固定出勤時刻</label>
                  <input
                    type="time"
                    className={styles.userEditInput}
                    value={fixedStartTime}
                    onChange={e => setFixedStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>固定退勤時刻</label>
                  <input
                    type="time"
                    className={styles.userEditInput}
                    value={fixedEndTime}
                    onChange={e => setFixedEndTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>月給（円）</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.userEditInput}
                    value={monthlySalary}
                    onChange={e => setMonthlySalary(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>残業時給（円）</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.userEditInput}
                    value={overtimeRateSal}
                    onChange={e => setOvertimeRateSal(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>所定労働時間</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min="0" max="23" className={styles.userEditInput} style={{ width: 70 }} value={regularHoursH} onChange={e => setRegularHoursH(e.target.value)} placeholder="8" />
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>時間</span>
                    <input type="number" min="0" max="59" className={styles.userEditInput} style={{ width: 70 }} value={regularHoursM} onChange={e => setRegularHoursM(e.target.value)} placeholder="0" />
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>分</span>
                  </div>
                </div>
                <div>
                  <label className={styles.userEditLabel}>標準休憩時間（分）</label>
                  <input type="number" min="0" className={styles.userEditInput} value={standardBreakMins} onChange={e => setStandardBreakMins(e.target.value)} placeholder="60" />
                </div>
              </div>
            </div>
          )}

          {/* 作業項目・時給 */}
          {employeeType !== 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>作業項目・時給</div>
              <div className={styles.workItemTableWrap}>
                <table className={styles.workItemTable}>
                  <thead>
                    <tr>
                      <th className={styles.workItemTh} style={{width:44}}>使用</th>
                      <th className={styles.workItemTh}>作業項目</th>
                      <th className={styles.workItemTh} style={{width:140}}>基本時給</th>
                      <th className={styles.workItemTh} style={{width:110}}>日曜倍率</th>
                      <th className={styles.workItemTh} style={{width:120}}>日曜時給</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSIGNABLE_ITEMS.map(item => {
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
                            <span className={[styles.workItemName, !checked ? styles.workItemNameDim : ''].join(' ')}>{item}</span>
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
                                    placeholder="1.25"
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
        </div>
        <div className={styles.userEditFooter}>
          <div />
          <div className={styles.userEditFooterBtns}>
            <button className={styles.userEditCancelBtn} onClick={onClose}>キャンセル</button>
            <button className={styles.userEditSaveBtn} onClick={handleAdd} disabled={!canSave || saving}>
              {saving ? '追加中…' : 'ユーザーを追加'}
            </button>
          </div>
        </div>
      </div>
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
    if (raw !== '' && parseInt(raw) > 59) { setError('分は0〜59で入力してください'); return }
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
          <div className={styles.pcWorkTimeTitle}>{item}</div>
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

function UserEditModal({ user, isIn, onClose, onSaved, onDeleted, isTablet }) {
  const [step, setStep] = useState('main')
  const [name, setName] = useState(user.name)
  const [pin, setPin] = useState(user.pin || '')
  const [pinError, setPinError] = useState('')
  const [workItems, setWorkItems] = useState(user.workItems || [])
  const [rateHistory, setRateHistory] = useState(() => {
    const h = {}
    ASSIGNABLE_ITEMS.forEach(item => {
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
  const [dangerOpen, setDangerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [numpad, setNumpad] = useState(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setIsDirty(true)
  }, [name, pin, workItems, transportAmount, rateHistory, employeeType, fixedStartTime, fixedEndTime, monthlySalary, overtimeRateSal, regularHoursH, regularHoursM, standardBreakMins])

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
    ASSIGNABLE_ITEMS.forEach(item => {
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
    const sorted = [...hist].sort((a, b) => { if (!a.from && !b.from) return 0; if (!a.from) return -1; if (!b.from) return 1; return b.from.localeCompare(a.from) })
    if (!selectedDate) return sorted[sorted.length - 1] || null
    return sorted.find(e => !e.from || e.from < selectedDate) || null
  }

  function commitAddRate() {
    if (!addRateForm) return
    const { item, date, normalStr, showMultiplierInput, customMultiplierStr } = addRateForm
    if (!normalStr) return
    if (!date) { alert('適用開始日を入力してください'); return }
    const existing = rateHistory[item] || []
    if (existing.some(e => e.from === date)) {
      alert(`${fmtJaDate(date)}の時給はすでに登録されています。削除してから再登録してください。`)
      return
    }
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
    const todayStr = getTodayJst()
    if (!entryFrom || entryFrom <= todayStr) {
      alert('現在適用中・過去の時給履歴は削除できません')
      return
    }
    setRateHistory(prev => ({ ...prev, [item]: (prev[item] || []).filter(e => e.from !== entryFrom) }))
  }

  async function handleSaveAll() {
    if (!name.trim()) return
    if (pin && !/^\d{4}$/.test(pin)) { setPinError('PINは4桁の数字を入力してください'); return }
    setSaving(true)
    setPinError('')
    try {
      if (pin) {
        const existing = await resolveUserByPin(pin)
        if (existing && existing.id !== user.id) {
          setPinError('このPINは使用中です')
          setSaving(false)
          return
        }
      }
      await upsertUser({
        id: user.id, name: name.trim(), pin, employeeType,
        workItems: employeeType === 'salaried' ? [] : workItems,
        itemRates: employeeType === 'salaried' ? {} : buildItemRates(),
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
    await saveLog({ userId: user.id, workType: '', logType: isIn ? '退勤' : '出勤' })
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
            <div className={styles.userEditTitle}>ユーザー削除の確認</div>
            <div className={styles.userEditSubtitle}>{user.name}（{user.id}）</div>
          </div>
          <button className={styles.userEditClose} onClick={() => setStep('main')} aria-label="閉じる"><XIcon /></button>
        </div>
        <div className={styles.userEditBody}>
          <p className={styles.confirmWarn}>
            このユーザーと全ての打刻記録を完全に削除します。<br />この操作は元に戻せません。
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
            <span className={styles.oldTime}>{isIn ? '出勤中' : '退勤中'}</span>
            {' → '}
            <span className={styles.newTime}>{isIn ? '退勤中' : '出勤中'}</span>
            {' に変更します'}
          </p>
          <p className={styles.confirmWarn}>この操作は元に戻せません</p>
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
                  : <div className={styles.userEditHintText}>4桁の数字。未設定の場合はPINで打刻できません。</div>
                }
              </div>
            </div>
          </div>

          {/* 社員設定 */}
          {employeeType === 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>社員設定</div>
              <div className={styles.userEditGrid2}>
                <div>
                  <label className={styles.userEditLabel}>固定出勤時刻</label>
                  <input
                    type="time"
                    className={styles.userEditInput}
                    value={fixedStartTime}
                    onChange={e => setFixedStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>固定退勤時刻</label>
                  <input
                    type="time"
                    className={styles.userEditInput}
                    value={fixedEndTime}
                    onChange={e => setFixedEndTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>月給（円）</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.userEditInput}
                    value={monthlySalary}
                    onChange={e => setMonthlySalary(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>残業時給（円）</label>
                  <input
                    type="number"
                    min="0"
                    className={styles.userEditInput}
                    value={overtimeRateSal}
                    onChange={e => setOvertimeRateSal(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className={styles.userEditLabel}>所定労働時間</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" min="0" max="23" className={styles.userEditInput} style={{ width: 70 }} value={regularHoursH} onChange={e => setRegularHoursH(e.target.value)} placeholder="8" />
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>時間</span>
                    <input type="number" min="0" max="59" className={styles.userEditInput} style={{ width: 70 }} value={regularHoursM} onChange={e => setRegularHoursM(e.target.value)} placeholder="0" />
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>分</span>
                  </div>
                </div>
                <div>
                  <label className={styles.userEditLabel}>標準休憩時間（分）</label>
                  <input type="number" min="0" className={styles.userEditInput} value={standardBreakMins} onChange={e => setStandardBreakMins(e.target.value)} placeholder="60" />
                </div>
              </div>
            </div>
          )}

          {/* 作業項目・時給 */}
          {employeeType !== 'salaried' && (
            <div className={styles.userEditSection}>
              <div className={styles.userEditSectionTitle}>作業項目・時給</div>
              <div className={styles.workItemTableWrap}>
                <table className={styles.workItemTable}>
                  <thead>
                    <tr>
                      <th className={styles.workItemTh} style={{width:44}}>使用</th>
                      <th className={styles.workItemTh}>作業項目</th>
                      <th className={styles.workItemTh} style={{width:170}}>基本時給（現在）</th>
                      <th className={styles.workItemTh} style={{width:110}}>日曜時給</th>
                      <th className={styles.workItemTh} style={{width:120}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSIGNABLE_ITEMS.map(item => {
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
                            <span className={[styles.workItemName, !checked ? styles.workItemNameDim : ''].join(' ')}>{item}</span>
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
                                  時給履歴・変更
                                </button>
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

          {/* 時給履歴モーダル */}
          {historyModalItem && (
            <div className={styles.modalOverlay} onClick={() => { setHistoryModalItem(null); setAddRateForm(null) }}>
              <div className={styles.rateHistoryModal} onClick={e => e.stopPropagation()}>
                <div className={styles.rateHistoryModalHeader}>
                  <div className={styles.rateHistoryModalTitle}>{historyModalItem} の時給履歴</div>
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
                    if (sorted.length === 0) return <p className={styles.rateHistoryEmpty}>時給の登録がありません。「新しい時給を追加」から登録してください。</p>
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
                                    {isFuture
                                      ? <button className={styles.rateHistoryDelBtn} onClick={() => deleteRateHistoryEntry(historyModalItem, entry.from)}>削除</button>
                                      : <span className={isCurrent ? styles.rateHistoryCurrentBadge : styles.rateHistoryPastBadge}>{status}</span>
                                    }
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
                                          placeholder="例: 1.25"
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
                              <button className={styles.saveBtn} onClick={commitAddRate} disabled={!addRateForm.normalStr}>この内容で時給を変更</button>
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
                {isIn ? '出勤中' : '退勤中'}
              </span>
              <button className={styles.userEditStatusChangeBtn} onClick={() => setStep('confirmStatus')}>
                {isIn ? '退勤中に切り替える' : '出勤中に切り替える'}
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
                  このユーザーを削除する
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
              {saving ? '保存中…' : '変更を保存'}
            </button>
          </div>
        </div>
      </div>
      {isTablet && numpad && (
        <NumpadOverlay
          title={numpad.title}
          initialValue={numpad.field === 'pin' ? '' : transportAmount}
          maxLength={numpad.maxLength}
          decimal={false}
          pinMode={!!numpad.pinMode}
          onConfirm={val => {
            if (numpad.field === 'pin') { setPin(val); setPinError('') }
            else setTransportAmount(val)
          }}
          onClose={() => setNumpad(null)}
        />
      )}
    </div>
  )
}
