# Service Jobs (Phase 9.5) — Future Ideas Backlog

Captured 2026-06-27 from a 5-agent UI/UX creative audit ("find the spark") of the
**Outside / Ancillary Jobs** feature. Each lens (interaction model, field/input,
status-intelligence, automation, document moment) returned independently; the
ideas below are deduped and ranked. **Convergence** = how many of the 5 lenses
independently proposed it (a strong signal).

> **Status:** **Spark 1 (Parts-Out Clock) — in-app portion BUILT 2026-06-27.**
> Everything else here is TABLED for future sessions (owner chose to ship Spark 1 first).

---

## ✅ Spark 1 — The Parts-Out Clock  *(convergence: 4/5 — the headline miss)*

**Insight:** the feature was a passive ledger; its richest untapped signal is **time** —
a physical part sitting at a vendor *right now* with nobody watching the clock (the
thing that actually costs the dealership money). Reframe: ledger → operational radar.

**BUILT (client-side, `ServiceJobs.jsx` + `.sj-radar/.sj-age/.sj-dot` in `index.css`):**
- `jobAging(job)`: a part is "out" while open + `stage='po_generated'` + has `material_out_date`
  (return auto-stamps at work_completed). Non-out open jobs show "idle Nd" from `updated_at`.
  **Uniform severity (`agingSev`): 0–1 day green, 2 days amber, 3+ days red** (red out-part = overdue).
- Aging **dot + pill** on every row/card; red/amber **left border** on cards.
- **Urgency sort** (default for Active & Parts Out): overdue parts float to top; recency demoted.
- New **"Parts Out (N)"** tab — only currently-out parts, most-overdue-first.
- **Exception banner**: "⏰ N parts overdue · M jobs idle 7+ days" + "View parts out", or a
  quiet green "✓ All N active jobs on track · M parts out".
- Detail drawer material-out line shows "· Nd out".

**TABLED — the "active chaser" extension (needs owner provisioning):**
- **Overdue-part cron + morning digest email** to the service manager
  (*"3 parts overdue: PO-0014 (Bosch, 11d)…"*), optional vendor re-ping.
  Build = new `service-monitor` EF + **GitHub Actions cron** + **Resend free tier**
  (reuses the T11 security-monitor pattern already in CLAUDE.md). Effort M.
  Blocked only on: a Resend API key + repo secret. **This is the bit that makes the
  portal "follow up while no one is looking" — highest-value next step for Spark 1.**

---

## 🟡 Spark 2 — The Two-Track Board  *(built, then REMOVED 2026-06-27 — owner chose List-only + sorting)*

> Update 2026-06-27: after reviewing board UI options + the role-view IA, the owner **dropped the
> board** (kept the sortable List). The two-track storytelling moves to the role-aware "Needs you"
> views (see the IA note at the bottom). The original board write-up is kept below for reference.


Make the feature's genuinely unusual shape visible: a **spine that forks into two
independent endpoints** (vendor-paid; settlement), order-independent. No off-the-shelf
kanban shows a fork.

- ✅ **Two-Track Board — BUILT 2026-06-27** (the headline). A **List / Board** toggle on
  the Active tab. 4 columns: **PO Generated · Work Completed · [Vendor Payment · Settlement]**,
  the last two tinted as parallel "rails" (with a `parallel` tag). `boardBuckets()`: a non-AW
  job at invoice_received with both pending appears in **BOTH rails** (the fork visible);
  paying one drops it from that rail; AW jobs skip payment → ride straight to the Settlement
  (warranty) rail. Each card shows aging pill/severity + **one role-gated inline quick-action**
  (`boardAction()` → advance / mark-paid / settle, reusing the EF + `quickAct`), so it doubles
  as a light "needs-you" surface; clicking the card body opens the existing detail drawer.
  Horizontal columns on desktop (overflow-x), stacked sections on mobile (≤760px). Components
  `BoardView`/`BoardCard` + `.sj-board*`/`.sj-bc*` CSS. **Verified on staging**: INV-01 in both
  rails, INV-02 (paid) only in Settlement, AW jobs in Settlement, manager advance works.
  **Still TABLED within Spark 2:** drag-to-advance (kept click + inline buttons instead — better
  on mobile, no DnD lib), the triage inbox / command-strip / vendor-matrix below.
