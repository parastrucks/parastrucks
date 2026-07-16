# Phase 9.7 — Vehicle Catalog UX rework (owner-approved package)

**Status:** planned, not started. Decided 2026-07-16 from the interactive prototype board
(artifact: `claude.ai/code/artifact/aa2a498e-8d7f-46ad-ad71-9b927eb79d1f`, v3 "shortlist").
Builds AFTER the Phase 9.6 redesign is live, on its own branch off `origin/portal`, its own PR.

## The reframe everything rests on

The catalog's primary job is **getting the right family brochure out fast** — price is second.
One brochure serves many CBNs (load spans, cabin options, fuel), so the **sub-segment ("family")
is the unit of everything**: browsing, sharing, brochures. Users are average-tech but full-domain
(they know CBNs and sub-segments cold). Nobody's job is browsing a 900-row table.

Two of the package's smallest pieces already shipped early on the 9.6 branch:
full description + tyres in the family variant list (`83d088e`) and the duplicate
upload-progress fix (`4ec8b32`).

## Approved package

### F1 — Search-first landing with "your shelf"
The catalog lands as a search box + the employee's most-used families ("shelf"), no tabs/table.
- Tokenized search (every token must match CBN+description; Fuse.js already in bundle from
  Quotation). Hits point at the **family**, brochure one tap away.
- Shelf ranking: per-employee open counts. Decide at build: `localStorage` (zero schema,
  per-device) vs a small `catalog_family_opens` table (cross-device). Start with localStorage.
- "Browse all segments →" link leads to F3.

### F2 — The brochure wall (browse view inside F1)
Brochure covers as the browsing surface, per segment, flip/tap → variants + share/download.
- **Performance rule (owner concern, settled): never render PDFs live.** Generate a cover
  thumbnail ONCE at brochure upload (render page 1 via `pdfjs-dist` client-side → ~40 KB webp →
  Storage next to the PDF; `sub_segments.cover_url`). Wall = 5–12 lazy-loaded tiny images.
- One-time backfill script for existing brochures; families without a thumbnail fall back to a
  typographic cover (zero cost). Missing-brochure families show an empty slot (admin nudge).

### F3 — Hierarchy browse (fallback path)
Segment → family (brochure on card) → variant list with **full price-list description + tyres**
(the description part shipped in 9.6). Kept behind F1's "Browse all" link.

### S1 — Family-level WhatsApp share with editable draft
Share button on the family card/wall. Hands the OS share sheet the brochure PDF + a pre-filled
caption; in WhatsApp it lands as an **editable draft** the employee reviews before sending.
- Mobile: Web Share API (`navigator.share({ files, text })` — Android Chrome supports files).
- Desktop fallback: download PDF + copy caption to clipboard with a toast.
- Caption template: family name, key specs line, variant count, "prices on request", PTB sign-off.
  **Family-level only — never a single CBN's price** (one brochure ↔ many CBNs).
- Dropped alternatives (owner): WhatsApp bot (S2), QR-on-print (S3).

### A1 — The sub-segment workbench (admin), four tabs
Replaces the current assign-CBNs-inside-a-modal flow.
1. **Reshuffle** — filter (pattern over CBN+description), select-all-matching, move selected CBNs
   to any family. Move menu includes **"+ new sub-segment…"** (created inline, same stroke).
2. **Import triage** — after every price-circular import, new/unassigned CBNs queue up, each with
   a rule-suggested family; accept one-by-one or all. No rule matched → manual pick / new family.
3. **Rules** — saved patterns per family with **NOT-terms** (`1009.9 NOT school → Lynx Smart`),
   multiple per family. Rules only SUGGEST; triage confirms. Table: `catalog_assign_rules`
   (id, sub_segment_id, pattern, not_terms text[], hits, created_by/at).
4. **Families (lifecycle)** — families are never deleted, they **retire**: hidden from all
   employee surfaces (shelf/wall/search/browse), brochure + history kept, one-tap reactivate.
   Retire allowed only at 0 active CBNs. Empty families flagged. Names editable (see keystone).

## The keystone: link CBNs to families by id, not name text

Today `vehicle_catalog.sub_category` is free text matched against `sub_segments.name` — which is
why renaming a sub-segment is disabled (it would strand its CBNs) and why the owner hit disabled
edit fields on prod. Phase 9.7 adds **`vehicle_catalog.sub_segment_id` FK** (additive), backfills
it from the name match, and moves all reads/writes to the id. `sub_category` text stays during
transition (**no column drops without explicit owner approval** — standing rule). This one change
unlocks: safe rename, retire, reshuffle integrity, and rule targets that survive renames.

## Schema changes (all additive)

> **Corrected 2026-07-17 during the 9.7a build** — the two struck items below were
> wrong in the original plan. Verified against `docs/db/schema-current.sql` and both
> live databases.

