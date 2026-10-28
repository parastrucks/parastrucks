// Phase 10 — offline self-test for the AL Balance Sheet reader (src/tracker/lib/alSheet.js).
//
//   node scripts/phase10/selftest-al-sheet.mjs                 made-up workbooks, built in memory
//   node scripts/phase10/selftest-al-sheet.mjs --real <folder>  + every "AL Balance Sheet -MMYY.xlsx" in the folder
//                                                               (REAL data: prints COUNTS only, never an amount)
// Expectations are written out by hand.
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { parseAlSheet, readAlWorkbook, sheetTotals, monthFromFileName, MAX_AL_LINES } from '../../src/tracker/lib/alSheet.js'
import { isoToSerial } from '../../src/tracker/lib/cellValues.js'

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) pass++; else { fail++; console.log('FAIL', label, got === undefined ? '' : JSON.stringify(got)) } }
const throws = (fn) => { try { fn(); return null } catch (e) { return e.message } }
const d = (iso) => isoToSerial(iso)

// a workbook from rows; cells given as { f } become formulas (value v kept)
function book(rows, { sheet = 'AL Balance Sheet', origin = 'A1', others = [] } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c))), { origin })
  const o = XLSX.utils.decode_cell(origin)
  rows.forEach((r, ri) => r.forEach((c, ci) => { if (c && typeof c === 'object' && c.f) ws[XLSX.utils.encode_cell({ r: ri + o.r, c: ci + o.c })].f = c.f }))
  const wb = XLSX.utils.book_new()
  for (const n of others) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), n)
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellFormula: true })
}

const HEAD = ['Date', 'Details', 'Debit', 'Credit', 'CBN Number', 'Chassis No', 'Engine No', 'CTD', 'Offtake Mode']
const march = [
  HEAD,
  [d('2026-02-28'), 'CARRY OVER', 1000, null, null, null, null, null, null],
  [d('2026-03-02'), 'CBN1 MB1AAA001 EN1', null, { v: 998.999, f: 'H3*0.999' }, ' cbn1 ', ' mb1aaa001 ', 'en1', 1000, 'fresh offtake'],
  [d('2026-03-03'), 'INDENT AXIS', 5000, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],                         // a blank row: not a line
  [d('2026-03-05'), 'CBN2 MB1AAA002 EN2', null, 900, 'CBN2', 'MB1AAA002', 'EN2', 1000, 'IBND'],  // typed, not a formula
  [d('2026-03-31'), 'Net Balance', 4101.0012, null, null, null, null, null, null],   // 1,000 + 5,000 − 999 − 900
]

