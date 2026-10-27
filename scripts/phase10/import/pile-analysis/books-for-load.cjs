// Which sorted books go into the all-years load? For every book in `_Sorted\<kind>\<year>\` (the top level;
// `--older` adds the "Older copies"): the families the importer recognises in it, trucks per family, the months
// its dates fall in (most common first), its saved date — and, per family, how many trucks each pair of books
// shares. Prints file names, counts and months only (never a chassis, amount or customer).
//
//   node scripts/phase10/import/pile-analysis/books-for-load.cjs "D:/PTB/Finances/Backup data" [--older] [kind filter]
const fs = require('fs')
const path = require('path')
const { readAll } = require('../read.cjs')

const [src, ...rest] = process.argv.slice(2)
const older = rest.includes('--older')
const filter = rest.find((a) => !a.startsWith('--'))
const sorted = path.join(src, '_Sorted')
const KINDS = ['Invoice tracker (purchase book)', 'Sales book (payment tracker)', 'Sales list (PTB retail)', 'Retention']
const CH = { IT: 'CHASSIS NO', FY: 'CHASSIS NUMBER', LIST: 'CHASSIS NUMBER', LIST_OD: 'CHASSIS NO', RET_INT: 'CHASSIS NO', RET_AL: 'CHASSIS NO', REBILL: 'CHASSIS NUMBER', IT_OD: 'CHASSIS NO' }
const norm = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase()
const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
const fromSerial = (n) => new Date(Math.round((n - 25569) * 864e5))

const books = []
for (const kind of KINDS.filter((k) => !filter || k.toLowerCase().includes(filter.toLowerCase()))) {
  for (const year of fs.readdirSync(path.join(sorted, kind))) {
    const dir = path.join(sorted, kind, year)
    const files = fs.readdirSync(dir).filter((n) => /\.xlsx$/i.test(n)).map((n) => ({ p: path.join(dir, n), older: false }))
    if (older && fs.existsSync(path.join(dir, 'Older copies'))) files.push(...fs.readdirSync(path.join(dir, 'Older copies')).filter((n) => /\.xlsx$/i.test(n)).map((n) => ({ p: path.join(dir, 'Older copies', n), older: true })))
    for (const f of files) {
      const t0 = Date.now()
      const { families, seen } = readAll([f.p])
      const fam = {}
      const months = new Map()
      for (const [k, rows] of Object.entries(families)) {
        if (!rows.length) continue
        const set = new Set()
        for (const r of rows) {
          const c = norm(r.cells[CH[k]]?.v); if (c.length > 13) set.add(c)
          for (const cell of Object.values(r.cells)) {
            // a date cell: an Excel serial with a date format, in 2015–2035
            if (typeof cell.v === 'number' && cell.z && /[dmy]/i.test(cell.z) && !/[#0]/.test(cell.z) && cell.v > 42005 && cell.v < 49710) { const m = month(fromSerial(cell.v)); months.set(m, (months.get(m) ?? 0) + 1) }
          }
        }
        fam[k] = set
      }
      const ms = [...months].sort((a, b) => b[1] - a[1])
      const span = [...months.keys()].sort()
      books.push({ kind, year, name: path.basename(f.p), older: f.older, fam, saved: fs.statSync(f.p).mtime.toISOString().slice(0, 10),
        top: ms.slice(0, 3).map(([m, n]) => `${m}×${n}`).join(' '), span: span.length ? `${span[0]}→${span.at(-1)}` : '-',
        sheets: seen.filter((s) => s.family).map((s) => `${s.sheet}[${s.layout}]`).join(', '), secs: ((Date.now() - t0) / 1000).toFixed(1) })
      const b = books.at(-1)
      console.log(`${kind} | ${year}${b.older ? ' | older' : ''} | ${b.name} | saved ${b.saved} | ${Object.entries(fam).map(([k, s]) => `${k} ${s.size}`).join(' · ')} | months ${b.top} | span ${b.span} | ${b.sheets} | ${b.secs}s`)
    }
  }
}

// per family: pairs of books sharing trucks (≥ 20 shared, or ≥ 50% of the smaller)
console.log('\n=== shared trucks, per family (a ↔ b: shared / a / b) ===')
const fams = [...new Set(books.flatMap((b) => Object.keys(b.fam)))]
for (const k of fams) {
  const hold = books.filter((b) => b.fam[k]?.size)
  for (let i = 0; i < hold.length; i++) for (let j = i + 1; j < hold.length; j++) {
    const a = hold[i].fam[k], b = hold[j].fam[k]
    let n = 0; for (const c of a) if (b.has(c)) n++
    if (n >= 20 || (n && n >= 0.5 * Math.min(a.size, b.size))) console.log(`${k}: ${hold[i].year}/${hold[i].name}${hold[i].older ? ' (older)' : ''} ↔ ${hold[j].year}/${hold[j].name}${hold[j].older ? ' (older)' : ''}: ${n} / ${a.size} / ${b.size}`)
  }
}
