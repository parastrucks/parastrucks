-- Phase 10 — probe for 20261024_phase10_tracker_working_set.sql (tracker_book: the grid's working set).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error. Dates are relative to the function's own fy_start.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  fy date := (public.tracker_book('ids', null, array['chassis_no'], null, array[gen_random_uuid()]) ->> 'fy_start')::date;
  cur uuid; edge uuid; paid uuid; refund uuid; fresh uuid; stock uuid; fin uuid; alun uuid; old2 uuid; reb uuid;
  b jsonb; ids text[]; r jsonb;
  ok_ boolean;
begin
  -- this year (on the first day), last year paid and delivered, last year with a refund pending, a row typed
  -- today with no dates, stock bought last year, last year financed with the money not in, AL unpaid
  cur    := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000001','ptb_invoice_date', fy, 'ctc', 100, 'model', 'X'));
  edge   := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000002','ptb_invoice_date', fy - 1, 'al_payment_status','Cash Invoiced','delivery_status','DELIVERED','refund_status','REFUNDED'));
  refund := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000003','ptb_invoice_date', fy - 200, 'refund_status','Pending'));
  fresh  := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000004'));
  stock  := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000005','oem_gatepass_date', fy - 300));
  fin    := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000006','ptb_invoice_date', fy - 30, 'finance_bank','HDFC BANK','delivery_status','DELIVERED'));
  alun   := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000007','ptb_invoice_date', fy - 30, 'al_payment_status','IBND','delivery_status','DELIVERED'));
  old2   := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000008','ptb_invoice_date', fy - 400, 'finance_bank','CASH','delivery_status','DELIVERED', 'date_of_retail', fy - 400));
  -- an old row superseded by a rebill (still open by its fields, but superseded rows are not shown)
  reb    := public.tracker_create_unit(me, gen_random_uuid(), jsonb_build_object('chassis_no','MB1PROBEWS0000009','refund_status','PENDING','ptb_invoice_date', fy - 10));
  update public.vehicle_units set superseded_at = now(), superseded_by_id = cur where id = reb;
  insert into public.vehicle_unit_incentives (unit_id, dsm_incentive, updated_by) values (cur, 500, me);
  insert into public.unit_cell_notes (unit_id, column_key, body, source) values (cur, 'ctc', 'probe note', 'portal'), (cur, 'dsm_incentive', 'secret', 'portal'), (edge, 'ctc', 'old note', 'portal');
  insert into public.unit_cell_formats (unit_id, column_key, format) values (cur, 'model', '{"bg":{"rgb":"#FFFF00"}}'), (edge, 'model', '{"bg":{"rgb":"#FFFF00"}}');

  -- 1. the working set: this year from its first day, no-date rows, and every still-open older truck
  b := public.tracker_book('working', null, array['chassis_no','ctc','model'], null, null);
  select array_agg(x ->> 'chassis_no') into ids from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' like 'MB1PROBEWS%';
  if ids @> array['MB1PROBEWS0000001','MB1PROBEWS0000003','MB1PROBEWS0000004','MB1PROBEWS0000005','MB1PROBEWS0000006','MB1PROBEWS0000007']
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 working missing ' || coalesce(array_to_string(ids, ','), '-'); end if;
  if not (ids && array['MB1PROBEWS0000002','MB1PROBEWS0000008','MB1PROBEWS0000009'])
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1b working has closed/old/superseded ' || array_to_string(ids, ','); end if;

  -- 2. only the asked-for columns, no empty cells, id always
  select x into r from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' = 'MB1PROBEWS0000001';
  if r ? 'id' and r ? 'ctc' and not (r ? 'engine_no') and not (r ? 'refund_status') and not (r ? 'book_date') and not (r ? 'still_open')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2 row shape ' || r; end if;
  select x into r from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' = 'MB1PROBEWS0000004';
  if not (r ? 'ctc') and not (r ? 'model') then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2b empty cells sent ' || r; end if;

  -- 3. incentives only when asked; notes + colours only for the rows in scope; hidden keys left out
  select x into r from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' = 'MB1PROBEWS0000001';
  if not (r ? 'dsm_incentive') then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 incentive without asking'; end if;
  b := public.tracker_book('working', null, array['chassis_no'], array['dsm_incentive'], null, false, array['dsm_incentive']);
  select x into r from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' = 'MB1PROBEWS0000001';
  if (r ->> 'dsm_incentive')::numeric = 500 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3b incentive asked ' || r; end if;
  select bool_and(n ->> 'unit_id' <> edge::text) and bool_or(n ->> 'body' = 'probe note') and not bool_or(n ->> 'column_key' = 'dsm_incentive')
    into ok_ from jsonb_array_elements(b -> 'notes') n where (n ->> 'unit_id')::uuid in (cur, edge);
  if ok_ then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3c notes ' || (b -> 'notes'); end if;
  select bool_and(f ->> 'unit_id' <> edge::text) and count(*) = 1 into ok_ from jsonb_array_elements(b -> 'formats') f where (f ->> 'unit_id')::uuid in (cur, edge);
  if ok_ then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3d formats'; end if;

  -- 4. a past year: last year's trucks by book date, this year's not
  b := public.tracker_book('year', extract(year from fy)::int - 1, array['chassis_no'], null, null);
  select array_agg(x ->> 'chassis_no') into ids from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' like 'MB1PROBEWS%';
  if ids @> array['MB1PROBEWS0000002','MB1PROBEWS0000003','MB1PROBEWS0000005','MB1PROBEWS0000006'] and not (ids && array['MB1PROBEWS0000001','MB1PROBEWS0000004','MB1PROBEWS0000009'])
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 year ' || coalesce(array_to_string(ids, ','), '-'); end if;

  -- 5. by ids (Find across all years), superseded included when named
  b := public.tracker_book('ids', null, array['chassis_no'], null, array[old2, reb]);
  if jsonb_array_length(b -> 'rows') = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5 ids ' || (b -> 'rows'); end if;

  -- 5b. the DSE slab counts the WHOLE book: RAVI retailed 2 trucks this month, only one of them is in the working set
  update public.vehicle_units set dse = 'Ravi ', date_of_retail = fy + 3 where id = cur;
  update public.vehicle_units set dse = 'RAVI', date_of_retail = fy + 5, ptb_invoice_date = fy - 400, delivery_status = 'DELIVERED' where id = old2;
  b := public.tracker_book('working', null, array['chassis_no'], null, null);
  if (b -> 'dse_counts' ->> ('RAVI|' || to_char(fy + 3, 'YYYY-MM')))::int = 2 and not exists (select 1 from jsonb_array_elements(b -> 'rows') x where x ->> 'chassis_no' = 'MB1PROBEWS0000008')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5b dse_counts ' || (b -> 'dse_counts'); end if;

  -- 5c. pages: a scope in the book's order, page by page, adds up to the whole; scope_count says how many
  -- (the probe's own six trucks, two a page — so it runs as fast on a large book)
  b := public.tracker_book('ids', null, array['chassis_no'], null, array[cur, refund, fresh, stock, fin, alun]);
  declare whole int := jsonb_array_length(b -> 'rows'); cnt int := (b ->> 'scope_count')::int; got int := 0; off int := 0; pg jsonb; firsts text := '';
          notes_whole int := jsonb_array_length(b -> 'notes'); notes_got int := 0;
  begin
    loop
      pg := public.tracker_book('ids', null, array['chassis_no'], null, array[cur, refund, fresh, stock, fin, alun], false, '{}', off, 2);
      exit when jsonb_array_length(pg -> 'rows') = 0;
      got := got + jsonb_array_length(pg -> 'rows'); off := off + 2;
      notes_got := notes_got + jsonb_array_length(pg -> 'notes');
      if (pg ->> 'scope_count')::int <> cnt then got := -1000; end if;
    end loop;
    if got = whole and cnt = whole and whole = 6 and notes_got = notes_whole and notes_whole = 2 then pass := pass + 1; else fail := fail + 1; msgs := msgs || format(' |5c pages %s of %s (count %s) notes %s of %s', got, whole, cnt, notes_got, notes_whole); end if;
  end;
  begin perform public.tracker_book('working', null, array['chassis_no'], null, null, false, '{}', 0, 0); fail := fail + 1; msgs := msgs || ' |5d limit 0 ran';
  exception when raise_exception then pass := pass + 1; end;

  -- 6. refusals
  begin perform public.tracker_book('nope', null, array['chassis_no'], null, null); fail := fail + 1; msgs := msgs || ' |6 unknown scope ran';
  exception when raise_exception then pass := pass + 1; end;
  begin perform public.tracker_book('year', null, array['chassis_no'], null, null); fail := fail + 1; msgs := msgs || ' |6b year without year ran';
  exception when raise_exception then pass := pass + 1; end;

  -- 7. no API role may call it
  if not has_function_privilege('authenticated', 'public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int)', 'execute')
     and not has_function_privilege('anon', 'public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int)', 'execute')
    then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7 API role can execute'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
