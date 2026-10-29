-- Phase 10 — probe for 20261030_phase10_tracker_checks.sql (Yes/No checks for the team, the owner approves a No).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error. Chassis MB1PROBECK… keep it apart from real trucks.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid(); boss uuid := gen_random_uuid();
  t1 uuid; t2 uuid; t3 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; r jsonb; n int;
begin
  t1 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBECK01','tally_bill',1000,'ctc',1200));
  t2 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBECK02','finance_bank','SELF'));
  t3 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBECK03','tally_bill',1000));
  insert into public.tracker_checks (check_set, question, unit_id, chassis_no, column_key, shown_value)
    select 'PROBE', 'Is this right?', u.id, u.chassis_no, x.col, to_jsonb(u) -> x.col
    from public.vehicle_units u join (values (t1, 'tally_bill'), (t2, 'finance_bank'), (t3, 'tally_bill'), (t1, 'ctc')) x(id, col) on x.id = u.id;
  select id into c1 from public.tracker_checks where unit_id = t1 and column_key = 'tally_bill';
  select id into c2 from public.tracker_checks where unit_id = t2;
  select id into c3 from public.tracker_checks where unit_id = t3;
  select id into c4 from public.tracker_checks where unit_id = t1 and column_key = 'ctc';

  -- 1. a Yes: recorded, nothing to approve, the truck untouched
  r := public.tracker_check_answer(me, c4, 'yes', '5'::jsonb, 'fine');
  if (r ->> 'ok')::boolean and r -> 'item' ->> 'answer' = 'yes' and r -> 'item' -> 'correct_value' = 'null'::jsonb
     and r -> 'item' ->> 'answered_by' = me::text
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 yes ' || r::text; end if;
  r := public.tracker_check_review(boss, c4, 'approve', null);
  if r ->> 'reason' = 'not_a_no' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1b a yes approved'; end if;

  -- 2. a No with the correct value: waits; the truck is not changed until approved
  r := public.tracker_check_answer(me, c1, 'no', '1300'::jsonb, 'bill was 1300');
  if (r ->> 'ok')::boolean and (select tally_bill from public.vehicle_units where id = t1) = 1000
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2 no'; end if;

  -- 3. approve → written, audited as 'check' by the approver, the row's figures recomputed (TCS = bill × 1%)
  r := public.tracker_check_review(boss, c1, 'approve', 'ok');
  if (r ->> 'ok')::boolean and (r ->> 'written')::boolean
     and (select tally_bill from public.vehicle_units where id = t1) = 1300
     and (select tcs from public.vehicle_units where id = t1) = 13
     and (select count(*) from public.tracker_audit where unit_id = t1 and column_key = 'tally_bill' and source = 'check' and actor = boss
            and old_value = '1000' and new_value = '1300') = 1
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 approve ' || r::text; end if;

  -- 4. once approved: no second approval, no new answer
  r := public.tracker_check_review(boss, c1, 'approve', null);
  if r ->> 'reason' = 'approved' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 approved twice'; end if;
  r := public.tracker_check_answer(me, c1, 'yes', null, null);
  if r ->> 'reason' = 'approved' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4b answered after approval'; end if;

  -- 5. send back → the person answers again (the review is cleared)
  r := public.tracker_check_answer(me, c2, 'no', '"HDFC BANK"'::jsonb, null);
  r := public.tracker_check_review(boss, c2, 'send_back', 'which branch?');
  if (r ->> 'ok')::boolean and r -> 'item' ->> 'review' = 'sent_back' and (select finance_bank from public.vehicle_units where id = t2) = 'SELF'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5 send back'; end if;
  r := public.tracker_check_answer(me, c2, 'no', '"HDFC BANK SURAT"'::jsonb, null);
  if r -> 'item' -> 'review' = 'null'::jsonb and r -> 'item' ->> 'correct_value' = 'HDFC BANK SURAT'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5b re-answer ' || r::text; end if;

  -- 6. the truck changed since the check was made → NOT overwritten, the value it holds is returned
  perform set_config('tracker.source', 'typed', true);
  update public.vehicle_units set tally_bill = 1111 where id = t3;
  r := public.tracker_check_answer(me, c3, 'no', '1500'::jsonb, null);
  r := public.tracker_check_review(boss, c3, 'approve', null);
  if r ->> 'reason' = 'changed' and (r ->> 'actual')::numeric = 1111 and (select tally_bill from public.vehicle_units where id = t3) = 1111
     and (select review from public.tracker_checks where id = c3) is null
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6 changed ' || r::text; end if;
  -- … unless it already holds the correct value: approved, nothing written
  update public.vehicle_units set tally_bill = 1500 where id = t3;
  r := public.tracker_check_review(boss, c3, 'approve', null);
  if (r ->> 'ok')::boolean and not (r ->> 'written')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6b already right ' || r::text; end if;

  -- 7. a No without a value: approval writes nothing
  r := public.tracker_check_answer(me, c4, 'no', null, 'not sure');
  r := public.tracker_check_review(boss, c4, 'approve', null);
  if (r ->> 'ok')::boolean and not (r ->> 'written')::boolean and (select ctc from public.vehicle_units where id = t1) = 1200
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7 no without value'; end if;

  -- 8. bad input refused
  begin perform public.tracker_check_answer(me, c2, 'maybe', null, null); fail := fail + 1; msgs := msgs || ' |8 maybe ran';
  exception when raise_exception then pass := pass + 1; end;
  begin perform public.tracker_check_review(boss, c2, 'delete', null); fail := fail + 1; msgs := msgs || ' |8b delete ran';
  exception when raise_exception then pass := pass + 1; end;
  if public.tracker_check_answer(me, gen_random_uuid(), 'yes', null, null) ->> 'reason' = 'not_found'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |8c not found'; end if;
  begin insert into public.tracker_checks (check_set, question, unit_id, chassis_no, column_key) values ('PROBE', 'q', t1, 'x', 'tcs');
    fail := fail + 1; msgs := msgs || ' |8d computed column accepted';
  exception when check_violation then pass := pass + 1; end;
  begin insert into public.tracker_checks (check_set, question, unit_id, chassis_no, column_key) values ('PROBE', 'q', t1, 'x', 'tally_bill');
    fail := fail + 1; msgs := msgs || ' |8e same check twice';
  exception when unique_violation then pass := pass + 1; end;

  -- 9. a truck deleted → its checks go with it
  delete from public.vehicle_units where id = t2;
  select count(*) into n from public.tracker_checks where unit_id = t2;
  if n = 0 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |9 cascade'; end if;

  -- 10. no API role may call or read any of it
  if not has_function_privilege('authenticated', 'public.tracker_check_answer(uuid, uuid, text, jsonb, text)', 'execute')
     and not has_function_privilege('anon', 'public.tracker_check_review(uuid, uuid, text, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.tracker_check_review(uuid, uuid, text, text)', 'execute')
     and not has_table_privilege('authenticated', 'public.tracker_checks', 'select')
     and not has_table_privilege('anon', 'public.tracker_checks', 'select')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |10 API role has access'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
