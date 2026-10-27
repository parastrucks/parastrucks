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
  // before 2025-26 the AMC column is headed "AMC" (same formulas: Payment = (CTD + AMC) × Qty); OTHER DEALER always says "AMC"
  IT: { sheet: 'INVOICE TRACKER', must: ['CHASSIS NO', 'CTD', 'AL PAYMENT STATUS'], alias: { AMC: 'AMC/SERVICE' } },
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
  RET_INT: { must: ['CHASSIS NO', 'DSE INCENTIVE'], alias: { 'NAME OF THE CUSTOMER': 'NAME', 'V PART NUMBER': 'CBN NO.' } }, // 7 of 12 months have no DSM column
  RET_AL: { must: ['CHASSIS NO', 'APP AMT'] }, // SALE CATEGORY is missing in some 2024-25 months

  // ── older layouts (2022-23 → 2024-25), read INTO the families above (`as`) with their headers renamed
  // to the newer names (`alias`; a header is renamed only when the newer one is absent). Measured
  // 2026-10-24 on D:/PTB/Finances, formulas checked so each renamed column means the same thing.
  // the year's sales book before 2024-25 ("PAYMENT TRACKER", "OFFTAKE"): "Chassis No" not "Chassis Number";
  // the Sheet1…7 copies inside the same workbook are scratch, never read
  FY_OLD: { as: 'FY', must: ['CHASSIS NO', 'CUSTOMER BILL', 'FULL TAX', 'NET REFUND'], notSheet: /^(SHEET\s*\d+|OTHER DEAL)/i,
    alias: { 'CHASSIS NO': 'CHASSIS NUMBER', 'VPART NUMBER': 'V PART NUMBER' }, oldStrays: true },
  // AL's DBM claim export (2023-10 → 2024-06): "Vin No." is the chassis; Nett ORC = Diff + Adjustment is
  // what AL pays (the newer files' RETENTION), so Adjustment is the newer APP AMT
  RET_DBM: { as: 'RET_AL', must: ['VIN NO.', 'CTC', 'CTD', 'NETT ORC'],
    alias: { 'VIN NO.': 'CHASSIS NO', 'CUSTOMER NAME': 'NAME', 'ENGINE NO.': 'ENGINE NO', 'BULK / RETAIL': 'SALE CATEGORY',
      'NETT ORC': 'RETENTION', 'ADJUSTMENT': 'APP AMT', 'DIFFERENCE BTWN CTC AND CTD': 'DIFF BETWEEN CTC AND CTD' },
    // its "Model" holds AL's material code in 2023 (CTG352018B0007), not the model name; the dealer and
    // month columns say nothing about the truck
    drop: ['MODEL', 'SUB-SEGMENT', 'MONTH', 'DELAER NAME', 'DEALER'] },
  // the AL RETENTION SHEET (2022-23, early 2023-24): its DBM sheet is AL's view (RETENTION there is
  // CTC − CTD, not a claim), its TALLY sheet the internal one
  RET_AL_OLD: { as: 'RET_AL', sheet: 'DBM', must: ['CHASSIS NO', 'CTC', 'CTD', 'RETENTION'],
    alias: { 'CUSTOMER': 'NAME', 'VPART': 'CBN NO.', 'RETENTION': 'DIFF BETWEEN CTC AND CTD' } },
  RET_INT_OLD: { as: 'RET_INT', sheet: 'TALLY', must: ['CHASSIS NO', 'CTC', 'CTD', 'RETENTION'],
    alias: { 'NAME OF THE CUSTOMER': 'NAME', 'V PART NUMBER': 'CBN NO.' } },
}

// the cells that EXIST, by row, each row's cells in column order — never a walk of the sheet's range: in the
// team's file pile (2026-10-26) 78 workbooks carry a stray cell near row 10 lakh / column 16,000, a range of
// over 10 crore cells, and walking it hung the reader for hours
function cellsByRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'])
  const byRow = new Map()
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue
    const { r, c } = XLSX.utils.decode_cell(k)
    if (r < range.s.r || r > range.e.r || c < range.s.c || c > range.e.c) continue
    if (!byRow.has(r)) byRow.set(r, [])
    byRow.get(r).push([c, ws[k]])
  }
  for (const list of byRow.values()) list.sort((a, b) => a[0] - b[0])
  return byRow
}

// one sheet → { headers: [...], rows: [{ row, cells: { HEADER: { v, f, note, bg, col } } }] }
function readSheet(ws, byRow = cellsByRow(ws)) {
  const headers = []
  for (const [c, cell] of byRow.get(0) ?? []) headers[c] = H(cell?.v)
  const rows = []
  for (const r of [...byRow.keys()].filter((r) => r >= 1).sort((a, b) => a - b)) {
    const cells = {}
    let any = false
    for (const [c, cell] of byRow.get(r)) {
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
  const out = Object.fromEntries([...new Set(Object.entries(FAMILIES).map(([k, f]) => f.as ?? k))].map((k) => [k, []]))
  const seen = []
  for (const given of files) {
    // a file is a path, or { path, fy } when the caller knows its year better than its folder does (run.cjs --list)
    const file = typeof given === 'string' ? given : given.path
    const wb = XLSX.readFile(file, { cellFormula: true, cellComments: true, cellStyles: true })
    // a file is named with its financial-year folder (two years hold files of the same name)
    const fy = (typeof given === 'string' ? null : given.fy) ?? /[\\/](20\d\d-\d\d)[\\/]/.exec(file)?.[1]
    const name = fy && !path.basename(file).includes(fy) ? `${fy} ${path.basename(file)}` : path.basename(file)
    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet]
      if (!ws['!ref']) continue
      const byRow = cellsByRow(ws)
      const head = new Set((byRow.get(0) ?? []).map(([, cell]) => H(cell?.v)))
      const fam = Object.entries(FAMILIES).find(([, spec]) =>
        (!spec.sheet || H(spec.sheet) === H(sheet)) && !(spec.notSheet && spec.notSheet.test(sheet)) && spec.must.every((h) => head.has(h)) &&
        (!spec.notInBookWith || !wb.SheetNames.some((n) => H(n) === H(spec.notInBookWith))))?.[0]
      const spec = FAMILIES[fam]
      seen.push({ file: name, sheet, family: fam ? (spec.as ?? fam) : null, layout: fam ?? null })
      if (!fam) continue
      const { rows } = readSheet(ws, byRow)
      for (const r of rows) {
        const cells = r.cells
        for (const h of spec.drop ?? []) delete cells[h]
        for (const [from, to] of Object.entries(spec.alias ?? {})) {
          if (from in cells && !(to in cells)) { cells[to] = cells[from]; delete cells[from] }
        }
        // an older layout's unlabelled cells are not the newer layout's (2025-26's column AL is the Endhan date)
        if (spec.oldStrays) for (const k of Object.keys(cells)) if (k.startsWith('#')) { cells[`#OLD ${k.slice(1)}`] = cells[k]; delete cells[k] }
        out[spec.as ?? fam].push({ file: name, sheet, ...r })
      }
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
