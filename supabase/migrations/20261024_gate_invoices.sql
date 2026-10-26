-- Credit release step 1 — invoice upload + reading + email (plan: docs/backlog/credit-release-plan.md).
--
-- STANDALONE (owner, 2026-10-24): the payments tables stay off prod, so this feature has its
-- own tables, prefixed gate_ (payments already creates `customers` and `service_invoices`).
-- Each row carries the keys payments uses — SAP customer code and bill number — so payments
-- can link to these later instead of copying them.
--
-- Writes happen ONLY through the gate-invoices Edge Function (service role). Signed-in staff
-- READ under RLS: service, accounts and spares in their own entity, and the admin.
-- Money is stored in PAISE (bigint) — exactly what the reader produced, no float anywhere.
--
-- Rollback (manual; needs owner approval — it deletes data):
--   delete from public.access_rules where route = '/invoices';
--   drop function public.gate_record_document(jsonb, jsonb);
--   drop table public.gate_messages, public.gate_contacts, public.gate_bills, public.gate_documents;
--   delete from storage.buckets where id = 'gate-invoices';   -- only once it is empty

begin;

-- ── 1. One uploaded invoice PDF ─────────────────────────────────────
create table public.gate_documents (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities(id),
  layout            text not null check (layout in ('workshop', 'counter_sale')),
  sap_form          text not null,
  doc_no            text not null,          -- workshop: JOB CARD NO · counter sale: DLR INVOICE NO
  doc_date          date not null,
  order_no          text,
  order_type        text,
  payment_terms     text,                   -- counter sale only (PAYMENT TERMS)
  sap_customer_code text not null,
  customer_name     text not null,
  customer_mobile   text,
  customer_pan      text,
  customer_gstin    text,
  regn_no           text,                   -- workshop only
  vehicle_model     text,
  chassis_no        text,
  engine_no         text,
  total_paise       bigint not null check (total_paise > 0),
  file_path         text not null unique,   -- in the private bucket gate-invoices
  file_sha256       text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes        integer not null check (file_bytes > 0),
  uploaded_by       uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  unique (entity_id, doc_no)
);
create index gate_documents_entity_created on public.gate_documents (entity_id, created_at desc);
create index gate_documents_customer on public.gate_documents (entity_id, sap_customer_code);
create index gate_documents_regn on public.gate_documents (entity_id, regn_no) where regn_no is not null;

-- ── 2. Every bill on it (a workshop job = labour + parts; a counter sale = itself) ──
create table public.gate_bills (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.gate_documents(id),
  entity_id     uuid not null references public.entities(id),
  bill_no       text not null,
  bill_date     date not null,
  amount_paise  bigint not null check (amount_paise > 0),
  ex_tax_paise  bigint,
  terms         text check (terms in ('cash', 'credit')),
  unique (entity_id, bill_no)              -- the same bill is never stored twice
);
create index gate_bills_document on public.gate_bills (document_id);

-- ── 3. Where a customer is reached — remembered per SAP customer code ──
-- SAP invoices print a mobile but NO email, so the first send asks for one and it is
-- remembered for the next invoice of the same customer.
create table public.gate_contacts (
  entity_id         uuid not null references public.entities(id),
  sap_customer_code text not null,
  email             text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  mobile            text check (mobile is null or mobile ~ '^\d{10}$'),
  updated_by        uuid references public.users(id),
  updated_at        timestamptz not null default now(),
  primary key (entity_id, sap_customer_code)
);

-- ── 4. Every send (email now; WhatsApp in step 4) ──
create table public.gate_messages (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.gate_documents(id),
  entity_id           uuid not null references public.entities(id),
  channel             text not null check (channel in ('email', 'whatsapp')),
  recipient           text not null,
  status              text not null check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error               text,
  client_request_id   uuid not null unique,  -- a repeated click / retry returns the first send
  sent_by             uuid not null references public.users(id),
  created_at          timestamptz not null default now(),
  finished_at         timestamptz
);
create index gate_messages_document on public.gate_messages (document_id, created_at desc);

