// Phase 10 import — read the workbooks and merge them, OUTSIDE the repository.
//
//   node scripts/phase10/import/run.cjs <output folder outside the repo> [file or folder …]
//
// With no files given it takes EVERY year this PC holds (2022-23 onward — one continuous book, owner
// 2026-10-24: "one continuous database that has all details about all vehicles"); the owner's updated
// copies replace them.
// Writes import.json (units, notes, formats, incentives, links — REAL DATA) to the output folder and
// prints COUNTS ONLY. Refuses an output folder inside the repository.
const path = require('path')
const fs = require('fs')
const { readAll, findFiles, FAMILIES } = require('./read.cjs')
const { merge } = require('./merge.cjs')

const [out, ...given] = process.argv.slice(2)
if (!out) { console.error('usage: run.cjs <output folder outside the repo> [files…]'); process.exit(2) }
const repo = path.resolve(__dirname, '..', '..', '..')
if (path.resolve(out).toLowerCase().startsWith(repo.toLowerCase())) { console.error('refused: the output holds real data — put it outside the repository'); process.exit(2) }

const FIN = 'D:/PTB/Finances/'
const DL = 'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/'
const MONTHS = ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR']
// a file's place in time — used ONLY to put files in order (inside one family the later file wins, and an
// earlier file's different figure becomes a note): its financial year (from its folder or its name), then
// the month in its name; a year book with no month (INVOICE TRACKER 2024-25) comes last in its year,
// as it is kept up to date all year. Folder first: a file in 2025-26/2025-04 named "APR'24" is April 2025.
const orderOf = (f) => {
  const fy = Number(/(20\d\d)-\d\d/.exec(f.replace(/\\/g, '/'))?.[1] ?? 0)
  const i = MONTHS.findIndex((m) => path.basename(f).toUpperCase().includes(m))
  return fy * 13 + (i < 0 ? 12 : i)
}
const fyOf = (f) => /(20\d\d-\d\d)/.exec(f.replace(/\\/g, '/'))?.[1] ?? '?'
const allYears = () => {
  const out = []
  for (const y of fs.readdirSync(FIN).filter((d) => /^20\d\d-\d\d$/.test(d))) {
    const root = fs.readdirSync(FIN + y).filter((n) => /\.xlsx$/i.test(n) && !n.startsWith('~$')).map((n) => FIN + y + '/' + n)
    const deep = findFiles([FIN + y]).filter((f) => !root.includes(f.replace(/\\/g, '/')))
    const yearSales = root.filter((f) => /PAYMENT TRACKER/i.test(f))
    out.push(...root.filter((f) => /INVOICE TRACKER|PAYMENT TRACKER/i.test(f)))
    // only the year folder's INVOICE TRACKER is the purchase book: a month folder's copy is an OLDER
    // snapshot (2025-10 holds one) — never read; a month's payment tracker only when the year has none
    out.push(...deep.filter((f) => /RETENTION|DBM/i.test(path.basename(f)) || (!yearSales.length && /PAYMENT TRACKER/i.test(path.basename(f)))))
  }
  if (fs.existsSync(DL)) out.push(DL + '2025-26.xlsx', ...findFiles([DL]).filter((f) => /INVOICE LIST/i.test(f)))
  return out
}
// --list <file>: the books to load, one per line "fy | month | path [| families]" (month APR…MAR, or blank for a
// year book — it comes last in its year; families e.g. "LIST_OD" = read only those of its sheets). For a sorted
// pile whose year folders follow the dates inside a file, not its name: the list says each file's year and
// month, and that order is the one used ("later file wins").
let files
if (given[0] === '--list') {
  const known = new Set(Object.values(FAMILIES).map((f, i) => f.as ?? Object.keys(FAMILIES)[i]))
  files = fs.readFileSync(given[1], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [fy, mon, p, fams] = l.split('|').map((s) => s.trim())
    const only = fams ? fams.split(/[\s,]+/).filter(Boolean) : null
    if (!/^20\d\d-\d\d$/.test(fy) || (mon && !MONTHS.includes(mon.toUpperCase())) || !fs.existsSync(p) || only?.some((f) => !known.has(f))) { console.error(`refused: bad line in the list: ${l.slice(0, 160)}`); process.exit(2) }
    return { path: p, fy, only, order: Number(fy.slice(0, 4)) * 13 + (mon ? MONTHS.indexOf(mon.toUpperCase()) : 12) }
  })
  files = files.map((f, i) => ({ ...f, i })).sort((a, b) => a.order - b.order || a.i - b.i)
} else {
  files = given.length ? given.flatMap((g) => fs.statSync(g).isDirectory() ? findFiles([g]) : [g]) : allYears()
  files = files.sort((a, b) => orderOf(a) - orderOf(b))
}

const t0 = Date.now()
const { families, seen } = readAll(files)

// two copies of ONE year's purchase or sales book would make the older copy look like a disagreement on
// every truck: refused (an override exists for a deliberate re-run). Across years a few trucks are
// shared (bought in March, sold in April) — reported, not refused.
const byFile = (fam, key) => { const m = new Map(); for (const r of families[fam]) { const c = String(r.cells[key]?.v ?? '').replace(/\s+/g, '').toUpperCase(); if (c.length > 13) (m.get(r.file) ?? m.set(r.file, new Set()).get(r.file)).add(c) } return m }
const fyOfName = (n) => /(20\d\d-\d\d)/.exec(n)?.[1] ?? '?'
const overlaps = []
for (const [fam, key] of [['IT', 'CHASSIS NO'], ['FY', 'CHASSIS NUMBER']]) {
  const m = [...byFile(fam, key)]
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
    const [fa, a] = m[i], [fb, b] = m[j]; let n = 0; for (const c of a) if (b.has(c)) n++
    if (!n) continue
    const share = n / Math.min(a.size, b.size)
    overlaps.push(`${fam}: ${fa} ↔ ${fb} share ${n} trucks (${Math.round(share * 100)}% of the smaller)`)
    if (share > 0.5 && fyOfName(fa) === fyOfName(fb) && !process.env.ALLOW_OVERLAP) {
      console.error(`refused: ${fa} and ${fb} look like two copies of one year's ${fam === 'IT' ? 'purchase' : 'sales'} book — give one (ALLOW_OVERLAP=1 to load both)`); process.exit(3)
    }
  }
}
const res = merge(families)
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'import.json'), JSON.stringify(res))

const r = res.report
console.log('files by year:', Object.entries(Object.groupBy(files, (f) => f.fy ?? fyOf(f))).map(([y, v]) => `${y} ${v.length}`).join(' · '))
console.log('books shared between files:', overlaps.length ? '\n  ' + overlaps.join('\n  ') : 'none')
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
const unknown = seen.filter((s) => !s.family && !s.leftOut).length, leftOut = seen.filter((s) => s.leftOut).length
console.log(`sheets not recognised (left out): ${unknown}${leftOut ? ` · recognised but not asked for by the list: ${leftOut}` : ''}`)
