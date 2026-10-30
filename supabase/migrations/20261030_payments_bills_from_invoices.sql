-- ============================================================================
-- ONE TOOL — the bills of an uploaded invoice enter matching the same day.
--
-- Owner, 2026-10-30 ("Both, invoices first"): accounts uploads the HDFC report
-- and the SAP Billing Report (month to date) every morning; the bills of every
-- invoice PDF uploaded on Invoices & Payments go into matching AT ONCE, and the
-- Billing Report fills in the rest and the cancellations.
--   * Confirm still waits for the Billing Report that covers the payment's day
--     (owner: "Wait for the Billing Report") — the stale-bills brake reads
--     payment_import_batches only, and a PDF makes no batch, so it is untouched.
--
-- Apply AFTER the nine payments migrations and 20261024_gate_invoices.sql.
--
-- 1. service_invoices.origin — 'billing_report' (every row so far) or
--    'invoice_pdf' (born from gate_bills); gate_bill_id links the PDF bill.
-- 2. payments_bills_from_gate_document(document_id) — service role only, called
--    by gate-invoices after every save (and every repeat of one, so a failed
--    call heals on the next upload). Idempotent: a bill already in
--    service_invoices is left exactly as it is.
--      · kind from the bill-number prefix, the Billing Report parser's own map
--        (PCS/PCR/LCS/LCR/MPI/MCI); anything else (free of cost, returns, an
--        unknown prefix) is NOT made a bill here and is named in `skipped`.
--      · only PTB's two plants (5756 Ahmedabad, 6370 Anand) — the Import
--        screen's plant gate; another company's bills are skipped.
--      · the customer by SAP code IGNORING LEADING ZEROS (the PDF and the report
--        may print the code at different widths — unproven on real files).
-- 3. payments_import_invoices — a Billing Report row whose bill came from a PDF
--    TAKES THE ROW OVER (counted `confirmed`): every Billing Report field is
--    written, origin becomes 'billing_report', the customer becomes the
--    report's. The same refusals still come first: a different customer
--    (codes compared ignoring leading zeros), a total below what is matched, a
--    cancellation under matched money. Everything else is the 20260926 body.
--    ⭐ This daily take-over IS the proof the owner asked for: a PDF bill number
--    that is not the Billing Report invoice number never gets confirmed, and the
--    Import screen lists it.
--
-- Proved by scripts/payments/probe-import-parity.sql (the preview == server,
-- now with PDF-born rows) and scripts/payments/probe-bills-from-invoices.sql.
--
-- Rollback (manual; needs owner approval — it drops the PDF link):
--   re-apply 20260926_payments_import_rules.sql's payments_import_invoices;
--   drop function public.payments_bills_from_gate_document(uuid);
--   alter table public.service_invoices drop column gate_bill_id, drop column origin;
-- ============================================================================

BEGIN;

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'billing_report',
  ADD COLUMN IF NOT EXISTS gate_bill_id uuid REFERENCES public.gate_bills(id);
ALTER TABLE public.service_invoices
  DROP CONSTRAINT IF EXISTS service_invoices_origin_check;
ALTER TABLE public.service_invoices
  ADD CONSTRAINT service_invoices_origin_check CHECK (origin IN ('billing_report','invoice_pdf'));
COMMENT ON COLUMN public.service_invoices.origin IS
  'billing_report = imported from the SAP Billing Report. invoice_pdf = made from an invoice PDF uploaded on Invoices & Payments (gate_bills), waiting for the Billing Report to take it over (payments_import_invoices).';


