-- Probe for 20261029_gate_promises.sql — run on STAGING (or a rehearsal copy), never prod.
-- Self-aborting: everything it writes is rolled back by the final RAISE. A green run ENDS
-- IN AN ERROR reading "PROBE COMPLETE: n passed, 0 failed".
--   npx supabase@2.109.1 db query --linked --workdir <scratch> -f scripts/invoices/probe-gate-promises.sql
--
-- What it proves, on an existing approved release and an existing held one:
--   accepted: a promise dated the day of approval, one 90 days later, a responsible person
--   alone, a date alone, and clearing a promise again;
--   refused: a promise dated before the approval day, one 91 days later, a promise on a held
--   release, a responsible person who is not a user;
--   the day is India's: an approval at 23:30 IST is that day, though UTC says the day before.
do $$
declare
  pass int := 0; fail int := 0;
  appr record; held record;
  d date;
  staff uuid := (select id from users where is_active order by created_at limit 1);
  msgs text := '';
begin
  select * into appr from gate_releases where status = 'approved' order by decided_at desc limit 1;
  select * into held from gate_releases where status = 'held' order by decided_at desc limit 1;
  if appr.id is null or held.id is null then raise exception 'probe: needs one approved and one held release on staging'; end if;
  d := (appr.decided_at at time zone 'Asia/Kolkata')::date;

  -- ── accepted ──
  begin
    update gate_releases set promised_by = d where id = appr.id;
    update gate_releases set promised_by = d + 90 where id = appr.id;
    update gate_releases set promised_by = null, responsible_id = staff where id = appr.id;
    update gate_releases set promised_by = d + 3, responsible_id = null where id = appr.id;
    update gate_releases set promised_by = d + 3, responsible_id = staff where id = appr.id;
    update gate_releases set promised_by = null, responsible_id = null where id = appr.id;
    pass := pass + 1;
  exception when others then fail := fail + 1; msgs := msgs || format(' | FAIL: a valid promise was refused: %s', sqlerrm); end;

  -- ── refused ──
  begin
    update gate_releases set promised_by = d - 1 where id = appr.id;
    raise exception using errcode = 'PX001';
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: a promise dated before the approval day was stored';
  end;
  begin
    update gate_releases set promised_by = d + 91 where id = appr.id;
    raise exception using errcode = 'PX001';
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: a promise 91 days out was stored';
  end;
  begin
    update gate_releases set promised_by = (held.decided_at at time zone 'Asia/Kolkata')::date + 1 where id = held.id;
    raise exception using errcode = 'PX001';
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: a promise on a HELD release was stored';
  end;
  begin
    update gate_releases set responsible_id = held.requested_by where id = held.id;
    raise exception using errcode = 'PX001';
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: a responsible person on a HELD release was stored';
  end;
  begin
    update gate_releases set responsible_id = gen_random_uuid() where id = appr.id;
    raise exception using errcode = 'PX001';
  exception
    when foreign_key_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: a responsible person who is not a user was stored';
  end;

  -- ── the day is India's ──
  -- Re-date the approval to 23:30 IST on the 1st (18:00 UTC — still the 1st in UTC too) and to
  -- 00:30 IST on the 2nd (19:00 UTC on the 1st): a promise for the 1st must fit only the first.
  begin
    update gate_releases set decided_at = timestamptz '2026-11-01 18:00:00+00', valid_until = timestamptz '2026-11-03 18:00:00+00',
           promised_by = date '2026-11-01' where id = appr.id;
    pass := pass + 1;
  exception when others then fail := fail + 1; msgs := msgs || format(' | FAIL: approved 23:30 IST on the 1st, promise for the 1st refused: %s', sqlerrm); end;
  begin
    update gate_releases set decided_at = timestamptz '2026-11-01 19:00:00+00', valid_until = timestamptz '2026-11-03 19:00:00+00',
           promised_by = date '2026-11-01' where id = appr.id;
    raise exception using errcode = 'PX001';
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || ' | FAIL: approved 00:30 IST on the 2nd, a promise for the 1st (UTC''s day) was stored';
  end;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, msgs;
end $$;
