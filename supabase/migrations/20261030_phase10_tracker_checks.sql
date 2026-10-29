-- Phase 10 — Vehicle Tracker: CHECKS for the team (owner, 2026-10-30).
--
-- "Each check … should have the chassis number against the value you want me to check … hosted on the staging
-- site so that I can ask my team to do it. The checking should be a yes/no answer … If No, give option to record
-- the correct value which would then be approved by me."
--
--   tracker_checks — one row per question: ONE truck (chassis), ONE column, the value as it was when the check
--                    was made. Flat (owner rule): the answer, the correct value and the approval sit on the row.
--
-- tracker_check_answer(actor, id, answer, correct, note) → { ok, item } | { ok: false, reason }
--     anyone with the tracker; 'yes' | 'no' (+ the correct value, optional, and a note). May be changed until approved.
-- tracker_check_review(actor, id, decision, note)        → { ok, item, written } | { ok: false, reason, actual? }
--     admin only (the Edge Function's gate). 'approve' a No → its correct value is written into the truck (audited,
--     source 'check'), but ONLY if the truck still holds the value that was shown; 'send_back' → answer again.
--
-- The checks themselves are made by the portal team with SQL (a check set is a question asked of a list of trucks);
-- a Yes needs no approval. Only the Edge Function (service role) may call these; no API-role grant on the table
-- (like every tracker table). Requires the tracker migrations up to 20261024_phase10_tracker_two_ctc.sql.
-- Rollback: drop function public.tracker_check_review(uuid, uuid, text, text);
--           drop function public.tracker_check_answer(uuid, uuid, text, jsonb, text);
--           drop table public.tracker_checks;

begin;

create table public.tracker_checks (
  id            uuid primary key default gen_random_uuid(),
  check_set     text not null check (btrim(check_set) <> '' and length(check_set) <= 120),
  question      text not null check (btrim(question) <> '' and length(question) <= 500),
  unit_id       uuid not null references public.vehicle_units(id) on delete cascade,
  chassis_no    text not null,
  -- the column asked about: one a person may type in (the same list as tracker_apply_changes)
  column_key    text not null check (column_key = any (array[
    'chassis_no','engine_no','model','vpart_no','hsn_code','mfrs_year','segment','customer_name','qty',
    'purchase_source','oem_gatepass_no','oem_gatepass_date','odn_no','ctc','al_ctc','ctd','ctc_basis','amc_to_al',
    'dsa','ad_blue','al_payment_status','mto_advance','al_payment_date','ptb_invoice_date','gst_rate_override',
    'supplier_invoice_no','supplier_invoice_date','supplier_invoice_amount','parts_pkg','dse',
    'delivery_location','finance_bank','do_date','do_amount','mrp','tally_bill','amc_charged_to_customer',
    'margin_money','finance_recd','finance_paymt_recd_date','subvention','insurance','cretem','road_tax_pct',
    'full_tax_override','refund_status','delivery_status','ad_blu_given','endhan','endhan_date','dsm','date_of_retail','al_retail_date',
    'date_of_delivery','other_deductions','retention_al_claim','retention_remarks','sale_category',
    'al_invoice_no','dealer_invoice_no','al_claim_age','al_claim_interest','sold_to_dealer',
    'vehicle_location','actual_delivery','rebill_delivery_date','notes','user_field_1','user_field_2',
    'user_field_3','user_field_4','user_field_5'])),
  shown_value   jsonb,                               -- the truck's value when the check was made (to_jsonb(row) -> column)
  context       jsonb not null default '[]'::jsonb,  -- [{ key, value }]: other figures of the truck shown beside it
  answer        text check (answer in ('yes', 'no')),
  correct_value jsonb,                               -- a No's correct value, as the Edge Function cleaned it
  answer_note   text check (length(answer_note) <= 500),
  answered_by   uuid,
  answered_at   timestamptz,
  review        text check (review in ('approved', 'sent_back')),
  review_note   text check (length(review_note) <= 500),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  written       boolean not null default false,      -- the approved value was written into the truck
  created_at    timestamptz not null default now(),
  check (answer = 'no' or correct_value is null),
  check (review is null or answer = 'no'),
  unique (check_set, unit_id, column_key)
);
create index tracker_checks_set on public.tracker_checks (check_set, created_at);

