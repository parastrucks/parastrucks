-- Phase 10 — Vehicle Tracker, Stage 2 slice 3: new rows typed or pasted below the book.
--
-- tracker_create_units(actor, batch, rows, request_id) creates several vehicles in one call:
--   * each row goes through tracker_create_unit inside its OWN savepoint, so one duplicate chassis
--     (or one value the table refuses) fails only that row — a 20-row paste with one truck already
--     in the book adds the other 19 and names the one;
--   * the whole result is stored under the request id (tracker_requests, as tracker_apply_changes
--     does), so a browser retry after a dropped connection gets the same answer back instead of
--     "already in the book" for every row it had in fact created.
-- Result: { ok: true, results: [ {ok: true, id} | {ok: false, reason} ], batch_id, replayed }
-- in the order of p_rows. Requires 20261021_phase10_tracker_foundation.sql.
--
-- Rollback: drop function if exists public.tracker_create_units(uuid, uuid, jsonb, text);

begin;

create function public.tracker_create_units(p_actor uuid, p_batch uuid, p_rows jsonb, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior   jsonb;
  v_row     jsonb;
  v_id      uuid;
  v_results jsonb := '[]'::jsonb;
  v_result  jsonb;
begin
  if p_actor is null or p_batch is null or p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'actor, batch and request id are required';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty array';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'too many new rows in one call (% > 200)', jsonb_array_length(p_rows);
  end if;

  -- idempotency: a repeated request returns what the first one did
  perform pg_advisory_xact_lock(hashtext('tracker_request:' || p_request_id));
  select result into v_prior from public.tracker_requests where client_request_id = p_request_id;
  if found then
    return v_prior || jsonb_build_object('replayed', true);
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) with ordinality order by ordinality loop
    begin
      if jsonb_typeof(v_row) is distinct from 'object' then
        raise exception 'each row must be an object';
      end if;
      v_id := public.tracker_create_unit(p_actor, p_batch, v_row);
      v_results := v_results || jsonb_build_array(jsonb_build_object('ok', true, 'id', v_id));
    exception
      when unique_violation then
        v_results := v_results || jsonb_build_array(jsonb_build_object('ok', false,
          'reason', 'chassis ' || coalesce(btrim(v_row ->> 'chassis_no'), '') || ' is already in the book'));
      when others then
        v_results := v_results || jsonb_build_array(jsonb_build_object('ok', false, 'reason', sqlerrm));
    end;
  end loop;

  v_result := jsonb_build_object('ok', true, 'results', v_results, 'batch_id', p_batch, 'replayed', false);
  insert into public.tracker_requests (client_request_id, batch_id, actor, result)
  values (p_request_id, p_batch, p_actor, v_result);
  return v_result;
end;
$$;

revoke all on function public.tracker_create_units(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.tracker_create_units(uuid, uuid, jsonb, text) to service_role;

commit;
