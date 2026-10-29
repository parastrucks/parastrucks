-- ============================================================================
-- Service Payments — HDFC becomes the UPI source.
--
-- Apply AFTER 20260926_payments_import_rules.sql. Additive: one CHECK widened,
-- one column added, one view re-created with that column appended, one
-- function replaced (same signature). No row, column or table is removed.
--
-- From October 2026 UPI arrives on HDFC static QRs (merchant KTR510 today,
-- more QRs coming); BharatPe and Google Pay are retired (owner). Until HDFC's
-- API exists, accounts uploads the daily SmartHub Vyapar report on the Import
-- screen (src/service-payments/lib/parseHdfc.js).
--
-- 1. source 'hdfc' is allowed. The old values stay valid: past BharatPe and
--    Google Pay receipts are history, and their parsers remain for it.
-- 2. qr_ref — which QR the money arrived on ("KTR510/82388473"). With several
--    QRs it tells the branch, and RANKS bills by it, never filters (owner,
--    2026-09-11). Nullable: manual entries and old sources have none.
-- 3. payments_import_receipts recognises a hand-keyed HDFC payment by its RRN
--    as well as by the file's own id, and back-fills the QR when linking.
--    Measured reason: the report's Mintoak id is shown to nobody; the RRN is
--    what a payer's phone displays, so it is what a cashier would type.
--    A link also requires the AMOUNTS to agree: a mistyped reference that
--    happens to be another real payment's would otherwise swallow that
--    payment, and its money would never be imported. A mismatch is HELD.
--
-- Proved on staging by scripts/payments/probe-import-parity.sql (generated
-- from the Import screen's own diff code by gen-probe-import-parity.mjs).
-- ============================================================================

ALTER TABLE public.payment_receipts DROP CONSTRAINT IF EXISTS payment_receipts_source_check;
ALTER TABLE public.payment_receipts ADD CONSTRAINT payment_receipts_source_check
  CHECK (source IN ('hdfc','gpay','bharatpe','manual','bank_statement','opening_balance'));

ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS qr_ref text;
COMMENT ON COLUMN public.payment_receipts.qr_ref IS
  'Which QR the money arrived on, as merchant/terminal (HDFC: "KTR510/82388473"). Ranks bills by branch; never filters them. NULL for manual entries and pre-HDFC sources.';

-- CREATE OR REPLACE VIEW may only APPEND columns; qr_ref goes last.
CREATE OR REPLACE VIEW public.v_payments_open_receipts
WITH (security_invoker = true) AS
SELECT r.id, r.entity_id, r.mode, r.source, r.amount_paise, r.allocated_paise,
       r.amount_paise - r.allocated_paise AS open_paise,
       r.received_at, r.payer_name, r.payer_remark, r.classification, r.awaiting_invoice,
       r.qr_ref
  FROM public.payment_receipts r
 WHERE r.status = 'active'
   AND r.allocated_paise < r.amount_paise
   AND r.classification <> 'not_service';
REVOKE ALL ON public.v_payments_open_receipts FROM anon, authenticated;
GRANT SELECT ON public.v_payments_open_receipts TO authenticated;

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
    --    HDFC (from Oct 2026): the report's own id (Mintoak) is shown to
    --    nobody; what a cashier can read off the payer's phone is the 12-digit
    --    RRN. So a hand entry is also found by the file row's bank reference,
    --    whether it was typed as the transaction id or as the UTR. Without
    --    this the 2026-09-26 double count returns for every HDFC payment keyed
    --    by hand. An exact id match is preferred when both exist.
    SELECT * INTO v_manual FROM public.payment_receipts
     WHERE entity_id = p_entity_id AND source = 'manual' AND status = 'active'
       AND (external_txn_id = nullif(r->>'external_txn_id','')
            OR (nullif(r->>'normalized_utr','') IS NOT NULL
                AND (normalized_utr  = r->>'normalized_utr'
                  OR external_txn_id = r->>'normalized_utr')))
     ORDER BY (external_txn_id = nullif(r->>'external_txn_id','')) DESC NULLS LAST
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      IF v_manual.amount_paise <> (r->>'amount_paise')::bigint THEN
        v_held := v_held || jsonb_build_object('external_txn_id', r->>'external_txn_id',
          'reason', 'a hand-keyed entry has this reference but a different amount -- check which is right');
        CONTINUE;
      END IF;
      IF v_manual.import_batch_id IS NULL THEN
        UPDATE public.payment_receipts
           SET gross_paise     = coalesce(gross_paise, (r->>'gross_paise')::bigint),
               fee_paise       = coalesce(fee_paise,   (r->>'fee_paise')::bigint),
               normalized_utr  = coalesce(normalized_utr, nullif(r->>'normalized_utr','')),
               payer_remark    = coalesce(payer_remark,  nullif(r->>'payer_remark','')),
               qr_ref          = coalesce(qr_ref,        nullif(r->>'qr_ref','')),
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
      external_txn_id, normalized_utr, payer_name, payer_remark, qr_ref,
      import_batch_id, entered_by
    ) VALUES (
      p_entity_id, coalesce(r->>'mode','upi'), r->>'source',
      (r->>'amount_paise')::bigint, (r->>'gross_paise')::bigint,
      (r->>'fee_paise')::bigint, (r->>'received_at')::timestamptz,
      nullif(r->>'external_txn_id',''), nullif(r->>'normalized_utr',''),
      nullif(r->>'payer_name',''), nullif(r->>'payer_remark',''), nullif(r->>'qr_ref',''),
      v_batch_id, p_actor
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

REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.payments_import_receipts(uuid, jsonb, jsonb, uuid) TO service_role;
