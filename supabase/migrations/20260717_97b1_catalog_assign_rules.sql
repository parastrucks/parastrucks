-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9.7b1 — catalog_assign_rules: saved patterns that SUGGEST a family for
-- an unassigned CBN during import triage.
--
-- Rules never assign anything on their own. They only rank a suggestion in the
-- Import-triage tab; a human confirms every assignment. That is deliberate —
-- an auto-assigning rule that is subtly wrong would mis-file CBNs silently and
-- at scale, which is precisely the class of bug 9.7 exists to end.
--
-- Shape per the owner-approved plan: pattern + NOT-terms, several per family.
--   e.g. pattern '1009.9', not_terms {'school'} -> Lynx Smart
--
-- Conventions followed from the existing schema (verified against
-- docs/db/schema-current.sql, not assumed):
--   • uuid PK with gen_random_uuid() — matches the newest tables (service_jobs).
--   • sub_segment_id is INTEGER — sub_segments.id is a serial, not a uuid.
--   • RLS via public.current_user_role(), the same helper every other policy
--     uses. NOTE it returns NULL for inactive users, so a deactivated admin
--     matches nothing and is locked out by default.
--
-- RLS posture — deliberately TIGHTER than sub_segments:
--   sub_segments_select is `USING (true)` because every sales user must read
--   families to browse the catalog. Nobody outside admin/back_office has any
--   reason to read assignment rules, so SELECT is restricted to them as well.
--   If a future employee-facing surface ever needs rules, widen it then.
--
-- Apply: staging first, then prod as part of the single 9.7 cutover.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.catalog_assign_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The family this rule suggests. CASCADE is a formality: families retire
  -- (is_active=false), they are never deleted. If one ever is, its rules are
  -- meaningless and should go with it rather than dangle.
  sub_segment_id integer NOT NULL REFERENCES public.sub_segments(id) ON DELETE CASCADE,

  -- Matched case-insensitively against CBN + description. Stored as entered.
  pattern        text NOT NULL,

  -- Every term here DISQUALIFIES a match ('1009.9 NOT school'). Empty = no
  -- exclusions. NOT NULL + default so callers never have to handle a null array.
  not_terms      text[] NOT NULL DEFAULT '{}',

  -- Bumped when triage accepts this rule's suggestion. Lets the Rules tab show
  -- which rules earn their keep and which are dead weight.
  hits           integer NOT NULL DEFAULT 0,

  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),

  -- Guard against junk: a blank or whitespace-only pattern would match
  -- everything and silently suggest one family for the entire catalog.
  CONSTRAINT catalog_assign_rules_pattern_not_blank
    CHECK (length(btrim(pattern)) > 0),
  CONSTRAINT catalog_assign_rules_pattern_len
    CHECK (length(pattern) <= 200)
);

-- The same pattern twice for one family is always a mistake; two families
-- legitimately may share a pattern (disambiguated by their NOT-terms).
CREATE UNIQUE INDEX IF NOT EXISTS catalog_assign_rules_family_pattern_key
  ON public.catalog_assign_rules (sub_segment_id, lower(btrim(pattern)));

CREATE INDEX IF NOT EXISTS idx_catalog_assign_rules_sub_segment_id
  ON public.catalog_assign_rules USING btree (sub_segment_id);

ALTER TABLE public.catalog_assign_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_assign_rules_select ON public.catalog_assign_rules;
CREATE POLICY catalog_assign_rules_select ON public.catalog_assign_rules
  FOR SELECT TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text]));

DROP POLICY IF EXISTS catalog_assign_rules_insert ON public.catalog_assign_rules;
CREATE POLICY catalog_assign_rules_insert ON public.catalog_assign_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text]));

DROP POLICY IF EXISTS catalog_assign_rules_update ON public.catalog_assign_rules;
CREATE POLICY catalog_assign_rules_update ON public.catalog_assign_rules
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text]))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text]));

DROP POLICY IF EXISTS catalog_assign_rules_delete ON public.catalog_assign_rules;
CREATE POLICY catalog_assign_rules_delete ON public.catalog_assign_rules
  FOR DELETE TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text]));

-- ── Atomic bulk move (Phase 9.7b) ────────────────────────────────────────────
-- Reshuffle's move-selected is the first bulk write in the catalog. It goes
-- through an RPC rather than a PostgREST .update().in() for two reasons:
--
--   1. ATOMICITY. One statement, one transaction: the move either lands for
--      every CBN or none. A chunked client- or EF-side loop can die halfway and
--      leave half a selection moved, with no record of which half.
--   2. URL LENGTH. PostgREST puts .in() values in the query string. At the
--      5000-CBN ceiling that is a ~100 KB request line — a 414 waiting to
--      happen. An array parameter travels in the POST body instead.
--
-- Both halves of the link are written together (sub_segment_id + sub_category);
-- writing one without the other is the drift 9.7a exists to end. p_family_name
-- is resolved and validated by the Edge Function before this is called; NULL
-- means unassign (back to the triage queue), and both columns go NULL in step.
--
-- SECURITY INVOKER (the default) is deliberate: the Edge Function calls this
-- with the service_role key, which bypasses RLS anyway. Leaving it INVOKER
-- means that if it is ever reached by a user token, vehicle_catalog's own RLS
-- still applies rather than being silently bypassed by DEFINER rights.
-- EXECUTE is revoked from anon and authenticated regardless — in this project
-- Postgres grants EXECUTE to those roles on creation, and revoking from
-- `public` alone does NOT remove it (see memory/project_edge_function_auth).
CREATE OR REPLACE FUNCTION public.move_cbns_to_family(
  p_cbns           text[],
  p_sub_segment_id integer,
  p_family_name    text
) RETURNS integer
  LANGUAGE sql
  SET search_path TO 'public'
AS $$
  WITH moved AS (
    UPDATE public.vehicle_catalog
       SET sub_segment_id = p_sub_segment_id,
           sub_category   = p_family_name
     WHERE cbn = ANY (p_cbns)
    RETURNING id
  )
  SELECT count(*)::integer FROM moved;
$$;

REVOKE ALL   ON FUNCTION public.move_cbns_to_family(text[], integer, text) FROM public;
REVOKE ALL   ON FUNCTION public.move_cbns_to_family(text[], integer, text) FROM anon;
REVOKE ALL   ON FUNCTION public.move_cbns_to_family(text[], integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.move_cbns_to_family(text[], integer, text) TO service_role;

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────

\echo '=== V0: move_cbns_to_family is callable ONLY by service_role ==='
-- Expect exactly one grantee: service_role. anon/authenticated must NOT appear.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema='public' AND routine_name='move_cbns_to_family'
ORDER BY grantee;

\echo '=== V1: table shape ==='
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='catalog_assign_rules'
ORDER BY ordinal_position;

\echo '=== V2: RLS enabled + 4 policies (all admin/back_office) ==='
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='public' AND tablename='catalog_assign_rules') AS policy_count
FROM pg_class c WHERE c.relname='catalog_assign_rules';

\echo '=== V3: constraints + indexes ==='
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.catalog_assign_rules'::regclass ORDER BY conname;
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='catalog_assign_rules' ORDER BY indexname;
