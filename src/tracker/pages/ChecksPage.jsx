// Phase 10 — Yes/No checks for the team (owner, 2026-10-30: "Each check … should have the chassis number against
// the value you want me to check … The checking should be a yes/no answer method. Yes if the value that you are
// showing is correct. If No, give option to record the correct value which would then be approved by me").
// One card per question: the chassis, the value asked about, a few figures beside it. Anyone with the tracker
// answers; only the owner (admin) approves a No — approval writes the correct value into the truck (its History
// shows it). Works on a phone: no grid here.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { checkAnswer, checkReview, checksList } from '../lib/trackerApi'
import { changedSince, counts, labelOf, parseCorrection, readValue, stateOf } from '../lib/checkItems'
import { COLUMN_BY_KEY } from '../lib/columnMeta'
import '../checks.css'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const FILTERS = [['open', 'To answer'], ['waiting', 'Waiting for approval'], ['yes', 'Answered Yes'], ['approved', 'Approved'], ['all', 'All']]

export default function ChecksPage() {
  const { profile } = useAuth()
  const isOwner = profile?.permission_level === 'admin'
  const [checks, setChecks] = useState(null)
  const [error, setError] = useState('')
  const [set, setSet] = useState('')
  const [filter, setFilter] = useState('open')
  const [q, setQ] = useState('')

  const load = () => checksList().then((c) => { setChecks(c); setError('') }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const sets = useMemo(() => {
    const m = new Map()
    for (const c of checks ?? []) { if (!m.has(c.check_set)) m.set(c.check_set, []); m.get(c.check_set).push(c) }
    return m
  }, [checks])
  const current = set && sets.has(set) ? set : [...sets.keys()][0] ?? ''
  const inSet = sets.get(current) ?? []
  const n = counts(inSet)
  const needle = q.replace(/\s+/g, '').toUpperCase()
  const shown = inSet.filter((c) => (filter === 'all' || stateOf(c) === filter) && (!needle || c.chassis_no.toUpperCase().includes(needle)))

  // the server's answer replaces the card in place
  const put = (item) => setChecks((cs) => cs.map((c) => (c.id === item.id
    ? { ...c, ...item, answered_by_name: item.answered_by === profile?.id ? profile?.full_name : c.answered_by_name,
        reviewed_by_name: item.reviewed_by === profile?.id ? profile?.full_name : (item.reviewed_by ? c.reviewed_by_name : null) }
    : c)))

  return (
    <div className="page ck-page">
      <div className="page-head">
        <h1 className="page-head-title">Checks<span className="period-accent">.</span></h1>
        <p className="page-head-sub">
          Is the value shown right for this truck? <b>Yes</b> if it is. <b>No</b> if it is not — then type the right value.
          The owner approves it before it goes into the tracker.
        </p>
      </div>

      {error && <div className="form-error" role="alert">Could not load the checks: {error}</div>}
      {!checks && !error && <div className="ck-loading"><span className="spinner" /> Loading…</div>}
      {checks && checks.length === 0 && <p className="ck-empty">No checks yet.</p>}

      {checks && checks.length > 0 && (
        <>
          <label className="ck-set">
            <span>Check</span>
            <select className="form-select" value={current} onChange={(e) => { setSet(e.target.value); setFilter('open') }}>
              {[...sets.entries()].map(([name, cs]) => (
                <option key={name} value={name}>{name} — {counts(cs).open} to answer</option>
              ))}
            </select>
          </label>

          <div className="ck-filters" role="tablist">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k}
                className={`ck-filter${filter === k ? ' ck-filter--on' : ''}`} onClick={() => setFilter(k)}>
                {label} <span className="ck-filter-n">{n[k]}</span>
              </button>
            ))}
          </div>

          <input className="form-input ck-search" inputMode="text" placeholder="Find a chassis (any part of it)"
            value={q} onChange={(e) => setQ(e.target.value)} />

          {shown.length === 0 && <p className="ck-empty">{filter === 'open' && n.open === 0 ? 'Every truck in this check is answered.' : 'Nothing here.'}</p>}
          <div className="ck-list">
            {shown.map((c) => <CheckCard key={c.id} c={c} isOwner={isOwner} onSaved={put} />)}
          </div>
        </>
      )}
    </div>
  )
}

