// Generates scripts/payments/probe-import-parity.sql.
//
//   node scripts/payments/gen-probe-import-parity.mjs
//
// WHY A GENERATOR. The Import screen shows a preview of what an import will do
// (src/service-payments/lib/importPlan.js), and the server then does it
// (payments_import_invoices / payments_import_receipts). If the two disagree,
// the preview is a lie told at the moment someone decides to commit. So ONE
// scenario is written here, the screen's own diff functions predict every
// count, and the predictions are baked into a SQL probe that plays the same
// scenario through the real RPCs on staging and fails on any difference.
//
// The probe writes nothing that survives: it ends by raising "PROBE COMPLETE",
// which rolls everything back. Run it through MCP apply_migration (execute_sql
// is read-only) or paste it into the staging SQL editor.

import fs from 'node:fs'
import path from 'node:path'
import { diffInvoices, diffReceipts } from '../../src/service-payments/lib/importPlan.js'

// ── The scenario ─────────────────────────────────────────────────────────
const inv = (n, code, total, extra = {}) => ({
  invoice_number: `ZZPROBE-${n}`, sap_customer_code: `ZZC${code}`, customer_name: `ZZ PROBE ${code}`,
  invoice_kind: 'counter_sale', invoice_date: '2026-09-20', payment_terms: 'cash',
  net_paise: total, tax_paise: 0, total_paise: total, status: 'active', cancelled_flag: null, ...extra,
})
const firstImport = [inv('A', 1, 100000), inv('B', 1, 200000), inv('C', 2, 300000),
  inv('D', 2, 400000), inv('E', 3, 500000)]
// Money then matched: all of C, 1,500 of D.
const allocated = { 'ZZPROBE-C': 300000, 'ZZPROBE-D': 150000 }
const secondImport = [
  inv('A', 1, 100000),                                            // unchanged
  inv('B', 1, 250000),                                            // amended (total)
  inv('C', 2, 300000, { status: 'cancelled', cancelled_flag: 'X' }), // conflict: cancelled under money
  inv('D', 2, 100000),                                            // conflict: below what is paid
  inv('E', 4, 500000),                                            // conflict: customer changed
  inv('F', 1, 700000),                                            // new
]
const stored = firstImport.map((v) => ({
  invoice_number: v.invoice_number, sap_customer_code: v.sap_customer_code, customer_name: v.customer_name,
  total_paise: v.total_paise, allocated_paise: allocated[v.invoice_number] ?? 0,
  status: v.status, cancelled_flag: v.cancelled_flag,
}))
const pInv1 = diffInvoices(firstImport, [])
const pInv2 = diffInvoices(secondImport, stored)

const rc = (source, txn, amount, utr = null) => ({
  source, mode: 'upi', external_txn_id: txn, normalized_utr: utr, amount_paise: amount,
  gross_paise: amount, fee_paise: 0, received_at: '2026-09-20T05:00:00Z', payer_name: 'ZZ PROBE PAYER',
  payer_remark: source === 'gpay' ? 'ZZ note' : null,
})
// Hand-keyed during a "parser outage" — the manual RPC stores source 'manual'.
const manual = [
  { key: 'M1', txn: '990000000001', utr: '990000000001', amount: 11000 },  // BharatPe, UTR typed in
  { key: 'M2', txn: 'ZZPROBE-GPAY-1', utr: null, amount: 22000 },          // Google Pay
  { key: 'M3', txn: 'ZZPROBE-OTHER', utr: '990000000009', amount: 33000 }, // a UTR under another id
]
const setupRow = rc('bharatpe', '990000000003', 44000, '990000000003')    // imported earlier
const bharatpe1 = [rc('bharatpe', '990000000001', 11000, '990000000001'),
  rc('bharatpe', '990000000003', 44000, '990000000003'),
  rc('bharatpe', '990000000004', 55000, '990000000004'),
  rc('bharatpe', '990000000009', 66000, '990000000009')]
const gpay1 = [rc('gpay', 'ZZPROBE-GPAY-1', 22000), rc('gpay', 'ZZPROBE-GPAY-2', 77000)]

const m = (x, batch = null) => ({ source: 'manual', external_txn_id: x.txn, normalized_utr: x.utr,
  import_batch_id: batch, status: 'active' })
const setupStored = { source: 'bharatpe', external_txn_id: '990000000003', normalized_utr: '990000000003',
  import_batch_id: 'setup', status: 'active' }
const beforeB1 = [...manual.map((x) => m(x)), setupStored]
const pB1 = diffReceipts(bharatpe1, beforeB1, beforeB1)
// After bharatpe1: M1 linked, 004 imported, the 009 row held (not stored).
const afterB1 = [m(manual[0], 'b1'), m(manual[1]), m(manual[2]), setupStored,
  { source: 'bharatpe', external_txn_id: '990000000004', normalized_utr: '990000000004', import_batch_id: 'b1', status: 'active' }]
