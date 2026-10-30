// The Import screen's decisions, kept out of React so they can be tested
// without a browser, a file picker or a database
// (scripts/payments/selftest-import-plan.mjs).
//
// The chain is the one the TIV upload proved: GATES → parse in the browser →
// show exactly what will change → commit exactly what was shown → compare
// what the server did with what was shown.
//
// The server (payments_import_invoices / payments_import_receipts) decides each
// row for itself. The preview here MIRRORS that decision so a person can see
// it before it happens. Parity with the real RPCs is proved on staging by
// scripts/payments/probe-import-parity.sql. Where a row cannot be safely
// decided it is HELD — not sent — and named:
//   · an existing bill whose customer could not be read
//   · a transaction id or UTR already held by a receipt the server would not
//     recognise as the same money

import { PLANT_CITY } from './parseBillingReport.js'
import { looksLikeHdfc } from './parseHdfc.js'
import { formatINR } from './paise.js'

/** The EF refuses more than this in one call (service-payments/index.ts). */
export const MAX_ROWS_PER_IMPORT = 5000

const BHARATPE_MARKERS = ['Transaction Date and Time', 'Received From', 'Net MDR (Inclusive GST)']
const GPAY_MARKERS = ['Payer/Receiver', 'Creation time', 'Processing fee']

/**
 * Which kind of file this is, from its name and — for CSVs — its header line.
 * Returns 'billing_report' | 'bharatpe' | 'gpay' | null. Never guesses: a CSV
 * whose header matches neither export is null, and the screen says so.
 */
export function detectFileKind(fileName, firstLine = '') {
  const name = String(fileName || '').toLowerCase()
  // A spreadsheet is the Billing Report OR an HDFC report — only its contents
  // can tell, so parseImportFile decides. By name alone, assume the bills.
  if (/\.(xlsx|xls)$/.test(name)) return 'billing_report'
  if (!name.endsWith('.csv')) return null
  const head = String(firstLine).replace(/^﻿/, '')
  const has = (cols) => cols.every((c) => head.includes(c))
  if (has(BHARATPE_MARKERS)) return 'bharatpe'
  if (has(GPAY_MARKERS)) return 'gpay'
  return null
}

export const KIND_LABEL = {
  billing_report: 'SAP Billing Report',
  hdfc: 'HDFC SmartHub transaction report',
  bharatpe: 'BharatPe statement (retired)',
  gpay: 'Google Pay Business export (retired)',
}

// ── Bills ────────────────────────────────────────────────────────────────

/**
 * Up to when does this file prove the bills are complete?
 *
 * The Billing Report carries no export time — row 1 is a title, row 2 a count.
 * Two facts bound it: the file was saved no earlier than it was exported (its
 * modified time), and it cannot hold bills from after the end of its last
 * billing day. Take the EARLIER of the two. Upload time is never used: an
 * export run on Saturday and uploaded on Monday would otherwise tell the
 * stale-bills brake that Sunday's payments have their bills, when they may not.
 *
 * Known limit, stated: a file downloaded again later carries a later modified
 * time, so within its last billing day this can claim a few hours too many.
 *
 * @returns {string|null} ISO instant
 */
export function billCoverage(invoices, fileLastModifiedMs) {
  const dates = invoices.map((v) => v.invoice_date).filter(Boolean).sort()
  if (!dates.length) return null
  const endOfLastDay = Date.parse(`${dates[dates.length - 1]}T23:59:59.999+05:30`)
  const saved = Number.isFinite(fileLastModifiedMs) && fileLastModifiedMs > 0 ? fileLastModifiedMs : Infinity
  return new Date(Math.min(endOfLastDay, saved)).toISOString()
}

/** plant code -> outlet id, by the measured plant->city map. */
export function outletIdByPlant(outlets) {
  const out = {}
  for (const [plant, city] of Object.entries(PLANT_CITY)) {
    const o = outlets.find((x) => x.is_active !== false &&
      String(x.city || '').toLowerCase() === city.toLowerCase())
    if (o) out[plant] = o.id
  }
  return out
}

/**
 * An existing bill as read from service_invoices with its customer embedded.
 * PostgREST returns a to-one embed as an object — but a probe on this project
 * once read an embed it never unpacked and silently treated every account as
 * department-less. So the shape is unpacked in ONE tested place, and an
 * embed that cannot be read makes the customer UNKNOWN, never "none".
 */
