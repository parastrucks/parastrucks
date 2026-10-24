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
import { styleKey, formatOf, styleWith, lostNumberFormat, pastedFormat, sameFormat, stable, MONEY, paidRule, columnLetter, PAID_GREEN, PAID_WORDS, isPaid } from '../../src/tracker/lib/cellFormats.js'
import { showValue } from '../../src/tracker/lib/showValue.js'
import { findRows, MIN_FIND } from '../../src/tracker/lib/findRows.js'
import { mailTable } from '../../src/tracker/lib/mailTable.js'
import { describeChange } from '../../src/tracker/lib/historyText.js'
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
// a fixed list of values: any case, saved in the list's spelling; Yes/No also takes Y/N
for (const [t, want] of [['Yes', 'Yes'], ['yes', 'Yes'], [' YES ', 'Yes'], ['y', 'Yes'], ['No', 'No'], ['n', 'No'], ['NO', 'No']])
  ok(f('mto_advance', t).ok && f('mto_advance', t).value === want, `MTO Advance "${t}" → ${want}`, f('mto_advance', t))
ok(f('mto_advance', '').ok && f('mto_advance', '').value === null, 'MTO Advance blank = not make-to-order')
ok(!f('mto_advance', 'maybe').ok && !f('mto_advance', 'yes 5%').ok, 'MTO Advance: anything else refused')
ok(f('ctc_basis', 'Inclusive').value === 'inclusive', 'other fixed lists are case-forgiving too')
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

// ── cellFormats: what of a cell's look is the person’s (saved) and what is the column’s (never saved)
const ctc = COLUMN_BY_KEY.ctc, tcs = COLUMN_BY_KEY.tcs, pay = COLUMN_BY_KEY.al_payment_status, model = COLUMN_BY_KEY.model
ok(styleKey(ctc) === 'money' && styleKey(tcs) === 'moneyL' && styleKey(pay) === 'text', 'column styles: money, locked money; AL Payment Status is plain text (its green is a rule)', [styleKey(ctc), styleKey(tcs), styleKey(pay)])
ok(JSON.stringify(formatOf(ctc, { n: { pattern: MONEY } })) === '{}', 'a plain money cell has nothing of the person’s')
ok(stable(formatOf(ctc, { n: { pattern: MONEY }, bg: { rgb: '#FFFF00' } })) === stable({ bg: { rgb: '#FFFF00' } }), 'yellow on a money cell = { bg } only (number format never saved)')
ok(JSON.stringify(formatOf(tcs, { n: { pattern: MONEY }, bg: { rgb: '#F3F4F6' } })) === '{}', 'the grey of a worked-out column is the column’s, not saved')
ok(stable(formatOf(tcs, { n: { pattern: MONEY }, bg: { rgb: '#FF0000' } })) === stable({ bg: { rgb: '#FF0000' } }), 'red on a worked-out column is saved')
// AL Payment Status: green only when PAID ("Cash Invoiced"; owner 2026-10-23), as a rule
ok(columnLetter(0) === 'A' && columnLetter(25) === 'Z' && columnLetter(26) === 'AA' && columnLetter(24) === 'Y' && columnLetter(701) === 'ZZ' && columnLetter(702) === 'AAA',
  'column letters A, Z, AA, Y, ZZ, AAA')
const cols = ALL_COLUMNS
const pr = paidRule(cols, 9000), payAt = cols.findIndex((c) => c.key === 'al_payment_status')
ok(pr && pr.ranges[0].startColumn === payAt && pr.ranges[0].endColumn === payAt && pr.ranges[0].startRow === 1 && pr.ranges[0].endRow === 9000,
  'paid rule covers exactly the AL Payment Status column, below the header', pr?.ranges)
ok(pr?.rule.value === `=OR(LOWER(TRIM(${columnLetter(payAt)}2))="cash invoiced",LOWER(TRIM(${columnLetter(payAt)}2))="fresh offtake")` && pr.rule.subType === 'formula' && pr.rule.style.bg.rgb === PAID_GREEN && PAID_GREEN === '#C6EFCE',
  'paid rule: case- and space-forgiving "cash invoiced" or "fresh offtake" on its own column, Excel Good green', pr?.rule)
