// Phase 10 — MOVE what the owner may delete into <source>\_To delete\<same path as before>, from the inventory
// (owner, 2026-10-26: "You can move the files into the delete folder"; he deletes it himself after the check):
//   · every extra copy of an exact duplicate (the copy the inventory KEPT stays where it is)
//   · program installers / disk images (.exe .msi .iso .img), Excel lock files (~$…), .tmp files
// Before each move: the file still has the size and time the inventory saw, and for a duplicate the kept file
// still exists with the same size and fingerprint. Nothing is deleted. _To delete\_moved.csv lists every move;
// --undo puts every file back where it was.
//
//   node scripts/phase10/import/move-to-delete.cjs <source folder>          (dry run: counts only)
//   node scripts/phase10/import/move-to-delete.cjs <source folder> --move
//   node scripts/phase10/import/move-to-delete.cjs <source folder> --undo
const fs = require('fs')
const path = require('path')

const [src, flag] = process.argv.slice(2)
if (!src) { console.error('usage: move-to-delete.cjs <source folder> [--move | --undo]'); process.exit(2) }
const BIN = path.join(src, '_To delete')
const LIST = path.join(BIN, '_moved.csv')

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
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const GB = (b) => `${(b / 2 ** 30).toFixed(1)} GB`

if (flag === '--undo') {
  const moved = parseCsv(fs.readFileSync(LIST, 'utf8').replace(/^﻿/, '')).slice(1)
  let back = 0, missing = 0
  for (const [rel] of moved) {
    const from = path.join(BIN, rel), to = path.join(src, rel)
    if (!fs.existsSync(from) || fs.existsSync(to)) { missing++; continue }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    back++
  }
  console.log(`Put back ${back} files${missing ? `; ${missing} were not in _To delete or their place was taken (left alone)` : ''}`)
  process.exit(0)
}

const rows = parseCsv(fs.readFileSync(path.join(src, '_Sorted', '_Inventory', 'inventory.csv'), 'utf8').replace(/^﻿/, ''))
const h = rows.shift()
const ix = Object.fromEntries(h.map((k, i) => [k, i]))
const byRel = new Map(rows.map((r) => [r[ix.rel], r]))
const NOT_DATA = /\.(exe|msi|iso|img|tmp)$/i

const plan = []
const why = new Map()
for (const r of rows) {
  const base = path.basename(r[ix.rel])
  // not-data first: an installer's duplicates go with it, so they need no kept copy
  const reason = base.startsWith('~$') ? 'Excel lock file' : NOT_DATA.test(base) ? 'installer / disk image / temp file' : r[ix.dupOf] ? 'exact duplicate' : null
  if (!reason) continue
  plan.push({ r, reason })
  const w = why.get(reason) ?? [0, 0]; w[0]++; w[1] += Number(r[ix.size]); why.set(reason, w)
}
// a kept file never leaves while a duplicate relies on it (an installer and all its copies may all go)
const reliedOn = new Set(plan.filter((p) => p.reason === 'exact duplicate').map((p) => p.r[ix.dupOf]))
const clash = plan.filter((p) => reliedOn.has(p.r[ix.rel]))
if (clash.length) { console.error(`refused: ${clash.length} planned files are the kept copy of a duplicate`); process.exit(1) }

console.log(`${flag === '--move' ? 'Moving' : 'Would move'} ${plan.length} files into ${BIN}`)
for (const [k, [n, s]] of why) console.log(`  ${k}: ${n} files, ${GB(s)}`)
if (flag !== '--move') { console.log('(dry run — nothing moved; add --move)'); process.exit(0) }

const mtimeOf = (st) => st.mtime.toISOString().slice(0, 16).replace('T', ' ')
const done = []
const skipped = new Map()
const skip = (k) => skipped.set(k, (skipped.get(k) ?? 0) + 1)
for (const { r, reason } of plan) {
  const rel = r[ix.rel], from = path.join(src, rel), to = path.join(BIN, rel)
  let st
  try { st = fs.statSync(from) } catch { skip('no longer there'); continue }
  if (String(st.size) !== r[ix.size] || mtimeOf(st) !== r[ix.mtime]) { skip('changed since the inventory'); continue }
  if (reason === 'exact duplicate') {
    const keep = byRel.get(r[ix.dupOf])
    let kst
    try { kst = fs.statSync(path.join(src, r[ix.dupOf])) } catch { skip('its kept copy is missing'); continue }
    if (!keep || !r[ix.sha] || keep[ix.sha] !== r[ix.sha] || kst.size !== st.size) { skip('its kept copy does not match'); continue }
  }
  if (fs.existsSync(to)) { skip('already in _To delete'); continue }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  done.push([rel, reason, r[ix.dupOf], r[ix.size], r[ix.sha]])
}
const old = fs.existsSync(LIST) ? parseCsv(fs.readFileSync(LIST, 'utf8').replace(/^﻿/, '')).slice(1) : []
fs.writeFileSync(LIST, '﻿' + ['original path,reason,kept copy,size,sha256', ...[...old, ...done].map((x) => x.map(csv).join(','))].join('\r\n'))
console.log(`Moved ${done.length} files (${GB(done.reduce((s, x) => s + Number(x[3]), 0))}).`)
for (const [k, n] of skipped) console.log(`  not moved — ${k}: ${n}`)
console.log(`List: ${LIST}`)
