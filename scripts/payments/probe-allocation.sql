-- ============================================================================
-- Service Payments — allocation truth table, proved on a real database.
--
-- HOW TO RUN. Apply both migrations first:
--     supabase/migrations/20260830_payments_a1_schema.sql
--     supabase/migrations/20260908_payments_a1_rpcs.sql
-- then paste THIS WHOLE FILE into the Supabase SQL editor (staging for
-- preference) and run it.
--
-- IT WRITES NOTHING. The final statement raises, which rolls the whole
-- transaction back — every row it created disappears. NOTICE messages are
-- delivered to the client as they are raised, not held until commit, so the
-- results print even though nothing is kept. Expect the run to END IN AN ERROR
-- reading "PROBE COMPLETE"; that error IS the success condition.
--
-- It borrows a real entity and a real user because the money tables have
-- foreign keys to both. It creates its own customer, group, invoices and
-- receipts, and touches no existing row.
-- ============================================================================

DO $probe$
DECLARE
  v_entity   uuid;
  v_actor    uuid;
  v_group    uuid;
  v_customer uuid;
  v_inv_a    uuid;   -- 1,930.00  parts   } one order, billed as two invoices
  v_inv_b    uuid;   -- 5,000.00  labour  }
  v_inv_c    uuid;   -- 10,000.00 standalone, used for TDS
  v_receipt  uuid;
  v_r2       uuid;
  v_res      jsonb;
  v_alloc    uuid;
  v_n        bigint;
  v_txt      text;
  v_pass     integer := 0;
  v_fail     integer := 0;
