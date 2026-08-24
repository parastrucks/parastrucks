// Diagnostic: for the rows the parser turned into all-zeros, are the SOURCE cells
// blank (=> coercion, a lie) or genuine 0 (=> correct)? Decides whether the
// "skip all-blank rows" fix is safe for real data.
// Usage: node scripts/tiv/diag-raw-cells.mjs "<workbook>"
import fs from 'node:fs'
import * as XLSX from 'xlsx'

const buf = fs.readFileSync(process.argv[2])
const wb = XLSX.read(new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), { type: 'array', cellDates: false, raw: true })

console.log('Sheets:', wb.SheetNames.map((n, i) => `${i}:${n}`).join(' | '))

function dump(sheetIdx, label, wanted) {
  const ws = wb.Sheets[wb.SheetNames[sheetIdx]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) { headerRow = i; break }
  }
  console.log(`\n=== sheet ${sheetIdx} (${wb.SheetNames[sheetIdx]}) — ${label} ===`)
  console.log('header row:', JSON.stringify(rows[headerRow]?.slice(0, 8)))
  for (let i = headerRow + 1; i < rows.length; i++) {
    const lbl = String(rows[i][0]).trim()
    if (!wanted.includes(lbl)) continue
    const cells = rows[i].slice(1, 8).map(c => {
      const t = c === '' ? 'BLANK' : typeof c === 'number' ? String(c) : `"${c}"`
      return t.padStart(6)
    })
    console.log(`${lbl.padEnd(9)} [${cells.join(' ')}]`)
  }
}

dump(2, 'PTB actuals — months the parser zeroed', ['Apr-22', 'May-22', 'Jun-22', 'Jul-22', 'Aug-22', 'Sep-22', 'Oct-22', 'Nov-22'])
dump(1, 'TIV actuals — same months for comparison', ['Apr-22', 'May-22', 'Oct-22'])

// Judgment sheets: any blank cells inside a present row?
for (const idx of [3, 4]) {
  const ws = wb.Sheets[wb.SheetNames[idx]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  let hr = -1
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]).toLowerCase().includes('month')) { hr = i; break }
  let blanks = 0, present = 0
  for (let i = hr + 1; i < rows.length; i++) {
    if (!String(rows[i][0]).trim()) continue
    for (let c = 1; c <= 6; c++) { if (rows[i][c] === '') blanks++; else present++ }
  }
  console.log(`\nsheet ${idx} (${wb.SheetNames[idx]}): ${present} present cells, ${blanks} BLANK cells`)
}
