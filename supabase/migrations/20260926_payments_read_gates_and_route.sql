-- ============================================================================
-- Service Payments — department-first READ gates, and the /payments page rule.
--
-- Apply AFTER 20260830_payments_a1_schema.sql and 20260908_payments_a1_rpcs.sql.
-- Additive: two CREATE OR REPLACE FUNCTIONs and six INSERTs. Nothing dropped.
--
-- 1. THE READ GATES admitted any manager or GM in ANY department.
--    The Edge Function's write gate had the same defect and was fixed on
--    2026-09-20 (supabase/functions/service-payments/authority.ts). These two
--    functions are what every payments RLS policy calls, and they still read
--    "admin, OR manager/GM anywhere, OR the right department" — so a Sales,
--    HR, Spares, Back Office or PDI manager could read every payer name, bill,
--    allocation and customer GSTIN straight from PostgREST. access_rules only
--    hides the nav link; it is not a control.
--    Measured on staging before this file: scripts/payments/probe-read-gates.sql
--    = 29 passed, 28 failed — every failure a manager/GM outside service and
--    accounts. Now: department first, rank second, matching authority.ts.
--
--      payments_can_read            admin · service (any rank) · accounts (any rank)
--      payments_can_read_back_office admin · accounts (any rank) · service manager/GM
--
--    Service executives keep the matching surfaces and lose nothing: they were
--    never in the back-office gate.
--
-- 2. THE PAGE RULE. /payments is visible to service + accounts at every
--    non-admin rank, PTB only — v1 is PTB-only (owner), so PT staff would get an
--    empty tool. Admin bypasses canAccess(). Mirrors the /vendor-jobs seed.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.payments_can_read()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select coalesce(
    (select u.is_active
        and (u.permission_level = 'admin'
             or d.code in ('accounts','service'))
       from public.users u
       left join public.departments d on d.id = u.department_id
      where u.id = auth.uid()),
    false)
$fn$;

COMMENT ON FUNCTION public.payments_can_read() IS
  'Service Payments read gate for the matching surfaces: active admin, or anyone in service or accounts. Department first, rank second -- a manager elsewhere is NOT admitted (fixed 2026-09-26; mirrors inScope() in service-payments/authority.ts).';

CREATE OR REPLACE FUNCTION public.payments_can_read_back_office()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select coalesce(
    (select u.is_active
        and (u.permission_level = 'admin'
             or d.code = 'accounts'
             or (d.code = 'service' and u.permission_level in ('manager','gm')))
       from public.users u
       left join public.departments d on d.id = u.department_id
      where u.id = auth.uid()),
    false)
$fn$;

COMMENT ON FUNCTION public.payments_can_read_back_office() IS
  'Narrower Service Payments gate: active admin, accounts at any rank, service managers and GMs. Service executives read v_payments_customers_lite instead. Department first -- a manager elsewhere is NOT admitted (fixed 2026-09-26).';

-- CREATE OR REPLACE keeps existing grants, but state them so this file is
-- correct on its own. EXECUTE for authenticated MUST stay: RLS predicates run
-- with the querying user's privileges.
REVOKE EXECUTE ON FUNCTION public.payments_can_read() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.payments_can_read_back_office() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.payments_can_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payments_can_read_back_office() TO authenticated;


-- ── the page rule ──────────────────────────────────────────────────────────
-- Guard: a NULL id below would silently create a wildcard-looking rule.
DO $$
BEGIN
  IF (SELECT id FROM public.entities    WHERE code = 'PTB')      IS NULL
  OR (SELECT id FROM public.departments WHERE code = 'service')  IS NULL
  OR (SELECT id FROM public.departments WHERE code = 'accounts') IS NULL THEN
    RAISE EXCEPTION 'PTB entity or service/accounts department missing — cannot seed /payments safely';
  END IF;
END $$;

INSERT INTO public.access_rules (route, permission_level, entity_id, department_id, designation_id)
SELECT '/payments', r.tier,
       (SELECT id FROM public.entities WHERE code = 'PTB'),
       (SELECT id FROM public.departments WHERE code = r.dept),
       NULL::uuid
  FROM (VALUES ('service','executive'), ('service','manager'), ('service','gm'),
               ('accounts','executive'), ('accounts','manager'), ('accounts','gm')) AS r(dept, tier)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.access_rules a
    WHERE a.route = '/payments' AND a.permission_level = r.tier
      AND a.entity_id = (SELECT id FROM public.entities WHERE code = 'PTB')
      AND a.department_id = (SELECT id FROM public.departments WHERE code = r.dept)
      AND a.designation_id IS NULL);

-- Own-route invariant only: other routes are none of this file's business.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.access_rules WHERE route = '/payments';
  IF n <> 6 THEN RAISE EXCEPTION '/payments expected 6 access_rules rows, got %', n; END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verify:  scripts/payments/probe-read-gates.sql  → "PROBE COMPLETE — 57 passed, 0 failed"
-- Rollback (manual, owner-approved only — it deletes rows):
--   delete from public.access_rules where route = '/payments';
--   and re-run section 10 of 20260830_payments_a1_schema.sql for the old gates
--   (which would re-open the hole this file closes).
-- ============================================================================