-- ── A person's answer ────────────────────────────────────────────────────────────────────────────────
create or replace function public.tracker_check_answer(
  p_actor uuid, p_id uuid, p_answer text, p_correct jsonb, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.tracker_checks;
begin
  if p_actor is null or p_id is null then raise exception 'actor and id are required'; end if;
  if p_answer is null or p_answer not in ('yes', 'no') then raise exception 'answer must be yes or no'; end if;
  select * into v from public.tracker_checks where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.review = 'approved' then return jsonb_build_object('ok', false, 'reason', 'approved'); end if;

  update public.tracker_checks set
    answer = p_answer,
    correct_value = case when p_answer = 'no' and p_correct is not null and p_correct <> 'null'::jsonb then p_correct end,
    answer_note = nullif(btrim(coalesce(p_note, '')), ''),
    answered_by = p_actor, answered_at = now(),
    review = null, review_note = null, reviewed_by = null, reviewed_at = null   -- a sent-back answer is answered afresh
  where id = p_id
  returning * into v;
  return jsonb_build_object('ok', true, 'item', to_jsonb(v));
end;
$$;

-- ── The owner's approval ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tracker_check_review(
  p_actor uuid, p_id uuid, p_decision text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v         public.tracker_checks;
  v_current jsonb;
  v_written boolean := false;
begin
  if p_actor is null or p_id is null then raise exception 'actor and id are required'; end if;
  if p_decision is null or p_decision not in ('approve', 'send_back') then raise exception 'decision must be approve or send_back'; end if;
  select * into v from public.tracker_checks where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.answer is distinct from 'no' then return jsonb_build_object('ok', false, 'reason', 'not_a_no'); end if;
  if v.review = 'approved' then return jsonb_build_object('ok', false, 'reason', 'approved'); end if;

  if p_decision = 'approve' and v.correct_value is not null then
    select to_jsonb(u) -> v.column_key into v_current from public.vehicle_units u where u.id = v.unit_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_truck'); end if;
    -- already the correct value (typed in the tracker meanwhile): nothing to write
    if coalesce(v_current #>> '{}', '') = coalesce(v.correct_value #>> '{}', '') or v_current = v.correct_value then
      null;
    -- changed since the check was made: never overwrite someone's later edit (same test as tracker_apply_changes)
    elsif coalesce(v_current #>> '{}', '') is distinct from coalesce(v.shown_value #>> '{}', '')
          and v_current is distinct from coalesce(v.shown_value, 'null'::jsonb) then
      return jsonb_build_object('ok', false, 'reason', 'changed', 'actual', v_current);
    else
      perform set_config('tracker.actor',  p_actor::text, true);
      perform set_config('tracker.source', 'check', true);
      perform set_config('tracker.batch',  gen_random_uuid()::text, true);
      -- jsonb_populate_record does the type conversion, as in tracker_apply_changes
      execute format(
        'update public.vehicle_units u set %1$I = (jsonb_populate_record(null::public.vehicle_units, $1)).%1$I,
                recompute = true, updated_at = now(), updated_by = $2
          where u.id = $3', v.column_key)
        using jsonb_build_object(v.column_key, v.correct_value), p_actor, v.unit_id;
      v_written := true;
    end if;
  end if;

  update public.tracker_checks set
    review = case when p_decision = 'approve' then 'approved' else 'sent_back' end,
    review_note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = p_actor, reviewed_at = now(),
    written = v_written
  where id = p_id
  returning * into v;
  return jsonb_build_object('ok', true, 'item', to_jsonb(v), 'written', v_written);
end;
$$;

alter table public.tracker_checks enable row level security;
revoke all on public.tracker_checks from anon, authenticated, public;
grant all on public.tracker_checks to service_role;

revoke all on function public.tracker_check_answer(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.tracker_check_review(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tracker_check_answer(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.tracker_check_review(uuid, uuid, text, text) to service_role;

commit;
