-- ============================================================================
-- Service Payments — does "Bill not raised yet" do exactly what it says?
--   payments_set_awaiting_invoice (20261012_payments_awaiting_invoice.sql)
--
-- WRITES NOTHING: the last statement raises "PROBE COMPLETE", rolling back.
-- A green run ENDS IN AN ERROR whose text reads "PROBE COMPLETE … 0 failed".
-- Run through MCP apply_migration (execute_sql is read-only) or the SQL editor.
-- It creates only ZZPROBE rows and touches no existing row.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.zz_check(label text, ok boolean, got text DEFAULT '') RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.checks', (coalesce(nullif(current_setting('zz.checks', true), ''), '0')::int + 1)::text, true);
  IF ok IS NOT TRUE THEN
    PERFORM set_config('zz.fails', current_setting('zz.fails', true) || ' | ' || label || ' (' || coalesce(got, 'null') || ')', true);
  END IF;
END $f$;

-- Run a call that MUST be refused; pass when it raises and the message matches.
CREATE OR REPLACE FUNCTION pg_temp.zz_refused(label text, sql text, want text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE sql;
    PERFORM pg_temp.zz_check(label, false, 'was NOT refused');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zz_check(label, SQLERRM ILIKE '%' || want || '%', SQLERRM);
  END;
END $f$;

DO $probe$
DECLARE
  v_e      uuid;
  v_other  uuid;
  v_a      uuid;
  v_open   uuid;   -- ₹1,000 unmatched
  v_part   uuid;   -- ₹1,000 with ₹400 matched
  v_full   uuid;   -- ₹500 fully matched
  v_void   uuid;
  v_notsvc uuid;
  v_inv    uuid;
  v_inv2   uuid;
  v_inv3   uuid;
  v_res    jsonb;
  v_n      bigint;
  v_flag   boolean;
BEGIN
  PERFORM set_config('zz.fails', '', true);
  PERFORM set_config('zz.checks', '0', true);
  SELECT id INTO v_e FROM public.entities WHERE code = 'PTB';
  SELECT id INTO v_other FROM public.entities WHERE code <> 'PTB' LIMIT 1;
  SELECT id INTO v_a FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_e IS NULL OR v_a IS NULL THEN RAISE EXCEPTION 'need the PTB entity and an admin'; END IF;

  -- Four bills: three to match against (the third for case 6), one left open (case 9).
  PERFORM public.payments_import_invoices(v_e,
    '[{"invoice_number":"ZZPROBE-AW1","sap_customer_code":"ZZAW1","customer_name":"ZZ PROBE AW","invoice_kind":"counter_sale","invoice_date":"2026-10-12","payment_terms":"cash","net_paise":40000,"tax_paise":0,"total_paise":40000,"status":"active","cancelled_flag":null},
      {"invoice_number":"ZZPROBE-AW2","sap_customer_code":"ZZAW1","customer_name":"ZZ PROBE AW","invoice_kind":"counter_sale","invoice_date":"2026-10-12","payment_terms":"cash","net_paise":50000,"tax_paise":0,"total_paise":50000,"status":"active","cancelled_flag":null},
      {"invoice_number":"ZZPROBE-AW3","sap_customer_code":"ZZAW1","customer_name":"ZZ PROBE AW","invoice_kind":"counter_sale","invoice_date":"2026-10-12","payment_terms":"cash","net_paise":30000,"tax_paise":0,"total_paise":30000,"status":"active","cancelled_flag":null},
      {"invoice_number":"ZZPROBE-AW4","sap_customer_code":"ZZAW1","customer_name":"ZZ PROBE AW","invoice_kind":"counter_sale","invoice_date":"2026-10-12","payment_terms":"cash","net_paise":20000,"tax_paise":0,"total_paise":20000,"status":"active","cancelled_flag":null}]'::jsonb,
    '{"source":"probe","parser_version":"probe"}'::jsonb, v_a);
  SELECT id INTO v_inv  FROM public.service_invoices WHERE entity_id = v_e AND invoice_number = 'ZZPROBE-AW1';
  SELECT id INTO v_inv2 FROM public.service_invoices WHERE entity_id = v_e AND invoice_number = 'ZZPROBE-AW2';
  SELECT id INTO v_inv3 FROM public.service_invoices WHERE entity_id = v_e AND invoice_number = 'ZZPROBE-AW3';

  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name)
  VALUES (v_e, 'upi', 'manual', 100000, now(), 'ZZ PROBE OPEN') RETURNING id INTO v_open;
  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name)
  VALUES (v_e, 'upi', 'manual', 100000, now(), 'ZZ PROBE PART') RETURNING id INTO v_part;
  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name)
  VALUES (v_e, 'upi', 'manual', 50000, now(), 'ZZ PROBE FULL') RETURNING id INTO v_full;
  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name)
  VALUES (v_e, 'upi', 'manual', 70000, now(), 'ZZ PROBE VOID') RETURNING id INTO v_void;
  INSERT INTO public.payment_receipts (entity_id, mode, source, amount_paise, received_at, payer_name, classification, not_service_kind)
  VALUES (v_e, 'upi', 'manual', 80000, now(), 'ZZ PROBE NOTSVC', 'not_service', 'other') RETURNING id INTO v_notsvc;

  PERFORM public.payments_allocate(v_e, v_part, jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount_paise', 40000)), v_a, NULL, 'probe');
  PERFORM public.payments_allocate(v_e, v_full, jsonb_build_array(jsonb_build_object('invoice_id', v_inv2, 'amount_paise', 50000)), v_a, NULL, 'probe');
  PERFORM public.payments_void_receipt(v_e, v_void, 'ZZ probe void', v_a);

  -- ── 1. Mark an unmatched payment as waiting ───────────────────────────────
  v_res := public.payments_set_awaiting_invoice(v_e, v_open, true, v_a);
  PERFORM pg_temp.zz_check('1 mark: changed', (v_res->>'changed')::boolean, v_res::text);
  SELECT awaiting_invoice INTO v_flag FROM public.payment_receipts WHERE id = v_open;
  PERFORM pg_temp.zz_check('1 mark: flag is set', v_flag, v_flag::text);
  SELECT count(*) INTO v_n FROM public.payment_events
   WHERE receipt_id = v_open AND event_type = 'awaiting_invoice'
     AND actor_id = v_a AND amount_paise = 100000 AND detail->>'awaiting_invoice' = 'true';
  PERFORM pg_temp.zz_check('1 mark: one event, who + the ₹1,000 waiting', v_n = 1, v_n::text);
  SELECT count(*) INTO v_n FROM public.payment_receipts
   WHERE id = v_open AND classification = 'unknown' AND allocated_paise = 0;
  PERFORM pg_temp.zz_check('1 mark: moves no money, classifies nothing', v_n = 1, v_n::text);

  -- ── 2. A repeated tap is a no-op ──────────────────────────────────────────
  v_res := public.payments_set_awaiting_invoice(v_e, v_open, true, v_a);
  PERFORM pg_temp.zz_check('2 again: changed = false', NOT (v_res->>'changed')::boolean, v_res::text);
  SELECT count(*) INTO v_n FROM public.payment_events WHERE receipt_id = v_open AND event_type = 'awaiting_invoice';
  PERFORM pg_temp.zz_check('2 again: still one event', v_n = 1, v_n::text);

  -- ── 3. Unmark ─────────────────────────────────────────────────────────────
  v_res := public.payments_set_awaiting_invoice(v_e, v_open, false, v_a);
  SELECT awaiting_invoice INTO v_flag FROM public.payment_receipts WHERE id = v_open;
  PERFORM pg_temp.zz_check('3 unmark: flag cleared', (v_res->>'changed')::boolean AND NOT v_flag, v_res::text);
  SELECT count(*) INTO v_n FROM public.payment_events
   WHERE receipt_id = v_open AND event_type = 'awaiting_invoice' AND detail->>'awaiting_invoice' = 'false';
  PERFORM pg_temp.zz_check('3 unmark: logged too', v_n = 1, v_n::text);

  -- ── 4. Part-matched money can wait for its second bill ────────────────────
  v_res := public.payments_set_awaiting_invoice(v_e, v_part, true, v_a);
  SELECT count(*) INTO v_n FROM public.payment_events
   WHERE receipt_id = v_part AND event_type = 'awaiting_invoice' AND amount_paise = 60000;
  PERFORM pg_temp.zz_check('4 part-matched: allowed, logs the ₹600 still unplaced', (v_res->>'changed')::boolean AND v_n = 1, v_n::text);

  -- ── 5. Refusals ───────────────────────────────────────────────────────────
  PERFORM pg_temp.zz_refused('5a fully matched is refused',
    format('SELECT public.payments_set_awaiting_invoice(%L, %L, true, %L)', v_e, v_full, v_a), 'already fully matched');
  PERFORM pg_temp.zz_refused('5b voided is refused',
    format('SELECT public.payments_set_awaiting_invoice(%L, %L, true, %L)', v_e, v_void, v_a), 'voided');
  PERFORM pg_temp.zz_refused('5c not-a-service-payment is refused',
    format('SELECT public.payments_set_awaiting_invoice(%L, %L, true, %L)', v_e, v_notsvc, v_a), 'not a service payment');
  PERFORM pg_temp.zz_refused('5d null is refused',
    format('SELECT public.payments_set_awaiting_invoice(%L, %L, NULL, %L)', v_e, v_open, v_a), 'true or false');
  IF v_other IS NOT NULL THEN
    PERFORM pg_temp.zz_refused('5e another entity cannot see it',
      format('SELECT public.payments_set_awaiting_invoice(%L, %L, true, %L)', v_other, v_open, v_a), 'not found');
  END IF;
  SELECT count(*) INTO v_n FROM public.payment_receipts
   WHERE id IN (v_full, v_void, v_notsvc) AND awaiting_invoice;
  PERFORM pg_temp.zz_check('5 refusals changed nothing', v_n = 0, v_n::text);

  -- ── 6. Matching the waiting money clears the flag (payments_allocate) ─────
  PERFORM public.payments_set_awaiting_invoice(v_e, v_open, true, v_a);
  PERFORM public.payments_allocate(v_e, v_open, jsonb_build_array(jsonb_build_object('invoice_id', v_inv3, 'amount_paise', 30000)), v_a, NULL, 'probe');
  SELECT awaiting_invoice INTO v_flag FROM public.payment_receipts WHERE id = v_open;
  PERFORM pg_temp.zz_check('6 a match clears "waiting"', NOT v_flag, v_flag::text);

  -- ── 7. Only the Edge Function may call it ─────────────────────────────────
  PERFORM pg_temp.zz_check('7 anon cannot execute',
    NOT has_function_privilege('anon', 'public.payments_set_awaiting_invoice(uuid,uuid,boolean,uuid)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('7 authenticated cannot execute',
    NOT has_function_privilege('authenticated', 'public.payments_set_awaiting_invoice(uuid,uuid,boolean,uuid)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('7 service_role can',
    has_function_privilege('service_role', 'public.payments_set_awaiting_invoice(uuid,uuid,boolean,uuid)', 'EXECUTE'));

  -- ── 8. The open-receipts view still shows a waiting payment (with its flag)
  PERFORM public.payments_set_awaiting_invoice(v_e, v_part, true, v_a);
  SELECT count(*) INTO v_n FROM public.v_payments_open_receipts WHERE id = v_part AND awaiting_invoice;
  PERFORM pg_temp.zz_check('8 a waiting payment stays readable, flagged', v_n = 1, v_n::text);

  -- ── 9. WHEN it was marked — what "a bill imported since" compares ────────
  SELECT count(*) INTO v_n FROM public.v_payments_open_receipts
   WHERE id = v_part AND awaiting_since IS NOT NULL AND awaiting_since > now() - interval '1 minute';
  PERFORM pg_temp.zz_check('9 marking records when (awaiting_since)', v_n = 1, v_n::text);
  PERFORM public.payments_set_awaiting_invoice(v_e, v_part, false, v_a);
  SELECT count(*) INTO v_n FROM public.payment_receipts WHERE id = v_part AND awaiting_since IS NULL;
  PERFORM pg_temp.zz_check('9 unmarking clears it', v_n = 1, v_n::text);
  SELECT count(*) INTO v_n FROM public.v_payments_open_invoices
   WHERE invoice_number = 'ZZPROBE-AW4' AND created_at > now() - interval '1 minute';
  PERFORM pg_temp.zz_check('9 an open bill carries when it arrived (created_at)', v_n = 1, v_n::text);

  -- ── 10. The re-created views keep their shape and their safety ──────────
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'v_payments_open_receipts'
     AND column_name IN ('id','entity_id','mode','source','amount_paise','allocated_paise','open_paise',
                         'received_at','payer_name','payer_remark','classification','awaiting_invoice',
                         'qr_ref','awaiting_since');
  PERFORM pg_temp.zz_check('10 receipts view: all 13 old columns + awaiting_since', v_n = 14, v_n::text);
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'v_payments_open_invoices'
     AND column_name IN ('id','entity_id','invoice_number','invoice_kind','job_ref','dealer_order_no',
                         'sap_billing_doc','invoice_date','customer_id','customer_name','vehicle_reg_no',
                         'payment_terms','total_paise','allocated_paise','open_paise','status','created_at');
  PERFORM pg_temp.zz_check('10 invoices view: all 16 old columns + created_at', v_n = 17, v_n::text);
  SELECT count(*) INTO v_n FROM pg_class
   WHERE relname IN ('v_payments_open_receipts','v_payments_open_invoices')
     AND 'security_invoker=true' = ANY(reloptions);
  PERFORM pg_temp.zz_check('10 both views still run as the reader (RLS applies)', v_n = 2, v_n::text);
  PERFORM pg_temp.zz_check('10 readers can still SELECT the views',
    has_table_privilege('authenticated', 'public.v_payments_open_receipts', 'SELECT')
    AND has_table_privilege('authenticated', 'public.v_payments_open_invoices', 'SELECT'));
  PERFORM pg_temp.zz_check('10 and still cannot write through them',
    NOT has_table_privilege('authenticated', 'public.v_payments_open_receipts', 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.v_payments_open_invoices', 'INSERT,UPDATE,DELETE'));

  RAISE EXCEPTION 'PROBE COMPLETE — % checks, % failed%',
    current_setting('zz.checks'),
    CASE WHEN current_setting('zz.fails') = '' THEN 0
         ELSE array_length(string_to_array(trim(leading ' | ' from current_setting('zz.fails')), ' | '), 1) END,
    CASE WHEN current_setting('zz.fails') = '' THEN '' ELSE ': ' || current_setting('zz.fails') END;
END
$probe$;
