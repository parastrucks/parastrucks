-- ============================================================================
-- Service Payments — Phase A1 schema
--
-- Plan of record: docs/backlog/service-payments-plan.md (v4).
-- Clean-room red-team digest: docs/backlog/service-payments-redteam3-cleanroom.md
--
-- WHAT THIS IS. SAP raises the invoices and Busy keeps the statutory books.
-- This schema owns exactly one thing in between: THE ALLOCATION OF PAYMENTS TO
-- INVOICES -- the question "which bill did this UPI credit pay?" that today
-- costs a person most of a morning. Everything here exists to answer it, to
-- keep a customer-group ledger honest while doing so, and to hand Busy a file.
--
-- ADDITIVE ONLY. Fourteen new tables, two views, one trigger, three functions,
-- one extension. Nothing existing is dropped, altered or renamed.
--
-- MONEY IS bigint PAISE. Every amount column. The portal's legacy money
-- (quotations, proformas) is integer RUPEES -- those two worlds must only ever
-- meet through src/service-payments/lib/paise.js. Floats never appear.
--
-- DATES ARE Asia/Kolkata. SAP gives a billing DATE and no time, permanently
-- (owner, final), so invoice_date is a bare date on purpose -- there is no
-- timestamp to lose. Receipts DO carry a real instant. Any day-bucketing in SQL
-- must read (ts AT TIME ZONE 'Asia/Kolkata')::date, never ::date on a UTC ts.
--
-- CHECK LISTS ARE DELIBERATELY COMPLETE. A CHECK cannot be widened without a
-- table rewrite once there is data, so every enumeration below lists the values
-- Phase B and C will need, not just A1's.
-- ============================================================================

-- btree_gist backs the EXCLUDE constraint that makes "one group per customer at
-- any instant" a DATABASE guarantee rather than an application convention. Two
-- GMs regrouping the same customer concurrently is exactly the case an
-- application-level check loses.
-- Installed into `extensions`, which is Supabase's convention and keeps the
-- linter quiet; that schema is in the database's default search_path, so the
-- gist operator classes resolve when the EXCLUDE constraint below is created.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- ── 1. Customer master ──────────────────────────────────────────────────────
-- Deliberately named for the whole dealership, not for service. The SAP
-- customer code identifies a customer who buys vehicles as well as repairs; a
-- future sales module should join this table, not build a second one.

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL REFERENCES public.entities(id),
  name               text NOT NULL,
  credit_limit_paise bigint CHECK (credit_limit_paise IS NULL OR credit_limit_paise >= 0),
  busy_ledger_name   text,
  -- Groups double as the contact book for the planned bills/ledgers-to-customer
  -- channel (owner). Empty arrays, never NULL, so appends need no coalesce.
  contact_emails     text[] NOT NULL DEFAULT '{}',
  contact_whatsapp   text[] NOT NULL DEFAULT '{}',
  notes              text,
  created_by         uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_groups_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_groups_entity_name_key
  ON public.customer_groups (entity_id, lower(btrim(name)));

COMMENT ON TABLE public.customer_groups IS
  'A commercial relationship spanning several SAP customer codes -- e.g. three individuals who are all one transport firm. One balance, one credit limit. Created by GM/admin only; accounts may propose (owner).';
COMMENT ON COLUMN public.customer_groups.credit_limit_paise IS
  'NULL = no limit set. Warn-only: crossing it flags, it never blocks a repair.';


