# Phase 9.7 — Vehicle Catalog UX rework (owner-approved package)

**Status (2026-07-20): 🔨 BUILT, STAGING-VERIFIED, RED-TEAM-2 HARDENED & OWNER-REVIEWED — NOT YET ON
PROD.** All of 9.7a/b/c/d built and verified against staging `klpnhpnlotcbbovwswmq` on branch
**`claude/phase-9-7-start-0c4b8d`** (40 commits). **Pre-ship pipeline done:** R5 EF smoke test (19/19,
found+fixed R11 createVehicle brand_id) → four clean-room red-team lanes → 19 Tier1+2 fixes
(R12–R18 + hardening) → **re-verified 25/25 on staging** after the b1 migration re-run + EF redeploy
(the T2 vertical-sync headline, T1 import field-preservation, T6 repair-on-save, T7 brand FK, H10/H11
guards, R5 regression all green). **Owner walked the catalog screen-by-screen on staging (2026-07-20)
— all tabs pass.** One enhancement landed during review (`2e99f9e`): an **admin "Browse" tab** that
renders the employee wall with full-catalog scope (`allBrands`/`embedded` props on SalesCatalog) so an
admin can see what sales see — client-only, no migration/EF change, rides the merge. Branch is current
with `origin/portal` (no rebase pending). **Remaining before ship:** owner's on-phone Android
Web-Share check (S1) + the strict-order cutover. Not merged; no prod migration/EF deploy yet.
Ships to prod as ONE release (owner-decided) —
see the "Prod cutover order" and "Red-team findings" sections below, and the pre-ship pipeline in
`CLAUDE.md` → Next actions. Decided 2026-07-16 from the interactive prototype board
(artifact: `claude.ai/code/artifact/aa2a498e-8d7f-46ad-ad71-9b927eb79d1f`, v3 "shortlist").
The sections below are the LIVING record (build notes, findings, cutover) — read top-to-bottom.

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
- **An earlier `MBP Truck` → `Long Haul Trucks` rename was started and left half-done.**
  Owner decided 2026-07-17 to **finish the consolidation in 9.7b**.
  **Reconciled against prod 2026-07-17 — the direction is unambiguous:**
  `vehicle_catalog` has **zero** `MBP Truck` rows (all 328 are already
  `Long Haul Trucks`); only `sub_segments` still says `MBP Truck`, for 11 families
  covering 277 CBNs. **The vehicles were migrated and the families were left behind.**
  So the consolidation is `UPDATE sub_segments SET segment='Long Haul Trucks' WHERE
  segment='MBP Truck'` (11 rows) — not a data migration. Then remove `MBP Truck` from
  the `SEGMENTS` constant (added in 9.7a only as a stopgap so those 11 families stop
  rendering a blank segment dropdown; no vehicle ever had that segment).
  Two near-duplicate pairs need an owner decision first, they are NOT mechanical:
  `Haulage – CNG 19T` (0 CBNs) vs `Haulage 19T CNG` (6, has brochure), and
  `Haulage – 19T` (6) vs `Haulage 1916 HF`/`Haulage 1920 HF` (9/8, both have brochures).

- **🔴 PostgREST's 1000-row cap was silently truncating the catalog** (fixed 2026-07-17,
  commits `ba43a5f` + `e55bef3`). `vehicle_catalog` is 1006 rows on prod; every fetch
  selected without a range, so PostgREST returned exactly 1000 and said nothing — the
  admin tab displayed "897 of 1000" while the table held 1006. Six vehicles were
  invisible in prod's admin UI, growing with every circular. The import preview's
  existing-CBN lookup had the same flaw plus a 414-length risk on a ~1000-value `.in()`.
  **Directly relevant to 9.7b:** Reshuffle's "select-all-matching" would have driven bulk
  reassigns off a truncated list. Any new catalog-wide read must use `fetchAllRows()`.
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
**Release shape — decided by the owner 2026-07-17: 9.7 ships to prod as ONE release**,
like 9.6 (staging smoke-test → red-team → owner screen-by-screen → single squash-merge).
Sub-phases are build/review milestones on one branch, **not** separate prod deploys.
Explicitly included in that decision: the two 1000-row-cap fixes (`ba43a5f`, `e55bef3`)
ride with the release rather than going direct-to-`portal`, even though they are
independent of 9.7 and fix a live prod bug. Owner was shown that tradeoff and accepted it.