export function existingInvoiceFromRow(row) {
  const c = Array.isArray(row.customer) ? row.customer[0] : row.customer
  return {
    id: row.id ?? null,                                      // for undoing a match on it
    invoice_number: row.invoice_number,
    sap_customer_code: c?.sap_customer_code ?? undefined,   // undefined = could not read
    customer_name: row.customer_name ?? null,
    total_paise: Number(row.total_paise),
    allocated_paise: Number(row.allocated_paise ?? 0),
    status: row.status,
    cancelled_flag: row.cancelled_flag ?? null,
    origin: row.origin ?? 'billing_report',
    invoice_date: row.invoice_date ?? null,
  }
}

/**
 * The same SAP customer code, printed at another width? An uploaded invoice PDF
 * and the Billing Report may pad the code differently (unproven on real files;
 * the demos differ), so a bill born from a PDF compares codes without leading
 * zeros. Mirrors ltrim(code, '0') in payments_import_invoices.
 */
export function sameCustomerCode(a, b) {
  const strip = (x) => String(x ?? '').replace(/^0+/, '')
  return strip(a) === strip(b)
}

/**
 * What importing these bills would do — the server's rules, row by row.
 *
 * Mirrors payments_import_invoices (as of 20260926_payments_import_rules.sql):
 *   no such number                                -> new
 *   different customer                            -> conflict (number reused / wrong file)
 *   new total below what is already paid          -> conflict
 *   no longer active while money is matched to it -> conflict (it would strand the money)
 *   came from an uploaded invoice PDF             -> confirmed (the report takes the row over)
 *   total, status or cancelled flag differ        -> amended
 *   otherwise                                     -> unchanged
 * and, as of 20261030_payments_bills_from_invoices.sql, a PDF-born bill's
 * customer code is compared without leading zeros (sameCustomerCode).
 */
export function diffInvoices(parsed, existing) {
  const byNumber = new Map(existing.map((e) => [e.invoice_number, e]))
  const out = { new: [], amended: [], unchanged: [], confirmed: [], conflict: [], held: [] }
  for (const v of parsed) {
    const e = byNumber.get(v.invoice_number)
    if (!e) { out.new.push(v); continue }
    if (e.sap_customer_code === undefined) {
      out.held.push({ row: v, reason: 'could not read the existing bill’s customer — reload and try again' })
      continue
    }
    const fromPdf = e.origin === 'invoice_pdf'
    if (fromPdf ? !sameCustomerCode(e.sap_customer_code, v.sap_customer_code) : e.sap_customer_code !== v.sap_customer_code) {
      out.conflict.push({ row: v, reason: `the customer changed (was ${e.customer_name ?? e.sap_customer_code}) — an invoice number reused, or a different export` })
      continue
    }
    if (v.total_paise < e.allocated_paise) {
      out.conflict.push({ row: v, reason: 'the new total is below what is already paid against it' })
      continue
    }
    const status = v.status ?? 'active'
    const changed = []
    if (e.total_paise !== v.total_paise) changed.push('total')
    if (e.status !== status) changed.push('status')
    if ((e.cancelled_flag ?? null) !== (v.cancelled_flag ?? null)) changed.push('cancelled')
    if (fromPdf && !changed.length) { out.confirmed.push({ row: v, was: e, differs: pdfDiffers(e, v) }); continue }
    if (!changed.length) { out.unchanged.push(v); continue }
    if (status !== 'active' && e.status === 'active' && e.allocated_paise > 0) {
      // The one clash a person can clear from here: undo the match, and the
      // cancellation goes through (ImportPanel "Undo this match").
      out.conflict.push({
        row: v,
        reason: `SAP now marks it ${status}, but ₹${(e.allocated_paise / 100).toLocaleString('en-IN')} is already matched to it — undo that match first`,
        kind: 'cancelled_under_money',
        invoice_id: e.id ?? null,
        matched_paise: e.allocated_paise,
      })
      continue
    }
    if (fromPdf) { out.confirmed.push({ row: v, was: e, differs: pdfDiffers(e, v) }); continue }
    out.amended.push({ row: v, was: e, changed })
  }
  return out
}

/** Where SAP's record of a bill differs from what its uploaded PDF said. */
function pdfDiffers(e, v) {
  const out = []
  if (e.total_paise !== v.total_paise) out.push(`the PDF said ${formatINR(e.total_paise)}, SAP says ${formatINR(v.total_paise)}`)
  if ((v.status ?? 'active') !== 'active') out.push(`SAP marks it ${v.status}`)
  if (e.invoice_date && v.invoice_date && e.invoice_date !== v.invoice_date) out.push(`dated ${v.invoice_date} in SAP, ${e.invoice_date} on the PDF`)
  return out
}