CREATE TABLE IF NOT EXISTS public.customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES public.entities(id),
  -- THE identity key. Two customers with the same name are distinguished only
  -- by this, which is why the UI shows it beside every name (owner). Measured:
  -- 530 distinct codes in one month, 15 names spanning more than one code, the
  -- worst spanning four.
  sap_customer_code text NOT NULL,
  display_name      text NOT NULL,
  gstin             text,
  pan               text,
  phone             text,
  notes             text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_code_not_blank CHECK (btrim(sap_customer_code) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_entity_code_key
  ON public.customers (entity_id, sap_customer_code);
CREATE INDEX IF NOT EXISTS customers_name_idx
  ON public.customers (entity_id, lower(display_name));

COMMENT ON TABLE public.customers IS
  'One row per SAP customer code. Auto-created on invoice import into an ungrouped queue; ungrouped customers still render in Outstanding as single-customer rows -- money never hides.';


-- Temporal membership. A customer belongs to at most one group at any instant,
-- enforced by the database. Regrouping CLOSES the old row and opens a new one,
-- so a ledger can always be re-read as of a past date.
CREATE TABLE IF NOT EXISTS public.customer_group_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.customer_groups(id) ON DELETE CASCADE,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  assigned_by uuid REFERENCES public.users(id),
  reason      text,
  CONSTRAINT cgm_period_ordered CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- One group per customer per instant. An open upper bound covers the current
  -- row; '[)' means a close-and-reopen at the same instant does not collide.
  EXCLUDE USING gist (
    customer_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  )
);
CREATE INDEX IF NOT EXISTS cgm_current_idx
  ON public.customer_group_memberships (customer_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS cgm_group_current_idx
  ON public.customer_group_memberships (group_id) WHERE valid_to IS NULL;

COMMENT ON TABLE public.customer_group_memberships IS
  'Temporal group membership. The only UPDATE this table ever takes is closing valid_to; everything else is an INSERT.';


-- A grouping suggestion the curator rejected, kept so the next person is not
-- shown the same wrong pair again.
CREATE TABLE IF NOT EXISTS public.customer_group_dismissals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES public.entities(id),
  customer_a_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_b_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  reason        text,
  dismissed_by  uuid REFERENCES public.users(id),
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  -- Canonical pair order, so (a,b) and (b,a) are one row.
  CONSTRAINT cgd_ordered_pair CHECK (customer_a_id < customer_b_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cgd_pair_key
  ON public.customer_group_dismissals (customer_a_id, customer_b_id);


-- ── 2. Invoices (debit documents) ───────────────────────────────────────────
-- Mirror of the SAP Billing Report. Measured against the real file (1 Aug -
-- 29 Aug 2026, 1,085 rows): one row per invoice, counter sales included, no
-- blank or duplicate invoice numbers, Net + Tax = Total on every row, and all
-- amounts POSITIVE -- including the 12 returns, so nothing here may infer a
-- sign from an amount.

CREATE TABLE IF NOT EXISTS public.service_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES public.entities(id),
  outlet_id        uuid REFERENCES public.outlets(id),
  sap_plant        text,                     -- 5756 = Ahmedabad, 6370 = Anand (measured)
  invoice_number   text NOT NULL,            -- 'Dealer invoice number', e.g. MPI6370260000724
  sap_billing_doc  text,                     -- 'Billing Document'
  -- Prefix taxonomy, measured and in perfect bijection with SAP's billing type:
  --   PCS/PCR/LCS/LCR -> ZMSI  job-card parts and labour      667
  --   MPI             -> ZMPI  counter sale, CASH             316
  --   MCI             -> ZMCI  counter sale, CREDIT            62
  --   PEI/LEI         -> ZFCI  free of cost, NOT payable       28
  --   MPR             -> ZMPR  parts return                    12
  -- The importer derives kind from BOTH and refuses when they disagree.
  invoice_kind     text NOT NULL CHECK (invoice_kind IN (
                     'service_parts','service_labour','counter_sale',
                     'foc','parts_return','opening_balance')),
  sap_billing_type text,                     -- ZMSI / ZMPI / ZMCI / ZFCI / ZMPR
  split_order_type text,                     -- advisory only -- see the comment below
  job_ref          text,                     -- 'Order number', the 10-digit key
  dealer_order_no  text,                     -- 'Dealer specific order number'
  invoice_date     date NOT NULL,            -- date ONLY; SAP provides no time
  customer_id      uuid REFERENCES public.customers(id),
  customer_name    text,                     -- snapshot as billed
  vehicle_reg_no   text,
  chassis_no       text,
  payment_terms    text CHECK (payment_terms IS NULL OR payment_terms IN ('cash','credit')),
  net_paise        bigint CHECK (net_paise IS NULL OR net_paise >= 0),
  tax_paise        bigint CHECK (tax_paise IS NULL OR tax_paise >= 0),
  -- >= 0, not > 0: a free-of-cost invoice may legitimately total zero. The
  -- measured August file has no zero, but refusing one would break an import
  -- over a document nobody ever pays. Payable kinds are checked to be > 0 in
  -- the importer, where a zero is genuinely wrong.
  total_paise      bigint NOT NULL CHECK (total_paise >= 0),
  allocated_paise  bigint NOT NULL DEFAULT 0,
  cancelled_flag   text,                     -- verbatim SAP 'Cancelled' (blank all August)
  irn_no           text,
  -- active       counts toward outstanding
  -- pre_opening  dated on or before the go-live opening balance, so excluded --
  --              this is what stops the opening balance being double counted
  -- parked       recorded and visible but excluded from outstanding. Today only
  --              MPR parts returns, pending accounts' answer on whether a
  --              return credits the account or is money paid back out
  -- not_payable  free-of-cost documents. Imported so the file reconciles row
  --              for row, but never an allocation target
  -- cancelled    SAP cancelled it
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','pre_opening','parked','not_payable','cancelled')),
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES public.users(id),
  cancel_reason    text,
  source_pulled_at timestamptz,              -- when SAP produced the export
  import_batch_id  uuid,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_invoices_allocated_range
    CHECK (allocated_paise >= 0 AND allocated_paise <= total_paise),
  CONSTRAINT service_invoices_number_not_blank CHECK (btrim(invoice_number) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_entity_number_key
  ON public.service_invoices (entity_id, invoice_number);
CREATE INDEX IF NOT EXISTS service_invoices_open_idx
  ON public.service_invoices (entity_id, invoice_date DESC)
  WHERE status = 'active' AND allocated_paise < total_paise;
CREATE INDEX IF NOT EXISTS service_invoices_customer_idx
  ON public.service_invoices (customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS service_invoices_job_idx
  ON public.service_invoices (entity_id, job_ref) WHERE job_ref IS NOT NULL;
-- The matcher's hot path: "open invoices near this amount, near this date".
CREATE INDEX IF NOT EXISTS service_invoices_amount_idx
  ON public.service_invoices (entity_id, total_paise, invoice_date)
  WHERE status = 'active';

COMMENT ON COLUMN public.service_invoices.split_order_type IS
  'Kept verbatim for forensics, NOT used to decide payability. Measured hazards: it is blank on all 12 parts returns, and one free-of-cost invoice carries "Repeat Jobs" -- a value that reads as payable. Payability comes from the invoice prefix cross-checked against SAP billing type, which are bijective.';
COMMENT ON COLUMN public.service_invoices.invoice_date IS
  'Date only. SAP will never provide a billing time (owner, final), so time proximity is not a matching signal and no timestamp is silently invented here.';
COMMENT ON COLUMN public.service_invoices.allocated_paise IS
  'Denormalised cache of active allocations against this invoice. Maintained only inside the SECURITY DEFINER RPCs and verified by v_payments_integrity.';


-- ── 3. Receipts (credit documents) ──────────────────────────────────────────
-- Measured from the real July and August exports: BharatPe ~17 receipts/day
-- with a 12-digit UTR and full legal payer names; Google Pay ~3/day with an
-- internal transaction code that is NOT a UTR, truncated names, and a Notes
-- field carrying a bill number about a quarter of the time. NEITHER carries a
-- VPA, which is why payer memory below keys on the name.

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES public.entities(id),
  outlet_id        uuid REFERENCES public.outlets(id),
  mode             text NOT NULL CHECK (mode IN ('upi','cash','cheque','netbanking')),
  source           text NOT NULL CHECK (source IN
                     ('gpay','bharatpe','manual','bank_statement','opening_balance')),
  -- PINNED: the amount the CUSTOMER paid, gross. BharatPe deducts MDR on some
  -- rows (7 nonzero in July), so gross and net genuinely differ; the customer's
  -- bill is settled by the gross, and the fee is the bank's business.
  amount_paise     bigint NOT NULL CHECK (amount_paise > 0),
  gross_paise      bigint CHECK (gross_paise IS NULL OR gross_paise > 0),
  fee_paise        bigint CHECK (fee_paise IS NULL OR fee_paise >= 0),
  received_at      timestamptz NOT NULL,
  external_txn_id  text,
  -- BharatPe only. Google Pay's id is internal to Google, not a bank reference,
  -- so leaving this NULL for GPay is correct -- it must not join across sources.
  normalized_utr   text,
  payer_name       text,
  payer_remark     text,                     -- GPay Notes: the bill-number carrier
  instrument_ref   text,                     -- cheque no. / bank ref
  receipt_serial   text,                     -- manual: gap-free CR-<entity>-<FY>-<seq>
  classification   text NOT NULL DEFAULT 'unknown'
                     CHECK (classification IN ('service','not_service','unknown')),
  not_service_kind text,                     -- vehicle booking advance, sister unit, ...
  -- An advance: money in before the bill exists. Excluded from "pending" so it
  -- does not read as unfinished work, but shown as an amber chip so it is never
  -- forgotten. The matcher re-offers it when invoices import.
  awaiting_invoice boolean NOT NULL DEFAULT false,
  allocated_paise  bigint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  voided_at        timestamptz,
  voided_by        uuid REFERENCES public.users(id),
  void_reason      text,                     -- a bounced cheque is a void with a reason
  import_batch_id  uuid,
  entered_by       uuid REFERENCES public.users(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_allocated_range
    CHECK (allocated_paise >= 0 AND allocated_paise <= amount_paise),
  CONSTRAINT payment_receipts_void_reason
    CHECK (status <> 'voided' OR void_reason IS NOT NULL),
  CONSTRAINT payment_receipts_fee_le_gross
    CHECK (fee_paise IS NULL OR gross_paise IS NULL OR fee_paise <= gross_paise)
);
-- Idempotency. Entity is in the key because per-outlet merchant accounts and PT
-- are both coming, and a bare (source, txn_id) would collide across them.
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_source_txn_key
  ON public.payment_receipts (entity_id, source, external_txn_id)
  WHERE external_txn_id IS NOT NULL;
-- Cross-source duplicate defence, meaningful only where a real UTR exists.
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_utr_key
  ON public.payment_receipts (entity_id, normalized_utr)
  WHERE normalized_utr IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_serial_key
  ON public.payment_receipts (entity_id, receipt_serial)
  WHERE receipt_serial IS NOT NULL;
-- The Match queue: unmatched, newest first.
CREATE INDEX IF NOT EXISTS payment_receipts_queue_idx
  ON public.payment_receipts (entity_id, received_at DESC)
  WHERE status = 'active' AND allocated_paise < amount_paise;
CREATE INDEX IF NOT EXISTS payment_receipts_payer_idx
  ON public.payment_receipts (entity_id, lower(payer_name));

COMMENT ON COLUMN public.payment_receipts.normalized_utr IS
  'BharatPe 12-digit UTR, digits only. NULL for Google Pay by design: its transaction id is internal to Google and is not a bank reference, so unique-ing on it across sources would be a false guarantee.';
COMMENT ON COLUMN public.payment_receipts.classification IS
  'unknown until someone says. Any allocation flips it to service automatically. Marking not_service is refused while active allocations exist, and not_service money still travels to Busy as its own worklist section -- otherwise bank reconciliation cannot tie.';


-- Gap-free receipt serials. A sequence is wrong here: sequences gap on
-- rollback, and a gap in a receipt book is exactly what an auditor asks about.
-- One locked counter row per entity per financial year.
CREATE TABLE IF NOT EXISTS public.payment_receipt_counters (
  entity_id uuid NOT NULL REFERENCES public.entities(id),
  fy_start  integer NOT NULL,
  last_seq  integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (entity_id, fy_start)
);


-- ── 4. Allocations ──────────────────────────────────────────────────────────
-- The heart of the tool. An allocation says "this much of this credit settles
-- this debit". It is append-only: a mistake is REVERSED, never edited or
-- deleted, so the diary always reads forward.
--
--   payment      receipt -> invoice           the ordinary case
--   tds          invoice only                 a company deducted tax at source;
--                                             no money arrives, the bill closes
--   on_account   receipt -> group             money attributed to a customer
--                                             with no bill named yet (advances,
--                                             and settling an opening balance)
--   credit_note  invoice or group, no receipt parts returns, SAP credit notes
--
-- There is deliberately NO write-off type. The owner's rule: most customers
-- repeat, so a short payment rides their ledger and is collected next time.
-- Making that a CHECK rather than a convention is the whole point.
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id                uuid NOT NULL REFERENCES public.entities(id),
  alloc_type               text NOT NULL
                             CHECK (alloc_type IN ('payment','tds','on_account','credit_note')),
  receipt_id               uuid REFERENCES public.payment_receipts(id),
  invoice_id               uuid REFERENCES public.service_invoices(id),
  group_id                 uuid REFERENCES public.customer_groups(id),
  customer_id              uuid REFERENCES public.customers(id),
  amount_paise             bigint NOT NULL CHECK (amount_paise > 0),
  allocated_by             uuid REFERENCES public.users(id),
  allocated_at             timestamptz NOT NULL DEFAULT now(),
  -- Confirmations arrive from phones on workshop connections. A retried POST
  -- must not double-allocate, so every mutation carries the caller's own id.
  client_request_id        uuid,
  match_signal             text,  -- which signal won: note_number / payer_memory / amount / manual
  reversed_at              timestamptz,
  reversed_by              uuid REFERENCES public.users(id),
  reverse_reason           text,
  -- Returned to the maker by the checker with a canned reason. Not a rejection:
  -- it re-enters their queue flagged "returned for info".
  bounced_back_at          timestamptz,
  bounced_back_by          uuid REFERENCES public.users(id),
  bounce_reason            text,
  export_batch_id          uuid,
  reversal_export_batch_id uuid,  -- a post-export reversal travels as a contra row
  notes                    text,
  -- Shape rules per type, so a malformed allocation cannot exist even if an RPC
  -- is wrong.
  CONSTRAINT alloc_shape CHECK (
    (alloc_type = 'payment'     AND receipt_id IS NOT NULL AND invoice_id IS NOT NULL)
 OR (alloc_type = 'tds'         AND receipt_id IS NULL     AND invoice_id IS NOT NULL)
 OR (alloc_type = 'on_account'  AND receipt_id IS NOT NULL AND invoice_id IS NULL
                                AND group_id IS NOT NULL)
 OR (alloc_type = 'credit_note' AND receipt_id IS NULL
                                AND (invoice_id IS NOT NULL OR group_id IS NOT NULL))
  ),
  -- A reversal must say who and why. Half a reversal is worse than none.
  CONSTRAINT alloc_reversal_complete CHECK (
    reversed_at IS NULL
    OR (reversed_by IS NOT NULL AND btrim(coalesce(reverse_reason, '')) <> '')
  )
);
CREATE INDEX IF NOT EXISTS payment_allocations_receipt_idx
  ON public.payment_allocations (receipt_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx
  ON public.payment_allocations (invoice_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS payment_allocations_group_idx
  ON public.payment_allocations (group_id) WHERE reversed_at IS NULL;
-- The export cursor: everything active and not yet exported.
CREATE INDEX IF NOT EXISTS payment_allocations_unexported_idx
  ON public.payment_allocations (entity_id, allocated_at)
  WHERE reversed_at IS NULL AND export_batch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_idempotency_key
  ON public.payment_allocations (client_request_id) WHERE client_request_id IS NOT NULL;


-- ── 5. Payer memory ─────────────────────────────────────────────────────────
-- Keyed on the payer NAME, not a VPA -- neither export carries a VPA, measured.
-- One payer can legitimately pay for two fleet owners (a driver settles for
-- whoever sent him), so the key allows several customers per name and the
-- ranking treats a shared name as weak.
CREATE TABLE IF NOT EXISTS public.payer_memory (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid NOT NULL REFERENCES public.entities(id),
  source                text NOT NULL,
  normalized_payer_name text NOT NULL,
  customer_id           uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  confirm_count         integer NOT NULL DEFAULT 0,
  contradiction_count   integer NOT NULL DEFAULT 0,
  last_confirmed_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payer_memory_key
  ON public.payer_memory (entity_id, source, normalized_payer_name, customer_id);

COMMENT ON TABLE public.payer_memory IS
  'A confirmation only strengthens memory after the allocation has survived export and 14 days unreversed; a reversal decrements it. Hits older than 180 days are demoted out of the confident bucket. Without that hygiene one wrong confirmation teaches the tool a lie and it repeats it confidently.';


-- ── 6. Batches ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES public.entities(id),
  kind             text NOT NULL CHECK (kind IN
                     ('invoices','receipts','opening_balances','busy_balances')),
  source           text NOT NULL,
  file_name        text,
  file_hash        text,                -- refuses a re-upload of the identical file
  parser_version   text NOT NULL,
  format_note      text,                -- which column layout this file turned out to be
  row_count        integer,
  counts           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- new/amended/unchanged/refused/...
  payload          jsonb,               -- what was parsed, for forensics and re-run
  storage_path     text,                -- original bytes, kept for failed parses
  status           text NOT NULL DEFAULT 'committed'
                     CHECK (status IN ('committed','failed_parse','pending','reverted')),
  source_pulled_at timestamptz,
  uploaded_by      uuid REFERENCES public.users(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  notes            text
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_import_batches_hash_key
  ON public.payment_import_batches (entity_id, kind, file_hash)
  WHERE file_hash IS NOT NULL AND status = 'committed';
CREATE INDEX IF NOT EXISTS payment_import_batches_recent_idx
  ON public.payment_import_batches (entity_id, kind, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_export_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES public.entities(id),
  target       text NOT NULL DEFAULT 'busy' CHECK (target IN ('busy')),
  alloc_count  integer NOT NULL DEFAULT 0,
  contra_count integer NOT NULL DEFAULT 0,
  total_paise  bigint NOT NULL DEFAULT 0,
  payload      jsonb,                   -- frozen: what was handed over, verbatim
  payload_hash text,
  file_name    text,
  exported_by  uuid REFERENCES public.users(id),
  exported_at  timestamptz NOT NULL DEFAULT now(),
  notes        text
);
CREATE INDEX IF NOT EXISTS payment_export_batches_recent_idx
  ON public.payment_export_batches (entity_id, exported_at DESC);

-- Back-references, added once both sides exist.
ALTER TABLE public.service_invoices
  DROP CONSTRAINT IF EXISTS service_invoices_import_batch_fk;
ALTER TABLE public.service_invoices
  ADD CONSTRAINT service_invoices_import_batch_fk
  FOREIGN KEY (import_batch_id) REFERENCES public.payment_import_batches(id);

ALTER TABLE public.payment_receipts
  DROP CONSTRAINT IF EXISTS payment_receipts_import_batch_fk;
ALTER TABLE public.payment_receipts
  ADD CONSTRAINT payment_receipts_import_batch_fk
  FOREIGN KEY (import_batch_id) REFERENCES public.payment_import_batches(id);

ALTER TABLE public.payment_allocations
  DROP CONSTRAINT IF EXISTS payment_allocations_export_batch_fk;
ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_export_batch_fk
  FOREIGN KEY (export_batch_id) REFERENCES public.payment_export_batches(id);

ALTER TABLE public.payment_allocations
  DROP CONSTRAINT IF EXISTS payment_allocations_reversal_export_batch_fk;
ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_reversal_export_batch_fk
  FOREIGN KEY (reversal_export_batch_id) REFERENCES public.payment_export_batches(id);


-- ── 7. Busy drift check ─────────────────────────────────────────────────────
-- Monthly: upload Busy's ledger balances and diff them against ours (owner).
-- The same importer is how an opening balance gets re-baselined.
CREATE TABLE IF NOT EXISTS public.busy_balance_checks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id            uuid NOT NULL REFERENCES public.entities(id),
  group_id             uuid REFERENCES public.customer_groups(id),
  busy_ledger_name     text,
  as_of                date NOT NULL,
  busy_balance_paise   bigint NOT NULL,
  portal_balance_paise bigint NOT NULL,
  delta_paise          bigint NOT NULL,
  resolved_note        text,
  resolved_by          uuid REFERENCES public.users(id),
  resolved_at          timestamptz,
  import_batch_id      uuid REFERENCES public.payment_import_batches(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS busy_balance_checks_open_idx
  ON public.busy_balance_checks (entity_id, as_of DESC) WHERE resolved_at IS NULL;


-- ── 8. The diary ────────────────────────────────────────────────────────────
-- Append-only, with TYPED columns rather than a text blob, so the weekly
-- exceptions digest is a WHERE clause and not a string parse.
CREATE TABLE IF NOT EXISTS public.payment_events (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  entity_id     uuid NOT NULL REFERENCES public.entities(id),
  event_type    text NOT NULL CHECK (event_type IN (
                  'import','classify','allocate','reverse','bounce_back','export',
                  'manual_receipt','void_receipt','group_edit','limit_edit',
                  'limit_breach','cancel_invoice','revert_batch','cash_tieout')),
  actor_id      uuid REFERENCES public.users(id),
  actor_name    text,
  amount_paise  bigint,
  receipt_id    uuid,
  invoice_id    uuid,
  allocation_id uuid,
  group_id      uuid,
  customer_id   uuid,
  batch_id      uuid,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_scan_idx
  ON public.payment_events (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_type_idx
  ON public.payment_events (entity_id, event_type, created_at DESC);

COMMENT ON TABLE public.payment_events IS
  'Append-only. Retention >= 8 years (Companies Act). This is also the tested recovery path: selftest-events-rebuild reconstructs allocated_paise from these rows, which is the only reason the denormalised caches are safe to keep.';

-- An audit log that can be edited is decoration. This trigger binds the service
-- role too, which is the point -- every write path in this system runs as
-- service_role, so an RLS policy would have bound nothing.
CREATE OR REPLACE FUNCTION public.payment_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only (attempted % on id %)', TG_OP, OLD.id;
END;
$fn$;

DROP TRIGGER IF EXISTS payment_events_no_update ON public.payment_events;
CREATE TRIGGER payment_events_no_update
  BEFORE UPDATE OR DELETE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.payment_events_immutable();


-- ── 9. Daily cash tie-out ───────────────────────────────────────────────────
-- The tool's cash total against the bank deposit slip, one line a day, signed
-- by the GM in the app (owner). Cash unbanked beyond one banking day flags red.
CREATE TABLE IF NOT EXISTS public.payment_cash_tieouts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES public.entities(id),
  outlet_id         uuid REFERENCES public.outlets(id),
  business_date     date NOT NULL,
  system_cash_paise bigint NOT NULL,
  deposited_paise   bigint,
  deposit_ref       text,
  variance_paise    bigint,
  variance_note     text,
  signed_by         uuid REFERENCES public.users(id),
  signed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- coalesce, not a plain unique: an entity-wide tie-out and a per-outlet one
-- must not both exist for the same day unnoticed.
CREATE UNIQUE INDEX IF NOT EXISTS payment_cash_tieouts_day_key
  ON public.payment_cash_tieouts
     (entity_id, coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid), business_date);


-- ── 10. Access gates ────────────────────────────────────────────────────────
-- Two gates, both argument-free so an RLS policy can call them as an uncorrelated
-- (SELECT gate()) sub-select. That form is evaluated ONCE per query as an
-- InitPlan; a predicate that passes a column into a function -- (SELECT f(entity_id))
-- -- is correlated and runs per row instead. On this database that distinction has
-- been measured at 73ms vs 4598ms, so the shape below is not a style preference.

-- Who may see the matching surfaces at all. Service staff are included because
-- matching IS their job and the payer name is the thing they match on.
CREATE OR REPLACE FUNCTION public.payments_can_read()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select coalesce(
    (select u.is_active
        and (u.permission_level = 'admin'
             or u.permission_level in ('manager','gm')
             or d.code in ('accounts','service'))
       from public.users u
       left join public.departments d on d.id = u.department_id
      where u.id = auth.uid()),
    false)
$fn$;

COMMENT ON FUNCTION public.payments_can_read() IS
  'Service Payments read gate for the matching surfaces: active user who is admin, manager and above, or in accounts/service. One function so widening access later is one edit, not fourteen policies.';

-- The narrower gate. Customer tax identifiers, the audit diary, import payloads
-- and the cash book are back-office material; a service executive matching a
-- payment has no business in them. PostgREST has no column-level RLS, so the
-- separation has to be table-level plus a stripped view (section 11).
CREATE OR REPLACE FUNCTION public.payments_can_read_back_office()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select coalesce(
    (select u.is_active
        and (u.permission_level = 'admin'
             or u.permission_level in ('manager','gm')
             or d.code = 'accounts')
       from public.users u
       left join public.departments d on d.id = u.department_id
      where u.id = auth.uid()),
    false)
$fn$;

COMMENT ON FUNCTION public.payments_can_read_back_office() IS
  'Narrower Service Payments gate: accounts, manager and above, admin. Excludes service executives, who read the stripped v_payments_customers_lite instead.';


-- ── 11. Row level security ──────────────────────────────────────────────────
-- READ is granted here. WRITE IS NOT GRANTED TO ANYONE, INCLUDING ADMIN.
-- Every mutation goes through a SECURITY DEFINER RPC called by the Edge
-- Function with the service role. A write policy for `authenticated` would
-- create a PostgREST path that bypasses the invariants AND the audit log, and
-- an admin is exactly the account an attacker wants. The ABSENCE of a write
-- policy is the control -- and section 12 removes the table privileges too, so
-- it does not rest on policy absence alone.

ALTER TABLE public.customer_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_group_dismissals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipt_counters   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payer_memory               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_import_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_export_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.busy_balance_checks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_cash_tieouts       ENABLE ROW LEVEL SECURITY;

-- The deactivated-user gate, RESTRICTIVE so it ANDs with everything else.
DROP POLICY IF EXISTS customer_groups_active_only ON public.customer_groups;
CREATE POLICY customer_groups_active_only ON public.customer_groups
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS customers_active_only ON public.customers;
CREATE POLICY customers_active_only ON public.customers
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS customer_group_memberships_active_only ON public.customer_group_memberships;
CREATE POLICY customer_group_memberships_active_only ON public.customer_group_memberships
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS customer_group_dismissals_active_only ON public.customer_group_dismissals;
CREATE POLICY customer_group_dismissals_active_only ON public.customer_group_dismissals
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS service_invoices_active_only ON public.service_invoices;
CREATE POLICY service_invoices_active_only ON public.service_invoices
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_receipts_active_only ON public.payment_receipts;
CREATE POLICY payment_receipts_active_only ON public.payment_receipts
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_receipt_counters_active_only ON public.payment_receipt_counters;
CREATE POLICY payment_receipt_counters_active_only ON public.payment_receipt_counters
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_allocations_active_only ON public.payment_allocations;
CREATE POLICY payment_allocations_active_only ON public.payment_allocations
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payer_memory_active_only ON public.payer_memory;
CREATE POLICY payer_memory_active_only ON public.payer_memory
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_import_batches_active_only ON public.payment_import_batches;
CREATE POLICY payment_import_batches_active_only ON public.payment_import_batches
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_export_batches_active_only ON public.payment_export_batches;
CREATE POLICY payment_export_batches_active_only ON public.payment_export_batches
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS busy_balance_checks_active_only ON public.busy_balance_checks;
CREATE POLICY busy_balance_checks_active_only ON public.busy_balance_checks
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_events_active_only ON public.payment_events;
CREATE POLICY payment_events_active_only ON public.payment_events
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS payment_cash_tieouts_active_only ON public.payment_cash_tieouts;
CREATE POLICY payment_cash_tieouts_active_only ON public.payment_cash_tieouts
  AS RESTRICTIVE TO authenticated USING ((SELECT public.is_active_user()));

-- Matching surfaces: accounts, service, manager+, admin -- own entity only.
DROP POLICY IF EXISTS service_invoices_select ON public.service_invoices;
CREATE POLICY service_invoices_select ON public.service_invoices
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read())));

DROP POLICY IF EXISTS payment_receipts_select ON public.payment_receipts;
CREATE POLICY payment_receipts_select ON public.payment_receipts
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read())));

DROP POLICY IF EXISTS payment_allocations_select ON public.payment_allocations;
CREATE POLICY payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read())));

