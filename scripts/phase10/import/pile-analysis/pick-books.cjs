// The all-years load's book list, picked from EVERY copy in `_Sorted` (books-for-load.cjs --older output) by
// rules measured on the pile (2026-10-27) — never by the sort's "Older copies" choice, which went by truck count
// and put the newest 2026-27 purchase book (saved 23 Oct 2026) among the older copies:
//   • purchase book (IT): one per financial year — the LATEST-SAVED copy (a year book is cut back when the next
//     year starts: 2024-25 1,854 → 1,769 trucks, the 85 April-25 trucks moving to 2025-26); a copy of the year
//     without an OTHER DEALER sheet takes that sheet from the latest copy that has one
//   • sales book (FY): the master "PAYMENT TRACKER FROM NOV22 ONWARDS" (Nov 2022 → Jul 2025) + the year book
//     2025-26 (latest copy); the monthly payment trackers before it are snapshots the master holds
//   • monthly retail list (LIST, with its OTHER DEALER / DEALERS / canc rebill sheets): per month, the latest-saved
//     copy (the month's working copies carry undelivered trucks; the final list is saved weeks later). Month from
//     the file name; cumulative lists (PTB INVOICE LIST 2024-25, CHEKER) left out
//   • other-dealer retail before the lists (Nov 2022 → Mar 2024): only the OTHER DEALER sheet of each month's
//     latest-saved payment tracker (its sales sheet is in the master)
//   • retention (RET_AL, RET_INT separately): per month, the latest-saved copy holding that family; month from
//     the SHEET name (a 2025-26 file named "APR'24" holds the APR'25 sheet), else the file name; combined files
//     ("NOV'23 TO MAY'24", "APR'24 & MAY'24", "RETENTION TRACKER 2023-24") left out when a monthly copy exists
// Writes the list (fy | month | path | families) for run.cjs --list and prints what it chose and why — file names,
// dates and counts only.
//
//   node scripts/phase10/import/pile-analysis/pick-books.cjs <Backup data folder> <out list> <books-*.txt …>
const fs = require('fs')
const path = require('path')