-- ── 5. Atomic write: a document and all its bills, or nothing ──
-- Called by the Edge Function with the service role only. The EF has already checked the
-- caller, the entity, the file and the numbers; this enforces the parts that need the
-- database: one row per job card / invoice, one row per bill, bills = total.
create or replace function public.gate_record_document(p_doc jsonb, p_bills jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sum bigint;
begin
  if jsonb_typeof(p_bills) <> 'array' or jsonb_array_length(p_bills) = 0 then
    raise exception 'gate_record_document: no bills';
  end if;
  select sum((b->>'amount_paise')::bigint) into v_sum from jsonb_array_elements(p_bills) b;
  if v_sum <> (p_doc->>'total_paise')::bigint then
    raise exception 'gate_record_document: bills % <> total %', v_sum, p_doc->>'total_paise';
  end if;

  insert into public.gate_documents (
    entity_id, layout, sap_form, doc_no, doc_date, order_no, order_type, payment_terms,
    sap_customer_code, customer_name, customer_mobile, customer_pan, customer_gstin,
    regn_no, vehicle_model, chassis_no, engine_no, total_paise,
    file_path, file_sha256, file_bytes, uploaded_by
  ) values (
    (p_doc->>'entity_id')::uuid, p_doc->>'layout', p_doc->>'sap_form', p_doc->>'doc_no',
    (p_doc->>'doc_date')::date, p_doc->>'order_no', p_doc->>'order_type', p_doc->>'payment_terms',
    p_doc->>'sap_customer_code', p_doc->>'customer_name', p_doc->>'customer_mobile',
    p_doc->>'customer_pan', p_doc->>'customer_gstin', p_doc->>'regn_no', p_doc->>'vehicle_model',
    p_doc->>'chassis_no', p_doc->>'engine_no', (p_doc->>'total_paise')::bigint,
    p_doc->>'file_path', p_doc->>'file_sha256', (p_doc->>'file_bytes')::int, (p_doc->>'uploaded_by')::uuid
  ) returning id into v_id;

  insert into public.gate_bills (document_id, entity_id, bill_no, bill_date, amount_paise, ex_tax_paise, terms)
  select v_id, (p_doc->>'entity_id')::uuid, b->>'bill_no', (b->>'bill_date')::date,
         (b->>'amount_paise')::bigint, nullif(b->>'ex_tax_paise', '')::bigint, b->>'terms'
  from jsonb_array_elements(p_bills) b;

  -- First time this customer is seen: remember the mobile printed on the invoice.
  if coalesce(p_doc->>'customer_mobile', '') ~ '^\d{10}$' then
    insert into public.gate_contacts (entity_id, sap_customer_code, mobile, updated_by)
    values ((p_doc->>'entity_id')::uuid, p_doc->>'sap_customer_code', p_doc->>'customer_mobile', (p_doc->>'uploaded_by')::uuid)
    on conflict (entity_id, sap_customer_code) do nothing;
  end if;
  return v_id;
end $$;

revoke all on function public.gate_record_document(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gate_record_document(jsonb, jsonb) to service_role;

-- ── 6. RLS: read for service / accounts / spares in their entity + admin; no direct writes ──
do $$
declare t text;
begin
  foreach t in array array['gate_documents', 'gate_bills', 'gate_contacts', 'gate_messages'] loop
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

-- ── 7. Private bucket for the PDFs (no storage policies → only the service role reads) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gate-invoices', 'gate-invoices', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- ── 8. access_rules — who sees the /invoices page ──
-- service + spares (who make the invoices) and accounts, every non-admin tier, both entities.
-- The Edge Function enforces the same departments; this only decides the menu and route.
do $$
begin
  if (select id from public.entities where code = 'PT') is null
     or (select id from public.entities where code = 'PTB') is null
     or (select id from public.departments where code = 'service') is null
     or (select id from public.departments where code = 'accounts') is null
     or (select id from public.departments where code = 'spares') is null then
    raise exception 'entities PT/PTB or departments service/accounts/spares missing — refusing to seed access_rules';
  end if;
end $$;

insert into public.access_rules (route, permission_level, entity_id, department_id, designation_id)
select '/invoices', tier, e.id, d.id, null::uuid
from (values ('executive'), ('manager'), ('gm')) as t(tier)
cross join public.entities e
cross join public.departments d
where e.code in ('PT', 'PTB') and d.code in ('service', 'accounts', 'spares');

do $$
declare n int;
begin
  select count(*) into n from public.access_rules where route = '/invoices';
  if n <> 18 then raise exception '/invoices expected 18 access_rules rows, got %', n; end if;
end $$;

commit;
