-- Phase 10 — Vehicle Tracker: the grid opens a WORKING SET, not the whole book (owner, 2026-10-24).
--
-- A 4× load test (24,606 dummy trucks, 34,004 notes — scripts/phase10/load-x4.sql) took 100–270 s to open,
-- froze the browser for 20 s, never finished a sort and sent ~55 MB per open against a 5 GB monthly free
-- allowance: every open loaded every year. The owner chose "current year only": the grid opens THIS
-- financial year plus every older truck that is still open; any other year, or all of them, on request.
--
-- tracker_book(scope, …) returns, in ONE call, one PAGE of a scope's rows with only the asked-for columns
-- and no empty cells, their incentive figures (when asked), notes (with author names), colours, and the
-- whole book's DSE-month counts the slab needs (dse_counts):
--   scope 'working' — this financial year (Apr–Mar, India time) by the truck's book date, every truck with
--                     no date yet (stock, a row just typed), and every older truck still open;
--   scope 'year'    — the financial year starting April p_year;
--   scope 'all'     — every truck;
--   scope 'ids'     — the given trucks (Find across all years).
-- book date = PTB invoice date, else retail date, else the OEM gatepass date.
-- "Still open" (measured on the real 2022-26 files, 2026-10-24: 1,491 of 5,832 older trucks):
--   stock (no invoice and no retail date, not delivered) · AL payment status filled and not paid ·
--   refund pending / to collect · delivery pending or stock · financed and the finance money not received.
-- The paid words are the grid's own (src/tracker/lib/cellFormats.js PAID_WORDS; selftest-vehicle-units
-- checks the two lists agree).
--
-- FAST BY INDEX, PAGED (measured on the free instance at 24,606 trucks): a call through PostgREST runs under
-- the authenticator's 8 s statement_timeout. Deciding the scope by checking every truck took 1.5 s of a
-- 1.6 s page and grows with the book — so the book date and the still-open rule are INDEXED (an expression
-- index and a partial index; both need an IMMUTABLE function of plain columns) and the scope's query is
-- built per scope (EXECUTE) so the planner can use them. The Edge Function asks for pages of 2,000 rows;
-- scope_count = the scope's size; notes, colours and dse_counts are those of the page's rows.
--
-- Only the Edge Function (service role) may call it: no grant to anon / authenticated, like every tracker table.
-- Rollback: drop function public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int);
--           drop index public.vehicle_units_still_open; drop index public.vehicle_units_book_date;
--           drop function public.tracker_still_open(timestamptz, date, date, text, text, text, text, date);

begin;

-- earlier drafts of this file (staging only)
drop function if exists public.tracker_book(text, int, text[], text[], uuid[], boolean, text[]);
drop function if exists public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int);
drop function if exists public.tracker_still_open(public.vehicle_units);

create or replace function public.tracker_still_open(
  p_superseded_at timestamptz, p_invoice date, p_retail date, p_delivery text, p_al_status text,
  p_refund text, p_finance_bank text, p_finance_recd date
) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_superseded_at is null and (
       (p_invoice is null and p_retail is null and lower(btrim(coalesce(p_delivery, ''))) !~ 'deliver')
    or (btrim(coalesce(p_al_status, '')) <> ''
          and lower(btrim(p_al_status)) not in ('cash invoiced', 'fresh offtake'))
    or lower(btrim(coalesce(p_refund, ''))) in ('pending', 'to collect', 'p', 'to')
    or lower(btrim(coalesce(p_delivery, ''))) in ('pending', 'stock')
    or (btrim(coalesce(p_finance_bank, '')) <> '' and p_finance_bank !~* 'cash'
          and p_finance_recd is null and p_invoice is not null))
$$;

create index if not exists vehicle_units_book_date
  on public.vehicle_units ((coalesce(ptb_invoice_date, date_of_retail, oem_gatepass_date)));
create index if not exists vehicle_units_still_open on public.vehicle_units (created_at, id)
  where public.tracker_still_open(superseded_at, ptb_invoice_date, date_of_retail, delivery_status, al_payment_status,
                                  refund_status, finance_bank, finance_paymt_recd_date);

create or replace function public.tracker_book(
  p_scope text, p_year int, p_cols text[], p_inc_cols text[], p_ids uuid[],
  p_include_superseded boolean default false, p_hidden_keys text[] default '{}',
  p_offset int default 0, p_limit int default null
) returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  today     date := (now() at time zone 'Asia/Kolkata')::date;
  fy_start  date := make_date(case when extract(month from today) >= 4 then extract(year from today)::int
                                   else extract(year from today)::int - 1 end, 4, 1);
  bd        constant text := 'coalesce(v.ptb_invoice_date, v.date_of_retail, v.oem_gatepass_date)';
  open_sql  constant text := 'public.tracker_still_open(v.superseded_at, v.ptb_invoice_date, v.date_of_retail, v.delivery_status, '
                             'v.al_payment_status, v.refund_status, v.finance_bank, v.finance_paymt_recd_date)';
  where_sql text;
  drop_keys text[];   -- every column not asked for, removed in one step (jsonb - text[]), then the empty cells
  out       jsonb;