const pG1 = diffReceipts(gpay1, afterB1, afterB1)
const afterG1 = [...afterB1.map((e) => e.external_txn_id === 'ZZPROBE-GPAY-1' ? { ...e, import_batch_id: 'g1' } : e),
  { source: 'gpay', external_txn_id: 'ZZPROBE-GPAY-2', normalized_utr: null, import_batch_id: 'g1', status: 'active' }]
const pB2 = diffReceipts(bharatpe1, afterG1, afterG1)   // the same BharatPe rows, a second time

const counts = (d) => ({ new: d.new.length, already: d.already.length, linked: d.linkManual.length, held: d.held.length })
const pred = {
  inv1: { new: pInv1.new.length, amended: pInv1.amended.length, unchanged: pInv1.unchanged.length, conflicts: pInv1.conflict.length },
  inv2: { new: pInv2.new.length, amended: pInv2.amended.length, unchanged: pInv2.unchanged.length, conflicts: pInv2.conflict.length },
  b1: counts(pB1), g1: counts(pG1), b2: counts(pB2),
}

// ── SQL ──────────────────────────────────────────────────────────────────
const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`
const cmpInv = (label, v, p) => `
  PERFORM pg_temp.zz_check('${label} new', (${v}->>'new')::int, ${p.new});
  PERFORM pg_temp.zz_check('${label} amended', (${v}->>'amended')::int, ${p.amended});
  PERFORM pg_temp.zz_check('${label} unchanged', (${v}->>'unchanged')::int, ${p.unchanged});
  PERFORM pg_temp.zz_check('${label} conflicts', jsonb_array_length(${v}->'conflicts'), ${p.conflicts});`
const cmpRc = (label, v, p) => `
  PERFORM pg_temp.zz_check('${label} new', (${v}->>'new')::int, ${p.new});
  PERFORM pg_temp.zz_check('${label} already present', (${v}->>'already_present')::int, ${p.already});
  PERFORM pg_temp.zz_check('${label} linked to hand entry', (${v}->>'already_present_manual')::int, ${p.linked});
  PERFORM pg_temp.zz_check('${label} held', coalesce(jsonb_array_length(${v}->'held'), 0), ${p.held});`
const call = (label, fn, rows) => `
  BEGIN
    v_res := public.${fn}(v_entity, ${j(rows)}, '{"source":"probe","parser_version":"probe"}'::jsonb, v_actor);
  EXCEPTION WHEN others THEN
    v_res := jsonb_build_object('error', SQLERRM);
    PERFORM pg_temp.zz_fail('${label} THREW: ' || SQLERRM);
  END;`

const sql = `-- ============================================================================
-- GENERATED by scripts/payments/gen-probe-import-parity.mjs — edit that, not this.
--
-- Service Payments — does the Import screen's PREVIEW tell the truth?
--
-- One scenario, two judges. The screen's own diff functions (importPlan.js)
-- predicted every count below when this file was generated; this probe plays
-- the same scenario through the REAL import RPCs and fails on any difference.
-- It also checks the invariants no count can hide: no payment stored twice,
-- a hand-keyed amount never touched, a cancelled bill never left holding money.
--
-- WRITES NOTHING: the last statement raises "PROBE COMPLETE", rolling back.
-- Run through MCP apply_migration (execute_sql is read-only) or the SQL editor.
-- Staging first. It creates only ZZPROBE rows and touches no existing row.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.zz_fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.fails', current_setting('zz.fails', true) || ' | ' || msg, true);
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.zz_check(label text, got int, want int) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.checks', (coalesce(nullif(current_setting('zz.checks', true), ''), '0')::int + 1)::text, true);
  IF got IS DISTINCT FROM want THEN
    PERFORM pg_temp.zz_fail(label || ': server ' || coalesce(got::text, 'null') || ', preview ' || want);
  END IF;
END $f$;

DO $probe$
DECLARE
  v_entity uuid;
  v_actor  uuid;
  v_res    jsonb;
  v_rcpt   uuid;
  v_c      uuid;
  v_d      uuid;
  v_n      bigint;
  v_fails  text;