- ✅ **"Needs You" triage inbox — BUILT 2026-06-27 (round 11).** The default view is now a
  role-personalized action queue: a top **Needs you | All jobs** switch, with Needs-you showing
  per-role buckets (manager/gm: warranty-to-approve + parts-overdue + ancillary-ref; accounts:
  vendor-payments-due + customer-payments-to-record; exec: my-open-jobs; admin: all). Built from
  module helpers `jobPending()`/`capsForRole()`/`buildBuckets()` over the loaded jobs. Each card
  opens the drawer; one inline quick-action per bucket. **GM/admin** also get a net-new "Recent
  changes → ↩ Undo" feed; **admin** gets a lens switcher (hidden for single-role users). Smooth
  keyed view transitions + staggered card-in animations (respect `prefers-reduced-motion`). See
  the round 11 entry in the plan file.
- **Single-job command strip** — replace the modal drawer with an in-place horizontal
  progress spine that lights only the *one or two* actions the current user can take;
  history becomes an expandable tail. Effort M.
- **Twin-Rail "money owed both ways" ledger** — two columns "We Owe (vendor)" /
  "Owed To Us (customer/warranty)", each job a chip in 0/1/2 columns by open obligation,
  aged. Working-capital exposure as count+age, no rupee amounts needed. Effort M.
- **Vendor × stage matrix** — pivot jobs by `vendor_name_snapshot` × stage, count badges;
  manager/desktop heat-map of exposure ("Bosch: 4 awaiting invoice, 2 unpaid"). Effort S.

---

## ⬜ Spark 3 — Meet the Shop Floor  *(convergence: WhatsApp 3/5; capture 2/5)*

Creators are next to the truck, on a phone, hands dirty; the 13-field AW warranty letter
is the worst screen. Quick wins first, OCR is the bold bet.

- **One-tap "Send PO to vendor on WhatsApp"** *(3/5 — do this first, Effort S)* — the
  feature literally replaces WhatsApp; make it the transport. `navigator.share({files:[pdf]})`
  on mobile / `wa.me/<phone>?text=…` deep link. Needs an optional `vendor_phone` column
  on `service_vendors` (additive). Email-with-attachment variant via Resend (Effort M).
- **"Duplicate job" + per-OEM letter templates** *(Effort S)* — clone a prior job's fields;
  pre-load AW boilerplate per OEM. Kills the 12-field re-type. Templates: localStorage MVP →
  `service_job_templates` table later.
- **Auto-fill vehicle identity from chassis history** *(Effort S)* — same reg/chassis seen
  before → pre-fill chassis/engine/model/make/date-of-sale from the prior job; user only
  types the new complaint. Pure client over the loaded jobs list.
- **Smart vendor default + duplicate-job guard** *(Effort S)* — suggest most-used vendor for
  this OEM/job-type; warn if the same reg has an open job in the last ~7 days (before a PO
  number is burned). Pure client.
- **⭐ Snap-the-plate OCR auto-fill** *(Effort L, the bold bet)* — camera → `getUserMedia` →
  **Tesseract.js** (MIT, on-device WASM, no key, privacy-clean) OCRs the chassis/VIN plate or
  warranty sticker; parse to reg/VIN/engine formats; **assist-then-confirm** (OCR on embossed
  metal is imperfect). Lazy-load the worker; verify against the Phase 9 CSP (`worker-src`/wasm).
- **Voice complaint capture** *(Effort S–M)* — Web Speech API (Chrome/Android; DPDP note: routes
  via Google) or local `MediaRecorder` + Whisper-wasm fallback for the free-text complaint.
