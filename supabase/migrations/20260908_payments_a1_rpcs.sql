-- ============================================================================
-- Service Payments — Phase A1 money logic
--
-- Requires 20260830_payments_a1_schema.sql.
--
-- ⚠️ NOT YET EXECUTED ANYWHERE. The Supabase MCP is read-only for the portal
-- project, staging (klpnhpnlotcbbovwswmq) is paused and times out, and this
-- worktree has no database password. Everything here is written and reviewed
-- but UNRUN. Do not treat it as working until it has been applied to staging
-- and scripts/payments/probe-allocation.sql has been run against it.
--
-- WHY THESE ARE FUNCTIONS AND NOT CLIENT WRITES. A PL/pgSQL body is one
-- transaction. Allocating a payment touches three rows -- the allocation, the
-- receipt's cache, the invoice's cache -- and a client doing that in three
-- PostgREST calls can be interrupted between any two, leaving a receipt that
-- says it is spent against an invoice that says it is unpaid. There is no
-- compensating logic that gets that right afterwards, so the only correct
-- version is the one that cannot half-happen.
--
-- EVERY function here:
--   · is SECURITY DEFINER with a pinned search_path
--   · is REVOKEd from PUBLIC, anon AND authenticated (Supabase grants EXECUTE
--     to anon on creation; revoking from PUBLIC alone leaves the door open)
--   · takes the actor as an argument rather than reading auth.uid(), because it
--     is called by the Edge Function with the service role, which has no uid
--   · writes a row to payment_events before it returns
--   · locks rows with SELECT ... FOR UPDATE in ONE deterministic order --
--     receipt first, then invoices ascending by id -- so two clerks confirming
--     overlapping work deadlock never, and serialise always
-- ============================================================================


-- ── Gap-free receipt serials ────────────────────────────────────────────────
-- A sequence is the wrong tool: sequences gap on rollback, and a gap in a
-- receipt book is the first thing an auditor asks about. One counter row per
-- entity per financial year, locked for the duration of the transaction, so a
-- serial is only consumed by a receipt that actually commits.
CREATE OR REPLACE FUNCTION public.payments_next_receipt_serial(
  p_entity_id uuid,
  p_fy_start  integer
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_seq  integer;
  v_code text;
BEGIN
  SELECT code INTO v_code FROM public.entities WHERE id = p_entity_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'unknown entity %', p_entity_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO public.payment_receipt_counters (entity_id, fy_start, last_seq)
  VALUES (p_entity_id, p_fy_start, 1)
  ON CONFLICT (entity_id, fy_start)
  DO UPDATE SET last_seq = public.payment_receipt_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN 'CR-' || v_code || '-' || p_fy_start::text || '-' || lpad(v_seq::text, 5, '0');
END;
$fn$;


-- ── Invoice import ──────────────────────────────────────────────────────────
-- Takes the parser's output verbatim (src/service-payments/lib/parseBillingReport.js)
-- and reports six outcomes. The parser has already refused anything malformed;
-- this decides new vs amended vs unchanged, and refuses the amendments that are
-- really collisions.
--
-- An "amendment" that changes the customer, or shrinks a total below what is
-- already allocated against it, is not an amendment. It means the invoice
-- number has been reused or the export is of something else, and applying it
-- would silently move money between customers.
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


-- ── Receipt import ──────────────────────────────────────────────────────────
-- Idempotent by construction: a re-uploaded file inserts nothing twice, because
-- (entity, source, external_txn_id) is unique and the conflict is counted
-- rather than raised. Re-importing the same day's file is a NORMAL thing for a
-- tired person to do at 9am, not an error to punish.
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
  v_id         uuid;
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

    IF v_id IS NULL THEN
      -- Already present. If it was keyed in by hand during a parser outage,
      -- back-fill the fields only the file knows and link it to this batch, so
      -- it stops looking like an orphan -- but never touch its amount.
      UPDATE public.payment_receipts
         SET gross_paise    = coalesce(gross_paise, (r->>'gross_paise')::bigint),
             fee_paise      = coalesce(fee_paise,   (r->>'fee_paise')::bigint),
             normalized_utr = coalesce(normalized_utr, nullif(r->>'normalized_utr','')),
             payer_remark   = coalesce(payer_remark,  nullif(r->>'payer_remark','')),
             updated_at     = now()
       WHERE entity_id = p_entity_id
         AND source = r->>'source'
         AND external_txn_id = r->>'external_txn_id'
         AND import_batch_id IS NULL;
      IF FOUND THEN v_linked := v_linked + 1; ELSE v_dupe := v_dupe + 1; END IF;
    ELSE
      v_new := v_new + 1;
    END IF;
    v_id := NULL;
  END LOOP;

  UPDATE public.payment_import_batches
     SET counts = jsonb_build_object('new', v_new, 'already_present', v_dupe,
                                     'already_present_manual', v_linked)
   WHERE id = v_batch_id;

  INSERT INTO public.payment_events (entity_id, event_type, actor_id, actor_name, batch_id, detail)
  VALUES (p_entity_id, 'import', p_actor, v_actor_name, v_batch_id,
          jsonb_build_object('kind','receipts','new',v_new,'already_present',v_dupe,
                             'already_present_manual',v_linked));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'new', v_new,
                            'already_present', v_dupe, 'already_present_manual', v_linked);
