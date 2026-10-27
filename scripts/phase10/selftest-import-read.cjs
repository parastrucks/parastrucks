// Phase 10 — offline self-test for the import's READER (scripts/phase10/import/read.cjs): the older
// layouts (2022-23 → 2024-25) are recognised by their headers and their columns renamed to the newer names.
//
//   node scripts/phase10/selftest-import-read.cjs
//
// Builds small made-up workbooks in the system temp folder (no real data), reads them, deletes them.
// Expectations are written by hand from the layouts measured on 2026-10-24, never from the code.
const fs = require('fs')
const os = require('os')
const path = require('path')
const XLSX = require('xlsx')
const { readAll } = require('./import/read.cjs')

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) pass++; else { fail++; console.log('FAIL', label, got === undefined ? '' : JSON.stringify(got)) } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-read-'))
const book = (rel, sheets) => {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); XLSX.writeFile(wb, f); return f
}
const A = 'MB1AAAAAAAAAA0001', B = 'MB1BBBBBBBBBB0002'
const files = [
  // 2023-24 sales book: "Chassis No"; a Sheet4 copy in the same workbook; an unlabelled cell in column AL's place
  book('2023-24/Payment Tracker - APRIL & MAY\'23.xlsx', {
    'PAYMENT TRACKER APRIL TO MAY\'23': [['SRNO', 'VPart Number', 'Chassis No', 'NAME OF THE CUSTOMER', 'CUSTOMER BILL', 'CTC', 'FULL TAX', 'NET REFUND', null], [1, 'V1', A, 'CUST A', 100, 90, 6, 0, 'stray']],
    Sheet4: [['SRNO', 'Chassis No', 'CUSTOMER BILL', 'FULL TAX', 'NET REFUND'], [1, B, 5, 1, 0]],
    'OTHER DEALER': [['SRNO', 'Chassis No', 'CUSTOMER BILL', 'FULL TAX', 'NET REFUND', 'DEALOR'], [1, B, 50, 3, 0, 'X']],
  }),
  // AL's DBM claim export
  book('2024-25/2024-4 - APRIL/RETENTION TRACKER - APR\'24 -DBM.xlsx', {
    "APR'24": [['Month', 'Delaer Name', 'Customer Name', 'Vin No.', 'Engine No.', 'Model', 'CTC', 'CTD', 'Other deductions', 'Difference btwn CTC and CTD', 'Adjustment', 'Nett ORC', 'Bulk / Retail'],
      ["Apr'24", 'PTB', 'CUST A', A, 'E1', 'CTG352018B0007', 90, 80, 0, 10, 5, 15, 'RETAIL']],
  }),
  // the old AL RETENTION SHEET: DBM = AL's view, TALLY = internal
  book('2023-24/2023-4 - APRIL/AL RETENTION SHEET APR\'23.xlsx', {
    DBM: [['Sales Person', 'VPart', 'Model', 'Chassis No', 'Customer', 'CTC', 'CTD', 'RETENTION'], ['P', 'V1', 'M', B, 'CUST B', 70, 60, 10]],
    TALLY: [['SRNO', 'DSE', 'V PART NUMBER', 'Chassis No', 'NAME OF THE CUSTOMER', 'CTC', 'CTD', 'AMC', 'PRICE SUPP', 'RETENTION'], [1, 'D', 'V1', B, 'CUST B', 72, 60, 0, 0, 12]],
  }),
  // a 2023-24 purchase book: AMC headed "AMC"
  book('2023-24/INVOICE TRACKER 2023-24.xlsx', {
    'INVOICE TRACKER': [['SRNO', 'Chassis No', 'CTC', 'CTD', 'AMC', 'AL Payment Status'], [1, A, 90, 80, 2, 'Paid']],
    'OTHER DEALER': [['SRNO', 'Chassis No', 'CTC', 'CTD', 'AMC', 'AL Payment Status'], [1, B, 70, 60, 3, 'Paid']],
  }),
]
const { families, seen } = readAll(files)
const one = (fam, ch, key = 'CHASSIS NO') => families[fam].find((r) => r.cells[key]?.v === ch)