- **Photo evidence** *(Effort M)* — `<input capture="environment">` 1–3 photos of the part/damage;
  strong for warranty claims. **Breaks the v1 "no uploads" scope** — needs the deferred Supabase
  Storage bucket + UUID filenames (M5) + client downscale.
- **Offline-first capture queue** *(Effort L)* — IndexedDB queue + service worker; replay on
  reconnect. The existing `client_request_id` idempotency already makes replay safe (no dup POs).
  Scope the SW carefully against the Phase 9 CSP / Turnstile login.

---

## ⬜ Spark 4 — The Issue Ceremony  *(the document moment, 1 lens, deep)*

Today the PO is minted in silence (`doc.save()` + a toast). The PO is a real
financial/legal artifact representing an authorized Ashok Leyland dealer.

- **Preview-first "Issue PO"** *(Effort M)* — render the PDF in-app (`doc.output('bloburl')`
  → iframe) before it's real; primary button becomes "Looks right — issue PO". Especially for
  the Bosch warranty letter, never send unseen.
- **⭐ The Seal Moment** *(Effort M)* — on "Issue PO", a ~1s tasteful sequence over the preview:
  the PO number settles into place, then the dealership **stamp presses** onto the signature
  block (reuse the `al-stamp.png`/`pt-stamp.png` already embedded; CSS motion; respect
  `prefers-reduced-motion`). B2B-restrained delight = the missing emotional spark.
- **Share to WhatsApp/email** — same as Spark 3 handoff, hung off the issue step.
- **Letterhead & type craft** *(Effort M–L)* — real letterhead band, faint watermark (jsPDF
  GState opacity), embedded brand font, proper signature block. Validate against the
  `ptb-al-brand-guidelines` skill before shipping.
- **QR seal on the document** *(Effort S–M)* — footer QR deep-links to the live job
  (`/service-jobs?job=<id>`); paper becomes a portal back to the record; also self-identifies
  re-printed/edited letters. Needs `qrcode` lib + the route param.
- **Version shelf** *(Effort S→M)* — reframe "Re-print" as a "Document" section: v1/v2 issuances
  with issued-by/at, supersedes notes; makes re-print intentional + auditable.

---

## ⬜ Extra ideas (mine — not from the agents)

- **Customer status link** — share a read-only, tokenized job-status link to the end customer
  ("track your truck's repair") to cut "where's my vehicle?" calls. Pairs with the QR seal.
- **Reg-no autocomplete from existing customers/quotations** — the portal already has customer
  + vehicle data elsewhere; pre-fill on reg match to avoid re-keying known vehicles.
- **Per-vendor configurable SLA** + a **vendor turnaround leaderboard** (median days-out per
  vendor over closed jobs) — latent procurement intelligence the team already generates for free.
- **Stuck-job sentinel → escalation** — the in-app radar banner conditions, pushed to Discord/
  email via the same cron as Spark 1's extension when breaching.
- **Keyboard-first quick-create** for back-office power users (the field OCR path is for the
  shop floor; the office wants speed).

---

### Suggested sequence for a future session
1. **Finish Spark 1**: the overdue cron + manager digest (once Resend is provisioned).
2. **Spark 3 quick wins**: WhatsApp handoff + Duplicate/templates + chassis pre-fill (all S).
3. **Spark 4**: preview-first Issue + Seal Moment + QR (one coherent surface).
4. **Spark 2 remainder**: Needs-You inbox / command-strip / vendor-matrix (the board itself shipped 2026-06-27).
5. Bold bets when time allows: OCR capture, offline-first, photo evidence.

---

## Staging test data (delete before/after prod)
Rows added on staging `klpnhpnlotcbbovwswmq` to demo Sparks 1 & 2:
- Parts-Out Clock: `PO-PTB-TEST-OUT-01/02/03` (0d green / 2d amber / 12d red).
- Two-Track Board fork: `PO-PTB-TEST-INV-01` (both rails) / `PO-PTB-TEST-INV-02` (paid → settle only).

Cleanup: `delete from service_jobs where po_number like 'PO-PTB-TEST-%';`
