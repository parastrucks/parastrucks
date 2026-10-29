-- ============================================================================
-- Service Payments — does "Something else" need a note, and is the note kept
-- and cleared as it should be?
--   payments_classify_receipt (20261018_payments_classify_note.sql)
--
-- WRITES NOTHING: the last statement raises "PROBE COMPLETE", rolling back
-- (the receipt-number counter included, so no number is used up).
-- A green run ENDS IN AN ERROR whose text reads "PROBE COMPLETE … 0 failed".
-- Run through the SQL editor, MCP apply_migration, or
--   npx supabase db query --linked -f scripts/payments/probe-classify-note.sql
-- It creates one ZZPROBE receipt and touches no existing row.
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

DO $probe$
DECLARE
  v_e     uuid;
  v_a     uuid;
  v_r     uuid;
  v_res   jsonb;
  v_kind  text;
  v_note  text;
  v_cls   text;
  v_ev    jsonb;
  v_n     bigint;
BEGIN
  PERFORM set_config('zz.fails', '', true);
  PERFORM set_config('zz.checks', '0', true);
  SELECT id INTO v_e FROM public.entities WHERE code = 'PTB';
  SELECT id INTO v_a FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_e IS NULL OR v_a IS NULL THEN RAISE EXCEPTION 'need the PTB entity and an admin'; END IF;

  v_res := public.payments_manual_receipt(v_e,
    '{"mode":"cash","amount_paise":3000,"payer_name":"ZZPROBE NOTE","received_at":"2026-10-18T06:00:00Z"}'::jsonb,
    v_a, gen_random_uuid());
  v_r := (v_res->>'receipt_id')::uuid;

  -- 1. "Something else" without a note is refused — empty, spaces only, or none.
  PERFORM pg_temp.zz_refused('1 "Something else" with no note: refused',
    format('SELECT public.payments_classify_receipt(%L, %L, %L, %L, %L, NULL)', v_e, v_r, 'not_service', 'other', v_a),
    'needs a note');
  PERFORM pg_temp.zz_refused('1 ...with only spaces: refused',
    format('SELECT public.payments_classify_receipt(%L, %L, %L, %L, %L, %L)', v_e, v_r, 'not_service', 'other', v_a, '   '),
    'needs a note');
  PERFORM pg_temp.zz_refused('1 ...called the old way, five arguments: refused (no note to give)',
    format('SELECT public.payments_classify_receipt(%L, %L, %L, %L, %L)', v_e, v_r, 'not_service', 'other', v_a),
    'needs a note');
  SELECT classification INTO v_cls FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('1 a refused save leaves the payment as it was', v_cls = 'unknown', v_cls);

  -- 2. With a note: kept on the receipt (spaces trimmed) and in the history.
  v_res := public.payments_classify_receipt(v_e, v_r, 'not_service', 'other', v_a, '  Deposit for a body-building job  ');
  SELECT not_service_kind, not_service_note, classification INTO v_kind, v_note, v_cls FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('2 set aside as "other"', v_cls = 'not_service' AND v_kind = 'other', v_cls || '/' || v_kind);
  PERFORM pg_temp.zz_check('2 the note is on the receipt, trimmed', v_note = 'Deposit for a body-building job', v_note);
  PERFORM pg_temp.zz_check('2 the answer carries the note', v_res->>'note' = 'Deposit for a body-building job', v_res::text);
  SELECT detail INTO v_ev FROM public.payment_events WHERE receipt_id = v_r AND event_type = 'classify' ORDER BY created_at DESC, id DESC LIMIT 1;
  PERFORM pg_temp.zz_check('2 the history has the note', v_ev->>'note' = 'Deposit for a body-building job', v_ev::text);

  -- 3. Length: 300 is fine, 301 is refused.
  PERFORM public.payments_classify_receipt(v_e, v_r, 'not_service', 'other', v_a, repeat('x', 300));
  SELECT length(not_service_note) INTO v_n FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('3 a 300-character note is kept', v_n = 300, v_n::text);
  PERFORM pg_temp.zz_refused('3 a 301-character note is refused',
    format('SELECT public.payments_classify_receipt(%L, %L, %L, %L, %L, %L)', v_e, v_r, 'not_service', 'other', v_a, repeat('x', 301)),
    'keep it to 300');

  -- 4. Other reasons need no note, and may carry one.
  PERFORM public.payments_classify_receipt(v_e, v_r, 'not_service', 'test_topup', v_a, NULL);
  SELECT not_service_kind, not_service_note INTO v_kind, v_note FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('4 "Test or top-up" with no note is accepted, and the old note goes', v_kind = 'test_topup' AND v_note IS NULL,
    v_kind || '/' || coalesce(v_note, 'null'));
  PERFORM public.payments_classify_receipt(v_e, v_r, 'not_service', 'sister_unit', v_a, 'PT Gandhinagar');
  SELECT not_service_note INTO v_note FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('4 any reason may carry a note', v_note = 'PT Gandhinagar', v_note);

  -- 5. Back to unknown: kind and note both cleared; the history keeps the old note.
  PERFORM public.payments_classify_receipt(v_e, v_r, 'unknown', NULL, v_a, 'ignored');
  SELECT classification, not_service_kind, not_service_note INTO v_cls, v_kind, v_note FROM public.payment_receipts WHERE id = v_r;
  PERFORM pg_temp.zz_check('5 classified back: kind and note cleared', v_cls = 'unknown' AND v_kind IS NULL AND v_note IS NULL,
    v_cls || '/' || coalesce(v_kind, 'null') || '/' || coalesce(v_note, 'null'));
  SELECT count(*) INTO v_n FROM public.payment_events WHERE receipt_id = v_r AND event_type = 'classify' AND detail->>'note' = 'PT Gandhinagar';
  PERFORM pg_temp.zz_check('5 ...and the history still has the note it had', v_n = 1, v_n::text);

  -- 6. Shape: one function, the six-argument one; only the server may call it.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'payments_classify_receipt';
  PERFORM pg_temp.zz_check('6 exactly one payments_classify_receipt (the old one dropped, no overload)', v_n = 1, v_n::text);
  PERFORM pg_temp.zz_check('6 it takes the note',
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'payments_classify_receipt'
             AND pg_get_function_identity_arguments(oid) = 'p_entity_id uuid, p_receipt_id uuid, p_classification text, p_kind text, p_actor uuid, p_note text'));
  PERFORM pg_temp.zz_check('6 signed-in users cannot call it directly',
    NOT has_function_privilege('authenticated', 'public.payments_classify_receipt(uuid, uuid, text, text, uuid, text)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('6 nor can anon',
    NOT has_function_privilege('anon', 'public.payments_classify_receipt(uuid, uuid, text, text, uuid, text)', 'EXECUTE'));
  PERFORM pg_temp.zz_check('6 the Edge Function (service role) can',
    has_function_privilege('service_role', 'public.payments_classify_receipt(uuid, uuid, text, text, uuid, text)', 'EXECUTE'));

  RAISE EXCEPTION 'PROBE COMPLETE — % checks, % failed%',
    current_setting('zz.checks'),
    CASE WHEN current_setting('zz.fails') = '' THEN 0
         ELSE array_length(string_to_array(trim(leading ' | ' from current_setting('zz.fails')), ' | '), 1) END,
    current_setting('zz.fails');
END
$probe$;