**Prod cutover order (strict — a wrong order breaks the catalog for everyone):**

> **Deploy-window rule (red-team-2):** from step 1 until step 6 is READY, **nobody runs a
> price-circular import or edits families**. The old EF's `bulkUpsertVehicles` upserts
> `sub_category`/`segment` text without the id, and the old client's family edit writes
> text alone — either one, run mid-window, stamps text that disagrees with the freshly
> backfilled ids. Silent drift, not breakage; the window is minutes, keep it clean.

1. Apply `20260716_97a_sub_segment_id_keystone.sql` to prod. The client selects
   `sub_segment_id`; without the column PostgREST 400s and the Catalog page dies.
   The migration now **asserts folded-name uniqueness before the backfill** (red-team-2
   H9) — if it RAISEs about colliding family names, resolve the duplicates first;
   nothing has been written.
2. Apply `20260717_97b_mbp_truck_consolidation.sql` — **must come AFTER the keystone**:
   its retire-guard queries `vc.sub_segment_id` and errors (loud, safe, nothing applied)
   if the column doesn't exist. Expect the retire step to print **`UPDATE 1`** on prod
   (`Haulage – CNG 19T`, 0 CBNs there). **`UPDATE 0` = stop and investigate** — the
   retire path could NOT be rehearsed on staging (that family holds 6 CBNs there, so
   the guard no-op'd; staging's CBN↔family distribution is NOT prod's — prod families
   over staging's older 906-row catalog).
3. Apply `20260717_97b1_catalog_assign_rules.sql` — the rules table + the
   `move_cbns_to_family` RPC (now 5-arg: it writes **all four** placement columns,
   incl. `sales_vertical_id` — red-team-2 T2). Then apply
   `20260717_97c_cover_url.sql` (adds `sub_segments.cover_url`).
4. Deploy the `admin-catalog` EF (`--no-verify-jwt` — all 7 EFs run `verify_jwt:false`
   and do their own stricter verify(); deploying without the flag breaks every action).
   Must precede the client: old EF's createVehicle silently drops sub_segment_id from
   new vehicles (unknown fields ignored, no error) — degradation, not breakage, but real.
5. Merge the PR / let Vercel deploy the client. Verify CI all-green + Vercel READY.
6. Run the 9.7c cover-thumbnail backfill **against prod**: log in as admin → Vehicle
   Catalog → Sub-Segments → "Generate N covers". **Keep the tab visible** — pdfjs render
   steps via requestAnimationFrame; a hidden tab pauses it (a scoped rAF shim guards this,
   but foreground is still best). Runs where the real PDFs are; ~0.2s/page.
7. Refresh `docs/db/schema-current.sql` + `seed-reference.sql` dumps (both stale now:
   no sub_segment_id; 44 vs 49 families).
Expected prod backfill: **976 / 1006** linked, 30 CBNs left NULL across the 5 orphan
family names (they become the Import-triage tab's opening queue).

## Red-team findings (2026-07-17, post-9.7a review) — open items in scope for 9.7

- **🔴 R1 — Import re-introduces text/id drift after any rename (armed landmine).**
  `runImport`/`bulkUpsertVehicles` upserts `sub_category` text with NO `sub_segment_id`:
  existing rows keep their id but get their text overwritten by the Excel. Harmless
  while Excel names == family names; the **first rename followed by the next circular
  import** makes admin table (reads text) disagree with sales cards (read id), and
  nothing in the app detects it. **Required 9.7b scope, not optional:** import must
  resolve `sub_segment_id` from the name match at import time (triage queues the rest),
  and ideally the app gains a drift check (the migration's 3c query, surfaced in admin).
- ~~**🔴 R2 — Quotation / ProformaInvoice / FinancierCopy have the same latent 1000-row
  cap**~~ ✅ **FIXED 2026-07-17 (`2a11a72`).** `fetchAllRows` extracted to
  `src/lib/fetchAll.js`; all four readers paginated, each with an `.order('id')`
  tiebreak (offset paging needs a total order). Verified on staging at PAGE_SIZE=100 —
  Quotation paged 8 requests to 797 active rows and terminated correctly.
  **Rule for all future catalog work: never `.select()` vehicle_catalog without
  `fetchAllRows` or an explicit `.range()`.**
- ~~**🟠 R3 — Editing a family's SEGMENT syncs nothing**~~ ✅ **FIXED + verified on
  staging 2026-07-17** (`ffc6f28`). EF action `setSubSegmentSegment` updates the family
  and syncs `vehicle_catalog.segment` on every linked CBN (`synced: 1` observed, vehicle
  followed `Bus – MCV` → `Bus – ICV`). **The b2 UI must route the modal's Segment field
  through this action** — a direct PostgREST write bypasses the sync.
- **🟠 R4 — Retired families remain assignable** (server side ✅ done, **UI still open**):
  `moveCbns` now refuses a retired destination (409, verified). Still to do in b2: admin
  `fetchSubSegs` has no `is_active` filter, the vehicle modal's family dropdown filters
  by segment only, and the import's segment auto-fill map includes retired names.
- **✅ R5 — EF paths verified** (CLOSED 2026-07-20). `signBrochureUpload` + all 9.7b actions
  verified earlier (incl. refusal paths). The 4 remaining actions —
  `createVehicle` / `updateVehicle` / `toggleVehicleActive` / `bulkUpsertVehicles` — were
  covered by the pre-ship smoke test (signed-in staging admin JWT → deployed staging EF,
  read-back after each): **19/19 checks pass**, incl. updateVehicle whitelist enforcement
  (a sneak `cbn` write is ignored), bulkUpsert insert/update split, the null-erase guard
  (blank price_circular preserved), and R1 no-refile-of-existing.
- **🔴 R11 — `createVehicle` never set `brand_id`** (found + fixed 2026-07-20, `745f093`).
  The single-vehicle Add form wrote only the legacy `brand` text code; `vehicle_catalog.brand_id`
  is NOT NULL, so **every "Add Vehicle" failed the constraint**. `git log -S brand_id` on the EF
  shows it was never set → **pre-existing prod bug**, latent because the R5 actions had never been
  exercised end-to-end; surfaced immediately by the smoke test. Fix resolves `brand_id` server-side
  from the brand code, mirroring the import path's client-side resolution. This bug rides the 9.7
  release (fixed within it), like the other three pre-existing prod bugs (1000-row cap, import
  null-erase, MBP blank dropdown). Requires the `admin-catalog` EF deploy on the cutover.
- **🔴 R10 — `moveCbns` originally did not carry `segment`** (found + fixed 2026-07-17,
  `d6e50fd`). It wrote `sub_segment_id` + `sub_category` only, so moving a CBN into a
  family in a DIFFERENT segment left the vehicle's segment stale — the same
  family-vs-vehicle drift the MBP consolidation had just cleaned, re-entering through
  the move path. R3 fixed the *edit* path and missed the *move* path.
  **Only surfaced because a test move happened to cross segments; a same-segment test
  passes clean.** Now all three placement columns are written together, and the
  cross-segment move is a permanent test case. `COALESCE` keeps the segment on unassign.
  **Lesson for b2/b3: any new write to vehicle_catalog placement must set
  sub_segment_id + sub_category + segment together, and be tested ACROSS segments.**
- **🟡 R6 — minor**: `renameSubSegment` has no name-length cap; its `ilike` collision
  check misparses `%`/`_` in names (none exist today). `fetchAllRows` offset-pages, so a
  concurrent import can skip/dup a row mid-fetch (admin-only; refresh self-heals); on
  fetch error the catalog shows an empty state, not an error (pre-existing pattern).
- **🟡 R7 — 9.7c prerequisite**: cover upload cannot reuse `signBrochureUpload` (signs
  `.pdf` paths / PDF content-type); needs its own EF action for webp.
  ✅ **Staging brochures RESOLVED 2026-07-17** — see R8; the F2-wall review is unblocked.

- **🔴 R8 — staging's Storage had NO RLS policies for the `brochures` bucket**
  (fixed on staging 2026-07-17; **prod was never affected** — it has all four).
  Symptom: `createSignedUrl` returned `400 / {"statusCode":"404","error":"not_found"}`
  for every brochure, and `storage.buckets` listed as `[]` to an authenticated admin.
  Storage reports 404 rather than 403 by design (so the API can't probe for file
  existence), which makes a *permissions* fault look exactly like a *missing file*.
  Uploads still succeeded throughout — signed-upload URLs are token-authorised and
  bypass RLS — so files were present but invisible. `pg_policies` showed **0 rows**
  before the fix; prod's four `brochures_*` policies were copied verbatim from
  `docs/db/schema-current.sql`. Repair script:
  `scratchpad/staging_storage_policies.sql` (staging-only, idempotent).
  Staging now has 7 families with real, resolving brochures (verified: signed URL +
  byte counts match source PDFs); `12M Coach` / `RMC` / `RMC EDPTO` had their dangling
  `brochure_url` cleared to NULL (owner-approved) so nothing 404s during review.

- **🔴 R9 — `RECONSTRUCTION.md` cannot actually rebuild the portal: Storage is missing
  entirely.** No step creates the `brochures` bucket, and the bucket ROW is not in
  `schema-current.sql` (only the `storage.*` policies are, incidentally). A rebuild
  from that blueprint yields a portal whose brochure upload/download fails. Staging is
  the proof — bucket created by hand, policies never applied, drift unnoticed for
  months. **Fix:** add a Storage section to RECONSTRUCTION.md (create bucket, private,
  + the four policies) and consider dumping `storage.buckets` alongside the schema.

- **⚠️ Standing lesson — "staging mirrors prod" is FALSE.** Twice now, silently:
  `sub_segments` held 1 fixture row vs prod's 49; Storage had zero policies vs prod's
  four. Both were invisible until something specifically exercised them, and both
  masqueraded as other problems (a bad backfill; missing files). **Verify, never
  assume, whenever 9.7 touches a surface staging has not exercised before.**

Owner reviews on localhost (port **3000** per `.claude/launch.json`, staging DB) in the
established fix-and-commit-each rhythm; verify CI + Vercel READY on the single deploy.

## Risks / limits

- Free tier: thumbnails add Storage objects (~40 KB × families — negligible). pdfjs-dist adds a
  lazy admin-only chunk; keep it out of the main bundle.
- Backfill must handle sub_category text that matches no sub_segment (report, don't guess).
- Web Share API with files: Android Chrome ✓, desktop ✗ (fallback), iOS Safari partial — verify
  on the team's actual phones before calling S1 done.
- The Vehicles/Sub-Segments/Import tab layout changes shape (F1 becomes the landing): re-run the
  owner screen-review for the catalog area only.

## Post-9.7 follow-up: provenance repair (owner-deferred 2026-07-17)

The import used to send `null` for blank Price Circular / Effective Date, ERASING
those columns on every imported row (fixed in `dd9e831` — blank now means "leave
as is"). Any PAST prod import run with those fields blank will have nulled the
provenance of the rows it touched. **Do this AFTER 9.7 ships:**
1. Measure (read-only): count prod `vehicle_catalog` rows with null `price_circular`
   / `effective_date`, split active vs inactive.
2. If active rows are affected: every active vehicle reflects the CURRENT price
   list, so one import of the latest circular WITH both fields filled restamps the
   whole active catalog cleanly (proved on staging — 797 null → 0). Fold into a
   cutover import or run standalone.
3. Inactive/superseded rows: historical circular is likely unreconstructable —
   accept as-is, low operational value.

## pdfjs cover generation — hard-won setup notes (2026-07-20, c2)

Real thumbnails via `pdfjs-dist` fought two non-obvious issues; both are fixed and
documented in `src/lib/coverGen.js` + `vite.config.js`, recorded here so they aren't
re-litigated:
- **optimizeDeps exclude**: `pdfjs-dist` MUST be excluded from Vite's `optimizeDeps`, or
  the pre-bundled main import and the `?worker` build become different instances whose
  API-version constants mismatch → `page.render()` deadlocks (getDocument/getPage/
  getOperatorList all still work, which is what makes it baffling).
- **requestAnimationFrame in hidden tabs**: pdfjs steps its canvas draw via rAF, which the
  browser PAUSES in a backgrounded/hidden tab, so render hangs forever there. A scoped
  rAF→setTimeout shim in coverGen fixes it. (This also cost a long debug session because
  the automated test browser runs `hidden` — the "deadlock" was a test artifact, not code.)
- Perf: render is ~0.2s/page; covers are 14-25 KB webp. Not a hot path (admin batch only),
  and pdfjs is a lazy dynamic-import chunk that never enters the employee bundle.

## Explicitly out of scope (owner-decided)

WhatsApp bot (S2) · QR on printed brochures (S3) · price card / compare / quote-this ·
circular-history layer · price-book PDF. Revisit only on owner request.


## Red-team 2 — clean-room review (2026-07-20, pre-ship pipeline)

Four independent reviewer lanes (server EF+migrations · admin workbench UI · sales
UI+covers+share · cross-cutting incl. files the branch did NOT change), each **barred from
reading docs/ and CLAUDE.md** so they could not parrot the R1–R11 log. 57 raw candidates →
deduped, then every reported finding was re-verified against the code before acting.
Clean across all lanes: no unauthenticated-reachable surface, no injection, **no price
leakage in the share path**, no retired/inactive leakage to employees, RPC lockdown
correct, migrations idempotent and order-safe.

**Tier 1+2 — 19 findings fixed (owner-approved wave, commits `c076e91..e85b134`):**

- **T2 / R12 — `sales_vertical_id` was a 4th placement column nobody synced** (`ddc0bda`).
  `vehicle_catalog_select` RLS scopes every sales read — catalog AND quotation search — on
  it, and Phase 6b backfilled it FROM segment. A cross-segment Reshuffle move synced
  segment but left the old vertical: the vehicle vanished for the destination vertical's
  salespeople and haunted the old vertical's. RPC now 5-arg (4-arg dropped); EF resolves
  the vertical from destination segment+brand via the 6b mapping; unassign preserves it
  like segment; `setSubSegmentSegment` syncs it too. **The worst find of the wave — the
  exact drift class 9.7 was built to end, one column over.**
- **T1 / R13 — import erased 4 more fields it always sent** (`8580349`). The R-fix for
  blank price_circular/effective_date left `description` (''), `tyres` (null),
  `gst_rate` (18), `is_active` (true) stamped on every row — a minimal CBN+MRP sheet
  blanked descriptions catalog-wide and **silently reactivated hand-deactivated
  vehicles**. Existing rows now get only fields the file carries; gst_rate/is_active are
  never sent for them AND dropped from the EF's PRICE_FIELDS (stale clients can't
  reintroduce it — owner-ratified policy: a circular never changes activation).
- **T3 / R14 — Add-Sub-Segment assigned CBNs via direct PostgREST** (`f1459ed`): id+text
  only (no segment, no vertical), no retired-destination guard (born-retired family could
  swallow active CBNs, hiding them from every surface incl. triage), unchunked `.in()`.
  Now routed through `moveCbns`; born-retired+CBNs blocked client-side; add gets the
  case-insensitive name-clash check rename already had.
- **T6 / R15 — the rename/segment "re-run to retry" repair was a no-op** (`f1459ed`,
  `ddc0bda`): both flows early-returned on an unchanged value, but the family row updates
  FIRST, so every retry compared equal and skipped the failed CBN sync. Early-returns
  removed; the modal now calls both EFs unconditionally on save — **Save is the repair
  tool** for half-applied syncs.
- **T4 / R16 — triage suggested retired families** (`301b10c`): rules aren't cleaned on
  retire; a retired-family rule rendered a blank-but-armed dropdown, per-row Assign
  409'd, Accept-all aborted mid-run AND the catch skipped the refresh (committed groups
  rendered as unassigned). Suggestions now filter to active families; refresh in finally.
- **T5 / R17 — 'MBP Truck' still in SEGMENTS** (`c076e91`) — the code's own comment
  promised removal with this release; left in, it let admins re-file vehicles into the
  just-eliminated segment (invisible to every quotation segment tab).
- **T7 / R18 — updateVehicle let `brand` drift from `brand_id`** (`2003557`) — the R11
  fix covered create only; now brand changes re-resolve the FK.
- **H1–H12 hardening** (same commits): ILIKE clash checks escape %/_ and surface errors
  (unescaped, "Haulage_19T" matched unrelated names and blocked renames); bulk-insert
  column whitelist (verbatim rows could set explicit `id`, poisoning the serial into
  future PK collisions); import CBNs trimmed+uppercased (all 906 prod CBNs are uppercase
  — case-variant rows forked the catalog) + in-file duplicate CBNs keep last occurrence
  instead of aborting the INSERT; share's text-only path no longer gated on `!file`
  (file-incapable phones got the desktop fallback); cover tiles get `onError` →
  typographic fallback (signed URLs die after 1 h in an open tab); `readShelf` returns
  only plain objects (corrupt localStorage crashed every card click); coverGen renders
  serialized module-wide (the rAF shim swaps a global — overlapping renders left the
  setTimeout shim installed permanently) + single-flight pdfjs init (double Worker leak);
  triage hits-bump credits the rule that MATCHED, not the family's top-hits rule
  (corrupted the counts that drive tie-breaks); keystone migration asserts folded-name
  uniqueness before the backfill (case/whitespace twin names would fan out arbitrarily);
  `setSubSegmentSegment` pins segment to the known list + rename caps name length;
  `toggleVehicleActive` refuses activation into a retired family; cover backfill no
  longer toasts success after a total pdfjs-import failure.

**Tier 3 — verified but deferred (not ship-blocking), in rough priority order:**

1. **EF guards are advisory, not a boundary** — any admin/back_office token can bypass
   every 9.7 integrity invariant (retire-at-zero, rename sync, segment sync,
   no-move-into-retired) with one direct PostgREST write from devtools; RLS permits it
   and the caller set is identical, so no privilege escalates. Real fix = DB triggers
   enforcing the invariants. Acknowledged in code comments.
2. **Admin read failures render authoritative-looking empty states** — fetchVehicles /
   fetchSubSegs / loadRules / modal CBN fetches all swallow errors; worst case Triage
   shows "queue is empty — every active vehicle belongs to a family" on a network error.
   (Sales side has the same pattern: "No vehicles available".)
3. **Retire-vs-move TOCTOU** — two admins interleaving retire and moveCbns can produce a
   retired family holding active CBNs (both guards are read-then-write, no DB backstop).
   Low probability on this team size; the trigger fix in (1) would close it too.
4. **Import family-matching is not brand-filtered** — a Switch circular whose
   Sub-Category text matches an AL family name files new Switch CBNs into the AL family.
   Family names are globally unique by design, so this needs an owner decision on
   whether families are brand-scoped.
5. **New rows get NULL sales_vertical_id** (import + createVehicle) = visible to every
   vertical within the brand. Pre-existing behaviour, consistent, but now that moves
   resolve the vertical the asymmetry is visible. Owner call on auto-scoping new rows.
6. Smaller: Vehicles-tab pagination can strand past the last page after a refetch;
   header-detection requires an exact 'cbn' cell while column-matching is substring
   ("CBN No." fails detection; a "Sub-Segment" column header maps to `segment`); import
   rows with unresolved family + blank Segment insert `segment: ''` (invisible to
   segment tabs until triaged); share caption defaults unknown brand to "Ashok Leyland";
   search has no dash/punctuation folding ("bus-icv" misses "Bus – ICV"); MRP-only
   search tokens of ₹/commas match everything; renamed/synced counts cap at 1000
   (PostgREST max-rows on the returning select); Triage accept-all >60 families in a
   minute can 429 on the EF rate limit; `fetchAllRows` end-detection assumes the
   server's max-rows stays ≥ PAGE_SIZE (if that setting is ever lowered below 1000 the
   pagination silently truncates again); family `brand` edits sync nothing on vehicles
   (same class as segment, no EF action); shelf keys for text-orphan cards strand their
   open-counts once the family is properly filed.

**Re-verification needed on staging before owner review:** re-run
`20260717_97b1_catalog_assign_rules.sql` (RPC signature changed — the migration drops the
4-arg overload itself) and redeploy `admin-catalog`; then targeted smoke: cross-segment
move syncs vertical, import preserves untouched fields, unconditional save repairs, R5
actions still green.