/**
 * Bills that came from uploaded invoice PDFs, dated inside this report's days,
 * that the report does not hold. Each is a bill number on a PDF that is NOT a
 * Billing Report invoice number — the one thing the owner asked to have proved
 * before the live site. Listed, never changed.
 *
 * @param parsed  the report's bills
 * @param pdfRows stored PDF-born bills (existingInvoiceFromRow shape) in its date range
 */
export function pdfBillsNotInReport(parsed, pdfRows) {
  const dates = parsed.map((v) => v.invoice_date).filter(Boolean).sort()
  if (!dates.length) return []
  const inFile = new Set(parsed.map((v) => v.invoice_number))
  const [first, last] = [dates[0], dates[dates.length - 1]]
  return (pdfRows ?? []).filter((e) => e.origin === 'invoice_pdf' && !inFile.has(e.invoice_number) &&
    e.invoice_date && e.invoice_date >= first && e.invoice_date <= last)
}

/**
 * Undoing the match under a bill SAP has cancelled: which allocations to
 * reverse, or why not. Only the allocations ON THIS BILL — a parts + labour
 * confirm also paid the partner bill, which SAP did not cancel, and that money
 * stays where it is. Anything already sent to Busy needs a GM; the server's
 * own rule decides (reverseAllowed), so the screen never tries what it refuses.
 *
 * @param allocs       this bill's standing allocations {id, export_batch_id, allocated_by}
 * @param undoRefusal  capabilitiesFor().undoRefusal
 * @returns {{ids: string[], refusal: string|null}}
 */
export function clashUndoPlan(allocs, undoRefusal) {
  const standing = (allocs ?? []).filter((a) => a && a.id && !a.reversed_at)
  if (!standing.length) return { ids: [], refusal: 'Nothing is matched to this bill any more — check the file again.' }
  for (const a of standing) {
    const refusal = undoRefusal ? undoRefusal({ maker_id: a.allocated_by ?? null, exported: Boolean(a.export_batch_id) }) : 'Not allowed'
    if (refusal) return { ids: [], refusal }
  }
  return { ids: standing.map((a) => a.id), refusal: null }
}

// ── Receipts ─────────────────────────────────────────────────────────────

/**
 * What importing these payments would do. Mirrors payments_import_receipts
 * (as of 20261009_payments_hdfc_source.sql), in the server's order:
 *   same source + transaction id already stored      -> already present
 *   an ACTIVE hand-keyed (source 'manual') receipt that is the same money —
 *   same transaction id, OR the row's bank reference (RRN/UTR) typed in as
 *   the hand entry's UTR or its transaction id (HDFC: the RRN is the only
 *   reference a cashier can see; an exact id match wins)
 *     · not yet linked to a file                     -> linked, never a 2nd copy
 *     · already linked                               -> already present
 *   the id held under some other import source       -> held
 *   the UTR held by any other active receipt         -> held
 *   otherwise                                        -> new
 *
 * @param existingByTxn  stored receipts whose transaction id is any of this
 *                       file's ids OR bank references, from ANY source
 * @param existingByUtr  stored receipts whose UTR is any of this file's
 */
export function diffReceipts(parsed, existingByTxn, existingByUtr) {
  const all = [...existingByTxn, ...existingByUtr]
  const byUtr = new Map(existingByUtr.filter((e) => e.status === 'active').map((e) => [e.normalized_utr, e]))
  const out = { new: [], already: [], linkManual: [], held: [] }
  for (const r of parsed) {
    const same = all.filter((e) => e.external_txn_id === r.external_txn_id)
    if (same.some((e) => e.source === r.source)) { out.already.push(r); continue }
    const utr = r.normalized_utr || null
    const manuals = all.filter((e) => e.source === 'manual' && e.status === 'active' &&
      (e.external_txn_id === r.external_txn_id ||
       (utr && (e.normalized_utr === utr || e.external_txn_id === utr))))
    const manual = manuals.find((e) => e.external_txn_id === r.external_txn_id) ?? manuals[0]
    if (manual) {
      // Same reference, different amount: one of them is wrong — a mistyped
      // reference, or a mistyped amount. Linking would leave the hand entry's
      // amount standing and drop the file's; a new row would count it twice.
      // Neither is safe, so a person decides.
      if (manual.amount_paise !== undefined && Number(manual.amount_paise) !== r.amount_paise) {
        out.held.push({ row: r, reason: `a hand-keyed entry${manual.receipt_serial ? ` (${manual.receipt_serial})` : ''} has this reference but ₹${(Number(manual.amount_paise) / 100).toLocaleString('en-IN')}, the file says ₹${(r.amount_paise / 100).toLocaleString('en-IN')} — check which is right` })
        continue
      }
      ;(manual.import_batch_id ? out.already : out.linkManual).push(r)
      continue
    }
    const other = same.find((e) => e.source !== 'manual' && e.status === 'active')
    if (other) {
      out.held.push({ row: r, reason: `this transaction id is already recorded as a ${other.source} payment — two exports claim the same money` })
      continue
    }
    const u = utr ? byUtr.get(utr) : null
    if (u) {
      out.held.push({ row: r, reason: `this UTR is already recorded (${u.source}${u.receipt_serial ? ' ' + u.receipt_serial : ''}) — check it was not entered twice` })
      continue
    }
    out.new.push(r)
  }
  return out
}

