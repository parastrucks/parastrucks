-- ============================================================================
-- ONE TOOL — do an uploaded invoice's bills reach matching, and only the right ones?
-- Proves payments_bills_from_gate_document (20261030_payments_bills_from_invoices.sql).
--
--   npx supabase@2.109.1 db query --linked --workdir <scratch>/sb -f <ABSOLUTE path to this file>
--
-- WRITES NOTHING: it ends by raising "PROBE COMPLETE", which rolls everything
-- back, and carries its failures in that message (the CLI shows no NOTICEs).
-- Staging only. Creates only ZZPROBE rows and touches no existing row.
--
-- Negative control: scripts/invoices/make-bills-probe-mutant.mjs swaps in a
-- function that matches the customer code EXACTLY (as the PDF prints it); the
-- run must then fail.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.zz_fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.fails', current_setting('zz.fails', true) || ' | ' || msg, true);
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.zz_check(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('zz.checks', (coalesce(nullif(current_setting('zz.checks', true), ''), '0')::int + 1)::text, true);
  IF got IS DISTINCT FROM want THEN
    PERFORM pg_temp.zz_fail(label || ': got ' || coalesce(got, 'null') || ', want ' || coalesce(want, 'null'));
  END IF;
END $f$;

DO $probe$
DECLARE
  v_entity  uuid;
  v_actor   uuid;
  v_doc     uuid;
  v_doc2    uuid;
  v_known   uuid;
  v_res     jsonb;
  v_n       bigint;
  v_t       text;
  v_fails   text;
  v_sha     text := repeat('ab', 32);
BEGIN
  PERFORM set_config('zz.fails', '', true);
  PERFORM set_config('zz.checks', '0', true);
  -- MUTANT-HOOK
  SELECT id INTO v_entity FROM public.entities WHERE code = 'PTB';
  SELECT id INTO v_actor FROM public.users WHERE permission_level = 'admin' LIMIT 1;
  IF v_entity IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'need the PTB entity and an admin'; END IF;
  IF EXISTS (SELECT 1 FROM public.gate_documents WHERE doc_no LIKE 'ZZPROBE%')
  OR EXISTS (SELECT 1 FROM public.service_invoices WHERE invoice_number LIKE '%ZZPROBE%')
  OR EXISTS (SELECT 1 FROM public.customers WHERE sap_customer_code LIKE '%ZZBC%') THEN
    RAISE EXCEPTION 'ZZPROBE rows already exist — refusing to run over them';
  END IF;

  -- The customer as the Billing Report prints the code; the PDF pads it with zeros.
  INSERT INTO public.customers (entity_id, sap_customer_code, display_name)
  VALUES (v_entity, 'ZZBC1', 'ZZ PROBE BILLS') RETURNING id INTO v_known;
  -- A bill the Billing Report already brought in, with ITS amount.
  INSERT INTO public.service_invoices (entity_id, invoice_number, invoice_kind, invoice_date, customer_id,
    customer_name, total_paise, status)
  VALUES (v_entity, 'LCS5756ZZPROBE05', 'service_labour', DATE '2026-10-29', v_known, 'ZZ PROBE BILLS', 123400, 'active');

  -- ── A workshop job: labour (cash) at Ahmedabad, parts (credit) at Anand, a free-of-cost
  --    bill, a bill from a plant matching does not know, and the one already imported.
  INSERT INTO public.gate_documents (entity_id, layout, sap_form, doc_no, doc_date, order_no,
    sap_customer_code, customer_name, regn_no, chassis_no, total_paise, file_path, file_sha256, file_bytes, uploaded_by)
  VALUES (v_entity, 'workshop', 'ZDBMF_COVERING_LETTER_001', 'ZZPROBE-JC1', DATE '2026-10-29', 'ZZORD1',
    '00ZZBC1', 'ZZ PROBE BILLS', 'GJ01ZZ9999', 'ZZCHASSIS', 1000000, 'zzprobe/jc1.pdf', v_sha, 1, v_actor)
  RETURNING id INTO v_doc;
  INSERT INTO public.gate_bills (document_id, entity_id, bill_no, bill_date, amount_paise, ex_tax_paise, terms) VALUES
    (v_doc, v_entity, 'LCS5756ZZPROBE01', DATE '2026-10-29', 118000, 100000, NULL),
    (v_doc, v_entity, 'PCR6370ZZPROBE02', DATE '2026-10-29', 236000, 200000, NULL),
    (v_doc, v_entity, 'PEI5756ZZPROBE03', DATE '2026-10-29', 50000, NULL, NULL),
    (v_doc, v_entity, 'MPI9999ZZPROBE04', DATE '2026-10-29', 60000, NULL, NULL),
    (v_doc, v_entity, 'LCS5756ZZPROBE05', DATE '2026-10-29', 999900, NULL, NULL);

  v_res := public.payments_bills_from_gate_document(v_doc);
  PERFORM pg_temp.zz_check('first call: added', v_res->>'added', '2');
  PERFORM pg_temp.zz_check('first call: already in matching', v_res->>'already', '1');
  PERFORM pg_temp.zz_check('first call: skipped (free of cost + unknown plant)', jsonb_array_length(v_res->'skipped')::text, '2');
  PERFORM pg_temp.zz_check('the free-of-cost bill is named as skipped',
    (SELECT count(*)::text FROM jsonb_array_elements(v_res->'skipped') s WHERE s->>'bill_no' = 'PEI5756ZZPROBE03'), '1');
  PERFORM pg_temp.zz_check('the unknown plant is named as skipped',
    (SELECT count(*)::text FROM jsonb_array_elements(v_res->'skipped') s
      WHERE s->>'bill_no' = 'MPI9999ZZPROBE04' AND s->>'why' LIKE '%9999%'), '1');

  SELECT invoice_kind || '/' || payment_terms || '/' || sap_billing_type || '/' || sap_plant || '/' || origin || '/' ||
         status || '/' || job_ref || '/' || net_paise || '/' || tax_paise || '/' || total_paise || '/' || vehicle_reg_no
    INTO v_t FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number = 'LCS5756ZZPROBE01';
  PERFORM pg_temp.zz_check('labour bill, as the Billing Report would call it',
    v_t, 'service_labour/cash/ZMSI/5756/invoice_pdf/active/ZZORD1/100000/18000/118000/GJ01ZZ9999');
  SELECT invoice_kind || '/' || payment_terms || '/' || sap_plant || '/' || job_ref
    INTO v_t FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number = 'PCR6370ZZPROBE02';
  PERFORM pg_temp.zz_check('parts bill: credit, Anand, the same job key (offered as one order)', v_t, 'service_parts/credit/6370/ZZORD1');
  SELECT count(*) INTO v_n FROM public.service_invoices
   WHERE entity_id = v_entity AND invoice_number IN ('LCS5756ZZPROBE01','PCR6370ZZPROBE02') AND customer_id = v_known;
  PERFORM pg_temp.zz_check('both found the customer the report already knew, despite the zeros', v_n::text, '2');
  SELECT count(*) INTO v_n FROM public.customers WHERE entity_id = v_entity AND sap_customer_code LIKE '%ZZBC1';
  PERFORM pg_temp.zz_check('...and no second customer was made for the padded code', v_n::text, '1');
  SELECT count(*) INTO v_n FROM public.service_invoices s JOIN public.gate_bills b ON b.id = s.gate_bill_id
   WHERE s.entity_id = v_entity AND b.document_id = v_doc;
  PERFORM pg_temp.zz_check('each made bill points at its PDF bill', v_n::text, '2');
  SELECT count(*) INTO v_n FROM public.service_invoices s
   WHERE s.entity_id = v_entity AND s.invoice_number = 'LCS5756ZZPROBE01'
     AND s.outlet_id IS NOT DISTINCT FROM (SELECT id FROM public.outlets WHERE entity_id = v_entity AND is_active
                                           AND lower(city) = 'ahmedabad' ORDER BY label LIMIT 1);
  PERFORM pg_temp.zz_check('the Ahmedabad plant files the bill at the Ahmedabad outlet', v_n::text, '1');
  SELECT total_paise::text || '/' || origin INTO v_t FROM public.service_invoices
   WHERE entity_id = v_entity AND invoice_number = 'LCS5756ZZPROBE05';
  PERFORM pg_temp.zz_check('a bill the Billing Report brought keeps ITS amount and origin', v_t, '123400/billing_report');
  SELECT count(*) INTO v_n FROM public.service_invoices
   WHERE entity_id = v_entity AND invoice_number IN ('PEI5756ZZPROBE03','MPI9999ZZPROBE04');
  PERFORM pg_temp.zz_check('nothing made for the skipped bills', v_n::text, '0');

  -- ── The same save again (a repeat upload): nothing doubles.
  v_res := public.payments_bills_from_gate_document(v_doc);
  PERFORM pg_temp.zz_check('second call: added', v_res->>'added', '0');
  PERFORM pg_temp.zz_check('second call: already', v_res->>'already', '3');
  SELECT count(*) INTO v_n FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number LIKE '%ZZPROBE%';
  PERFORM pg_temp.zz_check('still exactly three bills', v_n::text, '3');

  -- ── A counter sale from a new customer: its own customer, no job key, the PDF's terms.
  INSERT INTO public.gate_documents (entity_id, layout, sap_form, doc_no, doc_date, payment_terms,
    sap_customer_code, customer_name, total_paise, file_path, file_sha256, file_bytes, uploaded_by)
  VALUES (v_entity, 'counter_sale', 'ZSF_RETAIL_INVOICE_GST_NEW', 'ZZPROBE-MCI', DATE '2026-10-29', 'credit',
    'ZZBC2', 'ZZ PROBE COUNTER', 59000, 'zzprobe/mci.pdf', v_sha, 1, v_actor)
  RETURNING id INTO v_doc2;
  INSERT INTO public.gate_bills (document_id, entity_id, bill_no, bill_date, amount_paise, ex_tax_paise, terms)
  VALUES (v_doc2, v_entity, 'MCI5756ZZPROBE06', DATE '2026-10-29', 59000, 50000, 'credit');
  v_res := public.payments_bills_from_gate_document(v_doc2);
  PERFORM pg_temp.zz_check('counter sale: added', v_res->>'added', '1');
  SELECT s.invoice_kind || '/' || s.payment_terms || '/' || coalesce(s.job_ref, 'none') || '/' || c.sap_customer_code
    INTO v_t FROM public.service_invoices s JOIN public.customers c ON c.id = s.customer_id
   WHERE s.entity_id = v_entity AND s.invoice_number = 'MCI5756ZZPROBE06';
  PERFORM pg_temp.zz_check('counter sale: its kind, the PDF terms, no job key, a new customer', v_t, 'counter_sale/credit/none/ZZBC2');

  -- ── The Billing Report then takes the labour bill over (codes at its own width).
  v_res := public.payments_import_invoices(v_entity, jsonb_build_array(jsonb_build_object(
    'invoice_number','LCS5756ZZPROBE01','sap_customer_code','ZZBC1','customer_name','ZZ PROBE BILLS',
    'invoice_kind','service_labour','invoice_date','2026-10-29','payment_terms','cash','sap_plant','5756',
    'sap_billing_type','ZMSI','job_ref','7000000001','net_paise',100000,'tax_paise',18000,'total_paise',118000,
    'status','active')), '{"source":"probe","parser_version":"probe"}'::jsonb, v_actor);
  PERFORM pg_temp.zz_check('the report confirms the uploaded bill', v_res->>'confirmed', '1');
  SELECT origin || '/' || job_ref || '/' || (import_batch_id IS NOT NULL)::text INTO v_t
    FROM public.service_invoices WHERE entity_id = v_entity AND invoice_number = 'LCS5756ZZPROBE01';
  PERFORM pg_temp.zz_check('...and now holds SAP''s record (order number, batch)', v_t, 'billing_report/7000000001/true');

  -- ── Who may call it: the Edge Function only.
  PERFORM pg_temp.zz_check('signed-in users cannot call it',
    has_function_privilege('authenticated', 'public.payments_bills_from_gate_document(uuid)', 'EXECUTE')::text, 'false');
  PERFORM pg_temp.zz_check('anonymous callers cannot call it',
    has_function_privilege('anon', 'public.payments_bills_from_gate_document(uuid)', 'EXECUTE')::text, 'false');
  PERFORM pg_temp.zz_check('the service role can',
    has_function_privilege('service_role', 'public.payments_bills_from_gate_document(uuid)', 'EXECUTE')::text, 'true');

  v_fails := current_setting('zz.fails', true);
  RAISE EXCEPTION 'PROBE COMPLETE — % checks, % failed. Nothing was written; this rollback is deliberate.%',
    current_setting('zz.checks', true),
    CASE WHEN v_fails = '' THEN 0 ELSE array_length(string_to_array(ltrim(v_fails, ' |'), ' | '), 1) END,
    CASE WHEN v_fails = '' THEN '' ELSE E'\nFAILURES' || v_fails END;
END
$probe$;
