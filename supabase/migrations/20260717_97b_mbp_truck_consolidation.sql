-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9.7b — finish the abandoned MBP Truck → Long Haul Trucks rename.
--
-- Background (reconciled against prod 2026-07-17):
--   vehicle_catalog has ZERO 'MBP Truck' rows — all 328 are already
--   'Long Haul Trucks'. Only sub_segments still says 'MBP Truck', for 11
--   families covering 277 CBNs. Someone migrated the vehicles and left the
--   families behind. So this is an 11-row UPDATE, not a data migration:
--   vehicle_catalog is NOT touched at all.
--
--   The mismatch was invisible in the UI because the app's SEGMENTS constant
--   never listed 'MBP Truck' — those 11 families rendered a blank segment
--   dropdown instead of an obviously-wrong one.
--
-- Owner decisions (2026-07-17):
--   • Retire 'Haulage – CNG 19T' (0 CBNs, no brochure) — a leftover of the
--     abandoned rename. 'Haulage 19T CNG' (6 CBNs, has brochure) is the real
--     family. Retire, never delete (standing rule + the 9.7 lifecycle model).
--   • Leave 'Haulage – 19T' and its 6 CBNs alone. It becomes a normal Long Haul
--     Trucks family; the owner triages those 6 by hand in the Reshuffle tab,
--     because 1916-vs-1920 is a per-CBN judgement call, not a rule.
--
-- NOTHING IS DELETED. No column drops. Retire = is_active flag.
--
-- Apply:  staging (klpnhpnlotcbbovwswmq) first, prod (mmmxvjaavdtwlpcnjgzy)
--         as step 1 of the single 9.7 cutover, alongside the 9.7a keystone.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Guard: if vehicle_catalog ever DOES hold 'MBP Truck' rows, the premise above
-- is wrong and this migration must not run — moving the families would then
-- strand those vehicles in a segment no family lives in. Fail loudly instead.
DO $$
DECLARE stray integer;
BEGIN
  SELECT count(*) INTO stray FROM public.vehicle_catalog WHERE segment = 'MBP Truck';
  IF stray > 0 THEN
    RAISE EXCEPTION
      'Aborting: % vehicle_catalog rows still have segment = ''MBP Truck''. '
      'This migration assumes the vehicles were already migrated to Long Haul '
      'Trucks and only the families lag. Re-run the segment reconciliation.', stray;
  END IF;
END $$;

-- 1. Retire the empty leftover family. Guarded on 0 active CBNs — the 9.7
--    lifecycle rule is that retire is only legal at zero, and if CBNs appeared
--    since the reconciliation we want this to no-op rather than hide them.
UPDATE public.sub_segments ss
   SET is_active = false
 WHERE ss.name = 'Haulage – CNG 19T'
   AND NOT EXISTS (
     SELECT 1 FROM public.vehicle_catalog vc
     WHERE vc.sub_segment_id = ss.id AND vc.is_active
   );

-- 2. Move the 11 families to the segment their own vehicles already use.
--    sub_category text is untouched (names don't change — only the segment).
UPDATE public.sub_segments
   SET segment = 'Long Haul Trucks'
 WHERE segment = 'MBP Truck';

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────

-- V1. Must be zero: no family may remain in MBP Truck.
SELECT count(*) AS families_still_mbp
FROM public.sub_segments WHERE segment = 'MBP Truck';

-- V2. The consolidated Long Haul Trucks families (expect 14 = 3 existing + 11).
SELECT ss.id, ss.name, ss.is_active,
       (ss.brochure_url IS NOT NULL) AS has_brochure,
       (SELECT count(*) FROM public.vehicle_catalog vc
         WHERE vc.sub_segment_id = ss.id) AS cbns
FROM public.sub_segments ss
WHERE ss.segment = 'Long Haul Trucks'
ORDER BY ss.is_active DESC, ss.name;

-- V3. Family segment vs vehicle segment must now agree everywhere. Zero rows.
SELECT ss.segment AS family_says, vc.segment AS vehicle_says, count(*) AS cbns
FROM public.vehicle_catalog vc
JOIN public.sub_segments ss ON ss.id = vc.sub_segment_id
WHERE ss.segment IS DISTINCT FROM vc.segment
GROUP BY ss.segment, vc.segment;