const fy = one('FY', A, 'CHASSIS NUMBER')
ok(fy && fy.cells['V PART NUMBER']?.v === 'V1' && !('CHASSIS NO' in fy.cells), 'old sales book read as the year book: Chassis No → Chassis Number, VPart Number → V Part Number', fy?.cells)
ok(fy && fy.file === '2023-24 Payment Tracker - APRIL & MAY\'23.xlsx', 'a file is named with its year folder', fy?.file)
ok(fy && !('#I' in fy.cells) && fy.cells['#OLD I']?.v === 'stray', 'an old layout’s unlabelled cell is not mistaken for the newer layout’s (column AL = Endhan date)', fy && Object.keys(fy.cells))
ok(!families.FY.some((r) => r.cells['CHASSIS NUMBER']?.v === B), 'a Sheet4 copy inside the workbook is never read')
ok(one('LIST_OD', B)?.cells.DEALOR?.v === 'X', 'its OTHER DEALER sheet reads as the other-dealer retail list')
const dbm = one('RET_AL', A)
ok(dbm && dbm.cells.RETENTION?.v === 15 && dbm.cells['APP AMT']?.v === 5 && dbm.cells.NAME?.v === 'CUST A' && dbm.cells['SALE CATEGORY']?.v === 'RETAIL',
  'DBM export: Vin No. → chassis, Nett ORC → the AL claim, Adjustment → App Amt', dbm?.cells)
ok(dbm && !('MODEL' in dbm.cells) && !('MONTH' in dbm.cells), 'DBM export: its Model (a material code) and Month are not read', dbm && Object.keys(dbm.cells))
const old = one('RET_AL', B)
ok(old && old.cells.CTC?.v === 70 && !('RETENTION' in old.cells) && old.cells['DIFF BETWEEN CTC AND CTD']?.v === 10,
  'old AL sheet: its RETENTION is CTC − CTD, so it is not read as the claim', old?.cells)
const tally = one('RET_INT', B)
ok(tally && tally.cells.CTC?.v === 72 && tally.cells.NAME?.v === 'CUST B' && tally.cells['CBN NO.']?.v === 'V1', 'old TALLY sheet reads as internal retention', tally?.cells)
ok(one('IT', A)?.cells['AMC/SERVICE']?.v === 2, 'old purchase book: AMC → AMC/SERVICE')
ok(one('IT_OD', B)?.cells.AMC?.v === 3, 'OTHER DEALER keeps its AMC header (the rules read it as AMC)')
ok(seen.filter((s) => s.family).length === 7, 'seven sheets recognised', seen)

// a stray cell at Excel's last row and column (the team's pile had 78 such books): read from the cells that
// exist — walking the range (over 1,700 crore cells) never finishes
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['SRNO', 'Chassis No', 'CTC', 'CTD', 'AL Payment Status'], [1, A, 90, 80, 'Paid']])
  XLSX.utils.book_append_sheet(wb, ws, 'INVOICE TRACKER')
  const f = path.join(root, 'far/INVOICE TRACKER.xlsx'); fs.mkdirSync(path.dirname(f), { recursive: true }); XLSX.writeFile(wb, f)
  // the writer would walk the range too, so the stray cell goes straight into the sheet's XML
  const zip = XLSX.CFB.read(fs.readFileSync(f), { type: 'buffer' })
  const entry = zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith('/xl/worksheets/sheet1.xml'))]
  const xml = Buffer.from(entry.content).toString('utf8')
    .replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:XFD1048576"/>')
    .replace('</sheetData>', '<row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>stray</t></is></c></row></sheetData>')
  entry.content = Buffer.from(xml); entry.size = entry.content.length
  fs.writeFileSync(f, XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }))
  const t0 = Date.now()
  const far = readAll([{ path: f, fy: '2026-27' }])
  const secs = (Date.now() - t0) / 1000
  ok(secs < 5 && far.families.IT.length === 2, `a far-off stray cell: read in ${secs.toFixed(2)} s, the truck + the stray row`, far.families.IT.length)
  ok(far.families.IT[0].file === '2026-27 INVOICE TRACKER.xlsx', 'a file given with its year is named by it')
  ok(far.families.IT.find((r) => r.row === 1048576)?.cells['#XFD']?.v === 'stray', 'the stray cell keeps its column letter')
}

fs.rmSync(root, { recursive: true, force: true })
console.log(`selftest-import-read: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
