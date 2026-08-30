// Self-tests for the Service Payments parsers and money/date primitives.
//
//   node scripts/payments/selftest-parsers.mjs
//       synthetic tests only — no files, no network, no database
//
//   node scripts/payments/selftest-parsers.mjs --billing "<Billing Report.xlsx>" \
//        --bharatpe "<statement.csv>" --gpay "<GPay....csv>"
//       additionally re-measures the REAL exports and asserts the numbers this
//       design was derived from, so a future file that drifts is caught here
//       rather than in production.
//
// The source files are commercial + personal data and are gitignored, which is
// why they arrive as arguments and never as fixtures.

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as XLSX from 'xlsx'

import {
  rupeeStringToPaise, paiseToRupeeString, formatINR, sumPaise, assertPaise,
} from '../../src/service-payments/lib/paise.js'
import {
  istLocalToInstant, excelSerialToISODate, istDateOf, financialYearOf,
} from '../../src/service-payments/lib/dates.js'
import { parseCSV, toRecords } from '../../src/service-payments/lib/csv.js'
import {
  parseBharatPe, parseGpay, extractNoteNumbers, extractRegNos, normalizePayerName,
} from '../../src/service-payments/lib/parseUpi.js'
import {
  parseBillingReport, PREFIX_MAP, HEADER_ROW_INDEX,
} from '../../src/service-payments/lib/parseBillingReport.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, actual, expected) =>
  ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
     `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
const throws = (name, fn, match) => {
  try { fn(); fail++; console.log(`  FAIL  ${name} — expected a throw, got none`) }
  catch (e) {
    if (!match || e.message.includes(match)) { pass++; console.log(`  PASS  ${name}`) }
    else { fail++; console.log(`  FAIL  ${name} — wrong message: "${e.message}"`) }
  }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

// ════════════════════════════════════════════════════════════════════════════
section('paise — integer money, never a float')

eq('whole rupees',            rupeeStringToPaise('1930'), 193000)
eq('one decimal place',       rupeeStringToPaise('1930.0'), 193000)
eq('two decimal places',      rupeeStringToPaise('1930.00'), 193000)
eq('real paise',              rupeeStringToPaise('9263.87'), 926387)
eq('the float trap: 19.30',   rupeeStringToPaise('19.30'), 1930)
eq('thousands separators',    rupeeStringToPaise('1,93,000.50'), 19300050)
eq('rupee symbol and spaces', rupeeStringToPaise(' ₹1,930.00 '), 193000)
eq('a number cell',           rupeeStringToPaise(1930), 193000)
eq('a float cell',            rupeeStringToPaise(9263.87), 926387)
eq('negative',                rupeeStringToPaise('-50.25'), -5025)
eq('bare fraction',           rupeeStringToPaise('.5'), 50)

// The exactness proof. Values verified empirically on this runtime rather than
// assumed: 19.30 * 100 happens to land exactly, but 8.20 and 1.10 do not, and a
// thousand float additions drift by ~4e-10 — which is how a rupee eventually
// goes missing from a day's total.
eq('1000 x 19.30 is exact', sumPaise(Array(1000).fill(rupeeStringToPaise('19.30'))), 1930000)
ok('float multiplication is not exact for 8.20', 8.20 * 100 !== 820)
ok('float multiplication is not exact for 1.10', 1.10 * 100 !== 110)
ok('float addition drifts over 1000 amounts', (() => {
  let s = 0; for (let i = 0; i < 1000; i++) s += 19.30; return s !== 19300
})())
eq('the integer path does not drift', (() => {
  let s = 0; for (let i = 0; i < 1000; i++) s += rupeeStringToPaise('19.30'); return s
})(), 1930000)

throws('empty is refused',        () => rupeeStringToPaise(''), 'empty')
throws('null is refused',         () => rupeeStringToPaise(null), 'empty')
throws('text is refused',         () => rupeeStringToPaise('abc'), 'not a number')
throws('3 decimals is refused',   () => rupeeStringToPaise('1.234'), 'more than 2 decimal places')
throws('scientific is refused',   () => rupeeStringToPaise('1.93e3'), 'scientific notation')
throws('Infinity is refused',     () => rupeeStringToPaise(Infinity), 'not finite')
throws('NaN is refused',          () => rupeeStringToPaise(NaN), 'not finite')

eq('back to a string',   paiseToRupeeString(926387), '9263.87')
eq('pads the paise',     paiseToRupeeString(193000), '1930.00')
eq('negative round-trip', paiseToRupeeString(-5025), '-50.25')
eq('Indian grouping',    formatINR(1930000000), '₹1,93,00,000.00')
eq('small amount',       formatINR(3000), '₹30.00')
throws('a float is not paise', () => assertPaise(19.3), 'integer number of paise')

// ════════════════════════════════════════════════════════════════════════════
section('dates — Asia/Kolkata, independent of the machine')

eq('IST local to instant', istLocalToInstant('2026-08-01 11:34:21'), '2026-08-01T06:04:21.000Z')
eq('midnight IST',         istLocalToInstant('2026-08-01 00:00:00'), '2026-07-31T18:30:00.000Z')
eq('seconds optional',     istLocalToInstant('2026-08-01 11:34'),    '2026-08-01T06:04:00.000Z')
throws('garbage date-time', () => istLocalToInstant('01-08-2026'), 'not a recognised date-time')

// The measured serials from the real Billing Report.
eq('Excel serial 46235', excelSerialToISODate(46235), '2026-08-01')
eq('Excel serial 46237', excelSerialToISODate(46237), '2026-08-03')
eq('Excel serial 46263', excelSerialToISODate(46263), '2026-08-29')
// Excel thinks 1900 was a leap year, so serials 1-60 display one day off from
// real arithmetic. Refused rather than silently disagreeing with the user's own
// spreadsheet.
throws('serial 60 refused (Excel leap-year bug)', () => excelSerialToISODate(60), 'leap-year-bug range')
throws('serial 0 refused',            () => excelSerialToISODate(0), 'leap-year-bug range')
throws('a 1999 date is implausible',  () => excelSerialToISODate(36000), 'before 2000-01-01')
throws('a 2101 date is implausible',  () => excelSerialToISODate(80000), 'after 2100')
throws('a text serial is refused',    () => excelSerialToISODate('46235'), 'not an Excel date serial')

eq('IST day of a UTC evening', istDateOf('2026-08-01T18:45:00.000Z'), '2026-08-02')
eq('IST day just before',      istDateOf('2026-08-01T18:29:00.000Z'), '2026-08-01')
eq('FY of August',  financialYearOf('2026-08-01'), 2026)
eq('FY of March',   financialYearOf('2026-03-31'), 2025)
eq('FY of April 1', financialYearOf('2026-04-01'), 2026)

// The reason the date helpers avoid local time at all: prove they give the same
// answer in a timezone behind UTC, where naive parsing loses a day.
{
  const probe = `
    import { excelSerialToISODate, istLocalToInstant } from ${JSON.stringify(
      new URL('../../src/service-payments/lib/dates.js', import.meta.url).href)};
    console.log(JSON.stringify({
      serial: excelSerialToISODate(46235),
      instant: istLocalToInstant('2026-08-01 11:34:21'),
      naive: new Date('2026-08-01 00:00:00').toISOString().slice(0,10),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));`
  try {
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe],
      { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' }).trim())
    eq('serial survives a UTC-8 machine',  out.serial, '2026-08-01')
    eq('instant survives a UTC-8 machine', out.instant, '2026-08-01T06:04:21.000Z')
    if (out.tz === 'America/Los_Angeles') {
      ok('and naive local parsing really does lose the day there', out.naive === '2026-08-01',
         `naive gave ${out.naive}`)
    } else {
      console.log(`  NOTE  this platform ignored TZ (reported ${out.tz}); the two assertions above still ran`)
    }
  } catch (e) {
    console.log(`  NOTE  timezone subprocess probe unavailable: ${e.message.split('\n')[0]}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('csv — quoted fields, because Notes is free text')

eq('a comma inside quotes stays one field',
   parseCSV('a,b\n"x,y",z')[1], ['x,y', 'z'])
eq('escaped quotes',
   parseCSV('a\n"he said ""hi"""')[1], ['he said "hi"'])
eq('CRLF',        parseCSV('a,b\r\n1,2')[1], ['1', '2'])
eq('BOM stripped', parseCSV('﻿a,b\n1,2')[0], ['a', 'b'])
eq('blank lines dropped', parseCSV('a,b\n\n1,2\n\n').length, 2)
throws('truncated quoted field', () => parseCSV('a\n"oops'), 'truncated or corrupt')
throws('missing required column',
       () => toRecords(parseCSV('a,b\n1,2'), ['a', 'zzz']), 'missing required column')
eq('records map by name',
   toRecords(parseCSV('b,a\n2,1'), ['a']).records[0], { b: '2', a: '1' })

// ════════════════════════════════════════════════════════════════════════════
section('note signals — the letter-adjacency rule')

// The rule that earns its keep: a digit run preceded by a LETTER is part of a
// registration number, not a bill number.
eq('rejects a registration tail', extractNoteNumbers('DD01C9924 TOOL SCANNING'), [])
eq('accepts a leading number',    extractNoteNumbers('6719Work'), ['6719'])
eq('accepts after a space',       extractNoteNumbers('urea 7458'), ['7458'])
eq('accepts a bare number',       extractNoteNumbers('3534'), ['3534'])
eq('accepts two numbers',         extractNoteNumbers('5499 bill 1579'), ['5499', '1579'])
eq('ignores PhonePe noise',       extractNoteNumbers('Payment from PhonePe'), [])
eq('ignores short runs',          extractNoteNumbers('bill 12'), [])
eq('ignores over-long runs',      extractNoteNumbers('ref 12345678'), [])
eq('null-safe',                   extractNoteNumbers(null), [])

eq('finds a registration', extractRegNos('DD01C9924 TOOL SCANNING'), ['DD01C9924'])
eq('finds a spaced one',   extractRegNos('gj 03 by 9163 service'), ['GJ03BY9163'])

eq('payer name normalises', normalizePayerName('Mr Bhimesh  Baldeo-Jadhao'), 'BHIMESH BALDEO JADHAO')
eq('payer name null-safe',  normalizePayerName(null), '')

// ════════════════════════════════════════════════════════════════════════════
section('BharatPe parser')

const BP_HEADER = 'Transaction Date and Time,Product,Received From,Payment Mode,' +
                  'Transaction ID,Transaction Amount,Net MDR (Inclusive GST),Amount Added'
const bpRow = (id, amt, mdr, added, payer = 'ROSAN ROADWAYS', dt = '2026-08-01 13:27:37') =>
  `${dt},BharatPe QR,${payer},UPI,${id},${amt},${mdr},${added}`

{
  const r = parseBharatPe([BP_HEADER, bpRow('054967929090', '3860.0', '0.0', '3860.0')].join('\n'))
  eq('one receipt', r.receipts.length, 1)
  eq('LEADING ZERO in the UTR is preserved', r.receipts[0].external_txn_id, '054967929090')
  eq('normalized_utr is set for BharatPe', r.receipts[0].normalized_utr, '054967929090')
  eq('amount is gross', r.receipts[0].amount_paise, 386000)
  eq('instant is IST', r.receipts[0].received_at, '2026-08-01T07:57:37.000Z')
}
{
  // The real anomaly: gross 1930, MDR 48.48, and BharatPe reports "Amount
  // Added" as 1881.5 — rounded to ONE decimal, so it is 2 paise short of
  // 1930 - 48.48. We must take gross and MDR and ignore their net.
  const r = parseBharatPe([BP_HEADER, bpRow('123456789012', '1930.0', '48.48', '1881.5')].join('\n'))
  eq('gross taken verbatim', r.receipts[0].amount_paise, 193000)
  eq('fee taken verbatim',   r.receipts[0].fee_paise, 4848)
  ok('their rounded net is NOT imported', !('net_paise' in r.receipts[0]))
  eq('derived net is exact', r.receipts[0].amount_paise - r.receipts[0].fee_paise, 188152)
}
{
  const r = parseBharatPe([BP_HEADER,
    bpRow('111111111111', '30.0', '0.0', '30.0', 'ALLARAKHA A SANGHARIYAT')].join('\n'))
  // A ₹30 credit five minutes after ₹1,900 from the same payer is a customer
  // topping up, not a test transaction. It is imported and merely flagged.
  eq('small amount is still a receipt', r.receipts.length, 1)
  eq('and it is flagged', r.summary.small_amount_flagged, 1)
  eq('and it is not refused', r.summary.refused, 0)
}
{
  const r = parseBharatPe([BP_HEADER,
    bpRow('222222222222', '100.0', '0.0', '100.0'),
    bpRow('222222222222', '200.0', '0.0', '200.0')].join('\n'))
  eq('duplicate txn id inside one file is reported', r.summary.duplicate_txn_ids.length, 1)
}
{
  const r = parseBharatPe([BP_HEADER, bpRow('', '100.0', '0.0', '100.0')].join('\n'))
  eq('blank txn id refused, not dropped', r.summary.refused, 1)
  eq('nothing imported', r.receipts.length, 0)
}
throws('missing column is a hard failure',
       () => parseBharatPe('Transaction ID,Transaction Amount\n1,2'), 'missing required column')

// ════════════════════════════════════════════════════════════════════════════
section('Google Pay parser')

const GP_HEADER = 'Payer/Receiver,Paid via,Type,Creation time,Transaction ID,Amount,' +
                  'Processing fee,Net amount,Status,Update time,Notes'
const gpRow = (o = {}) => {
  const d = {
    payer: 'Sushil K', via: 'Google Pay', type: 'UPI', created: '2026-08-23 10:26:44',
    id: 'CICAgLjb5IrdMQ', amount: '1930.00', fee: '0.00', net: '1930.00',
    status: 'Settled', updated: '2026-08-24 00:55:48', notes: '', ...o,
  }
  return `${d.payer},${d.via},${d.type},${d.created},${d.id},${d.amount},${d.fee},${d.net},${d.status},${d.updated},${d.notes}`
}

{
  const r = parseGpay([GP_HEADER, gpRow()].join('\n'))
  eq('one receipt', r.receipts.length, 1)
  eq('normalized_utr stays NULL for GPay', r.receipts[0].normalized_utr, null)
  eq('external id kept', r.receipts[0].external_txn_id, 'CICAgLjb5IrdMQ')
}
{
  // Two real July rows are Type "Wallet", worth ₹13,124 between them, both with
  // genuine customer notes. Filtering on Type === 'UPI' would have lost them.
  const r = parseGpay([GP_HEADER,
    gpRow({ type: 'Wallet', amount: '3860.00', net: '3860.00', notes: '5065 Urea' })].join('\n'))
  eq('a Wallet row is a real receipt', r.receipts.length, 1)
  eq('and its type is recorded', r.receipts[0].gpay_type, 'Wallet')
  eq('and its note number is read', r.receipts[0].note_numbers, ['5065'])
}
{
  // "Unknown app" is the MAJORITY of rows — customers paying the QR from
  // PhonePe and others. Ordinary receipts.
  const r = parseGpay([GP_HEADER,
    gpRow({ via: 'Unknown app', notes: 'Payment from PhonePe' })].join('\n'))
  eq('Unknown app is imported', r.receipts.length, 1)
  eq('and the noise note yields no bill number', r.receipts[0].note_numbers, [])
}
{
  const r = parseGpay([GP_HEADER,
    gpRow({ payer: '', amount: '25000.00', net: '25000.00', notes: 'UPI Pay' })].join('\n'))
  eq('a blank payer on ₹25,000 is still a receipt', r.receipts.length, 1)
  eq('payer is null, not empty string', r.receipts[0].payer_name, null)
}
{
  const r = parseGpay([GP_HEADER, gpRow({ status: 'Pending' })].join('\n'))
  eq('unsettled money is NOT imported', r.receipts.length, 0)
  eq('it is held for review', r.summary.refused, 1)
  ok('with the status named', r.review[0].reason.includes('Pending'))
}
{
  const r = parseGpay([GP_HEADER,
    gpRow({ notes: '"repair, urgent 5499"', amount: '944.00', net: '944.00' })].join('\n'))
  eq('a comma inside a quoted note does not shift columns', r.receipts.length, 1)
  eq('and the number is still found', r.receipts[0].note_numbers, ['5499'])
}

// ════════════════════════════════════════════════════════════════════════════
section('Billing Report parser')

const BR_COLUMNS = [
  'Billing Date', 'Plant', 'Reg.No', 'Order number', 'Customer Name',
  'Dealer invoice number', 'Net value', 'Tax Value', 'Total', 'Order date',
  'Order Type', 'Order Type description', 'Company code', 'Company code description',
  'Engine Number', 'Created Date', 'Billing Type', 'Billing Type description',
  'Cancelled', 'Company GSTN', 'IRN No', 'Customer Number', 'Bill to Code',
  'Bill to Name', 'Split Order Type description', 'Billing Document', 'Chassis',
  'Plant description', 'Payment terms', 'Payment terms dsecription', 'Customer GSTN',
  'Dealer specific order number', 'Customer PAN',
]
const brRow = (o = {}) => {
  const d = {
    'Billing Date': 46237, Plant: '6370', 'Reg.No': '', 'Order number': '7008034213',
    'Customer Name': 'NEW GURPAL TRANSPORT', 'Dealer invoice number': 'MPI6370260000724',
    'Net value': 1635.59, 'Tax Value': 294.41, Total: 1930, 'Order date': 46237,
    'Order Type': 'ZPCA', 'Order Type description': 'Workshop Cash Sales',
    'Company code': 'D735', 'Company code description': 'Paras Trucks And Buses',
    'Engine Number': '', 'Created Date': 46237, 'Billing Type': 'ZMPI',
    'Billing Type description': 'M&HCV Parts Cash Inv', Cancelled: '',
    'Company GSTN': '24ABCFP3133C1ZV', 'IRN No': '', 'Customer Number': '0012040678',
    'Bill to Code': '0012040678', 'Bill to Name': 'NEW GURPAL TRANSPORT',
    'Split Order Type description': 'Workshop Cash Sales', 'Billing Document': '0986635810',
    Chassis: '', 'Plant description': 'Paras Trucks-Anand', 'Payment terms': 'D001',
    'Payment terms dsecription': 'Pay immediately - Cash', 'Customer GSTN': '27ADCPV1474G1ZE',
    'Dealer specific order number': 'PCA63702627000766', 'Customer PAN': 'ADCPV1474G', ...o,
  }
  return BR_COLUMNS.map((c) => d[c])
}
const brSheet = (rows, { title = 'Billing Report', declared = null } = {}) => ([
  [title], ['No. of entries', String(declared ?? rows.length)], [], BR_COLUMNS, ...rows,
])

{
  const r = parseBillingReport(brSheet([brRow()]), { entityId: 'E', outletIdByPlant: { 6370: 'O-anand' } })
  eq('one invoice', r.invoices.length, 1)
  const v = r.invoices[0]
  eq('kind from prefix',  v.invoice_kind, 'counter_sale')
  eq('date from serial',  v.invoice_date, '2026-08-03')
  eq('total in paise',    v.total_paise, 193000)
  eq('net + tax in paise', v.net_paise + v.tax_paise, 193000)
  eq('terms mapped',      v.payment_terms, 'cash')
  eq('outlet resolved',   v.outlet_id, 'O-anand')
  eq('customer code kept as text with its leading zero', v.sap_customer_code, '0012040678')
  eq('status active',     v.status, 'active')
}
{
  // Gate 2: SAP counts its own rows. A short file is an interrupted export.
  throws('declared count mismatch is refused',
    () => parseBillingReport(brSheet([brRow()], { declared: 5 })), 'Refusing a partial export')
}
{
  // Gate 3, the one that matters most. Prefix and billing type are independent
  // statements of what a document is; disagreement is corruption, not a nuance.
  const r = parseBillingReport(brSheet([
    brRow({ 'Dealer invoice number': 'PCS6370260000001', 'Billing Type': 'ZMPI' }),
  ]))
  eq('bijection violation refused', r.summary.refused, 1)
  eq('and counted', r.summary.bijection_mismatches, 1)
  ok('with both sides named', r.refused[0].reason.includes('ZMSI') && r.refused[0].reason.includes('ZMPI'))
}
{
  // Gate 4: money must cross-foot.
  const r = parseBillingReport(brSheet([brRow({ 'Net value': 1000, 'Tax Value': 100, Total: 1930 })]))
  eq('net + tax != total is refused', r.summary.refused, 1)
  ok('and named', r.refused[0].reason.includes('does not equal Total'))
}
{
  const r = parseBillingReport(brSheet([
    brRow(), brRow({ 'Billing Document': '999' }),
  ]))
  eq('duplicate invoice number refused', r.summary.refused, 1)
  eq('the first one survives', r.invoices.length, 1)
}
{
  const r = parseBillingReport(brSheet([brRow({ 'Dealer invoice number': 'XXX123' })]))
  eq('unknown prefix refused', r.summary.refused, 1)
  ok('and explains itself', r.refused[0].reason.includes('unknown invoice prefix'))
}
{
  const r = parseBillingReport(brSheet([
    brRow({ 'Dealer invoice number': 'PEI6370260000001', 'Billing Type': 'ZFCI',
            'Net value': 0, 'Tax Value': 0, Total: 0 }),
  ]))
  eq('free-of-cost is imported', r.invoices.length, 1)
  eq('with a zero total allowed', r.invoices[0].total_paise, 0)
  eq('but never payable', r.invoices[0].status, 'not_payable')
}
{
  const r = parseBillingReport(brSheet([
    brRow({ 'Dealer invoice number': 'MPR6370260000001', 'Billing Type': 'ZMPR',
            'Split Order Type description': '' }),
  ]))
  eq('a parts return is parked', r.invoices[0].status, 'parked')
  eq('and its blank split type is not a problem', r.invoices[0].split_order_type, null)
}
{
  // The hazard the plan's original predicate walked into: one real free-of-cost
  // invoice carries Split Order Type "Repeat Jobs", a value listed as payable.
  // Payability must not consult that column at all.
  const r = parseBillingReport(brSheet([
    brRow({ 'Dealer invoice number': 'LEI6370260000001', 'Billing Type': 'ZFCI',
            'Split Order Type description': 'Repeat Jobs' }),
  ]))
  eq('"Repeat Jobs" on an FOC invoice does not make it payable', r.invoices[0].status, 'not_payable')
}
{
  const r = parseBillingReport(brSheet([brRow({ Cancelled: 'X' })]))
  eq('a cancelled invoice imports as cancelled', r.invoices[0].status, 'cancelled')
}
{
  const r = parseBillingReport(brSheet([brRow()]), { openingBalanceAsOf: '2026-08-31' })
  eq('pre-opening invoices are excluded from outstanding', r.invoices[0].status, 'pre_opening')
}
{
  const r = parseBillingReport(brSheet([brRow({ 'Customer Number': '' })]))
  eq('blank customer number refused', r.summary.refused, 1)
}
throws('wrong export refused by its title',
       () => parseBillingReport([['Sales Report'], ['No. of entries', '1'], [], BR_COLUMNS, brRow()]),
       'Wrong export?')
throws('missing column is a hard failure',
       () => parseBillingReport([['Billing Report'], ['No. of entries', '1'], [], ['Plant'], ['6370']]),
       'missing required column')

// every prefix in the map round-trips through its own billing type
for (const [prefix, spec] of Object.entries(PREFIX_MAP)) {
  const r = parseBillingReport(brSheet([
    brRow({ 'Dealer invoice number': `${prefix}6370260000001`, 'Billing Type': spec.billing_type,
            'Split Order Type description': '' }),
  ]))
  ok(`prefix ${prefix} parses as ${spec.kind}`,
     r.invoices.length === 1 && r.invoices[0].invoice_kind === spec.kind,
     JSON.stringify(r.refused))
}

// ════════════════════════════════════════════════════════════════════════════
// Optional: the real files.
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null }
const billingPath = argOf('--billing'), bpPath = argOf('--bharatpe'), gpPath = argOf('--gpay')

