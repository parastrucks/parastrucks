// Phase 10 Stage 2 — offline self-test for the tracker screen's own logic: what a grid cell becomes
// in the database and back (cellValues), the save adapter's decisions (savePlan), and the three
// columns worked out on screen (screenColumns).
//
//   node scripts/phase10/selftest-tracker-cells.mjs
//
// Imports the real modules from src/tracker/lib (which import the Edge Function's columns.ts), so the
// screen and the server are tested with the same rules. Expectations are written out by hand.
import { fromCell, toCell, isoToSerial, serialToIso, parseTypedDate, parseTypedNumber, sameValue, collapse } from '../../src/tracker/lib/cellValues.js'
import { planSave, planNewRows, MAX_NEW_ROWS, chunk, refusalMessage } from '../../src/tracker/lib/savePlan.js'
import { ageingDays, interestOnAgeing, slab, withScreenColumns, todayIst } from '../../src/tracker/lib/screenColumns.js'
import { ALL_COLUMNS, COLUMN_BY_KEY, visibleColumns } from '../../src/tracker/lib/columnMeta.js'
import { COLUMNS, EDITABLE } from '../../supabase/functions/admin-vehicle-units/columns.ts'

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) pass++; else { fail++; console.log('FAIL', label, got === undefined ? '' : JSON.stringify(got)) } }
const S = (k) => COLUMN_BY_KEY[k].spec

// ── columnMeta: the screen shows every business column once, and edits exactly what the server allows
const keys = ALL_COLUMNS.map((c) => c.key)
ok(new Set(keys).size === keys.length, 'no column shown twice')
const shownStored = keys.filter((k) => k in COLUMNS)
const notShown = Object.keys(COLUMNS).filter((k) => !keys.includes(k))
ok(JSON.stringify(notShown.sort()) === JSON.stringify(['created_at', 'created_by', 'id', 'import_batch_id', 'recompute',
  'source_file', 'source_row', 'superseded_at', 'superseded_by_id', 'updated_at', 'updated_by'].sort()),
  'every stored business column is shown; only system columns are not', notShown)
ok(ALL_COLUMNS.filter((c) => c.editable).every((c) => EDITABLE.includes(c.key)), 'nothing editable on screen that the server refuses')
ok(EDITABLE.every((k) => COLUMN_BY_KEY[k]?.editable), 'everything the server accepts is editable on screen')
ok(shownStored.length + 3 + 3 === ALL_COLUMNS.length, '91 business + 3 incentive + screen columns', ALL_COLUMNS.length)
ok(visibleColumns({ seeIncentives: false }).every((c) => !c.incentive && c.key !== 'dse_incentive'), 'incentives + DSE slab hidden for non-HR')
ok(visibleColumns({ seeIncentives: true }).length === ALL_COLUMNS.length, 'admin/HR see every column')
ok(COLUMN_BY_KEY.ctc.money && !COLUMN_BY_KEY.qty.money && !COLUMN_BY_KEY.gst_rate.money && !COLUMN_BY_KEY.road_tax_pct.money, 'money vs plain numbers')

// ── dates
ok(isoToSerial('2025-07-05') === 45843, 'serial of 5 Jul 2025 (measured in the grid: typing 05/07/25 gave 45843)')
ok(serialToIso(45843) === '2025-07-05' && serialToIso(46054) === '2026-02-01', 'serial → iso')
ok(serialToIso(45843.75) === '2025-07-05', 'a time part is dropped')
for (const [t, want] of [['05/07/25', '2025-07-05'], ['5/7/25', '2025-07-05'], ['05-07-2025', '2025-07-05'], ['05.07.25', '2025-07-05'],
  ['2025-07-05', '2025-07-05'], ['2025-7-5', '2025-07-05'], [' 22/09/2025 ', '2025-09-22']]) ok(parseTypedDate(t) === want, `typed date ${t}`, parseTypedDate(t))
for (const t of ['July 5', '5 Jul 2025', '45843', '05/07', '']) ok(parseTypedDate(t) === null, `not a date: ${t}`)

// ── numbers
for (const [t, want] of [['12,34,567', 1234567], ['1,234,567', 1234567], [' 2800000 ', 2800000], ['-1,20,468', -120468], ['1310.50', 1310.5], ['1 00 000', 100000]])
  ok(parseTypedNumber(t) === want, `typed number ${t}`, parseTypedNumber(t))
for (const t of ['₹2800000', '5K', '1310*8', '=SUM(A1)', 'abc', '1.2.3', '']) ok(parseTypedNumber(t) === null, `not a number: ${t}`)

