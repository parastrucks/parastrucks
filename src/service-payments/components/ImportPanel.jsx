// Import — bills from SAP, payments from HDFC (BharatPe and Google Pay retired).
//
// The chain the TIV upload proved, and nothing looser:
//   1. read and parse the file IN THE BROWSER (nothing is sent yet)
//   2. gates — wrong company, the same file twice, a broken export
//   3. a preview of exactly what will change, per row, in the server's own terms
//   4. commit exactly the rows that were previewed
//   5. compare what the server did with what the preview promised
//
// Decisions live in lib/importPlan.js (tested); this file only shows them.

import { useRef, useState } from 'react'
import { callEdge } from '../../lib/api'
import { formatINR } from '../lib/paise.js'
import { parseBillingReport } from '../lib/parseBillingReport.js'
import { parseBharatPe, parseGpay } from '../lib/parseUpi.js'
import { parseHdfcSmartHub } from '../lib/parseHdfc.js'
import {
  KIND_LABEL, parseImportFile, existingInvoiceFromRow, diffInvoices, diffReceipts,
  importGates, rowsToCommit, expectedCounts, reconcile, billCoverage, notImported,
  newBillsSummary, importActionLabel, clashUndoPlan, pdfBillsNotInReport,
  billRowText, paymentRowText, sortBills, sortPayments,
} from '../lib/importPlan.js'
import {
  fetchOutlets, findPriorBatch, fetchExistingInvoices, fetchPdfBillsInRange,
  fetchExistingReceiptsByTxn, fetchExistingReceiptsByUtr, fetchAllocationsOnInvoice,
} from '../lib/paymentsData.js'
import { UNDO_REASONS } from '../lib/signalLabels.js'

// The reason a clash-row undo is saved with — tapped for the clerk, since the
// clash itself says why (cloud review, 2026-10-13).
const CANCELLED_REASON = UNDO_REASONS.find((r) => r.accountsOnly)?.label ?? 'Bill cancelled in SAP'

const LIST_CAP = 50
// The server's count names, said as words: "It said 10 new, the import did 9"
// — "new: expected 10, got 9" was a log line (red team 4, L5-27).
const COUNT_WORD = {
  new: 'new', amended: 'changed', unchanged: 'unchanged', confirmed: 'uploaded bills confirmed', conflicts: 'not agreeing',
  already_present: 'already there', already_present_manual: 'linked to hand entries', held: 'held back',
}

