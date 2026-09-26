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
import { writeDemoFiles, DAYS } from './make-demo-files.mjs'
import {
  parseImportFile, importGates, diffInvoices, diffReceipts, billCoverage, outletIdByPlant,
} from '../../src/service-payments/lib/importPlan.js'
import { parseBillingReport } from '../../src/service-payments/lib/parseBillingReport.js'
import { parseBharatPe, parseGpay } from '../../src/service-payments/lib/parseUpi.js'
import { buildCandidateIndex, matchCandidates } from '../../src/service-payments/lib/matchCandidates.js'
import { toMatchReceipt, allocationTargets, feedIsStaleFor } from '../../src/service-payments/lib/matchQueue.js'

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
const parsers = { parseBillingReport, parseBharatPe, parseGpay }
const OUTLETS = [{ id: 'O-ahd', city: 'Ahmedabad', is_active: true }, { id: 'O-anand', city: 'Anand', is_active: true }]
const read = async (name) => {
  const buf = fs.readFileSync(path.join(dir, name))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const mtime = fs.statSync(path.join(dir, name)).mtimeMs
  return { ...(await parseImportFile({ name, buffer: ab }, { XLSX, parsers, entityId: 'E', outlets: OUTLETS })), mtime }
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
section('Import: the two payment files')
const bp = await read('DEMO BharatPe statement.csv')
const gp = await read('DEMO GPay export.csv')
{
  eq('BharatPe recognised by its columns', bp.kind, 'bharatpe')
  eq('7 BharatPe payments', bp.parsed.receipts.length, 7)
  const gb = importGates({ kind: 'bharatpe', parsed: bp.parsed, diff: diffReceipts(bp.parsed.receipts, [], []), priorBatch: null })
  ok('BharatPe passes, with the ₹30 top-up flagged', gb.ok && gb.warnings.some((w) => w.includes('₹50 or less')))
  eq('Google Pay recognised by its columns', gp.kind, 'gpay')
  eq('4 settled payments, the Pending one not imported', [gp.parsed.receipts.length, gp.parsed.summary.refused], [4, 1])
  const gg = importGates({ kind: 'gpay', parsed: gp.parsed, diff: diffReceipts(gp.parsed.receipts, [], []), priorBatch: null })
  ok('Google Pay passes, warning about the unsettled row', gg.ok && gg.warnings.some((w) => w.includes('not imported')))
}

// ════════════════════════════════════════════════════════════════════════════
section('Match: what each payment should show')
const bills = br1.parsed.invoices.map((v) => ({ ...v, id: v.invoice_number, allocated_paise: 0 }))
const byId = new Map(bills.map((v) => [v.id, v]))
const index = buildCandidateIndex(bills)
const feed = { covered_until: billCoverage(br1.parsed.invoices, br1.mtime) }
const receipts = [...bp.parsed.receipts, ...gp.parsed.receipts].map((r) =>
  toMatchReceipt({ ...r, id: r.external_txn_id, allocated_paise: 0 }))
const look = (txn) => {
  const r = receipts.find((x) => x.external_txn_id === txn)
  const stale = feedIsStaleFor(r, feed)
  return { r, stale, res: matchCandidates(r, index, { feedIsStale: stale }) }
}
const sig = (c) => c.signals.map((s) => s.signal)
{
  let { res, stale } = look('990000001001')
  eq('KISAN ₹12,345.67 → its one bill, first', res.candidates[0]?.label, 'MCI6370260009301')
  ok('...because the amount is unique', sig(res.candidates[0]).includes('amount_unique'))
  ok('...and the bills are current for it', !stale)

  ;({ res } = look('990000001002'))
  eq('ASHA ₹1,930 → five identical bills, and ASHA\'s is ranked first by name', res.candidates[0]?.label, 'MPI5756260009101')
  ok('...with the pile still visible (5 bills)', res.candidates.length === 5)
  ok('...and ranked, not refused', !res.refuse_to_rank)

  ;({ res } = look('990000001003'))
  ok('NIRAV ₹1,930 → the five bills UNRANKED, with the honest banner', res.refuse_to_rank && res.candidates.length === 5, res.reason)

  // The ₹30 top-up is from the same payer, the same afternoon. A strong NAME
  // match earns a place on the list by design — until the ₹12,345.67 payment
  // (earlier in the queue) has paid that bill, after which nothing is offered.
  ;({ res } = look('990000001004'))
  ok('the ₹30 top-up, before KISAN is matched → KISAN\'s bill, by NAME only',
     res.candidates.length === 1 && res.candidates[0].label === 'MCI6370260009301' &&
     !sig(res.candidates[0]).some((s) => s.startsWith('amount')))
  {
    const paid = buildCandidateIndex(bills.map((v) => v.invoice_number === 'MCI6370260009301'
      ? { ...v, allocated_paise: v.total_paise } : v))
    const r30 = receipts.find((x) => x.external_txn_id === '990000001004')
    eq('...and once KISAN\'s bill is paid, nothing is offered', matchCandidates(r30, paid).candidates.length, 0)
  }
  ;({ res } = look('990000001005'))
  eq('₹7,777 → no bill exists at all', res.candidates.length, 0)

  ;({ res } = look('990000001006'))
  eq('₹3,400 → both ₹3,400 bills offered', res.candidates.map((c) => c.label).sort(),
     bills.filter((v) => v.total_paise === 340000).map((v) => v.invoice_number).sort())

  ;({ res, stale } = look('990000001007'))
  ok(`the payment made TODAY (${DAYS.today}) → "bills out of date", confirm off`, stale && res.reason.includes('out of date'))

  let r
  ;({ res, r } = look('DEMOGPAY0001'))
  const job = res.candidates[0]
  ok('Suresh ₹11,650 "9044 service" → the parts+labour JOB first', job?.kind === 'job' && job?.member_count === 2, JSON.stringify(job?.label))
  ok('...found by the plate\'s last four', sig(job).includes('reg_last4'))
  eq('...and confirming pays each of the two bills in full',
     allocationTargets(job, byId, r.amount_paise).map((t) => [t.invoice_id, t.amount_paise]).sort(),
     [['LCS5756260009202', 320000], ['PCS5756260009201', 845000]])

  ;({ res, r } = look('DEMOGPAY0002'))
  eq('Ganga R ₹10,000 "5566" → the ₹25,000 credit bill, by plate', res.candidates[0]?.label, 'PCR6370260009401')
  eq('...and confirming places ₹10,000 — a part payment',
     allocationTargets(res.candidates[0], byId, r.amount_paise), [{ invoice_id: 'PCR6370260009401', amount_paise: 1000000 }])

  ;({ res } = look('DEMOGPAY0003'))
  ok('Ramesh ₹4,800 "Gj27dm 7715" → his bill, by the WHOLE plate',
     res.candidates[0]?.label === 'LCS5756260009501' && sig(res.candidates[0]).includes('reg_full'))

  ;({ res } = look('DEMOGPAY0004'))
  ok('a nameless ₹2,150 → still found, by its unique amount', res.candidates[0]?.label === 'MPI5756260009601')
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
  const bhavin = receipts.find((x) => x.external_txn_id === '990000001007')
  const savedTonight = Date.parse(`${DAYS.today}T18:00:00+05:30`)
  const cov2 = billCoverage(br2.parsed.invoices, savedTonight)
  ok('after report 2, today\'s 09:15 payment is no longer "out of date"',
     !feedIsStaleFor(bhavin, { covered_until: cov2 }), cov2)
  const savedAtNine = Date.parse(`${DAYS.today}T09:00:00+05:30`)
  ok('...but a report saved at 09:00 would NOT cover a 09:15 payment',
     feedIsStaleFor(bhavin, { covered_until: billCoverage(br2.parsed.invoices, savedAtNine) }))
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
