-- ============================================================================
-- Service Payments — three read views the Match screen needs.
--
-- Apply AFTER 20260926_payments_read_gates_and_route.sql. Additive only: three
-- CREATE OR REPLACE VIEWs. No table, column or row is touched.
--
-- WHY VIEWS. The Match screen runs on a phone on a workshop connection, and the
-- question it asks is "which receipts are not fully matched, and which bills
-- are still open". Both are a column-vs-column comparison (allocated_paise <
-- amount_paise), which PostgREST cannot express as a filter. Without these the
-- client would have to download every receipt and bill ever recorded and throw
-- most of them away — a payload that grows every day, forever.
--
-- 1. v_payments_open_receipts / v_payments_open_invoices are SECURITY INVOKER:
--    they run as the caller, so the base tables' RLS applies unchanged. They
--    add no access; they only pre-filter. They use the partial indexes
--    payment_receipts_queue_idx and service_invoices_open_idx, whose WHERE
--    clauses they repeat.
--
-- 2. v_payments_feed_status is a DEFINER view carrying its own predicate, like
--    v_payments_customers_lite. It exposes ONE fact per entity and kind — when
--    the feed last landed — because the staleness brake on the Match screen
--    needs it and payment_import_batches (file names, payloads, uploaders) is
--    back-office-only. A service executive may know THAT bills are two days
--    old; they have no business reading the batch that says so.
--
--    covered_until = the SAP export time when the batch recorded one, else the
--    upload time. The Import screen must send source_pulled_at: an export run
--    on Saturday and uploaded on Monday would otherwise claim Monday coverage.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_payments_open_receipts
WITH (security_invoker = true) AS
SELECT r.id,
       r.entity_id,
       r.mode,
       r.source,
       r.amount_paise,
       r.allocated_paise,
       r.amount_paise - r.allocated_paise AS open_paise,
       r.received_at,
       r.payer_name,
       r.payer_remark,
       r.classification,
       r.awaiting_invoice
  FROM public.payment_receipts r
 WHERE r.status = 'active'
   AND r.allocated_paise < r.amount_paise
   AND r.classification <> 'not_service';

COMMENT ON VIEW public.v_payments_open_receipts IS
  'Receipts with money still to place. SECURITY INVOKER: the caller''s own RLS on payment_receipts applies; this view only pre-filters what PostgREST cannot (allocated < amount).';

CREATE OR REPLACE VIEW public.v_payments_open_invoices
WITH (security_invoker = true) AS
SELECT i.id,
       i.entity_id,
       i.invoice_number,
       i.invoice_kind,
       i.job_ref,
       i.dealer_order_no,
       i.sap_billing_doc,
       i.invoice_date,
       i.customer_id,
       i.customer_name,
       i.vehicle_reg_no,
       i.payment_terms,
       i.total_paise,
       i.allocated_paise,
       i.total_paise - i.allocated_paise AS open_paise,
       i.status
  FROM public.service_invoices i
 WHERE i.status = 'active'
   AND i.allocated_paise < i.total_paise;

COMMENT ON VIEW public.v_payments_open_invoices IS
  'Bills with money still owed. SECURITY INVOKER: the caller''s own RLS on service_invoices applies; this view only pre-filters (allocated < total).';

CREATE OR REPLACE VIEW public.v_payments_feed_status AS
SELECT b.entity_id,
       b.kind,
       max(b.uploaded_at)                               AS last_uploaded_at,
       max(coalesce(b.source_pulled_at, b.uploaded_at)) AS covered_until
  FROM public.payment_import_batches b
 WHERE b.status = 'committed'
   AND b.kind IN ('invoices','receipts')
   AND ((SELECT public.current_user_role()) = 'admin'
        OR (b.entity_id = (SELECT public.get_my_entity_id())
            AND (SELECT public.payments_can_read())))
 GROUP BY b.entity_id, b.kind;

COMMENT ON VIEW public.v_payments_feed_status IS
  'When each feed last landed, per entity. Definer view with its own predicate: it exposes two timestamps from the back-office-only batch table so the Match screen can brake on stale bills, and nothing else.';

-- The two open-list views are single-table, so Postgres makes them
-- auto-updatable, and Supabase's default privileges grant INSERT/UPDATE/DELETE
-- on new objects to authenticated. A write would still fail on the base table's
-- privileges (security_invoker), but "no write path outside the RPCs" should
-- be true at every layer, not resting on the one below. SELECT only.
REVOKE ALL ON public.v_payments_open_receipts FROM anon, authenticated;
REVOKE ALL ON public.v_payments_open_invoices FROM anon, authenticated;
REVOKE ALL ON public.v_payments_feed_status   FROM anon, authenticated;
GRANT SELECT ON public.v_payments_open_receipts TO authenticated;
GRANT SELECT ON public.v_payments_open_invoices TO authenticated;
GRANT SELECT ON public.v_payments_feed_status   TO authenticated;
