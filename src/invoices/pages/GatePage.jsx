// The gate screen (/gate) — credit release step 2. For Security guards (one login each).
// A LIST of the vehicles that may go now and those waiting for the GM, with a search box
// (owner, 2026-10-27: "a list with a search option is easier for the guards"). Each row:
// plate, customer name, until when — no amounts, no notes. Tap a row (or type a number and
// press Check) → the big green "RELEASE" or red "HOLD" — the only two words a guard has to
// read, on the cards and the list headings alike (owner, 2026-10-27). The Edge Function answers and logs
// every check; a guard reads nothing from the database directly.
import { useCallback, useEffect, useRef, useState } from 'react'
import { callEdge } from '../../lib/api'
import { istTime } from '../lib/releases'
import '../invoices.css'

const REFRESH_MS = 60 * 1000
const plateOf = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export default function GatePage() {
  const input = useRef(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)       // the answer to one check, or { error }
  const [list, setList] = useState(null)     // { released, waiting, as_of }
  const [listErr, setListErr] = useState('')

  const loadList = useCallback(async () => {
    try { setList(await callEdge('gate-invoices', 'gateList', {})); setListErr('') }
    catch (err) { setListErr(err.message) }
  }, [])

  // Fresh on open, every minute while the screen is in front, and when the phone wakes.
  useEffect(() => {
    loadList()
    const tick = setInterval(() => { if (document.visibilityState === 'visible') loadList() }, REFRESH_MS)
    const wake = () => { if (document.visibilityState === 'visible') loadList() }
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', wake) }
  }, [loadList])

  const typed = plateOf(query)
  const words = query.trim().toLowerCase()
  const matches = (row) => !words
    || (typed && row.regn_no.includes(typed))
    || (row.customer ?? '').toLowerCase().includes(words)
  const released = (list?.released ?? []).filter(matches)
  const waiting = (list?.waiting ?? []).filter(matches)

  async function check(regn) {
    setBusy(true); setRes(null)
    try { setRes(await callEdge('gate-invoices', 'gateCheck', { regn_no: regn })) }
    catch (err) { setRes({ error: err.message }) }
    finally { setBusy(false); loadList() }
  }
  function submit(e) {
    e.preventDefault()
    // Part of a number that leaves exactly one vehicle in the list → that vehicle.
    const only = [...released, ...waiting]
    if (typed.length < 6 && words && only.length === 1) return check(only[0].regn_no)
    if (typed.length < 6) { setRes({ error: 'Type the full vehicle number, e.g. GJ01AB1234 — or tap the vehicle in the list.' }); return }
    check(typed)
  }
  function back() { setQuery(''); setRes(null); input.current?.focus() }

  return (
    <div className="gate-page">
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Security</div>
          <h1 className="page-head-title">Gate check<span className="period-accent">.</span></h1>
          <div className="page-head-sub">For vehicles leaving on credit. Paid vehicles: follow the accounts gate pass as before.</div>
        </div>
      </div>

      <form className="gate-form" onSubmit={submit}>
        <input id="gate-regn" ref={input} className="gate-input" value={query} aria-label="Search vehicle number or customer"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
          placeholder="Search number" onChange={(e) => { setQuery(e.target.value); setRes(null) }} />
        <button className="btn btn-primary gate-check" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
      </form>

      {res?.error && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{res.error}</div>}

      {res?.result === 'may_go' && (
        <div className="gate-result go" role="status">
          <div className="gate-word">RELEASE</div>
          <div className="gate-plate">{res.regn_no}</div>
          {res.customer && <div className="gate-customer">{res.customer}</div>}
          <div className="gate-detail">
            Released on credit{res.decided_by ? ` by ${res.decided_by}` : ''}{res.decided_at ? ` at ${istTime(res.decided_at)}` : ''}.
            <br />Valid until {istTime(res.valid_until)}.
          </div>
        </div>
      )}
      {res?.result === 'hold' && (
        <div className="gate-result hold" role="alert">
          <div className="gate-word">HOLD</div>
          <div className="gate-plate">{res.regn_no}</div>
          <div className="gate-detail">
            {res.waiting ? 'Asked — waiting for the GM’s answer. Check again in a few minutes.' : 'Not released on credit.'}
            <br />If accounts gave a paid gate pass, follow that.
          </div>
        </div>
      )}
      {res && !res.error && <button className="btn btn-secondary gate-check" style={{ width: '100%', marginTop: 12 }} onClick={back}>Back to the list</button>}

      {!res && (
        <>
          {listErr && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{listErr}</div>}
          {!list && !listErr && <p className="gate-hint">Loading the list…</p>}
          {list && (
            <>
              <GateSection title="Release" tone="go" rows={released} busy={busy} onPick={check}
                line={(r) => `Until ${istTime(r.valid_until)}${r.decided_by ? ` · by ${r.decided_by}` : ''}`}
                empty={words ? null : 'No vehicle is released on credit right now.'} />
              <GateSection title="Hold" tone="wait" rows={waiting} busy={busy} onPick={check}
                line={(r) => `Waiting for the GM · asked ${istTime(r.requested_at)}`} empty={null} />
              {words && released.length === 0 && waiting.length === 0 && (
                <div className="gate-nomatch" role="status">
                  <strong>Not in the list — HOLD.</strong> If accounts gave a paid gate pass, follow that.
                </div>
              )}
              <p className="gate-hint">
                Type part of the number, e.g. the last 4 digits. Updated {istTime(list.as_of)} ·{' '}
                <button type="button" className="gate-refresh" onClick={loadList}>Refresh</button>
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

function GateSection({ title, tone, rows, busy, onPick, line, empty }) {
  if (rows.length === 0 && !empty) return null
  return (
    <section className="gate-section">
      <h2 className={`gate-section-title ${tone}`}>{title} <span className="gate-count">{rows.length}</span></h2>
      {rows.length === 0 && <p className="gate-hint" style={{ textAlign: 'left' }}>{empty}</p>}
      {rows.map((r) => (
        <button key={r.id} type="button" className={`gate-row ${tone}`} disabled={busy} onClick={() => onPick(r.regn_no)}>
          <span className="gate-row-plate">{r.regn_no}</span>
          {r.customer && <span className="gate-row-customer">{r.customer}</span>}
          <span className="gate-row-line">{line(r)}</span>
        </button>
      ))}
    </section>
  )
}
