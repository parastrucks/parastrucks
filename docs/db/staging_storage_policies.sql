-- STAGING ONLY — do NOT run on prod (prod already has all four of these).
--
-- Staging's storage.objects has no RLS policies for the 'brochures' bucket, so
-- every read fails: createSignedUrl returns 400/"Object not found" (Storage
-- reports 404 rather than 403 so the API can't be used to probe for existence).
-- Uploads still worked, because signed-upload URLs are token-authorised and
-- bypass RLS entirely — which is why the files are present but invisible.
--
-- These four are copied verbatim from prod's canonical dump
-- (docs/db/schema-current.sql, "objects brochures_*" POLICY blocks) so staging
-- ends up with prod's exact posture: any authenticated user may READ brochures;
-- only admin/back_office may write.
--
-- Idempotent: each policy is dropped only if it already exists, then recreated.
-- Nothing else in the storage schema is touched.

BEGIN;

\echo '=== BEFORE: existing brochures policies on staging ==='
SELECT policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'brochures%'
ORDER BY policyname;

\echo '=== does the brochures bucket row exist, and is it private? ==='
SELECT id, name, public FROM storage.buckets WHERE id = 'brochures';

-- Depends on public.current_user_role() (the same helper prod's policies use).
-- If this errors, staging is missing that function and the write policies below
-- cannot be created — the SELECT policy alone is enough to unblock the review.
DROP POLICY IF EXISTS brochures_select ON storage.objects;
CREATE POLICY brochures_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'brochures'::text);

DROP POLICY IF EXISTS brochures_insert ON storage.objects;
CREATE POLICY brochures_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'brochures'::text)
              AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text])));

DROP POLICY IF EXISTS brochures_update ON storage.objects;
CREATE POLICY brochures_update ON storage.objects
  FOR UPDATE TO authenticated
  USING ((bucket_id = 'brochures'::text)
         AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text])));

DROP POLICY IF EXISTS brochures_delete ON storage.objects;
CREATE POLICY brochures_delete ON storage.objects
  FOR DELETE TO authenticated
  USING ((bucket_id = 'brochures'::text)
         AND (public.current_user_role() = ANY (ARRAY['admin'::text, 'back_office'::text])));

COMMIT;

\echo '=== AFTER: policies now present (expect 4) ==='
SELECT policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'brochures%'
ORDER BY policyname;

\echo '=== objects actually in the bucket (proves the 7 uploads landed) ==='
SELECT name, round((metadata->>'size')::numeric/1024) AS kb, created_at
FROM storage.objects
WHERE bucket_id = 'brochures'
ORDER BY created_at DESC;

\echo '=== families claiming a brochure vs whether that object exists ==='
SELECT ss.name AS family,
       ss.brochure_filename,
       (o.id IS NOT NULL) AS file_present
FROM public.sub_segments ss
LEFT JOIN storage.objects o
  ON o.bucket_id = 'brochures' AND o.name = ss.brochure_url
WHERE ss.brochure_url IS NOT NULL
ORDER BY file_present, ss.name;
