// Phase 10 — is EVERY vehicle in the pile also in the sorted tracker books? (owner, 2026-10-26: before deleting,
// "a complete end-to-end check … so that you can know that you have all the vehicles' data from the past").
// Reads every spreadsheet, PDF (text layer), Word file, CSV/text and e-mail in <source> (not _Sorted, not
// _To delete — whose duplicates verify-to-delete.cjs proves are byte-identical to files that stay), finds every
// chassis-shaped token, and compares with the chassis in <source>\_Sorted's books. Files are shared out to a pool
// of worker processes (vehicle-scan-worker.cjs), each file with a time limit. Read-only on the source.
// Output (outside the repo): vehicles.csv (each chassis: in the books?, how found, where) + summary.txt;
// the console shows counts only.
//
//   node scripts/phase10/import/vehicle-scan.cjs <source folder> <output folder> <chassis regex> [workers]
const fs = require('fs')
const path = require('path')
const os = require('os')
const { fork } = require('child_process')

const [src, out, reSrc, nArg] = process.argv.slice(2)
if (!src || !out || !reSrc) { console.error('usage: vehicle-scan.cjs <source folder> <output folder> <chassis regex> [workers]'); process.exit(2) }
const repo = path.resolve(__dirname, '../../..')
if (path.resolve(out).toLowerCase().startsWith(repo.toLowerCase())) { console.error('refused: put the output outside the repository'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })
const WORKERS = Number(nArg) || Math.max(2, os.cpus().length - 4)
const LIMIT_MS = Number(process.env.VEHICLE_SCAN_LIMIT_MS) || 180_000
const READABLE = /\.(xlsx|xlsm|xlsb|xls|ods|pdf|docx|csv|txt|doc|rtf|eml|msg|htm|html|xml)$/i

function walk(d, skipTop, acc = []) {
  let entries
  try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!(d === src && skipTop.includes(e.name))) walk(p, skipTop, acc) }
    else acc.push(p)
  }
  return acc
}

