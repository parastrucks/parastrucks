// Phase 10 — opens ONE workbook for inventory.cjs, in a process of its own (owner's pile, 2026-10-26: one
// spreadsheet held the reader for nine hours at 2.4 GB). inventory.cjs gives each file a time limit and kills
// this process when it runs over or runs out of memory, then starts a fresh one for the next file. Read-only.
const fs = require('fs')
const XLSX = require('xlsx')
const { FAMILIES, H } = require('./read.cjs')

const fyOfDate = (d) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
const fyLabel = (y) => `${y}-${String(y + 1).slice(2)}`

function recognise(wb) {
  const found = []
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet]
    if (!ws?.['!ref']) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false })
    if (!rows.length) continue
    // the header is usually row 1; the AL sheet allows it within the first ten rows
    const head = new Set((rows[0] ?? []).map(H))
    let fam = Object.entries(FAMILIES).find(([, spec]) =>
      (!spec.sheet || H(spec.sheet) === H(sheet)) && !(spec.notSheet && spec.notSheet.test(sheet)) && spec.must.every((h) => head.has(h)) &&
      (!spec.notInBookWith || !wb.SheetNames.some((n) => H(n) === H(spec.notInBookWith))))?.[0]
    let family = fam ? (FAMILIES[fam].as ?? fam) : null
    let hr = 0
    if (!family) {
      hr = rows.slice(0, 10).findIndex((r) => { const s = new Set((r ?? []).map(H)); return s.has('DETAILS') && s.has('OFFTAKE MODE') })
      if (hr >= 0) family = 'AL_SHEET'; else hr = 0
    }
    const header = (rows[hr] ?? []).map(H)
    // chassis (for pairing copies — never printed) and the dates inside (for the year)
    const chCol = header.findIndex((h) => /^(CHASSIS NO\.?|CHASSIS NUMBER|VIN NO\.?)$/.test(h))
    const chassis = new Set()
    const years = new Map(), months = new Map()
    for (const r of rows.slice(hr + 1)) {
      if (chCol >= 0) { const c = String(r[chCol] ?? '').replace(/\s+/g, '').toUpperCase(); if (c.length > 10) chassis.add(c) }
      for (const v of r) if (v instanceof Date && v.getUTCFullYear() >= 2015 && v.getUTCFullYear() <= 2035) {
        const y = fyOfDate(v); years.set(y, (years.get(y) ?? 0) + 1)
        const m = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`; months.set(m, (months.get(m) ?? 0) + 1)
      }
    }
    const topYear = [...years].sort((a, b) => b[1] - a[1])[0]
    const topMonth = [...months].sort((a, b) => b[1] - a[1])[0]
    const dated = [...years.values()].reduce((s, n) => s + n, 0)
    found.push({ sheet, family, layout: fam ?? (family === 'AL_SHEET' ? 'AL_SHEET' : null), rows: rows.length - hr - 1, chassis,
      dataFy: topYear && topYear[1] >= dated * 0.5 ? fyLabel(topYear[0]) : null,
      dataMonth: topMonth && topMonth[1] >= dated * 0.5 ? topMonth[0] : null,
      firstHeaders: header.filter(Boolean).slice(0, 8).join(' | ') })
  }
  return found
}

function openBook(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true, cellFormula: false, cellStyles: false, cellNF: false })
  return recognise(wb)
}

module.exports = { recognise, openBook }

// as a child of inventory.cjs: one path in, the sheets found out (chassis as a list — never printed)
if (require.main === module) {
  process.on('message', ({ p }) => {
    try { process.send({ found: openBook(p).map((f) => ({ ...f, chassis: [...f.chassis] })) }) }
    catch (e) { process.send({ error: String(e.message).slice(0, 120) }) }
  })
}
