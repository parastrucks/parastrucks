// The Match screen — ONE receipt at a time, authored for a thumb.
//
// Mobile web is the cornerstone of this feature (owner), and that inverts the
// usual portal layout: this is NOT a list beside a detail pane that collapses on
// small screens. It is a single card, a shortlist under it, and a confirm bar
// the thumb can reach without moving the hand. The desktop view is the
// enhancement, not the source.
//
// Purely presentational: every value arrives as a prop and every action is a
// callback, so the whole screen can be rendered and asserted without a browser,
// a database or a network. The container that fetches receipts and calls the
// Edge Function sits above this.

import { useEffect, useRef, useState } from 'react'
import { formatINR } from '../lib/paise.js'
import { cardReasons, billLine, BOUNCE_REASONS, notServiceKindsFor } from '../lib/signalLabels.js'
import { REFRESHING, confirmPlan } from '../lib/matchQueue.js'

/**
 * @param {object}   props
 * @param {object|null} props.receipt        the receipt being matched, or null when done
 * @param {object}   props.result            output of matchCandidates()
 * @param {number}   props.remaining         how many receipts are still unmatched today
 * @param {number}   props.doneToday
 * @param {boolean}  props.feedIsStale
 * @param {string}   [props.feedAsOf]        when invoices were last imported
 * @param {string|null} props.pendingId      candidate id currently being written
 * @param {(c:object)=>void} props.onConfirm
 * @param {()=>void} props.onSkip
 * @param {(kind:string)=>void} [props.onNotService]  absent = this person may not
 *        classify (accounts decides); the exit still shows and says who does
 * @param {(awaiting:boolean)=>void} [props.onHoldAdvance]  "Bill not made yet":
 *        true = wait for the bill (again = "bill still not made"), false = back to
 *        today's list. Absent = hidden (this person may not, for this mode).
 * @param {()=>void} [props.onSearch]       absent = hidden
 * @param {string|null} [props.initialSelectedId]  a bill the person already
 *        chose (in search) arrives picked; Confirm is still their tap
 * @param {import('react').ReactNode} [props.footer]  rendered last, inside the
 *        screen — so it keeps the room the confirm bar leaves (the "Matched
 *        today" fold)
 *
 * An action is offered only when its callback is supplied, so the container —
 * which knows who is signed in and what the server will accept — decides. A
 * button that the server refuses is worse than no button: it teaches people
 * the tool is broken.
 */
