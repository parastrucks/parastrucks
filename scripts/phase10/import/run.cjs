// Phase 10 import — read the workbooks and merge them, OUTSIDE the repository.
//
//   node scripts/phase10/import/run.cjs <output folder outside the repo> [file or folder …]
//
// With no files given it takes the 2025-26 set this PC holds (the owner's updated copies replace them).
// Writes import.json (units, notes, formats, incentives, links — REAL DATA) to the output folder and
// prints COUNTS ONLY. Refuses an output folder inside the repository.
const path = require('path')
const fs = require('fs')
const { readAll, findFiles } = require('./read.cjs')
const { merge } = require('./merge.cjs')

const [out, ...given] = process.argv.slice(2)
if (!out) { console.error('usage: run.cjs <output folder outside the repo> [files…]'); process.exit(2) }
const repo = path.resolve(__dirname, '..', '..', '..')
if (path.resolve(out).toLowerCase().startsWith(repo.toLowerCase())) { console.error('refused: the output holds real data — put it outside the repository'); process.exit(2) }

const FIN = 'D:/PTB/Finances/2025-26/'
const DL = 'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/'
const MONTHS = ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR']
// the month a monthly file covers, from its name — used ONLY to put files in order (a later month wins
// inside one family); a file the order cannot place goes first
const monthOf = (f) => {
  const n = path.basename(f).toUpperCase()
  const i = MONTHS.findIndex((m) => n.includes(m))
  const y = /(?:'|-|\s)(\d{2})\b/.exec(n.replace(/2025-26|0?\d{4}\.XLSX/g, ''))
  return i < 0 ? -1 : (Number(y?.[1] ?? 25) * 12 + (i < 9 ? i + 3 : i - 9))
}
let files = given.length ? given.flatMap((g) => fs.statSync(g).isDirectory() ? findFiles([g]) : [g]) : [
  FIN + 'INVOICE TRACKER 2025-26.xlsx',
  DL + '2025-26.xlsx',
  ...findFiles([DL]).filter((f) => /INVOICE LIST/i.test(f)),
  ...findFiles([FIN]).filter((f) => /RETENTION TRACKER/i.test(f)),
]
files = files.sort((a, b) => monthOf(a) - monthOf(b))

const t0 = Date.now()
const { families, seen } = readAll(files)
const res = merge(families)
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'import.json'), JSON.stringify(res))

const r = res.report
console.log(`read ${files.length} files in ${((Date.now() - t0) / 1000).toFixed(1)} s · sheets recognised: ` +
  Object.entries(Object.groupBy(seen.filter((s) => s.family), (s) => s.family)).map(([k, v]) => `${k} ${v.length}`).join(' · '))
console.log(`rows per family: ${Object.entries(families).map(([k, v]) => `${k} ${v.length}`).join(' · ')}`)
console.log(`TRUCKS ${r.trucks} · notes ${res.notes.length} (${Object.entries(Object.groupBy(res.notes, (n) => n.source)).map(([k, v]) => `${k} ${v.length}`).join(', ')}) · colours ${res.formats.length} · incentive rows ${res.incentives.length} · rebill links ${res.links.length}`)
console.log('rows with no chassis:', r.rowsWithoutChassis, '· same truck twice in a family:', r.repeatedInFamily)
console.log('cells where files disagree, by column:', Object.entries(r.conflicts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '))
console.log('unreadable cells:', Object.entries(r.unreadable).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none')
console.log('refund statuses kept as typed:', Object.keys(r.refundKept).length ? Object.entries(r.refundKept).map(([k, v]) => `"${k}" ${v}`).join(' · ') : 'none')
const filled = (k) => res.units.filter((u) => u[k] !== undefined && u[k] !== null).length
console.log(`overrides: gst_rate ${filled('gst_rate_override')} · full tax ${filled('full_tax_override')} · road tax 0% ${res.units.filter((u) => u.road_tax_pct === 0).length}, 8% ${res.units.filter((u) => u.road_tax_pct === 8).length} · endhan_date ${filled('endhan_date')}`)
console.log(`purchase: al ${res.units.filter((u) => u.purchase_source === 'al').length} · other dealer ${res.units.filter((u) => u.purchase_source === 'other_dealer').length} · ctc_basis exclusive ${res.units.filter((u) => u.ctc_basis === 'exclusive').length}`)
const unknown = seen.filter((s) => !s.family).length
console.log(`sheets not recognised (left out): ${unknown}`)