BEGIN
  PERFORM set_config('zz.fails', '', true);
  PERFORM set_config('zz.checks', '0', true);
  SELECT id INTO v_entity FROM public.entities WHERE code = 'PTB';
  SELECT id INTO v_actor FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_entity IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'need the PTB entity and an admin'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_invoices WHERE invoice_number LIKE 'ZZPROBE-%')
  OR EXISTS (SELECT 1 FROM public.payment_receipts WHERE payer_name = 'ZZ PROBE PAYER') THEN
    RAISE EXCEPTION 'ZZPROBE rows already exist — refusing to run over them';
  END IF;

  -- ══ BILLS ═════════════════════════════════════════════════════════════
  ${call('bills #1', 'payments_import_invoices', firstImport)}
  ${cmpInv('bills #1', 'v_res', pred.inv1)}

  -- Match money: all of C, 1,500 of D (paise ${allocated['ZZPROBE-C']} / ${allocated['ZZPROBE-D']}).
  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name, classification)
  VALUES (v_entity, 'cash', 'manual', ${allocated['ZZPROBE-C'] + allocated['ZZPROBE-D']}, now(), 'ZZ PROBE PAYER', 'service')
  RETURNING id INTO v_rcpt;
  SELECT id INTO v_c FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number = 'ZZPROBE-C';
  SELECT id INTO v_d FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number = 'ZZPROBE-D';
  PERFORM public.payments_allocate(v_entity, v_rcpt,
    jsonb_build_array(jsonb_build_object('invoice_id', v_c, 'amount_paise', ${allocated['ZZPROBE-C']}),
                      jsonb_build_object('invoice_id', v_d, 'amount_paise', ${allocated['ZZPROBE-D']})),
    v_actor, NULL, 'probe');

  ${call('bills #2', 'payments_import_invoices', secondImport)}
  ${cmpInv('bills #2', 'v_res', pred.inv2)}

  -- Invariant: a bill with money matched to it is never left cancelled.
  SELECT count(*) INTO v_n FROM public.service_invoices
   WHERE entity_id = v_entity AND invoice_number LIKE 'ZZPROBE-%'
     AND status <> 'active' AND allocated_paise > 0;
  PERFORM pg_temp.zz_check('bills: none left non-active while holding money', v_n::int, 0);

  -- ══ PAYMENTS ══════════════════════════════════════════════════════════
  -- Hand-keyed first, the way a parser outage would leave them.
${manual.map((x) => `  PERFORM public.payments_manual_receipt(v_entity, jsonb_build_object(
    'mode','upi','amount_paise',${x.amount},'external_txn_id','${x.txn}',
    'normalized_utr',${x.utr ? `'${x.utr}'` : 'NULL'},'payer_name','ZZ PROBE PAYER',
    'received_at','2026-09-20T05:00:00Z'), v_actor);`).join('\n')}
  ${call('payments setup', 'payments_import_receipts', [setupRow])}

  ${call('BharatPe #1', 'payments_import_receipts', bharatpe1)}
  ${cmpRc('BharatPe #1', 'v_res', pred.b1)}
  ${call('Google Pay #1', 'payments_import_receipts', gpay1)}
  ${cmpRc('Google Pay #1', 'v_res', pred.g1)}
  ${call('BharatPe again', 'payments_import_receipts', bharatpe1)}
  ${cmpRc('BharatPe again', 'v_res', pred.b2)}

  -- Invariants no count can hide.
  SELECT count(*) INTO v_n FROM (
    SELECT external_txn_id FROM public.payment_receipts
     WHERE entity_id = v_entity AND status = 'active' AND payer_name = 'ZZ PROBE PAYER'
       AND external_txn_id IS NOT NULL
     GROUP BY external_txn_id HAVING count(*) > 1) d;
  PERFORM pg_temp.zz_check('payments: no transaction id stored twice', v_n::int, 0);
  SELECT count(*) INTO v_n FROM (
    SELECT normalized_utr FROM public.payment_receipts
     WHERE entity_id = v_entity AND status = 'active' AND payer_name = 'ZZ PROBE PAYER'
       AND normalized_utr IS NOT NULL
     GROUP BY normalized_utr HAVING count(*) > 1) d;
  PERFORM pg_temp.zz_check('payments: no UTR stored twice', v_n::int, 0);
${manual.map((x) => `  SELECT amount_paise INTO v_n FROM public.payment_receipts
   WHERE entity_id = v_entity AND source = 'manual' AND external_txn_id = '${x.txn}';
  PERFORM pg_temp.zz_check('payments: hand-keyed ${x.key} amount untouched', v_n::int, ${x.amount});`).join('\n')}
  SELECT count(*) INTO v_n FROM public.payment_receipts
   WHERE entity_id = v_entity AND source = 'manual' AND payer_name = 'ZZ PROBE PAYER'
     AND mode = 'upi' AND import_batch_id IS NOT NULL;
  PERFORM pg_temp.zz_check('payments: the two matching hand entries are now linked to a file', v_n::int, 2);

  v_fails := current_setting('zz.fails', true);
  RAISE EXCEPTION 'PROBE COMPLETE — % checks, % failed. Nothing was written; this rollback is deliberate.%',
    current_setting('zz.checks', true),
    CASE WHEN v_fails = '' THEN 0 ELSE array_length(string_to_array(ltrim(v_fails, ' |'), ' | '), 1) END,
    CASE WHEN v_fails = '' THEN '' ELSE E'\\nFAILURES' || v_fails END;
END
$probe$;
`

const out = path.join(process.cwd(), 'scripts/payments/probe-import-parity.sql')
fs.writeFileSync(out, sql)
console.log('predictions', JSON.stringify(pred))
console.log('wrote', out)