END;
$fn$;


-- ── THE ALLOCATION ──────────────────────────────────────────────────────────
-- One receipt settles one or more invoices. The many-invoice case is the
-- ordinary one, not an edge case: 245 of 836 measured orders bill as parts AND
-- labour and the customer pays the combined total in a single UPI transfer.
--
-- p_targets: [{"invoice_id": "...", "amount_paise": 123}, ...]
--            amount_paise may be omitted, in which case the invoice's full
--            outstanding is taken.
CREATE OR REPLACE FUNCTION public.payments_allocate(
  p_entity_id         uuid,
  p_receipt_id        uuid,
  p_targets           jsonb,
  p_actor             uuid,
  p_client_request_id uuid DEFAULT NULL,
  p_match_signal      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_receipt    public.payment_receipts%ROWTYPE;
  v_invoice    public.service_invoices%ROWTYPE;
  v_ids        uuid[];
  v_id         uuid;
  v_want       bigint;
  v_open       bigint;
  v_total      bigint := 0;
  v_created    jsonb  := '[]'::jsonb;
  v_alloc_id   uuid;
  v_actor_name text;
BEGIN
  -- Idempotency first. A phone on a workshop connection retries POSTs; the
  -- second one must return the first one's answer, not allocate again.
  IF p_client_request_id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('allocation_id', id, 'invoice_id', invoice_id,
                                        'amount_paise', amount_paise))
      INTO v_created
      FROM public.payment_allocations
     WHERE client_request_id = p_client_request_id;
    IF v_created IS NOT NULL THEN
      RETURN jsonb_build_object('allocations', v_created, 'idempotent_replay', true);
    END IF;
    v_created := '[]'::jsonb;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  -- Deterministic lock order: the receipt, then invoices ascending by id.
  SELECT * INTO v_receipt FROM public.payment_receipts
   WHERE id = p_receipt_id AND entity_id = p_entity_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % not found in this entity', p_receipt_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_receipt.status <> 'active' THEN
    RAISE EXCEPTION 'receipt % is %, so it cannot be allocated', p_receipt_id, v_receipt.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(x ORDER BY x)
    INTO v_ids
    FROM (SELECT (t->>'invoice_id')::uuid AS x
            FROM jsonb_array_elements(p_targets) t) s;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no invoices given' USING ERRCODE = 'check_violation';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_invoice FROM public.service_invoices
     WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice % not found', v_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Three-way entity equality. Money must never cross an entity boundary,
    -- and the caller's own entity is checked by the Edge Function before this.
    IF v_invoice.entity_id <> p_entity_id THEN
      RAISE EXCEPTION 'invoice % belongs to another entity', v_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_invoice.status <> 'active' THEN
      RAISE EXCEPTION 'invoice % is % and cannot take a payment', v_id, v_invoice.status
        USING ERRCODE = 'check_violation';
    END IF;

    v_open := v_invoice.total_paise - v_invoice.allocated_paise;

    SELECT coalesce((t->>'amount_paise')::bigint, v_open)
      INTO v_want
      FROM jsonb_array_elements(p_targets) t
     WHERE (t->>'invoice_id')::uuid = v_id
     LIMIT 1;

    IF v_want <= 0 THEN
      RAISE EXCEPTION 'allocation to invoice % must be positive, got %', v_id, v_want
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_want > v_open THEN
      RAISE EXCEPTION 'invoice % has % paise outstanding but % was allocated', v_id, v_open, v_want
        USING ERRCODE = 'check_violation';
    END IF;

    v_total := v_total + v_want;

    INSERT INTO public.payment_allocations (
      entity_id, alloc_type, receipt_id, invoice_id, customer_id, amount_paise,
      allocated_by, client_request_id, match_signal
    ) VALUES (
      p_entity_id, 'payment', p_receipt_id, v_id, v_invoice.customer_id, v_want,
      p_actor, p_client_request_id, p_match_signal
    )
    RETURNING id INTO v_alloc_id;

    UPDATE public.service_invoices
       SET allocated_paise = allocated_paise + v_want, updated_at = now()
     WHERE id = v_id;

    v_created := v_created || jsonb_build_object('allocation_id', v_alloc_id,
                                                 'invoice_id', v_id, 'amount_paise', v_want);

    INSERT INTO public.payment_events (
      entity_id, event_type, actor_id, actor_name, amount_paise,
      receipt_id, invoice_id, allocation_id, customer_id, detail
    ) VALUES (
      p_entity_id, 'allocate', p_actor, v_actor_name, v_want,
      p_receipt_id, v_id, v_alloc_id, v_invoice.customer_id,
      jsonb_build_object('match_signal', p_match_signal)
    );
  END LOOP;

  IF v_total > (v_receipt.amount_paise - v_receipt.allocated_paise) THEN
    RAISE EXCEPTION 'receipt has % paise unallocated but % was allocated',
      v_receipt.amount_paise - v_receipt.allocated_paise, v_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- Allocating IS the classification. Somebody just said this is service money
  -- by pointing it at a service bill; making them also tick a box would be
  -- asking a question already answered.
  UPDATE public.payment_receipts
     SET allocated_paise  = allocated_paise + v_total,
         classification   = CASE WHEN classification = 'unknown' THEN 'service' ELSE classification END,
         awaiting_invoice = false,
         updated_at       = now()
   WHERE id = p_receipt_id;

  RETURN jsonb_build_object('allocations', v_created, 'allocated_paise', v_total,
                            'idempotent_replay', false);
