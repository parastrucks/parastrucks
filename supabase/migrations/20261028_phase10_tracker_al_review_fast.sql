-- Phase 10 — Vehicle Tracker: the AL Balance Sheet review fits inside PostgREST's 8 s again.
--
-- With 36 real months uploaded (2026-10-28) tracker_al_review took 11–15 s through the API (18 s under EXPLAIN
-- ANALYZE) — over the authenticator's 8 s statement_timeout, so the panel's review failed. Measured, not guessed:
-- the "not_on_sheet" branch alone was 14.3 s — a Nested Loop Anti Join of 11,461 trucks × 4,937 credit lines
-- (56,575,262 comparisons). Its "not exists (… credits c where c.chassis_no = u.chassis)" runs against a CTE, which
-- has no statistics, so the planner guessed both sides tiny and compared every pair.
--
-- The fix is that one line: "u.chassis not in (select chassis_no from credits where chassis_no is not null)". Postgres
-- runs an uncorrelated NOT IN as a HASHED SubPlan (one pass to build, one lookup per truck) whenever the list fits in
-- work_mem — whatever its row guess. NOT IN differs from NOT EXISTS only on NULLs: the list excludes null chassis,
-- and u.chassis is upper(btrim(vehicle_units.chassis_no)), which is NOT NULL and never blank, so the result is the
-- same row for row. Nothing else in the function changes (checks, wording, order, the settled join).
-- Sorts after 20261025_phase10_tracker_al_sheet.sql, the only migration that defined the function.
-- Rollback: re-run the create function public.tracker_al_review() block of 20261025_phase10_tracker_al_sheet.sql
--           as "create or replace".

begin;

