// Every copy of every sorted book (the output of books-for-load.cjs --older), grouped by the month the book is
// about: its most common month of dates, or — for the older retention files, which hold no dates — the month in
// its name. Within a group: saved date, trucks per family, top or older copy, name. Counts and names only.
//
//   node scripts/phase10/import/pile-analysis/copies-by-month.cjs <books-for-load output.txt> [...]
const fs = require('fs')
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
const fromName = (n) => {
  const m = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[-' ]*\s*(\d\d)(?!\d)/i.exec(n.replace(/\(.*?\)/g, ''))
  return m ? `20${m[2]}-${String(MON[m[1].toUpperCase()]).padStart(2, '0')}` : null
}
const groups = new Map()
for (const f of process.argv.slice(2)) {
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const p = line.split(' | ')
    if (p.length < 8 || line.includes('↔')) continue
    const older = p[2] === 'older'
    const [kind, year] = p
    const [name, saved, fams, months] = older ? p.slice(3, 7) : p.slice(2, 6)
    const top = /months (\d{4}-\d\d)×/.exec(months)?.[1]
    const key = `${kind} | ${top ?? fromName(name) ?? 'no month'}${top ? '' : ' (name)'}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(`${saved.replace('saved ', '')} ${older ? 'old' : 'TOP'} ${fams.padEnd(40)} ${year}/${name}`)
  }
}
for (const k of [...groups.keys()].sort()) {
  console.log(`\n== ${k}`)
  for (const l of groups.get(k).sort()) console.log('  ' + l)
}