BEGIN
  -- ── fixtures ────────────────────────────────────────────────────────────
  SELECT id INTO v_entity FROM public.entities WHERE code = 'PTB';
  IF v_entity IS NULL THEN RAISE EXCEPTION 'no PTB entity — wrong database?'; END IF;

  SELECT id INTO v_actor FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'no admin user to act as'; END IF;

  INSERT INTO public.customer_groups (entity_id, name, credit_limit_paise, created_by)
  VALUES (v_entity, 'ZZ PROBE GROUP', 50000000, v_actor) RETURNING id INTO v_group;

  INSERT INTO public.customers (entity_id, sap_customer_code, display_name)
  VALUES (v_entity, 'ZZPROBE0001', 'ZZ PROBE CUSTOMER') RETURNING id INTO v_customer;

  INSERT INTO public.customer_group_memberships (customer_id, group_id, assigned_by)
  VALUES (v_customer, v_group, v_actor);

  INSERT INTO public.service_invoices
    (entity_id, invoice_number, invoice_kind, invoice_date, customer_id,
     customer_name, payment_terms, net_paise, tax_paise, total_paise, job_ref)
  VALUES (v_entity, 'ZZPROBE-PCS-1', 'service_parts', current_date, v_customer,
          'ZZ PROBE CUSTOMER', 'cash', 163559, 29441, 193000, 'ZZJOB1')
  RETURNING id INTO v_inv_a;

  INSERT INTO public.service_invoices
    (entity_id, invoice_number, invoice_kind, invoice_date, customer_id,
     customer_name, payment_terms, net_paise, tax_paise, total_paise, job_ref)
  VALUES (v_entity, 'ZZPROBE-LCS-1', 'service_labour', current_date, v_customer,
          'ZZ PROBE CUSTOMER', 'cash', 423729, 76271, 500000, 'ZZJOB1')
  RETURNING id INTO v_inv_b;

  INSERT INTO public.service_invoices
    (entity_id, invoice_number, invoice_kind, invoice_date, customer_id,
     customer_name, payment_terms, net_paise, tax_paise, total_paise)
  VALUES (v_entity, 'ZZPROBE-PCR-1', 'service_parts', current_date, v_customer,
          'ZZ PROBE CUSTOMER', 'credit', 847458, 152542, 1000000)
  RETURNING id INTO v_inv_c;

  INSERT INTO public.payment_receipts
    (entity_id, mode, source, amount_paise, received_at, external_txn_id, payer_name)
  VALUES (v_entity, 'upi', 'bharatpe', 693000, now(), 'ZZPROBE000001', 'ZZ PROBE PAYER')
  RETURNING id INTO v_receipt;

  RAISE NOTICE '─── fixtures created ─────────────────────────────────────';

  -- ── 1. the ordinary case: one payment settles a two-invoice order ───────
  v_res := public.payments_allocate(
    v_entity, v_receipt,
    jsonb_build_array(jsonb_build_object('invoice_id', v_inv_a),
                      jsonb_build_object('invoice_id', v_inv_b)),
    v_actor, gen_random_uuid(), 'amount_unique');

  SELECT allocated_paise INTO v_n FROM public.service_invoices WHERE id = v_inv_a;
  IF v_n = 193000 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  parts invoice fully allocated';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  parts invoice allocated=% expected 193000', v_n; END IF;

  SELECT allocated_paise INTO v_n FROM public.service_invoices WHERE id = v_inv_b;
  IF v_n = 500000 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  labour invoice fully allocated';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  labour invoice allocated=% expected 500000', v_n; END IF;

  SELECT allocated_paise INTO v_n FROM public.payment_receipts WHERE id = v_receipt;
  IF v_n = 693000 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  receipt fully consumed (693000)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  receipt allocated=% expected 693000', v_n; END IF;

  SELECT classification INTO v_txt FROM public.payment_receipts WHERE id = v_receipt;
  IF v_txt = 'service' THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  allocating classified it as service';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  classification=% expected service', v_txt; END IF;

  -- ── 2. a spent receipt cannot be spent again ────────────────────────────
  BEGIN
    v_res := public.payments_allocate(v_entity, v_receipt,
      jsonb_build_array(jsonb_build_object('invoice_id', v_inv_c, 'amount_paise', 100)),
      v_actor, gen_random_uuid(), NULL);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  over-allocating a spent receipt was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  over-allocating a spent receipt refused';
  END;

  -- ── 3. idempotency: the same request id twice makes one allocation ──────
  INSERT INTO public.payment_receipts
    (entity_id, mode, source, amount_paise, received_at, external_txn_id, payer_name)
  VALUES (v_entity, 'upi', 'gpay', 1000000, now(), 'ZZPROBE000002', 'ZZ PROBE PAYER 2')
  RETURNING id INTO v_r2;

  DECLARE v_req uuid := gen_random_uuid(); v_first jsonb; v_second jsonb;
  BEGIN
    v_first  := public.payments_allocate(v_entity, v_r2,
                  jsonb_build_array(jsonb_build_object('invoice_id', v_inv_c)), v_actor, v_req, NULL);
    v_second := public.payments_allocate(v_entity, v_r2,
                  jsonb_build_array(jsonb_build_object('invoice_id', v_inv_c)), v_actor, v_req, NULL);

    IF (v_second->>'idempotent_replay')::boolean THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS  a retried confirm replayed instead of double-allocating';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a retried confirm allocated a second time';
    END IF;

    SELECT count(*) INTO v_n FROM public.payment_allocations
     WHERE receipt_id = v_r2 AND reversed_at IS NULL;
    IF v_n = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  exactly one allocation exists';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  % allocations exist, expected 1', v_n; END IF;
  END;

  -- ── 4. reversal restores both sides, and cannot happen twice ────────────
  SELECT id INTO v_alloc FROM public.payment_allocations
   WHERE receipt_id = v_r2 AND reversed_at IS NULL LIMIT 1;

  v_res := public.payments_reverse_allocation(v_alloc, v_actor, 'probe');

  SELECT allocated_paise INTO v_n FROM public.service_invoices WHERE id = v_inv_c;
  IF v_n = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  reversal freed the invoice';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  invoice still allocated=%', v_n; END IF;

  SELECT allocated_paise INTO v_n FROM public.payment_receipts WHERE id = v_r2;
  IF v_n = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  reversal freed the receipt';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  receipt still allocated=%', v_n; END IF;

  BEGIN
    v_res := public.payments_reverse_allocation(v_alloc, v_actor, 'probe again');
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  double reversal was ALLOWED (caches would drift)';
  EXCEPTION WHEN no_data_found THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  double reversal refused';
  END;

  BEGIN
    SELECT id INTO v_alloc FROM public.payment_allocations WHERE receipt_id = v_receipt LIMIT 1;
    v_res := public.payments_reverse_allocation(v_alloc, v_actor, '');
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a reversal with no reason was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  a reversal must say why';
  END;

  -- ── 5. TDS is capped at 5% ──────────────────────────────────────────────
  BEGIN
    v_res := public.payments_close_tds(v_entity, v_inv_c, 100000, v_actor, false); -- 10%
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a 10%% TDS closure was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  a 10%% TDS closure refused (cap is 5%%)';
  END;

  v_res := public.payments_close_tds(v_entity, v_inv_c, 20000, v_actor, false);   -- 2%
  SELECT allocated_paise INTO v_n FROM public.service_invoices WHERE id = v_inv_c;
  IF v_n = 20000 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  a 2%% TDS closure allowed';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  invoice allocated=% expected 20000', v_n; END IF;

  v_res := public.payments_close_tds(v_entity, v_inv_c, 100000, v_actor, true);
  IF (v_res->>'over_cap')::boolean THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  a GM override is allowed and flagged over_cap';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  GM override not flagged'; END IF;

  -- ── 6. contradictions are refused ───────────────────────────────────────
  BEGIN
    v_res := public.payments_classify_receipt(v_entity, v_receipt, 'not_service', 'personal', v_actor);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  marking an allocated receipt not-service was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  cannot mark an allocated receipt not-service';
  END;

  BEGIN
    v_res := public.payments_void_receipt(v_entity, v_receipt, 'probe', v_actor);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  voiding an allocated receipt was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  cannot void a receipt that still settles bills';
  END;

  -- ── 7. manual receipts: serials are gap-free, UPI needs its txn id ──────
  BEGIN
    v_res := public.payments_manual_receipt(v_entity,
      jsonb_build_object('mode','upi','amount_paise',100000), v_actor);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a manual UPI receipt with no txn id was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  a manual UPI receipt requires the app txn id';
  END;

  DECLARE s1 text; s2 text;
  BEGIN
    s1 := public.payments_manual_receipt(v_entity,
            jsonb_build_object('mode','cash','amount_paise',50000), v_actor)->>'receipt_serial';
    s2 := public.payments_manual_receipt(v_entity,
            jsonb_build_object('mode','cheque','amount_paise',60000,'instrument_ref','000123'),
            v_actor)->>'receipt_serial';
    IF s1 <> s2 AND s1 LIKE 'CR-PTB-%' THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS  receipt serials issued: % then %', s1, s2;
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL  serial issue: % / %', s1, s2;
    END IF;
    IF right(s2, 5)::integer = right(s1, 5)::integer + 1 THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS  and they are consecutive — no gap';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL  serials are not consecutive';
    END IF;
  END;

  -- ── 8. on-account money lands on the group, not on a bill ───────────────
  DECLARE v_r3 uuid;
  BEGIN
    INSERT INTO public.payment_receipts
      (entity_id, mode, source, amount_paise, received_at, external_txn_id, payer_name)
    VALUES (v_entity, 'upi', 'bharatpe', 250000, now(), 'ZZPROBE000003', 'ZZ ADVANCE')
    RETURNING id INTO v_r3;

    v_res := public.payments_on_account(v_entity, v_r3, v_group, 250000, v_actor, gen_random_uuid());
    SELECT count(*) INTO v_n FROM public.payment_allocations
     WHERE receipt_id = v_r3 AND alloc_type = 'on_account' AND group_id = v_group;
    IF v_n = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS  an advance sits on the group';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL  on_account rows=%', v_n; END IF;

    BEGIN
      v_res := public.payments_on_account(v_entity, v_r3, v_group, 1, v_actor, gen_random_uuid());
      v_fail := v_fail + 1; RAISE NOTICE 'FAIL  over-allocating on account was ALLOWED';
    EXCEPTION WHEN check_violation THEN
      v_pass := v_pass + 1; RAISE NOTICE 'PASS  over-allocating on account refused';
    END;
  END;

  -- ── 9. the shape rules hold even against raw SQL ────────────────────────
  BEGIN
    INSERT INTO public.payment_allocations (entity_id, alloc_type, amount_paise)
    VALUES (v_entity, 'payment', 100);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a payment allocation with no receipt/invoice was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  alloc_shape rejects a malformed allocation';
  END;

  BEGIN
    INSERT INTO public.payment_allocations
      (entity_id, alloc_type, receipt_id, invoice_id, amount_paise)
    VALUES (v_entity, 'payment', v_receipt, v_inv_a, 0);
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  a zero-value allocation was ALLOWED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  a zero-value allocation is refused';
  END;

  -- ── 10. the audit diary cannot be rewritten ─────────────────────────────
  BEGIN
    UPDATE public.payment_events SET detail = '{}'::jsonb
     WHERE entity_id = v_entity AND event_type = 'allocate';
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  payment_events was UPDATEable';
  EXCEPTION WHEN raise_exception THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  payment_events refuses UPDATE, even as the owner';
  END;

  -- ── 11. the corruption detector agrees with everything above ────────────
  SELECT count(*) INTO v_n FROM public.v_payments_integrity;
  IF v_n = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS  v_payments_integrity is empty — every cache matches its allocations';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL  v_payments_integrity has % drifting row(s)', v_n;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  %  passed,  %  failed', v_pass, v_fail;
  RAISE NOTICE '════════════════════════════════════════════════════════';

  -- Roll everything back. This error is the success condition.
  RAISE EXCEPTION 'PROBE COMPLETE — % passed, % failed. Nothing was written; this rollback is deliberate.', v_pass, v_fail;
END
$probe$;
