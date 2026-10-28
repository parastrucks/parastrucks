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
import { istTime, isApprover, mayDecideFor, RELEASE_HOURS, releaseState, revealForm } from '../lib/releases'
import { alertStatus, turnAlertsOff, turnAlertsOn } from '../lib/pushAlerts'
import { keepSignedInForAlerts } from '../../lib/supabase'

const SELECT = `id, entity_id, document_id, regn_no, status, request_note, requested_at, requested_by, decided_at,
  decision_note, valid_until, card,
  requester:users!gate_releases_requested_by_fkey(full_name), decider:users!gate_releases_decided_by_fkey(full_name),
  gate_documents(doc_no, customer_name, sap_customer_code, total_paise, gate_bills(bill_no, amount_paise, terms))`

function StateBadge({ rel }) {
  const s = releaseState(rel)
  if (s === 'waiting') return <span className="badge badge-amber">Waiting for GM</span>
  if (s === 'released') return <span className="badge badge-green">Released until {istTime(rel.valid_until)}</span>
  if (s === 'expired') return <span className="badge badge-gray">Release ended {istTime(rel.valid_until)}</span>
  if (s === 'held') return <span className="badge badge-red">Held</span>
  return <span className="badge badge-gray">Withdrawn</span>
}

// What this customer already took on credit through this tool. No "paid" status exists yet
// (step 3), so this is a count of earlier releases — NOT what they owe in Busy. Said so.
function Earlier({ rel }) {
  const [e, setE] = useState(null)
  const code = rel.gate_documents?.sap_customer_code
  useEffect(() => {
    let off = false
    supabase.from('gate_releases')
      .select('id, decided_at, gate_documents!inner(sap_customer_code, total_paise)')
      .eq('entity_id', rel.entity_id).eq('status', 'approved').neq('id', rel.id)
      .eq('gate_documents.sap_customer_code', code)
      .then(({ data }) => {
        if (off || !data) return
        setE({ n: data.length, total: data.reduce((s, x) => s + Number(x.gate_documents.total_paise), 0),
          last: data.map((x) => x.decided_at).sort().at(-1) })
      })
    return () => { off = true }
  }, [rel.id, rel.entity_id, code])
  if (!e) return null
  return (
    <div className="rel-earlier">
      {e.n === 0
        ? 'No earlier credit release for this customer in the portal.'
        : `Earlier credit releases in the portal: ${e.n} · ${formatRupees(e.total)} · last ${istTime(e.last)}.`}
      <span className="rel-earlier-note"> Not their Busy balance — paid status comes later.</span>
    </div>
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

export default function ReleasesPanel({ who, focusId, onChanged }) {
  const toast = useToast()
  const [rels, setRels] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [holdFor, setHoldFor] = useState(null)   // { id, note }

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
                  {r.status === 'asked' && <Earlier rel={r} />}
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
                        {holdFor?.id !== r.id && <button className="btn btn-sm btn-secondary" disabled={busy === r.id} onClick={() => setHoldFor({ id: r.id, note: '' })}>Hold</button>}
                      </>
                    )}
                    {(r.requested_by === who.id || who.permission_level === 'admin') && !decide && (
                      <button className="btn btn-sm btn-secondary" disabled={busy === r.id}
                        onClick={() => act(r, 'withdrawRelease', {}, 'Request withdrawn.')}>Withdraw</button>
                    )}
                  </div>
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
