-- ============================================================================
-- Service Payments — "Something else" says what it is (2026-10-18)
--
-- When accounts sets a payment aside as "not a service payment", it picks a
-- reason (vehicle booking advance, sister concern, refund returned, test or
-- top-up, not a customer payment, something else). "Something else" told the
-- next reader nothing: who set it aside and when, but not what the money was
-- (red team 4, R4-9: "Something else takes no note"). Owner, 2026-10-18: build
-- the note box.
--
-- payments_classify_receipt gains p_note:
--   * "Something else" (kind 'other') is REFUSED without a note — the screen
--     asks for one, but the screen is a convenience; this is the rule.
--   * Any other reason may carry a note; none is required.
--   * A note is kept only while the payment is set aside: classifying it back
--     to 'service' or 'unknown' clears it (the event log keeps every note).
--   * At most 300 characters; spaces at either end are dropped.
-- The note is stored on the receipt (payment_receipts.not_service_note, read
-- with the receipt) and in the classify event's detail (the history).
--
-- Additive except the function's signature: one nullable column and the
-- function replaced. The old five-argument version is DROPPED in the same
-- transaction — CREATE with a new argument list makes an overload, not a
-- replacement, and the Edge Function's named-argument call would then be
-- ambiguous (the same reasoning as 20261013_payments_manual_receipt_safe.sql).
-- No row is touched. p_note defaults to NULL, so an Edge Function still making
-- the old five-argument call keeps working the moment this lands — except that
-- "Something else" is then refused for want of a note, which is the point.
-- Deploy the EF that passes p_note after this, never before (the old function
-- has no p_note, so a new EF against it would fail every classify).
-- ============================================================================

BEGIN;

ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS not_service_note text;

COMMENT ON COLUMN public.payment_receipts.not_service_note IS
  'Set aside as not a service payment: what the money was, in the person''s words. Required for kind ''other'' (payments_classify_receipt); cleared when the payment is classified back.';

DROP FUNCTION IF EXISTS public.payments_classify_receipt(uuid, uuid, text, text, uuid);

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
  p_actor          uuid,
  p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_active     integer;
  v_actor_name text;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
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
    IF p_kind = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'say what the payment is: "Something else" needs a note'
        USING ERRCODE = 'check_violation';
    END IF;
    IF length(v_note) > 300 THEN
      RAISE EXCEPTION 'the note is % characters; keep it to 300', length(v_note)
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_note := NULL;
  END IF;

  UPDATE public.payment_receipts
     SET classification   = p_classification,
         not_service_kind = CASE WHEN p_classification = 'not_service' THEN p_kind ELSE NULL END,
         not_service_note = v_note,
         updated_at       = now()
   WHERE id = p_receipt_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, receipt_id, detail
  ) VALUES (
    p_entity_id, 'classify', p_actor, v_actor_name, p_receipt_id,
    jsonb_build_object('classification', p_classification, 'kind', p_kind, 'note', v_note)
  );

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'classification', p_classification, 'note', v_note);
END;
$fn$;

REVOKE ALL ON FUNCTION public.payments_classify_receipt(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_classify_receipt(uuid, uuid, text, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.payments_classify_receipt(uuid, uuid, text, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_classify_receipt(uuid, uuid, text, text, uuid, text) TO service_role;

COMMIT;
