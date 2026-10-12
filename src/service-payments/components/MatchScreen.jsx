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

import { useState } from 'react'
import { formatINR } from '../lib/paise.js'
import { cardReasons, BOUNCE_REASONS, NOT_SERVICE_KINDS } from '../lib/signalLabels.js'
import { REFRESHING } from '../lib/matchQueue.js'

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
 * @param {(awaiting:boolean)=>void} [props.onHoldAdvance]  "Bill not raised yet":
 *        true = wait for the bill (again = "still not raised"), false = back to
 *        today's list. Absent = hidden (this person may not, for this mode).
 * @param {()=>void} [props.onSearch]       absent = hidden
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
}) {
  const [selectedId, setSelectedId] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [waitOpen, setWaitOpen] = useState(false)

  if (!receipt) {
    return (
      <div className="pay-match pay-match-empty">
        <p className="pay-empty-tick" aria-hidden="true">✓</p>
        <h2 className="pay-empty-title">Nothing left to match</h2>
        <p className="pay-empty-sub">
          {doneToday > 0
            ? `${doneToday} payment${doneToday === 1 ? '' : 's'} matched. New payments appear here when the day's file is imported.`
            : 'New payments appear here when the day’s file is imported.'}
        </p>
      </div>
    )
  }

  const { candidates, refuse_to_rank: unordered } = result
  // The matcher's "no bill within 3 days" is wrong for a payment waiting for
  // its bill: it looks up to today. Say what is actually true for it.
  const reason = receipt.awaiting_invoice && candidates.length === 0 && !feedIsStale
    ? 'No bill for it yet. It stays waiting and comes back by itself when one is imported.'
    : result.reason
  const selected = candidates.find((c) => c.id === selectedId) || null
  const busy = pendingId !== null
  // What will actually be placed: never more than the payment holds, never more
  // than the bill owes. A button reading "Confirm ₹1,930" that places ₹1,500 is
  // a lie told at the exact moment someone is deciding about money.
  const placing = selected ? Math.min(selected.amount_paise, receipt.amount_paise) : 0
  const partPay = selected && receipt.amount_paise < selected.amount_paise

  return (
    <div className="pay-match">
      {/* The staleness brake. A confident one-tap confirm against an invoice
          feed that has not caught up is an error amplifier: the bill that would
          have matched may simply not be imported yet. */}
      {feedIsStale && (
        <p className="pay-banner pay-banner-warn" role="alert">
          <strong>Bills are out of date{feedAsOf ? ` (last imported ${feedAsOf})` : ''}.</strong>{' '}
          You can still look, but confirming is off until today’s bills land.
        </p>
      )}

      <p className="pay-daystatus" role="status">
        <strong>{remaining}</strong> left to match{doneToday > 0 ? ` · ${doneToday} done` : ''}
      </p>

      {/* ── the receipt ─────────────────────────────────────────────── */}
      <section className="pay-receipt" aria-label="Payment received">
        <p className="pay-receipt-amount">{formatINR(receipt.amount_paise)}</p>
        {receipt.partly_matched && receipt.face_paise > receipt.amount_paise && (
          <p className="pay-receipt-part">left of {formatINR(receipt.face_paise)} — the rest is already matched</p>
        )}
        <p className="pay-receipt-payer">{receipt.payer_name || 'No name given'}</p>
        <p className="pay-receipt-meta">
          {sourceLabel(receipt.source)} · {timeLabel(receipt.received_at)}
        </p>
        {receipt.awaiting_invoice && (
          <p className="pay-receipt-waiting">
            {receipt.back_for_new_bill
              ? 'Was waiting for its bill — a bill imported since could be it'
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
                onClick={() => setSelectedId(isSel ? null : c.id)}
              >
                <span className="pay-candidate-top">
                  <span className="pay-candidate-amount">{formatINR(c.amount_paise)}</span>
                  {c.kind === 'job' && (
                    <span className="pay-chip pay-chip-job">{c.member_count} bills</span>
                  )}
                </span>
                <span className="pay-candidate-name">{c.customer_name || 'Unnamed customer'}</span>
                <span className="pay-candidate-ref">
                  {c.label}
                  {c.sap_customer_code ? ` · ${c.sap_customer_code}` : ''}
                </span>
                <span className="pay-candidate-why">{cardReasons(c).face.join(' · ')}</span>
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

      {/* ── the ways out, always visible, never buried in a menu ─────── */}
      <div className="pay-escapes">
        {onSearch && (
          <button type="button" className="pay-secondary" onClick={onSearch} disabled={busy}>
            Search all bills
          </button>
        )}
        {onHoldAdvance && (
          <button type="button" className="pay-secondary" aria-expanded={waitOpen}
                  onClick={() => { setMenuOpen(false); setWaitOpen((v) => !v) }} disabled={busy}>
            {receipt.awaiting_invoice ? 'Still not raised' : 'Bill not raised yet'}
          </button>
        )}
        <button
          type="button"
          className="pay-secondary"
          aria-expanded={menuOpen}
          onClick={() => { setWaitOpen(false); setMenuOpen((v) => !v) }}
          disabled={busy}
        >
          Not a service payment
        </button>
      </div>

      {/* One tap to open, one to confirm: the payment is about to leave today's
          list, so say where it goes and when it comes back. */}
      {waitOpen && onHoldAdvance && (
        <div className="pay-wait" role="group" aria-label="Wait for its bill">
          <p className="pay-hint">
            {receipt.awaiting_invoice
              ? 'Still not raised? It goes back to waiting, and returns only for a bill imported after now.'
              : 'Wait for its bill? It leaves today’s list and comes back by itself when a newly imported bill could be its own.'}
          </p>
          <div className="pay-escapes">
            <button type="button" className="pay-secondary" disabled={busy}
                    onClick={() => { setWaitOpen(false); onHoldAdvance(true) }}>
              {receipt.awaiting_invoice ? 'Yes, keep waiting' : 'Yes, wait for the bill'}
            </button>
            {receipt.awaiting_invoice ? (
              <button type="button" className="pay-secondary" disabled={busy}
                      onClick={() => { setWaitOpen(false); onHoldAdvance(false) }}>
                Not waiting — keep it in today’s list
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
        <p className="pay-hint" role="status">
          Accounts decides what is not a service payment. Skip it for now — it
          stays in the queue for them.
        </p>
      )}

      {menuOpen && onNotService && (
        <ul className="pay-reasons" aria-label="What kind of payment is this?">
          {NOT_SERVICE_KINDS.map((k) => (
            <li key={k.value}>
              <button
                type="button"
                className="pay-reason"
                disabled={busy}
                onClick={() => { setMenuOpen(false); onNotService(k.value) }}
              >
                {k.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── the thumb zone ──────────────────────────────────────────── */}
      {/* Sticky, in the bottom third, ≥44px. No optimistic UI: on money the
          row stays pending until the server answers, because a confirm that
          looks done and silently failed is worse than a slow one. */}
      <div className="pay-confirmbar">
        <button
          type="button"
          className="pay-confirm"
          disabled={!selected || busy || feedIsStale}
          onClick={() => selected && onConfirm?.(selected)}
        >
          {busy
            ? (pendingId === REFRESHING ? 'Updating the list…' : 'Saving…')
            : selected
              ? `Confirm ${formatINR(placing)}${partPay ? ' · part-paid' : ''}`
              : candidates.length ? 'Pick a bill above' : 'Nothing to confirm'}
        </button>
        <button type="button" className="pay-skip" onClick={onSkip} disabled={busy}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

function sourceLabel(source) {
  return { hdfc: 'HDFC QR', gpay: 'Google Pay', bharatpe: 'BharatPe', manual: 'Entered by hand',
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