END;
$fn$;


-- ── Reversal ────────────────────────────────────────────────────────────────
-- A mistake is REVERSED, never edited and never deleted, so the diary always
-- reads forward and an auditor can see what was believed at the time.
CREATE OR REPLACE FUNCTION public.payments_reverse_allocation(
  p_allocation_id uuid,
  p_actor         uuid,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_alloc      public.payment_allocations%ROWTYPE;
  v_actor_name text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reversal must say why' USING ERRCODE = 'check_violation';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  -- The predicate carries `reversed_at IS NULL` so a double-submit reverses
  -- once, rather than reversing and then silently un-doing the cache twice.
  SELECT * INTO v_alloc FROM public.payment_allocations
   WHERE id = p_allocation_id AND reversed_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'allocation % not found, or already reversed', p_allocation_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.payment_allocations
     SET reversed_at = now(), reversed_by = p_actor, reverse_reason = p_reason
   WHERE id = p_allocation_id;

  IF v_alloc.invoice_id IS NOT NULL THEN
    UPDATE public.service_invoices
       SET allocated_paise = allocated_paise - v_alloc.amount_paise, updated_at = now()
     WHERE id = v_alloc.invoice_id;
  END IF;

  IF v_alloc.receipt_id IS NOT NULL THEN
    UPDATE public.payment_receipts
       SET allocated_paise = allocated_paise - v_alloc.amount_paise, updated_at = now()
     WHERE id = v_alloc.receipt_id;
  END IF;

  -- A reversal that has already been exported to Busy cannot be un-sent; it
  -- travels in the next file as a contra entry instead. Flagged here so the
  -- export knows to carry it.
  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise,
    receipt_id, invoice_id, allocation_id, detail
  ) VALUES (
    v_alloc.entity_id, 'reverse', p_actor, v_actor_name, v_alloc.amount_paise,
    v_alloc.receipt_id, v_alloc.invoice_id, p_allocation_id,
    jsonb_build_object('reason', p_reason,
                       'was_exported', v_alloc.export_batch_id IS NOT NULL)
  );

  RETURN jsonb_build_object('allocation_id', p_allocation_id,
                            'needs_contra_export', v_alloc.export_batch_id IS NOT NULL);
