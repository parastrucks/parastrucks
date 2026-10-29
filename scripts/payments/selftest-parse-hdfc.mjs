// Self-tests for the HDFC SmartHub report parser.
//
//   node scripts/payments/selftest-parse-hdfc.mjs
//   node scripts/payments/selftest-parse-hdfc.mjs --real "<Transaction_report_….xlsx>"
//
// The second form also re-measures a REAL report and asserts the facts the
// parser was built on. The real file holds customer payments: keep it OUT of
// the repo and pass its path; this script prints counts, never names.

import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseHdfcSmartHub, looksLikeHdfc, to24h, PARSER_VERSION } from '../../src/service-payments/lib/parseHdfc.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const throws = (name, fn, re) => { try { fn(); ok(name, false, 'did not throw') } catch (e) { ok(name, re.test(e.message), e.message) } }
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

// The real header, verbatim — including the typographic apostrophe.
const HEADER = ['Transaction Date', 'Transaction Time', 'Corporate ID', 'Merchant ID', 'Terminal ID',
  'Doing Business As', 'Pincode', 'City', 'Location', 'User Mobile Number', 'description',
  'Transaction Type', 'Payment Type', 'Transaction State', 'Payment Network', 'Mintoak Transaction ID',
  'Amount(Rs.)', 'Offer Name', 'Transaction Amount', 'Discount Amount', 'Tip Amount', 'RRN No',
  'Payer’s name', 'Invoice No', 'ERP Reference Number']
let seq = 0
const row = (o = {}) => {
  const n = ++seq
  const d = { 'Transaction Date': '2026-10-07', 'Transaction Time': '05:34:19 PM', 'Corporate ID': 3442810,
    'Merchant ID': 'KTR510', 'Terminal ID': '82388473', 'Doing Business As': 'PARAS TRUCKS AND BUSES',
    Pincode: '382210', City: 'AHMEDABAD', Location: 'AHMEDA', 'User Mobile Number': '', description: 'Digital Static QR',
    'Transaction Type': 'SALE', 'Payment Type': 'BharatQR', 'Transaction State': 'SaleSuccess', 'Payment Network': '',
    'Mintoak Transaction ID': `9900000000000000${String(n).padStart(4, '0')}`, 'Amount(Rs.)': 1930, 'Offer Name': '',
    'Transaction Amount': 1930, 'Discount Amount': 0, 'Tip Amount': 0, 'RRN No': `99000000${String(n).padStart(4, '0')}`,
    'Payer’s name': 'DEMO PAYER', 'Invoice No': '', 'ERP Reference Number': '', ...o }
  return HEADER.map((h) => d[h])
}
const parse = (rows) => parseHdfcSmartHub([HEADER, ...rows], { entityId: 'E' })

// ════════════════════════════════════════════════════════════════════════════
section('recognising the report')
{
  ok('the real header is recognised as HDFC', looksLikeHdfc([HEADER]))
  ok('a Billing Report is not', !looksLikeHdfc([['Billing Report'], ['No. of entries', '1']]))
  const plain = HEADER.map((h) => h.replace('’', "'"))
  eq('a plain apostrophe in "Payer\'s name" is read the same', parseHdfcSmartHub([plain, row()]).receipts.length, 1)
  throws('a missing column is a hard failure that names it',
    () => parseHdfcSmartHub([HEADER.filter((h) => h !== 'RRN No'), row()]), /missing column.*RRN No/)
  eq('parser version is recorded', parse([row()]).parser_version, PARSER_VERSION)
}

// ════════════════════════════════════════════════════════════════════════════
section('time: a 12-hour clock, in IST')
{
  eq('PM', to24h('05:34:19 PM'), '17:34:19')
  eq('12 PM is noon', to24h('12:05:00 PM'), '12:05:00')
  eq('12 AM is midnight', to24h('12:05:00 AM'), '00:05:00')
  eq('AM unchanged', to24h('09:15:00 AM'), '09:15:00')
  throws('a 24-hour time is not guessed at', () => to24h('17:34:19'), /unreadable/)
  throws('hour 13 PM is refused', () => to24h('13:00:00 PM'), /unreadable/)
  eq('5:34:19 PM IST on 7 Oct is 12:04:19 UTC', parse([row()]).receipts[0].received_at, '2026-10-07T12:04:19.000Z')
  eq('12:30 AM IST on 7 Oct is still the 6th in UTC', parse([row({ 'Transaction Time': '12:30:00 AM' })]).receipts[0].received_at,
     '2026-10-06T19:00:00.000Z')
}

// ════════════════════════════════════════════════════════════════════════════
section('only successful sales are money')
{
  const r = parse([
    row({ 'Transaction State': 'SaleFailed', 'Transaction Amount': 1000, 'Amount(Rs.)': 1000 }),
    row({ 'Transaction Amount': 1000, 'Amount(Rs.)': 1000 }),
  ])
  eq('the failed attempt is not a receipt; its successful retry is', r.receipts.length, 1)
  eq('...and the failure is listed, refused, with its reason', [r.summary.refused, r.summary.failed_attempts], [1, 1])
  ok('...in words', (r.review[0]?.reason ?? '').includes('failed attempt'))
  const odd = parse([row({ 'Transaction State': 'Pending' })])
  ok('an unknown state is refused, never guessed', odd.receipts.length === 0 && (odd.review[0]?.reason ?? '').includes('Pending'))
  const refund = parse([row({ 'Transaction Type': 'REFUND' })])
  ok('a refund is held for a person, not imported as money', refund.receipts.length === 0 && (refund.review[0]?.reason ?? '').includes('REFUND'))
}