// ── Gates ────────────────────────────────────────────────────────────────

/**
 * Whether the file may be committed at all. Blocking problems stop the
 * commit; warnings are shown and allowed.
 */
export function importGates({ kind, parsed, diff, priorBatch, entityPlants = Object.keys(PLANT_CITY) }) {
  const blocking = []
  const warnings = []

  if (priorBatch) {
    blocking.push(`This file was already imported${priorBatch.uploaded_at ? ` on ${istStamp(priorBatch.uploaded_at)}` : ''}` +
      `${priorBatch.file_name ? ` as “${priorBatch.file_name}”` : ''}. Choose a newer file.`)
  }

  if (kind === 'billing_report') {
    const plants = Object.keys(parsed.summary.by_plant || {}).filter((p) => p !== '(none)')
    const foreign = plants.filter((p) => !entityPlants.includes(p))
    if (foreign.length) {
      // The most damaging mistake available here: another company's bills
      // filed as PTB's, every customer created under the wrong entity.
      blocking.push(`This file has bills from plant ${foreign.join(', ')}, which is not PTB (${entityPlants.join(', ')}). Wrong company’s export?`)
    }
    if (parsed.invoices.length === 0) blocking.push('No bill in this file could be read.')
    if (parsed.invoices.length > MAX_ROWS_PER_IMPORT) blocking.push(`More than ${MAX_ROWS_PER_IMPORT} bills — export a shorter date range.`)
    if (parsed.refused.length) warnings.push(`${parsed.refused.length} row${plural(parsed.refused.length)} could not be read and will not be imported (listed below).`)
    if (diff?.conflict.length) {
      const one = diff.conflict.length === 1
      warnings.push(one
        ? '1 bill does not agree with the saved one and will not be changed (listed below).'
        : `${diff.conflict.length} bills do not agree with the saved ones and will not be changed (listed below).`)
    }
    if (diff?.held.length) {
      const one = diff.held.length === 1
      warnings.push(one
        ? '1 bill held back — importing it would strand money already matched (listed below).'
        : `${diff.held.length} bills held back — importing them would strand money already matched (listed below).`)
    }
  } else {
    const dupes = parsed.summary.duplicate_txn_ids || []
    if (dupes.length) {
      blocking.push(`The same transaction id appears twice inside this file (${dupes.slice(0, 3).map((d) => `rows ${d.rows.join(' & ')}`).join('; ')}). The export is broken — download it again.`)
    }
    if (parsed.receipts.length === 0) blocking.push('No payment in this file could be read.')
    if (parsed.receipts.length > MAX_ROWS_PER_IMPORT) blocking.push(`More than ${MAX_ROWS_PER_IMPORT} payments — export a shorter date range.`)
    const refused = parsed.review.filter((r) => r.refused)
    if (refused.length) warnings.push(`${refused.length} row${plural(refused.length)} not imported (failed or unsettled attempts, or unreadable — listed below).`)
    if (parsed.summary.small_amount_flagged) warnings.push(`${parsed.summary.small_amount_flagged} payment${plural(parsed.summary.small_amount_flagged)} of ₹50 or less — imported; they are usually a customer topping up, not a test.`)
    if (diff?.held.length) warnings.push(`${diff.held.length} payment${plural(diff.held.length)} held back — the UTR is already recorded (listed below).`)
  }

  const nothingNew = diff && (kind === 'billing_report'
    ? diff.new.length + diff.amended.length + (diff.confirmed?.length ?? 0) === 0
    : diff.new.length + diff.linkManual.length === 0)
  if (!blocking.length && nothingNew) warnings.push('Nothing in this file is new — importing it changes nothing.')

  return { blocking, warnings, ok: blocking.length === 0 }
}

