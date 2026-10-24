// Phase 10 — offline self-test for the import's merge rules (scripts/phase10/import/merge.cjs).
//
//   node scripts/phase10/selftest-import-merge.cjs
//
// Made-up rows only (no workbook is read). Expectations are written out by hand from the column map and
// the measured homes (e_sources.cjs), never from the code.
const { merge } = require('./import/merge.cjs')

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) pass++; else { fail++; console.log('FAIL', label, got === undefined ? '' : JSON.stringify(got)) } }
const cell = (v, extra = {}) => ({ v, f: null, note: null, bg: null, col: 'A', z: null, ...extra })
const row = (file, n, cells) => ({ file, sheet: 'x', row: n, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v && typeof v === 'object' && 'v' in v ? v : cell(v)])) })

const A = 'MB1AAAAAAAAAA0001', B = 'MB1BBBBBBBBBB0002', C = 'MB1CCCCCCCCCC0003'
const fam = {
  IT: [row('2024-25 IT.xlsx', 7, { 'CHASSIS NO': A, CTD: 2550000, 'OEM GATEPASS NUMBER': 'GP-OLD', 'CUSTOMER NAME': 'M/S NEW NAME PVT LTD' }),
    row('IT.xlsx', 2, { 'CHASSIS NO': A, 'ENGINE NO': 'E1', MODEL: 'CE2820 R RMC', CTC: 2800000, CTD: cell(2600000, { f: '2055000/1.28*1.18' }),
    'CUSTOMER NAME': 'OLD NAME', 'AMC/SERVICE': 5000, 'PTB INVOICE DATE': 45843, 'AL PAYMENT STATUS': cell('Cash Invoiced', { bg: '#C6EFCE' }),
    DSA: cell(1000, { note: 'CTC 17.50 IF 25 QTY', bg: '#FFFF00' }), RETENTION: 99 })],
  IT_OD: [row('IT.xlsx', 3, { 'CHASSIS NO': B, 'ENGINE NO': 'E2', CTD: 1500000, CTC: 1400000 })],
  FY: [row('FY.xlsx', 10, { 'CHASSIS NUMBER': A, 'NAME OF THE CUSTOMER': 'NEW NAME', CTC: 2850000, 'ENGINE NO': 'E1', 'PTB INVOICE DATE': 'garbled',
    SEGMENT: 'BUS', 'CUSTOMER BILL': 3000000, MRP: 3100000, 'FULL TAX': cell(150000, { f: 'N10/1.18*6%', col: 'AA' }), '#AL': cell(45900, { z: 'dd/mm/yy', col: 'AL' }),
    'AD-BLU': 'WRONG', TCS: 30000 }),
  row('FY.xlsx', 11, { 'CHASSIS NUMBER': C, 'NAME OF THE CUSTOMER': 'C CUST', CTC: 900000, 'FULL TAX': 0, '#AM': cell('REPLENISH', { col: 'AM' }) })],
  LIST: [row('LIST-APR.xlsx', 5, { 'CHASSIS NUMBER': A, 'PTB INVOICE DATE': 45843, 'AD-BLU': 'GIVEN', TCS: 31000 })],
  LIST_OD: [row('LIST-APR.xlsx', 7, { 'CHASSIS NO': C, DEALOR: 'SOME DEALER' })],
  RET_INT: [row('RET-APR.xlsx', 4, { 'CHASSIS NO': A, SEGMENT: 'MDV BUS', DSE: 'RAVI', 'DATE OF RETAIL': 45840, 'DSE INCENTIVE': 0, 'DSM INCENTIVE': 500, '#T': 'lookup' })],
  RET_AL: [row('RET-AL-MAR.xlsx', 3, { 'CHASSIS NO': A, AGE: 10, INTEREST: 100 }),
    row('RET-AL-APR.xlsx', 6, { 'CHASSIS NO': A, 'DATE OF RETAIL': 45855, CTC: 2790000, AGE: 40, INTEREST: 400 })],
  DEALERS: [row('LIST-APR.xlsx', 9, { MODEL: B, 'CHASSIS NO': 'E2', 'NAME OF DEALER': 'APRIL DEALER' }),
    row('LIST-MAY.xlsx', 9, { MODEL: B, 'CHASSIS NO': 'E2', 'NAME OF DEALER': 'MAY DEALER' })],
  REBILL: [row('LIST-MAY.xlsx', 3, { 'CHASSIS NUMBER': B, 'NEW CHASSIS NO': C, 'VEHICLE LOCATION': 'YARD' })],
}
fam.FY[0].cells['MRP'].col = 'N'