-- ── 2. The bills of one uploaded invoice ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payments_bills_from_gate_document(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  d          public.gate_documents%ROWTYPE;
  b          public.gate_bills%ROWTYPE;
  v_customer uuid;
  v_prefix   text;
  v_kind     text;
  v_terms    text;
  v_type     text;
  v_plant    text;
  v_city     text;
  v_outlet   uuid;
  v_id       uuid;
  v_added    integer := 0;
  v_already  integer := 0;
  v_skipped  jsonb   := '[]'::jsonb;
BEGIN
  SELECT * INTO d FROM public.gate_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such invoice upload'; END IF;

  FOR b IN SELECT * FROM public.gate_bills WHERE document_id = d.id ORDER BY bill_no LOOP
    v_prefix := upper(left(b.bill_no, 3));
    -- The Billing Report parser's PREFIX_MAP (parseBillingReport.js), payable rows only.
    SELECT k.kind, k.terms, k.btype INTO v_kind, v_terms, v_type
      FROM (VALUES ('PCS','service_parts','cash','ZMSI'),  ('PCR','service_parts','credit','ZMSI'),
                   ('LCS','service_labour','cash','ZMSI'), ('LCR','service_labour','credit','ZMSI'),
                   ('MPI','counter_sale','cash','ZMPI'),   ('MCI','counter_sale','credit','ZMCI'))
           AS k(prefix, kind, terms, btype)
     WHERE k.prefix = v_prefix;
    IF v_kind IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('bill_no', b.bill_no,
        'why', 'not a bill a customer pays, or a kind matching does not know (' || v_prefix || ')');
      CONTINUE;
    END IF;

    v_plant := substr(b.bill_no, 4, 4);
    v_city := CASE v_plant WHEN '5756' THEN 'ahmedabad' WHEN '6370' THEN 'anand' END;
    IF v_city IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('bill_no', b.bill_no,
        'why', 'plant ' || v_plant || ' is not set up for matching');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.service_invoices
                WHERE entity_id = d.entity_id AND invoice_number = b.bill_no) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    IF v_customer IS NULL THEN
      SELECT id INTO v_customer FROM public.customers
       WHERE entity_id = d.entity_id
         AND ltrim(sap_customer_code, '0') = ltrim(d.sap_customer_code, '0')
       ORDER BY (sap_customer_code = d.sap_customer_code) DESC, first_seen_at
       LIMIT 1;
      IF v_customer IS NULL THEN
        INSERT INTO public.customers (entity_id, sap_customer_code, display_name, gstin, pan)
        VALUES (d.entity_id, d.sap_customer_code, d.customer_name,
                nullif(d.customer_gstin, ''), nullif(d.customer_pan, ''))
        RETURNING id INTO v_customer;
      END IF;
    END IF;

    SELECT id INTO v_outlet FROM public.outlets
     WHERE entity_id = d.entity_id AND is_active AND lower(city) = v_city
     ORDER BY label LIMIT 1;

    INSERT INTO public.service_invoices (
      entity_id, outlet_id, sap_plant, invoice_number, invoice_kind, sap_billing_type,
      job_ref, invoice_date, customer_id, customer_name, vehicle_reg_no, chassis_no,
      payment_terms, net_paise, tax_paise, total_paise, status, origin, gate_bill_id
    ) VALUES (
      d.entity_id, v_outlet, v_plant, b.bill_no, v_kind, v_type,
      -- One job card's bills share one key, so parts + labour are offered as one
      -- order until the Billing Report writes SAP's own order number over it.
      CASE WHEN d.layout = 'workshop' THEN coalesce(d.order_no, d.doc_no) END,
      b.bill_date, v_customer, d.customer_name, d.regn_no, d.chassis_no,
      coalesce(b.terms, v_terms), b.ex_tax_paise,
      CASE WHEN b.ex_tax_paise IS NULL THEN NULL ELSE b.amount_paise - b.ex_tax_paise END,
      b.amount_paise, 'active', 'invoice_pdf', b.id
    )
    ON CONFLICT (entity_id, invoice_number) DO NOTHING   -- an import racing this one
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN v_already := v_already + 1; ELSE v_added := v_added + 1; END IF;
    v_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('added', v_added, 'already', v_already, 'skipped', v_skipped);
END;
$fn$;