// ── the reader
{
  const r = readAlWorkbook(XLSX, book(march, { others: ['Summary'] }), 'AL Balance Sheet -0326.xlsx')
  ok(r.month === '2026-03-01', 'month = where most lines are dated (CARRY OVER is February)', r.month)
  ok(r.warnings.length === 0, 'file name agrees → no warning', r.warnings)
  ok(r.lines.length === 5, 'blank row skipped: 5 lines', r.lines.length)
  ok(JSON.stringify(r.lines.map((l) => l.row_no)) === '[2,3,4,6,7]', 'row numbers as Excel shows them', r.lines.map((l) => l.row_no))
  const t = r.lines[1]
  ok(t.chassis_no === 'MB1AAA001' && t.cbn === 'CBN1' && t.engine_no === 'EN1' && t.offtake_mode === 'FRESH OFFTAKE', 'chassis/CBN/engine/mode trimmed, upper case', t)
  ok(t.credit === 999 && t.ctd === 1000 && t.line_date === '2026-03-02', 'money to the paisa, the date as a date', [t.credit, t.ctd, t.line_date])
  ok(t.credit_is_formula === true && r.lines[3].credit_is_formula === false, 'a formula credit vs a typed one')
  ok(r.lines[0].credit_is_formula === null && r.lines[2].credit === null && r.lines[2].debit === 5000, 'a money line: debit only, no formula question')
  ok(r.lines[4].debit === 4101, 'Net Balance read (rounded)', r.lines[4].debit)
  const s = sheetTotals(r.lines)
  ok(s.paid === 6000 && s.owed === 1899 && s.net === 4101 && s.carry === 1000 && s.ties === true, 'totals: paid, owed, net, carry; it ties', s)
  const wrong = sheetTotals(r.lines.map((l) => (l.details === 'Net Balance' ? { ...l, debit: 4200 } : l)))
  ok(wrong.ties === false, 'a Net Balance ₹99 off does not tie')
  ok(s.credits === 2 && s.payments === 1, 'two credit lines, one payment (carry and net apart)', s)
}
// headers by NAME: shuffled, extra unnamed columns, a second "Date" (first wins)
{
  const rows = [['Offtake Mode', '', 'Chassis No', 'Details', 'Date', 'CTD', 'Credit', 'Debit', 'Date', ''],
    ['IBND', 7, 'X1', 'a line', d('2026-04-02'), 100, 99.9, null, d('2019-01-01'), 'scratch'],
    ['IBND', 8, 'X2', 'b line', d('2026-04-03'), 100, 99.9, null, d('2019-01-01'), null]]
  const r = parseAlSheet({ rows, fileName: 'AL Balance Sheet -0426.xlsx' })
  ok(r.month === '2026-04-01' && r.lines[0].chassis_no === 'X1' && r.lines[0].credit === 99.9 && r.lines[0].cbn === null, 'columns found by header; the first "Date"; CBN optional', r.lines[0])
}
// the file name disagrees → read by the dates, said
{
  const r = readAlWorkbook(XLSX, book(march), 'AL Balance Sheet -0226.xlsx')
  ok(r.month === '2026-03-01' && /February 2026.*March 2026/.test(r.warnings[0] ?? ''), 'file name February, lines March → March, with a warning', r.warnings)
}
// a sheet that does not start at A1: row numbers and formula lookups still right
{
  const r = readAlWorkbook(XLSX, book(march, { origin: 'B3' }), 'x-0326.xlsx')
  ok(r.lines[1].row_no === 5 && r.lines[1].credit_is_formula === true && r.lines[3].credit_is_formula === false, 'used range from B3: row 5, formula found', [r.lines[1].row_no, r.lines[1].credit_is_formula])
}
// the sheet found by its header when it is named differently
{
  const r = readAlWorkbook(XLSX, book(march, { sheet: 'Mar 26' }), 'x.xlsx')
  ok(r.lines.length === 5, 'a differently named sheet with an Offtake Mode header is read')
  const e = throws(() => readAlWorkbook(XLSX, book([['a', 'b'], [1, 2]], { sheet: 'Other' }), 'x.xlsx'))
  ok(/No “AL Balance Sheet” sheet/.test(e ?? ''), 'no such sheet → said', e)
}
// refusals
{
  ok(/“Credit”, “CTD”/.test(throws(() => parseAlSheet({ rows: [['Date', 'Details', 'Debit', 'Chassis No', 'Offtake Mode'], [1, 'x', 1, null, null]] })) ?? ''), 'missing columns named')
  ok(/No line has a date/.test(throws(() => parseAlSheet({ rows: [HEAD, [null, 'x', 5, null, null, null, null, null, null]] })) ?? ''), 'no dated line → refused')
  ok(/no lines/.test(throws(() => parseAlSheet({ rows: [HEAD, [null, null, null, null, null, null, null, null, null]] })) ?? ''), 'only blank rows → refused')
  const big = [HEAD, ...Array.from({ length: MAX_AL_LINES + 1 }, (_, i) => [d('2026-03-02'), `L${i}`, 1, null, null, null, null, null, null])]
  ok(/at most 2000/.test(throws(() => parseAlSheet({ rows: big })) ?? ''), 'more than 2,000 lines → refused')
  ok(monthFromFileName('AL Balance Sheet -0326.xlsx') === '2026-03-01' && monthFromFileName('AL Balance Sheet -1325.xlsx') === null && monthFromFileName('notes.xlsx') === null, 'file name → month (13 is not a month)')
}