-- Back-office surfaces: accounts, manager+, admin -- own entity only.
DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS customer_groups_select ON public.customer_groups;
CREATE POLICY customer_groups_select ON public.customer_groups
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS customer_group_dismissals_select ON public.customer_group_dismissals;
CREATE POLICY customer_group_dismissals_select ON public.customer_group_dismissals
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payer_memory_select ON public.payer_memory;
CREATE POLICY payer_memory_select ON public.payer_memory
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payment_import_batches_select ON public.payment_import_batches;
CREATE POLICY payment_import_batches_select ON public.payment_import_batches
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payment_export_batches_select ON public.payment_export_batches;
CREATE POLICY payment_export_batches_select ON public.payment_export_batches
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS busy_balance_checks_select ON public.busy_balance_checks;
CREATE POLICY busy_balance_checks_select ON public.busy_balance_checks
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payment_events_select ON public.payment_events;
CREATE POLICY payment_events_select ON public.payment_events
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payment_cash_tieouts_select ON public.payment_cash_tieouts;
CREATE POLICY payment_cash_tieouts_select ON public.payment_cash_tieouts
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

DROP POLICY IF EXISTS payment_receipt_counters_select ON public.payment_receipt_counters;
CREATE POLICY payment_receipt_counters_select ON public.payment_receipt_counters
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR (entity_id = (SELECT public.get_my_entity_id())
          AND (SELECT public.payments_can_read_back_office())));

