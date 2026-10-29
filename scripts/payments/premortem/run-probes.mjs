// Pre-mortem Track A, step 2: run the repo's own self-aborting probes against
// the rehearsal database (snapshot + seven migrations), plus the
// post-migration checks.
//
//   node scripts/payments/premortem/run-probes.mjs
//
// Each probe ends by RAISING "PROBE COMPLETE — N passed, M failed" and rolls
// itself back; that exception is parsed, not hidden. NOTICEs are collected.

import fs from 'node:fs'
import path from 'node:path'
import { openRehearsalDb, postMigrationChecks } from './rehearse-db.mjs'
import { splitSql } from './sql-split.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const PROBES = ['probe-allocation.sql', 'probe-import-parity.sql', 'probe-awaiting-invoice.sql', 'probe-read-gates.sql']

const { db, applied } = await openRehearsalDb({ quiet: true })
const bad = applied.filter((a) => a.errors.length)
console.log(`rehearsal db ready: ${applied.length} migrations, ${bad.length} with errors`)
for (const a of bad) for (const e of a.errors) console.log(`  ✗ ${a.file}: ${e.error}`)

console.log('\n── post-migration checks ──')
const checks = await postMigrationChecks(db)
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` (got ${c.got}, want ${c.want})`}`)

const results = []
for (const name of PROBES) {
  const sql = fs.readFileSync(path.join(REPO, 'scripts/payments', name), 'utf8')
  const notices = []
  let outcome = ''
  // Each probe is one transaction in spirit; the DO block rolls back by raising.
  // pg_temp helper functions before it must persist within the session.
  for (const stmt of splitSql(sql)) {
    try {
      await db.query(stmt, [], { onNotice: (n) => notices.push(n.message ?? String(n)) })
    } catch (e) {
      const msg = e.message ?? String(e)
      if (/PROBE COMPLETE|REFUSED/.test(msg)) { outcome = msg.split('\n').slice(0, 3).join(' '); break }
      outcome = 'ERROR before completion: ' + msg.split('\n')[0]; break
    }
  }
  results.push({ name, outcome, notices })
  console.log(`\n── ${name} ──\n  ${outcome || 'ran to the end without raising (unexpected)'}`)
  const fails = notices.filter((n) => /^FAIL/.test(n))
  for (const f of fails) console.log(`  ${f}`)
}
// Prove the rollback: nothing ZZ remains.
const left = await db.query(`select (select count(*) from public.service_invoices where invoice_number like 'ZZPROBE%') + (select count(*) from public.payment_receipts where payer_name like 'ZZ %') + (select count(*) from public.customers where sap_customer_code like 'ZZ%') as n`)
console.log(`\nresidue after probes (must be 0): ${left.rows[0].n}`)
await db.close()