const res = merge(fam)
const u = (ch) => res.units.find((x) => x.chassis_no === ch)
const notesOn = (ch, key) => res.notes.filter((n) => n.chassis === ch && n.column_key === key)

ok(res.report.trucks === 3 && res.units.length === 3, 'three trucks, one row each', res.report)
// homes (measured): CTC + customer from retail, CTD from the purchase file, invoice date purchase → list → year file
ok(u(A).ctc === 2850000 && u(A).customer_name === 'NEW NAME' && u(A).ctd === 2600000, 'CTC and customer from retail; CTD from purchase', u(A))
ok(u(A).ptb_invoice_date === '2025-07-05', 'invoice date from the purchase file (Excel serial → date)', u(A).ptb_invoice_date)
ok(u(A).ad_blu_given === 'GIVEN', 'AD-BLU from the monthly list, not the year file (its shifted layouts)', u(A).ad_blu_given)
ok(u(A).segment === 'MDV BUS' && !notesOn(A, 'segment').length, 'segment: the finer word, and BUS vs MDV BUS is no disagreement')
ok(u(A).dse === 'RAVI', 'DSE from retention (it pays the incentive)')
ok(u(A).date_of_retail === '2025-07-02' && u(A).al_retail_date === '2025-07-17' && !notesOn(A, 'date_of_retail').length,
  'two retail dates: internal and AL’s each in its own column, no disagreement note (owner, 2026-10-24)', u(A))
// every disagreement is kept, naming the file
// two CTCs (owner, 2026-10-24): the sales side is PTB CTC, the AL side is AL CTC — not a disagreement
ok(u(A).al_ctc === 2790000 && !notesOn(A, 'ctc').length, 'AL CTC from the AL retention file; the purchase file’s CTC is no note on PTB CTC', u(A))
const alNote = notesOn(A, 'al_ctc')[0]
ok(alNote?.source === 'import' && /Invoice Tracker/.test(alNote.body) && /28,00,000/.test(alNote.body) && /Shown: Retention \(AL\)/.test(alNote.body),
  'AL CTC: the purchase file’s different figure is a note, naming both files', alNote)
ok(u(B).ctc === 1400000 && u(B).al_ctc === 1400000 && !notesOn(B, 'ctc').length, 'a truck not sold yet: the purchase CTC fills both, no note', u(B))
ok(/OLD NAME/.test(notesOn(A, 'customer_name')[0]?.body ?? ''), 'customer: the other name is a note')
ok(/garbled/.test(notesOn(A, 'ptb_invoice_date')[0]?.body ?? '') && /not readable as a date/.test(notesOn(A, 'ptb_invoice_date')[0]?.body ?? ''),
  'an unreadable date in another file is a note, not lost', notesOn(A, 'ptb_invoice_date'))