-- Memberships carry no entity_id of their own; they inherit their customer's.
-- This one predicate is necessarily correlated, which is why the table is small
-- and indexed on customer_id.
DROP POLICY IF EXISTS customer_group_memberships_select ON public.customer_group_memberships;
CREATE POLICY customer_group_memberships_select ON public.customer_group_memberships
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin'
      OR ((SELECT public.payments_can_read_back_office())
          AND EXISTS (SELECT 1 FROM public.customers c
                       WHERE c.id = customer_group_memberships.customer_id
                         AND c.entity_id = (SELECT public.get_my_entity_id()))));


-- ── 12. Privileges ──────────────────────────────────────────────────────────
-- Supabase's default privileges grant ALL on new objects in `public` to both
-- anon and authenticated. For these tables that would leave INSERT/UPDATE/DELETE
-- granted and resting entirely on the absence of a write policy. Take the
-- privileges away so the "no write path outside the RPCs" claim is true at two
-- independent layers.

DO $grants$
DECLARE
  t text;
  money_tables text[] := ARRAY[
    'customer_groups','customers','customer_group_memberships',
    'customer_group_dismissals','service_invoices','payment_receipts',
    'payment_receipt_counters','payment_allocations','payer_memory',
    'payment_import_batches','payment_export_batches','busy_balance_checks',
    'payment_events','payment_cash_tieouts'
  ];