export default function MatchScreen({
  receipt,
  result = { candidates: [], refuse_to_rank: false, confident: false, reason: '', searched: 0 },
  remaining = 0,
  doneToday = 0,
  feedIsStale = false,
  feedAsOf = null,
  pendingId = null,
  onConfirm,
  onSkip,
  onNotService,
  onHoldAdvance,
  onSearch,
  initialSelectedId = null,
  footer = null,
}) {
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)
  // A not-service reason is PICKED, like a bill, and acted on from the bar —
  // one tap on a reason used to set the money aside at once (R4-9).
  const [asideKind, setAsideKind] = useState(null)
  // What a way-out opens renders below all three buttons — at 360px that is
  // under the confirm bar, and the tap looked like it did nothing (R4-15).
  const openedRef = useRef(null)
  const confirmRef = useRef(null)
  useEffect(() => {
    if (menuOpen || waitOpen) openedRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [menuOpen, waitOpen])

  if (!receipt) {
    return (
      <div className="pay-match pay-match-empty">
        <p className="pay-empty-tick" aria-hidden="true">✓</p>
        <h2 className="pay-empty-title">Nothing left to match</h2>
        <p className="pay-empty-sub">
          {doneToday > 0
            ? `${doneToday} payment${doneToday === 1 ? '' : 's'} matched. New payments show here after accounts loads them.`
            : 'New payments show here after accounts loads them.'}
        </p>
        {footer}
      </div>
    )
  }

  const { candidates, refuse_to_rank: unordered } = result
  // The matcher's "no bill within 3 days" is wrong for a payment waiting for
  // its bill: it looks up to today. Say what is actually true for it.
  // While bills are out of date the banner says so once; the matcher's own
  // sentence repeated it 400px lower in other words (R4-10).
  const reason = feedIsStale
    ? ''
    : receipt.awaiting_invoice && candidates.length === 0
      ? 'No bill yet. It stays waiting until a new bill that may be its bill is loaded.'
      : result.reason
  const selected = candidates.find((c) => c.id === selectedId) || null
  const busy = pendingId !== null
  // What will actually be placed: never more than the payment holds, never more
  // than the bill owes. A button reading "Confirm ₹1,930" that places ₹1,500 is
  // a lie told at the exact moment someone is deciding about money.
  // …and what happens to the rest: the same split Confirm sends (R4-6, R4-12).
  const plan = selected ? confirmPlan(selected, receipt.amount_paise) : null
  const kinds = notServiceKindsFor(receipt.amount_paise)
  const aside = onNotService ? kinds.find((k) => k.value === asideKind) ?? null : null
  const closeReasons = () => { setMenuOpen(false); setAsideKind(null) }

  return (
    <div className="pay-match">
      {/* The staleness brake. A confident one-tap confirm against an invoice
          feed that has not caught up is an error amplifier: the bill that would
          have matched may simply not be imported yet. */}
      {/* role=status, not alert: it is true every morning until the report
          lands and would interrupt a screen reader on every payment (R4-26). */}
      {feedIsStale && (
        <p className="pay-banner pay-banner-warn" role="status">
          <strong>Today’s bills are not loaded yet{feedAsOf ? ` (last loaded ${feedAsOf})` : ''}.</strong>{' '}
          You can look, but confirming is off until accounts loads them.
        </p>
      )}

      <p className="pay-daystatus" role="status">
        <strong>{remaining}</strong> left to match{doneToday > 0 ? ` · ${doneToday} done` : ''}
      </p>

      {/* ── the receipt ─────────────────────────────────────────────── */}
      <section className="pay-receipt" aria-label="Payment received">
        <p className="pay-receipt-amount">{formatINR(receipt.amount_paise)}</p>
        {receipt.partly_matched && receipt.face_paise > receipt.amount_paise && (
          // "left of" read as a position (R4-6): say what the big number is.
          <p className="pay-receipt-part">
            still to match. {formatINR(receipt.face_paise - receipt.amount_paise)} of this {formatINR(receipt.face_paise)} payment is already matched.
          </p>
        )}
        <p className="pay-receipt-payer">{receipt.payer_name || 'No name on the payment'}</p>
        <p className="pay-receipt-meta">
          {sourceLabel(receipt.source)} · {timeLabel(receipt.received_at)}
        </p>
        {receipt.awaiting_invoice && (
          <p className="pay-receipt-waiting">
            {receipt.back_for_new_bill
              ? 'Was waiting. A new bill may be its bill — check below.'
              : `Waiting for its bill${receipt.awaiting_since ? ` since ${dayLabel(receipt.awaiting_since)}` : ''}`}
          </p>
        )}
        {receipt.payer_remark && (
          <p className="pay-receipt-note">“{receipt.payer_remark}”</p>
        )}
      </section>

      {/* ── the shortlist ───────────────────────────────────────────── */}
      <h2 className="pay-ask">
        {candidates.length === 0
          ? 'No bill matches this payment'
          : unordered
            ? 'Which bill is this?'
            : 'Which bill is this?'}
      </h2>

      {reason && (
        <p className={`pay-hint${unordered ? ' pay-hint-unordered' : ''}`} role="status">{reason}</p>
      )}

      <ul className="pay-candidates">
        {candidates.map((c) => {
          const isSel = c.id === selectedId
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`pay-candidate${isSel ? ' is-selected' : ''}`}
                aria-pressed={isSel}
                disabled={busy}
                onClick={() => { setSelectedId(isSel ? null : c.id); closeReasons() }}
                // At a PC, Enter on the picked card goes to Confirm instead of
                // un-picking it (red team 4, R4-23). Taps are unchanged.
                onKeyDown={(e) => {
                  if (isSel && e.key === 'Enter') { e.preventDefault(); confirmRef.current?.focus() }
                }}
              >
                <span className="pay-candidate-top">
                  <span className="pay-candidate-amount">{formatINR(c.amount_paise)}</span>
                  {c.kind === 'job' && (
                    <span className="pay-chip pay-chip-job">{c.member_count} bills, one job</span>
                  )}
                </span>
                {/* The SAP customer code stays beside the name — two customers
                    with one name are told apart by it (owner, plan v4). */}
                <span className="pay-candidate-name">
                  {c.customer_name || 'No name on the bill'}
                  {c.sap_customer_code && <span className="pay-candidate-code"> · {c.sap_customer_code}</span>}
                </span>
                {/* Date and truck, where the bill number was: what tells five
                    ₹1,930 bills apart at a counter (R4-5). */}
                {billLine(c) && <span className="pay-candidate-when">{billLine(c)}</span>}
                <span className="pay-candidate-why">{cardReasons(c).face.join('. ')}</span>
                {/* The bill number, once picked — to check against the paper. */}
                {isSel && <span className="pay-candidate-ref">Bill {c.invoice_number || c.label}</span>}
                {/* What Confirm will do — the picked card only (R4-6, R4-12). */}
                {isSel && plan?.line && <span className="pay-candidate-plan">{plan.line}</span>}
                {isSel && cardReasons(c).more.length > 0 && (
                  <span className="pay-candidate-all">
                    {cardReasons(c).more.map((label) => (
                      <span className="pay-chip" key={label}>{label}</span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {/* ── the thumb zone ──────────────────────────────────────────── */}
      {/* Sticky, in the bottom third, ≥44px. No optimistic UI: on money the
          row stays pending until the server answers, because a confirm that
          looks done and silently failed is worse than a slow one.
          Placed right after the bills in the markup — it is fixed, so this
          moves nothing on screen; it puts Confirm next in the Tab order and
          in a screen reader's reading, not after the ways out (R4-23).
          aria-live: "Saving…" and "Updating the list…" are announced (R4-26). */}
      <div className="pay-confirmbar" aria-live="polite">
        <button
          type="button"
          className="pay-confirm"
          ref={confirmRef}
          // Setting money aside needs no bills, so stale bills do not stop it.
          disabled={busy || (aside ? false : (!selected || feedIsStale))}
          onClick={() => {
            if (aside) { const kind = aside.value; closeReasons(); onNotService(kind) }
            else if (selected) onConfirm?.(selected)
          }}
        >
          {confirmBarLabel({
            busy, refreshing: pendingId === REFRESHING, feedIsStale, aside,
            amountPaise: receipt.amount_paise, button: plan?.button ?? null, hasCandidates: candidates.length > 0,
          })}
        </button>
        <button type="button" className="pay-skip" onClick={onSkip} disabled={busy}>
          Skip for now
        </button>
      </div>

      {/* ── the ways out, always visible, never buried in a menu ─────── */}
      <div className="pay-escapes">
        {onSearch && (
          <button type="button" className="pay-secondary" onClick={onSearch} disabled={busy}>
            Search bills
          </button>
        )}
        {onHoldAdvance && (
          <button type="button" className="pay-secondary" aria-expanded={waitOpen}
                  onClick={() => { closeReasons(); setWaitOpen((v) => !v) }} disabled={busy}>
            {receipt.awaiting_invoice ? 'Bill still not made' : 'Bill not made yet'}
          </button>
        )}
        <button
          type="button"
          className="pay-secondary"
          aria-expanded={menuOpen}
          onClick={() => { setWaitOpen(false); setAsideKind(null); setMenuOpen((v) => !v) }}
          disabled={busy}
        >
          Not a service payment
        </button>
      </div>

      {/* One tap to open, one to confirm: the payment is about to leave today's
          list, so say where it goes and when it comes back. */}
      {waitOpen && onHoldAdvance && (
        <div className="pay-wait" role="group" aria-label="Wait for its bill" ref={openedRef}>
          <p className="pay-hint">
            {receipt.awaiting_invoice
              ? 'Keep waiting? It comes back only when a new bill is loaded.'
              : 'Wait for the bill? This payment leaves today’s list. It comes back when a new bill that may be its bill is loaded.'}
          </p>
          <div className="pay-escapes">
            <button type="button" className="pay-secondary" disabled={busy}
                    onClick={() => { setWaitOpen(false); onHoldAdvance(true) }}>
              {receipt.awaiting_invoice ? 'Yes, keep waiting' : 'Yes, wait'}
            </button>
            {receipt.awaiting_invoice ? (
              <button type="button" className="pay-secondary" disabled={busy}
                      onClick={() => { setWaitOpen(false); onHoldAdvance(false) }}>
                Stop waiting, put it back in today’s list
              </button>
            ) : (
              <button type="button" className="pay-secondary" onClick={() => setWaitOpen(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Kept visible even for someone who may not classify: a person who
          cannot find this exit picks a bill instead, and that is a wrong
          entry on a real customer's ledger. They are told who decides. */}
      {menuOpen && !onNotService && (
        <p className="pay-hint pay-denied-note" role="status" ref={openedRef}>
          Only accounts can mark this. Tap Skip — accounts will see it.
        </p>
      )}

      {menuOpen && onNotService && (
        <ul className="pay-reasons" aria-label="What kind of payment is this?" ref={openedRef}>
          {kinds.map((k) => (
            <li key={k.value}>
              <button
                type="button"
                className={`pay-reason${k.value === asideKind ? ' is-picked' : ''}`}
                aria-pressed={k.value === asideKind}
                disabled={busy}
                // Picks; the bar does it. A picked bill is let go — one action at a time.
                onClick={() => { setSelectedId(null); setAsideKind(k.value === asideKind ? null : k.value) }}
              >
                {k.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {footer}
    </div>
  )
}

/**
 * What the confirm bar's button says. Exported so the words can be checked
 * without a browser. Stale bills win over a picked bill — "Confirm ₹1,930" on
 * a dead button reads as broken (R4-10) — but not over a picked not-service
 * reason, which needs no bills.
 */
export function confirmBarLabel({ busy, refreshing, feedIsStale, aside, amountPaise, button, hasCandidates }) {
  if (busy) return refreshing ? 'Updating the list…' : 'Saving…'
  if (aside) return `Set aside ${formatINR(amountPaise)} — not service`
  if (feedIsStale) return 'Confirm is off — bills not loaded yet'
  if (button) return button
  return hasCandidates ? 'Pick a bill above' : 'Nothing to confirm'
}

function sourceLabel(source) {
  return { hdfc: 'Paid by QR', gpay: 'Google Pay', bharatpe: 'BharatPe', manual: 'Entered by hand',
           bank_statement: 'Bank statement', opening_balance: 'Opening balance' }[source] || source
}

/** "12 Oct" — the day a payment started waiting; the hour adds nothing. */
function dayLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(d)
}

function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Asia/Kolkata is the only clock this business runs on.
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}
