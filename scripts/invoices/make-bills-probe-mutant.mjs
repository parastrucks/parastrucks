// The negative control for scripts/invoices/probe-bills-from-invoices.sql.
//
//   node scripts/invoices/make-bills-probe-mutant.mjs <out.sql>
//
// Writes a copy of the probe that first swaps in (inside its own rolled-back
// run) a payments_bills_from_gate_document that matches the customer code
// EXACTLY, as the PDF prints it — the natural first draft. The probe must FAIL
// on it; one that passes either way proves nothing.

import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2]
if (!out) { console.error('usage: node scripts/invoices/make-bills-probe-mutant.mjs <out.sql>'); process.exit(2) }
const root = process.cwd()
const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261030_payments_bills_from_invoices.sql'), 'utf8')
const start = mig.indexOf('CREATE OR REPLACE FUNCTION public.payments_bills_from_gate_document(')
const end = mig.indexOf('$fn$;', start) + '$fn$;'.length
if (start < 0 || end < start) throw new Error('function not found in the migration')
const exact = "AND ltrim(sap_customer_code, '0') = ltrim(d.sap_customer_code, '0')"
let fn = mig.slice(start, end)
if (!fn.includes(exact)) throw new Error('the zero-insensitive lookup was not found — update this mutant')
fn = fn.replace(exact, 'AND sap_customer_code = d.sap_customer_code')

const probe = fs.readFileSync(path.join(root, 'scripts/invoices/probe-bills-from-invoices.sql'), 'utf8')
if (!probe.includes('-- MUTANT-HOOK')) throw new Error('MUTANT-HOOK missing from the probe')
fs.writeFileSync(path.resolve(out), probe.replace('-- MUTANT-HOOK', `EXECUTE $mut$${fn}$mut$;`))
console.log('wrote', path.resolve(out))
