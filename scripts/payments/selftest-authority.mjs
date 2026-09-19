// scripts/payments/selftest-authority.mjs
// Who may do what in service payments — checked against EVERY department and
// rank, including the ones that must be refused.
//
// Why this exists: the Edge Function's first draft admitted every manager and GM
// in the company and let "any manager" void receipts, key cash, close TDS and
// declassify money. Staging has no Sales/HR/Back Office test account, so a live
// probe could never have shown it. This test needs no login, no network and no
// database: the rules are a pure function of (department, rank) in authority.ts.
//
// The EXPECTED table below is written out from the plan's authority ladder by
// hand. It deliberately does NOT call isAccounts/isGmPlus/inScope — a test that
// derives its expectations from the code under test can only ever agree with it.
//
// Run (the rules file is TypeScript, so bundle first — same as the other tests):
//   npx esbuild scripts/payments/selftest-authority.mjs --bundle --platform=node \
//     --format=esm --outfile=<tmp>/a.mjs && node <tmp>/a.mjs

import fs from 'node:fs'
import path from 'node:path'
import {
  ROLE_GATES, DENIED_MESSAGE, inScope,
  allocateModeAllowed, tdsOverCapAllowed, reverseAllowed,
} from '../../supabase/functions/service-payments/authority.ts'

let pass = 0, fail = 0
const failures = []
function check(label, got, want) {
  if (got === want) { pass++; return }
  fail++
  failures.push(`${label}: got ${got}, want ${want}`)
}

// Every department the portal has, plus the singleton admin in both shapes it
// takes (prod: no department; staging: filed under hr).
const DEPTS  = ['service', 'accounts', 'sales', 'spares', 'hr', 'back_office', 'pdi', null]
const LEVELS = ['executive', 'manager', 'gm']
const people = []
for (const d of DEPTS) for (const l of LEVELS) people.push({ dept: d, level: l })
people.push({ dept: null, level: 'admin' }, { dept: 'hr', level: 'admin' })

const caller = (p, id = 'me') => ({
  id, full_name: `${p.level}/${p.dept}`, permission_level: p.level,
  entity_id: 'ptb', department_code: p.dept, is_active: true,
})
const who = (p) => `${p.level}@${p.dept ?? '-'}`

// ── The plan's ladder, written out independently ───────────────────────────
const admin    = (p) => p.level === 'admin'
const inDept   = (p) => p.dept === 'service' || p.dept === 'accounts'
const accounts = (p) => admin(p) || p.dept === 'accounts'
const payGm    = (p) => admin(p) || (p.level === 'gm' && inDept(p))
const EXPECT = {
  allocate:              (p) => admin(p) || inDept(p),
  on_account:            accounts,
  reverse_allocation:    (p) => admin(p) || inDept(p),
  classify_receipt:      accounts,
  close_tds:             (p) => accounts(p) || payGm(p),
  manual_receipt:        accounts,
  void_receipt:          accounts,
  import_invoices:       accounts,
  import_receipts:       accounts,
  create_group:          payGm,
  assign_customer_group: payGm,
  set_credit_limit:      payGm,
}

// 1. The gate table covers exactly the actions the plan names.
check('ROLE_GATES has exactly the planned actions',
  JSON.stringify(Object.keys(ROLE_GATES).sort()), JSON.stringify(Object.keys(EXPECT).sort()))
for (const a of Object.keys(ROLE_GATES)) {
  check(`${a} has a refusal message`, typeof DENIED_MESSAGE[a] === 'string' && DENIED_MESSAGE[a].length > 0, true)
}

// 2. Entry gate, and every role gate, for every department × rank.
for (const p of people) {
  check(`inScope ${who(p)}`, inScope(caller(p)), admin(p) || inDept(p))
  for (const [a, want] of Object.entries(EXPECT)) {
    check(`${a} ${who(p)}`, ROLE_GATES[a](caller(p)), want(p))
  }
}

