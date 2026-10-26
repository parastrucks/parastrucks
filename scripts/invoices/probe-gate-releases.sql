-- Probe for 20261026_gate_releases.sql — run on STAGING (or a rehearsal copy), never prod.
-- Self-aborting: everything it writes is rolled back by the final RAISE. A green run ENDS
-- IN AN ERROR reading "PROBE COMPLETE: n passed, 0 failed".
--   npx supabase@2.109.1 db query --linked --workdir <scratch> -f scripts/invoices/probe-gate-releases.sql
--
-- What it proves:
--   the Security department, its designation and the six /gate access rules exist;
--   the table refuses: a second open request for one invoice, an approval with no expiry,
--   a hold with no note, a "may go" check with no release, a "hold" check with one;
--   who can READ (real staging users, RLS as `authenticated`): service / accounts / spares
--   of the same entity and the admin see the release and the check; everyone else none;
--   nobody signed in can write a release or read a push subscription (not even the admin);
--   a GUARD (a real user moved into Security, brands removed — all rolled back) reads no
--   release, no check, no catalog row, no quotation and no proforma invoice.
do $$
declare
  pass int := 0; fail int := 0;
  ptb uuid := (select id from entities where code = 'PTB');
  sec uuid := (select id from departments where code = 'security');
  uploader uuid; doc_id uuid; rel_id uuid; guard uuid;
  n int; m int; ok boolean;
  who record;
  t text;
  msgs text := '';
