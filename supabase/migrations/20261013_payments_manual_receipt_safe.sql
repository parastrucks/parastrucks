-- ============================================================================
-- Service Payments — a cash or cheque receipt is saved once, and cash of
-- ₹2 lakh or more is refused (2026-10-13)
--
-- payments_manual_receipt is how accounts records money that did not come
-- through the HDFC report: cash at the counter, a cheque, a bank transfer.
-- Until now nothing called it; the new "Cash & cheque" tab does. Two defects
-- that mattered only once a screen could reach it:
--
-- 1. NO PROTECTION AGAINST A REPEAT. Every other write carries a
--    client_request_id so a retried request returns the first answer
--    (payments_allocate: "a phone on a workshop connection retries POSTs").
--    This one inserted unconditionally and took the next gap-free receipt
--    number each time — so a dropped answer plus "Save" again made a SECOND
--    receipt for the same cash, under a second number. (Found by the cloud
--    review of 2026-10-13; the PC's brief had wrongly said every write was
--    protected.) Now: p_client_request_id, a repeat returns the first receipt
--    and its number, and a repeat that disagrees about the money is refused.
--    An advisory lock on the id makes two identical requests arriving
--    together queue rather than both pass the check, so no number is burnt.
--
-- 2. NO CASH LIMIT. Section 269ST of the Income Tax Act: receiving ₹2,00,000
--    or more in cash from one person in one transaction (or in a day, or for
--    one event) is penalised at 100% of the amount — on the dealership. The
--    plan carried it (service-payments-plan.md §"₹2L cash hard-block"); no code
--    did. Owner, 2026-10-15 (revising the 2026-10-13 "refuse"): one cash
--    receipt of ₹2,00,000 or more needs a REASON and is marked as a 269ST case
--    for the GM (payment_events.detail.sec_269st) — refusing to record cash
--    already in the drawer would only hide it from the books and the tie-out
--    (pre-mortem 2, G3). The per-payer-per-day total is WARNED on the form.
--
-- REVISED 2026-10-15, before prod, after pre-mortem 2: the 269ST rule above,
-- and a repeat must agree on EVERY typed field, not just amount and mode (G4);
-- the answer carries what was saved. Staging took the revised function by
-- CREATE OR REPLACE (same signature); prod takes this file once.
--
-- Also: the hand-entered-UPI message named BharatPe and Google Pay, both
-- retired (owner, 2026-10-09). It now asks for the HDFC bank reference (RRN),
-- which is what payments_import_receipts links a hand-entered payment by.
--
-- Additive except the function's signature: one nullable column, one partial
-- unique index, and the function replaced. The old three-argument version is
-- DROPPED in the same transaction — CREATE with a new argument list makes an
-- overload, not a replacement, and the Edge Function's named-argument call
-- would then be ambiguous. No row is touched.
-- ============================================================================