BEGIN
  FOREACH t IN ARRAY money_tables LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$grants$;


-- ── 13. Views ───────────────────────────────────────────────────────────────
-- These are definer views (security_invoker defaults to false), so they see
-- past the base-table RLS and apply their own filter. That is the only way to
-- withhold a COLUMN in PostgREST, which has no column-level RLS -- "the UI
-- doesn't render it" is not a control.

-- Customers without GSTIN or PAN, for the matching screens. Service staff need
-- to recognise a customer; they have no business holding tax identifiers.
CREATE OR REPLACE VIEW public.v_payments_customers_lite AS
SELECT c.id,
       c.entity_id,
       c.sap_customer_code,
       c.display_name,
       c.phone,
       m.group_id,
       g.name AS group_name
  FROM public.customers c
  LEFT JOIN public.customer_group_memberships m
         ON m.customer_id = c.id AND m.valid_to IS NULL
  LEFT JOIN public.customer_groups g ON g.id = m.group_id
 WHERE (SELECT public.current_user_role()) = 'admin'
    OR (c.entity_id = (SELECT public.get_my_entity_id())
        AND (SELECT public.payments_can_read()));

COMMENT ON VIEW public.v_payments_customers_lite IS
  'Customer master minus gstin and pan. The Match and Outstanding screens read this; only accounts/GM/admin read public.customers itself.';

