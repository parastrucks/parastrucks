// Phase 10 — the monthly AL Balance Sheet check (owner, 2026-10-23: "keep the Excel file … once the balance
// sheet is finalized, it can be sent over to the portal by an upload. You can point out any discrepancies").
// A side panel like History: upload the month's final sheet, then the list of what disagrees — each line goes
// to its truck, or is marked right with a reason (remembered; it never comes back). Nothing in the tracker is
// changed by anything here; the team's file stays the record of the AL account.
import { useEffect, useState } from 'react'
import { alReview, alSettle, alUpload, findAnywhere } from '../lib/trackerApi'
import { readAlWorkbook, sheetTotals, monthLabel } from '../lib/alSheet'
import { groupIssues } from '../lib/alChecks'
import { fyOfTruck } from '../lib/bookYear'

// −₹1,42,05,424, not ₹-1,42,05,424
const rupees = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`)
const label = (mk) => (mk ? monthLabel(`${mk}-01`) : '')
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// grid: the TrackerGrid handle · bookRows(): the rows the page holds · fyStart · onScope(next, goToId) · say · onClose
export default function AlSheetPanel({ grid, bookRows, fyStart, onScope, say, onClose }) {
  const [review, setReview] = useState(null)      // { months, issues, explained } once loaded
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)          // the chosen file, read: { name, month, lines, totals, warnings, sha, exists? }
  const [busy, setBusy] = useState('')
  const [settling, setSettling] = useState(null)  // { check, subject, reason }
  const [showSettled, setShowSettled] = useState(false)
  const [open, setOpen] = useState({})            // check key → expanded

  const load = () => alReview().then((r) => { setReview(r); setError('') }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const choose = async (f) => {
    if (!f) return
    setFile(null); setBusy('reading')
    try {
      const buf = await f.arrayBuffer()
      const XLSX = await import('xlsx')   // only when a file is chosen
      const read = readAlWorkbook(XLSX, XLSX.read(buf, { type: 'array', cellFormula: true }), f.name)
      setFile({ name: f.name, ...read, totals: sheetTotals(read.lines), sha: await sha256(buf) })
    } catch (e) { say(`Could not read ${f.name}: ${e.message}`, 'warn') }
    setBusy('')
  }

  const upload = async (replace = false) => {
    setBusy('uploading')
    try {
      const r = await alUpload({ month: file.month, file_name: file.name, sha256: file.sha, replace, lines: file.lines })
      if (!r.ok && r.reason === 'exists') { setFile({ ...file, exists: r }); setBusy(''); return }
      say(r.replayed ? `${monthLabel(file.month)} — this file was already uploaded.`
        : `${monthLabel(file.month)} uploaded — ${r.lines} lines${r.replaced ? ' (the earlier file is kept, marked replaced)' : ''}.`)
      setFile(null)
      await load()
    } catch (e) { say(`Not uploaded: ${e.message}`, 'warn') }
    setBusy('')
  }

  const goTo = async (i) => {
    if (!i.unit_id) return
    if (bookRows().some((r) => r.id === i.unit_id)) { grid.current?.goTo(i.unit_id, 'chassis_no'); return }
    // not in this view: open the truck's year, then go to it
    try {
      const h = (await findAnywhere(i.chassis)).find((x) => x.id === i.unit_id)
      if (!h) { say(`${i.chassis} was not found.`, 'warn'); return }
      const y = fyOfTruck(h)
      onScope?.(y === null || y === fyStart ? { scope: 'working' } : { scope: 'year', year: y }, i.unit_id)
    } catch (e) { say(`Could not open ${i.chassis}: ${e.message}`, 'warn') }
  }

  const settle = async () => {
    const { check, subject, reason } = settling
    if (!reason.trim()) return
    try {
      await alSettle(check, subject, reason.trim())
      setSettling(null)
      await load()
    } catch (e) { say(`Not saved: ${e.message}`, 'warn') }
  }

  const groups = groupIssues(review?.issues)
  const openCount = groups.reduce((n, g) => n + g.open.length, 0)
  const settledCount = groups.reduce((n, g) => n + g.settled.length, 0)

  return (
    <aside className="trk-history trk-al" aria-label="AL Balance Sheet check">
      <div className="trk-history-head">
        <strong>AL Balance Sheet check</strong>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="trk-al-upload">
        <label className="btn btn-sm btn-secondary trk-al-file">
          Upload a month’s final sheet…
          <input type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {busy === 'reading' && <span className="trk-history-empty"><span className="spinner" /> Reading…</span>}
        {file && (
          <div className="trk-al-preview">
            <div><strong>{monthLabel(file.month)}</strong> · {file.lines.length} lines · {file.totals.credits} owed · {file.totals.payments} paid</div>
            <div className={file.totals.ties ? 'trk-al-ok' : 'trk-al-bad'}>
              Net Balance {rupees(file.totals.net)} {file.totals.ties ? '= paid − owed ✓' : '≠ paid − owed'}
            </div>
            {file.warnings.map((w) => <div key={w} className="trk-al-bad">{w}</div>)}
            {file.exists ? (
              <>
                <div className="trk-al-bad">{monthLabel(file.month)} is already uploaded — “{file.exists.file_name}”, {when(file.exists.uploaded_at)}.</div>
                <div className="trk-pop-actions">
                  <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => upload(true)}>Replace it with this file</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setFile(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="trk-pop-actions">
                <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => upload(false)}>
                  {busy === 'uploading' ? 'Uploading…' : `Upload ${monthLabel(file.month)}`}</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setFile(null)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="trk-history-empty">Could not load: {error}</p>}
      {!review && !error && <p className="trk-history-empty"><span className="spinner" /> Loading…</p>}
      {review && (
        <>
          <div className="trk-al-months">
            {review.months.length
              ? review.months.map((m) => (
                <span key={m.month} className={`trk-al-month ${m.net !== null && Math.abs(m.net - (m.paid - m.owed)) < 1 ? '' : 'trk-al-month--bad'}`}
                  title={`${m.file_name} · ${m.lines} lines · uploaded ${when(m.uploaded_at)}${m.uploaded_by ? ` by ${m.uploaded_by}` : ''}`}>
                  {label(m.month)}</span>))
              : <span className="trk-history-empty">No month uploaded yet.</span>}
          </div>
          {review.months.length > 0 && (
            <p className="trk-al-summary">
              {openCount ? `${openCount} to look at` : 'Nothing to look at'}
              {review.explained?.gst ? ` · ${review.explained.gst} CTDs explained by the GST date (not listed)` : ''}
              {settledCount > 0 && (
                <> · <button type="button" className="trk-al-link" onClick={() => setShowSettled(!showSettled)}>
                  {showSettled ? 'hide' : 'show'} {settledCount} marked right</button></>
              )}
            </p>
          )}
          <div className="trk-al-list">
            {groups.map((g) => {
              const items = showSettled ? [...g.open, ...g.settled] : g.open
              if (!items.length) return null
              const isOpen = open[g.check.key] ?? false
              return (
                <section key={g.check.key} className="trk-al-group">
                  <button type="button" className="trk-al-group-head" aria-expanded={isOpen}
                    onClick={() => setOpen({ ...open, [g.check.key]: !isOpen })}>
                    <span>{isOpen ? '▾' : '▸'} {g.check.title}</span><span className="trk-al-count">{g.open.length}</span>
                  </button>
                  {isOpen && (
                    <>
                      {g.check.hint && <p className="trk-al-hint">{g.check.hint}</p>}
                      <ol className="trk-history-list">
                        {items.map((i) => {
                          const mine = settling && settling.check === i.check && settling.subject === i.subject
                          return (
                            <li key={`${i.check}|${i.subject}|${i.row_no ?? ''}`}>
                              <div className="trk-history-meta">
                                {label(i.month)}{i.row_no ? ` · row ${i.row_no}` : ''}{i.chassis ? ` · ${i.chassis}` : ''}
                              </div>
                              <div>{i.detail}</div>
                              {i.settled && <div className="trk-al-settled">Marked right: “{i.settled.reason}” — {i.settled.by ?? 'someone'}, {when(i.settled.at)}</div>}
                              {!i.settled && !mine && (
                                <div className="trk-al-actions">
                                  {i.unit_id && <button type="button" className="btn btn-sm btn-secondary" onClick={() => goTo(i)}>Go to truck</button>}
                                  <button type="button" className="btn btn-sm btn-ghost"
                                    onClick={() => setSettling({ check: i.check, subject: i.subject, reason: '' })}>It is right…</button>
                                </div>
                              )}
                              {mine && (
                                <div className="trk-al-actions">
                                  <input autoFocus value={settling.reason} maxLength={500} placeholder="Why it is right, e.g. AL corrected it in their books"
                                    onChange={(e) => setSettling({ ...settling, reason: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === 'Enter') settle(); if (e.key === 'Escape') setSettling(null) }} />
                                  <button type="button" className="btn btn-sm btn-primary" disabled={!settling.reason.trim()} onClick={settle}>Save</button>
                                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSettling(null)}>Cancel</button>
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ol>
                    </>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}
