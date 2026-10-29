// Credit releases (step 2) — the list on the Invoices & Payments page's "Credit releases" tab.
// Everyone with the page sees each request and its answer; ONLY the Service GM of that
// company and the admin get Approve / Hold (owner, 2026-10-26 — enforced by the Edge
// Function; the buttons follow the same authority.ts). Reads under RLS; writes via the EF.
import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { callEdge } from '../../lib/api'
import { formatRupees } from '../lib/sapInvoice'
import {
  customerSummary, dayLabel, istTime, istToday, isApprover, lastPromiseDay, loadReleased, mayDecideFor,
  RELEASE_HOURS, releaseState, revealForm,
} from '../lib/releases'
import { alertStatus, turnAlertsOff, turnAlertsOn } from '../lib/pushAlerts'
import { keepSignedInForAlerts } from '../../lib/supabase'

const SELECT = `id, entity_id, document_id, regn_no, status, request_note, requested_at, requested_by, decided_at,
  decision_note, valid_until, card, promised_by,
  requester:users!gate_releases_requested_by_fkey(full_name), decider:users!gate_releases_decided_by_fkey(full_name),
  responsible:users!gate_releases_responsible_id_fkey(full_name),
  gate_documents(doc_no, customer_name, sap_customer_code, total_paise, gate_bills(bill_no, amount_paise, terms))`

function StateBadge({ rel }) {
  const s = releaseState(rel)
  if (s === 'waiting') return <span className="badge badge-amber">Waiting for GM</span>
  if (s === 'released') return <span className="badge badge-green">Released until {istTime(rel.valid_until)}</span>
  if (s === 'expired') return <span className="badge badge-gray">Release ended {istTime(rel.valid_until)}</span>
  if (s === 'held') return <span className="badge badge-red">Held</span>
  return <span className="badge badge-gray">Withdrawn</span>
}

// What this customer already took on credit through this tool, and — from matching (step 3) —
// what of it is still unpaid. Only invoices released through the portal: NOT their Busy balance,
// and said so. Someone who cannot read the matching tool gets the count only, never a guess.
function Earlier({ rel, seesPaid }) {
  const [e, setE] = useState(null)
  const code = rel.gate_documents?.sap_customer_code
  useEffect(() => {
    let off = false
    loadReleased(supabase, { entityId: rel.entity_id, sapCode: code, excludeDocumentId: rel.document_id, canSeePayments: seesPaid })
      .then((rows) => { if (!off) setE({ rows, s: customerSummary(rows, istToday()) }) })
      .catch(() => { if (!off) setE({ error: true }) })
    return () => { off = true }
  }, [rel.entity_id, rel.document_id, code, seesPaid])
  if (!e) return null
  const note = <span className="rel-earlier-note"> Only what was released through the portal — not their Busy balance.</span>
  if (e.error) return <div className="rel-earlier">Could not read this customer’s earlier releases.</div>
  const s = e.s
  if (s.invoices === 0) return <div className="rel-earlier">Nothing released on credit to this customer before.{note}</div>
  const last = e.rows.map((x) => x.released_at).sort().at(-1)
  if (!seesPaid) {
    return (
      <div className="rel-earlier">
        Released on credit before: {s.invoices} · {formatRupees(e.rows.reduce((t, x) => t + x.total_paise, 0))} · last {istTime(last)}.{note}
      </div>
    )
  }
  return (
    <div className="rel-earlier">
      Released on credit before: {s.invoices}
      {s.unpaid > 0
        ? <> · <strong>{s.unpaid} not paid, {formatRupees(s.due_paise)} due</strong> (oldest {istTime(s.oldest_unpaid_at)})</>
        : s.unknown === 0 && <> · all paid</>}
      {s.unknown > 0 && <> · {s.unknown} can’t tell yet</>}
      {s.broken > 0 && <> · <strong className="fu-broken">{s.broken} promise{s.broken === 1 ? '' : 's'} broken</strong></>}.
      {note}
    </div>
  )
}

// The staff a promise can name: active people of the invoice's company (and the owner), not guards.
function useStaff(entityId, open) {
  const [staff, setStaff] = useState([])
  useEffect(() => {
    if (!open) return
    let off = false
    supabase.from('users').select('id, full_name, departments(code)')
      .eq('is_active', true).or(`entity_id.eq.${entityId},permission_level.eq.admin`).order('full_name')
      .then(({ data }) => { if (!off) setStaff((data ?? []).filter((u) => u.departments?.code !== 'security')) })
    return () => { off = true }
  }, [entityId, open])
  return staff
}

