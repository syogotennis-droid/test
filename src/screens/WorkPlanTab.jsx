import React, { useEffect, useMemo, useState } from 'react'
import { getWorkPlans, saveWorkPlan, copyWorkPlans, CLOCK_OUT_HIDDEN, localToday } from '../lib/db'
import admin from './AdminScreen.module.css'
import styles from './WorkPlanTab.module.css'

const DOW = ['日', '月', '火', '水', '木', '金', '土']

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(s, n) {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

function mondayOf(s) {
  const d = parseDate(s)
  const dow = d.getDay()
  return addDays(s, dow === 0 ? -6 : 1 - dow)
}

function md(s) {
  const d = parseDate(s)
  return `${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()]}）`
}

function fmtMins(mins) {
  const h = Math.floor(mins / 60), m = mins % 60
  if (h === 0) return `${m}分`
  return m > 0 ? `${h}時間${m}分` : `${h}時間`
}

function DayEditor({ items, options, onCancel, onSave, onDelete, saving }) {
  const [rows, setRows] = useState(() => {
    const r = Object.entries(items || {}).map(([type, mins]) => ({ type, h: Math.floor(mins / 60), m: mins % 60 }))
    return r.length > 0 ? r : [{ type: '', h: '', m: '' }]
  })
  const used = new Set(rows.map(r => r.type).filter(Boolean))
  const update = (i, field, val) => setRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r))
  const num = v => v === '' ? 0 : parseInt(v) || 0

  const result = {}
  let error = ''
  for (const r of rows) {
    const mins = num(r.h) * 60 + num(r.m)
    if (r.m !== '' && num(r.m) > 59) error = '分は0〜59で入力してください'
    else if (r.type && mins === 0) error = `「${r.type}」の時間を入力してください`
    else if (!r.type && mins > 0) error = '業務を選択してください'
    if (r.type && mins > 0) result[r.type] = mins
  }
  const total = Object.values(result).reduce((s, m) => s + m, 0)

  return (
    <div className={styles.editor}>
      {rows.map((r, i) => (
        <div key={i} className={styles.editRow}>
          <select className={styles.select} value={r.type} onChange={e => update(i, 'type', e.target.value)}>
            <option value="">業務を選択</option>
            {options.filter(t => t === r.type || !used.has(t)).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className={styles.timeCell}>
            <input className={styles.num} type="text" inputMode="numeric" maxLength={2} placeholder="0" value={r.h}
              onChange={e => update(i, 'h', e.target.value.replace(/\D/g, '').slice(0, 2))} onFocus={e => e.target.select()} />
            <span>時間</span>
            <input className={styles.num} type="text" inputMode="numeric" maxLength={2} placeholder="0" value={r.m}
              onChange={e => update(i, 'm', e.target.value.replace(/\D/g, '').slice(0, 2))} onFocus={e => e.target.select()} />
            <span>分</span>
          </span>
          <button className={styles.rowDel} onClick={() => setRows(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ type: '', h: '', m: '' }])} title="この行を削除">×</button>
        </div>
      ))}
      {options.some(t => !used.has(t)) && (
        <button className={styles.addRow} onClick={() => setRows(prev => [...prev, { type: '', h: '', m: '' }])}>＋ 業務を追加</button>
      )}
      {error && <div className={styles.error}>⚠ {error}</div>}
      <div className={styles.editFooter}>
        {onDelete && <button className={styles.dayDelete} onClick={onDelete} disabled={saving}>この日の予定を削除</button>}
        <span className={styles.editTotal}>合計 {fmtMins(total)}</span>
        <button className={admin.cancelBtn} onClick={onCancel} disabled={saving}>キャンセル</button>
        <button className={admin.saveBtn} onClick={() => onSave(result)} disabled={!!error || saving}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  )
}

