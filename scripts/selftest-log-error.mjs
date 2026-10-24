// Can a crash report get from the browser into error_log?
//
// The 2026-10-18 finding: the browser sent { action, payload: { message … } }
// (callEdge's envelope) and log-error read body.message — every report ever
// sent was refused with 400 "message required", silently. This test reads the
// CLIENT's own source for the shape it sends, then runs the function's reader
// on exactly that shape.
//
// Run (the reader is TypeScript; bundle it first):
//   npx --yes esbuild scripts/selftest-log-error.mjs --bundle --platform=node --format=esm --outfile=<tmp>/le.mjs
//   node <tmp>/le.mjs        (from the repo root — it reads src/lib/*.js)

import fs from 'node:fs'
import path from 'node:path'
import { readReport, extensionOrigin as serverExtensionOrigin } from '../supabase/functions/log-error/report.ts'
import { extensionOrigin, firstTodayFor } from '../src/lib/errorSource.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) } else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

console.log('── what the browser sends ──────────────────────────────────────')
const api = read('src/lib/api.js')
const logger = read('src/lib/errorLog.js')
ok('callEdge wraps every call as { action, payload }', /JSON\.stringify\(\{ action, payload \}\)/.test(api))
ok("errorLog sends through callEdge('log-error', 'write', { message, stack, url, context })",
   /callEdge\('log-error', 'write', \{\s*message:[\s\S]*stack:[\s\S]*url:[\s\S]*context,?\s*\}\)/.test(logger))

console.log('── what log-error reads ────────────────────────────────────────')
const sent = { action: 'write', payload: { message: 'TypeError: x is null', stack: 'at PaymentsPage', url: 'http://localhost:3000/payments', context: { component: 'ErrorBoundary' } } }
const r = readReport(JSON.parse(JSON.stringify(sent)))
ok('the browser\'s own envelope is read (it was refused: "message required")', r?.message === 'TypeError: x is null', JSON.stringify(r))
ok('...stack, page and context come through', r?.stack === 'at PaymentsPage' && r?.url === 'http://localhost:3000/payments' && r?.context?.component === 'ErrorBoundary')
const flat = readReport({ message: 'flat', stack: 's', url: 'u', context: { a: 1 } })
ok('a flat body still works', flat?.message === 'flat' && flat?.context?.a === 1)
ok('the envelope wins over a top-level field', readReport({ message: 'outer', payload: { message: 'inner' } })?.message === 'inner')

ok('no message: refused', readReport({ action: 'write', payload: { stack: 's' } }) === null)
ok('an empty message: refused', readReport({ action: 'write', payload: { message: '' } }) === null)
ok('not an object: refused', readReport('oops') === null && readReport(null) === null && readReport(42) === null)
ok('a non-object payload falls back to the top level', readReport({ payload: 'x', message: 'top' })?.message === 'top')

const long = readReport({ payload: { message: 'm'.repeat(2500), stack: 's'.repeat(9000), url: 'u'.repeat(600) } })
ok('message cut at 2,000, stack at 8,000, page at 500',
   long?.message.length === 2000 && long?.stack.length === 8000 && long?.url.length === 500)
ok('a missing stack and page are null, not "undefined"', (() => { const x = readReport({ payload: { message: 'm' } }); return !!x && x.stack === null && x.url === null && x.context === null })())
ok('a context that is an array or a string is dropped', readReport({ payload: { message: 'm', context: [1, 2] } })?.context === null &&
   readReport({ payload: { message: 'm', context: 'str' } })?.context === null)
ok('a non-string message is kept as text', readReport({ payload: { message: 404 } })?.message === '404')

console.log('── a browser extension\'s own crash (2026-10-22) ──────────────')
// The real prod stack: one user's Urban VPN Proxy, 8,270 rows in three days.
const URBAN = 'chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon'
const cases = [
  ['the real Urban VPN stack', `TypeError: Cannot read properties of undefined (reading 'M_ID')\n    at Y (${URBAN}/executors/200.js:1:761)\n    at E (${URBAN}/executors/200.js:1:1442)`, undefined, URBAN],
  ['our own crash (the 3 real prod rows)', 'Error: Lock "lock:sb-session" was released because another request stole it\n    at ti.lr [as lock] (https://team.parastrucks.in/assets/supabase-CVzXRRm2.js:21:19397)\n    at async ti._acquireLock (https://team.parastrucks.in/assets/supabase-CVzXRRm2.js:24:6793)', undefined, null],
  ['an extension calling INTO our code is ours', `TypeError: x\n    at Y (${URBAN}/executors/200.js:1:761)\n    at f (https://team.parastrucks.in/assets/index-abc.js:1:1)`, undefined, null],
  ['our code calling an extension is ours', `TypeError: x\n    at f (https://team.parastrucks.in/assets/index-abc.js:1:1)\n    at Y (${URBAN}/x.js:1:1)`, undefined, null],
  ['Firefox extension', 'e@moz-extension://1b2c3d4e-0000-4000-8000-000000000000/content.js:3:9', undefined, 'moz-extension://1b2c3d4e-0000-4000-8000-000000000000'],
  ['Safari extension', 'f@safari-web-extension://ABCDEF/script.js:1:2', undefined, 'safari-web-extension://ABCDEF'],
  ['no stack, error came from an extension file', '', `${URBAN}/executors/200.js`, URBAN],
  ['no stack, error came from our file', '', 'https://team.parastrucks.in/assets/index-abc.js', null],
  ['a stack with no URL at all (cannot tell) is reported', 'Error: x\n    at <anonymous>', undefined, null],
  ['nothing at all is reported', undefined, undefined, null],
  ['local dev frames are ours', 'Error: x\n    at f (http://localhost:3000/src/main.jsx:1:1)', undefined, null],
]
for (const [name, stack, file, want] of cases) {
  const c = extensionOrigin(stack, file), s = serverExtensionOrigin(stack, file)
  ok(`${name}: ${want ?? 'ours'}`, c === want && s === want, `browser ${c} · server ${s}`)
}

let store = {}
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) } }
ok('the first one today is sent', firstTodayFor(URBAN) === true)
const repeats = [firstTodayFor(URBAN), firstTodayFor(URBAN)]
ok('...the next ones today are not', repeats.every(sent => sent === false))
ok('a different extension is sent once too', firstTodayFor('chrome-extension://other') === true && firstTodayFor('chrome-extension://other') === false)
store[`errlog-ext:${URBAN}`] = '2000-01-01'
ok('a new day sends it again', firstTodayFor(URBAN) === true)
globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
ok('no storage: once per page load, never a flood', firstTodayFor('chrome-extension://nostore') === true && firstTodayFor('chrome-extension://nostore') === false)

// The gate must come BEFORE callEdge — callEdge calls getSession(), and that is
// what a flood turns into session-lock errors.
const gate = logger.indexOf('extensionOrigin('), send = logger.indexOf("callEdge('log-error'")
ok('errorLog checks the source before calling callEdge', gate > 0 && send > gate)
ok('errorLog returns early for a repeat and labels the first', /if \(!firstTodayFor\(ext\)\) return/.test(logger) && /source: 'extension', extension: ext/.test(logger))
const ef = read('supabase/functions/log-error/index.ts')
ok('log-error skips a repeat within 24 h and labels the first',
   /extensionOrigin\(report\.stack/.test(ef) && /\.like\("stack", `%\$\{ext\}\/%`\)/.test(ef) && /source: "extension", extension: ext/.test(ef))

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
