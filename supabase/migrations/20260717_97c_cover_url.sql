-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 9.7c c2 — sub_segments.cover_url: a page-1 thumbnail of the brochure.
--
-- The performance rule (owner concern, settled): NEVER render PDFs live on the
-- wall. A cover is generated ONCE — page 1 rendered client-side via pdfjs-dist
-- to a ~40 KB webp, stored next to the PDF in the private `brochures` bucket.
-- The wall then shows tiny lazy-loaded images, not live PDFs.
--
-- cover_url holds the storage path (like brochure_url). It is served through a
-- short-lived signed URL, same as the brochure itself — the bucket is private,
-- so a cover is no more exposed than the PDF it came from.
--
-- Additive, nullable: families without a cover fall back to a typographic tile
-- (already shipped in c1). No backfill in SQL — covers can only be rendered
-- where the real PDFs are (an admin browser against prod), so the backfill is a
-- one-click admin action, run at/after cutover.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.sub_segments
  ADD COLUMN IF NOT EXISTS cover_url text;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sub_segments' AND column_name='cover_url';