/**
 * The rows a file holds that will NOT be imported, in two kinds a person
 * treats differently. A failed attempt is not money and is normal (the payer
 * retried); an unreadable row means the file is not what we think it is.
 * Listing both under "Could not be read" made a routine retry look like a
 * damaged file (first browser walk-through, 2026-10-10).
 */
export function notImported(kind, parsed) {
  const all = kind === 'billing_report' ? (parsed.refused ?? []) : (parsed.review ?? []).filter((r) => r.refused)
  return {
    failedAttempts: all.filter((r) => r.failed_attempt),
    unreadable: all.filter((r) => !r.failed_attempt),
  }
}

/**
 * New bills split by what they mean for money. A free-of-cost bill and a parts
 * return held for accounts are bills, but nobody owes them; one total over all
 * of them overstated what customers owe (first browser run: ₹1,13,076.72 shown,
 * ₹1,09,876.72 actually owed).
 */
export function newBillsSummary(diff) {
  const sum = (rows) => ({ n: rows.length, paise: rows.reduce((a, r) => a + (r.total_paise ?? 0), 0) })
  const rows = diff?.new ?? []
  return {
    all: sum(rows),
    payable: sum(rows.filter((r) => r.status === 'active')),
    freeOfCost: sum(rows.filter((r) => r.status === 'not_payable')),
    onHold: sum(rows.filter((r) => r.status === 'parked')),
    cancelled: sum(rows.filter((r) => r.status === 'cancelled')),
  }
}

// ── The rows behind a count (red team 4, R4-18) ──────────────────────────
// The clerk could not see the 20 bills or the 9 payments behind a number, so
// kept a parallel sheet to tie out. One line per row, in the order she ticks:
// bills by day then number, payments by time (so they fall into the same days
// as HDFC's settlement credits).

const BILL_STATUS_NOTE = {
  not_payable: 'free of cost', parked: 'parts return, waiting for accounts', cancelled: 'cancelled in SAP',
}

/** "MPI5756… · DEMO ASHA ENTERPRISE · ₹1,930 · 9 Oct" (+ why it is not owed). */
export function billRowText(v) {
  const parts = [v.invoice_number, v.customer_name || 'No name on the bill', formatINR(v.total_paise ?? 0)]
  if (v.invoice_date) parts.push(dayMonth(`${v.invoice_date}T00:00:00Z`, 'UTC'))
  if (BILL_STATUS_NOTE[v.status]) parts.push(BILL_STATUS_NOTE[v.status])
  return parts.join(' · ')
}

/** "8 Oct, 10:05 am · RAMESH SHARMA · ₹2,150" */
export function paymentRowText(r) {
  return [timeStamp(r.received_at), r.payer_name || 'No name on the payment', formatINR(r.amount_paise ?? 0)]
    .filter(Boolean).join(' · ')
}

export function sortBills(rows) {
  return [...(rows ?? [])].sort((a, b) =>
    String(a.invoice_date ?? '').localeCompare(String(b.invoice_date ?? '')) ||
    String(a.invoice_number ?? '').localeCompare(String(b.invoice_number ?? '')))
}

export function sortPayments(rows) {
  return [...(rows ?? [])].sort((a, b) => (Date.parse(a.received_at) || 0) - (Date.parse(b.received_at) || 0))
}

function dayMonth(iso, timeZone) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short' }).format(d)
}

function timeStamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/** The commit button says everything it will do, not just the new rows. */
export function importActionLabel(kind, diff) {
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`
  if (kind === 'billing_report') {
    const parts = []
    if (diff.new.length) parts.push(n(diff.new.length, 'new bill', 'new bills'))
    if (diff.amended.length) parts.push(n(diff.amended.length, 'change', 'changes'))
    if (diff.confirmed?.length) parts.push(`confirm ${n(diff.confirmed.length, 'uploaded bill', 'uploaded bills')}`)
    if (!parts.length) return 'Record this file (nothing new)'
    const verb = diff.new.length ? 'Import' : diff.amended.length ? 'Apply' : ''
    const text = parts.join(' and ')
    return verb ? `${verb} ${text}` : text.charAt(0).toUpperCase() + text.slice(1)
  }
  const parts = []
  if (diff.new.length) parts.push(n(diff.new.length, 'new payment', 'new payments'))
  if (diff.linkManual.length) parts.push(`link ${n(diff.linkManual.length, 'hand entry', 'hand entries')}`)
  if (!parts.length) return 'Record this file (nothing new)'
  return diff.new.length ? `Import ${parts.join(' and ')}` : parts[0].replace(/^link/, 'Link')
}

/** The rows to send: everything read, minus what the preview held back. */
export function rowsToCommit(kind, parsed, diff) {
  const held = new Set(diff.held.map((h) => h.row))
  const all = kind === 'billing_report' ? parsed.invoices : parsed.receipts
  // Strip client-only fields; the batch payload is a record of the FILE.
  return all.filter((r) => !held.has(r)).map(({ _row, _small, note_numbers, reg_nos, normalized_payer_name, gpay_type, gpay_paid_via, ...rest }) => rest)
}

/** What the preview promised, in the server's own vocabulary. */
export function expectedCounts(kind, diff) {
  return kind === 'billing_report'
    ? { new: diff.new.length, amended: diff.amended.length, unchanged: diff.unchanged.length,
        confirmed: diff.confirmed?.length ?? 0, conflicts: diff.conflict.length }
    // held: 0 — held rows are never sent, so the server holding any means the
    // stored data moved between the preview and the commit.
    : { new: diff.new.length, already_present: diff.already.length, already_present_manual: diff.linkManual.length, held: 0 }
}

/**
 * Did the server do what the preview said? A difference means the data moved
 * between preview and commit — someone else imported, or matched — and the
 * person should know rather than trust a summary that is no longer true.
 */
export function reconcile(expected, result) {
  // The server reports some outcomes as counts and some as lists of rows.
  const got = Object.fromEntries(Object.entries(result ?? {})
    .map(([k, v]) => [k, Array.isArray(v) ? v.length : v]))
  return Object.keys(expected)
    .filter((k) => Number(got[k] ?? 0) !== expected[k])
    .map((k) => ({ key: k, expected: expected[k], got: Number(got[k] ?? 0) }))
}

function plural(n) { return n === 1 ? '' : 's' }

function istStamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/** SHA-256 of the file's bytes, hex — the batch table refuses a repeat. */
export async function sha256Hex(arrayBuffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Bytes -> { kind, hash, parsed }. Throws with a readable message when the
 * file is not one of the three exports, or when a parser gate refuses it.
 *
 * @param {{name:string, buffer:ArrayBuffer}} file
 * @param {object} ctx
 * @param {object} ctx.XLSX            the SheetJS module — injected, so the
 *                                     browser can load it lazily and a Node
 *                                     test can pass the real one
 * @param {object} ctx.parsers         { parseBillingReport, parseBharatPe, parseGpay }
 * @param {string} ctx.entityId
 * @param {Array}  ctx.outlets
 */
export async function parseImportFile(file, { XLSX, parsers, entityId, outlets = [] }) {
  const hash = await sha256Hex(file.buffer)
  const name = String(file.name || '')
  if (/\.(xlsx|xls)$/i.test(name)) {
    if (!XLSX) throw new Error('The spreadsheet reader did not load. Reload the page and try again.')
    const wb = XLSX.read(new Uint8Array(file.buffer), { type: 'array', cellDates: false, raw: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
    // Both feeds are spreadsheets; the HDFC report is told apart by its own
    // columns (Mintoak id + RRN), never by its file name.
    if (looksLikeHdfc(rows)) return { kind: 'hdfc', hash, parsed: parsers.parseHdfcSmartHub(rows, { entityId }) }
    const parsed = parsers.parseBillingReport(rows, { entityId, outletIdByPlant: outletIdByPlant(outlets) })
    return { kind: 'billing_report', hash, parsed }
  }
  if (!/\.csv$/i.test(name)) {
    throw new Error('Choose the SAP Billing Report or the HDFC SmartHub transaction report (both .xlsx).')
  }
  const text = new TextDecoder('utf-8').decode(file.buffer)
  const kind = detectFileKind(name, text.split(/\r?\n/, 1)[0])
  if (kind === 'bharatpe') return { kind, hash, parsed: parsers.parseBharatPe(text, { entityId }) }
  if (kind === 'gpay') return { kind, hash, parsed: parsers.parseGpay(text, { entityId }) }
  throw new Error('This CSV is neither a BharatPe statement nor a Google Pay Business export — its columns match neither.')
}