// ════════════════════════════════════════════════════════════════════════════
section('the fields that become a receipt')
{
  const rec = parse([row({ 'Transaction Amount': 1234.5, 'Amount(Rs.)': 1234.5, 'Payer’s name': 'Mr. Narender Yadav' })]).receipts[0]
  eq('source and mode', [rec.source, rec.mode], ['hdfc', 'upi'])
  eq('amount in paise, from a decimal', rec.amount_paise, 123450)
  eq('gross equals amount, no fee (measured: settlement equals the sum)', [rec.gross_paise, rec.fee_paise], [123450, 0])
  ok('the Mintoak id is the transaction id, as text', typeof rec.external_txn_id === 'string' && rec.external_txn_id.length === 20)
  ok('the RRN is the bank reference (UTR)', /^\d{12}$/.test(rec.normalized_utr))
  eq('the QR is recorded as merchant/terminal', rec.qr_ref, 'KTR510/82388473')
  eq('the payer name is normalised for matching', rec.normalized_payer_name, 'NARENDER YADAV')
  eq('there is no note in this feed', [rec.payer_remark, rec.note_numbers, rec.reg_nos], [null, [], []])
}

// ════════════════════════════════════════════════════════════════════════════
section('refusals that protect the money')
{
  const numeric = parse([row({ 'Mintoak Transaction ID': 99000000000000001234 })])
  ok('an id that Excel turned into a NUMBER is refused — its digits are already lost',
     numeric.receipts.length === 0 && (numeric.review[0]?.reason ?? '').includes('arrived as a number'))
  const mism = parse([row({ 'Amount(Rs.)': 1931 })])
  ok('the two amount columns must agree', mism.receipts.length === 0 && (mism.review[0]?.reason ?? '').includes('disagrees'))
  const rrn = parse([row({ 'RRN No': '12345' })])
  ok('an RRN that is not 12 digits is refused', rrn.receipts.length === 0 && (rrn.review[0]?.reason ?? '').includes('RRN'))
  const zero = parse([row({ 'Transaction Amount': 0, 'Amount(Rs.)': 0 })])
  ok('a zero amount is refused', zero.receipts.length === 0)
  const date = parse([row({ 'Transaction Date': '07/10/2026' })])
  ok('a date in another format is refused, not guessed (07/10 is ambiguous)', date.receipts.length === 0 && (date.review[0]?.reason ?? '').includes('Date'))
  const twice = parse([row({ 'Mintoak Transaction ID': '99000000000000009999' }), row({ 'Mintoak Transaction ID': '99000000000000009999' })])
  eq('the same id twice inside one file is reported (the Import gate blocks it)', twice.summary.duplicate_txn_ids.length, 1)
  const small = parse([row({ 'Transaction Amount': 30, 'Amount(Rs.)': 30 })])
  eq('₹30 is imported and flagged, not refused', [small.receipts.length, small.summary.small_amount_flagged], [1, 1])
  const blanks = parseHdfcSmartHub([HEADER, row(), [null, null], []])
  eq('blank trailing rows are ignored', blanks.summary.rows_in_file, 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('the settlement check')
{
  const r = parse([
    row({ 'Transaction Date': '2026-10-07', 'Transaction Amount': 100000, 'Amount(Rs.)': 100000 }),
    row({ 'Transaction Date': '2026-10-07', 'Transaction Amount': 48693, 'Amount(Rs.)': 48693 }),
    row({ 'Transaction Date': '2026-10-07', 'Transaction State': 'SaleFailed', 'Transaction Amount': 1000, 'Amount(Rs.)': 1000 }),
    row({ 'Transaction Date': '2026-10-08', 'Transaction Amount': 500, 'Amount(Rs.)': 500 }),
  ])
  eq('successful money per IST day — what the next day\'s settlement must equal',
     r.summary.settles_by_day_paise, { '2026-10-07': 14869300, '2026-10-08': 50000 })
}

// ════════════════════════════════════════════════════════════════════════════
const realIdx = process.argv.indexOf('--real')
if (realIdx > -1) {
  section('THE REAL REPORT — asserting what the parser was built on')
  const file = process.argv[realIdx + 1]
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', raw: true })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
  ok('it is recognised as an HDFC report', looksLikeHdfc(rows))
  const r = parseHdfcSmartHub(rows, { entityId: 'E' })
  console.log(`  (${r.summary.rows_in_file} rows · ${r.receipts.length} receipts · ${r.summary.refused} refused · ` +
    `${r.summary.failed_attempts} failed attempts · QRs ${JSON.stringify(r.summary.qrs)})`)
  eq('every row is either a receipt or a failed attempt — nothing else refused',
     r.receipts.length + r.summary.failed_attempts, r.summary.rows_in_file)
  eq('no duplicate ids', r.summary.duplicate_txn_ids.length, 0)
  ok('every receipt has a 12-digit RRN and a QR', r.receipts.every((x) => /^\d{12}$/.test(x.normalized_utr) && x.qr_ref))
  // HDFC's own credit, read from the bank's alert email of 8 Oct:
  // "UPI SETTLEMENT -KTR510- 08/10/26", INR 1,48,693.00.
  if (r.summary.settles_by_day_paise['2026-10-07'] !== undefined) {
    eq('7 Oct successful payments equal HDFC\'s 8 Oct settlement credit of ₹1,48,693, to the rupee',
       r.summary.settles_by_day_paise['2026-10-07'], 14869300)
  }
}

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
