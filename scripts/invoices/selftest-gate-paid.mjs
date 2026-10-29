// Self-test for supabase/functions/gate-invoices/paid.ts — is a released invoice paid?
// Expectations are written out BY HAND from the rules (owner 2026-10-29: paid comes only from
// matching; the payments schema's bill statuses), never derived from the code.
// Bundle first (from the repo root):
//   npx --yes esbuild supabase/functions/gate-invoices/paid.ts --format=esm --outfile=<tmp>/paid.mjs
//   node scripts/invoices/selftest-gate-paid.mjs <tmp>/paid.mjs

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.argv[2]) { console.error('usage: node scripts/invoices/selftest-gate-paid.mjs <bundled paid.mjs>'); process.exit(2) }
const mod = await import(pathToFileURL(resolve(process.argv[2])).href)
const { paidState, promiseBroken, istToday, followUpOrder } = mod

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)

// A workshop job: labour ₹7,080 + parts ₹33,585.
const L = { bill_no: 'LCR5756269900001', amount_paise: 708000 }
const P = { bill_no: 'PCR5756269900001', amount_paise: 3358500 }
const sap = (b, over = {}) => ({ invoice_number: b.bill_no, status: 'active', total_paise: b.amount_paise, allocated_paise: 0, ...over })
const st = (bills, rows) => paidState(bills, rows)

console.log('\n── paid / part / unpaid ──────────────────────────────────')
eq('nothing matched yet → unpaid, all of it due', (({ state, due_paise, paid_paise }) => ({ state, due_paise, paid_paise }))(st([L, P], [sap(L), sap(P)])),
   { state: 'unpaid', due_paise: 4066500, paid_paise: 0 })
eq('both bills matched in full → paid, nothing due', (({ state, due_paise }) => ({ state, due_paise }))(st([L, P], [sap(L, { allocated_paise: 708000 }), sap(P, { allocated_paise: 3358500 })])),
   { state: 'paid', due_paise: 0 })
eq('labour paid, parts not → part paid, the parts due', (({ state, due_paise, paid_paise }) => ({ state, due_paise, paid_paise }))(st([L, P], [sap(L, { allocated_paise: 708000 }), sap(P)])),
   { state: 'part', due_paise: 3358500, paid_paise: 708000 })
eq('a part payment on one bill → part paid', st([P], [sap(P, { allocated_paise: 1000000 })]).state, 'part')
eq('₹1 short is NOT paid', st([L], [sap(L, { allocated_paise: 707900 })]).state, 'part')
eq('a counter sale (one bill) paid → paid', st([{ bill_no: 'MCI5756269900001', amount_paise: 3140000 }],
   [{ invoice_number: 'MCI5756269900001', status: 'active', total_paise: 3140000, allocated_paise: 3140000 }]).state, 'paid')

console.log('\n── what owes nothing ─────────────────────────────────────')
eq('SAP cancelled the bill → owes nothing (paid if it was the only one)', st([L], [sap(L, { status: 'cancelled' })]).state, 'paid')
eq('free of cost (not_payable) → owes nothing', st([L, P], [sap(L, { status: 'not_payable' }), sap(P, { allocated_paise: 3358500 })]).state, 'paid')
eq('cancelled labour + unpaid parts → unpaid, only the parts due', (({ state, due_paise }) => ({ state, due_paise }))(st([L, P], [sap(L, { status: 'cancelled' }), sap(P)])),
   { state: 'unpaid', due_paise: 3358500 })

console.log('\n── cannot tell — never shown as paid or unpaid ───────────')
const nl = st([L, P], [sap(P)])
eq('a bill the Billing Report has not brought in → cannot tell', nl.state, 'unknown')
eq('…and says which bill and why', nl.unknown, [{ bill_no: L.bill_no, why: 'not_loaded' }])
eq('…but still reports what is known to be due on the others', nl.due_paise, 3358500)
eq('nothing loaded at all → cannot tell (not "unpaid")', st([L, P], []).state, 'unknown')
eq('a fully paid bill + a missing one → cannot tell (not "paid")', st([L, P], [sap(P, { allocated_paise: 3358500 })]).state, 'unknown')
eq('before matching began (pre_opening) → cannot tell', st([L], [sap(L, { status: 'pre_opening' })]).unknown, [{ bill_no: L.bill_no, why: 'before_matching' }])
eq('parked → cannot tell', st([L], [sap(L, { status: 'parked' })]).unknown, [{ bill_no: L.bill_no, why: 'parked' }])
eq('a status nobody knows → cannot tell (never guessed)', st([L], [sap(L, { status: 'something_new' })]).state, 'unknown')
eq('no bills at all on the upload → nothing owed (an empty list is paid)', st([], []).state, 'paid')

