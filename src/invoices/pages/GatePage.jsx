// The gate screen (/gate) — credit release step 2. For Security guards (one login each).
// Type the vehicle number → green "MAY GO" (released on credit, by whom, until when) or red
// "HOLD". No amounts, no customer (owner, 2026-10-24). The Edge Function answers and logs
// every check; a guard reads nothing from the database directly.
import { useRef, useState } from 'react'
import { callEdge } from '../../lib/api'
import { istTime } from '../lib/releases'
import '../invoices.css'

export default function GatePage() {
  const input = useRef(null)
  const [regn, setRegn] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)       // the answer, or { error }

  async function check(e) {
    e.preventDefault()
    const typed = regn.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (typed.length < 6) { setRes({ error: 'Type the full vehicle number, e.g. GJ01AB1234.' }); return }
    setBusy(true); setRes(null)
    try { setRes(await callEdge('gate-invoices', 'gateCheck', { regn_no: typed })) }
    catch (err) { setRes({ error: err.message }) }
    finally { setBusy(false) }
  }
  function again() { setRegn(''); setRes(null); input.current?.focus() }

  return (
    <div className="gate-page">
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Security</div>
          <h1 className="page-head-title">Gate check<span className="period-accent">.</span></h1>
          <div className="page-head-sub">For vehicles leaving on credit. Paid vehicles: follow the accounts gate pass as before.</div>
        </div>
      </div>

      <form className="gate-form" onSubmit={check}>
        <input id="gate-regn" ref={input} className="gate-input" value={regn} autoFocus aria-label="Vehicle number"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={16}
          placeholder="GJ01AB1234" onChange={(e) => { setRegn(e.target.value); setRes(null) }} />
        <button className="btn btn-primary gate-check" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
      </form>

      {res?.error && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{res.error}</div>}

      {res?.result === 'may_go' && (
        <div className="gate-result go" role="status">
          <div className="gate-word">MAY GO</div>
          <div className="gate-plate">{res.regn_no}</div>
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
      {res && !res.error && <button className="btn btn-secondary gate-check" style={{ width: '100%', marginTop: 12 }} onClick={again}>Check another vehicle</button>}
      {!res && <p className="gate-hint">Spaces and dashes don’t matter.</p>}
    </div>
  )
}