export default function ImportPanel({ entityId, onImported, onGoMatch, undoRefusal, onMatchesChanged }) {
  const [stage, setStage] = useState('idle')      // idle | reading | preview | committing | done | error
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null)
  const [done, setDone] = useState(null)
  const [notice, setNotice] = useState('')        // what an undone clash did
  const inputRef = useRef(null)

  const reset = () => {
    setStage('idle'); setError(''); setPlan(null); setDone(null); setNotice('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(file) {
    if (!file) return
    setStage('reading'); setError(''); setPlan(null); setDone(null); setNotice('')
    try {
      const buffer = await file.arrayBuffer()
      const outlets = await fetchOutlets(entityId)
      // Loaded only when a spreadsheet is chosen: the reader is ~490 KB and
      // the Match screen, opened on phones every morning, never needs it.
      const XLSX = /\.(xlsx|xls)$/i.test(file.name) ? await import('xlsx') : null
      const { kind, hash, parsed } = await parseImportFile(
        { name: file.name, buffer },
        { XLSX, parsers: { parseBillingReport, parseHdfcSmartHub, parseBharatPe, parseGpay }, entityId, outlets })

      const batchKind = kind === 'billing_report' ? 'invoices' : 'receipts'
      const priorBatch = await findPriorBatch(entityId, batchKind, hash)

      let diff
      let notInReport = []
      if (kind === 'billing_report') {
        const dates = parsed.invoices.map((v) => v.invoice_date).filter(Boolean).sort()
        const [rows, pdfRows] = await Promise.all([
          fetchExistingInvoices(entityId, parsed.invoices.map((v) => v.invoice_number)),
          fetchPdfBillsInRange(entityId, dates[0], dates[dates.length - 1]),
        ])
        diff = diffInvoices(parsed.invoices, rows.map(existingInvoiceFromRow))
        notInReport = pdfBillsNotInReport(parsed.invoices, pdfRows.map(existingInvoiceFromRow))
      } else {
        const [byTxn, byUtr] = await Promise.all([
          // Ids AND bank references: a hand-keyed HDFC payment carries the RRN,
          // typed as its transaction id, since the report's own id is shown to nobody.
          fetchExistingReceiptsByTxn(entityId, parsed.receipts.flatMap((r) => [r.external_txn_id, r.normalized_utr])),
          fetchExistingReceiptsByUtr(entityId, parsed.receipts.map((r) => r.normalized_utr)),
        ])
        diff = diffReceipts(parsed.receipts, byTxn, byUtr)
      }

      setPlan({
        file: { name: file.name, lastModified: file.lastModified },
        kind, hash, parsed, diff, priorBatch, notInReport,
        gates: importGates({ kind, parsed, diff, priorBatch }),
        coverage: kind === 'billing_report' ? billCoverage(parsed.invoices, file.lastModified) : null,
        expected: expectedCounts(kind, diff),
      })
      setStage('preview')
    } catch (e) {
      setError(e?.message || String(e))
      setStage('error')
    }
  }

  // "Undo this match" on a bill SAP has cancelled. Reverses only the money on
  // THIS bill, then reads the stored bills again so the preview — and the
  // commit — are the server's terms once more: the bill moves from Clashes to
  // "Changed", and this import cancels it. Resolves to an error message, or ''.
  async function undoClash(c) {
    let allocs
    try { allocs = await fetchAllocationsOnInvoice(entityId, c.invoice_id) } catch (e) { return e?.message || 'Could not read the match.' }
    const { ids, refusal } = clashUndoPlan(allocs, undoRefusal)
    if (refusal) return refusal
    let undone = 0
    for (const id of ids) {
      try {
        await callEdge('service-payments', 'reverse_allocation', { allocation_id: id, reason: CANCELLED_REASON })
        undone++
      } catch (e) {
        if (/already reversed/i.test(e?.message || '')) { undone++; continue }
        onMatchesChanged?.()
        await recheck()
        return `Half undone: ${e?.message || 'it stopped part way'}. Tap Undo it again to finish.`
      }
    }
    onMatchesChanged?.()
    const blocked = await recheck()
    setNotice(`Undone: ${formatINR(c.matched_paise)} taken off ${c.row.invoice_number}; the payment is back in the Match list. ` +
      (blocked ? 'Tomorrow’s Billing Report will cancel the bill.' : 'This import now cancels the bill.'))
    return ''
  }

  // Read the stored bills again and re-plan the same file. Returns whether the
  // file still cannot be imported (e.g. it was imported before), which decides
  // whether the cancellation lands now or with tomorrow's report.
  async function recheck() {
    if (!plan || plan.kind !== 'billing_report') return true
    const rows = await fetchExistingInvoices(entityId, plan.parsed.invoices.map((v) => v.invoice_number))
    const diff = diffInvoices(plan.parsed.invoices, rows.map(existingInvoiceFromRow))
    const gates = importGates({ kind: plan.kind, parsed: plan.parsed, diff, priorBatch: plan.priorBatch })
    setPlan((p) => ({ ...p, diff, gates, expected: expectedCounts(p.kind, diff) }))
    return !gates.ok
  }

  async function handleCommit() {
    if (!plan?.gates.ok) return
    setStage('committing')
    const { kind, parsed, diff, hash, file, coverage, expected } = plan
    try {
      const res = await callEdge('service-payments',
        kind === 'billing_report' ? 'import_invoices' : 'import_receipts', {
          entity_id: entityId,
          rows: rowsToCommit(kind, parsed, diff),
          batch: {
            source: kind,
            file_name: file.name,
            file_hash: hash,
            parser_version: parsed.parser_version,
            format_note: KIND_LABEL[kind],
            source_pulled_at: coverage,
          },
        })
      setDone({ res, mismatches: reconcile(expected, res) })
      setStage('done')
      onImported?.()
    } catch (e) {
      const msg = e?.message || String(e)
      // A retry after a dropped connection lands here when the first attempt
      // DID commit: the batch table refuses the same file twice. Say that,
      // not the database's words — and say WHEN, from the stored batch,
      // rather than "most likely" (red team 4, R4-18).
      if (/import_batches_hash_key|duplicate key/i.test(msg)) {
        let when = ''
        try {
          const prior = await findPriorBatch(entityId, kind === 'billing_report' ? 'invoices' : 'receipts', hash)
          if (prior?.uploaded_at) when = ` at ${stamp(prior.uploaded_at)}`
        } catch { /* the plain sentence still stands */ }
        setError(`This file was already imported${when}. If you just tried, it most likely worked, but the reply did not reach this screen. Nothing was imported twice.`)
      } else {
        setError(msg)
      }
      setStage('error')
    }
  }

  return (
    <div className="pay-import">
      {(stage === 'idle' || stage === 'error') && (
        <section className="pay-import-pick">
          <label className="pay-search-label" htmlFor="pay-import-file">
            Choose a file to import
          </label>
          <p className="pay-hint">
            Pick the SAP <strong>Billing Report</strong> or the day’s <strong>HDFC SmartHub
            report</strong> (.xlsx). You will see what it will change before anything is saved.
            A report that repeats earlier days is fine — nothing is imported twice.
          </p>
          <input
            id="pay-import-file"
            ref={inputRef}
            className="pay-import-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {stage === 'error' && (
            <p className="pay-banner pay-banner-warn" role="alert">{error}</p>
          )}
        </section>
      )}

      {stage === 'reading' && <p className="pay-hint" role="status">Reading the file and checking it against what is stored…</p>}

      {(stage === 'preview' || stage === 'committing') && plan && (
        <Preview plan={plan} committing={stage === 'committing'} onCommit={handleCommit} onCancel={reset}
                 notice={notice} onUndoClash={undoRefusal ? undoClash : undefined} />
      )}

      {stage === 'done' && done && plan && (
        <Done plan={plan} done={done} onAnother={reset} onGoMatch={onGoMatch} />
      )}
    </div>
  )
}

