import React, { useState } from 'react'
import { loadWorkItemDefs, saveWorkItemDefs, newWorkItemId, SYSTEM_ITEMS } from '../lib/db'
import { useWorkItemDefs } from '../lib/useWorkItemDefs'
import styles from './AdminScreen.module.css'

// 業務の管理: add / rename / group / reorder / delete work items.
// Records keep the item id, so renaming never touches stored data, and a
// deleted item stays in the list (deleted: true) for past records and pay.

const NEW_GROUP = '__new__'
const MAX_NAME = 20

const btn = { height: 36, minWidth: 36, padding: '0 10px', border: '1.5px solid #dde4ec', borderRadius: 8, background: '#fff', color: '#1a3f6f', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }
const inputStyle = { height: 44, width: '100%', border: '2px solid #e2e8f0', borderRadius: 10, fontSize: '1rem', padding: '0 10px', background: '#f8fafc', color: '#1a3f6f', boxSizing: 'border-box', fontFamily: 'inherit' }
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#555', fontWeight: 700 }

function groupsOf(defs) {
  return [...new Set(defs.filter(d => !d.deleted && d.group).map(d => d.group))]
}

function nameError(name, defs, selfId) {
  if (!name) return '氏名を入力'
  if (name.length > MAX_NAME) return `名前は${MAX_NAME}文字以内にしてください`
  if (SYSTEM_ITEMS.has(name)) return `「${name}」は計算用の項目のため使えません`
  const same = defs.find(d => d.id !== selfId && d.name === name)
  if (same && !same.deleted) return '同じ名前の業務があります'
  if (same && same.deleted) return '削除した業務に同じ名前があります。下の「削除した業務」から戻してください'
  return ''
}

