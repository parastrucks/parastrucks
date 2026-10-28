-- Phase 10 — Vehicle Tracker: the working set opens THIS YEAR FIRST, the rest follows in the background.
--
-- Owner, 2026-10-28: "make it load this year first, rest in background". After the all-years load the working set
-- (this financial year + older trucks still open) took ~14 s to fetch before the grid could draw. The page now asks
-- for scope 'year' (this financial year) first and draws it, then for the new scope 'rest' — the working set less
-- this year: trucks with no date yet, trucks dated after this year, and older trucks still open — and adds those
-- rows to the grid. 'year' (this year) + 'rest' = 'working', with no truck in both (probe-working-set checks it).
-- 'working' stays as it was, for any caller that wants it in one go.
--
-- tracker_book is re-created whole (only the scope list and the 'rest' case are new); it sorts after
-- 20261024_phase10_tracker_working_set.sql, the last migration that defined it.
-- Rollback: re-run the tracker_book block of 20261024_phase10_tracker_working_set.sql.

begin;

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
  if p_scope is null or p_scope not in ('working', 'year', 'rest', 'all', 'ids') then raise exception 'unknown scope %', p_scope; end if;
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
    -- the working set less this financial year (opened first): no date yet, dated after this year, or older and
    -- still open — 'year' (this year) + 'rest' = 'working', with no truck in both
    when 'rest'    then format('v.superseded_at is null and (%1$s is null or %1$s >= ($1 + interval ''1 year'') or (%1$s < $1 and %2$s))', bd, open_sql)
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

revoke all on function public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int) from public, anon, authenticated;
grant execute on function public.tracker_book(text, int, text[], text[], uuid[], boolean, text[], int, int) to service_role;

commit;
