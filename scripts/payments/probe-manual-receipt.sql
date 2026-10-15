-- ============================================================================
-- Service Payments — is a cash/cheque receipt saved exactly once, and is cash
-- of ₹2 lakh or more refused?
--   payments_manual_receipt (20261013_payments_manual_receipt_safe.sql)
--
-- WRITES NOTHING: the last statement raises "PROBE COMPLETE", rolling back
-- (the receipt-number counter included, so no number is used up).
-- A green run ENDS IN AN ERROR whose text reads "PROBE COMPLETE … 0 failed".
-- Run through MCP apply_migration (execute_sql is read-only) or the SQL editor.
-- It creates only ZZPROBE receipts and touches no existing row.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.zz_check(label text, ok boolean, got text DEFAULT '') RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.checks', (coalesce(nullif(current_setting('zz.checks', true), ''), '0')::int + 1)::text, true);
  IF ok IS NOT TRUE THEN
    PERFORM set_config('zz.fails', current_setting('zz.fails', true) || ' | ' || label || ' (' || coalesce(got, 'null') || ')', true);
  END IF;
END $f$;

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

-- The number at the end of a receipt serial: CR-PTB-2026-00042 -> 42.
CREATE OR REPLACE FUNCTION pg_temp.zz_seq(serial text) RETURNS integer
LANGUAGE sql AS $f$ SELECT substring(serial from '(\d+)$')::integer $f$;

DO $probe$
DECLARE
  v_e     uuid;
  v_a     uuid;
  v_id1   uuid := gen_random_uuid();
  v_id2   uuid := gen_random_uuid();
  v_r1    jsonb;
  v_r1b   jsonb;
  v_r2    jsonb;
  v_r3    jsonb;
  v_r4    jsonb;
  v_n     bigint;
  v_row   text := '{"mode":"cash","amount_paise":100000,"payer_name":"ZZPROBE CASH","received_at":"2026-10-13T06:00:00Z"}';
