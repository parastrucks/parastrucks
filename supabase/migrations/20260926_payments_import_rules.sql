-- ============================================================================
-- Service Payments — the two import RPCs, corrected before their first use.
--
-- Apply AFTER 20260908_payments_a1_rpcs.sql. CREATE OR REPLACE of two
-- functions, same signatures; everything not described below is the 20260908
-- body unchanged. No table, column or row is touched.
--
-- 1. ⭐ RECEIPTS DOUBLE-COUNTED HAND-KEYED UPI MONEY.
--    payments_manual_receipt always stores source = 'manual'. The import looked
--    for an existing row with the FILE's source ('bharatpe' / 'gpay'), so it
--    never recognised the hand-keyed copy:
--      · Google Pay: a second receipt was inserted — the same money counted
--        twice, which is exactly what the manual RPC demands a transaction id
--        to prevent.
--      · BharatPe: the same when the hand entry carried no UTR; when it did,
--        the UTR unique index threw and the WHOLE FILE was rejected with a
--        database message.
--    Its "already_present_manual" path could never fire. Now: an active manual
--    receipt with the same transaction id is LINKED (back-filled, stamped with
--    this batch); a second import of it is "already present"; any other clash
--    on the id or UTR is HELD and listed — never a second copy, never an
--    exception that throws the file away.
--
-- 2. INVOICES CANCELLED UNDER MATCHED MONEY. A bill SAP now marks cancelled
--    (or otherwise no longer payable) while money is matched to it was simply
--    amended — the payment left settling a bill that no longer exists, and
--    nothing said so. Now a conflict, named, until a person reverses the match.
--
-- Proved on staging by scripts/payments/probe-import-parity.sql, which ALSO
-- runs the Import screen's own preview logic on the same inputs and requires
-- the two to agree.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payments_import_invoices(
  p_entity_id uuid,
  p_rows      jsonb,
  p_batch     jsonb,
  p_actor     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r              jsonb;
  v_batch_id     uuid;
  v_existing     public.service_invoices%ROWTYPE;
  v_customer_id  uuid;
  v_new          integer := 0;
  v_amended      integer := 0;
  v_unchanged    integer := 0;
  v_conflicts    jsonb   := '[]'::jsonb;
  v_actor_name   text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  INSERT INTO public.payment_import_batches (
    entity_id, kind, source, file_name, file_hash, parser_version, format_note,
    row_count, payload, source_pulled_at, uploaded_by
  ) VALUES (
    p_entity_id, 'invoices', coalesce(p_batch->>'source', 'billing_report'),
    p_batch->>'file_name', p_batch->>'file_hash',
    coalesce(p_batch->>'parser_version', 'unknown'), p_batch->>'format_note',
    jsonb_array_length(p_rows), p_rows,
    (p_batch->>'source_pulled_at')::timestamptz, p_actor
  )
  RETURNING id INTO v_batch_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    -- The customer master grows itself. A customer who has never been seen
    -- arrives ungrouped, and Outstanding shows ungrouped customers as their own
    -- single-customer rows -- money is never allowed to hide behind a missing
    -- grouping decision.
    SELECT id INTO v_customer_id
      FROM public.customers
     WHERE entity_id = p_entity_id
       AND sap_customer_code = r->>'sap_customer_code';

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (entity_id, sap_customer_code, display_name, gstin, pan)
      VALUES (p_entity_id, r->>'sap_customer_code', coalesce(r->>'customer_name', r->>'sap_customer_code'),
              nullif(r->>'customer_gstin', ''), nullif(r->>'customer_pan', ''))
      RETURNING id INTO v_customer_id;
    ELSE
      -- Fill blanks only. A later export that has lost a GSTIN must not erase
      -- one we already hold.
      UPDATE public.customers
         SET gstin      = coalesce(gstin, nullif(r->>'customer_gstin', '')),
             pan        = coalesce(pan,   nullif(r->>'customer_pan', '')),
             updated_at = now()
       WHERE id = v_customer_id;
    END IF;

    SELECT * INTO v_existing
      FROM public.service_invoices
     WHERE entity_id = p_entity_id AND invoice_number = r->>'invoice_number'
     FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.service_invoices (
        entity_id, outlet_id, sap_plant, invoice_number, sap_billing_doc,
        invoice_kind, sap_billing_type, split_order_type, job_ref, dealer_order_no,
        invoice_date, customer_id, customer_name, vehicle_reg_no, chassis_no,
        payment_terms, net_paise, tax_paise, total_paise, cancelled_flag, irn_no,
        status, source_pulled_at, import_batch_id
      ) VALUES (
        p_entity_id, nullif(r->>'outlet_id','')::uuid, r->>'sap_plant',
        r->>'invoice_number', r->>'sap_billing_doc', r->>'invoice_kind',
        r->>'sap_billing_type', r->>'split_order_type', r->>'job_ref',
        r->>'dealer_order_no', (r->>'invoice_date')::date, v_customer_id,
        r->>'customer_name', r->>'vehicle_reg_no', r->>'chassis_no',
        nullif(r->>'payment_terms',''), (r->>'net_paise')::bigint,
        (r->>'tax_paise')::bigint, (r->>'total_paise')::bigint,
        nullif(r->>'cancelled_flag',''), nullif(r->>'irn_no',''),
        coalesce(r->>'status','active'), (p_batch->>'source_pulled_at')::timestamptz, v_batch_id
      );
      v_new := v_new + 1;

    ELSIF v_existing.customer_id IS DISTINCT FROM v_customer_id THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'invoice_number', r->>'invoice_number',
        'reason', 'the customer changed — an invoice number has been reused, or this is a different export',
        'was', v_existing.customer_name, 'now', r->>'customer_name');

    ELSIF (r->>'total_paise')::bigint < v_existing.allocated_paise THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'invoice_number', r->>'invoice_number',
        'reason', 'the new total is below what is already allocated against it',
        'total_paise', (r->>'total_paise')::bigint,
        'allocated_paise', v_existing.allocated_paise);

    -- A bill SAP now marks cancelled (or otherwise no longer payable) while
    -- money is matched to it. Applying it would leave that payment settling a
    -- bill that no longer exists -- and nothing would say so. Refused; the
    -- match is reversed first, deliberately, by a person. (2026-09-26)
    ELSIF coalesce(r->>'status','active') <> 'active'
      AND v_existing.status = 'active'
      AND v_existing.allocated_paise > 0 THEN
      v_conflicts := v_conflicts || jsonb_build_object(
        'invoice_number', r->>'invoice_number',
        'reason', 'SAP now marks it ' || coalesce(r->>'status','active') ||
                  ', but money is already matched to it -- reverse that match first',
        'allocated_paise', v_existing.allocated_paise);

    ELSIF v_existing.total_paise <> (r->>'total_paise')::bigint
       OR v_existing.status IS DISTINCT FROM coalesce(r->>'status','active')
       OR v_existing.cancelled_flag IS DISTINCT FROM nullif(r->>'cancelled_flag','') THEN
      UPDATE public.service_invoices
         SET total_paise    = (r->>'total_paise')::bigint,
             net_paise      = (r->>'net_paise')::bigint,
             tax_paise      = (r->>'tax_paise')::bigint,
             status         = coalesce(r->>'status','active'),
             cancelled_flag = nullif(r->>'cancelled_flag',''),
             updated_at     = now()
       WHERE id = v_existing.id;
      v_amended := v_amended + 1;
    ELSE
      v_unchanged := v_unchanged + 1;
    END IF;
  END LOOP;

  UPDATE public.payment_import_batches
     SET counts = jsonb_build_object('new', v_new, 'amended', v_amended,
                                     'unchanged', v_unchanged,
                                     'conflicts', jsonb_array_length(v_conflicts))
   WHERE id = v_batch_id;

  INSERT INTO public.payment_events (entity_id, event_type, actor_id, actor_name, batch_id, detail)
  VALUES (p_entity_id, 'import', p_actor, v_actor_name, v_batch_id,
          jsonb_build_object('kind','invoices','new',v_new,'amended',v_amended,
                             'unchanged',v_unchanged,'conflicts',v_conflicts));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'new', v_new, 'amended', v_amended,
                            'unchanged', v_unchanged, 'conflicts', v_conflicts);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payments_import_receipts(
  p_entity_id uuid,
  p_rows      jsonb,
  p_batch     jsonb,
  p_actor     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r            jsonb;
  v_batch_id   uuid;
  v_new        integer := 0;
  v_dupe       integer := 0;
  v_linked     integer := 0;
  v_held       jsonb   := '[]'::jsonb;
  v_id         uuid;
  v_manual     public.payment_receipts%ROWTYPE;
  v_actor_name text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  INSERT INTO public.payment_import_batches (
    entity_id, kind, source, file_name, file_hash, parser_version,
    row_count, payload, uploaded_by
  ) VALUES (
    p_entity_id, 'receipts', coalesce(p_batch->>'source','upi'),
    p_batch->>'file_name', p_batch->>'file_hash',
    coalesce(p_batch->>'parser_version','unknown'),
    jsonb_array_length(p_rows), p_rows, p_actor
  )
  RETURNING id INTO v_batch_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    -- 1. The same export row, already stored.
    PERFORM 1 FROM public.payment_receipts
      WHERE entity_id = p_entity_id AND source = r->>'source'
        AND external_txn_id = nullif(r->>'external_txn_id','');
    IF FOUND THEN
      v_dupe := v_dupe + 1;
      CONTINUE;
    END IF;

    -- 2. The same money keyed in BY HAND during a parser outage. The manual
    --    RPC always stores source = 'manual', so the first version of this
    --    function -- which looked only for its OWN source -- never recognised
    --    it and inserted the payment a second time (2026-09-26). Link it
    --    instead: back-fill what only the file knows, never touch its amount.
    SELECT * INTO v_manual FROM public.payment_receipts
     WHERE entity_id = p_entity_id AND source = 'manual' AND status = 'active'
       AND external_txn_id = nullif(r->>'external_txn_id','')
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      IF v_manual.import_batch_id IS NULL THEN
        UPDATE public.payment_receipts
           SET gross_paise     = coalesce(gross_paise, (r->>'gross_paise')::bigint),
               fee_paise       = coalesce(fee_paise,   (r->>'fee_paise')::bigint),
               normalized_utr  = coalesce(normalized_utr, nullif(r->>'normalized_utr','')),
               payer_remark    = coalesce(payer_remark,  nullif(r->>'payer_remark','')),
               import_batch_id = v_batch_id,
               updated_at      = now()
         WHERE id = v_manual.id;
        v_linked := v_linked + 1;
      ELSE
        v_dupe := v_dupe + 1;
      END IF;
      CONTINUE;
    END IF;

    -- 3. The id held by ANOTHER import source, or the UTR by any other active
    --    receipt: two records claim the same money. Held and named -- never a
    --    second copy, and never an exception that throws away the whole file.
    PERFORM 1 FROM public.payment_receipts
      WHERE entity_id = p_entity_id AND status = 'active'
        AND external_txn_id = nullif(r->>'external_txn_id','');
    IF FOUND THEN
      v_held := v_held || jsonb_build_object('external_txn_id', r->>'external_txn_id',
        'reason', 'this transaction id is already recorded under another source');
      CONTINUE;
    END IF;
    IF nullif(r->>'normalized_utr','') IS NOT NULL THEN
      PERFORM 1 FROM public.payment_receipts
        WHERE entity_id = p_entity_id AND status = 'active'
          AND normalized_utr = r->>'normalized_utr';
      IF FOUND THEN
        v_held := v_held || jsonb_build_object('external_txn_id', r->>'external_txn_id',
          'reason', 'this UTR is already recorded on another receipt');
        CONTINUE;
      END IF;
    END IF;

    -- 4. New money. ON CONFLICT stays as the last line of defence against a
    --    concurrent import of the same file.
    INSERT INTO public.payment_receipts (
      entity_id, mode, source, amount_paise, gross_paise, fee_paise, received_at,
      external_txn_id, normalized_utr, payer_name, payer_remark, import_batch_id,
      entered_by
    ) VALUES (
      p_entity_id, coalesce(r->>'mode','upi'), r->>'source',
      (r->>'amount_paise')::bigint, (r->>'gross_paise')::bigint,
      (r->>'fee_paise')::bigint, (r->>'received_at')::timestamptz,
      nullif(r->>'external_txn_id',''), nullif(r->>'normalized_utr',''),
      nullif(r->>'payer_name',''), nullif(r->>'payer_remark',''), v_batch_id, p_actor
    )
    ON CONFLICT (entity_id, source, external_txn_id)
      WHERE external_txn_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN v_dupe := v_dupe + 1; ELSE v_new := v_new + 1; END IF;
    v_id := NULL;
  END LOOP;

  UPDATE public.payment_import_batches
     SET counts = jsonb_build_object('new', v_new, 'already_present', v_dupe,
                                     'already_present_manual', v_linked,
                                     'held', jsonb_array_length(v_held))
   WHERE id = v_batch_id;

  INSERT INTO public.payment_events (entity_id, event_type, actor_id, actor_name, batch_id, detail)
  VALUES (p_entity_id, 'import', p_actor, v_actor_name, v_batch_id,
          jsonb_build_object('kind','receipts','new',v_new,'already_present',v_dupe,
                             'already_present_manual',v_linked,'held',v_held));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'new', v_new,
                            'already_present', v_dupe, 'already_present_manual', v_linked,
                            'held', v_held);
END;
$fn$;

-- Restated so this file is correct on its own (CREATE OR REPLACE keeps them).
REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) TO service_role;