ok(paidRule(cols.filter((c) => c.key !== 'al_payment_status'), 10) === null, 'no AL Payment Status column → no rule')
ok(JSON.stringify(formatOf(pay, { n: { pattern: '@' }, bg: { rgb: '#C6EFCE' } })) !== '{}', 'a hand-painted green on AL Payment Status is the person’s, saved like any colour')
ok(stable(formatOf(model, { n: { pattern: '@' }, bl: 1, cl: { rgb: '#FF0000' }, bg: null })) === stable({ bl: 1, cl: { rgb: '#FF0000' } }), 'bold + font colour saved; a null key is dropped')
ok(JSON.stringify(formatOf(ctc, { n: { pattern: '0.00' } })) === '{}', 'a number format changed from the toolbar is never saved (the column owns it)')
ok(styleWith(ctc, {}) === 'money' && styleWith(ctc, null) === 'money', 'nothing of the person’s → the shared column style')
const sw = styleWith(ctc, { bg: { rgb: '#FFFF00' }, n: { pattern: '0' } })
ok(sw.bg?.rgb === '#FFFF00' && sw.n?.pattern === MONEY, 'a saved format cannot replace the column’s number format', sw)
ok(lostNumberFormat(ctc, { bg: { rgb: '#FFFF00' } }) && !lostNumberFormat(ctc, { n: { pattern: MONEY } }) && !lostNumberFormat(COLUMN_BY_KEY.qty, {}),
  '"clear format" on money is caught; a column with no number format never is')
ok(stable(pastedFormat(ctc, { ff: 'Calibri', fs: 11, bd: { b: { s: 1 } }, bg: { rgb: '#FFFF00' } })) === stable({ bg: { rgb: '#FFFF00' } }),
  'a paste keeps only its fill, not Excel’s font, size and borders')
ok(JSON.stringify(pastedFormat(ctc, { ff: 'Calibri', fs: 11 })) === '{}', 'a paste with no fill brings nothing')
ok(sameFormat({ bg: { rgb: '#FF0000' }, bl: 1 }, { bl: 1, bg: { rgb: '#FF0000' } }) && sameFormat(undefined, {}) && !sameFormat({}, { bl: 1 }),
  'formats compare by content, not key order; missing = empty')

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

// ── slice 5: a value as people read it, find a vehicle, Copy for mail, a row's history
const C = (k) => COLUMN_BY_KEY[k]
ok(showValue(C('ctc'), 1234567) === '12,34,567' && showValue(C('ctc'), -120468) === '-1,20,468' && showValue(C('ctc'), 15000000) === '1,50,00,000',
  'money in lakhs (a crore shown properly)', [showValue(C('ctc'), 1234567), showValue(C('ctc'), 15000000)])
ok(showValue(C('ctc'), 1310.5) === '1,311' && showValue(C('ctc'), '1310.50') === '1,311', 'money as on screen: no paise; text from the history too')
ok(showValue(C('ptb_invoice_date'), 45843) === '05/07/25' && showValue(C('ptb_invoice_date'), '2025-07-05') === '05/07/25', 'a date: serial (grid) or iso (history) → dd/mm/yy')
ok(showValue(C('road_tax_pct'), 6) === '6' && showValue(C('qty'), 1) === '1' && showValue(C('road_tax_pct'), '8.50') === '8.5', 'percent / count: plain numbers')
ok(showValue(C('model'), 'CE2820') === 'CE2820' && showValue(C('ctc'), null) === '' && showValue(C('ctc'), '') === '', 'text as is; empty stays empty')

const book = [
  { id: 'a', chassis_no: 'MB1T2VHD7SPNF1312', engine_no: 'SPP123456', oem_gatepass_no: 'GP-7781312', customer_name: 'Navgujarat CFS' },
  { id: 'b', chassis_no: 'MB1T2VHD8SPNF1187', engine_no: 'SPP221312', oem_gatepass_no: 'GP-0001', customer_name: 'Rajshree and Co' },
  { id: 'c', chassis_no: 'MB1AB1312XYZ0001', engine_no: 'X1', customer_name: 'A 1312 Logistics' },
]
const ids = (q) => findRows(book, q).map((h) => `${h.id}:${h.key}`)
ok(JSON.stringify(ids('1312')) === JSON.stringify(['a:chassis_no', 'b:engine_no', 'c:chassis_no']),
  'ends-with on chassis/engine/gatepass first, then contains; equal ranks keep the book order', ids('1312'))
