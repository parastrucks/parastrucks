// Phase 10 — before the owner deletes <source>\_To delete: re-read EVERY moved duplicate and the kept copy it
// relies on, fresh from disk (not the inventory's fingerprints), and confirm they are the same bytes; confirm
// every file the list names is in _To delete and every kept copy is still in its place outside it.
// Read-only. Counts on screen; any mismatch is written to _To delete\_verify-problems.csv.
//
//   node scripts/phase10/import/verify-to-delete.cjs <source folder>
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const src = process.argv[2]
if (!src) { console.error('usage: verify-to-delete.cjs <source folder>'); process.exit(2) }
const BIN = path.join(src, '_To delete')

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
const hashFile = (p) => new Promise((resolve) => {
  const h = crypto.createHash('sha256')
  fs.createReadStream(p, { highWaterMark: 8 << 20 }).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', (e) => resolve(`error: ${e.code}`))
})

async function main() {
  const all = parseCsv(fs.readFileSync(path.join(BIN, '_moved.csv'), 'utf8').replace(/^﻿/, '')).slice(1)
  // files already proven identical by an earlier, interrupted run are not read again (a crash cost a run once)
  const DONE = path.join(BIN, '_verify-done.txt')
  const proven = new Set(fs.existsSync(DONE) ? fs.readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : [])
  const moved = all.filter(([rel]) => !proven.has(rel))
  if (proven.size) console.log(`${proven.size} files already proven by an earlier run; ${moved.length} left`)
  let fresh = []
  const save = () => { if (fresh.length) { fs.appendFileSync(DONE, fresh.join('\n') + '\n'); fresh = [] } }
  const problems = []
  const keptHash = new Map() // each kept copy is read once, however many duplicates rely on it
  let checked = 0, bytes = 0, next = 0
  const t0 = Date.now()
  async function one([rel, reason, kept, size]) {
    const p = path.join(BIN, rel)
    if (!fs.existsSync(p)) { problems.push([rel, 'not in _To delete']); return }
    if (fs.existsSync(path.join(src, rel))) problems.push([rel, 'a file is back at its old place'])
    if (reason !== 'exact duplicate') return
    const kp = path.join(src, kept)
    if (kp.toLowerCase().startsWith(BIN.toLowerCase() + path.sep)) { problems.push([rel, 'its kept copy is inside _To delete']); return }
    if (!fs.existsSync(kp)) { problems.push([rel, 'its kept copy is missing']); return }
    if (!keptHash.has(kept)) keptHash.set(kept, hashFile(kp))
    const [a, b] = await Promise.all([hashFile(p), keptHash.get(kept)])
    if (a !== b || a.startsWith('error')) { problems.push([rel, `bytes differ from its kept copy (${a.slice(0, 12)} vs ${b.slice(0, 12)})`]); return }
    bytes += Number(size)
    fresh.push(rel)
  }
  // 8 files at a time: the disk, not the processor, sets the pace
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < moved.length) {
      await one(moved[next++])
      if (++checked % 1000 === 0) save()
      if (checked % 10000 === 0) console.log(`  … ${checked.toLocaleString('en-IN')} of ${moved.length.toLocaleString('en-IN')} · ${(bytes / 2 ** 30).toFixed(1)} GB · ${Math.round((Date.now() - t0) / 1000)} s`)
    }
  }))
  save()
  const csv =(v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  if (problems.length) fs.writeFileSync(path.join(BIN, '_verify-problems.csv'), '﻿' + ['file,problem', ...problems.map((x) => x.map(csv).join(','))].join('\r\n'))
  console.log(`Checked ${all.length} moved files (${proven.size} proven earlier, ${moved.length} now; ${keptHash.size} kept copies re-read) in ${Math.round((Date.now() - t0) / 1000)} s: ${problems.length} problems${problems.length ? ' — see _verify-problems.csv' : ''}`)
}
main()
