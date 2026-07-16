-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9.7a — the keystone: link CBNs to families by id, not name text.
--
-- Today vehicle_catalog.sub_category is free text matched against
-- sub_segments.name, which is why renaming a sub-segment is disabled in the
-- admin UI (it would strand its CBNs). This migration adds an FK, backfills it
-- from the existing name match, and leaves sub_category in place for the
-- transition. NOTHING IS DROPPED (standing rule: no schema deletion without
-- explicit owner approval) — sub_category stays as the safety net until every
-- read/write has moved to the id and the owner approves removing it.
--
-- sub_segments.id is INTEGER (the 9.7 plan doc says uuid — the plan is wrong;
-- schema-current.sql and the live DB are the authority).
--
-- Apply:  psql "postgresql://postgres.<REF>:<PW>@aws-<N>-ap-south-1.pooler.supabase.com:5432/postgres" \
--           -f supabase/migrations/20260716_97a_sub_segment_id_keystone.sql
-- Staging (klpnhpnlotcbbovwswmq) first, prod (mmmxvjaavdtwlpcnjgzy) after sign-off.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. The FK column. NULL-able: some CBNs legitimately have no family yet
--    (import triage in 9.7b is what resolves them). ON DELETE SET NULL is a
--    formality — families retire (is_active=false), they are never deleted.
ALTER TABLE public.vehicle_catalog
  ADD COLUMN IF NOT EXISTS sub_segment_id integer
  REFERENCES public.sub_segments(id) ON DELETE SET NULL;

-- 2. Backfill from the existing text match. sub_segments.name is globally
--    UNIQUE (sub_segments_name_key), so this join cannot fan out — each CBN
--    resolves to at most one family. Matching is done on trimmed, case-folded
--    text because the text was hand-entered and imported from spreadsheets.
--    Rows whose sub_category matches no sub_segment are LEFT NULL, not guessed
--    (they are reported below and triaged by a human in 9.7b).
UPDATE public.vehicle_catalog vc
   SET sub_segment_id = ss.id
  FROM public.sub_segments ss
 WHERE vc.sub_segment_id IS NULL
   AND vc.sub_category IS NOT NULL
   AND btrim(lower(vc.sub_category)) = btrim(lower(ss.name));

-- 3. Index — every 9.7 employee surface (shelf, wall, search, browse) and the
--    admin workbench filter by family.
CREATE INDEX IF NOT EXISTS idx_catalog_sub_segment_id
  ON public.vehicle_catalog USING btree (sub_segment_id);

COMMIT;

-- ── Verification / backfill report ───────────────────────────────────────────
-- Run these AFTER the migration and read the output before calling 9.7a done.

-- 3a. Coverage: how many CBNs got a family, how many did not.
SELECT
  count(*)                                                   AS total_cbns,
  count(*) FILTER (WHERE sub_segment_id IS NOT NULL)         AS linked,
  count(*) FILTER (WHERE sub_segment_id IS NULL
                     AND sub_category IS NOT NULL)           AS text_but_unmatched,
  count(*) FILTER (WHERE sub_segment_id IS NULL
                     AND sub_category IS NULL)               AS no_family_text
FROM public.vehicle_catalog;

-- 3b. The rows that need a human: sub_category text that matches no family.
--     Expected causes: typos, renamed families, brand-new families from a
--     circular import. Do NOT auto-create families from these — 9.7b triage.
SELECT vc.sub_category, count(*) AS cbns, min(vc.cbn) AS example_cbn
FROM public.vehicle_catalog vc
WHERE vc.sub_segment_id IS NULL AND vc.sub_category IS NOT NULL
GROUP BY vc.sub_category
ORDER BY cbns DESC;

-- 3c. Integrity: the id must agree with the text wherever both exist. This
--     must return ZERO rows now, and stays a useful drift check during the
--     transition while both columns are live.
SELECT vc.cbn, vc.sub_category, ss.name AS linked_family
FROM public.vehicle_catalog vc
JOIN public.sub_segments ss ON ss.id = vc.sub_segment_id
WHERE btrim(lower(vc.sub_category)) IS DISTINCT FROM btrim(lower(ss.name));

-- 3d. Empty families — exist but hold no active CBN. Informational: 9.7b's
--     Families tab flags these for retire.
SELECT ss.id, ss.name, ss.segment, ss.brand
FROM public.sub_segments ss
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_catalog vc
  WHERE vc.sub_segment_id = ss.id AND vc.is_active
)
ORDER BY ss.segment, ss.name;
