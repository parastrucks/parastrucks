-- Phase 10 — Vehicle Tracker: the monthly AL Balance Sheet check (owner, 2026-10-23, option D).
--
-- The AL account stays in the team's Excel file. Once a month, when the sheet is final, it is uploaded and
-- the portal lists what disagrees — with the tracker or with itself. NOTHING in the tracker is changed by an
-- upload. (docs/backlog/phase10-column-map.md → G "DECIDED"; the checks were measured on the 12 real
-- 2025-26 sheets by scripts/phase10/al_balance_check.cjs.)
--
--   al_sheet_uploads — one row per uploaded file; ONE current file per month (a re-upload of the same month
--                      must say "replace"; the earlier file is kept, marked replaced)
--   al_sheet_lines   — the file's lines as the browser read them (src/tracker/lib/alSheet.js)
--   al_sheet_settled — a line a person marked right, with a reason: it never comes back (the list shrinks
--                      instead of snowballing — owner, 2026-10-23)
--
-- tracker_al_upload(actor, month, file_name, sha256, replace, lines)  → { ok, upload_id, lines, replayed }
--                                                                     | { ok: false, reason: 'exists', … }
-- tracker_al_review()                                                 → { months, issues, explained }
-- tracker_al_settle(actor, check, subject, reason)                    → { ok, settled }
--
-- Line kinds come from the sheet's own Offtake Mode, with the meanings the owner gave (2026-10-23):
--   truck  FRESH OFFTAKE (= Cash Invoiced), IBND        mto     MTO (a 5% advance per ORDER, no chassis yet)
--   addon  AMC, PARTS PACKAGE, IALERT, EWP, PAYMENT PENDING (on a truck; the CTD cell holds the add-on amount)
--   return PURCHASE RETURN                               a second spelling or an unknown word is a review line.
-- GST follows the PTB invoice date for CTC and CTD alike (owner): AL billed 28% before 22 Sep 2025, so a sheet
-- CTD = tracker CTD × 1.28 / 1.18 on a truck PTB invoiced on/after that day is explained, not shown.
-- MTO (owner, 2026-10-23): no order list — the truck's "MTO Advance" Yes/No. A 95% truck line must say Yes;
-- per CBN, the trucks marked Yes must not outnumber the advances on the sheets.
--
-- Only the Edge Function (service role) may call these; no API-role grant on the tables (like every tracker
-- table). Requires the tracker migrations up to 20261024_phase10_tracker_working_set.sql.
-- Rollback: drop function public.tracker_al_settle(uuid, text, text, text);
--           drop function public.tracker_al_review();
--           drop function public.tracker_al_upload(uuid, date, text, text, boolean, jsonb);
--           drop function public.tracker_al_kind(text); drop function public.tracker_al_mode(text);
--           drop table public.al_sheet_settled, public.al_sheet_lines, public.al_sheet_uploads;

begin;

create table public.al_sheet_uploads (
  id           uuid primary key default gen_random_uuid(),
  month        date not null check (extract(day from month) = 1),
  file_name    text not null check (btrim(file_name) <> ''),
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  line_count   integer not null check (line_count between 1 and 2000),
  uploaded_by  uuid not null,
  uploaded_at  timestamptz not null default now(),
  replaced_at  timestamptz,
  replaced_by  uuid
);
create unique index al_sheet_uploads_current on public.al_sheet_uploads (month) where replaced_at is null;

create table public.al_sheet_lines (
  id                bigint generated always as identity primary key,
  upload_id         uuid not null references public.al_sheet_uploads(id) on delete cascade,
  row_no            integer not null check (row_no >= 1),
  line_date         date,
  details           text,
  debit             numeric(14,2),
  credit            numeric(14,2),
  cbn               text,
  chassis_no        text,
  engine_no         text,
  ctd               numeric(14,2),
  offtake_mode      text,
  credit_is_formula boolean,
  unique (upload_id, row_no)
);
create index al_sheet_lines_chassis on public.al_sheet_lines (chassis_no) where chassis_no is not null;

create table public.al_sheet_settled (
  id          uuid primary key default gen_random_uuid(),
  check_key   text not null,
  subject     text not null,
  reason      text not null check (btrim(reason) <> ''),
  settled_by  uuid not null,
  settled_at  timestamptz not null default now(),
  unique (check_key, subject)
);

-- the sheet's word, one spelling (the second spellings seen in 2025-26)
create function public.tracker_al_mode(p text) returns text language sql immutable set search_path = '' as $$
  select case upper(btrim(coalesce(p, '')))
           when '' then null
           when 'PARTS PKG' then 'PARTS PACKAGE'
           when 'I-ALERT' then 'IALERT'
           when 'PATMENT PENDING' then 'PAYMENT PENDING'
           else upper(regexp_replace(btrim(p), '\s+', ' ', 'g')) end
$$;
create function public.tracker_al_kind(p text) returns text language sql immutable set search_path = '' as $$
  select case public.tracker_al_mode(p)
           when 'FRESH OFFTAKE' then 'truck' when 'IBND' then 'truck'
           when 'MTO' then 'mto'
           when 'AMC' then 'addon' when 'PARTS PACKAGE' then 'addon' when 'IALERT' then 'addon'
           when 'EWP' then 'addon' when 'PAYMENT PENDING' then 'addon'
           when 'PURCHASE RETURN' then 'return'
           else case when public.tracker_al_mode(p) is null then 'none' else 'unknown' end end
