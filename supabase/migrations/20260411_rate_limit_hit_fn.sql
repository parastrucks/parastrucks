-- Phase 5 U9 follow-up: atomic rate-limit check + increment in one round-trip.
-- Replaces the 2-hop SELECT + UPSERT pattern in supabase/functions/_shared/rateLimit.ts.
-- Fixed-window semantics identical to the old helper.
create or replace function public.rate_limit_hit(
  p_user uuid,
  p_bucket text,
  p_limit int default 60,
  p_window_sec int default 60
) returns table(allowed boolean, retry_after_s int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_sec      bigint;
  v_window_start timestamptz;
  v_row          public.rate_limits%rowtype;
begin
  v_now_sec      := extract(epoch from now())::bigint;
  v_window_start := to_timestamp((v_now_sec / p_window_sec) * p_window_sec);

  -- Lock the (user, bucket) slot if it exists
  select * into v_row
  from public.rate_limits
  where user_id = p_user and bucket = p_bucket
  for update;

  if not found or v_row.window_start <> v_window_start then
    -- Fresh window (or first hit ever): reset counter to 1.
    -- ON CONFLICT handles the race where two parallel callers both see no row.
    insert into public.rate_limits(user_id, bucket, window_start, count)
    values (p_user, p_bucket, v_window_start, 1)
    on conflict (user_id, bucket) do update
      set window_start = excluded.window_start,
          count        = 1;
    return query select true, 0;
    return;
  end if;

  if v_row.count >= p_limit then
    -- Over limit: do NOT increment (prevents runaway counters).
    return query
      select false,
             greatest(
               0,
               p_window_sec - (v_now_sec - extract(epoch from v_row.window_start)::bigint)::int
             );
    return;
  end if;

  update public.rate_limits
     set count = count + 1
   where user_id = p_user and bucket = p_bucket;

  return query select true, 0;
end;
$$;

-- Service role calls this from Edge Functions; also allow authenticated for future client-side use.
grant execute on function public.rate_limit_hit(uuid, text, int, int) to service_role, authenticated;
