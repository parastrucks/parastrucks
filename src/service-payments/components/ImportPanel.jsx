// Import — bills from SAP, payments from BharatPe and Google Pay.
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
  newBillsSummary, importActionLabel,
} from '../lib/importPlan.js'
import {
  fetchOutlets, findPriorBatch, fetchExistingInvoices,
  fetchExistingReceiptsByTxn, fetchExistingReceiptsByUtr,
} from '../lib/paymentsData.js'

const LIST_CAP = 50

export default function ImportPanel({ entityId, onImported, onGoMatch }) {
  const [stage, setStage] = useState('idle')      // idle | reading | preview | committing | done | error
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null)
  const [done, setDone] = useState(null)
  const inputRef = useRef(null)

  const reset = () => {
    setStage('idle'); setError(''); setPlan(null); setDone(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(file) {
    if (!file) return
    setStage('reading'); setError(''); setPlan(null); setDone(null)
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
      if (kind === 'billing_report') {
        const rows = await fetchExistingInvoices(entityId, parsed.invoices.map((v) => v.invoice_number))
        diff = diffInvoices(parsed.invoices, rows.map(existingInvoiceFromRow))
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
        kind, hash, parsed, diff,
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
      // not the database's words.
      setError(/import_batches_hash_key|duplicate key/i.test(msg)
        ? 'This file is already imported — most likely by your previous attempt, whose answer was lost. Nothing was imported twice.'
        : msg)
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
            The SAP <strong>Billing Report</strong>, or the day’s <strong>HDFC SmartHub
            transaction report</strong> (both .xlsx). Nothing is saved until you have seen what
            it will change. Uploading a report that overlaps an earlier one is fine — payments
            already imported are recognised and skipped.
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
        <Preview plan={plan} committing={stage === 'committing'} onCommit={handleCommit} onCancel={reset} />
      )}

      {stage === 'done' && done && plan && (
        <Done plan={plan} done={done} onAnother={reset} onGoMatch={onGoMatch} />
      )}
    </div>
  )
}

function Preview({ plan, committing, onCommit, onCancel }) {
  const { kind, parsed, diff, gates, coverage, file } = plan
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
      ? `${owed.payable.n} to be paid · ${formatINR(owed.payable.paise)}`
      : formatINR(newValue)
  const notOwed = !bills ? [] : [
    owed.freeOfCost.n && `${owed.freeOfCost.n} free of cost (${formatINR(owed.freeOfCost.paise)})`,
    owed.onHold.n && `${owed.onHold.n} parts return${owed.onHold.n === 1 ? '' : 's'}, on hold until accounts decide (${formatINR(owed.onHold.paise)})`,
    owed.cancelled.n && `${owed.cancelled.n} already cancelled in SAP (${formatINR(owed.cancelled.paise)})`,
  ].filter(Boolean)
  const actionLabel = committing ? 'Importing…' : importActionLabel(kind, diff)

  return (
    <section className="pay-import-preview" aria-label="What this import will do">
      <p className="pay-import-file">
        <strong>{KIND_LABEL[kind]}</strong> · {file.name}
      </p>

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
            <Count label="Changed since last import" n={diff.amended.length} />
            <Count label="Already stored, unchanged" n={diff.unchanged.length} />
            <Count label="Clash with what is stored" n={diff.conflict.length} warn />
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
        <Count label="Failed attempts — not money" n={failedAttempts.length} />
        <Count label="Could not be read" n={unreadable.length} warn />
      </dl>

      {notOwed.length > 0 && (
        <p className="pay-hint">Also new, but not owed by customers: {notOwed.join(' · ')}.</p>
      )}

      {bills && coverage && (
        <p className="pay-hint">
          Bills are complete up to <strong>{stamp(coverage)}</strong>. Payments after that will show
          “bills out of date” on the Match screen until the next Billing Report.
        </p>
      )}

      {/* The daily tie-out. Measured: successful payments for a day equal
          HDFC's "UPI SETTLEMENT -<merchant>-" credit the next morning, to the
          rupee. If they do not, something is missing from this file. */}
      {kind === 'hdfc' && settles.length > 0 && (
        <div className="pay-import-settle">
          <p className="pay-hint">
            Each day below should equal the <strong>UPI SETTLEMENT</strong> credit HDFC pays into
            the account the next morning{qrs.length ? ` (QR ${qrs.join(', ')})` : ''}:
          </p>
          <ul className="pay-import-list">
            {settles.map(([day, paise]) => <li key={day}>{dayLabel(day)} — <strong>{formatINR(paise)}</strong></li>)}
          </ul>
        </div>
      )}

      {gates.warnings.length > 0 && (
        <ul className="pay-import-list pay-import-warn">{gates.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      <Fold title="Held back" items={diff.held} render={(h) => `${label(h.row)} — ${h.reason}`} />
      {bills && <Fold title="Clashes" items={diff.conflict} render={(c) => `${c.row.invoice_number} — ${c.reason}`} />}
      <Fold title="Failed attempts — not money" items={failedAttempts}
            render={(r) => `Row ${r.row} — ${r.amount_paise != null ? formatINR(r.amount_paise) : 'amount unreadable'}` +
              `${r.payer_name ? ` from ${r.payer_name}` : ''}${r.when ? `, ${r.when}` : ''} — not imported; the payer usually tried again`} />
      <Fold title="Could not be read" items={unreadable}
            render={(r) => `Row ${r.row}${r.invoice_number || r.txnId ? ` (${r.invoice_number || r.txnId})` : ''} — ${r.reason}`} />
      {bills && <Fold title="Changed since last import" items={diff.amended}
            render={(a) => `${a.row.invoice_number} — ${a.changed.join(', ')}: ${formatINR(a.was.total_paise)} → ${formatINR(a.row.total_paise)}${a.row.status !== a.was.status ? `, ${a.was.status} → ${a.row.status}` : ''}`} />}

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
          ? `${res.new ?? 0} new · ${res.amended ?? 0} changed · ${res.unchanged ?? 0} unchanged${conflicts ? ` · ${conflicts} left as ${conflicts === 1 ? 'it was' : 'they were'}` : ''}`
          : `${res.new ?? 0} new · ${res.already_present ?? 0} already there${res.already_present_manual ? ` · ${res.already_present_manual} linked to hand entries` : ''}`}
      </p>
      {mismatches.length > 0 && (
        <p className="pay-banner pay-banner-warn" role="alert">
          <strong>This is not what the preview showed.</strong>{' '}
          {mismatches.map((m) => `${m.key}: expected ${m.expected}, got ${m.got}`).join(' · ')}.
          Someone may have imported or matched in the meantime. Nothing was lost — check the Match
          screen, and import the file again to see the current picture.
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

function Fold({ title, items, render }) {
  if (!items?.length) return null
  return (
    <details className="pay-import-fold">
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
