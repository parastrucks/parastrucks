-- ============================================================================
-- Service Payments — "Bill not raised yet" (2026-10-12)
--
-- A customer often pays before the job card is billed: the payment arrives
-- today, the bill tomorrow or later. Until now the Match screen could only Skip
-- such a payment, so it came back every morning as unfinished work.
--
-- The schema already had the flag (payment_receipts.awaiting_invoice, "the
-- advances flag — excluded from pending, shown as an amber chip") and
-- payments_allocate already clears it on a match. Nothing could SET it. This
-- adds the one write that does.
--
-- Marking a payment as waiting moves no money and classifies nothing: it says
-- "not yet". So it follows the matching rule, not the accounts-only rule —
-- service and accounts for UPI, accounts for cash/cheque/bank (enforced in the
-- Edge Function, authority.ts: set_awaiting_invoice + allocateModeAllowed).
--
-- WHEN it was marked matters. A waiting payment leaves the daily queue and
-- comes back only when a bill imported AFTER it was marked could be its own
-- ("the matcher re-offers it when invoices import"). Without the time, a
-- ₹1,930 payment marked while four ₹1,930 bills were open would bounce straight
-- back every morning — the very nagging this exists to stop.
--
-- Additive only: one event type joins the log's allowed list (all fourteen
-- existing types kept), one nullable column (awaiting_since), one column
-- appended to each open-items view (the views keep every existing column, in
-- order, and stay SECURITY INVOKER), and one function. Nothing is dropped except
-- the CHECK constraint that is immediately re-created wider.
-- ============================================================================

ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS awaiting_since timestamptz;

-- Same columns as 20261009_payments_hdfc_source.sql, plus awaiting_since.
CREATE OR REPLACE VIEW public.v_payments_open_receipts
WITH (security_invoker = true) AS
SELECT r.id, r.entity_id, r.mode, r.source, r.amount_paise, r.allocated_paise,
       r.amount_paise - r.allocated_paise AS open_paise,
       r.received_at, r.payer_name, r.payer_remark, r.classification, r.awaiting_invoice,
       r.qr_ref, r.awaiting_since
  FROM public.payment_receipts r
 WHERE r.status = 'active'
   AND r.allocated_paise < r.amount_paise
   AND r.classification <> 'not_service';

-- Same columns as 20260926_payments_views_for_match.sql, plus created_at: when
-- the bill first arrived, which is what "imported since it was marked" compares.
CREATE OR REPLACE VIEW public.v_payments_open_invoices
WITH (security_invoker = true) AS
SELECT i.id, i.entity_id, i.invoice_number, i.invoice_kind, i.job_ref, i.dealer_order_no,
       i.sap_billing_doc, i.invoice_date, i.customer_id, i.customer_name, i.vehicle_reg_no,
       i.payment_terms, i.total_paise, i.allocated_paise,
       i.total_paise - i.allocated_paise AS open_paise,
       i.status, i.created_at
  FROM public.service_invoices i
 WHERE i.status = 'active'
   AND i.allocated_paise < i.total_paise;

ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_event_type_check;
ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_event_type_check
  CHECK (event_type IN (
    'import','classify','allocate','reverse','bounce_back','export',
    'manual_receipt','void_receipt','group_edit','limit_edit',
    'limit_breach','cancel_invoice','revert_batch','cash_tieout',
    'awaiting_invoice'));

CREATE OR REPLACE FUNCTION public.payments_set_awaiting_invoice(
  p_entity_id  uuid,
  p_receipt_id uuid,
  p_awaiting   boolean,
  p_actor      uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_r          public.payment_receipts%ROWTYPE;
  v_actor_name text;
BEGIN
  IF p_awaiting IS NULL THEN
    RAISE EXCEPTION 'awaiting must be true or false' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  SELECT * INTO v_r FROM public.payment_receipts
   WHERE id = p_receipt_id AND entity_id = p_entity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt % not found', p_receipt_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Only money that is genuinely still unplaced can be waiting for a bill.
  -- Clearing the flag is always allowed: it can only make the queue longer.
  IF p_awaiting THEN
    IF v_r.status <> 'active' THEN
      RAISE EXCEPTION 'this payment has been voided' USING ERRCODE = 'check_violation';
    END IF;
    IF v_r.allocated_paise >= v_r.amount_paise THEN
      RAISE EXCEPTION 'this payment is already fully matched — nothing is left waiting for a bill'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_r.classification = 'not_service' THEN
      RAISE EXCEPTION 'this payment was set aside as not a service payment'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Asking twice (a retried tap, a dropped connection) changes nothing and
  -- logs nothing.
  IF v_r.awaiting_invoice = p_awaiting THEN
    RETURN jsonb_build_object('receipt_id', p_receipt_id, 'awaiting_invoice', p_awaiting, 'changed', false);
  END IF;

  -- payments_allocate clears the flag on a match but leaves awaiting_since
  -- as it was; it means nothing once the flag is false, and is reset here the
  -- next time the payment is marked.
  UPDATE public.payment_receipts
     SET awaiting_invoice = p_awaiting,
         awaiting_since   = CASE WHEN p_awaiting THEN now() ELSE NULL END,
         updated_at       = now()
   WHERE id = p_receipt_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, receipt_id, detail
  ) VALUES (
    p_entity_id, 'awaiting_invoice', p_actor, v_actor_name,
    v_r.amount_paise - v_r.allocated_paise, p_receipt_id,
    jsonb_build_object('awaiting_invoice', p_awaiting)
  );

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'awaiting_invoice', p_awaiting, 'changed', true);
END;
$fn$;

-- Supabase grants EXECUTE to anon on creation; only the Edge Function's
-- service-role client may call this.
REVOKE ALL ON FUNCTION public.payments_set_awaiting_invoice(uuid, uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_set_awaiting_invoice(uuid, uuid, boolean, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_set_awaiting_invoice(uuid, uuid, boolean, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_set_awaiting_invoice(uuid, uuid, boolean, uuid) TO service_role;