function CheckCard({ c, isOwner, onSaved }) {
  const state = stateOf(c)
  const col = COLUMN_BY_KEY[c.column_key]
  const oneOf = col?.spec?.oneOf
  const [mode, setMode] = useState(null)        // 'no' while typing the correct value · 'send_back' while typing why
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const run = async (fn) => {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) { setMsg(e.message) }
    setBusy(false)
  }
  const answer = (a) => run(async () => {
    let correct = null
    if (a === 'no') {
      const p = parseCorrection(c.column_key, text)
      if (p.error) { setMsg(p.error); return }
      correct = p.value
    }
    const r = await checkAnswer(c.id, a, correct, note)
    if (!r.ok) { setMsg(r.reason === 'approved' ? 'Already approved — it cannot be changed now.' : 'Not saved.'); return }
    onSaved(r.item); setMode(null); setText(''); setNote('')
  })
  const review = (decision) => run(async () => {
    const r = await checkReview(c.id, decision, decision === 'send_back' ? note : null)
    if (!r.ok) {
      setMsg(r.reason === 'changed'
        ? `Not written: the tracker now holds ${readValue(c.column_key, r.actual)} (changed since this check was made). Send it back, or correct it in the tracker.`
        : r.reason === 'approved' ? 'Already approved.' : 'Not saved.')
      return
    }
    onSaved(r.item); setMode(null); setNote('')
  })
  const startNo = () => { setMode('no'); setText(''); setNote(''); setMsg('') }

  return (
    <div className={`ck-card ck-card--${state}`}>
      <div className="ck-chassis">{c.chassis_no}</div>
      <div className="ck-q">{c.question}</div>
      <div className="ck-value">
        <span className="ck-value-label">{labelOf(c.column_key)}</span>
        <span className="ck-value-v">{readValue(c.column_key, c.shown_value)}</span>
      </div>
      {Array.isArray(c.context) && c.context.length > 0 && (
        <dl className="ck-context">
          {c.context.filter((x) => x.key !== c.column_key).map((x) => (
            <div key={x.key}><dt>{labelOf(x.key)}</dt><dd>{readValue(x.key, x.value)}</dd></div>
          ))}
        </dl>
      )}
      {changedSince(c) && state !== 'approved' && (
        <p className="ck-warn">Changed in the tracker since this check was made — it now holds {readValue(c.column_key, c.current_value)}.</p>
      )}

      {c.review === 'sent_back' && (
        <p className="ck-sent">Sent back by {c.reviewed_by_name ?? 'the owner'}{c.review_note ? `: “${c.review_note}”` : ''} — please answer again.</p>
      )}

      {state === 'yes' && <p className="ck-done">✓ Yes — {c.answered_by_name ?? ''}, {when(c.answered_at)}{c.answer_note ? ` · “${c.answer_note}”` : ''}</p>}
      {(state === 'waiting' || state === 'approved') && (
        <p className={state === 'approved' ? 'ck-done' : 'ck-no'}>
          ✗ No — {c.correct_value != null ? <>right value <b>{readValue(c.column_key, c.correct_value)}</b></> : 'no value given'}
          {' '}· {c.answered_by_name ?? ''}, {when(c.answered_at)}{c.answer_note ? ` · “${c.answer_note}”` : ''}
        </p>
      )}
      {state === 'waiting' && !isOwner && <p className="ck-wait">Waiting for the owner’s approval.</p>}
      {state === 'approved' && (
        <p className="ck-done">Approved by {c.reviewed_by_name ?? 'the owner'}, {when(c.reviewed_at)} — {c.written ? 'written into the tracker.' : 'nothing to write.'}</p>
      )}

      {/* answering: open, or a Yes / waiting No that may still be changed */}
      {mode === null && state === 'open' && (
        <div className="ck-buttons">
          <button type="button" className="btn btn-primary ck-yes" disabled={busy} onClick={() => answer('yes')}>Yes, it is right</button>
          <button type="button" className="btn btn-secondary ck-nob" disabled={busy} onClick={startNo}>No</button>
        </div>
      )}
      {mode === 'no' && (
        <div className="ck-form">
          <label className="form-label">The right {labelOf(c.column_key)}
            {oneOf ? (
              <select className="form-select" value={text} onChange={(e) => setText(e.target.value)}>
                <option value="">(I do not know)</option>
                {oneOf.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input className="form-input" autoFocus value={text} onChange={(e) => setText(e.target.value)}
                inputMode={col?.spec?.type === 'numeric' || col?.spec?.type === 'integer' ? 'decimal' : 'text'}
                placeholder={col?.spec?.type === 'date' ? 'dd/mm/yyyy' : 'Leave empty if you do not know'} />
            )}
          </label>
          <label className="form-label">Note (optional)
            <input className="form-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Where you checked it, or why" />
          </label>
          <div className="ck-buttons">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => answer('no')}>Save — No</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setMode(null); setMsg('') }}>Cancel</button>
          </div>
        </div>
      )}

      {/* the owner's approval of a No */}
      {mode === null && state === 'waiting' && isOwner && (
        <div className="ck-buttons">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => review('approve')}>
            {c.correct_value != null ? `Approve — write ${readValue(c.column_key, c.correct_value)}` : 'Approve (nothing to write)'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setMode('send_back'); setNote(''); setMsg('') }}>Send back</button>
        </div>
      )}
      {mode === 'send_back' && (
        <div className="ck-form">
          <label className="form-label">Why (the person sees this)
            <input className="form-input" autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="ck-buttons">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => review('send_back')}>Send back</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      {mode === null && (state === 'yes' || state === 'waiting') && (
        <div className="ck-change-row">
          <span>Change the answer:</span>
          {state !== 'yes' && <button type="button" className="ck-link" disabled={busy} onClick={() => answer('yes')}>Yes, it is right</button>}
          <button type="button" className="ck-link" disabled={busy} onClick={startNo}>{state === 'yes' ? 'No' : 'another value'}</button>
        </div>
      )}

      {msg && <p className="form-error" role="alert">{msg}</p>}
    </div>
  )
}
