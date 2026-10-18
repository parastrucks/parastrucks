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
import { readReport } from '../supabase/functions/log-error/report.ts'

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

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
