// The phone's bottom bar, department by department — checked without a browser.
//   node scripts/payments/selftest-bottom-nav.mjs
//
// Red team 4, R4-14: Match Payments was not in the service bottom bar and sat in
// the (+) sheet under "Create new", where a first-day user asked "does tapping
// it create a new payment?". Now service and accounts carry a Payments tab
// (shown only where the access rules allow /payments), and the sheet is "Quick
// actions". Expectations are written out by hand.

import { bottomNavLayout, DEPT_TABS, ADMIN_TABS, CREATE_ACTIONS } from '../../src/components/layout/navConfig.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)

const bar = (o) => {
  const { left, right } = bottomNavLayout({ hasCreate: true, isAdmin: false, canAccess: () => true, ...o })
  return [...left.map((t) => t.label), '+', ...right.map((t) => t.label)]
}
const may = (routes) => (to) => routes.includes(to)

console.log('\n── who sees which bar ─────────────────────────────────────')
eq('service: Payments one tap away, and Profile back (four tabs keep the + centred)',
   bar({ deptCode: 'service' }), ['Home', 'Payments', '+', 'Jobs', 'Profile'])
eq('accounts: the same', bar({ deptCode: 'accounts' }), ['Home', 'Payments', '+', 'Jobs', 'Profile'])
eq('a service person the access rules keep out of /payments: no Payments tab (and the + stays centred)',
   bar({ deptCode: 'service', canAccess: may(['/vendor-jobs']) }), ['Home', '+', 'Jobs'])
eq('sales: unchanged', bar({ deptCode: 'sales' }), ['Home', 'Quote', '+', 'History', 'Profile'])
eq('back office: unchanged', bar({ deptCode: 'back_office' }), ['Home', 'Quote', '+', 'TIV', 'Profile'])
eq('HR: unchanged', bar({ deptCode: 'hr' }), ['Home', '+', 'Employees'])
eq('admin: unchanged (Payments is in the + sheet and the drawer)', bar({ isAdmin: true }), ['Home', 'TIV', '+', 'Team', 'Profile'])
eq('an unknown department: Home and Profile', bar({ deptCode: 'xyz' }), ['Home', '+', 'Profile'])
eq('no + at all: every tab, nothing dropped',
   (() => { const { left, right } = bottomNavLayout({ deptCode: 'service', hasCreate: false, canAccess: () => true }); return [left.length, right.length] })(), [4, 0])

console.log('\n── the tab itself ─────────────────────────────────────────')
const t = DEPT_TABS.service.find((x) => x.to === '/payments')
ok('it goes to /payments, with the ₹ icon, and is gated by the access rules', t && t.icon === 'rupee' && t.gated === true)
ok('no bar ever has more than four tabs beside the + (five slots on a 360 px phone)',
   [...Object.values(DEPT_TABS), ADMIN_TABS].every((tabs) => tabs.length <= 4))
ok('no tab is gated anywhere it would vanish unasked (only Payments is gated)',
   [...Object.values(DEPT_TABS), ADMIN_TABS].flat().filter((x) => x.gated).every((x) => x.to === '/payments'))
ok('Match Payments is still in the + sheet (admins and everyone else reach it there)',
   CREATE_ACTIONS.some((a) => a.to === '/payments'))

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
