// Run the REAL matcher over the REAL August data and report what a person
// would actually see, receipt by receipt.
//
//   node scripts/payments/measure-matcher.mjs \
//     --billing "<Billing Report.xlsx>" \
//     --bharatpe "<statement.csv>" --gpay "<GPay....csv>" [--examples 12]
//
// This is the honesty check on the product's central claim. The plan says
// "shortlist fast, human picks" — this says how short the list actually is.
//
// Source files are commercial + personal data and gitignored; they arrive as
// arguments and are never written anywhere.

import fs from 'node:fs'
import * as XLSX from 'xlsx'

import { parseBillingReport } from '../../src/service-payments/lib/parseBillingReport.js'
import { parseBharatPe, parseGpay } from '../../src/service-payments/lib/parseUpi.js'
import { buildCandidateIndex, matchCandidates } from '../../src/service-payments/lib/matchCandidates.js'
import { formatINR } from '../../src/service-payments/lib/paise.js'

const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d }
const billingPath = arg('--billing')
const bpPath = arg('--bharatpe')
const gpPath = arg('--gpay')
const nExamples = Number(arg('--examples', '10'))

if (!billingPath) {
  console.error('need --billing <Billing Report.xlsx> and at least one of --bharatpe / --gpay')
  process.exit(2)
}

// ── load ───────────────────────────────────────────────────────────────────
const wb = XLSX.read(fs.readFileSync(billingPath), { type: 'buffer' })
const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
const inv = parseBillingReport(sheet, { entityId: 'PTB' })

const receipts = []
if (bpPath && fs.existsSync(bpPath)) receipts.push(...parseBharatPe(fs.readFileSync(bpPath, 'utf8')).receipts)
if (gpPath && fs.existsSync(gpPath)) receipts.push(...parseGpay(fs.readFileSync(gpPath, 'utf8')).receipts)
receipts.sort((a, b) => a.received_at.localeCompare(b.received_at))

const index = buildCandidateIndex(inv.invoices)

console.log(`\nINVOICES  ${inv.summary.parsed} parsed · ${inv.summary.payable} payable`)
console.log(`CANDIDATES ${index.docCount} searchable docs ` +
            `(${index.docs.filter((d) => d.kind === 'invoice').length} invoices + ` +
            `${index.docs.filter((d) => d.kind === 'job').length} multi-bill orders)`)
console.log(`RECEIPTS  ${receipts.length} · ${formatINR(receipts.reduce((a, r) => a + r.amount_paise, 0))}\n`)

// ── run ────────────────────────────────────────────────────────────────────
const buckets = { confident: 0, ranked: 0, refused: 0, none: 0 }
const listSizes = []
const winning = new Map()
const rows = []

for (const r of receipts) {
  const res = matchCandidates(r, index)
  const n = res.candidates.length
  listSizes.push(n)
  if (n === 0) buckets.none++
  else if (res.confident) buckets.confident++
  else if (res.refuse_to_rank) buckets.refused++
  else buckets.ranked++

  if (n) {
    const top = res.candidates[0]
    const best = top.signals.slice().sort((a, b) => rank(b.signal) - rank(a.signal))[0]
    winning.set(best.signal, (winning.get(best.signal) || 0) + 1)
  }
  rows.push({ r, res })
}
function rank(s) {
  return { reg_full: 6, reg_last4: 5, amount_unique: 4, note_bill_number: 3, payer_memory: 2, amount_ambiguous: 1 }[s] ?? 0
}

const pct = (n) => `${(n / receipts.length * 100).toFixed(1)}%`
console.log('WHAT THE PERSON SEES')
console.log('  ⚠ these are SHORTLIST-QUALITY numbers, not accuracy. Nobody has ever')
console.log('    recorded which bill each of these payments actually paid, so there is')
console.log('    no ground truth to score against. "Confident" means one candidate')
console.log('    stands clear of the rest — not that it is provably right.')
console.log(`  one obvious answer, confirm in a tap   ${String(buckets.confident).padStart(4)}  ${pct(buckets.confident)}`)
console.log(`  a ranked short list                    ${String(buckets.ranked).padStart(4)}  ${pct(buckets.ranked)}`)
console.log(`  equally likely, shown unordered        ${String(buckets.refused).padStart(4)}  ${pct(buckets.refused)}`)
console.log(`  nothing in range — search or hold      ${String(buckets.none).padStart(4)}  ${pct(buckets.none)}`)

const withAny = listSizes.filter((n) => n > 0).sort((a, b) => a - b)
const med = withAny.length ? withAny[Math.floor(withAny.length / 2)] : 0
console.log(`\nSHORTLIST LENGTH (where there is one)`)
console.log(`  median ${med} · mean ${(withAny.reduce((a, b) => a + b, 0) / (withAny.length || 1)).toFixed(1)} · ` +
            `max ${withAny[withAny.length - 1] ?? 0}`)
console.log(`  <= 3 candidates: ${withAny.filter((n) => n <= 3).length} of ${withAny.length} ` +
            `(${(withAny.filter((n) => n <= 3).length / (withAny.length || 1) * 100).toFixed(1)}%)`)

console.log(`\nWHAT WON THE TOP SLOT`)
for (const [sig, n] of [...winning.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sig.padEnd(20)} ${String(n).padStart(4)}  ${pct(n)}`)
}

// ── the note-number signal, measured on its own ────────────────────────────
const withNotes = receipts.filter((r) => (r.note_numbers || []).length)
let noteResolved = 0
for (const r of withNotes) {
  const res = matchCandidates(r, index)
  if (res.candidates[0]?.signals.some((s) => s.signal === 'reg_last4' || s.signal === 'reg_full' || s.signal === 'note_bill_number')) noteResolved++
}
console.log(`\nNOTE NUMBERS  ${withNotes.length} receipts carry one; ` +
            `${noteResolved} of those hit an open bill (${withNotes.length ? (noteResolved / withNotes.length * 100).toFixed(0) : 0}%)`)

// ── examples ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(74)}\nEXAMPLES — what the screen would show\n`)
const show = [
  ...rows.filter((x) => x.res.confident).slice(0, 3),
  ...rows.filter((x) => !x.res.confident && !x.res.refuse_to_rank && x.res.candidates.length).slice(0, 3),
  ...rows.filter((x) => x.res.refuse_to_rank).slice(0, 2),
  ...rows.filter((x) => !x.res.candidates.length).slice(0, 2),
].slice(0, nExamples)

for (const { r, res } of show) {
  const label = res.confident ? 'CONFIDENT'
    : res.refuse_to_rank ? 'UNORDERED'
    : res.candidates.length ? 'SHORTLIST' : 'NO MATCH'
  console.log(`[${label}] ${formatINR(r.amount_paise)}  ${r.received_at.slice(0, 10)}  ` +
              `${(r.payer_name || '(no name)').slice(0, 32)}  via ${r.source}` +
              (r.payer_remark ? `  note: "${r.payer_remark}"` : ''))
  if (res.reason) console.log(`   ${res.reason}`)
  for (const c of res.candidates.slice(0, 4)) {
    console.log(`   ${c.rank ? `${c.rank}.` : ' ·'} ${formatINR(c.amount_paise).padStart(13)}  ` +
                `${c.label.padEnd(24)} ${(c.customer_name || '').slice(0, 26).padEnd(26)} ` +
                `score ${String(Math.round(c.score)).padStart(3)}  ` +
                `${c.signals.map((s) => s.signal).join(',')}`)
  }
  console.log('')
}
