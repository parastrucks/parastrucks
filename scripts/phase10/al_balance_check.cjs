// Phase 10 — what a monthly AL Balance Sheet upload would flag against the tracker (2026-10-23).
//
//   node scripts/phase10/al_balance_check.cjs
//
// Owner, 2026-10-23: keep the AL Balance Sheet in Excel; each month, once it is final, upload it to
// the portal, which points out discrepancies. This runs those checks over the 12 monthly files of
// 2025-26 against the INVOICE TRACKER workbook (standing in for the tracker until the real load).
// Prints COUNTS and chassis numbers only — never an amount.
const XLSX = require('xlsx')
const DIR = 'C:/Users/dhruv/Downloads/AL BALANCE SHEET - 2025-26/AL BALANCE SHEET - 2025-26/'
const MONTHS = ['0425', '0525', '0625', '0725', '0825', '0925', '1025', '1125', '1225', '0126', '0226', '0326']
const TRACKER = 'D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx'

// ── the tracker side: chassis → CTD, AL Payment Status, AL payment date
const it = XLSX.utils.sheet_to_json(XLSX.readFile(TRACKER).Sheets['INVOICE TRACKER'], { header: 1, defval: null })
const book = new Map()
for (const r of it.slice(1)) {
  const ch = String(r[5] ?? '').trim().toUpperCase()
  if (!ch) continue
  book.set(ch, { ctd: typeof r[16] === 'number' ? r[16] : null, status: String(r[21] ?? '').trim(), paid: r[22],
                 customer: String(r[11] ?? '').trim(), ptbInvoice: typeof r[23] === 'number' && r[23] > 0 ? r[23] : null })
}

const near = (a, b) => Math.abs(a - b) < 1           // within a rupee
const FRACTIONS = [1, 0.95, 0.05, 0.1, 0.3, 0.5]       // seen: whole, 95/5, 5%×N
// A truck's OWN line (what PTB owes for the truck) vs the later add-on lines on the same chassis,
// whose "CTD" cell holds the add-on's amount. IBND → Cash Invoiced later is the truck's normal life.
const TRUCK = new Set(['FRESH OFFTAKE', 'IBND', 'MTO'])
const SPELLING = { 'PARTS PKG': 'PARTS PACKAGE', 'I-ALERT': 'IALERT', 'PATMENT PENDING': 'PAYMENT PENDING' }
const issues = {}
const flag = (kind, month, what) => { (issues[kind] ??= []).push(`${month} ${what}`) }
const shareByChassis = new Map()
const mtoAdvances = []
const words = (t) => String(t).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['AND', 'THE', 'PVT', 'LTD', 'CO'].includes(w))
const GST_CHANGE = 45922 // 22 Sep 2025 as an Excel serial
let gstExplained = 0, prevNet = null, trucks = 0, addons = 0, money = 0