-- The corruption detector. Both denormalised caches are recomputed from the
-- allocations that back them; anything this view returns is a real defect, and
-- it should be empty at all times. Cheap enough to run nightly.
CREATE OR REPLACE VIEW public.v_payments_integrity AS
SELECT 'invoice'::text  AS doc_kind,
       i.id             AS doc_id,
       i.entity_id      AS entity_id,
       i.invoice_number AS doc_ref,
       i.allocated_paise AS cached_paise,
       COALESCE(a.sum_paise, 0) AS actual_paise,
       i.allocated_paise - COALESCE(a.sum_paise, 0) AS drift_paise
  FROM public.service_invoices i
  LEFT JOIN (
        SELECT invoice_id, SUM(amount_paise) AS sum_paise
          FROM public.payment_allocations
         WHERE reversed_at IS NULL AND invoice_id IS NOT NULL
         GROUP BY invoice_id
       ) a ON a.invoice_id = i.id
 WHERE i.allocated_paise <> COALESCE(a.sum_paise, 0)
UNION ALL
SELECT 'receipt',
       r.id,
       r.entity_id,
       COALESCE(r.receipt_serial, r.external_txn_id),
       r.allocated_paise,
       COALESCE(a.sum_paise, 0),
       r.allocated_paise - COALESCE(a.sum_paise, 0)
  FROM public.payment_receipts r
  LEFT JOIN (
        SELECT receipt_id, SUM(amount_paise) AS sum_paise
          FROM public.payment_allocations
         WHERE reversed_at IS NULL AND receipt_id IS NOT NULL
         GROUP BY receipt_id
       ) a ON a.receipt_id = r.id
 WHERE r.allocated_paise <> COALESCE(a.sum_paise, 0);

COMMENT ON VIEW public.v_payments_integrity IS
  'Must be empty. Recomputes both allocated_paise caches from live allocations and returns any row that disagrees. A non-empty result means an RPC has a bug -- stop writing and investigate before the next export.';

REVOKE ALL ON public.v_payments_customers_lite FROM anon;
REVOKE ALL ON public.v_payments_integrity      FROM anon;
GRANT SELECT ON public.v_payments_customers_lite TO authenticated;
GRANT SELECT ON public.v_payments_integrity      TO authenticated;