create or replace function public.tracker_al_review()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with cur as (
  select u.* from public.al_sheet_uploads u where u.replaced_at is null
), lines as (
  select l.*, c.month, to_char(c.month, 'YYYY-MM') mk,
         public.tracker_al_mode(l.offtake_mode) mode, public.tracker_al_kind(l.offtake_mode) kind,
         coalesce(l.details, '') det
    from public.al_sheet_lines l join cur c on c.id = l.upload_id
), credits as (
  -- what PTB owes AL: a credit, not the balance lines
  select * from lines
   where coalesce(credit, 0) <> 0 and det !~* '^(carry over|net balance)$' and det !~* 'unbilled balance'
), units as (
  select v.id, upper(btrim(v.chassis_no)) chassis, v.ctd, v.ptb_invoice_date, v.al_payment_status, v.al_payment_date,
         v.mto_advance, upper(btrim(v.vpart_no)) cbn
    from public.vehicle_units v where v.superseded_at is null
), joined as (
  select c.*, u.id unit_id, u.ctd t_ctd, u.ptb_invoice_date, u.al_payment_status, u.mto_advance,
         (u.id is not null) in_tracker
    from credits c left join units u on u.chassis = c.chassis_no
), trucks as (
  -- a truck's own line: how much of the truck it pays (whole, 95/5, 5% × N …), on the SHEET's CTD
  select j.*, s.share,
         case when j.t_ctd is not null and j.ctd is not null and abs(j.ctd - j.t_ctd) >= 1 then
           case when abs(j.ctd - j.t_ctd * 1.28 / 1.18) < 2 then
                  case when j.ptb_invoice_date is not null and j.ptb_invoice_date < date '2025-09-22' then 'gst_before' else 'gst_explained' end
                else 'ctd_diff' end end ctd_state
    from joined j
    left join lateral (
      select p from (values (1::numeric), (0.95), (0.05), (0.1), (0.3), (0.5)) f(p)
       where coalesce(j.ctd, j.t_ctd) is not null and abs(j.credit - coalesce(j.ctd, j.t_ctd) * 0.999 * f.p) < 1
       order by p desc limit 1) s(share) on true
   where j.kind = 'truck' and j.chassis_no is not null and j.in_tracker
), per_truck as (
  select chassis_no, min(unit_id::text)::uuid unit_id, max(mto_advance) mto_advance,
         sum(coalesce(share, credit / nullif(coalesce(ctd, t_ctd) * 0.999, 0))) total, max(mk) last_mk,
         -- a line that is no known share is already listed (credit_not_split): the % checks skip that truck
         bool_and(share is not null) all_split
    from trucks group by chassis_no
), months as (
  select c.month, to_char(c.month, 'YYYY-MM') mk, c.file_name, c.uploaded_at, c.line_count, us.full_name uploaded_by_name,
         sum(coalesce(l.debit, 0)) filter (where l.det !~* '^net balance$' and l.det !~* 'unbilled balance') paid,
         sum(coalesce(l.credit, 0)) filter (where l.det !~* '^net balance$' and l.det !~* 'unbilled balance') owed,
         max(l.debit) filter (where l.det ~* '^net balance$') net,
         max(coalesce(l.debit, 0) - coalesce(l.credit, 0)) filter (where l.det ~* '^carry over$') carry
    from cur c join lines l on l.upload_id = c.id left join public.users us on us.id = c.uploaded_by
   group by c.month, c.file_name, c.uploaded_at, c.line_count, us.full_name
), mto as (
  -- an MTO advance is per ORDER: CTD per truck × 0.999 × 5% × the number of trucks ordered
  select cbn, sum(round(credit / nullif(ctd * 0.999 * 0.05, 0))) advanced
    from credits where kind = 'mto' and cbn is not null group by cbn
), issues as (
  -- the sheet's own arithmetic
  select 'net_not_tie' chk, m.mk, m.mk subject, null::text chassis, null::uuid unit_id, null::int row_no,
         case when m.net is null then 'No “Net Balance” line' else 'Net Balance ≠ paid − owed' end detail
    from months m where m.net is null or abs(m.net - (m.paid - m.owed)) >= 1
  union all
  select 'carry_chain', m.mk, m.mk, null, null, null, 'CARRY OVER ≠ last month’s Net Balance'
    from months m join months p on p.month = (m.month - interval '1 month')::date
   where m.carry is not null and p.net is not null and abs(m.carry - p.net) >= 1
  -- each credit line
  union all
  select 'no_mode', mk, mk || '|' || coalesce(chassis_no, 'row ' || row_no), chassis_no, unit_id, row_no, 'A credit line with no Offtake Mode'
    from joined where kind = 'none'
  union all
  select 'spelling', mk, mk || '|' || upper(btrim(offtake_mode)), chassis_no, unit_id, row_no,
         'Offtake Mode “' || offtake_mode || '” — the usual spelling is “' || mode || '”'
    from joined where kind <> 'none' and upper(regexp_replace(btrim(offtake_mode), '\s+', ' ', 'g')) <> mode
  union all
  select 'unknown_mode', mk, mk || '|' || mode, chassis_no, unit_id, row_no, 'Offtake Mode “' || offtake_mode || '” is not a known kind of line'
    from joined where kind = 'unknown'
  union all
  select 'no_chassis', mk, mk || '|row ' || row_no, null, null, row_no, 'A credit line with no chassis (and not an MTO advance): “' || left(det, 40) || '”'
    from joined where chassis_no is null and kind not in ('mto', 'none')
  union all
  select 'not_in_tracker', mk, mk || '|' || chassis_no, chassis_no, null, row_no, 'Chassis not in the tracker (' || coalesce(mode, 'no mode') || ')'
    from joined where chassis_no is not null and not in_tracker
  union all
  select 'typed_credit', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no, 'Credit typed as a number, not CTD × 0.999'
    -- (a chassis the tracker does not know is already listed as such)
    from joined where chassis_no is not null and in_tracker and credit_is_formula = false
  -- truck lines
  union all
  select 'twice', mk, mk || '|' || chassis_no, chassis_no, min(unit_id::text)::uuid, min(row_no), 'Truck line ' || count(*) || ' times in one month'
    from trucks group by mk, chassis_no having count(*) > 1
  union all
  select 'no_ctd', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no, 'The tracker has no CTD for this truck'
    from trucks where t_ctd is null
  union all
  select 'ctd_diff', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no,
         'CTD on the sheet is ' || round(100 * ctd / t_ctd) || '% of the tracker’s'
    from trucks where ctd_state = 'ctd_diff'
  union all
  select 'gst_before', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no,
         'The tracker holds the CTD at 18% GST, but PTB invoiced before 22 Sep 2025'
    from trucks where ctd_state = 'gst_before'
  union all
  select 'credit_not_split', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no, 'Credit ≠ CTD × 0.999 (whole, 95%, 5% …)'
    from trucks where share is null
  union all
  select 'still_ibnd', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no, 'The sheet says ' || mode || '; the tracker still says IBND'
    from trucks where mode <> 'IBND' and upper(btrim(coalesce(al_payment_status, ''))) = 'IBND'
  union all
  select 'mto_not_yes', mk, mk || '|' || chassis_no, chassis_no, unit_id, row_no, 'A 95% line — the truck should say MTO Advance “Yes”'
    from trucks where share = 0.95 and coalesce(mto_advance, '') <> 'Yes'
  -- each truck, over every uploaded month
  union all
  select 'over_100', last_mk, chassis_no, chassis_no, unit_id, null, 'Credited ' || round(100 * total) || '% of the truck over the months uploaded'
    from per_truck where total > 1.001 and all_split
  union all
  select 'under_100', last_mk, chassis_no, chassis_no, unit_id, null, 'Only ' || round(100 * total) || '% of the truck credited so far'
    -- (coalesce: an empty MTO Advance must not turn the whole test NULL and drop the truck)
    from per_truck where all_split and total < 0.999 and not (coalesce(mto_advance, '') = 'Yes' and abs(total - 0.95) < 0.001)
  union all
  select 'not_on_sheet', to_char(u.al_payment_date, 'YYYY-MM'), u.chassis, u.chassis, u.id, null,
         'AL status “' || u.al_payment_status || '” (' || to_char(u.al_payment_date, 'DD/MM/YY') || ') — on no balance sheet'
    from units u
   where upper(btrim(coalesce(u.al_payment_status, ''))) in ('CASH INVOICED', 'FRESH OFFTAKE', 'IBND')
     and u.al_payment_date >= (select min(month) from cur)
     and u.al_payment_date < (select (max(month) + interval '1 month')::date from cur)
     -- NOT IN over non-null chassis = a hashed lookup (see the header); u.chassis is never null (NOT NULL, not blank)
     and u.chassis not in (select c.chassis_no from credits c where c.chassis_no is not null)
  -- MTO, per CBN
  union all
  select 'mto_count', null, y.cbn, null, null, null,
         y.n || ' truck' || case when y.n = 1 then '' else 's' end || ' of CBN ' || y.cbn || ' say MTO Advance “Yes”, but the sheets show advances for ' || coalesce(a.advanced, 0)
    from (select cbn, count(*) n from units where mto_advance = 'Yes' and cbn is not null group by cbn) y
    left join mto a on a.cbn = y.cbn
   where y.n > coalesce(a.advanced, 0) and exists (select 1 from cur)
)
select jsonb_build_object(
  'months', coalesce((select jsonb_agg(jsonb_build_object('month', m.mk, 'file_name', m.file_name, 'uploaded_at', m.uploaded_at,
              'uploaded_by', m.uploaded_by_name, 'lines', m.line_count, 'paid', m.paid, 'owed', m.owed, 'net', m.net, 'carry', m.carry)
              order by m.month) from months m), '[]'::jsonb),
  'issues', coalesce((select jsonb_agg(jsonb_build_object('check', i.chk, 'month', i.mk, 'subject', i.subject, 'chassis', i.chassis,
              'unit_id', i.unit_id, 'row_no', i.row_no, 'detail', i.detail,
              'settled', case when s.id is null then null else jsonb_build_object('reason', s.reason, 'by', su.full_name, 'at', s.settled_at) end)
              order by i.chk, i.mk nulls last, i.subject)
              from issues i
              left join public.al_sheet_settled s on s.check_key = i.chk and s.subject = i.subject
              left join public.users su on su.id = s.settled_by), '[]'::jsonb),
  'explained', jsonb_build_object(
     'gst', (select count(*) from trucks where ctd_state = 'gst_explained'),
     'mto_advances', (select count(*) from credits where kind = 'mto'),
     'ibnd_lines', (select count(*) from trucks where mode = 'IBND'))
)
$$;

revoke all on function public.tracker_al_review() from public, anon, authenticated;
grant execute on function public.tracker_al_review() to service_role;

commit;