function PromiseForm({ rel, busy, onApprove, onCancel }) {
  const toast = useToast()
  const today = istToday()
  const [day, setDay] = useState('')
  const [who, setWho] = useState('')
  const staff = useStaff(rel.entity_id, true)
  return (
    <form className="inv-send rel-promise" ref={revealForm} onSubmit={(e) => {
      e.preventDefault()
      if (!day && !who) { toast.error('Pick the day they will pay by, or who is responsible — or just Approve.'); return }
      onApprove({ promised_by: day || null, responsible_id: who || null })
    }}>
      <label>Pays by
        <input className="form-input" type="date" min={today} max={lastPromiseDay(today)} value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>Responsible
        <select className="form-input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">— nobody named —</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      </label>
      <button className="btn btn-sm rel-approve" type="submit" disabled={busy}>{busy ? 'Approving…' : `Approve ${rel.regn_no}`}</button>
      <button className="btn btn-sm btn-secondary" type="button" onClick={onCancel}>Cancel</button>
    </form>
  )
}

function AlertsLine() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    alertStatus().then((st) => { if (st === 'on') keepSignedInForAlerts(true); setS(st) }).catch(() => setS('unsupported'))
  }, [])
  if (!s) return null
  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); toast.success(okMsg); setS(await alertStatus()) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="rel-alerts">
      <Icon name="info" size={15} />
      {s === 'on' && <><span>Phone alerts are <strong>on</strong> for this device, and it stays signed in.</span>
        <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => run(turnAlertsOff, 'Alerts turned off on this device.')}>Turn off</button></>}
      {s === 'off' && <><span>Get a phone alert when a release is asked.</span>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(turnAlertsOn, 'Alerts are on for this device.')}>Turn on alerts</button></>}
      {s === 'blocked' && <span>Alerts are blocked for this site — allow notifications in the browser or phone settings.</span>}
      {s === 'needs-home-screen' && <span>On iPhone: Share → <strong>Add to Home Screen</strong>, open the portal from there, then turn alerts on.</span>}
      {s === 'unsupported' && <span>This browser cannot show phone alerts. Use Chrome on Android, or the Home Screen app on iPhone.</span>}
    </div>
  )
}