END;
$fn$;


-- ── On account ──────────────────────────────────────────────────────────────
-- Money attributed to a customer group with no bill named yet: an advance, or a
-- payment against an opening balance. It sits visibly rather than being forced
-- onto a bill that does not exist.
CREATE OR REPLACE FUNCTION public.payments_on_account(
  p_entity_id  uuid,
  p_receipt_id uuid,
  p_group_id   uuid,
  p_amount     bigint,
  p_actor      uuid,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_receipt    public.payment_receipts%ROWTYPE;
  v_open       bigint;
  v_alloc_id   uuid;
  v_actor_name text;
BEGIN
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_alloc_id FROM public.payment_allocations
     WHERE client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('allocation_id', v_alloc_id, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  SELECT * INTO v_receipt FROM public.payment_receipts
   WHERE id = p_receipt_id AND entity_id = p_entity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % not found', p_receipt_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_receipt.status <> 'active' THEN
    RAISE EXCEPTION 'receipt % is %', p_receipt_id, v_receipt.status USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM public.customer_groups WHERE id = p_group_id AND entity_id = p_entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer group % not found in this entity', p_group_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_open := v_receipt.amount_paise - v_receipt.allocated_paise;
  IF p_amount <= 0 OR p_amount > v_open THEN
    RAISE EXCEPTION 'receipt has % paise unallocated, cannot place % on account', v_open, p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.payment_allocations (
    entity_id, alloc_type, receipt_id, group_id, amount_paise, allocated_by, client_request_id
  ) VALUES (
    p_entity_id, 'on_account', p_receipt_id, p_group_id, p_amount, p_actor, p_client_request_id
  ) RETURNING id INTO v_alloc_id;

  UPDATE public.payment_receipts
     SET allocated_paise = allocated_paise + p_amount,
         classification  = CASE WHEN classification = 'unknown' THEN 'service' ELSE classification END,
         updated_at      = now()
   WHERE id = p_receipt_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, receipt_id,
    allocation_id, group_id, detail
  ) VALUES (
    p_entity_id, 'allocate', p_actor, v_actor_name, p_amount, p_receipt_id,
    v_alloc_id, p_group_id, jsonb_build_object('alloc_type','on_account')
  );

  RETURN jsonb_build_object('allocation_id', v_alloc_id, 'idempotent_replay', false);
END;
$fn$;


-- ── TDS closure ─────────────────────────────────────────────────────────────
-- A company customer deducts tax at source, so the last slice of the bill never
-- arrives as money. Capped at 5% of the invoice: real TDS on these services is
-- 1-2%, so anything larger is a short payment wearing a TDS label, and short
-- payments ride the customer's ledger (owner: no write-offs).
CREATE OR REPLACE FUNCTION public.payments_close_tds(
  p_entity_id uuid,
  p_invoice_id uuid,
  p_amount    bigint,
  p_actor     uuid,
  p_allow_over_cap boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_invoice    public.service_invoices%ROWTYPE;
  v_open       bigint;
  v_cap        bigint;
  v_alloc_id   uuid;
  v_actor_name text;
BEGIN
  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  SELECT * INTO v_invoice FROM public.service_invoices
   WHERE id = p_invoice_id AND entity_id = p_entity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice % not found', p_invoice_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_invoice.status <> 'active' THEN
    RAISE EXCEPTION 'invoice % is %', p_invoice_id, v_invoice.status USING ERRCODE = 'check_violation';
  END IF;

  v_open := v_invoice.total_paise - v_invoice.allocated_paise;
  v_cap  := (v_invoice.total_paise * 5) / 100;

  IF p_amount <= 0 OR p_amount > v_open THEN
    RAISE EXCEPTION 'invoice has % paise outstanding, cannot close % as TDS', v_open, p_amount
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount > v_cap AND NOT p_allow_over_cap THEN
    RAISE EXCEPTION
      'TDS of % paise is more than 5%% of the invoice (cap % paise). Real TDS here is 1-2%%; a larger gap is a short payment and belongs on the customer ledger. A GM can override.',
      p_amount, v_cap USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.payment_allocations (
    entity_id, alloc_type, invoice_id, customer_id, amount_paise, allocated_by, notes
  ) VALUES (
    p_entity_id, 'tds', p_invoice_id, v_invoice.customer_id, p_amount, p_actor,
    CASE WHEN p_amount > v_cap THEN 'over the 5% cap, allowed by GM' ELSE NULL END
  ) RETURNING id INTO v_alloc_id;

  UPDATE public.service_invoices
     SET allocated_paise = allocated_paise + p_amount, updated_at = now()
   WHERE id = p_invoice_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, invoice_id,
    allocation_id, customer_id, detail
  ) VALUES (
    p_entity_id, 'allocate', p_actor, v_actor_name, p_amount, p_invoice_id,
    v_alloc_id, v_invoice.customer_id,
    jsonb_build_object('alloc_type','tds',
                       'pct_of_invoice', round((p_amount::numeric * 100) / nullif(v_invoice.total_paise,0), 2),
                       'over_cap', p_amount > v_cap)
  );

  RETURN jsonb_build_object('allocation_id', v_alloc_id, 'over_cap', p_amount > v_cap);
END;
$fn$;


-- ── Classification ──────────────────────────────────────────────────────────
-- Marking money "not a service payment" while it is allocated to service bills
-- is a contradiction, and the database is the right place to say so.
--
-- not_service money is NOT dropped: it still travels to Busy in its own section
-- as a payable to whichever unit it belongs to. Dropping it would mean the bank
-- reconciliation can never tie, which is how a tool stops being trusted.
CREATE OR REPLACE FUNCTION public.payments_classify_receipt(
  p_entity_id      uuid,
  p_receipt_id     uuid,
  p_classification text,
  p_kind           text,
  p_actor          uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_active     integer;
  v_actor_name text;
BEGIN
  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  PERFORM 1 FROM public.payment_receipts
   WHERE id = p_receipt_id AND entity_id = p_entity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % not found', p_receipt_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_classification = 'not_service' THEN
    SELECT count(*) INTO v_active FROM public.payment_allocations
     WHERE receipt_id = p_receipt_id AND reversed_at IS NULL;
    IF v_active > 0 THEN
      RAISE EXCEPTION
        'this receipt is allocated to % service bill(s); reverse those before marking it not-service',
        v_active USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.payment_receipts
     SET classification   = p_classification,
         not_service_kind = CASE WHEN p_classification = 'not_service' THEN p_kind ELSE NULL END,
         updated_at       = now()
   WHERE id = p_receipt_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, receipt_id, detail
  ) VALUES (
    p_entity_id, 'classify', p_actor, v_actor_name, p_receipt_id,
    jsonb_build_object('classification', p_classification, 'kind', p_kind)
  );

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'classification', p_classification);
END;
$fn$;


