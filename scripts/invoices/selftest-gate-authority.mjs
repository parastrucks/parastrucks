// Self-test for supabase/functions/gate-invoices/authority.ts — every person × every action.
// The expectations below are written out BY HAND from the owner's decisions, never derived
// from the code (an expectation copied from the code tests nothing):
//   2026-10-24  upload / send / PDF / ask for release: service, accounts, spares + admin.
//   2026-10-26  approve / hold (+ the phone alerts that serve it): ONLY the Service GM of the
//               invoice's company, or the admin. Not a Sales GM, not a Back Office GM.
//   2026-10-26  the gate check: Security guards, and the admin.
// Bundle first (from the repo root):
//   npx --yes esbuild supabase/functions/gate-invoices/authority.ts --format=esm --outfile=<tmp>/auth.mjs
//   node scripts/invoices/selftest-gate-authority.mjs <tmp>/auth.mjs
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const A = await import(pathToFileURL(resolve(process.argv[2] ?? '')).href)
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name) } }

const PTB = 'ptb', PT = 'pt'
const P = (permission_level, department_code, entity_id = PTB) => ({ permission_level, department_code, entity_id })
//                                     U = upload/send/ask   D = decide (+ push)   G = gate check
const PEOPLE = {
  'admin':                 [{ permission_level: 'admin', department_code: null, entity_id: null }, 'UDG'],
  'service GM PTB':        [P('gm', 'service'),              'UD'],
  'service GM PT':         [P('gm', 'service', PT),          'UD'],
  'service manager':       [P('manager', 'service'),         'U'],
  'service executive':     [P('executive', 'service'),       'U'],
  'accounts manager':      [P('manager', 'accounts'),        'U'],
  'accounts GM':           [P('gm', 'accounts'),             'U'],
  'spares GM':             [P('gm', 'spares'),               'U'],
  'spares executive':      [P('executive', 'spares'),        'U'],
  'sales GM':              [P('gm', 'sales'),                ''],
  'sales executive':       [P('executive', 'sales'),         ''],
  'back office GM':        [P('gm', 'back_office'),          ''],
  'HR manager':            [P('manager', 'hr'),              ''],
  'PDI manager':           [P('manager', 'pdi'),             ''],
  'security guard':        [P('executive', 'security'),      'G'],
  'security guard PT':     [P('executive', 'security', PT),  'G'],
  'security "gm"':         [P('gm', 'security'),             'G'],
  'no department':         [P('executive', null),            ''],
  'no level, service':     [P(null, 'service'),              'U'],
  'admin-named dept':      [P('gm', 'admin'),                ''],
}
const ACTIONS = {
  saveDocument: 'U', sendEmail: 'U', pdfUrl: 'U', requestRelease: 'U', withdrawRelease: 'U',
  decideRelease: 'D', pushKey: 'D', pushSubscribe: 'D', pushUnsubscribe: 'D',
  gateCheck: 'G',
}

for (const [name, [who, may]] of Object.entries(PEOPLE)) {
  for (const [action, need] of Object.entries(ACTIONS)) {
    ok(A.mayDo(action, who) === may.includes(need), `${name} → ${action} should be ${may.includes(need) ? 'ALLOWED' : 'refused'}`)
  }
}
ok(Object.keys(A.ACTION_GATES).sort().join() === Object.keys(ACTIONS).sort().join(), 'every server action is in this table, and no other')

// Unknown and odd action names are refused for everyone, the admin included.
for (const bad of ['deleteAll', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', null, undefined, 42]) {
  ok(!A.mayDo(bad, PEOPLE.admin[0]), `unknown action ${String(bad)} refused`)
}

// The company rule for decisions: a Service GM decides only for their own company.
ok(A.mayDecideFor(PEOPLE['service GM PTB'][0], PTB), 'Service GM PTB decides a PTB release')
ok(!A.mayDecideFor(PEOPLE['service GM PTB'][0], PT), 'Service GM PTB may NOT decide a PT release')
ok(!A.mayDecideFor(PEOPLE['service GM PT'][0], PTB), 'Service GM PT may NOT decide a PTB release')
ok(A.mayDecideFor(PEOPLE.admin[0], PTB) && A.mayDecideFor(PEOPLE.admin[0], PT), 'the admin decides for both companies')
ok(!A.mayDecideFor(PEOPLE['service GM PTB'][0], null) && !A.mayDecideFor({ ...PEOPLE['service GM PTB'][0], entity_id: null }, null),
  'a release or a GM with no company is never "the same company"')
for (const n of ['service manager', 'accounts GM', 'sales GM', 'back office GM', 'security guard']) {
  ok(!A.mayDecideFor(PEOPLE[n][0], PTB), `${n} may not decide even in their own company`)
}
ok(A.RELEASE_HOURS === 48, 'an approval lasts 48 hours (owner, 2026-10-26)')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
