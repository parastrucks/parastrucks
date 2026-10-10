// Parser for the HDFC SmartHub Vyapar "Transaction Report" — the UPI feed from
// October 2026, when HDFC's static QRs replaced BharatPe and Google Pay
// (owner: both retired). Accounts downloads it daily and uploads it on the
// Import screen until HDFC's API arrives.
//
// Measured on the first real report (6–8 Oct 2026, 18 rows, merchant KTR510):
//  · One sheet, header in ROW 1, 25 columns.
//  · `Transaction State` is SaleSuccess or SaleFailed. All 3 failed rows were
//    followed the same day by a SUCCESSFUL retry of the same amount — so a
//    failed row imported as money would count that payment twice.
//  · Successful payments on 7 Oct total ₹1,48,693, which is EXACTLY HDFC's
//    "UPI SETTLEMENT -KTR510- 08/10/26" credit: amounts are gross (no fee is
//    deducted), settlement is the whole previous day, and the success filter
//    is the right one. Counting the failed ₹1,000 would have broken the tie.
//  · `Mintoak Transaction ID` (19–20 digits) is unique per row — the dedup key.
//    `RRN No` (12 digits) is the bank reference a payer can see on their own
//    phone, so it is what a cashier would type when keying a payment by hand.
//  · `Merchant ID` + `Terminal ID` identify the QR. One QR today; more coming,
//    so it is recorded on every receipt (it RANKS bills by branch, never
//    filters them — owner, 2026-09-11).
//  · There is NO note field. The plate numbers that Google Pay notes carried
//    (17 of 28 numbers in August) do not exist in this feed.

import { rupeeStringToPaise } from './paise.js'
import { istLocalToInstant } from './dates.js'
import { normalizePayerName, SMALL_AMOUNT_PAISE } from './parseUpi.js'

export const PARSER_VERSION = 'hdfc-smarthub-2026-10-09'

