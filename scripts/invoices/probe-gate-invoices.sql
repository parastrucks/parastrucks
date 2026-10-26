-- Probe for 20261024_gate_invoices.sql — run on STAGING (or a rehearsal copy), never prod.
-- Self-aborting: everything it writes is rolled back by the final RAISE. A green run ENDS
-- IN AN ERROR reading "PROBE COMPLETE: n passed, 0 failed".
--   npx supabase@2.109.1 db query --linked --workdir <scratch> -f scripts/invoices/probe-gate-invoices.sql
--
-- What it proves:
--   the atomic write refuses a job card twice, a bill twice, bills ≠ total, no bills;
--   it remembers the printed mobile once and never overwrites a corrected one;
--   who can READ (real staging users, RLS as `authenticated`): service / accounts / spares
--   of the same entity and the admin see the row; sales, the other entity and a
--   deactivated user see nothing; nobody signed in can write directly or call the function.
do $$
declare
  pass int := 0; fail int := 0;
  ptb uuid := (select id from entities where code = 'PTB');
  pt  uuid := (select id from entities where code = 'PT');
  uploader uuid;
  doc_id uuid;
  n int;
  who record;
  doc jsonb;
  bills jsonb := '[{"bill_no":"LCR5756269999901","bill_date":"2026-10-24","amount_paise":708000,"ex_tax_paise":600000,"terms":"credit"},
                   {"bill_no":"PCR5756269999901","bill_date":"2026-10-24","amount_paise":3358500,"ex_tax_paise":2847650,"terms":"credit"}]';
  procedure_ok boolean;
begin
  select u.id into uploader from users u join departments d on d.id = u.department_id
   where d.code = 'service' and u.is_active order by u.created_at limit 1;
  if uploader is null then raise exception 'probe: no active service user on this database'; end if;

  doc := jsonb_build_object(
    'entity_id', ptb, 'layout', 'workshop', 'sap_form', 'ZDBMF_COVERING_LETTER_001',
    'doc_no', 'WTY57562627099999', 'doc_date', '2026-10-24', 'order_no', '2039199999',
    'sap_customer_code', '999999', 'customer_name', 'PROBE CUSTOMER', 'customer_mobile', '9000000099',
    'regn_no', 'GJ01PR0001', 'total_paise', 4066500,
    'file_path', 'PTB/probe/WTY57562627099999.pdf', 'file_sha256', repeat('a', 64), 'file_bytes', 1000,
    'uploaded_by', uploader);

  -- ── the write ──
  doc_id := gate_record_document(doc, bills);
  if doc_id is not null and (select count(*) from gate_bills where document_id = doc_id) = 2 then pass := pass + 1;
  else fail := fail + 1; raise notice 'FAIL: document + 2 bills not written'; end if;

  if (select mobile from gate_contacts where entity_id = ptb and sap_customer_code = '999999') = '9000000099' then pass := pass + 1;
  else fail := fail + 1; raise notice 'FAIL: printed mobile not remembered'; end if;

  begin
    perform gate_record_document(doc || '{"file_path":"PTB/probe/other.pdf"}', '[{"bill_no":"LCR5756269999902","bill_date":"2026-10-24","amount_paise":4066500}]');
    fail := fail + 1; raise notice 'FAIL: same job card stored twice';
  exception when unique_violation then pass := pass + 1; end;

  begin
    perform gate_record_document(doc || '{"doc_no":"WTY57562627099998","file_path":"PTB/probe/b.pdf"}',
      '[{"bill_no":"LCR5756269999901","bill_date":"2026-10-24","amount_paise":4066500}]');
    fail := fail + 1; raise notice 'FAIL: same bill stored under a second job card';
  exception when unique_violation then pass := pass + 1; end;

  begin
    perform gate_record_document(doc || '{"doc_no":"WTY57562627099997","file_path":"PTB/probe/c.pdf"}',
      '[{"bill_no":"LCR5756269999903","bill_date":"2026-10-24","amount_paise":4066400}]');
    fail := fail + 1; raise notice 'FAIL: bills that do not add up were stored';
  exception when raise_exception then pass := pass + 1; end;

  begin
    perform gate_record_document(doc || '{"doc_no":"WTY57562627099996","file_path":"PTB/probe/d.pdf"}', '[]');
    fail := fail + 1; raise notice 'FAIL: a document with no bills was stored';
  exception when raise_exception then pass := pass + 1; end;

  -- A corrected mobile is not overwritten by the next upload of the same customer.
  update gate_contacts set mobile = '9000000088' where entity_id = ptb and sap_customer_code = '999999';
  perform gate_record_document(doc || '{"doc_no":"WTY57562627099995","file_path":"PTB/probe/e.pdf"}',
    '[{"bill_no":"LCR5756269999905","bill_date":"2026-10-24","amount_paise":4066500}]');
  if (select mobile from gate_contacts where entity_id = ptb and sap_customer_code = '999999') = '9000000088' then pass := pass + 1;
  else fail := fail + 1; raise notice 'FAIL: a corrected mobile was overwritten'; end if;

  -- ── who can read (RLS, as each real user) ──
  for who in
    select u.id, u.is_active, u.permission_level, u.entity_id, d.code as dept,
           case
             when not u.is_active then 0
             when u.permission_level = 'admin' then 2
             when u.entity_id = ptb and d.code in ('service', 'accounts', 'spares') then 2
             else 0
           end as expect
    from users u left join departments d on d.id = u.department_id
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', who.id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from gate_documents where doc_no in ('WTY57562627099999', 'WTY57562627099995');
    procedure_ok := (n = who.expect)
      and (select count(*) from gate_bills where entity_id = ptb and bill_no like '%99999%') = (case when who.expect > 0 then 3 else 0 end);
    begin
      insert into gate_documents (entity_id, layout, sap_form, doc_no, doc_date, sap_customer_code, customer_name,
        total_paise, file_path, file_sha256, file_bytes, uploaded_by)
      values (ptb, 'workshop', 'x', 'WTY57562627000001', current_date, '1', 'x', 1, 'x', repeat('b', 64), 1, who.id);
      procedure_ok := false; raise notice 'FAIL: % (%) inserted a document directly', who.dept, who.permission_level;
    exception when insufficient_privilege then null; end;
    begin
      perform gate_record_document(doc || '{"doc_no":"WTY57562627000002","file_path":"x"}', bills);
      procedure_ok := false; raise notice 'FAIL: % (%) called the write function', who.dept, who.permission_level;
    exception when insufficient_privilege then null; end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
    if procedure_ok then pass := pass + 1;
    else fail := fail + 1; raise notice 'FAIL: % % % active=% saw % documents, expected %',
      who.dept, who.permission_level, case when who.entity_id = ptb then 'PTB' when who.entity_id = pt then 'PT' else '-' end,
      who.is_active, n, who.expect; end if;
  end loop;

  raise exception 'PROBE COMPLETE: % passed, % failed', pass, fail;
end $$;
