// "Search all bills" — for the payments no shortlist catches. Measured: a
// quarter of August's UPI receipts had no open bill at their amount within
// three days, so this is not an edge case, it is one payment in four.
//
// Phone-first like the Match screen: the payment stays pinned at the top so
// nobody loses track of what they are matching, one field that takes a name,
// a bill or plate number, or an amount, and results as big tap targets.
// Presentational: the search itself arrives as a prop.

import { useEffect, useState } from 'react'
import { formatINR } from '../lib/paise.js'
import { parseSearch } from '../lib/matchQueue.js'
import { useDebounce } from '../../lib/useDebounce'

/**
 * @param {object}   props
 * @param {object}   props.receipt
 * @param {(q:object)=>Promise<object[]>} props.search   resolves to open bills
 * @param {(invoice:object)=>void} props.onPick
 * @param {()=>void} props.onCancel
 * @param {string}   [props.initialQuery]
 */
export default function SearchPanel({ receipt, search, onPick, onCancel, initialQuery = '' }) {
  const [text, setText] = useState(initialQuery)
  const [state, setState] = useState({ status: 'idle', rows: [], error: '' })
  const debounced = useDebounce(text, 350)

  useEffect(() => {
    const q = parseSearch(debounced)
    if (!q) { setState({ status: 'idle', rows: [], error: '' }); return }
    let live = true
    setState((s) => ({ ...s, status: 'loading', error: '' }))
    search(q)
      .then((rows) => { if (live) setState({ status: 'done', rows, error: '' }) })
      .catch((e) => { if (live) setState({ status: 'error', rows: [], error: e?.message || 'Search failed' }) })
    // A slow answer to an old query must never overwrite a newer one.
    return () => { live = false }
  }, [debounced, search])

  return (
    <div className="pay-match pay-search">
      <p className="pay-search-for">
        Finding the bill for <strong>{formatINR(receipt.amount_paise)}</strong>
        {receipt.payer_name ? ` from ${receipt.payer_name}` : ''}
      </p>

      <label className="pay-search-label" htmlFor="pay-search-input">
        Name, bill number, truck number or amount
      </label>
      {/* type=search gives the phone keyboard a Search key and a clear button.
          No inputmode: the same box takes "GJ15AV" and "1930". */}
      <input
        id="pay-search-input"
        className="pay-search-input"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Sharma, 9044, 1930"
      />

      <p className="pay-hint" role="status">
        {state.status === 'idle' && 'Type at least two characters. Only bills still open are searched.'}
        {state.status === 'loading' && 'Searching…'}
        {state.status === 'error' && `Search failed: ${state.error}`}
        {state.status === 'done' && (state.rows.length
          ? `${state.rows.length} open bill${state.rows.length === 1 ? '' : 's'}${state.rows.length >= 20 ? ' — the newest 20; type more to narrow' : ''}`
          : 'No open bill matches that.')}
      </p>

      <ul className="pay-candidates">
        {state.rows.map((v) => (
          <li key={v.id}>
            <button type="button" className="pay-candidate" onClick={() => onPick(v)}>
              <span className="pay-candidate-top">
                <span className="pay-candidate-amount">{formatINR(v.total_paise - (v.allocated_paise ?? 0))}</span>
              </span>
              <span className="pay-candidate-name">{v.customer_name || 'No name on the bill'}</span>
              <span className="pay-candidate-ref">
                {v.invoice_number}
                {v.sap_customer_code ? ` · ${v.sap_customer_code}` : ''}
              </span>
              <span className="pay-candidate-why">
                {/* "10 Oct", the date style used everywhere else (R4-20) */}
                Billed {shortDay(v.invoice_date)}{v.vehicle_reg_no ? ` · ${v.vehicle_reg_no}` : ''}
                {v.allocated_paise > 0 ? ` · ${formatINR(v.allocated_paise)} already paid` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="pay-confirmbar">
        <button type="button" className="pay-skip" onClick={onCancel}>
          Back to the suggestions
        </button>
      </div>
    </div>
  )
}

/** "2026-10-10" -> "10 Oct". A calendar day already: no zone maths. */
function shortDay(isoDay) {
  const d = new Date(`${isoDay}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDay ?? ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d)
}
