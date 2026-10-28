-- Phase 10 — probe for 20261025_phase10_tracker_al_sheet.sql (the monthly AL Balance Sheet check).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error. Months 2099-01/02 and chassis MB1PROBEAL… keep it
-- apart from anything already on the database; only the probe's own issues are looked at.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  t1 uuid; t4 uuid; t9 uuid;
  jan jsonb := '[]'; feb jsonb; r jsonb; rv jsonb; iss jsonb; n int; paid numeric; owed numeric;
  sha_a text := repeat('a', 64); sha_b text := repeat('b', 64); sha_c text := repeat('c', 64);
  up1 uuid;
  -- one credit line
  ln jsonb;
begin
  -- trucks: one per check, plus a clean one and two that are explained (not shown)
  t1 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL01','ctd',1000,'al_payment_status','Cash Invoiced','al_payment_date','2099-01-10'));
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL02','ctd',1000,'ptb_invoice_date','2025-10-01'));   -- 28% on the sheet, invoiced after the change
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL03','ctd',1000,'ptb_invoice_date','2025-09-01'));   -- 28% on the sheet, invoiced BEFORE
  t4 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL04','ctd',1000));                                  -- sheet CTD 950
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL05','ctd',1000));                                -- credit 777
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL06','ctd',1000));                                -- typed credit
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL07','ctd',1000));                                -- 95%, MTO Advance empty
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL08','ctd',1000,'mto_advance','Yes','vpart_no','CBNPROBE1'));  -- 95%, Yes
  t9 := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL09','ctd',1000,'mto_advance','Yes','vpart_no','CBNPROBE1'));  -- Yes, no line
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL10','ctd',1000,'al_payment_status','IBND'));      -- sheet says paid
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL11','ctd',1000,'al_payment_status','Cash Invoiced','al_payment_date','2099-01-20'));  -- on no sheet
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL12','ctd',1000));                                -- twice
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL13'));                                           -- no CTD
  perform public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEAL14','ctd',1000,'al_payment_status','Cash Invoiced','al_payment_date','2000-06-01'));  -- before the first month
  -- (2000, not 2098: the real sheets on staging start Oct 2023, so the review's window runs 2023 → 2099 — 2098 fell inside it)

  -- January: [row, chassis, mode, sheet CTD, credit, formula]
  jan := jsonb_build_array(jsonb_build_object('row_no', 2, 'line_date', '2098-12-31', 'details', 'CARRY OVER', 'debit', 5000));
  for ln in select jsonb_build_object('row_no', x.rn, 'line_date', '2099-01-05', 'details', 'line ' || x.rn, 'chassis_no', x.ch,
                   'offtake_mode', x.mode, 'ctd', x.ctd, 'credit', x.cr, 'credit_is_formula', x.f, 'cbn', x.cbn)
              from (values
                (3,  'MB1PROBEAL01', 'FRESH OFFTAKE', 1000::numeric, 999::numeric,  true,  null),
                (4,  'MB1PROBEAL02', 'Fresh Offtake', 1084.75, 1083.67, true, null),
                (5,  'MB1PROBEAL03', 'FRESH OFFTAKE', 1084.75, 1083.67, true, null),
                (6,  'MB1PROBEAL04', 'FRESH OFFTAKE', 950,  949.05, true,  null),
                (7,  'MB1PROBEAL05', 'FRESH OFFTAKE', 1000, 777,    true,  null),
                (8,  'MB1PROBEAL06', 'FRESH OFFTAKE', 1000, 999,    false, null),
                (9,  'MB1PROBEAL07', 'FRESH OFFTAKE', 1000, 949.05, true,  null),
                (10, 'MB1PROBEAL08', 'FRESH OFFTAKE', 1000, 949.05, true,  null),
                (11, null,           'MTO',           1000, 49.95,  true,  'CBNPROBE1'),
                (12, 'MB1PROBEAL10', 'FRESH OFFTAKE', 1000, 999,    true,  null),
                (13, 'MB1PROBEAL12', 'IBND',          1000, 999,    true,  null),
                (14, 'MB1PROBEAL12', 'IBND',          1000, 999,    true,  null),
                (15, 'MB1PROBEAL13', 'FRESH OFFTAKE', 1000, 999,    true,  null),
                (16, 'MB1PROBEAL01', 'PARTS PKG',     500,  500,    true,  null),
                (17, 'MB1PROBEAL01', 'WHATEVER',      100,  100,    true,  null),
                (18, 'MB1PROBEAL01', null,            100,  100,    true,  null),
                (19, null,           'AMC',           300,  300,    true,  null),
                (20, 'MB1PROBEALXX', 'FRESH OFFTAKE', 1000, 999,    false, null)   -- typed too: listed once, as not in the tracker
              ) x(rn, ch, mode, ctd, cr, f, cbn) loop
    jan := jan || jsonb_build_array(jsonb_strip_nulls(ln));
  end loop;
  jan := jan || jsonb_build_array(jsonb_build_object('row_no', 21, 'line_date', '2099-01-06', 'details', 'INDENT AXIS', 'debit', 20000));
  select sum(coalesce((x ->> 'debit')::numeric, 0)), sum(coalesce((x ->> 'credit')::numeric, 0)) into paid, owed from jsonb_array_elements(jan) x;
  jan := jan || jsonb_build_array(jsonb_build_object('row_no', 22, 'line_date', '2099-01-31', 'details', 'Net Balance', 'debit', paid - owed));
  -- February: the carry over is NOT January's net, and its own net does not tie
  feb := jsonb_build_array(
    jsonb_build_object('row_no', 2, 'line_date', '2099-01-31', 'details', 'CARRY OVER', 'debit', paid - owed + 10),
    jsonb_build_object('row_no', 3, 'line_date', '2099-02-03', 'details', 'INDENT', 'debit', 100),
    jsonb_build_object('row_no', 4, 'line_date', '2099-02-28', 'details', 'Net Balance', 'debit', 1));

  -- 1. upload, then the same file again, then another file for the month (refused), then replace
  r := public.tracker_al_upload(me, '2099-01-01', 'AL Balance Sheet -0199.xlsx', sha_a, false, jan);
  up1 := (r ->> 'upload_id')::uuid;
  if (r ->> 'ok')::boolean and not (r ->> 'replayed')::boolean and (r ->> 'lines')::int = jsonb_array_length(jan)
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 upload ' || r::text; end if;
  r := public.tracker_al_upload(me, '2099-01-01', 'AL Balance Sheet -0199.xlsx', upper(sha_a), false, jan);
  select count(*) into n from public.al_sheet_uploads where month = '2099-01-01';
  if (r ->> 'replayed')::boolean and n = 1 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1b same file not replayed ' || n; end if;
  r := public.tracker_al_upload(me, '2099-01-01', 'AL Balance Sheet -0199 v2.xlsx', sha_b, false, jan);
  if not (r ->> 'ok')::boolean and r ->> 'reason' = 'exists' and r ->> 'file_name' = 'AL Balance Sheet -0199.xlsx'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1c second file accepted ' || r::text; end if;
  perform public.tracker_al_upload(me, '2099-02-01', 'AL Balance Sheet -0299.xlsx', sha_c, false, feb);

  -- 2. the issues, each where it should be — and nothing for the clean truck or the explained ones
  rv := public.tracker_al_review();
  select coalesce(jsonb_agg(i), '[]') into iss from jsonb_array_elements(rv -> 'issues') i
   where i ->> 'chassis' like 'MB1PROBEAL%' or i ->> 'subject' like '2099-%' or i ->> 'subject' like 'CBNPROBE%' or i ->> 'subject' like 'MB1PROBEAL%';
  declare
    want text[][] := array[
      ['net_not_tie','2099-02'], ['carry_chain','2099-02'],
      ['gst_before','2099-01|MB1PROBEAL03'], ['ctd_diff','2099-01|MB1PROBEAL04'], ['credit_not_split','2099-01|MB1PROBEAL05'],
      ['typed_credit','2099-01|MB1PROBEAL06'], ['mto_not_yes','2099-01|MB1PROBEAL07'], ['under_100','MB1PROBEAL07'],
      ['still_ibnd','2099-01|MB1PROBEAL10'], ['twice','2099-01|MB1PROBEAL12'], ['over_100','MB1PROBEAL12'],
      ['no_ctd','2099-01|MB1PROBEAL13'], ['spelling','2099-01|PARTS PKG'], ['unknown_mode','2099-01|WHATEVER'],
      ['no_mode','2099-01|MB1PROBEAL01'], ['no_chassis','2099-01|row 19'], ['not_in_tracker','2099-01|MB1PROBEALXX'],
      ['not_on_sheet','MB1PROBEAL11'], ['mto_count','CBNPROBE1']];
    k int; missing text := '';
  begin
    for k in 1 .. array_length(want, 1) loop
      if not exists (select 1 from jsonb_array_elements(iss) i where i ->> 'check' = want[k][1] and i ->> 'subject' = want[k][2]) then
        missing := missing || ' ' || want[k][1] || '@' || want[k][2];
      end if;
    end loop;
    if missing = '' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2 missing:' || missing; end if;
    -- exactly those (no extra issue on the probe's own trucks)
    if jsonb_array_length(iss) = array_length(want, 1) then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |2b ' || jsonb_array_length(iss) || ' issues, want ' || array_length(want, 1) || ': ' ||
      (select string_agg(i ->> 'check' || '@' || (i ->> 'subject'), ' ') from jsonb_array_elements(iss) i); end if;
  end;
  if not exists (select 1 from jsonb_array_elements(iss) i where i ->> 'subject' in ('2099-01|MB1PROBEAL02', 'MB1PROBEAL08', '2099-01|MB1PROBEAL08', 'MB1PROBEAL14', '2099-01'))
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2c the explained/clean ones were listed'; end if;
  if (rv -> 'explained' ->> 'gst')::int >= 1 and (rv -> 'explained' ->> 'mto_advances')::int >= 1
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2d explained ' || (rv -> 'explained')::text; end if;
  if (select (m ->> 'net')::numeric = paid - owed and (m ->> 'paid')::numeric = paid and (m ->> 'owed')::numeric = owed
        from jsonb_array_elements(rv -> 'months') m where m ->> 'month' = '2099-01')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2e month totals'; end if;
  -- the issue names the truck, for "go to truck"
  if (select i ->> 'unit_id' from jsonb_array_elements(iss) i where i ->> 'check' = 'ctd_diff' and i ->> 'subject' = '2099-01|MB1PROBEAL04') = t4::text
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2f unit id'; end if;

  -- 3. "this is right": remembered, the first answer stands, a reason is required
  r := public.tracker_al_settle(me, 'ctd_diff', '2099-01|MB1PROBEAL04', 'AL corrected the CTD in their books');
  if (r ->> 'ok')::boolean and not (r ->> 'already')::boolean then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 settle'; end if;
  r := public.tracker_al_settle(me, 'ctd_diff', '2099-01|MB1PROBEAL04', 'another reason');
  if (r ->> 'already')::boolean and r ->> 'reason' = 'AL corrected the CTD in their books' then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3b second answer won'; end if;
  begin perform public.tracker_al_settle(me, 'ctd_diff', '2099-01|MB1PROBEAL05', '   '); fail := fail + 1; msgs := msgs || ' |3c no reason accepted';
  exception when raise_exception or check_violation then pass := pass + 1; end;

  -- 4. replace January: the old file is kept (marked), one current, the settled line still settled
  r := public.tracker_al_upload(me, '2099-01-01', 'AL Balance Sheet -0199 v2.xlsx', sha_b, true, jan);
  select count(*) into n from public.al_sheet_uploads where month = '2099-01-01' and replaced_at is null;
  if (r ->> 'ok')::boolean and (r ->> 'replaced')::boolean and n = 1
     and (select replaced_at is not null and replaced_by = me from public.al_sheet_uploads where id = up1)
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 replace ' || r::text; end if;
  rv := public.tracker_al_review();
  if (select i -> 'settled' ->> 'reason' from jsonb_array_elements(rv -> 'issues') i where i ->> 'check' = 'ctd_diff' and i ->> 'subject' = '2099-01|MB1PROBEAL04') = 'AL corrected the CTD in their books'
     and (select count(*) from jsonb_array_elements(rv -> 'issues') i where i ->> 'subject' = '2099-01|MB1PROBEAL06') = 1
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4b after replace: settled lost or lines doubled'; end if;
  if (select (m ->> 'file_name') from jsonb_array_elements(rv -> 'months') m where m ->> 'month' = '2099-01') = 'AL Balance Sheet -0199 v2.xlsx'
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4c months list the old file'; end if;

  -- 5. refusals
  begin perform public.tracker_al_upload(me, '2099-01-15', 'x', sha_a, false, jan); fail := fail + 1; msgs := msgs || ' |5 mid-month ran';
  exception when raise_exception then pass := pass + 1; end;
  begin perform public.tracker_al_upload(me, '2099-03-01', 'x', sha_a, false, '[]'); fail := fail + 1; msgs := msgs || ' |5b empty ran';
  exception when raise_exception then pass := pass + 1; end;
  begin perform public.tracker_al_upload(me, '2099-03-01', 'x', 'not-a-hash', false, jan); fail := fail + 1; msgs := msgs || ' |5c bad hash ran';
  exception when check_violation then pass := pass + 1; end;
  begin perform public.tracker_al_upload(me, '2099-03-01', 'x', sha_a, false,
          (select jsonb_agg(jsonb_build_object('row_no', g, 'details', 'x')) from generate_series(1, 2001) g)); fail := fail + 1; msgs := msgs || ' |5d 2001 lines ran';
  exception when raise_exception then pass := pass + 1; end;

  -- 6. nothing in the tracker changed by any of it
  if (select count(*) from public.tracker_audit where unit_id in (t1, t4, t9) and source <> 'create') = 0
     and (select ctd from public.vehicle_units where id = t4) = 1000
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6 tracker changed'; end if;

  -- 7. no API role may call or read any of it
  if not has_function_privilege('authenticated', 'public.tracker_al_review()', 'execute')
     and not has_function_privilege('anon', 'public.tracker_al_upload(uuid, date, text, text, boolean, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.tracker_al_settle(uuid, text, text, text)', 'execute')
     and not has_table_privilege('authenticated', 'public.al_sheet_lines', 'select')
     and not has_table_privilege('anon', 'public.al_sheet_uploads', 'select')
     and not has_table_privilege('authenticated', 'public.al_sheet_settled', 'insert')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7 API role has access'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