console.log('\n── the PDF and the Billing Report disagree ───────────────')
const diff = st([L], [sap(L, { total_paise: 708100 })])
eq('the bill is named', diff.amount_differs, [L.bill_no])
eq('…and what is due follows the Billing Report (what the matching works against)', diff.due_paise, 708100)
eq('equal totals are not flagged', st([L], [sap(L)]).amount_differs, [])
eq('a matched amount above the total is capped (never more paid than billed)', st([L], [sap(L, { allocated_paise: 999999 })]).paid_paise, 708000)

console.log('\n── promises and the day in India ─────────────────────────')
ok('promised yesterday, unpaid → broken', promiseBroken('2026-10-28', 'unpaid', '2026-10-29'))
ok('promised yesterday, part paid → broken', promiseBroken('2026-10-28', 'part', '2026-10-29'))
ok('promised yesterday, cannot tell → broken (it is not known to be paid)', promiseBroken('2026-10-28', 'unknown', '2026-10-29'))
ok('promised TODAY → not broken yet (the day is not over)', !promiseBroken('2026-10-29', 'unpaid', '2026-10-29'))
ok('promised yesterday but paid → not broken', !promiseBroken('2026-10-28', 'paid', '2026-10-29'))
ok('no promise → never broken', !promiseBroken(null, 'unpaid', '2026-10-29'))
eq('00:30 in India on the 29th is still the 28th in UTC — today is the 29th', istToday(new Date('2026-10-28T19:00:00Z')), '2026-10-29')
eq('23:59 in India on the 29th', istToday(new Date('2026-10-29T18:29:00Z')), '2026-10-29')
eq('00:00 in India on the 30th', istToday(new Date('2026-10-29T18:30:00Z')), '2026-10-30')

console.log('\n── the Follow-up order ───────────────────────────────────')
const P0 = { state: 'paid' }, U = { state: 'unpaid' }, K = { state: 'unknown' }
const rows = [
  { document_id: 'no-promise-new', promised_by: null, released_at: '2026-10-27T10:00:00Z', paid: U },
  { document_id: 'paid', promised_by: '2026-10-20', released_at: '2026-10-19T10:00:00Z', paid: P0 },
  { document_id: 'promise-soon', promised_by: '2026-11-02', released_at: '2026-10-28T10:00:00Z', paid: U },
  { document_id: 'broken-recent', promised_by: '2026-10-27', released_at: '2026-10-25T10:00:00Z', paid: U },
  { document_id: 'no-promise-old', promised_by: null, released_at: '2026-10-20T10:00:00Z', paid: K },
  { document_id: 'promise-later', promised_by: '2026-11-10', released_at: '2026-10-26T10:00:00Z', paid: U },
  { document_id: 'broken-old', promised_by: '2026-10-22', released_at: '2026-10-21T10:00:00Z', paid: U },
  { document_id: 'promise-today', promised_by: '2026-10-29', released_at: '2026-10-28T09:00:00Z', paid: U },
]
eq('broken (oldest first) · promised (soonest first, today included) · no promise (oldest first) · paid left out',
   followUpOrder(rows, '2026-10-29').map((r) => r.document_id),
   ['broken-old', 'broken-recent', 'promise-today', 'promise-soon', 'promise-later', 'no-promise-old', 'no-promise-new'])
eq('it does not change the list it was given', rows.length, 8)

console.log(`\n${'═'.repeat(64)}\n${fail ? 'FAILURES' : 'ALL PASS'}   ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