ok(!notesOn(A, 'engine_no').length, 'the same value in two files is no note')
ok(!notesOn(A, 'retention_dealer').length && u(A).retention_dealer === 99, 'a worked-out column: the workbook figure kept as history, never a disagreement note')
ok(u(A).tcs === 30000 && !notesOn(A, 'tcs').length, 'a worked-out column in two files with different figures: the home file’s kept, no note (the recompute-diff reports it)')
// Excel's own: comments, colours, hand formulas
ok(notesOn(A, 'dsa').some((n) => n.source === 'excel_comment' && n.body === 'CTC 17.50 IF 25 QTY'), 'an Excel comment → a note on its cell')
ok(res.formats.some((f) => f.chassis === A && f.column_key === 'dsa' && f.format.bg.rgb === '#FFFF00'), 'a yellow flag → the cell’s colour')
ok(!res.formats.some((f) => f.column_key === 'al_payment_status'), 'the paid green is the tracker’s rule, never imported as a colour')
ok(notesOn(A, 'ctd').some((n) => n.source === 'excel_formula' && n.body === 'Excel formula: =2055000/1.28*1.18'), 'a hand-typed formula is kept as a note')
// stray cells (column map Q5)
ok(u(A).endhan_date === '2025-08-31', 'the date beside ENDHAN → Endhan Date', u(A).endhan_date)
ok(notesOn(C, 'chassis_no').some((n) => /REPLENISH/.test(n.body) && /column AM/.test(n.body)), 'an unlabelled stray cell → a note naming its column')
ok(!res.notes.some((n) => /lookup/.test(n.body)), 'RET-INT’s dropped lookup columns are not carried')
// GST and road tax from the retail FULL TAX cell
ok(u(A).gst_rate === 18 && u(A).gst_rate_override === undefined, 'RMC is 18% by rule; the sheet’s 1.18 agrees → no override', u(A))
ok(u(A).road_tax_pct === 6 && u(A).full_tax_override === 150000, 'road tax 6%; worked on MRP for a July invoice (the rule says the bill) → kept as an override', u(A))
ok(u(C).road_tax_pct === 0, 'a typed 0 full tax → road tax 0%')
// purchase side, dealers, rebill, incentives
ok(u(A).purchase_source === 'al' && u(B).purchase_source === 'other_dealer' && u(A).ctc_basis === 'exclusive', 'bought from AL / another dealer; add-ons → exclusive CTC basis')
ok(u(B).sold_to_dealer === 'MAY DEALER', 'DEALERS repeats month to month: the later file wins; chassis read under “Model”', u(B).sold_to_dealer)
ok(res.links.length === 1 && res.links[0].chassis === B && res.links[0].new_chassis === C && u(B).vehicle_location === 'YARD', 'cancel/rebill: old → new chassis', res.links)
ok(notesOn(C, 'purchase_source').some((n) => /Bought from: SOME DEALER/.test(n.body)), 'the dealer a truck was bought from → a note')
const inc = res.incentives.find((x) => x.chassis === A)
ok(inc?.dsm_incentive === 500 && inc?.dse_incentive_override === 0, 'DSM incentive as typed; a typed DSE figure (not the slab formula) → the override', inc)
ok(u(A).source_file === 'IT.xlsx' && u(A).source_row === 2, 'provenance: the purchase file’s row')

// one continuous book (owner, 2026-10-24): the same truck in last year's file
ok(u(A).ctd === 2600000 && notesOn(A, 'ctd').some((n) => /2024-25 IT\.xlsx/.test(n.body) && /25,50,000/.test(n.body)),
  'an earlier file’s different figure: the later file wins, the earlier is a note naming its file', notesOn(A, 'ctd'))
ok(u(A).oem_gatepass_no === 'GP-OLD', 'an earlier file fills a cell no later file has', u(A).oem_gatepass_no)
ok(u(A).al_claim_age === 40 && u(A).al_claim_interest === 400 && !notesOn(A, 'al_claim_age').length && !notesOn(A, 'al_claim_interest').length,
  'claim age and interest: the latest month only, no note for last month’s (they grow by design)', u(A))
ok(!notesOn(A, 'customer_name').some((n) => /PVT LTD/.test(n.body)), 'M/S … PVT LTD is the same customer, not a disagreement', notesOn(A, 'customer_name'))
ok(notesOn(A, 'customer_name').some((n) => /OLD NAME/.test(n.body)), 'a different name is still a note')

console.log(`selftest-import-merge: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