// ── every check the database can return has a line in the panel, and every line is a real check
{
  const { AL_CHECKS, groupIssues } = await import('../../src/tracker/lib/alChecks.js')
  const mig = fs.readFileSync(new URL('../../supabase/migrations/20261025_phase10_tracker_al_sheet.sql', import.meta.url), 'utf8')
  const body = mig.slice(mig.indexOf('), issues as ('), mig.indexOf('select jsonb_build_object(\n  \'months\''))
  const inDb = [...body.matchAll(/select '([a-z_0-9]+)'/g)].map((m) => m[1]).sort()
  const inPanel = AL_CHECKS.map((c) => c.key).sort()
  ok(inDb.length >= 19 && JSON.stringify(inDb) === JSON.stringify(inPanel), 'the panel names exactly the checks the database runs', { inDb, inPanel })
  ok(AL_CHECKS.every((c) => c.title && c.hint), 'every check has a title and a hint')
  const g = groupIssues([{ check: 'no_mode', subject: 'a' }, { check: 'net_not_tie', subject: 'b' }, { check: 'no_mode', subject: 'c', settled: { reason: 'r' } }, { check: 'zzz', subject: 'd' }])
  ok(g.map((x) => x.check.key).join() === 'net_not_tie,no_mode,zzz' && g[1].open.length === 1 && g[1].settled.length === 1 && g[2].check.title === 'zzz',
    'grouped in the panel order, settled apart, an unknown check last under its own name')
}

// ── one financial year at a time (April → March); an issue with no month shows in every year
{
  const { fyOfMonth, inFy, reviewYears } = await import('../../src/tracker/lib/alChecks.js')
  ok(fyOfMonth('2026-03') === 2025 && fyOfMonth('2026-04') === 2026 && fyOfMonth('2023-10') === 2023 && fyOfMonth('2027-01') === 2026 && fyOfMonth(null) === null,
    'month → financial year: Mar is the year before, Apr starts the year')
  ok(inFy('2026-02', 2025) && !inFy('2026-04', 2025) && inFy(null, 2025) && inFy('2023-10', null),
    'in a year: its months only · no month = every year · "All years" = everything')
  const ys = reviewYears({ months: [{ month: '2025-09' }, { month: '2026-04' }], issues: [{ month: '2023-12' }, { month: null }, { month: '2026-05' }] })
  ok(ys.join() === '2026,2025,2023', 'the years: from months and issues, newest first, none for a month-less issue', ys)
}

// ── the real files (counts only)
const ri = process.argv.indexOf('--real')
if (ri > 0) {
  const dir = process.argv[ri + 1]
  const files = fs.readdirSync(dir).filter((f) => /^AL Balance Sheet -\d{4}\.xlsx$/i.test(f)).sort((a, b) => monthFromFileName(a).localeCompare(monthFromFileName(b)))
  let prevNet = null, carryOk = 0, carryChecked = 0
  for (const f of files) {
    const r = readAlWorkbook(XLSX, XLSX.read(fs.readFileSync(path.join(dir, f)), { type: 'buffer', cellFormula: true }), f)
    const s = sheetTotals(r.lines)
    const typed = r.lines.filter((l) => l.credit_is_formula === false).length
    if (prevNet !== null && s.carry !== null) { carryChecked++; if (Math.abs(s.carry - prevNet) < 1) carryOk++ }
    prevNet = s.net
    ok(r.month === monthFromFileName(f) && r.warnings.length === 0, `${f}: month read = file name, no warning`, [r.month, r.warnings])
    ok(s.ties, `${f}: Net Balance = paid − owed`)
    console.log(`  ${f}: ${r.lines.length} lines · ${s.credits} credit · ${s.payments} money · ${typed} credits typed as numbers`)
  }
  ok(carryChecked === files.length - 1 && carryOk === carryChecked, "CARRY OVER = last month's Net Balance, every month", [carryOk, carryChecked])
}

console.log(`selftest-al-sheet: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
