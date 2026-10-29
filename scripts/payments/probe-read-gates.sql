-- ============================================================================
-- Service Payments — who may READ, for every department and rank, proved on a
-- real database.
--
-- Why this exists: the Edge Function's write gate was found admitting every
-- manager and GM in the company (fixed 2026-09-20). The two READ gates the RLS
-- policies call had the same shape — "admin, OR any manager/GM, OR the right
-- department" — so a Sales manager could read every payer name, bill and
-- allocation straight from PostgREST, page or no page. access_rules only hides
-- the nav link; RLS is the control.
--
-- HOW TO RUN: paste the whole file into the SQL editor of STAGING and run it.
-- It borrows one non-admin test account, rewrites its department and rank in
-- turn, asks both gate functions as that user, and rolls everything back.
-- Expect the run to END IN AN ERROR reading "PROBE COMPLETE"; that error IS the
-- success condition, and it carries every failure in its text (some clients
-- do not show NOTICEs).
--
-- ⛔ STAGING ONLY, enforced below by PROPERTY not by name: it refuses if any
-- trigger on public.users makes an HTTP call. Prod carries the ERP-sync webhook
-- there; an UPDATE — even one that is rolled back — is not something to fire
-- at it.
--
-- Expectations are written out by hand from the plan's ladder. They never call
-- the functions under test to decide what the right answer is.
-- ============================================================================

DO $probe$
DECLARE
  v_subject  uuid;
  v_admin    uuid;
  v_dept     record;
  v_level    text;
  v_got_r    boolean;
  v_got_bo   boolean;
  v_want_r   boolean;
  v_want_bo  boolean;
  v_pass     integer := 0;
  v_fail     integer := 0;
  v_fails    text := '';
BEGIN
  -- ── guard ───────────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.users'::regclass AND NOT t.tgisinternal
       AND (pg_get_triggerdef(t.oid) ILIKE '%http_request%'
            OR pg_get_triggerdef(t.oid) ILIKE '%net.http%')
  ) THEN
    RAISE EXCEPTION 'REFUSED: public.users has an HTTP trigger (prod ERP sync?). This probe is staging-only.';
  END IF;

  SELECT id INTO v_admin FROM public.users WHERE permission_level = 'admin' AND is_active LIMIT 1;
  SELECT id INTO v_subject FROM public.users
   WHERE permission_level <> 'admin' AND is_active ORDER BY email LIMIT 1;
  IF v_admin IS NULL OR v_subject IS NULL THEN
    RAISE EXCEPTION 'need one active admin and one active non-admin to borrow';
  END IF;

  -- ── every department (plus none) × every non-admin rank ─────────────────
  FOR v_dept IN
    SELECT id, code FROM public.departments
    UNION ALL SELECT NULL::uuid, NULL::text
  LOOP
    FOREACH v_level IN ARRAY ARRAY['executive','manager','gm'] LOOP
      UPDATE public.users SET department_id = v_dept.id, permission_level = v_level
       WHERE id = v_subject;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_subject, 'role', 'authenticated')::text, true);

      v_got_r  := public.payments_can_read();
      v_got_bo := public.payments_can_read_back_office();

      -- The ladder, by hand: department first, rank second.
      v_want_r  := coalesce(v_dept.code IN ('service','accounts'), false);
      v_want_bo := coalesce(v_dept.code = 'accounts'
                            OR (v_dept.code = 'service' AND v_level IN ('manager','gm')), false);

      IF v_got_r = v_want_r THEN v_pass := v_pass + 1;
      ELSE v_fail := v_fail + 1;
        v_fails := v_fails || format(' | can_read %s@%s got %s', v_level, coalesce(v_dept.code,'-'), v_got_r);
      END IF;
      IF v_got_bo = v_want_bo THEN v_pass := v_pass + 1;
      ELSE v_fail := v_fail + 1;
        v_fails := v_fails || format(' | back_office %s@%s got %s', v_level, coalesce(v_dept.code,'-'), v_got_bo);
      END IF;
    END LOOP;
  END LOOP;

  -- ── the admin reads everything, whatever department it is filed under ───
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  IF public.payments_can_read() AND public.payments_can_read_back_office() THEN
    v_pass := v_pass + 1;
  ELSE v_fail := v_fail + 1; v_fails := v_fails || ' | admin refused';
  END IF;

  -- ── a deactivated accounts GM reads nothing ─────────────────────────────
  UPDATE public.users
     SET department_id = (SELECT id FROM public.departments WHERE code = 'accounts'),
         permission_level = 'gm', is_active = false
   WHERE id = v_subject;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_subject, 'role', 'authenticated')::text, true);
  IF NOT public.payments_can_read() AND NOT public.payments_can_read_back_office() THEN
    v_pass := v_pass + 1;
  ELSE v_fail := v_fail + 1; v_fails := v_fails || ' | inactive accounts GM admitted';
  END IF;

  -- ── nobody signed in reads nothing ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF NOT public.payments_can_read() AND NOT public.payments_can_read_back_office() THEN
    v_pass := v_pass + 1;
  ELSE v_fail := v_fail + 1; v_fails := v_fails || ' | no-session caller admitted';
  END IF;

  RAISE EXCEPTION 'PROBE COMPLETE — % passed, % failed. Nothing was written; this rollback is deliberate.%',
    v_pass, v_fail, CASE WHEN v_fail > 0 THEN E'\nFAILURES' || v_fails ELSE '' END;
END
$probe$;
