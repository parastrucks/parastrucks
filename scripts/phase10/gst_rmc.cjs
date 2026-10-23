// Phase 10 — which trucks were billed at 18% GST before the 22 Sep 2025 change? (2026-10-23)
//
//   node scripts/phase10/gst_rmc.cjs
//
// The rate sits in one formula of the 2025-26 sheet: FULL TAX = value / 1.28 (or / 1.18) × road tax.
// Every row is classified by that divisor and its PTB invoice date. Prints counts, model names and
// dates only — no figures. Result on the March-26 copy: with a real invoice date before the change,
// the 18% rows are 63 RMC chassis (model "… R RMC", filed under segment TIPPER) + one tractor; one
// RMC was billed at 28%. Rows with no invoice date (Excel 0) are unsold stock = 18% anyway.
// → owner, 2026-10-23: "only RMC always at 18%" (migration 20261023_phase10_tracker_rmc_gst.sql).
const XLSX = require('xlsx')
const FILE = 'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/2025-26.xlsx'
const COL = { segment: 2, model: 4, fullTax: 26, invoiceDate: 33 } // Sheet1 columns, checked by header below
const CHANGE = '2025-09-22'

const ws = XLSX.readFile(FILE, { cellFormula: true }).Sheets.Sheet1
const g = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
const head = (c) => String(g(0, c)?.v ?? '').replace(/\s+/g, ' ').trim()
if (head(COL.fullTax) !== 'FULL TAX' || head(COL.model) !== 'Model' || head(COL.invoiceDate) !== 'PTB INVOICE DATE') {
  throw new Error('2025-26 Sheet1 columns moved — fix COL before trusting the counts')
}
const iso = (v) => typeof v === 'number' && v > 0 ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) : null

const count = { rmcEarly18: 0, otherEarly18: 0, early28: 0, noDate18: 0, late18: 0, late28: 0 }
const odd = []
const last = XLSX.utils.decode_range(ws['!ref']).e.r
for (let r = 1; r <= last; r++) {
  const f = g(r, COL.fullTax)?.f
  if (!f) continue
  const rate = /1\.18/.test(f) ? 18 : /1\.28/.test(f) ? 28 : null
  if (!rate) continue
  const model = String(g(r, COL.model)?.v ?? '').trim()
  const rmc = /\bRMC\b/i.test(model)
  const d = iso(g(r, COL.invoiceDate)?.v)
  if (!d) { if (rate === 18) count.noDate18++ }
  else if (d < CHANGE) { if (rate === 28) count.early28++; else if (rmc) count.rmcEarly18++; else count.otherEarly18++ }
  else count[rate === 18 ? 'late18' : 'late28']++
  const expect = rmc ? 18 : d && d < CHANGE ? 28 : 18
  if (rate !== expect) odd.push(`row ${r + 1}: ${String(g(r, COL.segment)?.v ?? '').trim()} | ${model} | invoice ${d ?? '—'} | billed ${rate}%, rule says ${expect}%`)
}
console.log(count)
console.log(`rows that break "RMC = 18% always, others 28% before ${CHANGE}": ${odd.length}`)
for (const line of odd) console.log('  ' + line)
