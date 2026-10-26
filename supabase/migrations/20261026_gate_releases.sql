-- Credit release step 2 — release request, GM/owner approval, gate check, guard logins.
-- Plan: docs/backlog/credit-release-plan.md → "Step 2". Builds on 20261024_gate_invoices.sql.
--
-- Owner decisions (2026-10-26):
--   * Only the SERVICE GM of the invoice's company, or the admin, approves or holds.
--   * Approvers get a PHONE notification (web push) when a release is asked.
--   * An approval lets the vehicle out for 48 HOURS; after that the guard sees "hold" again.
--   * Guard logins are made by HR on the Employees screen, in a new Security department
--     (outlet yes, brand NO — see src/lib/userShape.js).
--
-- Every write goes through the gate-invoices Edge Function (service role). Staff READ the
-- releases under RLS exactly like the step-1 tables. Guards read NOTHING here: the gate
-- screen asks the Edge Function, which answers "may go / hold" and logs the check.
--
-- Rollback (manual; needs owner approval — it deletes data):
--   delete from public.access_rules where route = '/gate';
--   drop table public.gate_push_subscriptions, public.gate_checks, public.gate_releases;
--   -- the Security department + designation only once no user carries them

begin;

-- ── 1. The Security department and its one designation ──────────────
insert into public.departments (name, code, is_active)
select 'Security', 'security', true
where not exists (select 1 from public.departments where code = 'security');

insert into public.designations (department_id, code, name, default_permission_tier, is_active)
select d.id, 'security_guard', 'Security Guard', 'executive', true
from public.departments d
where d.code = 'security'
  and not exists (select 1 from public.designations x where x.department_id = d.id and x.code = 'security_guard');

-- ── 2. One release request per vehicle exit ─────────────────────────
create table public.gate_releases (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities(id),
  document_id       uuid not null references public.gate_documents(id),
  regn_no           text not null check (regn_no ~ '^[A-Z0-9]{6,12}$'),   -- copied from the document
  status            text not null default 'asked' check (status in ('asked', 'approved', 'held', 'withdrawn')),
  request_note      text check (request_note is null or length(request_note) <= 300),
  requested_by      uuid not null references public.users(id),
  requested_at      timestamptz not null default now(),
  client_request_id uuid not null unique,      -- a double tap returns the first request
  decided_by        uuid references public.users(id),
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or length(decision_note) <= 300),
  valid_until       timestamptz,               -- approved: decided_at + 48 h (set by the EF)
  card              jsonb,                     -- what the approver was shown when deciding
  -- coalesce(…, false): a CHECK that evaluates to NULL PASSES in SQL, and "valid_until >
  -- decided_at" is NULL when valid_until is missing — exactly the row this must refuse.
  -- (The probe caught that on staging, 2026-10-26.)
  constraint gate_releases_decision_shape check (coalesce(
    case status
      when 'asked'     then decided_by is null and decided_at is null and valid_until is null
      when 'approved'  then decided_by is not null and decided_at is not null and valid_until > decided_at
      when 'held'      then decided_by is not null and decided_at is not null and valid_until is null
                            and decision_note is not null and length(btrim(decision_note)) > 0
      when 'withdrawn' then decided_by is not null and decided_at is not null and valid_until is null
    end, false))
);
-- Never two open requests for one invoice (a second tap, or two people at once).
create unique index gate_releases_one_open on public.gate_releases (document_id) where status = 'asked';
create index gate_releases_entity_requested on public.gate_releases (entity_id, requested_at desc);
-- The guard's lookup: an approved release for this plate in this company.
create index gate_releases_gate on public.gate_releases (entity_id, regn_no, valid_until desc) where status = 'approved';

-- ── 3. Every check a guard makes — the record of what left the gate ──
create table public.gate_checks (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id),
  guard_id    uuid not null references public.users(id),
  regn_query  text not null check (length(regn_query) between 1 and 20),
  result      text not null check (result in ('may_go', 'hold')),
  release_id  uuid references public.gate_releases(id),
  created_at  timestamptz not null default now(),
  check ((result = 'may_go') = (release_id is not null))
);
create index gate_checks_entity_created on public.gate_checks (entity_id, created_at desc);

-- ── 4. Where to send an approver's phone alert (Web Push subscriptions) ──
-- Written and read only by the Edge Function. A subscription is a capability to wake a
-- phone, so no client reads it — the browser already knows its own.
create table public.gate_push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id),
  endpoint       text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh         text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth           text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  user_agent     text check (user_agent is null or length(user_agent) <= 300),
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  last_error     text,
  failures       integer not null default 0
);
create index gate_push_subscriptions_user on public.gate_push_subscriptions (user_id);

-- ── 5. RLS ──
-- Releases and gate checks: the same readers as the step-1 tables (service, accounts,
-- spares of the same company, and the admin). The Service GM is in service, so covered.
do $$
declare t text;
begin
  foreach t in array array['gate_releases', 'gate_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format($q$
      create policy %I on public.%I for select to authenticated
      using (
        public.current_user_role() = 'admin'
        or (entity_id = public.get_my_entity_id()
            and public.current_user_role() in ('service', 'accounts', 'spares'))
      )
    $q$, t || '_select', t);
    execute format($q$
      create policy %I on public.%I as restrictive for all to authenticated
      using (public.is_active_user()) with check (public.is_active_user())
    $q$, t || '_active_only', t);
  end loop;
end $$;

alter table public.gate_push_subscriptions enable row level security;
revoke all on public.gate_push_subscriptions from anon, authenticated;
-- (no policy: with RLS on and no grant, only the service role reaches it)

-- ── 6. access_rules — the /gate screen for the Security department ──
do $$
begin
  if (select id from public.entities where code = 'PT') is null
     or (select id from public.entities where code = 'PTB') is null
     or (select id from public.departments where code = 'security') is null then
    raise exception 'entities PT/PTB or department security missing — refusing to seed access_rules';
  end if;
end $$;

insert into public.access_rules (route, permission_level, entity_id, department_id, designation_id)
select '/gate', tier, e.id, d.id, null::uuid
from (values ('executive'), ('manager'), ('gm')) as t(tier)
cross join public.entities e
cross join public.departments d
where e.code in ('PT', 'PTB') and d.code = 'security';

do $$
declare n int;
begin
  select count(*) into n from public.access_rules where route = '/gate';
  if n <> 6 then raise exception '/gate expected 6 access_rules rows, got %', n; end if;
end $$;

commit;
