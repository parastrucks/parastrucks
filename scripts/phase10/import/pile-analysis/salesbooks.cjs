// Which sales book (FY family) is the final one for a year? COUNTS ONLY (no amounts, no chassis printed).
const fs = require('fs'), path = require('path')
const repo = process.argv[2], src = process.argv[3], years = process.argv.slice(4)
const XLSX = require(repo + '/node_modules/xlsx')
const { recognise } = require(repo + '/scripts/phase10/import/inventory-open.cjs')
const NL = String.fromCharCode(10)
function parseCsv(t) { const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < t.length; i++) { const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = '' } else if (c === NL) { row.push(f.replace(/.$/s, (x) => x === String.fromCharCode(13) ? '' : x)); rows.push(row); row = []; f = '' } else f += c }
  if (f || row.length) { row.push(f); rows.push(row) } return rows }
const rows = parseCsv(fs.readFileSync(path.join(src, '_Sorted/_Inventory/inventory.csv'), 'utf8').slice(1))
const h = rows.shift(), ix = Object.fromEntries(h.map((k, i) => [k, i]))
const fyOf = (d) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
for (const fy of years) {
  const cands = rows.filter((r) => r[ix.family].split('+').includes('FY') && r[ix.fy] === fy && !r[ix.dupOf])
  console.log(NL + '=== ' + fy + ': ' + cands.length + ' distinct sales-book files')
  const info = []
  for (const r of cands) {
    const wb = XLSX.read(fs.readFileSync(path.join(src, r[ix.rel])), { type: 'buffer', cellDates: true, cellFormula: false })
    const found = recognise(wb).filter((f) => f.family === 'FY')
    const ch = new Set(found.flatMap((f) => [...f.chassis]))
    // dates inside the FY sheets: range + how many fall in this FY; filled cells = how complete it is
    let filled = 0, inFy = 0, other = 0, last = null
    const months = new Set()
    for (const f of found) { const ws = wb.Sheets[f.sheet]
      for (const k in ws) { if (k[0] === '!') continue; const v = ws[k].v; if (v == null || v === '' || ws[k].t === 'e') continue; filled++
        if (v instanceof Date && v.getUTCFullYear() >= 2015 && v.getUTCFullYear() <= 2035) { if (fyOf(v) === +fy.slice(0, 4)) { inFy++; months.add(v.toISOString().slice(0, 7)); if (!last || v > last) last = v } else other++ } } }
    info.push({ rel: r[ix.rel], mtime: r[ix.mtime], copyOf: r[ix.copyOf], sheets: found.map((f) => f.sheet).join(', '), rows: found.reduce((s, f) => s + f.rows, 0), ch, filled, inFy, other, months: months.size, last: last ? last.toISOString().slice(0, 10) : '' })
  }
  info.sort((a, b) => b.ch.size - a.ch.size || b.mtime.localeCompare(a.mtime))
  info.forEach((x, i) => { x.n = i + 1 })
  for (const x of info) {
    const within = info.filter((y) => y !== x && [...y.ch].every((c) => x.ch.has(c)) && y.ch.size).map((y) => y.n)
    const notIn = info.filter((y) => y !== x).reduce((s, y) => s + [...y.ch].filter((c) => !x.ch.has(c)).length, 0)
    console.log(`#${x.n} ${x.rel}` + NL + `   saved ${x.mtime} · sheets: ${x.sheets} · ${x.ch.size} chassis, ${x.rows} rows, ${x.filled} filled cells · ${x.months} months of this year's dates, last ${x.last}, ${x.other} dates from other years` +
      NL + `   holds every truck of: ${within.length ? within.map((n) => '#' + n).join(' ') : 'none'} · trucks in others but not here: ${notIn}` + (x.copyOf ? ' · scan marked it an older copy' : ''))
  }
}
