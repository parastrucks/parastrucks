-- Phase 9f M6 — quotation save idempotency.
-- Eliminates duplicate-row creation when the user double-clicks Save while
-- the network is throttled. Approach: client generates a UUID per Save click,
-- includes it as `client_request_id`. A partial unique index on
-- (created_by, client_request_id) makes a re-submission collide on the DB,
-- which the client catches and treats as success.
--
-- Why partial: the index ignores rows where client_request_id IS NULL so
-- existing rows (created before this column was added) don't all collide on
-- "(created_by, NULL)" — NULLs aren't equal to NULLs in btree uniqueness, but
-- the partial index is also explicit about not policing legacy data.

alter table public.quotations
  add column if not exists client_request_id uuid;

create unique index if not exists quotations_idempotency_idx
  on public.quotations (created_by, client_request_id)
  where client_request_id is not null;

comment on column public.quotations.client_request_id is
  'Phase 9f M6 — client-generated UUID per Save click. Unique per (created_by, client_request_id) so a double-click cannot create two rows.';

-- Rollback (manual):
--   drop index if exists public.quotations_idempotency_idx;
--   alter table public.quotations drop column if exists client_request_id;