$$;

create function public.tracker_al_upload(p_actor uuid, p_month date, p_file_name text, p_sha256 text,
                                         p_replace boolean, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.al_sheet_uploads;
  new_id uuid;
  n int;
begin
  if p_actor is null then raise exception 'actor required'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'month must be the first of a month'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'lines must be an array'; end if;
  n := jsonb_array_length(p_lines);
  if n < 1 or n > 2000 then raise exception 'lines: 1 to 2000 (got %)', n; end if;

  perform pg_advisory_xact_lock(hashtext('tracker_al_upload:' || p_month::text));
  select * into cur from public.al_sheet_uploads where month = p_month and replaced_at is null;
  if found and cur.file_sha256 = lower(p_sha256) then
    -- the same file again (a retry, or a second click): nothing new
    return jsonb_build_object('ok', true, 'upload_id', cur.id, 'lines', cur.line_count, 'replayed', true);
  end if;
  if found and not coalesce(p_replace, false) then
    return jsonb_build_object('ok', false, 'reason', 'exists', 'file_name', cur.file_name,
                              'uploaded_at', cur.uploaded_at, 'upload_id', cur.id);
  end if;
  if found then
    update public.al_sheet_uploads set replaced_at = now(), replaced_by = p_actor where id = cur.id;
  end if;

  insert into public.al_sheet_uploads (month, file_name, file_sha256, line_count, uploaded_by)
  values (p_month, btrim(p_file_name), lower(p_sha256), n, p_actor)
  returning id into new_id;

  insert into public.al_sheet_lines (upload_id, row_no, line_date, details, debit, credit, cbn, chassis_no,
                                     engine_no, ctd, offtake_mode, credit_is_formula)
  select new_id, l.row_no, l.line_date, nullif(btrim(l.details), ''), l.debit, l.credit,
         nullif(upper(btrim(l.cbn)), ''), nullif(upper(btrim(l.chassis_no)), ''), nullif(upper(btrim(l.engine_no)), ''),
         l.ctd, nullif(btrim(l.offtake_mode), ''), l.credit_is_formula
    from jsonb_to_recordset(p_lines) as l(row_no int, line_date date, details text, debit numeric, credit numeric,
                                         cbn text, chassis_no text, engine_no text, ctd numeric, offtake_mode text,
                                         credit_is_formula boolean);
  return jsonb_build_object('ok', true, 'upload_id', new_id, 'lines', n, 'replayed', false,
                            'replaced', cur.id is not null);
end;
$$;

-- Every check, over every month's CURRENT file. Each issue: { check, month, subject, chassis, unit_id, row_no,
-- detail, settled } — subject is what a person's "this is right" is remembered against (it survives a
-- replaced upload of the same month): month|chassis for a line, chassis for a truck, month for a sheet, CBN.
create function public.tracker_al_review()
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
     and not exists (select 1 from credits c where c.chassis_no = u.chassis)
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

create function public.tracker_al_settle(p_actor uuid, p_check text, p_subject text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.al_sheet_settled;
begin
  if p_actor is null then raise exception 'actor required'; end if;
  if p_check is null or p_check !~ '^[a-z_0-9]{2,40}$' then raise exception 'check required'; end if;
  if p_subject is null or btrim(p_subject) = '' or length(p_subject) > 200 then raise exception 'subject required'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required'; end if;
  if length(p_reason) > 500 then raise exception 'reason: at most 500 characters'; end if;
  insert into public.al_sheet_settled (check_key, subject, reason, settled_by)
  values (p_check, btrim(p_subject), btrim(p_reason), p_actor)
  on conflict (check_key, subject) do nothing
  returning * into s;
  if s.id is null then  -- settled before: the first answer stands
    select * into s from public.al_sheet_settled where check_key = p_check and subject = btrim(p_subject);
    return jsonb_build_object('ok', true, 'already', true, 'reason', s.reason);
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'reason', s.reason);
end;
$$;

alter table public.al_sheet_uploads enable row level security;
alter table public.al_sheet_lines   enable row level security;
alter table public.al_sheet_settled enable row level security;
revoke all on public.al_sheet_uploads, public.al_sheet_lines, public.al_sheet_settled from anon, authenticated, public;
grant all on public.al_sheet_uploads, public.al_sheet_lines, public.al_sheet_settled to service_role;

revoke all on function public.tracker_al_mode(text) from public, anon, authenticated;
revoke all on function public.tracker_al_kind(text) from public, anon, authenticated;
revoke all on function public.tracker_al_upload(uuid, date, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.tracker_al_review() from public, anon, authenticated;
revoke all on function public.tracker_al_settle(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.tracker_al_mode(text) to service_role;
grant execute on function public.tracker_al_kind(text) to service_role;
grant execute on function public.tracker_al_upload(uuid, date, text, text, boolean, jsonb) to service_role;
grant execute on function public.tracker_al_review() to service_role;
grant execute on function public.tracker_al_settle(uuid, text, text, text) to service_role;

commit;