function Preview({ plan, committing, onCommit, onCancel, notice = '', onUndoClash }) {
  const { kind, parsed, diff, gates, coverage, file, notInReport = [] } = plan
  const bills = kind === 'billing_report'
  const { failedAttempts, unreadable } = notImported(kind, parsed)
  const settles = Object.entries(parsed.summary?.settles_by_day_paise ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const qrs = parsed.summary?.qrs ?? []
  const newValue = diff.new.reduce((a, r) => a + (bills ? r.total_paise : r.amount_paise), 0)
  const newCount = diff.new.length
  const owed = bills ? newBillsSummary(diff) : null
  // Bills: lead with what customers owe; the rest are bills but not money due.
  const newSub = !newCount ? null
    : bills && owed.payable.n !== newCount
      ? `${owed.payable.n} owed by customers, ${formatINR(owed.payable.paise)}`
      : formatINR(newValue)
  const notOwed = !bills ? [] : [
    owed.freeOfCost.n && `${owed.freeOfCost.n} free of cost (${formatINR(owed.freeOfCost.paise)})`,
    owed.onHold.n && `${owed.onHold.n} parts return${owed.onHold.n === 1 ? '' : 's'}, waiting for accounts (${formatINR(owed.onHold.paise)})`,
    owed.cancelled.n && `${owed.cancelled.n} already cancelled in SAP (${formatINR(owed.cancelled.paise)})`,
  ].filter(Boolean)
  const actionLabel = committing ? 'Importing…' : importActionLabel(kind, diff)

  return (
    <section className="pay-import-preview" aria-label="What this import will do">
      <p className="pay-import-file">
        <strong>{KIND_LABEL[kind]}</strong> · {file.name}
      </p>

      {notice && <p className="pay-banner pay-banner-ok" role="status">{notice}</p>}

      {gates.blocking.length > 0 && (
        <div className="pay-banner pay-banner-warn" role="alert">
          <strong>This file cannot be imported.</strong>
          <ul className="pay-import-list">{gates.blocking.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}

      <dl className="pay-import-counts">
        <Count label={bills ? 'New bills' : 'New payments'} n={newCount} sub={newSub} strong />
        {bills ? (
          <>
            <Count label="From uploaded invoices — SAP confirms them" n={diff.confirmed.length} />
            <Count label="Changed since last import" n={diff.amended.length} />
            <Count label="Already saved, no change" n={diff.unchanged.length} />
            <Count label="Does not agree with the saved bill" n={diff.conflict.length} warn />
          </>
        ) : (
          <>
            <Count label="Already imported" n={diff.already.length} />
            <Count label="Entered by hand earlier — will be linked" n={diff.linkManual.length} />
          </>
        )}
        <Count label="Held back" n={diff.held.length} warn />
        {/* A failed attempt is not an unreadable row: the payer retried, and
            the retry is in this file as a payment. Shown, never imported. */}
        <Count label="Failed payments (no money came)" n={failedAttempts.length} />
        <Count label="Could not be read" n={unreadable.length} warn />
      </dl>

      {notOwed.length > 0 && (
        <p className="pay-hint">Also new, but not owed by customers: {notOwed.join(' · ')}.</p>
      )}

      {bills && coverage && (
        <p className="pay-hint">
          Bills are complete up to <strong>{stamp(coverage)}</strong>. Payments after that cannot be
          confirmed until the next Billing Report is imported.
        </p>
      )}

      {/* The daily tie-out. Measured: successful payments for a day equal
          HDFC's "UPI SETTLEMENT -<merchant>-" credit the next morning, to the
          rupee. If they do not, something is missing from this file. */}
      {kind === 'hdfc' && settles.length > 0 && (
        <div className="pay-import-settle">
          <p className="pay-hint">
            Check: each day’s total below should match the <strong>UPI SETTLEMENT</strong> amount
            HDFC puts in the bank the next morning{qrs.length ? ` (QR ${qrs.join(', ')})` : ''}.
          </p>
          <ul className="pay-import-list">
            {settles.map(([day, paise]) => <li key={day}>{dayLabel(day)}: <strong>{formatINR(paise)}</strong></li>)}
            {/* The clerk added these up by hand (R4-18). */}
            {settles.length > 1 && (
              <li>Total: <strong>{formatINR(settles.reduce((a, [, p]) => a + p, 0))}</strong></li>
            )}
          </ul>
          {diff.already.length > 0 && (
            <p className="pay-hint">
              These totals include the {diff.already.length} payment{diff.already.length === 1 ? '' : 's'} already
              imported from an earlier file — the whole day is shown so it can be ticked in one go.
            </p>
          )}
        </div>
      )}

      {gates.warnings.length > 0 && (
        <ul className="pay-import-list pay-import-warn">{gates.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      {/* The proof the owner asked for, every morning: a bill number read off
          an uploaded PDF that SAP's report for that day does not have. */}
      {notInReport.length > 0 && (
        <p className="pay-banner pay-banner-warn" role="alert">
          {notInReport.length === 1
            ? '1 bill from an uploaded invoice is not in this report, though the report covers its day.'
            : `${notInReport.length} bills from uploaded invoices are not in this report, though the report covers their days.`}
          {' '}Check the bill number with accounts (listed below). Nothing is changed.
        </p>
      )}
      <Fold title="From uploaded invoices, not in this report" open items={notInReport} render={billRowText} />
      <Fold title="Held back" items={diff.held} render={(h) => `${label(h.row)} — ${h.reason}`} />
      {bills && <Fold title="Does not agree" open items={diff.conflict}
            render={(c) => <ClashRow c={c} onUndo={onUndoClash} disabled={committing} />} />}
      <Fold title="Failed payments (no money came)" items={failedAttempts}
            render={(r) => `Row ${r.row} — ${r.amount_paise != null ? formatINR(r.amount_paise) : 'amount unreadable'}` +
              `${r.payer_name ? ` from ${r.payer_name}` : ''}${r.when ? `, ${r.when}` : ''}. Not imported. The customer most likely paid again.`} />
      <Fold title="Could not be read" items={unreadable}
            render={(r) => `Row ${r.row}${r.invoice_number || r.txnId ? ` (${r.invoice_number || r.txnId})` : ''} — ${r.reason}`} />
      {bills && <Fold title="From uploaded invoices — SAP confirms them" items={diff.confirmed}
            render={(c) => `${c.row.invoice_number} — ${c.differs.length ? c.differs.join('; ') : 'same as the PDF'}`} />}
      {bills && <Fold title="Changed since last import" items={diff.amended}
            render={(a) => `${a.row.invoice_number} — ${a.changed.join(', ')}: ${formatINR(a.was.total_paise)} → ${formatINR(a.row.total_paise)}${a.row.status !== a.was.status ? `, ${a.was.status} → ${a.row.status}` : ''}`} />}

      {/* The rows behind the counts, closed — to tick against the file and the
          bank without keeping a second sheet (R4-18). */}
      {bills
        ? <Fold title="New bills" items={sortBills(diff.new)} render={billRowText} />
        : <>
            <Fold title="New payments" items={sortPayments(diff.new)} render={paymentRowText} />
            <Fold title="Already imported" items={sortPayments(diff.already)} render={paymentRowText} />
          </>}

      <div className="pay-import-actions">
        <button type="button" className="pay-confirm" onClick={onCommit} disabled={!gates.ok || committing}>
          {actionLabel}
        </button>
        <button type="button" className="pay-skip" onClick={onCancel} disabled={committing}>
          Choose a different file
        </button>
      </div>
    </section>
  )
}

function Done({ plan, done, onAnother, onGoMatch }) {
  const { res, mismatches } = done
  const bills = plan.kind === 'billing_report'
  const conflicts = Array.isArray(res.conflicts) ? res.conflicts.length : (res.conflicts ?? 0)
  return (
    <section className="pay-import-done" aria-label="Import finished">
      <p className="pay-empty-tick" aria-hidden="true">✓</p>
      <h2 className="pay-empty-title">Imported</h2>
      <p className="pay-empty-sub">
        {bills
          ? `${res.new ?? 0} new · ${res.amended ?? 0} changed · ${res.unchanged ?? 0} unchanged${res.confirmed ? ` · ${res.confirmed} uploaded bill${res.confirmed === 1 ? '' : 's'} confirmed` : ''}${conflicts ? ` · ${conflicts} left as ${conflicts === 1 ? 'it was' : 'they were'}` : ''}`
          : `${res.new ?? 0} new · ${res.already_present ?? 0} already there${res.already_present_manual ? ` · ${res.already_present_manual} linked to hand entries` : ''}`}
      </p>
      {/* Money too, not only counts — and only when the server did exactly
          what the preview showed, since these figures come from the preview. */}
      {mismatches.length === 0 && plan.diff.new.length > 0 && (
        <p className="pay-empty-sub">
          {bills
            ? `New bills owed by customers: ${formatINR(newBillsSummary(plan.diff).payable.paise)}`
            : `New payments: ${formatINR(plan.diff.new.reduce((a, r) => a + r.amount_paise, 0))}`}
        </p>
      )}
      {mismatches.length > 0 && (
        <p className="pay-banner pay-banner-warn" role="alert">
          <strong>This is not what the preview showed.</strong>{' '}
          {mismatches.map((m) => `It said ${m.expected} ${COUNT_WORD[m.key] ?? m.key}, the import did ${m.got}`).join('. ')}.
          Someone else may have imported or matched at the same time. Nothing is lost. Open Match
          to check, or import the file again.
        </p>
      )}
      <div className="pay-import-actions">
        {/* Always offered: new bills can unlock payments that were already
            waiting, and a fresh Billing Report lifts the stale-bills brake. */}
        <button type="button" className="pay-confirm" onClick={() => onGoMatch?.(plan.kind)}>Go to matching</button>
        <button type="button" className="pay-skip" onClick={onAnother}>Import another file</button>
      </div>
    </section>
  )
}

function Count({ label, n, sub = null, strong = false, warn = false }) {
  if (!strong && !n) return null
  return (
    <div className={`pay-import-count${warn && n ? ' is-warn' : ''}`}>
      <dt>{label}</dt>
      <dd><strong>{n}</strong>{sub ? <span> · {sub}</span> : null}</dd>
    </div>
  )
}

/**
 * One clash. A bill SAP cancelled with money still on it carries "Undo this
 * match": one tap to ask, one to do it — money moves, so never a single tap.
 * Every other clash (a reused bill number, a total below what is paid) is a
 * question for SAP, not something to undo here, and stays words only.
 */
function ClashRow({ c, onUndo, disabled = false }) {
  const [step, setStep] = useState('idle')        // idle | ask | busy
  const [err, setErr] = useState('')
  const text = `${c.row.invoice_number} — ${c.reason}`
  if (c.kind !== 'cancelled_under_money' || !c.invoice_id || !onUndo) return text
  const go = async () => {
    setStep('busy'); setErr('')
    const msg = await onUndo(c)
    if (msg) { setErr(msg); setStep('ask') }
  }
  return (
    <>
      {text}
      {step === 'idle' ? (
        <div className="pay-clash-actions">
          <button type="button" className="pay-secondary" disabled={disabled} onClick={() => setStep('ask')}>
            Undo this match
          </button>
        </div>
      ) : (
        <div className="pay-clash-ask">
          <p className="pay-hint">
            Take {formatINR(c.matched_paise)} off {c.row.invoice_number}? The payment goes back to the Match
            list to be placed on its right bill.
          </p>
          <div className="pay-clash-actions">
            <button type="button" className="pay-secondary pay-clash-yes" disabled={step === 'busy' || disabled} onClick={go}>
              {step === 'busy' ? 'Undoing…' : 'Undo it'}
            </button>
            <button type="button" className="pay-secondary" disabled={step === 'busy'} onClick={() => { setStep('idle'); setErr('') }}>
              Keep it
            </button>
          </div>
          {err && <p className="form-error" role="alert">{err}</p>}
        </div>
      )}
    </>
  )
}

function Fold({ title, items, render, open = false }) {
  if (!items?.length) return null
  return (
    <details className="pay-import-fold" open={open}>
      <summary>{title} ({items.length})</summary>
      <ul className="pay-import-list">
        {items.slice(0, LIST_CAP).map((x, i) => <li key={i}>{render(x)}</li>)}
        {items.length > LIST_CAP && <li>…and {items.length - LIST_CAP} more</li>}
      </ul>
    </details>
  )
}

function label(row) {
  return row.invoice_number || (row.external_txn_id ? `${formatINR(row.amount_paise)} · ${row.external_txn_id}` : '')
}

/** "2026-10-07" -> "Wed 7 Oct". The date is a calendar day already; no zone maths. */
function dayLabel(isoDay) {
  const d = new Date(`${isoDay}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDay
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

function stamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}