function CopyDialog({ user, weekStart, onClose, onCopied }) {
  const [weeks, setWeeks] = useState(3)
  const [overwrite, setOverwrite] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    copyWorkPlans({ userId: user.id, weekStart, weeks, overwriteCopied: overwrite, dryRun: true })
      .then(r => { if (!cancelled) setPreview(r) })
      .catch(() => { if (!cancelled) setError('確認できませんでした') })
    return () => { cancelled = true }
  }, [user.id, weekStart, weeks, overwrite])

  async function run() {
    setBusy(true)
    try {
      const r = await copyWorkPlans({ userId: user.id, weekStart, weeks, overwriteCopied: overwrite })
      onCopied(r)
    } catch {
      setError('コピーに失敗しました')
      setBusy(false)
    }
  }

  const changes = preview ? preview.created + preview.overwritten : 0
  const firstTarget = addDays(weekStart, 7)
  const lastTarget = addDays(weekStart, 7 * weeks + 6)

  return (
    <div className={admin.modalOverlay} onClick={onClose}>
      <div className={admin.modal} onClick={e => e.stopPropagation()}>
        <h3>この週の勤務内容を以降の週にもコピーしますか？</h3>
        <p className={styles.dialogSub}>{user.name} ／ コピー元 {md(weekStart)}〜{md(addDays(weekStart, 6))}</p>

        <label className={styles.dialogLabel}>コピー先</label>
        <div className={styles.weekPicker}>
          {[1, 2, 3, 4, 6, 8].map(n => (
            <button key={n} className={[styles.weekBtn, weeks === n ? styles.weekBtnOn : ''].join(' ')} onClick={() => setWeeks(n)}>
              {n}週分
            </button>
          ))}
        </div>
        <p className={styles.dialogRange}>{md(firstTarget)} 〜 {md(lastTarget)}</p>

        <label className={styles.checkLine}>
          <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
          以前のコピーで入れた予定も、この週の内容で置き換える
        </label>

        <div className={styles.summary}>
          {!preview && !error && <span>確認中…</span>}
          {preview && (
            <>
              <div><strong>{preview.created}日</strong> 新しく登録</div>
              {preview.overwritten > 0 && <div><strong>{preview.overwritten}日</strong> コピー済みの予定を置き換え</div>}
              {preview.skippedManual > 0 && <div className={styles.muted}>{preview.skippedManual}日 個別に入力・修正済みのため変更しません</div>}
              {preview.skippedCopied > 0 && <div className={styles.muted}>{preview.skippedCopied}日 コピー済みのため変更しません</div>}
              {preview.skippedPast > 0 && <div className={styles.muted}>{preview.skippedPast}日 過去の日付のため変更しません</div>}
            </>
          )}
        </div>
        {error && <div className={styles.error}>⚠ {error}</div>}

        <div className={admin.modalActions}>
          <button className={admin.cancelBtn} onClick={onClose} disabled={busy}>キャンセル</button>
          <button className={admin.saveBtn} onClick={run} disabled={busy || !preview || changes === 0}>
            {busy ? 'コピー中…' : changes > 0 ? `${changes}日分をコピーする` : 'コピーする日がありません'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WorkPlanTab({ users }) {
  const planUsers = useMemo(() => users.filter(u => u.employeeType !== 'salaried'), [users])
  const today = localToday()
  const [userId, setUserId] = useState(null)
  const [weekStart, setWeekStart] = useState(() => mondayOf(today))
  const [plans, setPlans] = useState({})
  const [loading, setLoading] = useState(false)
  const [editingDate, setEditingDate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const user = planUsers.find(u => u.id === userId) || null
  useEffect(() => { if (!userId && planUsers.length > 0) setUserId(planUsers[0].id) }, [planUsers, userId])

  const options = useMemo(
    () => (user?.workItems || []).filter(t => !CLOCK_OUT_HIDDEN.has(t) && t !== '休憩'),
    [user]
  )
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function load() {
    if (!user) return
    setLoading(true)
    getWorkPlans(user.id, weekStart, addDays(weekStart, 6))
      .then(p => { setPlans(p); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { setEditingDate(null); load() }, [userId, weekStart])

  async function saveDay(date, items) {
    setSaving(true)
    try {
      await saveWorkPlan(user.id, date, items)
      setEditingDate(null)
      load()
    } catch {
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const weekHasPlans = days.some(d => plans[d] && !plans[d].cleared)

  return (
    <div className={admin.calContent}>
      <div className={styles.page}>
        <div>
          <h2 className={admin.kinmuboPageTitle}>勤務予定</h2>
          <p className={admin.kinmuboPageDesc}>曜日ごとの業務と時間を登録すると、その日の退勤時の業務入力に自動で入ります（給与は実際に入力された時間で計算されます）。</p>
        </div>

        {planUsers.length === 0 ? (
          <div className={admin.kinmuboEmpty}>アルバイト・パートの従業員がいません。</div>
        ) : (
          <>
            <div className={admin.userTabsWrap} style={{ padding: 0, flexWrap: 'wrap' }}>
              {planUsers.map(u => (
                <button key={u.id} className={[admin.userTab, u.id === userId ? admin.activeUserTab : ''].join(' ')} onClick={() => setUserId(u.id)}>
                  {u.name}
                </button>
              ))}
            </div>

            <div className={styles.weekNav}>
              <button className={admin.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>◀ 前の週</button>
              <span className={styles.weekLabel}>{md(weekStart)} 〜 {md(addDays(weekStart, 6))}</span>
              <button className={admin.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>次の週 ▶</button>
              {weekStart !== mondayOf(today) && (
                <button className={admin.navBtn} onClick={() => setWeekStart(mondayOf(today))}>今週</button>
              )}
            </div>

            {notice && <div className={styles.notice} onClick={() => setNotice('')}>{notice}</div>}

            {options.length === 0 && user && (
              <div className={styles.warn}>この従業員には作業項目が設定されていません。ユーザー管理で作業項目を選んでください。</div>
            )}

            <div className={styles.days}>
              {days.map(d => {
                const plan = plans[d]?.cleared ? null : plans[d]
                const cleared = !!plans[d]?.cleared
                const entries = Object.entries(plan?.items || {})
                const total = entries.reduce((s, [, m]) => s + m, 0)
                const dow = parseDate(d).getDay()
                const isEditing = editingDate === d
                return (
                  <div key={d} className={[styles.day, dow === 0 ? styles.sun : dow === 6 ? styles.sat : '', d === today ? styles.today : ''].join(' ')}>
                    <div className={styles.dayHead}>
                      <span className={styles.dayDate}>{md(d)}</span>
                      {d === today && <span className={styles.badgeToday}>今日</span>}
                      {plan?.source === 'copy' && <span className={styles.badgeCopy}>コピー</span>}
                      {d < today && <span className={styles.badgePast}>過去</span>}
                      {!isEditing && (
                        <button className={styles.editBtn} onClick={() => setEditingDate(d)} disabled={loading || options.length === 0}>
                          {plan ? '編集' : '＋ 予定を入力'}
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <DayEditor
                        items={plan?.items}
                        options={options}
                        saving={saving}
                        onCancel={() => setEditingDate(null)}
                        onSave={items => saveDay(d, items)}
                        onDelete={plan ? () => saveDay(d, {}) : null}
                      />
                    ) : entries.length > 0 ? (
                      <div className={styles.items}>
                        {entries.map(([t, m]) => <span key={t} className={styles.chip}>{t} {fmtMins(m)}</span>)}
                        {entries.length > 1 && <span className={styles.total}>計 {fmtMins(total)}</span>}
                      </div>
                    ) : (
                      <div className={styles.none}>{cleared ? '予定なし（この日だけ削除済み・コピーで上書きされません）' : '予定なし'}</div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className={styles.copyBar}>
              <button className={styles.copyBtn} onClick={() => setCopyOpen(true)} disabled={!weekHasPlans || loading}>
                この週の内容を以降の週にコピー…
              </button>
              {!weekHasPlans && <span className={styles.copyHint}>この週に予定を入力するとコピーできます</span>}
            </div>
          </>
        )}
      </div>

      {copyOpen && user && (
        <CopyDialog
          user={user}
          weekStart={weekStart}
          onClose={() => setCopyOpen(false)}
          onCopied={r => {
            setCopyOpen(false)
            setNotice(`${r.created + r.overwritten}日分の予定をコピーしました。各日の予定はあとから個別に変更できます。`)
          }}
        />
      )}
    </div>
  )
}
