-- Phase 6c.3 prep: add quotations.entity_id as a proper FK so the new RLS
-- can scope by entity. Stage 1 added brand_id but not entity_id; the
-- quotation inserter sets `entity` text from profile.entity. Backfill from
-- the entity text → entities.code, then drop the legacy text column.

alter table public.quotations
  add column if not exists entity_id uuid references public.entities(id) on delete restrict;

update public.quotations q
   set entity_id = e.id
  from public.entities e
 where e.code = q.entity
   and q.entity_id is null;

do $$
declare
  bad int;
begin
  select count(*) into bad from public.quotations where entity_id is null;
  if bad > 0 then
    raise exception 'quotations backfill: % rows still have NULL entity_id (stale entity text?)', bad;
  end if;
end $$;

alter table public.quotations alter column entity_id set not null;

-- Quotation.jsx has already been updated to write entity_id instead of entity.
-- Drop the legacy text column; every reader is swapped.
alter table public.quotations drop column if exists entity;
