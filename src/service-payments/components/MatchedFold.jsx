// "Matched today" — the list a wrong match is found and undone from.
//
// Before it, a wrong confirm could only be undone by someone running SQL, and
// in the pre-mortem's simulated month a wrong pick was kept, not caught: no
// screen showed what was matched yesterday (F3). It is a fold at the bottom of
// the Match screen — one line until opened, below everything else, so the
// payment being matched keeps the page (the TIV clutter rule) — and open on the
// end screens, where it is the natural next look.
//
// One row per CONFIRM: a parts + labour pair paid by one transfer is undone as
// one thing. The reason is tapped from a fixed list (UNDO_REASONS), never
// typed: it is saved, and shown to the next person who finds that bill.

import { useEffect, useRef, useState } from 'react'
import { formatINR } from '../lib/paise.js'
import { UNDO_REASONS } from '../lib/signalLabels.js'

/**
 * @param {object}   props
 * @param {object[]} props.groups        groupMatches() output, newest first
 * @param {'today'|'week'} props.span
 * @param {(span:'today'|'week')=>void} props.onSpan
 * @param {boolean}  [props.defaultOpen]  open on the end screens
 * @param {string|null} [props.undoingKey] the row being undone
 * @param {(group:object, reason:object)=>void} props.onUndo
 * @param {boolean}  [props.isAccounts]   sees the accounts-only reason
 * @param {boolean}  [props.seesAll]      "Matched today" vs "You matched today"
 */
export default function MatchedFold({
  groups = [],
  span = 'today',
  onSpan,
  defaultOpen = false,
  undoingKey = null,
  onUndo,
  isAccounts = false,
  seesAll = false,
}) {
  const [asking, setAsking] = useState(null)   // the row whose reasons are open
  const reasonsRef = useRef(null)
  // The reasons open at the very bottom of the page — under the confirm bar
  // on a phone unless brought into view (the R4-15 lesson).
  useEffect(() => {
    if (asking) reasonsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [asking])

  const reasons = UNDO_REASONS.filter((r) => isAccounts || !r.accountsOnly)
  const who = seesAll ? 'Matched' : 'You matched'
  const when = span === 'week' ? 'in the last 7 days' : 'today'
  const busy = undoingKey !== null

  return (
    <details className="pay-import-fold pay-matched-fold" open={defaultOpen || undefined}>
      <summary>{who} {when}: {groups.length ? groups.length : 'none'}</summary>
      {groups.length > 0 && (
        <ul className="pay-matched-list">
          {groups.map((g) => (
            <li key={g.key} className="pay-matched-row">
              <div className="pay-matched-main">
                <p className="pay-matched-what">
                  <strong>{formatINR(g.amount_paise)}</strong>
                  {' · '}{g.payer_name || 'No name on the payment'} → {g.customer_name || 'No name on the bill'}
                </p>
                <p className="pay-matched-meta">
                  {g.bill_count > 1 ? `${g.bill_count} bills · ` : ''}
                  {g.invoice_numbers.join(' + ')} · {clock(g.at, span)}
                  {!g.mine && g.maker_name ? ` · by ${g.maker_name}` : ''}
                </p>
              </div>
              {g.refusal ? (
                <p className="pay-matched-no">{refusalText(g)}</p>
              ) : asking === g.key ? null : (
                <button type="button" className="pay-secondary pay-matched-undo"
                        disabled={busy} onClick={() => setAsking(g.key)}>
                  {undoingKey === g.key ? 'Undoing…' : 'Undo'}
                </button>
              )}
              {asking === g.key && !g.refusal && (
                <div className="pay-matched-ask" ref={reasonsRef}>
                  <p className="pay-hint">Why undo it?</p>
                  <ul className="pay-reasons">
                    {reasons.map((r) => (
                      <li key={r.label}>
                        <button type="button" className="pay-reason" disabled={busy}
                                onClick={() => { setAsking(null); onUndo?.(g, r) }}>
                          {r.label}
                        </button>
                      </li>
                    ))}
                    <li>
                      <button type="button" className="pay-reason pay-reason-cancel" disabled={busy}
                              onClick={() => setAsking(null)}>
                        Keep it
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="pay-matched-span" disabled={busy}
              onClick={() => { setAsking(null); onSpan?.(span === 'week' ? 'today' : 'week') }}>
        {span === 'week' ? 'Show only today' : 'Show the last 7 days'}
      </button>
    </details>
  )
}

/** "9:41 am" today; "12 Oct, 9:41 am" across the week. India's clock. */
function clock(iso, span) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
    ...(span === 'week' ? { day: 'numeric', month: 'short' } : {}),
  }).format(d)
}

/** The server's refusal, with the maker named where it helps. */
function refusalText(g) {
  if (/^Only the person who matched this/.test(g.refusal) && g.maker_name) {
    return `Only ${g.maker_name} or accounts can undo this.`
  }
  return g.refusal
}