for (const m of MONTHS) {
  const wb = XLSX.readFile(`${DIR}AL Balance Sheet -${m}.xlsx`, { cellFormula: true })
  const ws = wb.Sheets['AL Balance Sheet']
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
  const head = rows[0].map((h) => String(h ?? '').trim())
  const [cDet, cDr, cCr, cCh, cCtd, cMode] =
    ['Details', 'Debit', 'Credit', 'Chassis No', 'CTD', 'Offtake Mode'].map((n) => head.indexOf(n))
  if ([cDet, cDr, cCr, cCh, cCtd, cMode].some((i) => i < 0)) { flag('headers moved', m, head.join('|')); continue }
  let paid = 0, owed = 0, carry = null, net = null
  const seenTruck = new Set()
  rows.slice(1).forEach((r, i) => {
    const det = String(r[cDet] ?? '').trim()
    const crv = typeof r[cCr] === 'number' ? r[cCr] : 0
    const drv = typeof r[cDr] === 'number' ? r[cDr] : 0
    if (/^net balance$/i.test(det)) { net = drv; return }
    if (/unbilled balance/i.test(det)) return
    paid += drv; owed += crv
    if (/^carry over$/i.test(det)) { carry = drv - crv; return }
    if (!crv) { if (drv) money++; return }
    const row = `row ${i + 2}`
    const ch = String(r[cCh] ?? '').trim().toUpperCase()
    const raw = String(r[cMode] ?? '').trim().toUpperCase()
    if (!raw) flag('credit line with no Offtake Mode', m, `${row} ${ch}`)
    if (SPELLING[raw]) flag('Offtake Mode spelt two ways', m, `${raw} → ${SPELLING[raw]}`)
    const mode = SPELLING[raw] ?? raw
    if (!ch && mode === 'MTO') { mtoAdvances.push({ m, name: words(det.replace(/^MTO\W*(@?\s*5%)?\W*/i, '')) }); return }
    if (!ch) { flag('credit line with no chassis (not an MTO advance)', m, `${row} (${det.slice(0, 30)})`); return }
    const t = book.get(ch)
    if (!t) { flag('chassis not in the tracker', m, `${ch} (${mode})`); return }
    if (!ws[XLSX.utils.encode_cell({ r: i + 1, c: cCr })]?.f) flag('credit typed as a number, not a formula', m, ch)
    if (!TRUCK.has(mode)) { addons++; return }
    trucks++
    if (seenTruck.has(ch)) flag('truck line twice in one month', m, ch)
    seenTruck.add(ch)
    const sheetCtd = r[cCtd]
    if (t.ctd == null) flag('tracker has no CTD', m, ch)
    else if (typeof sheetCtd === 'number' && !near(sheetCtd, t.ctd)) {
      // AL billed the truck at 28% GST (before 22 Sep 2025) and the tracker holds it at 18%: the
      // sheet CTD is the tracker's × 1.28 / 1.18 to the rupee. Explained, but still shown.
      if (Math.abs(sheetCtd - t.ctd * 1.28 / 1.18) < 2) {
        if (t.ptbInvoice != null && t.ptbInvoice < GST_CHANGE) flag('CTD at 18% in the tracker, but the PTB invoice is before 22 Sep 2025', m, ch)
        else gstExplained++
      }
      else flag('CTD on the sheet ≠ CTD in the tracker', m, `${ch} (${Math.round(100 * sheetCtd / t.ctd)}%)`)
    }
    // the sheet's own arithmetic, and how much of the truck each line pays (splits), on the SHEET's CTD
    const base = (typeof sheetCtd === 'number' ? sheetCtd : t.ctd) * 0.999
    const share = FRACTIONS.find((p) => near(crv, base * p))
    if (share == null) flag('credit ≠ CTD × 0.999 (or a known split)', m, ch)
    shareByChassis.set(ch, (shareByChassis.get(ch) ?? 0) + (share ?? crv / base))
    if (t.status.toUpperCase() === 'IBND' && mode !== 'IBND') flag('sheet says paid (' + mode + '), tracker still IBND', m, ch)
  })
  if (net == null) flag('no Net Balance line', m, '')
  else if (!near(net, paid - owed)) flag('Net Balance ≠ paid − owed', m, '')
  if (prevNet != null && carry != null && !near(carry, prevNet)) flag("CARRY OVER ≠ last month's Net Balance", m, '')
  prevNet = net
}
let mtoPaired = 0
for (const [ch, s] of shareByChassis) {
  if (s > 1.001) flag('truck credited more than 100% over the year', 'FY', `${ch} (${Math.round(s * 100)}%)`)
  else if (s < 0.999) {
    // a 95% truck line whose 5% went in earlier as an MTO advance under the customer's name
    const cw = words(book.get(ch)?.customer ?? '')
    const adv = Math.abs(s - 0.95) < 0.001 && mtoAdvances.some((a) => a.name.some((w) => cw.includes(w)))
    if (adv) mtoPaired++
    else flag('split never completed (under 100%)', 'FY', `${ch} (${Math.round(s * 100)}%)`)
  }
}
for (const [ch, t] of book) if (/cash invoiced|ibnd/i.test(t.status) && !shareByChassis.has(ch)) flag('tracker: invoiced by AL, but on no balance sheet', 'FY', `${ch} (${t.status})`)

console.log(`explained, not shown: ${gstExplained} CTDs at 18% by the PTB invoice date (AL billed 28%) · ${mtoAdvances.length} MTO advances (5%, no chassis yet) · ${mtoPaired} 95% trucks paired to an MTO advance by customer name`)
console.log(`checked ${MONTHS.length} months · ${trucks} truck lines · ${addons} add-on lines · ${money} money lines · tracker ${book.size} chassis`)
for (const [k, v] of Object.entries(issues)) {
  console.log(`\n${k}: ${v.length}`)
  for (const x of v.slice(0, 6)) console.log('   ' + x)
  if (v.length > 6) console.log(`   … ${v.length - 6} more`)
}
