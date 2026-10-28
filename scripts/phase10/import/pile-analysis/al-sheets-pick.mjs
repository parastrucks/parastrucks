// The AL Balance Sheets for the monthly check, picked from EVERY copy in `_Sorted\AL Balance Sheet` (owner,
// 2026-10-28: "AL Balance sheets are already there in the backup data"). Each copy is read with the panel's
// OWN reader (src/tracker/lib/alSheet.js — the same code the "AL sheet" button runs in the browser), so the month
// is the one the upload would take; per month, the latest-saved copy that reads. Prints month, file, saved date,
// line count and warning count only — never a chassis or an amount — and writes the list of picked files.
//
//   node scripts/phase10/import/pile-analysis/al-sheets-pick.mjs <Backup data> <out list.json>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const { readAlWorkbook } = await import('../../../../src/tracker/lib/alSheet.js')

const [src, out] = process.argv.slice(2)
const root = path.join(src, '_Sorted', 'AL Balance Sheet')
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.xls[xm]?$/i.test(e.name)) files.push(p) } }
walk(root)
const read = []
for (const p of files) {
  const saved = fs.statSync(p).mtime.toISOString()
  try {
    const r = readAlWorkbook(XLSX, XLSX.readFile(p, { cellFormula: true }), path.basename(p))
    read.push({ p, saved, month: r.month, lines: r.lines.length, warnings: (r.warnings ?? []).length })
  } catch (e) { read.push({ p, saved, error: String(e.message).slice(0, 80) }) }
}
const byMonth = new Map()
for (const r of read.filter((x) => x.month && x.lines)) { if (!byMonth.has(r.month)) byMonth.set(r.month, []); byMonth.get(r.month).push(r) }
const picked = []
for (const m of [...byMonth.keys()].sort()) {
  const all = byMonth.get(m).sort((a, b) => a.saved.localeCompare(b.saved))
  const best = all.at(-1)
  picked.push({ month: m, path: best.p, name: path.basename(best.p) })
  console.log(`${m}  ${best.saved.slice(0, 10)}  ${path.relative(root, best.p)}  — ${best.lines} lines, ${best.warnings} warnings (latest of ${all.length}${all.some((x) => x.lines !== best.lines) ? `; line counts ${[...new Set(all.map((x) => x.lines))].join('/')}` : ''})`)
}
const bad = read.filter((x) => x.error || !x.month || !x.lines)
console.log(`\n${files.length} copies read · ${picked.length} months picked · not readable / no month: ${bad.length}`)
for (const b of bad) console.log(`  ${path.relative(root, b.p)} — ${b.error ?? (b.month ? 'no lines' : 'no month')}`)
fs.writeFileSync(out, JSON.stringify(picked, null, 1))
