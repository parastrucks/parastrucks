-- Phase 10 — LOAD TEST data for STAGING ONLY (owner, 2026-10-24: "check for 4 times the quantity … the next
-- 3-4 years"). The real book is ~6,000 trucks and ~8,400 notes after the first load; this makes ~24,600
-- trucks, ~34,000 notes and ~6,600 colours, all DUMMY:
--   · 11 copies of the 2,050 "DEMO seed" rows (chassis DEMO-L<k>-…, everything else copied, so the mix of
--     filled and empty cells is the seed's) — the trigger works each row out as a save would;
--   · notes and colours on random cells of those copies.
-- Everything carries ONE import batch "DEMO LOAD x4", so it can be found and removed in one statement
-- (removal deletes rows — owner approval first):
--   delete from public.vehicle_units where import_batch_id = (select id from public.tracker_import_batches where source_file = 'DEMO LOAD x4');
--   (notes, colours and the batch's audit rows go with the rows' cascade / batch id)
-- Refuses to run twice, and refuses unless the DEMO seed is present.
-- Run: supabase db query --linked -f scripts/phase10/load-x4.sql   (the actor = the staging admin)
begin;
do $load$
declare
  actor uuid := (select id from auth.users where email = 'admin@parastrucks.test');
  b uuid := gen_random_uuid();
  cols text;
  n int;
begin
  if actor is null then raise exception 'no staging admin — is this staging?'; end if;
  if exists (select 1 from public.tracker_import_batches where source_file = 'DEMO LOAD x4') then raise exception 'already loaded'; end if;
  if (select count(*) from public.vehicle_units where source_file = 'DEMO seed') < 2000 then raise exception 'no DEMO seed'; end if;
  perform set_config('tracker.actor', actor::text, true), set_config('tracker.source', 'import', true), set_config('tracker.batch', b::text, true);
  insert into public.tracker_import_batches (id, source_file, row_count, actor) values (b, 'DEMO LOAD x4', 0, actor);

  -- every stored column except the ones a copy must not share
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicle_units'
     and column_name not in ('id', 'chassis_no', 'import_batch_id', 'source_file', 'source_row', 'created_at', 'updated_at',
                             'created_by', 'updated_by', 'superseded_at', 'superseded_by_id', 'recompute', 'make_year');
  execute format(
    'insert into public.vehicle_units (chassis_no, import_batch_id, source_file, source_row, recompute, created_by, updated_by, %1$s)
     select ''DEMO-L'' || k || ''-'' || substr(u.chassis_no, 6), $1, ''DEMO LOAD x4'', u.source_row, true, $2, $2, %2$s
       from public.vehicle_units u cross join generate_series(1, 11) k
      where u.source_file = ''DEMO seed''',
    cols, (select string_agg('u.' || c, ', ') from unnest(string_to_array(cols, ', ')) c)) using b, actor;
  get diagnostics n = row_count;
  update public.tracker_import_batches set row_count = n where id = b;

  -- the copies numbered once, so a note or colour picks a row by number (an OFFSET per note would read
  -- the table 34,000 times)
  create temp table load_rows on commit drop as
    select row_number() over (order by id) - 1 as i, id from public.vehicle_units where import_batch_id = b;

  -- ~34,000 notes, like the import's (a disagreement naming another file), on common columns
  insert into public.unit_cell_notes (unit_id, column_key, body, source)
  select u.id, (array['ctc','al_ctc','ctd','customer_name','model','dse','ptb_invoice_date','date_of_delivery','vpart_no','tally_bill'])[1 + (g % 10)],
         'DEMO LOAD note. Shown: Sales book (2025-26.xlsx, row ' || g || '). Other files say — Invoice Tracker (INVOICE TRACKER 2024-25.xlsx, row ' || (g % 2000) || '): 28,00,000',
         case when g % 8 = 0 then 'excel_comment' else 'import' end
    from generate_series(1, 34000) g
    join load_rows u on u.i = (g::bigint * 7919) % n;

  -- ~6,600 colours (yellow / orange flags)
  insert into public.unit_cell_formats (unit_id, column_key, format, updated_by)
  select u.id, (array['ctc','ctd','model','customer_name','al_payment_status','tally_bill'])[1 + (g % 6)],
         jsonb_build_object('bg', jsonb_build_object('rgb', case when g % 3 = 0 then '#FFC000' else '#FFFF00' end)), actor
    from generate_series(1, 6600) g
    join load_rows u on u.i = (g::bigint * 104729) % n
  on conflict do nothing;
end;
$load$;
select (select row_count from public.tracker_import_batches where source_file = 'DEMO LOAD x4') trucks_added,
       (select count(*) from public.vehicle_units) trucks_total, (select count(*) from public.unit_cell_notes) notes_total,
       (select count(*) from public.unit_cell_formats) colours_total, pg_size_pretty(pg_database_size(current_database())) db_size;
commit;
