-- Credit release step 3 — the promise recorded with an approval.
-- Plan: docs/backlog/credit-release-plan.md → "Step 3". Builds on 20261026_gate_releases.sql.
--
-- Owner decisions (2026-10-28 / 29):
--   * On approval the GM or the owner MAY record a promise: a date the customer will pay by,
--     and/or the STAFF MEMBER responsible for it (a portal user — not free text).
--   * Paid status comes ONLY from matching payments to bills (the payments tool), never from a
--     "mark paid" button — so this migration adds no paid column. The Follow-up list reads it
--     through supabase/functions/gate-invoices/paid.ts.
--   * A broken promise shows on the Follow-up list only (no scheduled alert).
--
-- Written only by the gate-invoices Edge Function (service role), like every gate_* write.
-- The function also checks that the responsible person is an active staff member of the
-- invoice's company; the table checks what it can see on its own row.
--
-- Rollback (manual; needs owner approval — it drops recorded promises):
--   alter table public.gate_releases drop constraint gate_releases_promise_shape,
--     drop column responsible_id, drop column promised_by;

begin;

alter table public.gate_releases
  add column promised_by    date,                                   -- a calendar day in India
  add column responsible_id uuid references public.users(id);

-- A promise only on an approval; its day no earlier than the day it was approved (in India) and
-- no more than 90 days after. coalesce(…, false): a CHECK that evaluates to NULL passes in SQL
-- (step 2's probe caught exactly that), so every NULL path must land on an explicit answer.
alter table public.gate_releases add constraint gate_releases_promise_shape check (coalesce(
  (promised_by is null and responsible_id is null)
  or (status = 'approved' and (promised_by is null or (
        promised_by >= (decided_at at time zone 'Asia/Kolkata')::date
    and promised_by <= (decided_at at time zone 'Asia/Kolkata')::date + 90))),
  false));

commit;