ok(JSON.stringify(ids('nf 1312')) === JSON.stringify(['a:chassis_no']), 'spaces and case do not matter', ids('nf 1312'))
ok(JSON.stringify(ids('gujarat')) === JSON.stringify(['a:customer_name']), 'part of a customer name')
ok(ids('13').length === 0 && ids('').length === 0, `under ${MIN_FIND} characters finds nothing (every row would match)`)
ok(ids('7781312')[0] === 'a:oem_gatepass_no' || ids('7781312')[0] === 'a:chassis_no', 'the gatepass digits find the truck', ids('7781312'))

const mt = mailTable([C('chassis_no'), C('ctc'), C('ptb_invoice_date'), C('al_payment_status')], [
  { values: ['MB1<X>&1', 1234567, 45843, 'Cash Invoiced'], bgs: [null, '#FFFF00', null, PAID_GREEN] },
  { values: ['MB1\tTAB', null, null, 'IBND'], bgs: [] },
])
ok(mt.text === 'Chassis No\tPTB CTC\tPTB Invoice Date\tAL Payment Status\r\nMB1<X>&1\t12,34,567\t05/07/25\tCash Invoiced\r\nMB1 TAB\t\t\tIBND',
  'plain text: header + one line per row, tab-separated, a tab inside a value cannot split a cell', mt.text)
ok(mt.html.includes('MB1&lt;X&gt;&amp;1') && !mt.html.includes('<X>'), 'html: text is escaped')
ok(mt.html.includes('background:#FFFF00') && mt.html.includes(`background:${PAID_GREEN}`) && mt.html.includes('>12,34,567<') && mt.html.includes('text-align:right'),
  'html: colours travel, money in lakhs and right-aligned')
ok((mt.html.match(/<tr>/g) || []).length === 3 && (mt.html.match(/<th /g) || []).length === 4, 'html: a header row + one row per vehicle')
ok(isPaid(' Fresh Offtake ') && isPaid('CASH INVOICED') && !isPaid('IBND') && !isPaid(null), 'paid = cash invoiced or fresh offtake (one list for the rule and the copy)')
ok(paidRule([C('al_payment_status')], 10).rule.value === `=OR(${PAID_WORDS.map((w) => `LOWER(TRIM(A2))="${w}"`).join(',')})`, 'the grid rule is built from the same list')

const hc = describeChange({ column_key: 'ctc', old_value: '2800000.00', new_value: '2900000', actor_name: 'Staging Admin', source: 'paste', created_at: '2026-10-23T09:05:00Z' }, COLUMN_BY_KEY)
ok(hc.what === 'PTB CTC' && hc.from === '28,00,000' && hc.to === '29,00,000' && hc.how === 'pasted' && hc.who === 'Staging Admin', 'history: column label, values as on screen, how', hc)
ok(hc.at.includes('14:35') && /23/.test(hc.at), 'history: the time in IST (09:05 UTC = 14:35 IST)', hc.at)
const hd = describeChange({ column_key: 'ptb_invoice_date', old_value: null, new_value: '2025-07-05', actor_name: null, source: 'typed', created_at: '2026-10-23T09:05:00Z' }, COLUMN_BY_KEY)
ok(hd.from === '' && hd.to === '05/07/25' && hd.who === 'someone', 'history: empty before, a date, no name')
const hn = describeChange({ column_key: '*', old_value: null, new_value: 'MB1X', actor_name: 'A', source: 'create', created_at: '2026-10-23T09:05:00Z' }, COLUMN_BY_KEY)
ok(hn.what === 'Vehicle added' && hn.to === 'MB1X' && hn.how === 'added', 'history: the row being created')

console.log(`selftest-tracker-cells: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
