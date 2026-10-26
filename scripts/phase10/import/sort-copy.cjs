// Phase 10 — COPY the tracker books of a pile into <source>\_Sorted\<kind>\<financial year>\, from the
// inventory.csv that inventory.cjs wrote (owner, 2026-10-26: "only the tracker books, by kind and year").
// The originals are never moved, renamed or changed; a file already at the destination is never overwritten;
// each copy keeps its saved date. Exact duplicates are copied once (the one the inventory kept). A file the
// inventory marked an older/shorter copy of another goes to that year's "Older copies" folder.
//
//   node scripts/phase10/import/sort-copy.cjs <source folder>          (dry run: counts only)
//   node scripts/phase10/import/sort-copy.cjs <source folder> --copy   (copies; writes _Inventory\sorted.csv)
const fs = require('fs')
const path = require('path')

const [src, flag] = process.argv.slice(2)
if (!src) { console.error('usage: sort-copy.cjs <source folder> [--copy]'); process.exit(2) }
const COPY = flag === '--copy'
const sorted = path.join(src, '_Sorted')
const inventory = path.join(sorted, '_Inventory', 'inventory.csv')

function parseCsv(t) {
  const rows = []
  let row = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}

// one folder per book, whatever sheets it also carries (the purchase book holds INVOICE TRACKER + OTHER DEALER;
// the sales list holds PTB RETAIL + DEALERS + REBILL …)
function kindOf(families) {
  const has = (f) => families.includes(f)
  if (has('AL_SHEET')) return 'AL Balance Sheet'
  if (has('IT') || has('IT_OD')) return 'Invoice tracker (purchase book)'
  if (has('FY')) return 'Sales book (payment tracker)'
  if (has('LIST') || has('LIST_OD') || has('DEALERS') || has('REBILL')) return 'Sales list (PTB retail)'
  if (has('RET_AL') || has('RET_INT')) return 'Retention'
  return null
}

const rows = parseCsv(fs.readFileSync(inventory, 'utf8').replace(/^﻿/, ''))
const h = rows.shift()
const ix = Object.fromEntries(h.map((k, i) => [k, i]))
// a book an earlier run already copied (its copy still there) is not copied again
const done = new Map()
try {
  for (const [orig, copy] of parseCsv(fs.readFileSync(path.join(sorted, '_Inventory', 'sorted.csv'), 'utf8').replace(/^﻿/, '')).slice(1))
    if (fs.existsSync(path.join(src, copy))) done.set(orig, path.join(src, copy))
} catch { /* first run */ }
const plan = []
const taken = new Set([...done.values()].map((d) => d.toLowerCase()))
for (const r of rows) {
  if (!r[ix.family] || r[ix.dupOf]) continue
  const kind = kindOf(r[ix.family].split('+'))
  if (!kind) continue
  if (done.has(r[ix.rel])) { plan.push({ rel: r[ix.rel], dest: done.get(r[ix.rel]), kind, year: r[ix.fy] || 'Year unknown', older: Boolean(r[ix.copyOf]), already: true }); continue }
  const year = r[ix.fy] || 'Year unknown'
  const dir = path.join(sorted, kind, year, r[ix.copyOf] ? 'Older copies' : '')
  // two different files with one name: the second is named after the PC folder it came from, then numbered
  const ext = path.extname(r[ix.rel]), stem = path.basename(r[ix.rel], ext), from = r[ix.rel].split(/[\\/]/)[0]
  let dest = path.join(dir, stem + ext)
  for (let k = 1; taken.has(dest.toLowerCase()) || (COPY && fs.existsSync(dest)); k++) dest = path.join(dir, `${stem} (${from}${k > 1 ? ` ${k}` : ''})${ext}`)
  taken.add(dest.toLowerCase())
  plan.push({ rel: r[ix.rel], dest, kind, year, older: Boolean(r[ix.copyOf]) })
}

const count = new Map()
for (const p of plan) { const k = `${p.kind} | ${p.year}`; const c = count.get(k) ?? [0, 0]; c[p.older ? 1 : 0]++; count.set(k, c) }
console.log(`${COPY ? 'Copying' : 'Would copy'} ${plan.length} books into ${sorted}`)
for (const k of [...count.keys()].sort()) { const [a, b] = count.get(k); console.log(`  ${k}: ${a}${b ? ` + ${b} older copies` : ''}`) }
if (!COPY) { console.log('(dry run — nothing copied; add --copy)'); process.exit(0) }

let copied = 0
for (const p of plan) {
  if (p.already) continue
  const from = path.join(src, p.rel)
  fs.mkdirSync(path.dirname(p.dest), { recursive: true })
  fs.copyFileSync(from, p.dest, fs.constants.COPYFILE_EXCL)
  const st = fs.statSync(from)
  fs.utimesSync(p.dest, st.atime, st.mtime)
  copied++
}
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
fs.writeFileSync(path.join(sorted, '_Inventory', 'sorted.csv'), '﻿' + ['original,copy,kind,year,older copy',
  ...plan.map((p) => [p.rel, path.relative(src, p.dest), p.kind, p.year, p.older ? 'yes' : ''].map(csv).join(','))].join('\r\n'))
console.log(`Copied ${copied}${plan.length - copied ? ` (${plan.length - copied} were already there)` : ''}. List: ${path.join(sorted, '_Inventory', 'sorted.csv')}`)