// ── fromCell: what reaches the database
const f = (k, v) => fromCell(S(k), v)
ok(f('ctc', '12,34,567').value === 1234567, 'Excel paste of lakh text → number')
ok(f('ctc', 2800000).value === 2800000, 'number stays')
ok(f('ctc', '').ok && f('ctc', '').value === null && f('ctc', null).value === null, 'blank clears')
ok(!f('ctc', '₹28').ok && !f('ctc', '5K-DSA').ok, 'text in money refused')
ok(f('ctc', '=A1+1').reason === 'formulas are not allowed in data cells', 'formula text refused by name')
ok(!f('qty', '').ok && f('qty', '').reason === 'cannot be blank', 'qty cannot be blank')
ok(!f('qty', 1.5).ok, 'fractional qty')
ok(f('ptb_invoice_date', 45843).value === '2025-07-05', 'date serial → iso')
ok(f('ptb_invoice_date', '05/07/25').value === '2025-07-05', 'date typed as text → iso')
ok(!f('ptb_invoice_date', '31/02/25').ok, 'impossible date')
ok(f('ptb_invoice_date', 'next week').reason === 'not a date (type it as dd/mm/yy)', 'date reason says how to type it')
ok(f('customer_name', '  ACME ').value === 'ACME', 'text trimmed (the Windows paste trailing space)')
ok(f('engine_no', 123456).value === '123456', 'number into text column → text')
ok(!f('customer_name', '=HYPERLINK("x")').ok, 'formula text refused in text column')
ok(f('gst_rate_override', '18').value === 18 && !f('gst_rate_override', 15).ok, 'gst override values')
ok(f('road_tax_pct', 0).value === 0, 'road tax 0 is a value, not a blank')

// ── toCell: what the grid shows
ok(toCell(S('ptb_invoice_date'), '2025-07-05') === 45843, 'date → serial')
ok(toCell(S('ctc'), 1310.5) === 1310.5 && toCell(S('ctc'), '1310.50') === 1310.5, 'number from text or number')
ok(toCell(S('ctc'), null) === null && toCell(S('customer_name'), '') === null, 'blanks')
ok(toCell(S('chassis_no'), 'X1') === 'X1', 'text')

// ── sameValue + collapse
ok(sameValue(S('qty'), '1', 1) && sameValue(S('ctc'), '1310.50', 1310.5), 'undo type change is not a change')
ok(!sameValue(S('ctc'), 0, null) && sameValue(S('ctc'), '', null), '0 is not blank; "" is')
ok(sameValue(S('engine_no'), 1, '1'), 'text compare')
const col = collapse([
  { unit_id: 'a', column: 'ctc', before: 1, after: null },
  { unit_id: 'a', column: 'ctc', before: null, after: 5 },
  { unit_id: 'b', column: 'ctc', before: 3, after: null },
  { unit_id: 'b', column: 'ctc', before: null, after: 3 },
], (k) => S(k))
ok(col.length === 1 && col[0].before === 1 && col[0].after === 5, 'fill blank-then-value collapses to first before / last after; a no-op drops', col)