- ~~`vehicle_catalog.sub_segment_id uuid`~~ → **`integer`**. `sub_segments.id` is
  `integer` (a `sub_segments_id_seq` serial), not uuid. Shipped as `integer NULL
  REFERENCES sub_segments(id) ON DELETE SET NULL` + backfill + index. ✅ DONE (9.7a)
- ~~`sub_segments.is_active` (new)~~ → **already exists** and is already enforced:
  `SalesCatalog` filters `.eq('is_active', true)` on it. Retire is partly built;
  9.7b's Families tab is UI over an existing column, not a schema change.
- Also useful: `sub_segments.name` is **globally UNIQUE** (`sub_segments_name_key`),
  so the name-match backfill cannot fan out — each CBN resolves to ≤1 family.
- `sub_segments.cover_url text NULL` (+ `cover_filename` if needed).
- New `catalog_assign_rules` (RLS admin-write; read for import-triage callers).
- Optional later: `catalog_family_opens` for a cross-device shelf.
- EF `admin-catalog`: new actions (moveCbns, createSubSegment inline, retire/reactivate,
  rules CRUD, saveCover); keep `verify_jwt:false` + internal verify() pattern.

## Findings from the 9.7a build (2026-07-17)

- **Backfill coverage:** prod links **976 / 1006** CBNs. The 30 that don't are 5 family
  names that were never created — `Garud 15M`, `Haulage – MAV 45T/46T/49T (Air Susp)`,
  `Haulage – Other`. They are the opening queue for 9.7b's Import-triage tab.
- **Staging was NOT a copy of prod** — its `sub_segments` held a single fixture row
  (`ECOMET 1115`) against a full 906-row `vehicle_catalog`, so nothing catalog-shaped was
  reviewable there. Reseeded from a prod `pg_dump` of `sub_segments` (owner-approved
  2026-07-17). **Caveat: brochure PDFs are NOT in staging's Storage bucket**, so
  `brochure_url` rows resolve but downloads 404 locally. This will bite 9.7c (F2 covers).
- **`MBP Truck` is a live segment on prod (11 families) but was missing from the app's
  `SEGMENTS` constant**, so those families rendered a blank segment dropdown. Added in
  9.7a as a stopgap. Picking any option also clears `sub_category`, so an idle click on
  that blank dropdown could strand a family's CBNs — a pre-existing prod bug.
- **An earlier `MBP Truck` → `Long Haul Trucks` rename was started and left half-done**
  (`Haulage – 19T`/`Haulage – CNG 19T` vs `Haulage 1916 HF`/`1920 HF`/`19T CNG`; the new
  ones carry brochures, the old `Haulage – CNG 19T` has 0 CBNs). Owner decided 2026-07-17
  to **finish the consolidation in 9.7b**. Remove `MBP Truck` from `SEGMENTS` once done.
- **`docs/db/seed-reference.sql` is stale** — 44 families vs prod's 49 (missing ids 45–49).
  Worth refreshing from prod separately.

## Build order

1. **9.7a keystone** — migration + backfill + switch reads/writes to id; enable rename. Test on
   staging first (psql via Session Pooler; CLI db push needs Docker — not installed).
   ✅ **DONE on staging 2026-07-17** — migration applied (860/906 linked, 0 drift), EF
   deployed, rename verified end-to-end (`renamed: 33`, text synced across all 33 CBNs
   incl. 1 inactive). **NOT yet applied to prod**: prod needs the same migration + an
   `admin-catalog` EF deploy before the client code can ship.
2. **9.7b workbench** — the four tabs (biggest JSX chunk); wire triage into the existing Import flow.
3. **9.7c find** — F1 landing + shelf; F2 wall + upload-time thumbnails + backfill; F3 re-parent.
4. **9.7d share** — S1 share + caption template.
Each its own PR to `portal`; owner reviews on localhost:5173 (staging DB) in the established
fix-and-commit-each rhythm; verify CI + Vercel READY per deploy.

## Risks / limits

- Free tier: thumbnails add Storage objects (~40 KB × families — negligible). pdfjs-dist adds a
  lazy admin-only chunk; keep it out of the main bundle.
- Backfill must handle sub_category text that matches no sub_segment (report, don't guess).
- Web Share API with files: Android Chrome ✓, desktop ✗ (fallback), iOS Safari partial — verify
  on the team's actual phones before calling S1 done.
- The Vehicles/Sub-Segments/Import tab layout changes shape (F1 becomes the landing): re-run the
  owner screen-review for the catalog area only.

## Explicitly out of scope (owner-decided)

WhatsApp bot (S2) · QR on printed brochures (S3) · price card / compare / quote-this ·
circular-history layer · price-book PDF. Revisit only on owner request.
