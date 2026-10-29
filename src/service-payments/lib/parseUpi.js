// Parsers for the two UPI exports the dealership actually uses.
//
// There are exactly two: Google Pay Business and BharatPe (owner). Every rule
// below was derived from the four real exports on disk — July and August of
// both providers, 1,079 rows in total — not from the providers' documentation.
//
// A parser never drops a row. Anything it will not turn into a receipt comes
// back in `review` with a reason attached, because money that reached the
// merchant account and then vanished from the tool is the one failure this
// feature cannot survive.

import { parseCSV, toRecords } from './csv.js'
import { rupeeStringToPaise } from './paise.js'
import { istLocalToInstant } from './dates.js'

export const PARSER_VERSION = 'upi-2026-08-30'

/** Below this, a receipt is flagged for a second look — but still imported. */
export const SMALL_AMOUNT_PAISE = 50 * 100

// ── Signals hiding in free text ────────────────────────────────────────────

/**
 * Bill/job numbers a customer typed into the Google Pay note.
 *
 * The rule that matters: a digit run is only a bill number if the character
 * before it is NOT a letter. Measured against the real notes, that single
 * condition is what separates "6719Work" and "urea 7458" (real bill numbers)
 * from "DD01C9924 TOOL SCANNING", where a naive \d{3,} match yields "9924" —
 * the tail of a vehicle registration, and a confident wrong answer.
 *
 * @param {string} note
 * @returns {string[]}
 */
export function extractNoteNumbers(note) {
  const s = String(note ?? '')
  const out = []
  const re = /(?<![A-Za-z0-9])(\d{3,6})(?![0-9])/g
  let m
  while ((m = re.exec(s)) !== null) out.push(m[1])
  return [...new Set(out)]
}

/**
 * Indian vehicle registrations in free text, e.g. "GJ03BY9163", "DD01C9924".
 * A weaker signal than a bill number, but the Billing Report carries Reg.No on
 * every job-card invoice, so it is worth extracting.
 */
export function extractRegNos(note) {
  const s = String(note ?? '').toUpperCase().replace(/[\s-]/g, '')
  const out = []
  const re = /([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4})/g
  let m
  while ((m = re.exec(s)) !== null) out.push(m[1])
  return [...new Set(out)]
}

/**
 * Payer names for matching and for payer memory. Case-folded, punctuation
 * dropped, honorifics and whitespace normalised.
 *
 * Deliberately NOT transliterated or phonetically collapsed here — that belongs
 * in the ranking layer, where a wrong guess is a lower score rather than a
 * wrong key in a memory table.
 */