begin
  if p_scope is null or p_scope not in ('working', 'year', 'all', 'ids') then raise exception 'unknown scope %', p_scope; end if;
  if p_scope = 'year' and (p_year is null or p_year < 2000 or p_year > 2100) then raise exception 'year required'; end if;
  if p_scope = 'ids' and (p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500) then raise exception 'ids: 1 to 500'; end if;
  if p_cols is null or cardinality(p_cols) = 0 then raise exception 'columns required'; end if;
  if coalesce(p_offset, 0) < 0 or (p_limit is not null and (p_limit < 1 or p_limit > 5000)) then raise exception 'page: offset ≥ 0, limit 1 to 5000'; end if;

  select array_agg(column_name::text) into drop_keys
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicle_units'
     and not (column_name::text = any (p_cols)) and column_name not in ('id', 'superseded_at', 'superseded_by_id', 'updated_at');

  -- the scope, written so each index can serve it ($1 fy_start · $2 year from · $3 year to · $4 ids)
  where_sql := case p_scope
    when 'working' then format('v.superseded_at is null and (%1$s >= $1 or %1$s is null or %2$s)', bd, open_sql)
    when 'year'    then format('%s >= $2 and %s < $3', bd, bd)
    when 'ids'     then 'v.id = any ($4)'
    else 'true' end;
  if p_scope in ('year', 'all') and not coalesce(p_include_superseded, false) then
    where_sql := where_sql || ' and v.superseded_at is null';
  end if;

  execute format($q$
    with in_scope as (
      select v.* from public.vehicle_units v where %s
    ), picked as (
      select * from in_scope order by created_at, id offset $5 limit $6
    ), rows as (
      select p.created_at, p.id,
             jsonb_strip_nulls(to_jsonb(p) - $7)
             || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(i)) e
                           where e.key = any (coalesce($8, '{}')) and e.value <> 'null'::jsonb), '{}'::jsonb) as j
        from picked p left join public.vehicle_unit_incentives i on i.unit_id = p.id
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(r.j order by r.created_at, r.id) from rows r), '[]'::jsonb),
      'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'unit_id', n.unit_id, 'column_key', n.column_key,
                           'body', n.body, 'author_id', n.author_id, 'source', n.source, 'created_at', n.created_at,
                           'author_name', u.full_name) order by n.created_at, n.id)
                           from public.unit_cell_notes n join picked p on p.id = n.unit_id
                           left join public.users u on u.id = n.author_id
                          where not (n.column_key = any (coalesce($9, '{}')))), '[]'::jsonb),
      'formats', coalesce((select jsonb_agg(jsonb_build_object('unit_id', f.unit_id, 'column_key', f.column_key, 'format', f.format))
                           from public.unit_cell_formats f join picked p on p.id = f.unit_id
                          where not (f.column_key = any (coalesce($9, '{}')))), '[]'::jsonb),
      -- the DSE slab counts a salesman's trucks in the month of retail over the WHOLE book (the grid holds only
      -- its scope): the full count for every DSE-month this page touches (key as src/tracker/lib/screenColumns.js)
      'dse_counts', coalesce((select jsonb_object_agg(k, n) from (
          select upper(btrim(w.dse)) || '|' || to_char(w.date_of_retail, 'YYYY-MM') k, count(*) n
            from public.vehicle_units w
           where w.superseded_at is null and btrim(coalesce(w.dse, '')) <> '' and w.date_of_retail is not null
             and (upper(btrim(w.dse)), date_trunc('month', w.date_of_retail)) in
                 (select upper(btrim(p.dse)), date_trunc('month', p.date_of_retail) from picked p
                   where p.dse is not null and p.date_of_retail is not null)
           group by 1) c), '{}'::jsonb),
      'scope_count', (select count(*) from in_scope),
      'fy_start', $1,
      'total', (select count(*) from public.vehicle_units where superseded_at is null))
  $q$, where_sql)
  into out
  using fy_start, make_date(coalesce(p_year, 2000), 4, 1), make_date(coalesce(p_year, 2000) + 1, 4, 1), p_ids,
        coalesce(p_offset, 0), p_limit, coalesce(drop_keys, '{}'), p_inc_cols, p_hidden_keys;
  return out;
end;
$$;

revoke all on function public.tracker_still_open(timestamptz, date, date, text, text, text, text, date) from public, anon, authenticated;
revoke all on function public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int) from public, anon, authenticated;
grant execute on function public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int) to service_role;
grant execute on function public.tracker_still_open(timestamptz, date, date, text, text, text, text, date) to service_role;

commit;