if (billingPath || bpPath || gpPath) {
  section('REAL FILES — asserting the numbers this design was derived from')

  if (billingPath && fs.existsSync(billingPath)) {
    // XLSX.readFile is unavailable in the ESM build unless set_fs() has been
    // called; reading the bytes here sidesteps that entirely.
    const wb = XLSX.read(fs.readFileSync(billingPath), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
    const r = parseBillingReport(rows, { entityId: 'PTB', outletIdByPlant: { 5756: 'O-ahd', 6370: 'O-anand' } })
    console.log(`  ${billingPath.split(/[\\/]/).pop()}`)
    console.log(`    ${JSON.stringify(r.summary, null, 2).replace(/\n/g, '\n    ')}`)
    eq('1,085 rows read',        r.summary.rows_read, 1085)
    eq('declared count matches', r.summary.declared_entries, 1085)
    eq('every row parsed',       r.summary.parsed, 1085)
    eq('nothing refused',        r.summary.refused, 0)
    eq('zero bijection breaks',  r.summary.bijection_mismatches, 0)
    eq('zero cross-foot breaks', r.summary.net_tax_mismatches, 0)
    eq('1,045 payable',          r.summary.payable, 1045)
    // 1 lakh rupees = 1e7 paise.
    eq('₹107.28 lakh payable',   Math.round(r.summary.payable_paise / 1e7 * 100) / 100, 107.28)
    eq('exact payable paise',    r.summary.payable_paise, 1072823900)
    eq('530 distinct customers', r.summary.distinct_customers, 530)
    eq('245 multi-invoice orders', r.summary.multi_invoice_orders, 245)
    eq('28 free-of-cost',        r.summary.by_kind.foc, 28)
    eq('12 parts returns',       r.summary.by_kind.parts_return, 12)
    eq('316 counter cash + 62 credit', r.summary.by_kind.counter_sale, 378)
    eq('743 at Ahmedabad',       r.summary.by_plant['5756'], 743)
    eq('342 at Anand',           r.summary.by_plant['6370'], 342)
  } else if (billingPath) {
    console.log(`  SKIP  billing report not found at ${billingPath}`)
  }

  for (const [path, parser, label, expected] of [
    [bpPath, parseBharatPe, 'BharatPe', null],
    [gpPath, parseGpay, 'Google Pay', null],
  ]) {
    if (!path) continue
    if (!fs.existsSync(path)) { console.log(`  SKIP  ${label} not found at ${path}`); continue }
    const r = parser(fs.readFileSync(path, 'utf8'), { entityId: 'PTB' })
    console.log(`  ${label}: ${path.split(/[\\/]/).pop()}`)
    console.log(`    rows=${r.summary.rows_in_file} receipts=${r.summary.receipts} ` +
                `refused=${r.summary.refused} small_flagged=${r.summary.small_amount_flagged} ` +
                `dupes=${r.summary.duplicate_txn_ids.length} ` +
                `total=₹${(r.summary.total_paise / 100).toLocaleString('en-IN')} ` +
                `fees=₹${(r.summary.fee_paise / 100).toFixed(2)}`)
    ok(`${label}: every row became a receipt or a named refusal`,
       r.summary.receipts + r.summary.refused === r.summary.rows_in_file,
       `${r.summary.receipts} + ${r.summary.refused} != ${r.summary.rows_in_file}`)
    ok(`${label}: no duplicate transaction ids`, r.summary.duplicate_txn_ids.length === 0)
    ok(`${label}: every receipt has a positive amount`, r.receipts.every((x) => x.amount_paise > 0))
    ok(`${label}: every receipt has an instant`, r.receipts.every((x) => /^\d{4}-\d{2}-\d{2}T/.test(x.received_at)))
    if (label === 'BharatPe') {
      ok('BharatPe: every receipt carries a UTR', r.receipts.every((x) => /^\d{12}$/.test(x.normalized_utr)))
    } else {
      ok('Google Pay: no receipt claims a UTR', r.receipts.every((x) => x.normalized_utr === null))
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(66)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