export default function ReleasesPanel({ who, focusId, onChanged, seesPaid = false }) {
  const toast = useToast()
  const [rels, setRels] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [holdFor, setHoldFor] = useState(null)   // { id, note }
  const [promiseFor, setPromiseFor] = useState(null)   // release id with the promise form open
  const today = istToday()

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('gate_releases').select(SELECT).order('requested_at', { ascending: false }).limit(40)
    if (error) { setErr(error.message); return }
    setErr(null)
    // Waiting first (oldest first — it has waited longest), then everything else newest first.
    const waiting = data.filter((r) => r.status === 'asked').reverse()
    setRels([...waiting, ...data.filter((r) => r.status !== 'asked')])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!focusId || !rels) return
    document.getElementById(`rel-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, rels])

  async function act(rel, action, payload, okMsg) {
    setBusy(rel.id)
    try {
      await callEdge('gate-invoices', action, { release_id: rel.id, ...payload })
      toast.success(okMsg)
      setHoldFor(null)
      setPromiseFor(null)
    } catch (e) { toast.error(e.message) }
    finally { setBusy(null); await load(); onChanged?.() }
  }

  return (
    <div className="rel-panel">
      {isApprover(who) && <AlertsLine />}
      {err && <div className="form-error" role="alert">Could not load the releases: {err}</div>}
      {!rels && !err && <div className="inv-empty"><span className="spinner" /></div>}
      {rels && rels.length === 0 && <div className="inv-empty">No release has been asked yet. Ask from an invoice on the Invoices tab.</div>}
      {rels && rels.length > 0 && (
        <ul className="inv-list">
          {rels.map((r) => {
            const d = r.gate_documents
            const decide = r.status === 'asked' && mayDecideFor(who, r.entity_id)
            return (
              <li key={r.id} id={`rel-${r.id}`} className={`inv-row rel-row${r.id === focusId ? ' rel-focus' : ''}`}>
                <div className="inv-row-main">
                  <div className="rel-plate">{r.regn_no}</div>
                  <div className="inv-row-name">{d?.customer_name}</div>
                  <div className="inv-meta">SAP {d?.sap_customer_code} · {d?.doc_no}</div>
                  <div className="inv-meta">Asked by {r.requester?.full_name ?? '—'} · {istTime(r.requested_at)}</div>
                  {r.request_note && <div className="rel-note">“{r.request_note}”</div>}
                  {r.decided_at && r.status !== 'asked' && (
                    <div className="inv-meta">{r.status === 'withdrawn' ? 'Withdrawn' : r.status === 'held' ? 'Held' : 'Approved'} by {r.decider?.full_name ?? '—'} · {istTime(r.decided_at)}</div>
                  )}
                  {r.decision_note && <div className={r.status === 'held' ? 'inv-fail' : 'rel-note'}>{r.status === 'held' ? 'Reason: ' : ''}{r.decision_note}</div>}
                  {r.status === 'approved' && (r.promised_by || r.responsible) && (
                    <div className="rel-note">
                      Promise: {r.promised_by && <>pays by {dayLabel(r.promised_by, today)}</>}
                      {r.promised_by && r.responsible && ' · '}
                      {r.responsible && <>{r.responsible.full_name} responsible</>}
                    </div>
                  )}
                  {r.status === 'asked' && <Earlier rel={r} seesPaid={seesPaid} />}
                </div>
                <div className="inv-row-side">
                  <div className="inv-amount">{formatRupees(Number(d?.total_paise ?? 0))}</div>
                  <StateBadge rel={r} />
                </div>
                {r.status === 'asked' && (
                  <div className="inv-row-actions">
                    {decide && (
                      <>
                        <button className="btn btn-sm rel-approve" disabled={busy === r.id}
                          onClick={() => act(r, 'decideRelease', { decision: 'approve' }, `${r.regn_no} released for ${RELEASE_HOURS} hours.`)}>
                          <Icon name="check" size={14} /> Approve
                        </button>
                        {holdFor?.id !== r.id && <button className="btn btn-sm btn-secondary" disabled={busy === r.id} onClick={() => { setPromiseFor(null); setHoldFor({ id: r.id, note: '' }) }}>Hold</button>}
                        {/* About 1 approval in 10 carried a promise in the WhatsApp group: Approve stays
                            one tap, the promise is one link away (owner, 2026-10-29). */}
                        {promiseFor !== r.id && <button type="button" className="rel-link" disabled={busy === r.id} onClick={() => { setHoldFor(null); setPromiseFor(r.id) }}>Approve with a promise</button>}
                      </>
                    )}
                    {(r.requested_by === who.id || who.permission_level === 'admin') && !decide && (
                      <button className="btn btn-sm btn-secondary" disabled={busy === r.id}
                        onClick={() => act(r, 'withdrawRelease', {}, 'Request withdrawn.')}>Withdraw</button>
                    )}
                  </div>
                )}
                {promiseFor === r.id && (
                  <PromiseForm rel={r} busy={busy === r.id} onCancel={() => setPromiseFor(null)}
                    onApprove={(promise) => act(r, 'decideRelease', { decision: 'approve', ...promise },
                      `${r.regn_no} released for ${RELEASE_HOURS} hours, with the promise.`)} />
                )}
                {holdFor?.id === r.id && (
                  <form className="inv-send" ref={revealForm} onSubmit={(e) => {
                    e.preventDefault()
                    if (!holdFor.note.trim()) { toast.error('Say why it is held — the service team sees it.'); return }
                    act(r, 'decideRelease', { decision: 'hold', note: holdFor.note }, `${r.regn_no} held.`)
                  }}>
                    <input className="form-input" maxLength={300} autoFocus aria-label="Why is it held?"
                      placeholder="Why is it held? e.g. clear the old outstanding first" value={holdFor.note}
                      onChange={(e) => setHoldFor({ ...holdFor, note: e.target.value })} />
                    <button className="btn btn-sm btn-danger" type="submit" disabled={busy === r.id}>{busy === r.id ? 'Holding…' : `Hold ${r.regn_no}`}</button>
                    <button className="btn btn-sm btn-secondary" type="button" onClick={() => setHoldFor(null)}>Cancel</button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
