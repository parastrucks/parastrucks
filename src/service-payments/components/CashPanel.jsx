// "Cash & cheque" — accounts records money that did not come through the HDFC
// report, and (optionally) the bill it pays, in one go.
//
// Two server calls, in order: the receipt, then the match. They are not one
// transaction, and they need not be: a receipt saved without its match is just
// a receipt in accounts' own Match list, so a failed second call is said
// plainly and nothing is lost (cloud review, 2026-10-13).
//
// The first call carries a save id. If the answer is lost and Save is pressed
// again, the server returns the FIRST receipt and its number instead of keying
// the same cash twice (migration 20261013). The id is renewed only after a
// save succeeds — never on a retry. A retry with DIFFERENT details is refused
// by the server, naming the first receipt (pre-mortem 2, G4), and the done
// screen shows what the SERVER saved, not what the form holds.
//
// A bill picked here brings its order partner, as Search does on Match: a
// cheque for parts + labour pays both in one save (pre-mortem 2, G1).

import { useEffect, useRef, useState } from 'react'
import { callEdge } from '../../lib/api'
import { useDebounce } from '../../lib/useDebounce'
import SearchPanel from './SearchPanel.jsx'
import { formatINR, rupeeStringToPaise } from '../lib/paise.js'
import { shortDay } from '../lib/signalLabels.js'
import { searchPickCandidates } from '../lib/matchQueue.js'
import { confirmPlan } from '../lib/confirmPlan.js'
import {
  CASH_MODES, CASH_LIMIT_MESSAGE, refLabel, checkCashForm, dayCashWarning, cashTargets, istDay, overCashLimit,
} from '../lib/cashReceipt.js'
import { fetchOutlets, fetchPayerCashOnDay, fetchOpenJobBills } from '../lib/paymentsData.js'

const newId = () => globalThis.crypto?.randomUUID?.() ?? null
const blank = () => ({ mode: 'cash', amount: '', day: istDay(new Date()), payer: '', ref: '', outletId: '', note: '', limitReason: '' })

/**
 * @param {object} props
 * @param {string} props.entityId
 * @param {(q:object)=>Promise<object[]>} props.search   open bills, as on Match
 * @param {()=>void} [props.onSaved]     reload the page's lists
 * @param {()=>void} [props.onGoMatch]
 * @param {(e:unknown, fallback:string)=>string} props.plainError
 */