// 3. Data-dependent rules.
for (const p of people) {
  const c = caller(p)
  check(`allocate UPI ${who(p)}`, allocateModeAllowed(c, 'upi'), admin(p) || inDept(p))
  for (const mode of ['cash', 'cheque', 'netbanking', null]) {
    check(`allocate ${mode} ${who(p)}`, allocateModeAllowed(c, mode), accounts(p))
  }
  check(`TDS over 5% ${who(p)}`, tdsOverCapAllowed(c), payGm(p))
  for (const isMaker of [true, false]) for (const exported of [true, false]) {
    const want = !(admin(p) || inDept(p)) ? false
      : exported ? payGm(p)
      : (isMaker || accounts(p) || payGm(p))
    check(`reverse maker=${isMaker} exported=${exported} ${who(p)}`,
      reverseAllowed(c, { isMaker, exported }) === null, want)
  }
}

// 4. The exact people the first draft let in, named, so a regression reads plainly.
const named = [
  ['a Sales GM cannot set credit limits',        { dept: 'sales', level: 'gm' },          'set_credit_limit', false],
  ['a Back Office GM cannot create groups',      { dept: 'back_office', level: 'gm' },    'create_group',     false],
  ['a Sales manager cannot void a receipt',      { dept: 'sales', level: 'manager' },     'void_receipt',     false],
  ['an HR manager cannot even match',            { dept: 'hr', level: 'manager' },        'allocate',         false],
  ['a Service manager cannot void a receipt',    { dept: 'service', level: 'manager' },   'void_receipt',     false],
  ['a Service manager cannot key cash',          { dept: 'service', level: 'manager' },   'manual_receipt',   false],
  ['a Service manager cannot declassify money',  { dept: 'service', level: 'manager' },   'classify_receipt', false],
  ['a Service GM CAN set credit limits',         { dept: 'service', level: 'gm' },        'set_credit_limit', true],
  ['a Service GM CAN close TDS',                 { dept: 'service', level: 'gm' },        'close_tds',        true],
  ['a Service executive CAN match',              { dept: 'service', level: 'executive' }, 'allocate',         true],
  ['an Accounts executive CAN void a receipt',   { dept: 'accounts', level: 'executive' },'void_receipt',     true],
  ['the admin (no department) CAN import bills', { dept: null, level: 'admin' },          'import_invoices',  true],
]
for (const [label, p, a, want] of named) check(label, ROLE_GATES[a](caller(p)), want)
check('a Service executive cannot match a CASH receipt',
  allocateModeAllowed(caller({ dept: 'service', level: 'executive' }), 'cash'), false)
check('a Service executive can undo their OWN un-exported match',
  reverseAllowed(caller({ dept: 'service', level: 'executive' }), { isMaker: true, exported: false }), null)
check("a Service executive cannot undo someone else's match",
  reverseAllowed(caller({ dept: 'service', level: 'executive' }), { isMaker: false, exported: false }) !== null, true)
check('a Service manager cannot undo an EXPORTED match',
  reverseAllowed(caller({ dept: 'service', level: 'manager' }), { isMaker: true, exported: true }) !== null, true)

// 5. The function uses ONLY this table: every action it handles has a gate here,
//    and no per-action role check survives inline to drift from it.
const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/service-payments/index.ts'), 'utf8')
const cases = [...src.matchAll(/case "([a-z_]+)":/g)].map(m => m[1]).sort()
check('every action in index.ts has a gate', JSON.stringify(cases), JSON.stringify(Object.keys(ROLE_GATES).sort()))
check('index.ts consults ROLE_GATES before the switch', /ROLE_GATES\[action[^\]]*\][\s\S]*switch \(action\)/.test(src), true)
check('no inline isAccounts/isGmPlus checks remain in index.ts', /\bis(Accounts|GmPlus|ManagerPlus)\(/.test(src), false)

console.log(`selftest-authority: ${pass} passed, ${fail} failed  (${people.length} people × ${Object.keys(EXPECT).length} actions)`)
if (fail) { for (const f of failures.slice(0, 40)) console.log('  ✗ ' + f); process.exit(1) }