begin
  -- It moves a real user into Security for the guard checks (rolled back). On a database
  -- whose users table calls out over HTTP (prod's ERP-sync webhook) that is not done.
  if exists (select 1 from pg_trigger tg where tg.tgrelid = 'public.users'::regclass and not tg.tgisinternal
              and (pg_get_triggerdef(tg.oid) ilike '%http_request%' or pg_get_triggerdef(tg.oid) ilike '%net.http%')) then
    raise exception 'REFUSED: public.users has an HTTP trigger (prod ERP sync?). This probe is staging-only.';
  end if;

  -- ── the reference rows ──
  if sec is not null and (select is_active from departments where id = sec)
     and exists (select 1 from designations where department_id = sec and code = 'security_guard' and default_permission_tier = 'executive') then pass := pass + 1;
  else fail := fail + 1; msgs := msgs || format(' | FAIL: Security department / Security Guard designation missing'); end if;
  if (select count(*) from access_rules where route = '/gate' and department_id = sec) = 6
     and (select count(*) from access_rules where route = '/gate') = 6 then pass := pass + 1;
  else fail := fail + 1; msgs := msgs || format(' | FAIL: /gate access rules are not exactly the six Security rows'); end if;

  select u.id into uploader from users u join departments d on d.id = u.department_id
   where d.code = 'service' and u.is_active and u.entity_id = ptb order by u.created_at limit 1;
  if uploader is null then raise exception 'probe: no active PTB service user on this database'; end if;

  doc_id := gate_record_document(jsonb_build_object(
    'entity_id', ptb, 'layout', 'workshop', 'sap_form', 'ZDBMF_COVERING_LETTER_001',
    'doc_no', 'WTY57562627088888', 'doc_date', '2026-10-26', 'sap_customer_code', '888888',
    'customer_name', 'PROBE CUSTOMER', 'regn_no', 'GJ01PR8888', 'total_paise', 100000,
    'file_path', 'PTB/probe/WTY57562627088888.pdf', 'file_sha256', repeat('c', 64), 'file_bytes', 1000,
    'uploaded_by', uploader),
    '[{"bill_no":"LCR5756268888801","bill_date":"2026-10-26","amount_paise":100000}]');

  -- ── the table's own rules ──
  insert into gate_releases (entity_id, document_id, regn_no, requested_by, client_request_id)
  values (ptb, doc_id, 'GJ01PR8888', uploader, gen_random_uuid()) returning id into rel_id;
  pass := pass + 1;

  begin
    insert into gate_releases (entity_id, document_id, regn_no, requested_by, client_request_id)
    values (ptb, doc_id, 'GJ01PR8888', uploader, gen_random_uuid());
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when unique_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: a second open request for one invoice was stored');
  end;

  begin
    update gate_releases set status = 'approved', decided_by = uploader, decided_at = now() where id = rel_id;
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: an approval with no expiry was stored');
  end;

  begin
    update gate_releases set status = 'held', decided_by = uploader, decided_at = now(), decision_note = '  ' where id = rel_id;
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: a hold with no note was stored');
  end;

  begin
    update gate_releases set status = 'approved', decided_at = now(), valid_until = now() + interval '48 hours' where id = rel_id;
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: an approval with nobody deciding was stored');
  end;

  update gate_releases set status = 'approved', decided_by = uploader, decided_at = now(),
         valid_until = now() + interval '48 hours' where id = rel_id;
  -- Once decided, a new request for the same invoice is allowed again (the one-open rule).
  begin
    insert into gate_releases (entity_id, document_id, regn_no, requested_by, client_request_id, status, decided_by, decided_at, decision_note)
    values (ptb, doc_id, 'GJ01PR8888', uploader, gen_random_uuid(), 'withdrawn', uploader, now(), null);
    pass := pass + 1;
  exception when others then fail := fail + 1; msgs := msgs || format(' | FAIL: a decided request blocked the next one: %s', sqlerrm); end;

  begin
    insert into gate_checks (entity_id, guard_id, regn_query, result) values (ptb, uploader, 'GJ01PR8888', 'may_go');
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: a "may go" check with no release was stored');
  end;
  begin
    insert into gate_checks (entity_id, guard_id, regn_query, result, release_id) values (ptb, uploader, 'GJ01PR8888', 'hold', rel_id);
    raise exception using errcode = 'PX001';   -- accepted: undo it, then record the failure
  exception
    when check_violation then pass := pass + 1;
    when sqlstate 'PX001' then fail := fail + 1; msgs := msgs || format(' | FAIL: a "hold" check pointing at a release was stored');
  end;
  insert into gate_checks (entity_id, guard_id, regn_query, result, release_id) values (ptb, uploader, 'GJ01PR8888', 'may_go', rel_id);
  insert into gate_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (uploader, 'https://fcm.googleapis.com/fcm/send/probe', repeat('B', 87), repeat('a', 22));

  -- ── a guard: a real user moved into Security with no brand (rolled back at the end) ──
  -- Prefer someone who HAS brands (so "reads no catalog" is a real test), from either company.
  select u.id into guard from users u
   where u.is_active and u.permission_level <> 'admin' and u.id <> uploader
   order by (select count(*) from user_brands ub where ub.user_id = u.id) desc, u.created_at limit 1;
  if guard is null then raise exception 'probe: no active non-admin user to stand in for a guard'; end if;
  update users set department_id = sec, permission_level = 'executive', entity_id = ptb where id = guard;
  delete from user_brands where user_id = guard;
  delete from user_sales_verticals where user_id = guard;

  -- ── who can read (RLS, as each real user) ──
  for who in
    select u.id, u.is_active, u.permission_level, u.entity_id, d.code as dept,
           case
             when not u.is_active then 0
             when u.permission_level = 'admin' then 1
             when u.entity_id = ptb and d.code in ('service', 'accounts', 'spares') then 1
             else 0
           end as expect
    from users u left join departments d on d.id = u.department_id
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from gate_releases where document_id = doc_id and id = rel_id;
    select count(*) into m from gate_checks where release_id = rel_id;
    ok := n = who.expect and m = who.expect;
    begin
      insert into gate_releases (entity_id, document_id, regn_no, requested_by, client_request_id)
      values (ptb, doc_id, 'GJ01PR8888', who.id, gen_random_uuid());
      ok := false; msgs := msgs || format(' | FAIL: %s (%s) wrote a release directly', who.dept, who.permission_level);
    exception when insufficient_privilege then null; end;
    begin
      update gate_releases set decision_note = 'x' where id = rel_id;
      get diagnostics n = row_count;
      if n > 0 then ok := false; msgs := msgs || format(' | FAIL: %s (%s) changed a release directly', who.dept, who.permission_level); end if;
    exception when insufficient_privilege then null; end;
    begin
      perform 1 from gate_push_subscriptions limit 1;
      ok := false; msgs := msgs || format(' | FAIL: %s (%s) could read push subscriptions', who.dept, who.permission_level);
    exception when insufficient_privilege then null; end;
    if who.id = guard then
      foreach t in array array['vehicle_catalog', 'quotations', 'proforma_invoices', 'financier_copies', 'gate_documents', 'gate_bills', 'gate_contacts'] loop
        execute format('select count(*) from public.%I', t) into n;
        if n > 0 then ok := false; msgs := msgs || format(' | FAIL: the guard reads %s rows of %s', n, t); end if;
      end loop;
      if current_user_role() is distinct from 'security' then ok := false; msgs := msgs || format(' | FAIL: the guard''s role reads %s', current_user_role()); end if;
    end if;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    if ok then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || format(' | FAIL: %s %s active=%s saw %s releases / %s checks, expected %s',
      coalesce(case when who.id = guard then 'GUARD' end, who.dept), who.permission_level, who.is_active, n, m, who.expect); end if;
  end loop;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, msgs;
end $$;
