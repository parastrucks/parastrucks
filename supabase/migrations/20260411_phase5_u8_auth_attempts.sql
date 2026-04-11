-- Phase 5 U8 — Login hardening.
-- Tracks failed password attempts per email so verify-login EF can lock out an
-- account after 5 failures within a 15-min window. Lockout itself lasts 15 min.
-- Table is touched ONLY by public.auth_attempt_record/check — no direct writes.
-- RLS is enabled with no policies, so anon/authenticated cannot read or write it;
-- the service role bypasses RLS for the EF's admin client.

create table if not exists public.auth_attempts (
  email            text primary key,
  failed_count     int not null default 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.auth_attempts enable row level security;

-- Atomic check + record. Single plpgsql round-trip, same pattern as
-- public.rate_limit_hit (see 20260411_rate_limit_hit_fn.sql).
--
-- p_success = true  → treat as successful login: delete row and return unlocked
-- p_success = false → treat as failed attempt: increment (or reset if window
--                     rolled over), set locked_until if threshold crossed
--
-- Returns (locked, retry_after_s, fails_remaining). `fails_remaining` is the
-- number of failures the caller can still make before the next lockout —
-- the client uses this to show a "2 attempts remaining" hint before lockout.
create or replace function public.auth_attempt_record(
  p_email text,
  p_success boolean,
  p_max_fails int default 5,
  p_window_sec int default 900,
  p_lockout_sec int default 900
) returns table(locked boolean, retry_after_s int, fails_remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_row   public.auth_attempts%rowtype;
  v_now   timestamptz := now();
begin
  v_email := lower(trim(p_email));
  if v_email is null or v_email = '' then
    return query select false, 0, p_max_fails;
    return;
  end if;

  select * into v_row
  from public.auth_attempts
  where email = v_email
  for update;

  -- Success: clear the row entirely. A successful login forgives prior failures.
  if p_success then
    if found then
      delete from public.auth_attempts where email = v_email;
    end if;
    return query select false, 0, p_max_fails;
    return;
  end if;

  -- Failure path.
  if not found then
    -- First failure ever (or after a prior success cleared the row).
    insert into public.auth_attempts(email, failed_count, first_failed_at, locked_until, updated_at)
    values (v_email, 1, v_now, null, v_now)
    on conflict (email) do update
      set failed_count    = 1,
          first_failed_at = v_now,
          locked_until    = null,
          updated_at      = v_now;
    return query select false, 0, greatest(p_max_fails - 1, 0);
    return;
  end if;

  -- Already locked? Don't increment further — just report remaining lockout.
  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query
      select true,
             greatest(0, extract(epoch from (v_row.locked_until - v_now))::int),
             0;
    return;
  end if;

  -- Sliding window rolled over (older than p_window_sec since first_failed_at)
  -- → reset counter to 1, clear lockout.
  if v_row.first_failed_at is null
     or v_row.first_failed_at < v_now - make_interval(secs => p_window_sec) then
    update public.auth_attempts
       set failed_count    = 1,
           first_failed_at = v_now,
           locked_until    = null,
           updated_at      = v_now
     where email = v_email;
    return query select false, 0, greatest(p_max_fails - 1, 0);
    return;
  end if;

  -- Inside the window: increment. If we cross the threshold, start a lockout.
  if v_row.failed_count + 1 >= p_max_fails then
    update public.auth_attempts
       set failed_count = v_row.failed_count + 1,
           locked_until = v_now + make_interval(secs => p_lockout_sec),
           updated_at   = v_now
     where email = v_email;
    return query select true, p_lockout_sec, 0;
    return;
  end if;

  update public.auth_attempts
     set failed_count = v_row.failed_count + 1,
         updated_at   = v_now
   where email = v_email;
  return query
    select false,
           0,
           greatest(p_max_fails - (v_row.failed_count + 1), 0);
end;
$$;

-- Read-only check used before the password is verified. Does NOT increment
-- counters — lets verify-login short-circuit a locked email without even
-- hitting the Supabase auth endpoint.
create or replace function public.auth_attempt_check(
  p_email text
) returns table(locked boolean, retry_after_s int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_locked_until timestamptz;
  v_now timestamptz := now();
begin
  v_email := lower(trim(p_email));
  if v_email is null or v_email = '' then
    return query select false, 0;
    return;
  end if;

  select locked_until into v_locked_until
  from public.auth_attempts
  where email = v_email;

  if v_locked_until is not null and v_locked_until > v_now then
    return query
      select true, greatest(0, extract(epoch from (v_locked_until - v_now))::int);
    return;
  end if;

  return query select false, 0;
end;
$$;

-- Only the service role should call these. No grants to anon/authenticated.
revoke execute on function public.auth_attempt_record(text, boolean, int, int, int) from public;
revoke execute on function public.auth_attempt_check(text) from public;
grant execute on function public.auth_attempt_record(text, boolean, int, int, int) to service_role;
grant execute on function public.auth_attempt_check(text) to service_role;