-- ── Manual receipt ──────────────────────────────────────────────────────────
-- Cash, cheque and net-banking are keyed in by accounts. A manual UPI entry
-- REQUIRES the app's transaction id -- it exists only to bridge a parser
-- outage, and without the id the file import later cannot recognise it as the
-- same money and would double-count it.
CREATE OR REPLACE FUNCTION public.payments_manual_receipt(
  p_entity_id uuid,
  p_row       jsonb,
  p_actor     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id         uuid;
  v_serial     text;
  v_fy         integer;
  v_received   timestamptz;
  v_mode       text := p_row->>'mode';
  v_actor_name text;
BEGIN
  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  v_received := coalesce((p_row->>'received_at')::timestamptz, now());
  -- The Indian financial year the money arrived in, in IST.
  v_fy := CASE
            WHEN extract(month from (v_received AT TIME ZONE 'Asia/Kolkata')) >= 4
              THEN extract(year from (v_received AT TIME ZONE 'Asia/Kolkata'))::integer
            ELSE extract(year from (v_received AT TIME ZONE 'Asia/Kolkata'))::integer - 1
          END;

  IF v_mode = 'upi' AND coalesce(btrim(p_row->>'external_txn_id'), '') = '' THEN
    RAISE EXCEPTION
      'a manual UPI receipt needs the app transaction id (BharatPe: the 12-digit UTR; Google Pay: its transaction code), otherwise the file import cannot tell it is the same money and will count it twice'
      USING ERRCODE = 'check_violation';
  END IF;

  v_serial := public.payments_next_receipt_serial(p_entity_id, v_fy);

  INSERT INTO public.payment_receipts (
    entity_id, outlet_id, mode, source, amount_paise, received_at, external_txn_id,
    normalized_utr, payer_name, payer_remark, instrument_ref, receipt_serial,
    entered_by, notes
  ) VALUES (
    p_entity_id, nullif(p_row->>'outlet_id','')::uuid, v_mode, 'manual',
    (p_row->>'amount_paise')::bigint, v_received, nullif(p_row->>'external_txn_id',''),
    nullif(p_row->>'normalized_utr',''), nullif(p_row->>'payer_name',''),
    nullif(p_row->>'payer_remark',''), nullif(p_row->>'instrument_ref',''), v_serial,
    p_actor, nullif(p_row->>'notes','')
  ) RETURNING id INTO v_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, receipt_id, detail
  ) VALUES (
    p_entity_id, 'manual_receipt', p_actor, v_actor_name,
    (p_row->>'amount_paise')::bigint, v_id,
    jsonb_build_object('mode', v_mode, 'receipt_serial', v_serial)
  );

  RETURN jsonb_build_object('receipt_id', v_id, 'receipt_serial', v_serial);
