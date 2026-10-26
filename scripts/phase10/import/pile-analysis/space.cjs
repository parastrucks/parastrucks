const fs = require('fs')
const NL = String.fromCharCode(10), B = String.fromCharCode(92)
const t = fs.readFileSync(process.argv[2], 'utf8').slice(1)
const rows = []; let row = [], f = '', q = false
for (let i = 0; i < t.length; i++) { const c = t[i]
  if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
  else if (c === '"') q = true; else if (c === ',') { row.push(f); f = '' } else if (c === NL) { row.push(f.trimEnd()); rows.push(row); row = []; f = '' } else f += c }
if (f || row.length) { row.push(f); rows.push(row) }
const h = rows.shift(), ix = Object.fromEntries(h.map((k, i) => [k, i]))
const GB = (b) => (b / 2 ** 30).toFixed(1) + ' GB'
const add = (m, k, s) => { const e = m.get(k) ?? [0, 0]; e[0]++; e[1] += s; m.set(k, e) }
const total = rows.reduce((s, r) => s + +r[ix.size], 0)
const dupBy = new Map(), byTop = new Map(), dupTop = new Map(), junk = new Map(), big = []
for (const r of rows) { const s = +r[ix.size], top = r[ix.rel].split(B)[0], ext = (r[ix.rel].match(/\.([^.]+)$/) || [, '-'])[1].toLowerCase()
  add(byTop, top, s)
  if (r[ix.dupOf]) { add(dupBy, r[ix.family] ? 'workbook' : r[ix.kind], s); add(dupTop, top, s) }
  else { if (['exe', 'msi', 'iso', 'img', 'tmp', 'trc', 'download', 'lnk'].includes(ext) || r[ix.kind].startsWith('Excel lock')) add(junk, ext === 'xlsx' || r[ix.kind].startsWith('Excel lock') ? 'Excel lock files' : '.' + ext, s)
    big.push([s, ext]) } }
console.log('total', GB(total))
console.log('extra copies of exact duplicates by kind:'); for (const [k, [n, s]] of [...dupBy].sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${k}: ${n} files, ${GB(s)}`)
console.log('per top folder (all / of which extra duplicate copies):'); for (const [k, [n, s]] of [...byTop].sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${k}: ${n} files ${GB(s)} / ${(dupTop.get(k) ?? [0, 0])[0]} files ${GB((dupTop.get(k) ?? [0, 0])[1])}`)
console.log('not data (unique files):'); for (const [k, [n, s]] of junk) console.log(`  ${k}: ${n} files, ${GB(s)}`)
const ext = new Map(); for (const [s, e] of big) add(ext, e, s); console.log('largest unique by extension:', [...ext].sort((a, b) => b[1][1] - a[1][1]).slice(0, 8).map(([k, [n, s]]) => `.${k} ${n} ${GB(s)}`).join(' · '))
