// Proves every scenario in the demo files BEFORE anyone is asked to walk
// through them — so the owner's checklist describes what the code does, not
// what it was hoped to do.
//
//   npx --yes esbuild scripts/payments/selftest-demo-files.mjs --bundle --platform=node \
//     --format=esm --outfile=<tmp>/demo.mjs && node <tmp>/demo.mjs
//
// (Bundled because matchQueue.js imports the Edge Function's authority.ts.)
// Runs the files through the SAME functions the Import and Match screens use:
// parseImportFile → gates → diff, then the matcher, the job split and the
// stale-bills brake.

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { writeDemoFiles, DAYS, DEMO_QR, hdfcTxnId } from './make-demo-files.mjs'
import {
  parseImportFile, importGates, diffInvoices, diffReceipts, billCoverage, expectedCounts,
} from '../../src/service-payments/lib/importPlan.js'
import { parseBillingReport } from '../../src/service-payments/lib/parseBillingReport.js'
import { parseBharatPe, parseGpay } from '../../src/service-payments/lib/parseUpi.js'
import { parseHdfcSmartHub } from '../../src/service-payments/lib/parseHdfc.js'
import { buildCandidateIndex, matchCandidates } from '../../src/service-payments/lib/matchCandidates.js'
import { toMatchReceipt, allocationTargets, feedIsStaleFor, orderQueue } from '../../src/service-payments/lib/matchQueue.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-demo-'))
writeDemoFiles(dir)
// The Import screen's own parser set (ImportPanel.jsx passes all four).
const parsers = { parseBillingReport, parseBharatPe, parseGpay, parseHdfcSmartHub }
const OUTLETS = [{ id: 'O-ahd', city: 'Ahmedabad', is_active: true }, { id: 'O-anand', city: 'Anand', is_active: true }]
const read = async (name) => {
  const buf = fs.readFileSync(path.join(dir, name))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const mtime = fs.statSync(path.join(dir, name)).mtimeMs
  return { ...(await parseImportFile({ name, buffer: ab }, { XLSX, parsers, entityId: 'E', outlets: OUTLETS })), mtime }
}

// ════════════════════════════════════════════════════════════════════════════
section('The set itself')
{
  eq('four files: two Billing Reports, two HDFC reports', fs.readdirSync(dir).sort(),
     ['DEMO Billing Report 1.xlsx', 'DEMO Billing Report 2.xlsx', 'DEMO HDFC report 1.xlsx', 'DEMO HDFC report 2.xlsx'])
  ok('no retired BharatPe / Google Pay file is made', !fs.readdirSync(dir).some((f) => /bharatpe|gpay/i.test(f)))
  // A 20-digit id written as a NUMBER would lose its tail — the real parser
  // refuses that, so the demo must carry it as text, as HDFC does.
  const ws = XLSX.read(fs.readFileSync(path.join(dir, 'DEMO HDFC report 1.xlsx'))).Sheets.Sheet1
  ok('the HDFC transaction ids are stored as TEXT cells', ws.P2?.t === 's' && ws.P2?.v === hdfcTxnId(1), JSON.stringify(ws.P2))
}

// ════════════════════════════════════════════════════════════════════════════
section('Import: Billing Report 1')
const br1 = await read('DEMO Billing Report 1.xlsx')
const d1 = diffInvoices(br1.parsed.invoices, [])
{
  eq('it is recognised as the Billing Report', br1.kind, 'billing_report')
  eq('20 bills read, none refused', [br1.parsed.invoices.length, br1.parsed.refused.length], [20, 0])
  eq('18 payable, 1 free of cost, 1 parts return parked', br1.parsed.summary.by_status,
     { active: 18, not_payable: 1, parked: 1 })
  ok('both PTB plants map to outlets', br1.parsed.invoices.every((v) => v.outlet_id))
  const g = importGates({ kind: 'billing_report', parsed: br1.parsed, diff: d1, priorBatch: null })
  ok('the gates pass', g.ok, g.blocking.join(' / '))
  eq('first import: all 20 are new', d1.new.length, 20)
  const again = importGates({ kind: 'billing_report', parsed: br1.parsed, diff: d1,
    priorBatch: { uploaded_at: new Date().toISOString(), file_name: 'DEMO Billing Report 1.xlsx' } })
  ok('choosing the same file again is BLOCKED', !again.ok)
}

