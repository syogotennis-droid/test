import React, { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { getUsers } from '../lib/db'
import styles from './QRGeneratorScreen.module.css'

function QRImage({ value, size = 200 }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(url => setSrc(url))
  }, [value, size])
  return src
    ? <img src={src} alt={value} width={size} height={size} />
    : <div style={{ width: size, height: size, background: '#eee' }} />
}

const CARD_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: sans-serif; background: #fff; }
  .card {
    width: 91mm; height: 55mm;
    position: relative;
    display: inline-flex; flex-direction: column;
    align-items: center; justify-content: center;
    border: 0.3mm solid #ccc;
    vertical-align: top;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .id { position: absolute; top: 4mm; left: 5mm; font-size: 10pt; font-weight: 700; color: #1a5fa8; letter-spacing: 0.04em; }
  .qr { width: 34mm; height: 34mm; }
  .name { margin-top: 1mm; font-size: 20pt; font-weight: 900; color: #1a5fa8; letter-spacing: 0.06em; }
`

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function cardHtml(user) {
  const qrUrl = await QRCode.toDataURL(user.id, { width: 400, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
  return `<div class="card">
  <div class="id">${esc(user.id)}</div>
  <img class="qr" src="${qrUrl}" />
  <div class="name">${esc(user.name)}</div>
</div>`
}

async function openPrintWindow(users) {
  if (users.length === 0) return
  // open before the async QR generation so the browser treats it as a click popup
  const win = window.open('', '_blank', 'width=700,height=500')
  if (!win) { alert('印刷画面を開けませんでした。ブラウザのポップアップを許可してください。'); return }
  win.document.write('<p style="font-family:sans-serif;padding:16px">印刷の準備中…</p>')
  const cards = await Promise.all(users.map(cardHtml))
  win.document.open()
  win.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QRカード</title>
<style>
  @page { margin: 8mm; }
  body { margin: 0; }
  .wrap { display: grid; grid-template-columns: repeat(auto-fill, 91mm); gap: 3mm; }
  ${CARD_CSS}
</style>
</head><body>
<div class="wrap">${cards.join('')}</div>
</body></html>`)
  win.document.close()
  const imgs = [...win.document.images]
  await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r })))
  win.focus()
  win.print()
  win.close()
}

export default function QRGeneratorScreen({ onBack }) {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [query, setQuery] = useState('')

  useEffect(() => {
    getUsers().then(u => setUsers([...u].sort((a, b) => a.id.localeCompare(b.id))))
  }, [])

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () => users.filter(u => !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)),
    [users, q]
  )
  const selectedUsers = users.filter(u => selected.has(u.id))
  const allVisibleSelected = visible.length > 0 && visible.every(u => selected.has(u.id))

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach(u => next.delete(u.id))
      else visible.forEach(u => next.add(u.id))
      return next
    })
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="戻る">←</button>
        <h2>QRコード印刷</h2>
        <button className={styles.allPrintBtn} onClick={() => openPrintWindow(users)} disabled={users.length === 0}>
          全員を印刷
        </button>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="氏名・IDで絞り込み"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className={styles.toolBtn} onClick={toggleAllVisible} disabled={visible.length === 0}>
          {allVisibleSelected ? '表示中の選択を外す' : (q ? '表示中を全て選択' : '全選択')}
        </button>
        {selected.size > 0 && (
          <button className={styles.toolBtn} onClick={() => setSelected(new Set())}>選択解除</button>
        )}
        <button
          className={styles.printBtn}
          onClick={() => openPrintWindow(selectedUsers)}
          disabled={selectedUsers.length === 0}
        >
          {selectedUsers.length > 0 ? `${selectedUsers.length}名を印刷` : '印刷'}
        </button>
      </div>

      <div className={styles.grid}>
        {visible.length === 0 && <div className={styles.empty}>該当なし</div>}
        {visible.map(user => {
          const isSel = selected.has(user.id)
          return (
            <div key={user.id} className={styles.cardWrap}>
              <button
                type="button"
                className={[styles.card, isSel ? styles.cardSelected : ''].join(' ')}
                onClick={() => toggle(user.id)}
                aria-pressed={isSel}
              >
                <span className={[styles.check, isSel ? styles.checkOn : ''].join(' ')} aria-hidden="true">{isSel ? '✓' : ''}</span>
                <QRImage value={user.id} size={160} />
                <span className={styles.name}>{user.name}</span>
                <span className={styles.userId}>{user.id}</span>
              </button>
              <button className={styles.singlePrintBtn} onClick={() => openPrintWindow([user])}>
                印刷
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
