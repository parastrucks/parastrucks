// Follow-up (credit release step 3) — invoices released on credit that are not yet paid.
// Broken promises first, then promises still to come, then the rest (oldest first): the order is
// paid.ts → followUpOrder, the same rule the Edge Function uses. Paid comes ONLY from matching
// payments to bills on the Match tab (owner, 2026-10-29) — there is no "mark paid" here.
// Shown only to people who can read the matching tool (the page decides); reads under RLS.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatRupees } from '../lib/sapInvoice'
import { dayLabel, followUpOrder, istTime, istToday, loadReleased, promiseBroken } from '../lib/releases'

const WHY = {
  not_loaded: 'a bill is not in the Billing Report yet',
  before_matching: 'billed before matching began',
  parked: 'a bill is set aside in matching',
}

/** What matching says about one released invoice — words a service advisor reads at a glance. */
export function PaidBadge({ paid }) {
  if (paid.state === 'paid') return <span className="badge badge-green">Paid</span>
  if (paid.state === 'part') return <span className="badge badge-amber">Part paid · {formatRupees(paid.due_paise)} due</span>
  if (paid.state === 'unpaid') return <span className="badge badge-red">Unpaid · {formatRupees(paid.due_paise)}</span>
  return <span className="badge badge-gray">Can’t tell yet</span>
}

export default function FollowUpPanel() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const today = istToday()

  const load = useCallback(async () => {
    try {
      const all = await loadReleased(supabase, { canSeePayments: true })
      setRows(followUpOrder(all, istToday()))
      setErr(null)
    } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="form-error" role="alert">Could not load the follow-up list: {err}</div>
  if (!rows) return <div className="inv-empty"><span className="spinner" /></div>
  const broken = rows.filter((r) => promiseBroken(r.promised_by, r.paid.state, today)).length

  return (
    <div className="rel-panel">
      <p className="fu-summary">
        {rows.length === 0
          ? 'Every invoice released on credit is paid.'
          : <>{rows.length} released on credit and not paid{broken > 0 && <> · <strong className="fu-broken">{broken} promise{broken === 1 ? '' : 's'} broken</strong></>}.</>}
        <span className="rel-earlier-note"> Paid comes from matching payments to bills on the Match tab.</span>
      </p>
      {rows.length > 0 && (
        <ul className="inv-list">
          {rows.map((r) => {
            const isBroken = promiseBroken(r.promised_by, r.paid.state, today)
            return (
              <li key={r.document_id} className={`inv-row rel-row${isBroken ? ' fu-row-broken' : ''}`}>
                <div className="inv-row-main">
                  <div className="rel-plate">{r.regn_no}</div>
                  <div className="inv-row-name">{r.customer_name}</div>
                  <div className="inv-meta">SAP {r.sap_customer_code} · {r.doc_no}</div>
                  <div className="inv-meta">Released {istTime(r.released_at)} by {r.approved_by_name ?? '—'}</div>
                  {(r.promised_by || r.responsible_name) && (
                    <div className={isBroken ? 'inv-fail' : 'rel-note'}>
                      {r.promised_by && <>Promised by {dayLabel(r.promised_by, today)}{isBroken && ' — not paid'}</>}
                      {r.promised_by && r.responsible_name && ' · '}
                      {r.responsible_name && <>{r.responsible_name} responsible</>}
                    </div>
                  )}
                  {r.paid.state === 'unknown' && (
                    <div className="inv-meta">Can’t tell yet: {[...new Set(r.paid.unknown.map((u) => WHY[u.why]))].join('; ')}.</div>
                  )}
                  {r.paid.amount_differs.length > 0 && (
                    <div className="inv-meta">The Billing Report shows a different amount for {r.paid.amount_differs.join(', ')}.</div>
                  )}
                </div>
                <div className="inv-row-side">
                  <div className="inv-amount">{formatRupees(r.total_paise)}</div>
                  <PaidBadge paid={r.paid} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
