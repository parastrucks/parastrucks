-- Phase 10 — Vehicle Tracker, Stage 1 step 3: cancel/rebill as ONE transaction.
--
-- A rebill closes the old row and opens a new one. The chassis may stay the same (re-billed to a
-- different customer) — the unique index only covers live rows (superseded_at is null), so the old
-- row must be closed BEFORE the new one is inserted. Done as two Edge Function calls, a failure in
-- between would leave the truck with no live row at all; here it is all or nothing.
--
-- Nothing is copied from the old row except the chassis number (when the caller gives none):
-- which figures carry over to a rebill is a screen decision for Stage 2, not a database one.
-- Requires 20261021_phase10_tracker_foundation.sql.
--
-- Rollback: drop function if exists public.tracker_supersede_unit(uuid, uuid, jsonb);

begin;

create function public.tracker_supersede_unit(p_actor uuid, p_old uuid, p_values jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old   public.vehicle_units%rowtype;
  v_new   uuid;
  v_batch uuid := gen_random_uuid();
begin
  if p_actor is null or p_old is null then raise exception 'actor and old row are required'; end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then raise exception 'values must be an object'; end if;

  select * into v_old from public.vehicle_units where id = p_old for update;
  if not found then raise exception 'no such row'; end if;
  if v_old.superseded_at is not null then raise exception 'this row was already rebilled'; end if;

  -- 1. close the old row (frees its chassis in the live-row unique index)
  perform set_config('tracker.actor',  p_actor::text, true);
  perform set_config('tracker.source', 'supersede', true);
  perform set_config('tracker.batch',  v_batch::text, true);
  update public.vehicle_units set superseded_at = now(), updated_at = now(), updated_by = p_actor
   where id = p_old;

  -- 2. open the new row (tracker_create_unit audits it as 'create' in the same batch)
  v_new := public.tracker_create_unit(p_actor, v_batch,
             case when coalesce(btrim(p_values ->> 'chassis_no'), '') = ''
                  then p_values || jsonb_build_object('chassis_no', v_old.chassis_no)
                  else p_values end);

  -- 3. point the old row at its successor
  perform set_config('tracker.source', 'supersede', true);
  update public.vehicle_units set superseded_by_id = v_new where id = p_old;
  return v_new;
end;
$$;

revoke all on function public.tracker_supersede_unit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tracker_supersede_unit(uuid, uuid, jsonb) to service_role;

commit;