// ════════════════════════════════════════════════════════════════════════════
section('Import: HDFC report 1 (up to yesterday)')
const h1 = await read('DEMO HDFC report 1.xlsx')
const hd1 = diffReceipts(h1.parsed.receipts, [], [])
const rupees = (paise) => paise / 100
{
  eq('recognised as the HDFC report by its columns', h1.kind, 'hdfc')
  eq('11 rows: 10 payments, 1 failed attempt, nothing unreadable',
     [h1.parsed.summary.rows_in_file, h1.parsed.receipts.length, h1.parsed.summary.failed_attempts, h1.parsed.summary.refused],
     [11, 10, 1, 1])
  ok('every payment carries a payer name, and none a note',
     h1.parsed.receipts.every((r) => r.payer_name && r.note_numbers.length === 0 && r.reg_nos.length === 0))
  eq('every payment carries the demo QR', h1.parsed.summary.qrs, [`${DEMO_QR.merchant}/${DEMO_QR.terminal}`])
  const g = importGates({ kind: 'hdfc', parsed: h1.parsed, diff: hd1, priorBatch: null })
  ok('the gates pass', g.ok, g.blocking.join(' / '))
  ok('...noting the failed attempt is not imported', g.warnings.some((w) => w.startsWith('1 row not imported')), g.warnings.join(' / '))
  ok('...and the ₹30 top-up', g.warnings.some((w) => w.includes('₹50 or less')))
  eq('first import: all 10 are new', hd1.new.length, 10)
  // The settlement tie-out on screen: success per IST day. The failed ₹4,800
  // is in none of them — counting it would put 2 days ago at ₹32,427.
  eq('success per day, to tick against HDFC\'s next-morning credit',
     Object.entries(h1.parsed.summary.settles_by_day_paise).map(([d, p]) => [d, rupees(p)]),
     [[DAYS.d4, 2150], [DAYS.d3, 22375.67], [DAYS.d2, 27627], [DAYS.d1, 3860]])
  eq('Ramesh\'s ₹4,800 arrives ONCE, not twice', h1.parsed.receipts.filter((r) => r.amount_paise === 480000).length, 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('Import: HDFC report 2 (this morning — overlaps yesterday)')
const h2 = await read('DEMO HDFC report 2.xlsx')
{
  eq('3 payments in the file', h2.parsed.receipts.length, 3)
  // What the server holds after report 1, in the shape the screen reads it.
  const stored = h1.parsed.receipts.map((r) => ({ external_txn_id: r.external_txn_id, source: 'hdfc',
    status: 'active', amount_paise: r.amount_paise, normalized_utr: r.normalized_utr, import_batch_id: 'B1' }))
  const d = diffReceipts(h2.parsed.receipts, stored, stored)
  eq('yesterday\'s 2 are recognised as already imported, 1 new, nothing held',
     [d.new.length, d.already.length, d.linkManual.length, d.held.length], [1, 2, 0, 0])
  eq('...the new one is BHAVIN\'s, this morning', d.new.map((r) => r.payer_name), ['DEMO BHAVIN TRADING'])
  const g = importGates({ kind: 'hdfc', parsed: h2.parsed, diff: d, priorBatch: null })
  ok('the gates pass, with no "nothing new" warning', g.ok && !g.warnings.some((w) => w.startsWith('Nothing')), g.warnings.join(' / '))
  eq('the server is asked for exactly that', expectedCounts('hdfc', d),
     { new: 1, already_present: 2, already_present_manual: 0, held: 0 })
  eq('its tie-out lists yesterday and today', Object.entries(h2.parsed.summary.settles_by_day_paise).map(([dd, p]) => [dd, rupees(p)]),
     [[DAYS.d1, 3860], [DAYS.today, 1930]])
}

// ════════════════════════════════════════════════════════════════════════════
section('Match: what each payment should show')
const bills = br1.parsed.invoices.map((v) => ({ ...v, id: v.invoice_number, allocated_paise: 0 }))
const byId = new Map(bills.map((v) => [v.id, v]))
const index = buildCandidateIndex(bills)
const feed = { covered_until: billCoverage(br1.parsed.invoices, br1.mtime) }
const inReport1 = new Set(h1.parsed.receipts.map((r) => r.external_txn_id))
const receipts = [...h1.parsed.receipts, ...h2.parsed.receipts.filter((r) => !inReport1.has(r.external_txn_id))]
  .map((r) => toMatchReceipt({ ...r, id: r.external_txn_id, allocated_paise: 0 }))
const look = (payer, rupeesAmt) => {
  const r = receipts.find((x) => x.payer_name === payer && x.amount_paise === Math.round(rupeesAmt * 100))
  if (!r) throw new Error(`no receipt ${payer} ₹${rupeesAmt}`)
  const stale = feedIsStaleFor(r, feed)
  return { r, stale, res: matchCandidates(r, index, { feedIsStale: stale }) }
}
// A missing candidate is a FAILED check, not a crash that hides every check after it.
const place = (cand, byIdMap, paise) => (cand ? allocationTargets(cand, byIdMap, paise) : [])
const sig = (c) => (c?.signals ?? []).map((s) => s.signal)
{
  eq('11 payments to match: 10 from report 1, BHAVIN from report 2', receipts.length, 11)

  let { res, stale, r } = look('JAYESH PATEL', 2150)
  ok('JAYESH PATEL ₹2,150 → JAY BATTERIES\' bill, by its unique amount (the names share nothing)',
     res.candidates[0]?.label === 'MPI5756260009601' && sig(res.candidates[0]).includes('amount_unique') &&
     !sig(res.candidates[0]).some((s) => s.startsWith('name')))

  ;({ res, stale } = look('DEMO KISAN TRADERS', 12345.67))
  eq('KISAN ₹12,345.67 → its one bill, first', res.candidates[0]?.label, 'MCI6370260009301')
  ok('...because the amount is unique', sig(res.candidates[0]).includes('amount_unique'))
  ok('...and the bills are current for it', !stale)

  // The ₹30 top-up is from the same payer, the same afternoon. A strong NAME
  // match earns a place on the list by design — until the ₹12,345.67 payment
  // (earlier in the queue) has paid that bill, after which nothing is offered.
  ;({ res } = look('DEMO KISAN TRADERS', 30))
  ok('the ₹30 top-up, before KISAN is matched → KISAN\'s bill, by NAME only',
     res.candidates.length === 1 && res.candidates[0].label === 'MCI6370260009301' &&
     !sig(res.candidates[0]).some((s) => s.startsWith('amount')))
  {
    const paid = buildCandidateIndex(bills.map((v) => v.invoice_number === 'MCI6370260009301'
      ? { ...v, allocated_paise: v.total_paise } : v))
    const r30 = look('DEMO KISAN TRADERS', 30).r
    eq('...and once KISAN\'s bill is paid, nothing is offered', matchCandidates(r30, paid).candidates.length, 0)
  }

  // No note any more: the ₹25,000 bill is found by the proprietor's name alone.
  ;({ res, r } = look('GANGA SAGAR MAHESHWARI', 10000))
  eq('GANGA SAGAR MAHESHWARI ₹10,000 → the ₹25,000 credit bill of DEMO GANGA SAGAR MAHESHWARI, first', res.candidates[0]?.label, 'PCR6370260009401')
  ok('...found by NAME (no amount, no plate)', sig(res.candidates[0]).includes('name_overlap_strong') &&
     !sig(res.candidates[0]).some((s) => s.startsWith('amount') || s.startsWith('reg_')), JSON.stringify(sig(res.candidates[0])))
  eq('...and confirming places ₹10,000 — a part payment',
     place(res.candidates[0], byId, r.amount_paise), [{ invoice_id: 'PCR6370260009401', amount_paise: 1000000 }])

  ;({ res } = look('DEMO QUICK FREIGHT', 7777))
  eq('₹7,777 → no bill exists at all', res.candidates.length, 0)

  ;({ res } = look('RAMESH SHARMA', 4800))
  ok('RAMESH SHARMA ₹4,800 → his bill, by its unique amount',
     res.candidates[0]?.label === 'LCS5756260009501' && sig(res.candidates[0]).includes('amount_unique'))
  eq('...and there is ONE ₹4,800 payment to match, not two', receipts.filter((x) => x.amount_paise === 480000).length, 1)

  ;({ res } = look('MEHUL SHAH', 3400))
  eq('₹3,400 → both ₹3,400 bills offered', res.candidates.map((c) => c.label).sort(),
     bills.filter((v) => v.total_paise === 340000).map((v) => v.invoice_number).sort())

  ;({ res, r } = look('SURESH DESAI', 11650))
  const job = res.candidates[0]
  ok('SURESH DESAI ₹11,650 → the parts+labour JOB first', job?.kind === 'job' && job?.member_count === 2, JSON.stringify(job?.label))
  ok('...found by the SUM of the two bills (no note to help)', sig(job).includes('amount_unique') && !sig(job).some((s) => s.startsWith('reg_')))
  eq('...and confirming pays each of the two bills in full',
     place(job, byId, r.amount_paise).map((t) => [t.invoice_id, t.amount_paise]).sort(),
     [['LCS5756260009202', 320000], ['PCS5756260009201', 845000]])

  ;({ res } = look('DEMO ASHA ENTERPRISE', 1930))
  eq('ASHA ₹1,930 → five identical bills, and ASHA\'s is ranked first by name', res.candidates[0]?.label, 'MPI5756260009101')
  ok('...with the pile still visible (5 bills)', res.candidates.length === 5)
  ok('...and ranked, not refused', !res.refuse_to_rank)

  ;({ res } = look('NIRAV PATEL', 1930))
  ok('NIRAV ₹1,930 → the five bills UNRANKED, with the honest banner', res.refuse_to_rank && res.candidates.length === 5, res.reason)

  ;({ res, stale } = look('DEMO BHAVIN TRADING', 1930))
  ok(`the payment made TODAY (${DAYS.today}) → "bills out of date", confirm off`, stale && res.reason.includes('out of date'))
}

// ════════════════════════════════════════════════════════════════════════════
section('Import: Billing Report 2, the next day\'s re-export')
const br2 = await read('DEMO Billing Report 2.xlsx')
{
  const stored = (allocatedAsha) => br1.parsed.invoices.map((v) => ({
    invoice_number: v.invoice_number, sap_customer_code: v.sap_customer_code, customer_name: v.customer_name,
    total_paise: v.total_paise, allocated_paise: v.invoice_number === 'MPI5756260009101' ? allocatedAsha : 0,
    status: v.status, cancelled_flag: v.cancelled_flag }))
  let d = diffInvoices(br2.parsed.invoices, stored(0))
  eq('ASHA not yet matched: 1 new, 2 changed (ASHA cancelled, MANAN ₹745→₹845), 18 unchanged',
     [d.new.length, d.amended.length, d.unchanged.length, d.conflict.length], [1, 2, 18, 0])
  d = diffInvoices(br2.parsed.invoices, stored(193000))
  eq('ASHA already matched: her cancellation becomes a CLASH — reverse the match first',
     [d.amended.length, d.conflict.length, d.conflict[0]?.row.invoice_number], [1, 1, 'MPI5756260009101'])
  ok('...and the clash says so', (d.conflict[0]?.reason ?? '').includes('reverse that match first'))

  // Report 2 is the first feed that covers TODAY, so it lifts the brake on the
  // payment made this morning — provided the file was saved after 09:15 IST.
  const bhavin = look('DEMO BHAVIN TRADING', 1930).r
  const savedTonight = Date.parse(`${DAYS.today}T18:00:00+05:30`)
  const cov2 = billCoverage(br2.parsed.invoices, savedTonight)
  ok('after report 2, today\'s 09:15 payment is no longer "out of date"',
     !feedIsStaleFor(bhavin, { covered_until: cov2 }), cov2)
  const savedAtNine = Date.parse(`${DAYS.today}T09:00:00+05:30`)
  ok('...but a report saved at 09:00 would NOT cover a 09:15 payment',
     feedIsStaleFor(bhavin, { covered_until: billCoverage(br2.parsed.invoices, savedAtNine) }))
}

// ════════════════════════════════════════════════════════════════════════════
section('The walkthrough IN ORDER, as the Match tab will show it')
// The checks above look at each payment against untouched bills. The owner
// works the queue oldest-first, and every Confirm takes a bill (or part of
// one) off the list and teaches the payer's name — so the screen at payment N
// depends on payments 1..N-1. Name evidence also weakens as bills close (it is
// weighted by rarity among OPEN bills), which is how a two-word name that
// passed above failed here. This replays the walkthrough's own actions.
{
  const alloc = new Map()   // invoice_number -> paise placed
  const memory = new Map()  // `${payer}|${code}` -> confirmations
  let invoices = br1.parsed.invoices
  const open = () => invoices.map((v) => ({ ...v, id: v.invoice_number, allocated_paise: alloc.get(v.invoice_number) ?? 0 }))
  const payerMemory = () => [...memory].map(([k, n]) => {
    const [p, c] = k.split('|')
    return { normalized_payer_name: p, sap_customer_code: c, confirm_count: n, contradiction_count: 0 }
  })
  const screen = (r, coveredUntil) => {
    const stale = feedIsStaleFor(r, { covered_until: coveredUntil })
    return { stale, res: matchCandidates(r, buildCandidateIndex(open()), { payerMemory: payerMemory(), feedIsStale: stale }) }
  }
  const confirm = (r, cand) => {
    const now = new Map(open().map((v) => [v.id, v]))
    if (!cand) { ok(`Confirm ${r.payer_name}: there is a bill to confirm`, false); return [] }
    const placed = allocationTargets(cand, now, r.amount_paise)
    for (const t of placed) alloc.set(t.invoice_id, (alloc.get(t.invoice_id) ?? 0) + t.amount_paise)
    const k = `${r.normalized_payer_name}|${now.get(cand.invoice_ids[0]).sap_customer_code}`
    memory.set(k, (memory.get(k) ?? 0) + 1)
    return placed
  }
  const custBill = (name, paise) => invoices.find((v) => v.customer_name === name && v.total_paise === paise).invoice_number

  const queue = orderQueue(receipts)
  eq('the queue, oldest first', queue.map((r) => `${r.payer_name} ${rupees(r.amount_paise)}`), [
    'JAYESH PATEL 2150', 'DEMO KISAN TRADERS 12345.67', 'DEMO KISAN TRADERS 30', 'GANGA SAGAR MAHESHWARI 10000',
    'DEMO QUICK FREIGHT 7777', 'RAMESH SHARMA 4800', 'MEHUL SHAH 3400', 'SURESH DESAI 11650',
    'DEMO ASHA ENTERPRISE 1930', 'NIRAV PATEL 1930', 'DEMO BHAVIN TRADING 1930'])
  const step = (i) => ({ r: queue[i], ...screen(queue[i], feed.covered_until) })

  let s = step(0)
  ok('1 · JAYESH ₹2,150 → JAY BATTERIES\' bill → Confirm', s.res.candidates[0]?.label === 'MPI5756260009601')
  confirm(s.r, s.res.candidates[0])
  s = step(1)
  ok('2 · KISAN ₹12,345.67 → KISAN\'s bill → Confirm', s.res.candidates[0]?.label === 'MCI6370260009301')
  confirm(s.r, s.res.candidates[0])
  s = step(2)
  eq('3 · KISAN ₹30 → nothing to match (his bill is paid) → Skip', s.res.candidates.length, 0)
  s = step(3)
  ok('4 · GANGA ₹10,000 → GANGA\'s ₹25,000 bill first, by name, after two bills have closed',
     s.res.candidates[0]?.label === 'PCR6370260009401' && sig(s.res.candidates[0]).includes('name_overlap_strong'),
     JSON.stringify(s.res.candidates.map((c) => [c.label, sig(c)])))
  eq('    → Confirm places ₹10,000 of ₹25,000', confirm(s.r, s.res.candidates[0]), [{ invoice_id: 'PCR6370260009401', amount_paise: 1000000 }])
  s = step(4)
  eq('5 · QUICK FREIGHT ₹7,777 → nothing → Skip', s.res.candidates.length, 0)
  s = step(5)
  ok('6 · RAMESH ₹4,800 → his bill → Confirm', s.res.candidates[0]?.label === 'LCS5756260009501')
  confirm(s.r, s.res.candidates[0])
  s = step(6)
  eq('7 · MEHUL ₹3,400 → HARSH\'s and INDU\'s bills, both offered', s.res.candidates.map((c) => c.customer_name).sort(),
     ['DEMO HARSH TYRES', 'DEMO INDU SPARES'])
  confirm(s.r, s.res.candidates.find((c) => c.customer_name === 'DEMO INDU SPARES'))
  s = step(7)
  ok('8 · SURESH ₹11,650 → the 2-bill FLEET CARRIERS job', s.res.candidates[0]?.kind === 'job' && s.res.candidates[0]?.member_count === 2)
  eq('    → Confirm pays both in full', confirm(s.r, s.res.candidates[0]).map((t) => [t.invoice_id, t.amount_paise]).sort(),
     [['LCS5756260009202', 320000], ['PCS5756260009201', 845000]])
  s = step(8)
  ok('9 · ASHA ₹1,930 → five ₹1,930 bills, ASHA\'s first and ranked',
     s.res.candidates.length === 5 && s.res.candidates[0]?.label === 'MPI5756260009101' && !s.res.refuse_to_rank)
  confirm(s.r, s.res.candidates[0])
  s = step(9)
  ok('10 · NIRAV ₹1,930 → the FOUR bills left, unranked, with the banner → Skip',
     s.res.refuse_to_rank && s.res.candidates.length === 4, `${s.res.candidates.length} ${s.res.reason}`)
  s = step(10)
  ok('11 · BHAVIN ₹1,930 (today) → "bills out of date", Confirm off', s.stale)

  // Next day's bills: what the server stores. ASHA's cancellation is a clash
  // (money is matched to it) and is left as it was; the rest land.
  const d = diffInvoices(br2.parsed.invoices, open())
  ok('Billing Report 2 now: 1 new, 1 changed, 1 clash (ASHA)',
     d.new.length === 1 && d.amended.length === 1 && d.conflict.length === 1 && d.conflict[0].row.invoice_number === 'MPI5756260009101',
     JSON.stringify([d.new.length, d.amended.length, d.conflict.length]))
  const clash = new Set(d.conflict.map((c) => c.row.invoice_number))
  invoices = [...invoices.filter((v) => clash.has(v.invoice_number)),
              ...br2.parsed.invoices.filter((v) => !clash.has(v.invoice_number))]
  const cov2 = billCoverage(br2.parsed.invoices, Date.parse(`${DAYS.today}T18:00:00+05:30`))
  const b = { r: queue[10], ...screen(queue[10], cov2) }
  ok('12 · after report 2, BHAVIN ₹1,930 → no longer out of date; his own bill first, ranked',
     !b.stale && b.res.candidates[0]?.label === custBill('DEMO BHAVIN TRADING', 193000) && !b.res.refuse_to_rank,
     JSON.stringify(b.res.candidates.map((c) => [c.customer_name, Math.round(c.score)])))
  eq('    ...among the four ₹1,930 bills still unpaid (the one NIRAV was offered stays open)', b.res.candidates.length, 4)
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