function ItemForm({ title, initial, defs, onSave, onClose, onRestore }) {
  const groups = groupsOf(defs)
  const [name, setName] = useState(initial?.name || '')
  const [group, setGroup] = useState(initial?.group || '')
  const [newGroup, setNewGroup] = useState('')
  const [variant, setVariant] = useState(initial?.variant || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()
  // adding a name that was deleted before → offer to bring that item back
  const deletedSame = !initial && defs.find(d => d.deleted && d.name === trimmed)

  async function submit() {
    if (deletedSame) return
    const e = nameError(trimmed, defs, initial?.id)
    if (e) { setErr(e); return }
    const g = group === NEW_GROUP ? newGroup.trim() : group
    if (group === NEW_GROUP && !g) { setErr('新しいグループの氏名を入力'); return }
    if (g && SYSTEM_ITEMS.has(g)) { setErr(`「${g}」はグループ名に使えません`); return }
    setBusy(true)
    try { await onSave({ name: trimmed, group: g || undefined, variant: g ? (variant.trim() || undefined) : undefined }) }
    catch (ex) { setErr('保存に失敗しました: ' + (ex?.message || ex)); setBusy(false) }
  }

  return (
    <div className={styles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)' }}>
        <h3>{title}</h3>
        <label style={labelStyle}>
          業務の名前
          <input value={name} maxLength={MAX_NAME} placeholder="例: 受付補助" style={inputStyle} autoFocus
            onChange={e => { setName(e.target.value); setErr('') }} />
        </label>
        {deletedSame ? (
          <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', fontSize: '0.88rem', color: '#92400e' }}>
            以前削除した「{trimmed}」があります。戻すと、過去の記録・時給とつながったまま使えるようになります。
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className={styles.saveBtn} disabled={busy}
                onClick={async () => { setBusy(true); try { await onRestore(deletedSame.id) } catch { setErr('保存に失敗しました'); setBusy(false) } }}>
                「{trimmed}」を戻す
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={labelStyle}>
              グループ（退勤画面で1つのカードにまとめる）
              <select value={group} onChange={e => { setGroup(e.target.value); setErr('') }} style={inputStyle}>
                <option value="">なし</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                <option value={NEW_GROUP}>＋ 新しいグループを作る</option>
              </select>
            </label>
            {group === NEW_GROUP && (
              <label style={labelStyle}>
                新しいグループの名前
                <input value={newGroup} maxLength={MAX_NAME} placeholder="例: 水泳教室" style={inputStyle}
                  onChange={e => { setNewGroup(e.target.value); setErr('') }} />
              </label>
            )}
            {group && (
              <label style={labelStyle}>
                グループ内の表示
                <input value={variant} maxLength={MAX_NAME} placeholder={`例: 短期（空欄なら「${trimmed || '業務の名前'}」）`} style={inputStyle}
                  onChange={e => setVariant(e.target.value)} />
              </label>
            )}
          </>
        )}
        {initial && trimmed && trimmed !== initial.name && (
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
            名前を変えても、過去の記録・時給・給与はそのままつながります（過去の月の画面・Excelも新しい名前で表示されます）。
          </div>
        )}
        {err && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.88rem' }}>{err}</div>}
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>キャンセル</button>
          {!deletedSame && <button className={styles.saveBtn} onClick={submit} disabled={busy || !trimmed}>{busy ? '保存中' : '保存する'}</button>}
        </div>
      </div>
    </div>
  )
}

function ConfirmDelete({ def, users, onDelete, onClose }) {
  const [busy, setBusy] = useState(false)
  const holders = (users || []).filter(u => (u.workItems || []).includes(def.id))
  return (
    <div className={styles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)' }}>
        <h3>「{def.name}」を削除しますか？</h3>
        <div style={{ fontSize: '0.88rem', color: '#374151', lineHeight: 1.6 }}>
          退勤画面・従業員管理に出なくなります。<br />
          過去の記録・給与・出勤簿にはそのまま残ります。あとで戻すこともできます。
        </div>
        {holders.length > 0 && (
          <div style={{ fontSize: '0.84rem', color: '#92400e', background: '#fffbeb', borderRadius: 8, padding: '8px 10px' }}>
            {holders.length}人の担当業務に入っています（{holders.slice(0, 5).map(u => u.name).join('、')}{holders.length > 5 ? ' ほか' : ''}）。次の退勤から選べなくなります。
          </div>
        )}
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>キャンセル</button>
          <button className={styles.realDeleteBtn} disabled={busy}
            onClick={async () => { setBusy(true); try { await onDelete() } catch { alert('保存に失敗しました'); setBusy(false) } }}>
            {busy ? '保存中' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RenameGroup({ group, defs, onSave, onClose }) {
  const [name, setName] = useState(group)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    const n = name.trim()
    if (!n) { setErr('氏名を入力'); return }
    if (SYSTEM_ITEMS.has(n)) { setErr(`「${n}」はグループ名に使えません`); return }
    if (n !== group && groupsOf(defs).includes(n)) { setErr('同じ名前のグループがあります'); return }
    setBusy(true)
    try { await onSave(n) } catch (ex) { setErr('保存に失敗しました: ' + (ex?.message || ex)); setBusy(false) }
  }
  return (
    <div className={styles.modalOverlay} onClick={() => !busy && onClose()}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)' }}>
        <h3>グループ名の変更</h3>
        <label style={labelStyle}>
          グループの名前（退勤画面のカードに出る名前）
          <input value={name} maxLength={MAX_NAME} style={inputStyle} autoFocus onChange={e => { setName(e.target.value); setErr('') }} />
        </label>
        {err && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.88rem' }}>{err}</div>}
        <div className={styles.modalActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={busy}>キャンセル</button>
          <button className={styles.saveBtn} onClick={submit} disabled={busy || !name.trim()}>{busy ? '保存中' : '保存する'}</button>
        </div>
      </div>
    </div>
  )
}

export default function WorkItemSettings({ users }) {
  const defs = useWorkItemDefs()
  const [form, setForm] = useState(null)        // { mode: 'add' } | { mode: 'edit', def }
  const [deleting, setDeleting] = useState(null) // def
  const [renaming, setRenaming] = useState(null) // group name
  const [showDeleted, setShowDeleted] = useState(false)
  const [msg, setMsg] = useState('')
  const [moving, setMoving] = useState(false)

  const active = defs.filter(d => !d.deleted)
  const deleted = defs.filter(d => d.deleted)
  const groups = groupsOf(defs)

  function flash(text) {
    setMsg(text)
    setTimeout(() => setMsg(m => (m === text ? '' : m)), 2500)
  }

  // Applies a change to the latest list on the server (another PC may have
  // changed it meanwhile) and saves it.
  async function update(change, doneText) {
    const latest = await loadWorkItemDefs()
    const next = change(latest.map(d => ({ ...d })))
    await saveWorkItemDefs(next)
    if (doneText) flash(doneText)
  }

  async function move(id, dir) {
    if (moving) return
    setMoving(true)
    try {
      await update(list => {
        const i = list.findIndex(d => d.id === id)
        // swap with the nearest visible (not deleted) neighbour
        let j = i + dir
        while (j >= 0 && j < list.length && list[j].deleted) j += dir
        if (i < 0 || j < 0 || j >= list.length) return list
        ;[list[i], list[j]] = [list[j], list[i]]
        return list
      })
    } catch { alert('保存に失敗しました') }
    setMoving(false)
  }

  async function saveForm(values) {
    if (form.mode === 'add') {
      await update(list => {
        const e = nameError(values.name, list)
        if (e) throw new Error(e)
        return [...list, { id: newWorkItemId(), ...values }]
      }, `「${values.name}」を追加しました`)
    } else {
      const id = form.def.id
      await update(list => {
        const e = nameError(values.name, list, id)
        if (e) throw new Error(e)
        return list.map(d => {
          if (d.id !== id) return d
          const { group, variant, ...rest } = d
          return { ...rest, ...values }
        })
      }, '保存しました')
    }
    setForm(null)
  }

  async function restore(id) {
    await update(list => list.map(d => (d.id === id ? { ...d, deleted: undefined } : d)), '戻しました')
    setForm(null)
  }

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1a3f6f', marginBottom: 6 }}>業務の管理</div>
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
        この順番で退勤画面・給与・出勤簿に並びます。同じグループの業務は、退勤画面で1つのカードにまとまります。
        名前を変えても過去の記録・時給はそのままです。
      </div>
      {msg && <div style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.88rem', marginBottom: 8 }}>✓ {msg}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {active.map((d, i) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: '#1a3f6f', fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{d.name}</div>
              {d.group && (
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>グループ: {d.group}（{d.variant || d.name}）</div>
              )}
            </div>
            <button style={{ ...btn, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0 || moving} onClick={() => move(d.id, -1)} aria-label="上へ">↑</button>
            <button style={{ ...btn, opacity: i === active.length - 1 ? 0.3 : 1 }} disabled={i === active.length - 1 || moving} onClick={() => move(d.id, 1)} aria-label="下へ">↓</button>
            <button style={btn} onClick={() => setForm({ mode: 'edit', def: d })}>編集</button>
            <button style={{ ...btn, color: '#d93025' }} onClick={() => setDeleting(d)}>削除</button>
          </div>
        ))}
      </div>

      <button onClick={() => setForm({ mode: 'add' })}
        style={{ height: 44, width: '100%', background: '#1a5fa8', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer' }}>
        ＋ 業務を追加
      </button>

      {groups.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.85rem', color: '#555', fontWeight: 700, marginBottom: 6 }}>グループ名の変更</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {groups.map(g => (
              <button key={g} style={btn} onClick={() => setRenaming(g)}>{g} ✎</button>
            ))}
          </div>
        </div>
      )}

      {deleted.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowDeleted(v => !v)}
            style={{ background: 'none', border: 'none', padding: 0, color: '#64748b', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
            {showDeleted ? '▼' : '▶'} 削除した業務（{deleted.length}）
          </button>
          {showDeleted && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {deleted.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', borderRadius: 10, border: '1px dashed #cbd5e1', color: '#64748b' }}>
                  <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{d.name}</span>
                  <button style={btn} onClick={async () => { try { await restore(d.id) } catch { alert('保存に失敗しました') } }}>戻す</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {form && (
        <ItemForm
          title={form.mode === 'add' ? '業務を追加' : '業務の編集'}
          initial={form.mode === 'edit' ? form.def : null}
          defs={defs}
          onSave={saveForm}
          onRestore={restore}
          onClose={() => setForm(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          def={deleting}
          users={users}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await update(list => list.map(d => (d.id === deleting.id ? { ...d, deleted: true } : d)), `「${deleting.name}」を削除しました`)
            setDeleting(null)
          }}
        />
      )}
      {renaming && (
        <RenameGroup
          group={renaming}
          defs={defs}
          onClose={() => setRenaming(null)}
          onSave={async n => {
            await update(list => list.map(d => (d.group === renaming ? { ...d, group: n } : d)), 'グループ名を変更しました')
            setRenaming(null)
          }}
        />
      )}
    </div>
  )
}