// The apostrophe in "Payer’s name" is a typographic one in the real file.
// Headers are matched after folding quotes, so a re-export with a plain ' works.
export const REQUIRED = [
  'Transaction Date', 'Transaction Time', 'Merchant ID', 'Terminal ID',
  'Transaction Type', 'Transaction State', 'Mintoak Transaction ID',
  'Transaction Amount', 'RRN No', "Payer's name",
]
const fold = (s) => String(s ?? '').trim().replace(/[’‘`]/g, "'")

/** Is this sheet (array of rows) an HDFC SmartHub report? Used to tell xlsx kinds apart. */
export function looksLikeHdfc(rows) {
  const header = (rows?.[0] || []).map(fold)
  return header.includes('Mintoak Transaction ID') && header.includes('RRN No')
}

/** "05:34:19 PM" -> "17:34:19". Refuses anything else rather than guessing. */
export function to24h(t) {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) throw new Error(`unreadable Transaction Time: ${JSON.stringify(t)}`)
  let h = Number(m[1])
  if (h < 1 || h > 12) throw new Error(`unreadable Transaction Time: ${JSON.stringify(t)}`)
  const pm = m[4].toUpperCase() === 'PM'
  if (h === 12) h = pm ? 12 : 0
  else if (pm) h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}:${m[3]}`
}

/**
 * @param {any[][]} rows  first sheet as an array of arrays (SheetJS header:1, raw:true)
 * @returns same shape as parseBharatPe / parseGpay, so the Import screen's
 *          gates, preview and commit treat it identically.
 */
export function parseHdfcSmartHub(rows, { entityId = null } = {}) {
  if (!Array.isArray(rows) || rows.length < 1) throw new Error('HDFC report is empty')
  const header = (rows[0] || []).map(fold)
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(`HDFC report is missing column(s): ${missing.join(', ')}. ` +
      `Found: ${header.filter(Boolean).join(', ')}`)
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]).reverse())
  const cell = (r, name) => r[idx[name]]
  const text = (r, name) => { const v = cell(r, name); return v === null || v === undefined ? '' : String(v).trim() }

  const body = rows.slice(1)
    .map((r, i) => ({ r, rowNo: i + 2 }))
    .filter(({ r }) => Array.isArray(r) && r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))

  const receipts = []
  const review = []
  for (const { r, rowNo } of body) {
    const idCell = cell(r, 'Mintoak Transaction ID')
    const txnId = text(r, 'Mintoak Transaction ID')
    try {
      // A 19–20 digit id stored as an Excel NUMBER has already lost digits —
      // past 15 significant figures a spreadsheet rounds. Two different
      // payments could then share an id and one would be dropped as a
      // "duplicate". Refuse rather than import a damaged key.
      if (typeof idCell === 'number') {
        throw new Error('Mintoak Transaction ID arrived as a number, so its last digits are lost — re-download the report without opening and saving it in Excel')
      }
      if (!/^\d{10,}$/.test(txnId)) throw new Error(`Mintoak Transaction ID is not an id: ${JSON.stringify(txnId)}`)

      const state = text(r, 'Transaction State')
      if (state !== 'SaleSuccess') {
        // Not money. Measured: every failed attempt was retried successfully.
        // Flagged, not recognised by its wording, and carrying what a person
        // needs to find the retry: the amount, the payer and when.
        const failed = state === 'SaleFailed'
        let amount_paise = null
        try { amount_paise = rupeeStringToPaise(cell(r, 'Transaction Amount')) } catch { /* shown without it */ }
        review.push({ row: rowNo, txnId, refused: true, failed_attempt: failed,
          amount_paise, payer_name: text(r, "Payer's name") || null,
          when: `${text(r, 'Transaction Date')} ${text(r, 'Transaction Time')}`.trim(),
          reason: failed ? 'a failed attempt — not money received' : `transaction state is "${state}", not SaleSuccess` })
        continue
      }
      const type = text(r, 'Transaction Type')
      if (type !== 'SALE') {
        // Refunds and voids will appear here one day. Until their meaning is
        // confirmed they are held for a person, never imported as receipts.
        review.push({ row: rowNo, txnId, refused: true, reason: `transaction type "${type}" is not a sale` })
        continue
      }

      const amountPaise = rupeeStringToPaise(cell(r, 'Transaction Amount'))
      if (amountPaise <= 0) throw new Error(`non-positive amount: ${cell(r, 'Transaction Amount')}`)
      // Cross-foot: the report carries the amount twice. They agree on every
      // real row; disagreement means a column is not what we think it is.
      if (idx['Amount(Rs.)'] !== undefined && text(r, 'Amount(Rs.)') !== '') {
        const again = rupeeStringToPaise(cell(r, 'Amount(Rs.)'))
        if (again !== amountPaise) throw new Error(`Amount(Rs.) ${again}p disagrees with Transaction Amount ${amountPaise}p`)
      }

      const date = text(r, 'Transaction Date')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`unreadable Transaction Date: ${JSON.stringify(date)}`)
      const receivedAt = istLocalToInstant(`${date} ${to24h(text(r, 'Transaction Time'))}`)

      const rrn = text(r, 'RRN No').replace(/\D/g, '')
      if (!/^\d{12}$/.test(rrn)) throw new Error(`RRN No is not a 12-digit bank reference: ${JSON.stringify(text(r, 'RRN No'))}`)

      const payerName = text(r, "Payer's name") || null
      const merchant = text(r, 'Merchant ID'), terminal = text(r, 'Terminal ID')
      receipts.push({
        source: 'hdfc',
        mode: 'upi',
        entity_id: entityId,
        external_txn_id: txnId,
        normalized_utr: rrn,
        qr_ref: merchant && terminal ? `${merchant}/${terminal}` : (merchant || terminal || null),
        amount_paise: amountPaise,
        gross_paise: amountPaise,
        fee_paise: 0,
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
        review.push({ row: rowNo, txnId, amount_paise: amountPaise, reason: 'small amount, imported anyway' })
      }
    } catch (e) {
      review.push({ row: rowNo, txnId, refused: true, reason: e.message })
    }
  }

  const seen = new Map()
  const dupes = []
  for (const rec of receipts) {
    if (seen.has(rec.external_txn_id)) dupes.push({ txnId: rec.external_txn_id, rows: [seen.get(rec.external_txn_id), rec._row] })
    else seen.set(rec.external_txn_id, rec._row)
  }
  const byDay = {}
  for (const rec of receipts) {
    const d = rec.received_at && new Date(Date.parse(rec.received_at) + 330 * 60000).toISOString().slice(0, 10)
    byDay[d] = (byDay[d] || 0) + rec.amount_paise
  }

  return {
    parser_version: PARSER_VERSION,
    source: 'hdfc',
    header,
    receipts,
    review,
    summary: {
      rows_in_file: body.length,
      receipts: receipts.length,
      refused: review.filter((x) => x.refused).length,
      failed_attempts: review.filter((x) => x.failed_attempt).length,
      small_amount_flagged: receipts.filter((x) => x._small).length,
      duplicate_txn_ids: dupes,
      total_paise: receipts.reduce((a, x) => a + x.amount_paise, 0),
      fee_paise: 0,
      // Successful money per IST day — the number HDFC's next-day
      // "UPI SETTLEMENT -<merchant>-" credit must equal.
      settles_by_day_paise: byDay,
      qrs: [...new Set(receipts.map((x) => x.qr_ref))],
    },
  }
}