// a pool of worker processes; a file that runs over the limit kills its worker, which is replaced
function pool(n) {
  const idle = []
  const waiting = []
  const spawn = () => {
    const w = { child: fork(path.join(__dirname, 'vehicle-scan-worker.cjs'), [], { execArgv: ['--max-old-space-size=2048'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }), done: null }
    w.child.on('message', (m) => { const d = w.done; w.done = null; if (d) d(m) })
    w.child.on('exit', () => { w.dead = true; const d = w.done; w.done = null; if (d) d({ how: 'retry' }) }) // crashed or out of memory: tried again on a fresh worker
    // a worker that died while idle makes the next send fail: that file is retried on a fresh worker
    w.child.on('error', () => { w.dead = true; const d = w.done; w.done = null; if (d) d({ how: 'retry' }) })
    return w
  }
  for (let i = 0; i < n; i++) idle.push(spawn())
  const get = () => (idle.length ? Promise.resolve(idle.pop()) : new Promise((r) => waiting.push(r)))
  const put = (w) => (waiting.length ? waiting.shift()(w) : idle.push(w))
  return {
    async run(p, tries = 2) {
      let w = await get()
      if (w.dead || !w.child.connected) w = spawn()
      const res = await new Promise((resolve) => {
        const timer = setTimeout(() => { w.done = null; w.dead = true; w.child.kill(); resolve({ how: 'error', error: `over ${LIMIT_MS / 1000} s` }) }, LIMIT_MS)
        w.done = (m) => { clearTimeout(timer); resolve(m) }
        try { w.child.send({ p, re: reSrc }) } catch { w.dead = true; w.done = null; clearTimeout(timer); resolve({ how: 'retry' }) }
      })
      put(w.dead || !w.child.connected ? spawn() : w)
      if (res.how === 'retry') return tries > 1 ? this.run(p, tries - 1) : { how: 'error', error: 'the reader crashed or ran out of memory, twice' }
      return res
    },
    stop() { for (const w of idle) w.child.kill() },
  }
}

async function main() {
  const t0 = Date.now()
  const books = walk(path.join(src, '_Sorted'), []).filter((p) => !p.includes(`${path.sep}_Inventory${path.sep}`) && READABLE.test(p))
  const pile = walk(src, ['_Sorted', '_To delete'])
  const toRead = pile.filter((p) => READABLE.test(p))
  console.log(`${books.length} sorted books · ${pile.length} files in the pile, ${toRead.length} of a readable kind (${pile.length - toRead.length} images/other, not readable for text)`)
  const P = pool(WORKERS)
  const inBooks = new Set()
  const where = new Map() // chassis → { files: [], kinds: Set }
  const tally = new Map()
  const errors = []
  let done = 0, last = 0, bookErrors = 0
  const all = [...books.map((p) => ({ p, book: true })), ...toRead.map((p) => ({ p, book: false }))]
  let next = 0
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < all.length) {
      const { p, book } = all[next++]
      const r = await P.run(p)
      const kind = `${path.extname(p).toLowerCase()} ${r.how === 'error' ? 'could not read' : r.hasText ? 'read' : 'no text inside'}`
      if (!book) tally.set(kind, (tally.get(kind) ?? 0) + 1)
      if (r.how === 'error') { errors.push([path.relative(src, p), r.error]); if (book) bookErrors++ }
      for (const c of r.chassis ?? []) {
        if (book) { inBooks.add(c); continue }
        const w = where.get(c) ?? where.set(c, { files: [], kinds: new Set() }).get(c)
        if (w.files.length < 5) w.files.push(path.relative(src, p))
        w.kinds.add(path.extname(p).toLowerCase())
        w.n = (w.n ?? 0) + 1
      }
      if (++done - last >= 2000 || done === all.length) {
        last = done
        const s = `${new Date().toTimeString().slice(0, 8)}  ${done.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')} read · ${errors.length} could not read · ${Math.round((Date.now() - t0) / 1000)} s`
        console.log(`  … ${s}`)
        fs.writeFileSync(path.join(out, 'progress.txt'), s)
      }
    }
  }))
  P.stop()

  const missing = [...where].filter(([c]) => !inBooks.has(c))
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  fs.writeFileSync(path.join(out, 'vehicles.csv'), '﻿' + ['chassis,in sorted books,files it appears in,kinds of file,first files', ...[...where].sort().map(([c, w]) =>
    [c, inBooks.has(c) ? 'yes' : 'NO', w.n, [...w.kinds].join(' '), w.files.join(' | ')].map(csv).join(','))].join('\r\n'))
  if (errors.length) fs.writeFileSync(path.join(out, 'could-not-read.csv'), '﻿' + ['file,why', ...errors.map((e) => e.map(csv).join(','))].join('\r\n'))

  const lines = []
  const say = (s = '') => { lines.push(s); console.log(s) }
  say(`Vehicle check of ${src} — ${Math.round((Date.now() - t0) / 1000)} s, ${WORKERS} workers, chassis pattern /${reSrc}/`)
  say(`Sorted books: ${books.length} files, ${inBooks.size} distinct chassis${bookErrors ? ` — ⚠ ${bookErrors} books could NOT be read, so some "not in the books" below may be false` : ""}`)
  say(`The pile: ${toRead.length} readable files, ${where.size} distinct chassis found in them`)
  say(`  in the sorted books too: ${where.size - missing.length}`)
  say(`  NOT in the sorted books: ${missing.length}`)
  const mk = new Map()
  for (const [, w] of missing) { const k = [...w.kinds].sort().join(' + '); mk.set(k, (mk.get(k) ?? 0) + 1) }
  for (const [k, n] of [...mk].sort((a, b) => b[1] - a[1])) say(`    found only in ${k}: ${n}`)
  say('\nFiles read, by kind:')
  for (const [k, n] of [...tally].sort()) say(`  ${String(n).padStart(7)}  ${k}`)
  say(`\nList: ${path.join(out, 'vehicles.csv')} (filter "in sorted books" = NO)`)
  fs.writeFileSync(path.join(out, 'summary.txt'), lines.join('\r\n'))
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