REVOKE ALL ON FUNCTION public.payments_bills_from_gate_document(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_bills_from_gate_document(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_bills_from_gate_document(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_bills_from_gate_document(uuid) TO service_role;


-- ── 3. The Billing Report takes a PDF-born bill over ─────────────────────────
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
  v_was_code     text;
  v_found        boolean;
  v_new          integer := 0;
  v_amended      integer := 0;
  v_unchanged    integer := 0;
  v_confirmed    integer := 0;
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
    -- Kept now: the next SELECT would overwrite FOUND.
    v_found := FOUND;
    v_was_code := NULL;
    IF v_found THEN
      SELECT sap_customer_code INTO v_was_code FROM public.customers WHERE id = v_existing.customer_id;
    END IF;

    IF NOT v_found THEN
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

    -- A PDF-born bill's customer was found by the PDF's code; the report may
    -- print the same code at another width. Any other difference is a clash.
    ELSIF v_existing.customer_id IS DISTINCT FROM v_customer_id
      AND NOT (v_existing.origin = 'invoice_pdf'
               AND ltrim(coalesce(v_was_code, ''), '0') = ltrim(r->>'sap_customer_code', '0')) THEN
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

    -- The Billing Report takes over a bill that came from an uploaded PDF:
    -- SAP's record replaces the PDF's, field for field. (2026-10-30)
    ELSIF v_existing.origin = 'invoice_pdf' THEN
      UPDATE public.service_invoices
         SET outlet_id        = coalesce(nullif(r->>'outlet_id','')::uuid, outlet_id),
             sap_plant        = r->>'sap_plant',
             sap_billing_doc  = r->>'sap_billing_doc',
             invoice_kind     = r->>'invoice_kind',
             sap_billing_type = r->>'sap_billing_type',
             split_order_type = r->>'split_order_type',
             job_ref          = r->>'job_ref',
             dealer_order_no  = r->>'dealer_order_no',
             invoice_date     = (r->>'invoice_date')::date,
             customer_id      = v_customer_id,
             customer_name    = r->>'customer_name',
             vehicle_reg_no   = coalesce(r->>'vehicle_reg_no', vehicle_reg_no),
             chassis_no       = coalesce(r->>'chassis_no', chassis_no),
             payment_terms    = nullif(r->>'payment_terms',''),
             net_paise        = (r->>'net_paise')::bigint,
             tax_paise        = (r->>'tax_paise')::bigint,
             total_paise      = (r->>'total_paise')::bigint,
             cancelled_flag   = nullif(r->>'cancelled_flag',''),
             irn_no           = nullif(r->>'irn_no',''),
             status           = coalesce(r->>'status','active'),
             source_pulled_at = (p_batch->>'source_pulled_at')::timestamptz,
             import_batch_id  = v_batch_id,
             origin           = 'billing_report',
             updated_at       = now()
       WHERE id = v_existing.id;
      v_confirmed := v_confirmed + 1;

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
                                     'unchanged', v_unchanged, 'confirmed', v_confirmed,
                                     'conflicts', jsonb_array_length(v_conflicts))
   WHERE id = v_batch_id;

  INSERT INTO public.payment_events (entity_id, event_type, actor_id, actor_name, batch_id, detail)
  VALUES (p_entity_id, 'import', p_actor, v_actor_name, v_batch_id,
          jsonb_build_object('kind','invoices','new',v_new,'amended',v_amended,
                             'unchanged',v_unchanged,'confirmed',v_confirmed,
                             'conflicts',v_conflicts));

  RETURN jsonb_build_object('batch_id', v_batch_id, 'new', v_new, 'amended', v_amended,
                            'unchanged', v_unchanged, 'confirmed', v_confirmed,
                            'conflicts', v_conflicts);
END;
$fn$;

REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_import_invoices(uuid, jsonb, jsonb, uuid) TO service_role;


-- ── The invoices already uploaded (staging: the DEMO ones) ───────────────────
SELECT public.payments_bills_from_gate_document(id) FROM public.gate_documents;

COMMIT;