export function normalizePayerName(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(MR|MRS|MS|SHRI|SMT|M\/S|MESSRS)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── BharatPe ───────────────────────────────────────────────────────────────

const BHARATPE_REQUIRED = [
  'Transaction Date and Time', 'Received From', 'Transaction ID',
  'Transaction Amount', 'Net MDR (Inclusive GST)',
]

/**
 * BharatPe QR statement.
 *
 * Measured shape (532 rows July, 303 August): every row is `BharatPe QR` / `UPI`,
 * the Transaction ID is always 12 digits and IS a real bank UTR, payer names are
 * full legal names, and there is no notes column at all.
 *
 * ⚠️ `Amount Added` is deliberately NOT imported. BharatPe rounds it to ONE
 * decimal place, so on every row that carries MDR it disagrees with
 * (Transaction Amount − Net MDR) by up to 4 paise — 13 such rows across the two
 * files. Trusting it would put a few paise of invented error into the ledger on
 * exactly the rows that already have a fee. Gross and MDR are exact; the net is
 * derived when it is needed.
 */
export function parseBharatPe(text, { entityId = null } = {}) {
  const { header, records } = toRecords(parseCSV(text), BHARATPE_REQUIRED)

  const receipts = []
  const review = []

  records.forEach((r, i) => {
    const rowNo = i + 2  // 1-based, plus the header
    const txnId = (r['Transaction ID'] || '').trim()
    try {
      if (!txnId) throw new Error('blank Transaction ID')

      // Keep the id as TEXT: 22 of 532 July ids begin with a zero, and a
      // numeric round-trip would destroy them and then collide.
      if (!/^\d{6,}$/.test(txnId)) throw new Error(`Transaction ID is not a UTR: ${txnId}`)

      const amountPaise = rupeeStringToPaise(r['Transaction Amount'])
      if (amountPaise <= 0) throw new Error(`non-positive amount: ${r['Transaction Amount']}`)
      const feePaise = rupeeStringToPaise(r['Net MDR (Inclusive GST)'] || '0')

      const receivedAt = istLocalToInstant(r['Transaction Date and Time'])
      const payerName = (r['Received From'] || '').trim() || null

      receipts.push({
        source: 'bharatpe',
        mode: 'upi',
        entity_id: entityId,
        external_txn_id: txnId,
        normalized_utr: txnId.replace(/\D/g, ''),
        amount_paise: amountPaise,
        gross_paise: amountPaise,
        fee_paise: feePaise,
        received_at: receivedAt,
        payer_name: payerName,
        normalized_payer_name: normalizePayerName(payerName),
        payer_remark: null,
        note_numbers: [],
        reg_nos: [],
        _row: rowNo,
        _small: amountPaise <= SMALL_AMOUNT_PAISE,
      })

      if (amountPaise <= SMALL_AMOUNT_PAISE) {
        // Advisory only — see the note on the summary below.
        review.push({ row: rowNo, reason: 'small amount, imported anyway', txnId, amount_paise: amountPaise })
      }
    } catch (e) {
      review.push({ row: rowNo, reason: e.message, txnId, raw: r, refused: true })
    }
  })

  return summarize({ source: 'bharatpe', header, records, receipts, review })
}

// ── Google Pay Business ────────────────────────────────────────────────────

const GPAY_REQUIRED = [
  'Payer/Receiver', 'Type', 'Creation time', 'Transaction ID',
  'Amount', 'Processing fee', 'Status',
]

/**
 * Google Pay Business transactions export.
 *
 * Measured shape (97 rows July, 147 August). Three things caught here that a
 * from-first-principles parser gets wrong:
 *
 *  1. `Type` is not always "UPI". Two July rows are "Wallet" — ₹3,860 and
 *     ₹9,263.87, both with real customer notes ("5065 Urea", "5912 Repair").
 *     Filtering on Type === 'UPI' would have silently discarded ₹13,124 of
 *     genuine customer money. Type is recorded, never used to exclude.
 *  2. `Paid via` is "Unknown app" on the MAJORITY of rows (83 of 147 in
 *     August) — customers paying the Google Pay QR from PhonePe and others.
 *     Those are ordinary receipts.
 *  3. The payer name is sometimes BLANK (11 August rows) on payments as large
 *     as ₹25,000. A blank name is a weak match, not a bad row.
 *
 * `Transaction ID` is a Google-internal code, NOT a bank UTR, so normalized_utr
 * stays null and these rows never participate in cross-source UTR de-duplication.
 */
export function parseGpay(text, { entityId = null } = {}) {
  const { header, records } = toRecords(parseCSV(text), GPAY_REQUIRED)

  const receipts = []
  const review = []

  records.forEach((r, i) => {
    const rowNo = i + 2
    const txnId = (r['Transaction ID'] || '').trim()
    try {
      if (!txnId) throw new Error('blank Transaction ID')

      const status = (r['Status'] || '').trim()
      if (status.toLowerCase() !== 'settled') {
        // Money that has not settled has not arrived. Held, not imported.
        review.push({ row: rowNo, reason: `status is "${status}", not Settled`, txnId, raw: r, refused: true })
        return
      }

      const amountPaise = rupeeStringToPaise(r['Amount'])
      if (amountPaise <= 0) throw new Error(`non-positive amount: ${r['Amount']}`)
      const feePaise = rupeeStringToPaise(r['Processing fee'] || '0')

      const receivedAt = istLocalToInstant(r['Creation time'])
      const payerName = (r['Payer/Receiver'] || '').trim() || null
      const note = (r['Notes'] || '').trim() || null

      receipts.push({
        source: 'gpay',
        mode: 'upi',
        entity_id: entityId,
        external_txn_id: txnId,
        normalized_utr: null,          // Google-internal id: not a bank reference
        amount_paise: amountPaise,
        gross_paise: amountPaise,
        fee_paise: feePaise,
        received_at: receivedAt,
        payer_name: payerName,
        normalized_payer_name: normalizePayerName(payerName),
        payer_remark: note,
        note_numbers: extractNoteNumbers(note),
        reg_nos: extractRegNos(note),
        gpay_type: (r['Type'] || '').trim(),      // 'UPI' or 'Wallet' — recorded, not filtered
        gpay_paid_via: (r['Paid via'] || '').trim(),
        _row: rowNo,
        _small: amountPaise <= SMALL_AMOUNT_PAISE,
      })

      if (amountPaise <= SMALL_AMOUNT_PAISE) {
        review.push({ row: rowNo, reason: 'small amount, imported anyway', txnId, amount_paise: amountPaise })
      }
    } catch (e) {
      review.push({ row: rowNo, reason: e.message, txnId, raw: r, refused: true })
    }
  })

  return summarize({ source: 'gpay', header, records, receipts, review })
}

// ── Shared tail ────────────────────────────────────────────────────────────

function summarize({ source, header, records, receipts, review }) {
  // A duplicate transaction id inside ONE file means the export itself is
  // broken; the database unique index would reject the second row later and
  // blame the wrong thing, so say it here.
  const seen = new Map()
  const dupes = []
  for (const rec of receipts) {
    if (seen.has(rec.external_txn_id)) dupes.push({ txnId: rec.external_txn_id, rows: [seen.get(rec.external_txn_id), rec._row] })
    else seen.set(rec.external_txn_id, rec._row)
  }

  const refused = review.filter((r) => r.refused)

  return {
    parser_version: PARSER_VERSION,
    source,
    header,
    receipts,
    review,
    summary: {
      rows_in_file: records.length,
      receipts: receipts.length,
      refused: refused.length,
      // Advisory, NOT an exclusion. The plan proposed treating anything under
      // ₹50 as a test transaction and withholding it. The real files say
      // otherwise: one ₹30 credit arrives five minutes after ₹1,900 from the
      // SAME payer — a customer topping up, not a test. Small amounts are
      // imported and merely flagged.
      small_amount_flagged: receipts.filter((r) => r._small).length,
      duplicate_txn_ids: dupes,
      total_paise: receipts.reduce((a, r) => a + r.amount_paise, 0),
      fee_paise: receipts.reduce((a, r) => a + (r.fee_paise || 0), 0),
    },
  }
}