BEGIN
  PERFORM set_config('zz.fails', '', true);
  PERFORM set_config('zz.checks', '0', true);
  SELECT id INTO v_e FROM public.entities WHERE code = 'PTB';
  SELECT id INTO v_a FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_e IS NULL OR v_a IS NULL THEN RAISE EXCEPTION 'need the PTB entity and an admin'; END IF;

  -- 1. A save, then the same save again (the answer was lost; "Save" again).
  v_r1  := public.payments_manual_receipt(v_e, v_row::jsonb, v_a, v_id1);
  v_r1b := public.payments_manual_receipt(v_e, v_row::jsonb, v_a, v_id1);
  PERFORM pg_temp.zz_check('1 the repeat returns the SAME receipt', v_r1b->>'receipt_id' = v_r1->>'receipt_id', v_r1b::text);
  PERFORM pg_temp.zz_check('1 ...with the same number', v_r1b->>'receipt_serial' = v_r1->>'receipt_serial', v_r1b::text);
  PERFORM pg_temp.zz_check('1 ...and says it is a repeat', (v_r1b->>'idempotent_replay')::boolean IS TRUE, v_r1b::text);
  SELECT count(*) INTO v_n FROM public.payment_receipts WHERE entity_id = v_e AND client_request_id = v_id1;
  PERFORM pg_temp.zz_check('1 one receipt exists for the save, not two', v_n = 1, v_n::text);
  SELECT count(*) INTO v_n FROM public.payment_events WHERE receipt_id = (v_r1->>'receipt_id')::uuid AND event_type = 'manual_receipt';
  PERFORM pg_temp.zz_check('1 one log line, not two', v_n = 1, v_n::text);

  -- 2. The same save id with different money is refused, not quietly answered.
  PERFORM pg_temp.zz_refused('2 same save, different amount: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":100100,"payer_name":"ZZPROBE CASH"}', v_a, v_id1),
    'already went through as');
  PERFORM pg_temp.zz_refused('2 same save, different mode: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cheque","amount_paise":100000,"payer_name":"ZZPROBE CASH","received_at":"2026-10-13T06:00:00Z"}', v_a, v_id1),
    'already went through as');
  -- Pre-mortem 2, G4: a save retried after a lost answer with a CORRECTED
  -- name or day used to get the first receipt back, silently.
  PERFORM pg_temp.zz_refused('2 same save, corrected payer name: refused, naming the first receipt',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":100000,"payer_name":"ZZPROBE CASH LTD","received_at":"2026-10-13T06:00:00Z"}', v_a, v_id1),
    'already went through as CR-');
  PERFORM pg_temp.zz_refused('2 same save, a different day: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":100000,"payer_name":"ZZPROBE CASH","received_at":"2026-10-12T06:00:00Z"}', v_a, v_id1),
    'already went through as');
  PERFORM pg_temp.zz_refused('2 same save, a cheque number added: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":100000,"payer_name":"ZZPROBE CASH","received_at":"2026-10-13T06:00:00Z","instrument_ref":"77"}', v_a, v_id1),
    'already went through as');
  -- "Today" is stamped with the moment of each attempt: a later minute of the
  -- same India day is the same receipt.
  PERFORM pg_temp.zz_check('2 same save later the same India day: still the first receipt',
    (public.payments_manual_receipt(v_e,
      '{"mode":"cash","amount_paise":100000,"payer_name":" ZZPROBE CASH ","received_at":"2026-10-13T12:00:00Z"}'::jsonb,
      v_a, v_id1))->>'receipt_id' = v_r1->>'receipt_id');
  PERFORM pg_temp.zz_check('2 the answer carries what was SAVED (for the done screen)',
    v_r1b->>'payer_name' = 'ZZPROBE CASH' AND (v_r1b->>'amount_paise')::bigint = 100000 AND v_r1b->>'mode' = 'cash'
    AND v_r1->>'payer_name' = 'ZZPROBE CASH', v_r1b::text);

  -- 3. A new save takes the NEXT number: the repeat used none up.
  v_r2 := public.payments_manual_receipt(v_e, v_row::jsonb, v_a, v_id2);
  PERFORM pg_temp.zz_check('3 a new save is a new receipt', v_r2->>'receipt_id' <> v_r1->>'receipt_id', v_r2::text);
  PERFORM pg_temp.zz_check('3 ...numbered next: the repeat used no number',
    pg_temp.zz_seq(v_r2->>'receipt_serial') = pg_temp.zz_seq(v_r1->>'receipt_serial') + 1,
    (v_r1->>'receipt_serial') || ' then ' || (v_r2->>'receipt_serial'));

  -- 4. No save id: the old behaviour, unchanged.
  v_r3 := public.payments_manual_receipt(v_e, v_row::jsonb, v_a);
  PERFORM pg_temp.zz_check('4 no save id still saves (three-argument call)', v_r3->>'receipt_id' IS NOT NULL, v_r3::text);

  -- 5. Section 269ST: cash of ₹2,00,000 or more in one receipt — refused
  --    WITHOUT a reason; recorded and flagged WITH one (owner, 2026-10-15).
  PERFORM pg_temp.zz_refused('5 cash ₹2,00,000.00 exactly, no reason: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":20000000,"payer_name":"ZZPROBE BIG"}', v_a, gen_random_uuid()),
    '269ST');
  PERFORM pg_temp.zz_refused('5 cash ₹5,00,000, no reason: refused',
    format('SELECT public.payments_manual_receipt(%L, %L::jsonb, %L, %L)', v_e,
      '{"mode":"cash","amount_paise":50000000,"payer_name":"ZZPROBE BIG"}', v_a, gen_random_uuid()),
    '269ST');
  v_r4 := public.payments_manual_receipt(v_e,
    '{"mode":"cash","amount_paise":19999999,"payer_name":"ZZPROBE BIG"}'::jsonb, v_a, gen_random_uuid());
  PERFORM pg_temp.zz_check('5 cash ₹1,99,999.99: accepted', v_r4->>'receipt_id' IS NOT NULL, v_r4::text);
  PERFORM pg_temp.zz_check('5 ...and the refusals before it took no number',
    pg_temp.zz_seq(v_r4->>'receipt_serial') = pg_temp.zz_seq(v_r3->>'receipt_serial') + 1,
    (v_r3->>'receipt_serial') || ' then ' || (v_r4->>'receipt_serial'));
  PERFORM pg_temp.zz_check('5 a ₹2,50,000 cheque is not cash: accepted',
    (public.payments_manual_receipt(v_e, '{"mode":"cheque","amount_paise":25000000,"payer_name":"ZZPROBE BIG","instrument_ref":"000123"}'::jsonb,
      v_a, gen_random_uuid()))->>'receipt_id' IS NOT NULL);
  v_r4 := public.payments_manual_receipt(v_e,
    '{"mode":"cash","amount_paise":21000000,"payer_name":"ZZPROBE BIG","cash_limit_reason":"Taken at the counter before anyone checked"}'::jsonb,
    v_a, gen_random_uuid());
  PERFORM pg_temp.zz_check('5 cash ₹2,10,000 WITH a reason: recorded (the drawer and the books agree)',
    v_r4->>'receipt_id' IS NOT NULL AND (v_r4->>'sec_269st')::boolean, v_r4::text);
  SELECT count(*) INTO v_n FROM public.payment_events
   WHERE receipt_id = (v_r4->>'receipt_id')::uuid AND event_type = 'manual_receipt'
     AND (detail->>'sec_269st')::boolean AND detail->>'cash_limit_reason' = 'Taken at the counter before anyone checked';
  PERFORM pg_temp.zz_check('5 ...and marked as a 269ST case, with its reason, for the GM', v_n = 1, v_n::text);
  SELECT count(*) INTO v_n FROM public.payment_events
   WHERE receipt_id = (v_r2->>'receipt_id')::uuid AND detail ? 'sec_269st';
  PERFORM pg_temp.zz_check('5 an ordinary receipt carries no 269ST mark', v_n = 0, v_n::text);
  PERFORM pg_temp.zz_check('5 a ₹5,00,000 bank transfer: accepted',
    (public.payments_manual_receipt(v_e, '{"mode":"netbanking","amount_paise":50000000,"payer_name":"ZZPROBE BIG"}'::jsonb,
      v_a, gen_random_uuid()))->>'receipt_id' IS NOT NULL);

  -- 6. A hand-entered UPI without its bank reference is refused, in today's words.
  BEGIN
    PERFORM public.payments_manual_receipt(v_e, '{"mode":"upi","amount_paise":1000,"payer_name":"ZZPROBE UPI"}'::jsonb, v_a, gen_random_uuid());
    PERFORM pg_temp.zz_check('6 UPI without a reference: refused', false, 'was NOT refused');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.zz_check('6 UPI without a reference: refused, asking for the RRN', SQLERRM ILIKE '%RRN%', SQLERRM);
    PERFORM pg_temp.zz_check('6 ...and no longer naming retired BharatPe / Google Pay',
      SQLERRM NOT ILIKE '%BharatPe%' AND SQLERRM NOT ILIKE '%Google Pay%', SQLERRM);
  END;

  -- 7. One function, the new shape, callable only by the Edge Function.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'payments_manual_receipt';
  PERFORM pg_temp.zz_check('7 exactly one payments_manual_receipt (the old one dropped, no overload)', v_n = 1, v_n::text);
  PERFORM pg_temp.zz_check('7 it takes the save id',
    to_regprocedure('public.payments_manual_receipt(uuid, jsonb, uuid, uuid)') IS NOT NULL);
  PERFORM pg_temp.zz_check('7 anon cannot run it',
    NOT has_function_privilege('anon', 'public.payments_manual_receipt(uuid, jsonb, uuid, uuid)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('7 a signed-in user cannot run it directly',
    NOT has_function_privilege('authenticated', 'public.payments_manual_receipt(uuid, jsonb, uuid, uuid)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('7 the Edge Function (service role) can',
    has_function_privilege('service_role', 'public.payments_manual_receipt(uuid, jsonb, uuid, uuid)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('7 the save-id index is unique per company',
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'payment_receipts_client_request_key'
            AND indexdef ILIKE '%UNIQUE%(entity_id, client_request_id)%'));

  RAISE EXCEPTION 'PROBE COMPLETE — % checks, % failed%',
    current_setting('zz.checks'),
    CASE WHEN current_setting('zz.fails') = '' THEN 0
         ELSE array_length(string_to_array(trim(leading ' | ' from current_setting('zz.fails')), ' | '), 1) END,
    CASE WHEN current_setting('zz.fails') = '' THEN '' ELSE ': ' || current_setting('zz.fails') END;
END
$probe$;