BEGIN;

ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN public.payment_receipts.client_request_id IS
  'Hand-entered receipts only: the caller''s id for this save, so a retried request returns the first receipt instead of creating a second (payments_manual_receipt).';

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_client_request_key
  ON public.payment_receipts (entity_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.payments_manual_receipt(uuid, jsonb, uuid);

-- ── Manual receipt ──────────────────────────────────────────────────────────
-- Cash, cheque and net-banking are keyed in by accounts. A manual UPI entry
-- REQUIRES the bank reference -- it exists only to bridge a missing report,
-- and without it the HDFC import later cannot recognise it as the same money
-- and would double-count it.
CREATE OR REPLACE FUNCTION public.payments_manual_receipt(
  p_entity_id         uuid,
  p_row               jsonb,
  p_actor             uuid,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id         uuid;
  v_serial     text;
  v_fy         integer;
  v_received   timestamptz := coalesce((p_row->>'received_at')::timestamptz, now());
  v_mode       text := p_row->>'mode';
  v_amount     bigint := (p_row->>'amount_paise')::bigint;
  v_payer      text := nullif(btrim(p_row->>'payer_name'), '');
  v_ref        text := nullif(btrim(p_row->>'instrument_ref'), '');
  v_outlet     uuid := nullif(p_row->>'outlet_id', '')::uuid;
  v_note       text := nullif(btrim(p_row->>'notes'), '');
  v_reason     text := nullif(btrim(p_row->>'cash_limit_reason'), '');
  v_prev       public.payment_receipts%ROWTYPE;
  v_actor_name text;
BEGIN
  -- Idempotency first, under a lock on the id: a repeat waits for the first
  -- to commit, then finds it. Nothing below runs twice for one save.
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('payments_manual_receipt:' || p_client_request_id::text, 0));
    SELECT * INTO v_prev FROM public.payment_receipts
     WHERE entity_id = p_entity_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      -- A repeat must be the SAME receipt in every field the clerk typed — a
      -- save retried after a lost answer with a corrected name or day would
      -- otherwise get the first receipt back, silently (pre-mortem 2, G4).
      -- The day is compared as the India day: "today" is stamped with the
      -- moment of each attempt.
      IF v_prev.amount_paise <> v_amount
         OR v_prev.mode IS DISTINCT FROM v_mode
         OR v_prev.payer_name IS DISTINCT FROM v_payer
         OR v_prev.instrument_ref IS DISTINCT FROM v_ref
         OR v_prev.outlet_id IS DISTINCT FROM v_outlet
         OR v_prev.notes IS DISTINCT FROM v_note
         OR (v_prev.received_at AT TIME ZONE 'Asia/Kolkata')::date
              <> (v_received AT TIME ZONE 'Asia/Kolkata')::date THEN
        RAISE EXCEPTION
          'this save already went through as % with different details (₹%, %) — nothing new was saved. If those details were wrong, start a new entry and tell accounts to void %',
          v_prev.receipt_serial, to_char(v_prev.amount_paise / 100.0, 'FM99,99,99,990.00'),
          coalesce(v_prev.payer_name, 'no name'), v_prev.receipt_serial
          USING ERRCODE = 'unique_violation';
      END IF;
      RETURN jsonb_build_object('receipt_id', v_prev.id, 'receipt_serial', v_prev.receipt_serial,
                                'idempotent_replay', true,
                                'amount_paise', v_prev.amount_paise, 'mode', v_prev.mode,
                                'payer_name', v_prev.payer_name, 'received_at', v_prev.received_at);
    END IF;
  END IF;

  -- Section 269ST: ₹2,00,000 or more in cash from one person. Owner,
  -- 2026-10-15 (superseding a hard refusal): the money may already be in the
  -- drawer, and refusing to RECORD it would only hide it from the books and
  -- the tie-out. So it needs a reason, and is marked as a 269ST case for the GM.
  IF v_mode = 'cash' AND v_amount >= 20000000 AND v_reason IS NULL THEN
    RAISE EXCEPTION
      'Cash of ₹2,00,000 or more from one person breaks section 269ST of the Income Tax Act (the penalty is the whole amount). If it has already been taken, record it with the reason — it is flagged for the GM.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_actor;

  -- The Indian financial year the money arrived in, in IST.
  v_fy := CASE
            WHEN extract(month from (v_received AT TIME ZONE 'Asia/Kolkata')) >= 4
              THEN extract(year from (v_received AT TIME ZONE 'Asia/Kolkata'))::integer
            ELSE extract(year from (v_received AT TIME ZONE 'Asia/Kolkata'))::integer - 1
          END;

  IF v_mode = 'upi' AND coalesce(btrim(p_row->>'external_txn_id'), '') = '' THEN
    RAISE EXCEPTION
      'a hand-entered UPI payment needs its 12-digit bank reference (RRN, shown on the payer''s phone), otherwise the HDFC report import cannot tell it is the same money and will count it twice'
      USING ERRCODE = 'check_violation';
  END IF;

  v_serial := public.payments_next_receipt_serial(p_entity_id, v_fy);

  INSERT INTO public.payment_receipts (
    entity_id, outlet_id, mode, source, amount_paise, received_at, external_txn_id,
    normalized_utr, payer_name, payer_remark, instrument_ref, receipt_serial,
    entered_by, notes, client_request_id
  ) VALUES (
    p_entity_id, v_outlet, v_mode, 'manual',
    v_amount, v_received, nullif(p_row->>'external_txn_id',''),
    nullif(p_row->>'normalized_utr',''), v_payer,
    nullif(p_row->>'payer_remark',''), v_ref, v_serial,
    p_actor, v_note, p_client_request_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.payment_events (
    entity_id, event_type, actor_id, actor_name, amount_paise, receipt_id, detail
  ) VALUES (
    p_entity_id, 'manual_receipt', p_actor, v_actor_name,
    v_amount, v_id,
    jsonb_build_object('mode', v_mode, 'receipt_serial', v_serial)
      || CASE WHEN v_mode = 'cash' AND v_amount >= 20000000
              THEN jsonb_build_object('sec_269st', true, 'cash_limit_reason', v_reason)
              ELSE '{}'::jsonb END
  );

  RETURN jsonb_build_object('receipt_id', v_id, 'receipt_serial', v_serial,
                            'amount_paise', v_amount, 'mode', v_mode,
                            'payer_name', v_payer, 'received_at', v_received,
                            'sec_269st', v_mode = 'cash' AND v_amount >= 20000000);
END;
$fn$;

-- Supabase grants EXECUTE to anon on creation; only the Edge Function's
-- service-role client may call this.
REVOKE ALL ON FUNCTION public.payments_manual_receipt(uuid, jsonb, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_manual_receipt(uuid, jsonb, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_manual_receipt(uuid, jsonb, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_manual_receipt(uuid, jsonb, uuid, uuid) TO service_role;

COMMIT;