export default function CashPanel({ entityId, search, onSaved, onGoMatch, plainError = (e, f) => e?.message || f }) {
  const [form, setForm] = useState(blank)
  const [tried, setTried] = useState(false)       // errors show after the first Save
  const [choices, setChoices] = useState([])      // the picked bill, and its whole order when it has one
  const [choiceIdx, setChoiceIdx] = useState(0)
  const [picking, setPicking] = useState(false)
  const [outlets, setOutlets] = useState([])
  const [already, setAlready] = useState(0)       // the payer's other cash that day
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const saveId = useRef(newId())

  useEffect(() => {
    let live = true
    fetchOutlets(entityId)
      .then((rows) => { if (live) setOutlets((rows || []).filter((o) => o.is_active !== false)) })
      .catch(() => { if (live) setOutlets([]) })
    return () => { live = false }
  }, [entityId])

  // The ₹2 lakh-a-day check reads what is already entered for this payer.
  const lookup = useDebounce(JSON.stringify([form.mode, form.payer.trim(), form.day]), 400)
  useEffect(() => {
    const [mode, payer, day] = JSON.parse(lookup)
    if (mode !== 'cash' || !payer) { setAlready(0); return }
    let live = true
    fetchPayerCashOnDay(entityId, payer, day)
      .then((n) => { if (live) setAlready(n) })
      .catch(() => { if (live) setAlready(0) })
    return () => { live = false }
  }, [lookup, entityId])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const { errors, row } = checkCashForm(form, { outletRequired: outlets.length > 0 })
  const shown = tried ? errors : {}
  let amountPaise = null
  try { amountPaise = rupeeStringToPaise(form.amount) } catch { amountPaise = null }
  const overLimit = overCashLimit(form.mode, amountPaise)
  // The day total is warned only below the single-receipt line; at or over it
  // the 269ST box below says more.
  const warning = overLimit ? '' : dayCashWarning(form.mode, amountPaise, already, form.payer.trim(), form.day)
  const choice = choices[choiceIdx] ?? null

  // A bill picked from search, with its order partner offered as one choice.
  // If that read fails, the bill alone is still offered — it was found.
  const pick = async (invoice) => {
    setPicking(false)
    let orderBills = []
    if (invoice.job_ref) {
      try { orderBills = await fetchOpenJobBills(entityId, invoice.job_ref) } catch { orderBills = [] }
    }
    setChoices(searchPickCandidates(invoice, orderBills, amountPaise ?? 0))
    setChoiceIdx(0)
  }

  const save = async () => {
    setTried(true)
    if (!row || saving) return
    setSaving(true)
    setError('')
    let saved
    try {
      saved = await callEdge('service-payments', 'manual_receipt', {
        entity_id: entityId, row, client_request_id: saveId.current,
      })
    } catch (e) {
      // Nothing is known to be saved; Save again re-sends the SAME save id.
      setError(plainError(e, 'Could not save it.'))
      setSaving(false)
      return
    }
    // What the server saved is the truth from here on (a repeat returns the
    // FIRST save's amount, not the form's).
    const amount = saved.amount_paise ?? row.amount_paise
    let placed = 0
    let matchError = ''
    const targets = cashTargets(choice, amount)
    if (targets.length) {
      try {
        await callEdge('service-payments', 'allocate', {
          entity_id: entityId, receipt_id: saved.receipt_id, targets,
          client_request_id: newId(), match_signal: 'manual',
        })
        placed = targets.reduce((a, t) => a + t.amount_paise, 0)
      } catch (e) {
        matchError = plainError(e, 'the bill could not be matched')
      }
    }
    saveId.current = newId()
    setDone({
      serial: saved.receipt_serial,
      replay: Boolean(saved.idempotent_replay),
      sec269st: Boolean(saved.sec_269st),
      amount,
      mode: saved.mode ?? row.mode,
      payer: saved.payer_name ?? row.payer_name,
      choice, placed, matchError,
      plan: choice && placed ? confirmPlan(choice, amount) : null,
    })
    setSaving(false)
    onSaved?.()
  }

  const again = () => {
    setForm(blank()); setChoices([]); setChoiceIdx(0); setTried(false); setError(''); setDone(null); setAlready(0)
  }

  if (done) {
    const { serial, replay, sec269st, amount, mode: m, payer, choice: c, placed, matchError, plan } = done
    const mode = CASH_MODES.find((x) => x.value === m)?.label.toLowerCase() ?? m
    let rest = ' It is in your Match list — place it on its bill there.'
    if (c && matchError) rest = ` It is in your Match list — place it on the bill there (${matchError}).`
    else if (c && placed) rest = amount > placed
      ? ` ${formatINR(amount - placed)} is left on it, in your Match list.` : ''
    return (
      <div className="pay-cash pay-match-empty" role="status">
        <p className="pay-empty-tick" aria-hidden="true">✓</p>
        <h2 className="pay-empty-title">{replay ? `Already saved as ${serial}` : `Saved as ${serial}`}</h2>
        <p className="pay-empty-sub">
          {replay ? 'Your first try went through — nothing was saved twice. ' : ''}
          {formatINR(amount)} {mode} from {payer || 'no name'}.
          {placed ? ` ${plan?.line || `${formatINR(placed)} placed on bill ${c.invoice_number}.`}` : ''}
          {rest}
          {sec269st ? ' Flagged for the GM: cash of ₹2 lakh or more.' : ''}
        </p>
        <div className="pay-cash-actions">
          <button type="button" className="pay-confirm" onClick={again}>Record another</button>
          {onGoMatch && <button type="button" className="pay-secondary" onClick={onGoMatch}>Go to Match</button>}
        </div>
      </div>
    )
  }

  if (picking && amountPaise) {
    return (
      <SearchPanel
        receipt={{ amount_paise: amountPaise, payer_name: form.payer.trim() }}
        search={search}
        initialQuery={form.amount.trim()}
        onPick={pick}
        onCancel={() => setPicking(false)}
      />
    )
  }

  const ref = refLabel(form.mode)
  const plan = choice && amountPaise ? confirmPlan(choice, amountPaise) : null
  return (
    <form className="pay-cash" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
      <h2 className="pay-ask">Record a cash or cheque payment</h2>

      <div className="form-group">
        <span className="form-label" id="pay-cash-mode">How was it paid?</span>
        <div className="seg pay-cash-mode" role="radiogroup" aria-labelledby="pay-cash-mode">
          {CASH_MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={form.mode === m.value}
                    className={`seg-btn ${form.mode === m.value ? 'active' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, mode: m.value }))}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="pay-cash-amount">Amount (₹)</label>
        <input id="pay-cash-amount" className={`form-input${shown.amount ? ' error' : ''}`} inputMode="decimal"
               autoComplete="off" value={form.amount} onChange={set('amount')} placeholder="1930" />
        {shown.amount && <p className="form-error">{shown.amount}</p>}
      </div>

      {/* Section 269ST (owner, 2026-10-15): cash already taken must reach the
          books, so it is recorded WITH a reason and flagged for the GM. */}
      {overLimit && (
        <div className="form-group">
          <p className="pay-banner pay-banner-warn" role="status">{CASH_LIMIT_MESSAGE}</p>
          <label className="form-label" htmlFor="pay-cash-limit">Why was the cash taken?</label>
          <input id="pay-cash-limit" className={`form-input${shown.limitReason ? ' error' : ''}`} autoComplete="off"
                 value={form.limitReason} onChange={set('limitReason')} />
          {shown.limitReason && <p className="form-error">{shown.limitReason}</p>}
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="pay-cash-day">Received on</label>
        <input id="pay-cash-day" type="date" className={`form-input${shown.day ? ' error' : ''}`}
               max={istDay(new Date())} value={form.day} onChange={set('day')} />
        {shown.day && <p className="form-error">{shown.day}</p>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="pay-cash-payer">Who paid?</label>
        <input id="pay-cash-payer" className={`form-input${shown.payer ? ' error' : ''}`} autoComplete="off"
               value={form.payer} onChange={set('payer')} placeholder="Name on the cheque, or at the counter" />
        {shown.payer && <p className="form-error">{shown.payer}</p>}
      </div>

      {ref && (
        <div className="form-group">
          <label className="form-label" htmlFor="pay-cash-ref">{ref}</label>
          <input id="pay-cash-ref" className={`form-input${shown.ref ? ' error' : ''}`} autoComplete="off"
                 value={form.ref} onChange={set('ref')} />
          {shown.ref && <p className="form-error">{shown.ref}</p>}
        </div>
      )}

      {outlets.length > 0 && (
        <div className="form-group">
          <label className="form-label" htmlFor="pay-cash-outlet">Outlet</label>
          <select id="pay-cash-outlet" className={`form-select${shown.outlet ? ' error' : ''}`}
                  value={form.outletId} onChange={set('outletId')}>
            <option value="">Pick the outlet</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.label || o.city}</option>)}
          </select>
          {shown.outlet && <p className="form-error">{shown.outlet}</p>}
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="pay-cash-note">Note (optional)</label>
        <input id="pay-cash-note" className="form-input" autoComplete="off" value={form.note} onChange={set('note')} />
      </div>

      {/* The bill is optional: without it the payment waits in Match. */}
      <div className="form-group">
        <span className="form-label" id="pay-cash-bill-label">Which bill? (optional)</span>
        {choice ? (
          <div className="pay-cash-bill">
            {/* A bill with an open partner on the same job: this bill, or the
                whole order — closer to the money first (pre-mortem 2, G1). */}
            {choices.length > 1 && (
              <div className="seg pay-cash-choice" role="radiogroup" aria-labelledby="pay-cash-bill-label">
                {choices.map((c, i) => (
                  <button key={c.id} type="button" role="radio" aria-checked={i === choiceIdx}
                          className={`seg-btn ${i === choiceIdx ? 'active' : ''}`} onClick={() => setChoiceIdx(i)}>
                    {c.kind === 'job' ? `The whole order (${c.member_count} bills)` : 'This bill only'}
                  </button>
                ))}
              </div>
            )}
            <p className="pay-cash-bill-what">
              <strong>{formatINR(choice.amount_paise)}</strong> owed · {choice.customer_name || 'No name on the bill'}
            </p>
            <p className="pay-candidate-ref">
              Bill {choice.invoice_number}{choice.date ? ` · billed ${shortDay(choice.date)}` : ''}
              {choice.vehicle_reg_no ? ` · ${choice.vehicle_reg_no}` : ''}
            </p>
            {plan?.line && <p className="pay-candidate-plan">{plan.line}</p>}
            <div className="pay-cash-bill-actions">
              <button type="button" className="pay-secondary" onClick={() => setPicking(true)} disabled={!amountPaise}>Change</button>
              <button type="button" className="pay-secondary" onClick={() => { setChoices([]); setChoiceIdx(0) }}>Remove</button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="pay-secondary" onClick={() => setPicking(true)} disabled={!amountPaise}>
              Pick the bill it pays
            </button>
            {!amountPaise && <p className="pay-hint">Enter the amount first.</p>}
          </>
        )}
      </div>

      {warning && <p className="pay-banner pay-banner-warn" role="status">{warning}</p>}
      {error && <p className="pay-banner pay-banner-warn" role="alert">{error}</p>}

      <button type="submit" className="pay-confirm pay-cash-save" disabled={saving}>
        {saving ? 'Saving…' : overLimit ? 'Record anyway' : warning ? 'Save anyway' : 'Save'}
      </button>
    </form>
  )
}