const [src, outList, ...inputs] = process.argv.slice(2)
const MONTHS = ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR']
const MNUM = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
const fyOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}` }
const monOf = (ym) => MONTHS[(Number(ym.slice(5)) + 8) % 12]
// "APR'25", "Payment Tracker -APRIL -24", "JULY'24 ", "sep'25", "Dec'231" → 2025-04 …
const monthIn = (s) => {
  const m = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[-' ]*\s*(\d\d)(?!\d)/i.exec(String(s).replace(/\(.*?\)/g, ''))
  return m ? `20${m[2]}-${String(MNUM[m[1].toUpperCase()]).padStart(2, '0')}` : null
}

const books = []
for (const f of inputs) for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
  const p = line.split(' | ')
  if (p.length < 8 || line.includes('↔')) continue
  const older = p[2] === 'older'
  const [kind, year] = p
  const [name, saved, fams, months, , sheets] = older ? p.slice(3, 9) : p.slice(2, 8)
  const fam = Object.fromEntries([...fams.matchAll(/([A-Z_]+) (\d+)/g)].map((m) => [m[1], Number(m[2])]))
  books.push({ kind, year, older, name, saved: saved.replace('saved ', ''), fam,
    top: /months (\d{4}-\d\d)×/.exec(months)?.[1] ?? null, sheets: sheets ?? '',
    path: path.join(src, '_Sorted', kind, year, older ? 'Older copies' : '', name) })
}
for (const b of books) if (!fs.existsSync(b.path)) { console.error('missing on disk:', b.path); process.exit(2) }
const latest = (list) => [...list].sort((a, b) => a.saved.localeCompare(b.saved) || a.path.localeCompare(b.path)).at(-1)
const picks = []
const pick = (b, fy, mon, only, why) => picks.push({ b, fy, mon, only, why })

// ── purchase book: per year, latest saved
const itYear = (b) => /INVOICE TRACKER (20\d\d-\d\d)/i.exec(b.name)?.[1] ?? b.year
const its = books.filter((b) => b.fam.IT > 0)
for (const fy of [...new Set(its.map(itYear))].sort()) {
  const all = its.filter((b) => itYear(b) === fy)
  const best = latest(all)
  if (!best.fam.IT_OD) {
    // the FULLEST copy's sheet (then the latest): a December snapshot re-saved in 2025 is "later" but holds 6 of 11
    const withOd = all.filter((b) => b.fam.IT_OD > 0), most = Math.max(0, ...withOd.map((b) => b.fam.IT_OD))
    const od = latest(withOd.filter((b) => b.fam.IT_OD === most))
    if (od) pick(od, fy, '', 'IT_OD', `OTHER DEALER sheet only (${most}) — the latest copy (${best.saved}) has none`)
  }
  pick(best, fy, '', null, `latest of ${all.length} copies (IT ${best.fam.IT}${best.fam.IT_OD ? ` · OD ${best.fam.IT_OD}` : ''})`)
}

// ── sales book: the master, then the 2025-26 year book
const master = latest(books.filter((b) => /PAYMENT TRACKER FROM NOV22 ONWARDS/i.test(b.name)))
pick(master, '2024-25', '', 'FY', 'the master sales book, Nov 2022 → Jul 2025')
const year2526 = latest(books.filter((b) => /^2025-26\.xlsx$/i.test(b.name) && b.fam.FY > 0))
pick(year2526, '2025-26', '', 'FY', 'the 2025-26 year book (wins over the master for 2025-26)')

// ── monthly retail lists: per month (from the name), latest saved
const cumulative = /INVOICE LIST 20\d\d|CHEKER/i
const lists = books.filter((b) => b.fam.LIST > 0 && !cumulative.test(b.name))
const byListMonth = new Map()
for (const b of lists) { const m = monthIn(b.name) ?? b.top; if (!byListMonth.has(m)) byListMonth.set(m, []); byListMonth.get(m).push(b) }
for (const m of [...byListMonth.keys()].sort()) {
  const all = byListMonth.get(m), best = latest(all)
  pick(best, fyOfMonth(m), monOf(m), 'LIST,LIST_OD,DEALERS,REBILL', `${m} list: latest of ${all.length} (LIST ${best.fam.LIST})`)
}
const firstList = [...byListMonth.keys()].sort()[0]

// ── other-dealer retail before the lists: the OTHER DEALER sheet of each month's latest payment tracker
const notMonthly = /TIPPER|TO MAR|JAN RETAIL|PENDING DELIVERY|SHREE MARUTI|FROM NOV22/i
const od = books.filter((b) => b.fam.LIST_OD > 0 && !b.fam.LIST && !notMonthly.test(b.name) && b.top && b.top < firstList)
const byOdMonth = new Map()
for (const b of od) { if (!byOdMonth.has(b.top)) byOdMonth.set(b.top, []); byOdMonth.get(b.top).push(b) }
for (const m of [...byOdMonth.keys()].sort()) {
  const all = byOdMonth.get(m), best = latest(all)
  pick(best, fyOfMonth(m), monOf(m), 'LIST_OD', `${m} other-dealer retail: latest of ${all.length} (OD ${best.fam.LIST_OD})`)
}

// ── retention: per family, per month (sheet name → file name), latest saved
const combined = /\bTO\b|&|TRACKER 20\d\d-\d\d/i
for (const famKey of ['RET_AL', 'RET_INT']) {
  const all = books.filter((b) => b.fam[famKey] > 0)
  const byMonth = new Map()
  for (const b of all) {
    const fromSheet = b.sheets.split(', ').map((s) => /^(.*)\[/.exec(s)?.[1]).map(monthIn).find(Boolean)
    const m = fromSheet ?? monthIn(b.name) ?? b.top
    if (!m) { console.log(`  (no month: ${famKey} ${b.year}/${b.name} — left out)`); continue }
    if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(b)
  }
  for (const m of [...byMonth.keys()].sort()) {
    const group = byMonth.get(m)
    const monthly = group.filter((b) => !combined.test(b.name))
    const best = latest(monthly.length ? monthly : group)
    pick(best, fyOfMonth(m), monOf(m), famKey, `${m} ${famKey}: latest of ${group.length}${monthly.length < group.length ? ` (${group.length - monthly.length} combined left out)` : ''} (${best.fam[famKey]} rows)`)
  }
}

// a file picked twice for different families → one line with both
const lines = new Map()
for (const p of picks) {
  const k = `${p.fy}|${p.mon}|${p.b.path}`
  if (lines.has(k)) { const l = lines.get(k); l.only = l.only && p.only ? `${l.only},${p.only}` : null; l.why += ' + ' + p.why }
  else lines.set(k, { ...p })
}
const out = [...lines.values()]
fs.writeFileSync(outList, '# the all-years load — written by scripts/phase10/import/pile-analysis/pick-books.cjs\n# fy | month | path | families\n' +
  out.map((l) => `${l.fy} | ${l.mon} | ${l.b.path}${l.only ? ` | ${l.only}` : ''}`).join('\n') + '\n')
for (const l of out) console.log(`${l.fy} ${(l.mon || '—').padEnd(3)} ${l.b.older ? 'old' : 'TOP'} ${l.b.saved}  ${l.b.year}/${l.b.name}  — ${l.why}`)
console.log(`\n${out.length} files → ${outList}`)