// ── planSave
const shadow = new Map([
  ['u1', { id: 'u1', ctc: 1310.5, qty: 1, customer_name: 'A', tcs: 30000, ptb_invoice_date: '2025-07-05', dsm_incentive: 500 }],
  ['u2', { id: 'u2', ctc: null, qty: 1, customer_name: null, tcs: null, ptb_invoice_date: null }],
])
let p = planSave([{ id: 'u1', key: 'ctc', value: '12,34,567' }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 1 && p.changes[0].after === 1234567 && p.changes[0].before === 1310.5 && p.putBack[0]?.value === 1234567,
  'lakh text saved as a number, and the cell is set to the number', p)
p = planSave([{ id: 'u1', key: 'ctc', value: 1400 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 1 && p.putBack.length === 0, 'a plain typed number: saved, nothing put back', p)
p = planSave([{ id: 'u1', key: 'tcs', value: 5 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.putBack[0].value === 30000 && p.refused.length === 0, 'computed column: put back silently', p)
p = planSave([{ id: 'u1', key: 'dsm_incentive', value: 1 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.putBack[0].value === 500, 'incentive column: put back (read-only here)', p)
p = planSave([{ id: 'u1', key: 'ctc', value: 2, formula: '=1+1' }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.refused[0].reason.includes('formulas') && p.putBack[0].value === 1310.5, 'formula refused and put back', p)
p = planSave([{ id: 'u1', key: 'ctc', value: '5K' }], COLUMN_BY_KEY, shadow)
ok(p.refused[0].reason === 'not a number' && p.putBack[0].value === 1310.5, 'bad value refused, old value back', p)
p = planSave([{ id: 'u1', key: 'qty', value: null }, { id: 'u1', key: 'qty', value: 2 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 1 && p.changes[0].after === 2 && p.refused.length === 0, 'fill into qty: the passing blank is not refused', p)
p = planSave([{ id: 'u1', key: 'qty', value: null }], COLUMN_BY_KEY, shadow)
ok(p.refused[0]?.reason === 'cannot be blank' && p.putBack[0].value === 1, 'clearing qty refused', p)
p = planSave([{ id: 'u1', key: 'ctc', value: '1310.50' }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.putBack[0]?.value === 1310.5, 'same value typed as text: nothing saved, the number shown', p)
p = planSave([{ id: 'u1', key: 'ptb_invoice_date', value: 45843 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.putBack.length === 0, 'same date: nothing at all', p)
p = planSave([{ id: 'u2', key: 'ptb_invoice_date', value: '05/07/25' }], COLUMN_BY_KEY, shadow)
ok(p.changes[0]?.after === '2025-07-05' && p.putBack[0]?.value === '2025-07-05', 'date typed as text: saved and shown as a date', p)
p = planSave([{ id: 'u2', key: 'customer_name', value: 'B ' }], COLUMN_BY_KEY, shadow)
ok(p.changes[0]?.after === 'B' && p.putBack[0]?.value === 'B', 'trailing space trimmed in the save and the cell', p)
p = planSave([{ id: 'zz', key: 'ctc', value: 1 }, { id: 'u1', key: 'nope', value: 1 }], COLUMN_BY_KEY, shadow)
ok(p.changes.length + p.putBack.length + p.refused.length === 0, 'unknown row / column ignored (the grid handles its own)', p)
p = planSave([{ id: 'u2', key: 'ctc', value: '' }], COLUMN_BY_KEY, shadow)
ok(p.changes.length === 0 && p.putBack.length === 0, 'blank over blank: nothing', p)
p = planSave([{ id: 'u1', key: 'customer_name', value: null }], COLUMN_BY_KEY, shadow)
ok(p.changes[0]?.after === null && p.changes[0]?.before === 'A', 'clearing a text cell saves null', p)

ok(chunk(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length).join() === '500,500,201', 'chunks of 500')
ok(refusalMessage([]) === null, 'no refusals, no message')
ok(refusalMessage([{ label: 'CTC', reason: 'not a number' }, { label: 'CTD', reason: 'not a number' }, { label: 'X', reason: 'y' }])
  === 'CTC: not a number. (2 more cells not saved.) The old value is back.', 'one line for many refusals')

// ── planNewRows: cells typed or pasted into the spare rows below the book
let n = planNewRows([{ r: 2052, key: 'chassis_no', value: 'MB1NEW0001' }], COLUMN_BY_KEY)
ok(n.creates.length === 1 && n.creates[0].r === 2052 && n.creates[0].values.chassis_no === 'MB1NEW0001' && !n.creates[0].show.length && !n.refused.length,
  'new row: a typed chassis makes a vehicle', n)
n = planNewRows([{ r: 2052, key: 'model', value: 'BOSS' }], COLUMN_BY_KEY)
ok(!n.creates.length && n.refused.length === 1 && n.refused[0].key === 'chassis_no' && n.clear.length === 1 && n.clear[0].key === 'model',
  'new row: anything before the chassis is refused and cleared', n)
n = planNewRows([
  { r: 10, key: 'chassis_no', value: ' MB1NEW0002 ' }, { r: 10, key: 'ctc', value: '12,34,567' },
  { r: 10, key: 'tcs', value: 5 }, { r: 10, key: 'ptb_invoice_date', value: '05/07/25' }, { r: 10, key: 'dse', value: null },
  { r: 11, key: 'chassis_no', value: 0, formula: '=A1' }, { r: 11, key: 'model', value: 'X' },
], COLUMN_BY_KEY)
const c10 = n.creates.find((c) => c.r === 10)
ok(n.creates.length === 1 && c10 && c10.values.chassis_no === 'MB1NEW0002' && c10.values.ctc === 1234567 &&
  c10.values.ptb_invoice_date === '2025-07-05' && !('tcs' in c10.values) && !('dse' in c10.values),
  'new rows: a pasted row is converted (trim, lakh text, typed date); worked-out and blank cells are not sent', n)
ok(c10 && ['chassis_no', 'ctc'].every((k) => c10.show.some((x) => x.key === k)), 'new rows: converted values are shown as saved', c10?.show)
ok(n.clear.some((x) => x.r === 10 && x.key === 'tcs'), 'new rows: a worked-out column pasted into is cleared', n.clear)
ok(n.refused.some((x) => x.r === 11 && /formula/.test(x.reason)) && ['chassis_no', 'model'].every((k) => n.clear.some((x) => x.r === 11 && x.key === k)),
  'new rows: a formula chassis refuses and clears its whole row', n)
n = planNewRows([{ r: 5, key: 'chassis_no', value: null }, { r: 5, key: 'model', value: '' }], COLUMN_BY_KEY)
ok(!n.creates.length && !n.refused.length && !n.clear.length, 'new rows: Delete over empty rows does nothing', n)
n = planNewRows([{ r: 6, key: 'chassis_no', value: null }, { r: 6, key: 'chassis_no', value: 'MB1NEW0003' }], COLUMN_BY_KEY)
ok(n.creates.length === 1 && n.creates[0].values.chassis_no === 'MB1NEW0003', 'new rows: a fill (blank, then value) is judged on its last value', n)
n = planNewRows([{ r: 7, key: 'chassis_no', value: 'MB1NEW0004' }, { r: 7, key: 'ctc', value: '5K' }], COLUMN_BY_KEY)
ok(n.creates.length === 1 && !('ctc' in n.creates[0].values) && n.refused[0]?.key === 'ctc' && n.clear[0]?.key === 'ctc',
  'new rows: one bad value is refused and cleared; the vehicle is still added', n)
ok(MAX_NEW_ROWS === 200, "new-row cap = the Edge Function's")
ok(refusalMessage([{ label: 'Chassis No', reason: 'x' }], ' Those cells were cleared.') === 'Chassis No: x. Those cells were cleared.', 'refusal message ending for new rows')

// ── screen columns (workbook formulas)
ok(ageingDays({ al_payment_date: null }, '2026-10-22') === 0, 'ageing: no AL payment → 0')
ok(ageingDays({ al_payment_date: '2025-07-01', ptb_invoice_date: '2025-07-31' }, '2026-10-22') === 30, 'ageing: invoice − payment')
ok(ageingDays({ al_payment_date: '2026-10-12' }, '2026-10-22') === 10, 'ageing: today − payment when unsold')
ok(ageingDays({ al_payment_date: '2025-08-10', ptb_invoice_date: '2025-08-01' }, '2026-10-22') === -9, 'ageing can be negative')
ok(interestOnAgeing({ al_payment_date: '2025-07-01', ptb_invoice_date: '2025-07-31', total_payment_to_al: 3650000 }, 'x') === 30000,
  'interest: 30 days × 36.5 L × 10% / 365 = 30,000')
ok(interestOnAgeing({ al_payment_date: '2025-08-10', ptb_invoice_date: '2025-08-01', total_payment_to_al: 3650000 }, 'x') === 0, 'interest 0 when negative')
ok([0, 4, 5, 8, 9, 12, 13, 40].map(slab).join() === '0,0,1200,1200,1500,1500,1800,1800', 'DSE slab boundaries')
const rows = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, dse: 'ravi ', date_of_retail: '2025-08-0' + (i + 1) })),
  { id: 'old', dse: 'RAVI', date_of_retail: '2025-08-09', superseded_at: '2025-09-01' },
  { id: 'sep', dse: 'RAVI', date_of_retail: '2025-09-01' },
  { id: 'none', dse: null, date_of_retail: '2025-08-01' },
]
const w = withScreenColumns(rows, '2026-10-22')
ok(w.find((r) => r.id === 'r0').dse_incentive === 1200, '5 in August (case/space-insensitive DSE) → 1,200; the rebilled row not counted', w.find((r) => r.id === 'r0'))
ok(w.find((r) => r.id === 'sep').dse_incentive === 0 && w.find((r) => r.id === 'old').dse_incentive === null && w.find((r) => r.id === 'none').dse_incentive === null,
  'September alone → 0; rebilled and DSE-less rows → none')
ok(todayIst(new Date('2026-10-21T19:00:00Z')) === '2026-10-22' && todayIst(new Date('2026-10-21T18:00:00Z')) === '2026-10-21', 'today in IST (midnight IST = 18:30 UTC)')

console.log(`selftest-tracker-cells: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
