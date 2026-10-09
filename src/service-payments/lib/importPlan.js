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
  bharatpe: 'BharatPe statement',
  gpay: 'Google Pay Business export',
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
    invoice_number: row.invoice_number,
    sap_customer_code: c?.sap_customer_code ?? undefined,   // undefined = could not read
    customer_name: row.customer_name ?? null,
    total_paise: Number(row.total_paise),
    allocated_paise: Number(row.allocated_paise ?? 0),
    status: row.status,
    cancelled_flag: row.cancelled_flag ?? null,
  }
}

/**
 * What importing these bills would do — the server's rules, row by row.
 *
 * Mirrors payments_import_invoices (as of 20260926_payments_import_rules.sql):
 *   no such number                                -> new
 *   different customer                            -> conflict (number reused / wrong file)
 *   new total below what is already paid          -> conflict
 *   no longer active while money is matched to it -> conflict (it would strand the money)
 *   total, status or cancelled flag differ        -> amended
 *   otherwise                                     -> unchanged
 */
export function diffInvoices(parsed, existing) {
  const byNumber = new Map(existing.map((e) => [e.invoice_number, e]))
  const out = { new: [], amended: [], unchanged: [], conflict: [], held: [] }
  for (const v of parsed) {
    const e = byNumber.get(v.invoice_number)
    if (!e) { out.new.push(v); continue }
    if (e.sap_customer_code === undefined) {
      out.held.push({ row: v, reason: 'could not read the existing bill’s customer — reload and try again' })
      continue
    }
    if (e.sap_customer_code !== v.sap_customer_code) {
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
    if (!changed.length) { out.unchanged.push(v); continue }
    if (status !== 'active' && e.status === 'active' && e.allocated_paise > 0) {
      out.conflict.push({ row: v, reason: `SAP now marks it ${status}, but ₹${(e.allocated_paise / 100).toLocaleString('en-IN')} is already matched to it — reverse that match first` })
      continue
    }
    out.amended.push({ row: v, was: e, changed })
  }
  return out
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
    blocking.push(`This exact file was already imported${priorBatch.uploaded_at ? ` on ${istStamp(priorBatch.uploaded_at)}` : ''}` +
      `${priorBatch.file_name ? ` as “${priorBatch.file_name}”` : ''}. Nothing in it is new.`)
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
    if (diff?.conflict.length) warnings.push(`${diff.conflict.length} bill${plural(diff.conflict.length)} clash with what is stored and will be left as they are (listed below).`)
    if (diff?.held.length) warnings.push(`${diff.held.length} bill${plural(diff.held.length)} held back — importing them would strand money already matched (listed below).`)
  } else {
    const dupes = parsed.summary.duplicate_txn_ids || []
    if (dupes.length) {
      blocking.push(`The same transaction id appears twice inside this file (${dupes.slice(0, 3).map((d) => `rows ${d.rows.join(' & ')}`).join('; ')}). The export is broken — download it again.`)
    }
    if (parsed.receipts.length === 0) blocking.push('No payment in this file could be read.')
    if (parsed.receipts.length > MAX_ROWS_PER_IMPORT) blocking.push(`More than ${MAX_ROWS_PER_IMPORT} payments — export a shorter date range.`)
    const refused = parsed.review.filter((r) => r.refused)
    if (refused.length) warnings.push(`${refused.length} row${plural(refused.length)} not imported (not settled, or unreadable — listed below).`)
    if (parsed.summary.small_amount_flagged) warnings.push(`${parsed.summary.small_amount_flagged} payment${plural(parsed.summary.small_amount_flagged)} of ₹50 or less — imported; they are usually a customer topping up, not a test.`)
    if (diff?.held.length) warnings.push(`${diff.held.length} payment${plural(diff.held.length)} held back — the UTR is already recorded (listed below).`)
  }

  const nothingNew = diff && (kind === 'billing_report'
    ? diff.new.length + diff.amended.length === 0
    : diff.new.length + diff.linkManual.length === 0)
  if (!blocking.length && nothingNew) warnings.push('Nothing in this file is new — importing it changes nothing.')

  return { blocking, warnings, ok: blocking.length === 0 }
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
    ? { new: diff.new.length, amended: diff.amended.length, unchanged: diff.unchanged.length, conflicts: diff.conflict.length }
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
    const parsed = parsers.parseBillingReport(rows, { entityId, outletIdByPlant: outletIdByPlant(outlets) })
    return { kind: 'billing_report', hash, parsed }
  }
  if (!/\.csv$/i.test(name)) {
    throw new Error('Choose the SAP Billing Report (.xlsx), or a BharatPe or Google Pay export (.csv).')
  }
  const text = new TextDecoder('utf-8').decode(file.buffer)
  const kind = detectFileKind(name, text.split(/\r?\n/, 1)[0])
  if (kind === 'bharatpe') return { kind, hash, parsed: parsers.parseBharatPe(text, { entityId }) }
  if (kind === 'gpay') return { kind, hash, parsed: parsers.parseGpay(text, { entityId }) }
  throw new Error('This CSV is neither a BharatPe statement nor a Google Pay Business export — its columns match neither.')
}
