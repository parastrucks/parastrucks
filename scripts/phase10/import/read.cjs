// Phase 10 import, step 1 — READ: workbooks → rows, each cell with its value, formula, comment and fill.
//
// A file is recognised by its SHEETS AND HEADERS, never by its name (the owner sends renamed copies).
// Nothing here decides anything about the data; merge.cjs does. Real data passes through, so callers
// must never print values or write the result inside the repository.
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const H = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

// family → how to recognise its sheet: the headers it must carry
const FAMILIES = {
  IT: { sheet: 'INVOICE TRACKER', must: ['CHASSIS NO', 'CTD', 'AL PAYMENT STATUS'] },
  IT_OD: { sheet: 'OTHER DEALER', must: ['CHASSIS NO', 'CTD', 'AL PAYMENT STATUS'] },
  // the year's retail book: a retail sheet in a workbook that is NOT a monthly list (a monthly list has a
  // PTB RETAIL sheet — and its Sheet5 of prior-year receivables has these headers too, R2-24)
  FY: { must: ['CHASSIS NUMBER', 'CUSTOMER BILL', 'FULL TAX'], notInBookWith: 'PTB RETAIL' },
  // a monthly list: PTB RETAIL (its bill column is "TALLY BILL" in some months, "CUSTOMER BILL" in others)
  // and OTHER DEALER (retail of trucks bought from other dealers)
  LIST: { sheet: 'PTB RETAIL', must: ['CHASSIS NUMBER', 'FULL TAX'] },
  LIST_OD: { sheet: 'OTHER DEALER', must: ['CHASSIS NO', 'FULL TAX'] },
  DEALERS: { sheet: 'DEALERS', must: ['NAME OF DEALER', 'NET PAYABLE'] },
  REBILL: { must: ['NEW CHASSIS NO', 'CHASSIS NUMBER'] },
  RET_INT: { must: ['CHASSIS NO', 'DSE INCENTIVE'] }, // 7 of 12 months have no DSM column
  RET_AL: { must: ['CHASSIS NO', 'APP AMT', 'SALE CATEGORY'] },
}

function cellAt(ws, r, c) { return ws[XLSX.utils.encode_cell({ r, c })] }

// one sheet → { headers: [...], rows: [{ row, cells: { HEADER: { v, f, note, bg, col } } }] }
function readSheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'])
  const headers = []
  for (let c = range.s.c; c <= range.e.c; c++) headers[c] = H(cellAt(ws, 0, c)?.v)
  const rows = []
  for (let r = 1; r <= range.e.r; r++) {
    const cells = {}
    let any = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = cellAt(ws, r, c)
      if (!cell) continue
      const head = headers[c] || `#${XLSX.utils.encode_col(c)}` // a stray cell keeps its column letter
      const fill = cell.s?.patternType === 'solid' ? cell.s.fgColor?.rgb : null
      const out = {
        v: cell.v === '' ? null : cell.v ?? null,
        f: cell.f ?? null,
        note: cell.c?.length ? cell.c.map((x) => x.t).join('\n').trim() || null : null,
        bg: fill && fill !== 'FFFFFF' ? `#${fill}` : null,
        col: XLSX.utils.encode_col(c),
        z: cell.z ?? null, // number format: tells a stray date from a stray amount
      }
      if (out.v === null && !out.note && !out.bg) continue
      if (!(head in cells)) cells[head] = out // the first column of a repeated header wins
      any = true
    }
    if (any) rows.push({ row: r + 1, cells })
  }
  return { headers: headers.filter(Boolean), rows }
}

// files: paths to .xlsx → { [family]: [{ file, sheet, row, cells }] }, plus what was not recognised
function readAll(files) {
  const out = Object.fromEntries(Object.keys(FAMILIES).map((k) => [k, []]))
  const seen = []
  for (const file of files) {
    const wb = XLSX.readFile(file, { cellFormula: true, cellComments: true, cellStyles: true })
    const name = path.basename(file)
    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet]
      if (!ws['!ref']) continue
      const head = new Set((XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, range: 0 })[0] ?? []).map(H))
      const fam = Object.entries(FAMILIES).find(([, spec]) =>
        (!spec.sheet || H(spec.sheet) === H(sheet)) && spec.must.every((h) => head.has(h)) &&
        (!spec.notInBookWith || !wb.SheetNames.some((n) => H(n) === H(spec.notInBookWith))))?.[0]
      seen.push({ file: name, sheet, family: fam ?? null })
      if (!fam) continue
      const { rows } = readSheet(ws)
      for (const r of rows) out[fam].push({ file: name, sheet, ...r })
    }
  }
  return { families: out, seen }
}

// every .xlsx under the given folders (Excel's own ~$ lock files skipped)
function findFiles(dirs) {
  const all = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.xlsx$/i.test(e.name) && !e.name.startsWith('~$')) all.push(p)
    }
  }
  dirs.forEach(walk)
  return all
}

module.exports = { readAll, findFiles, FAMILIES, H }
