// Diagnostic for audit findings A2b / A2a: are blank Excel cells being coerced
// into real zeros on the REAL workbook, and does that suppress the AL staleness
// safeguard? Read-only; prints, asserts nothing.
// Usage: node scripts/tiv/diag-blank-zero.mjs "<path to Market Data 22-27.xlsx>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'
import { SEGMENTS, SEG_COL } from '../../src/tiv-forecast/constants.js'

const buf = fs.readFileSync(process.argv[2])
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const COLS = SEGMENTS.map(s => SEG_COL[s])
const allZero = r => COLS.every(c => Number(r[c]) === 0)

console.log(`TIV months: ${parsed.tivActuals.length}, last = ${parsed.summary.lastDataMonth}`)
console.log(`AL rows: ${parsed.alActuals.length} · PTB rows: ${parsed.ptbActuals.length}`)

console.log('\n=== AL rows, last 8 ===')
for (const r of parsed.alActuals.slice(-8)) {
  const vals = COLS.map(c => String(r[c]).padStart(5)).join(' ')
  console.log(`${String(r.month_label).padEnd(9)} [${vals}] ${allZero(r) ? '<-- ALL ZERO' : ''}`)
}

const azAl = parsed.alActuals.filter(allZero)
const azTiv = parsed.tivActuals.filter(allZero)
const azPtb = parsed.ptbActuals.filter(allZero)
console.log(`\nAll-zero AL rows : ${azAl.length}${azAl.length ? ' -> ' + azAl.map(r => r.month_label).join(', ') : ''}`)
console.log(`All-zero TIV rows: ${azTiv.length}${azTiv.length ? ' -> ' + azTiv.map(r => r.month_label).join(', ') : ''}`)
console.log(`All-zero PTB rows: ${azPtb.length}${azPtb.length ? ' -> ' + azPtb.map(r => r.month_label).join(', ') : ''}`)

const lastAl = parsed.alActuals.reduce((a, b) => (a.month_index > b.month_index ? a : b))
console.log(`\nUI lastAlMonth      : ${lastAl.month_label}`)
console.log(`UI last_data_month  : ${parsed.summary.lastDataMonth}`)
console.log(`AL staleness chip   : ${lastAl.month_label !== parsed.summary.lastDataMonth ? 'SHOWS' : 'SUPPRESSED  <-- safeguard defeated'}`)

const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
console.log('\n=== al_share_recent (6-month avg of AL/TIV) ===')
for (const s of SEGMENTS) {
  const v = params.al_share_recent[s]
  console.log(`  ${s.padEnd(11)} ${(v * 100).toFixed(1)}%${v <= 0.05 ? '  <-- at/below AL_SHARE_MIN floor' : ''}`)
}