END;
$fn$;


-- ── Void ────────────────────────────────────────────────────────────────────
-- A bounced cheque is a void with a reason, not a deletion and not a new
-- status. Refused while allocations stand, so the invoices it settled cannot be
-- left silently paid by money that went away.
CREATE OR REPLACE FUNCTION public.payments_void_receipt(
  p_entity_id  uuid,
  p_receipt_id uuid,
  p_reason     text,
  p_actor      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_active     integer;
  v_amount     bigint;
  v_actor_name text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a void must say why' USING ERRCODE = 'check_violation';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  SELECT amount_paise INTO v_amount FROM public.payment_receipts
   WHERE id = p_receipt_id AND entity_id = p_entity_id AND status = 'active'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % not found or already voided', p_receipt_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_active FROM public.payment_allocations
   WHERE receipt_id = p_receipt_id AND reversed_at IS NULL;
  IF v_active > 0 THEN
    RAISE EXCEPTION
      'this receipt still settles % bill(s); reverse those first, or those bills would stay paid by money that has gone',
      v_active USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.payment_receipts
     SET status = 'voided', voided_at = now(), voided_by = p_actor,
         void_reason = p_reason, updated_at = now()
   WHERE id = p_receipt_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, receipt_id, detail
  ) VALUES (
    p_entity_id, 'void_receipt', p_actor, v_actor_name, v_amount, p_receipt_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'status', 'voided');
END;
$fn$;


-- ── Lock the doors ──────────────────────────────────────────────────────────
-- Supabase grants EXECUTE to anon on function creation, so revoking from PUBLIC
-- alone leaves anon and authenticated able to call these. Only the Edge
-- Function's service-role client may.
DO $revoke$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'payments_next_receipt_serial','payments_import_invoices',
         'payments_import_receipts','payments_allocate','payments_reverse_allocation',
         'payments_on_account','payments_close_tds','payments_classify_receipt',
         'payments_manual_receipt','payments_void_receipt')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END
$revoke$;
