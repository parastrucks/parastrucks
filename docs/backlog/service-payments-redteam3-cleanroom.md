# Red-team round 3 — CLEAN-ROOM sweep, running digest
# (12 lanes launched blind: no plan file, no data files. This file = survival log
#  against token exhaustion. Each lane: verdict vs plan v3 + NOVEL items to absorb.)
# Plan file: C:\Users\dhruv\.claude\plans\need-to-create-a-merry-petal.md

## Lane status
1. Architecture        DONE
2. Mobile UX           DONE
3. Controls/Fraud      DONE
4. Ops/Reliability     DONE
5. Adoption/People     DONE
6. Ledger data model   DONE — ALL 12 LANES COMPLETE
7. GST/Statutory       DONE
8. Matching algorithm  DONE
9. Busy integration    DONE
10. Security/AuthZ     DONE
11. Pilot/Rollout      DONE
12. Devil's advocate   DONE

---

## LANE 1 — Architecture (DONE)
Convergent with plan v3: paise-integer + RPC-enforced invariants; append-only allocations
with reversal rows; payer alias learning (= our payer_memory); import exception queue on
amend/cancel-with-allocations; Busy spike front-loaded; ledger-name mapping as data on
groups; no auto-matching; groups carry busy_ledger_name; nightly pg_dump; idempotent file
hash; TDS as allocation kind; advances as unallocated-payment first-class.
NOVEL — absorb:
- **Two-phase payment truth: `claimed` (counter staff quick-add ~10s at moment of payment)
  vs `confirmed` (nightly statement import attaches UTR; claims with no statement row in
  2 days = fake-screenshot fraud flag).** Solves the T+1 memory-loss problem AND the
  fake-UPI-screenshot fraud in one mechanism. Our plan matches only from exports.
- **Cohort screen for anonymous fixed-price counter sales**: day-level count+total
  reconciliation of the ₹1,930 class instead of fake-precision pairing; individual pairing
  enforced only when a named credit customer is involved. Kills the 17×₹1,930 problem
  honestly.
- Aging escalation: UPI unmatched >3 days auto-moves service queue → accounts queue.
- No mutable outstanding column (computed view) — we keep denorm+CHECK+drift script; note.
- Vehicle reg as PRIMARY recognition key on match cards (staff know trucks, not names).
- company/location columns from day 1 (we have entity_id + outlet_id ✓).
DIFF/decision: two-phase claimed flow = new scope; recommend v1 = confirmed-only + optional
claim quick-add in A2 (evaluate in pilot).

## LANE 2 — Mobile UX (DONE)
(Read src/index.css conventions; extends existing mobile shell: TopBar+BottomNav, 44px
targets, .seg, bottom sheets, tone tokens. Prefix pm-*.)
NOVEL — absorb nearly all:
- IA: bottom-nav **Match** tab (badge=unmatched) with seg tabs `To match | Returned |
  Set aside | Done`. Returned = bounce-backs land maker-side with reason chip + previous
  selection struck-through. Done = post-snackbar undo surface.
- New Receipt on the existing raised **+** create dock; My Dues (chase list) separate.
- **Allocation meter**: sticky "₹X left to allocate" bar; tap bill = allocate full; if
  remaining < bill → auto-allocates remaining as PART chip (zero typing part-payment);
  long-press → stepper sheet (−₹100+, Full/Half/Remaining chips) + amountInWords echo.
- **Pair card**: parts+labour of one order rendered as ONE selectable card ("2 bills ₹8,000").
- **Identical-amount group mode**: >3 same-amount candidates → compressed 2-line cards
  (name + vehicle reg), fuzzy-bold matching letters vs payer string, sticky filter accepting
  last-4-of-reg; alias hits pinned.
- Primary button names the customer ("Match ₹8,000 → Patel Transport") = the confirm; no
  dialogs. Snackbar UNDO 10s; later undo via Done tab = formal reversal.
- Chip sheets for every disposition (advance/not-ours/skip/return reasons), admin-editable
  vocab; `+ Add note` collapsed; rely on Gboard mic for Gujarati speech-to-text.
- Payer string shown VERBATIM always (truncation is a data fact).
- UPI note row highlighted amber (highest-value signal), never a footnote.
- Offline: outbox + client UUID idempotency + single-writer conflict (loser gets red strip
  "Already matched by Ramesh 11:02"); `as of HH:MM` stamps; stale >15min amber banner;
  draft persistence per payment (resume after phone call). [CONFLICT w/ Lane 4 — see below]
- Soft claim chip "Ramesh viewing" in queue.
- Session: PIN re-auth mid-task, never full login; drafts survive re-auth.
- **Chase list: Call btn (tel:), WhatsApp btn (wa.me prefilled bilingual dunning message
  with bills+total), Promised chip sheet (Today/Tomorrow/Sat/date) + broken-promise ⚠ float.**
- Receipt form: Recent-6 customer chips, amount lakh-grouping + words echo, mode seg,
  attach-bills-now reuses the SAME allocation sheet, save & share receipt image via OS share.
- Desktop reserved for: import, review queue, set-aside resolution, exports, admin,
  post-day edits (deliberate "sit down" friction).
- Failure modes: fat-finger (words echo, threshold confirm), scroll fatigue (top-5 +
  show-all), adjacent-action misfires (dispositions in separate zone), interruption loss
  (IndexedDB drafts), glare (ink tokens), Gujarati sublabels on key actions.
- Implementation order: idempotent mutation API + outbox hook FIRST.

## LANE 3 — Controls/Fraud (DONE)
Convergent: accounts-only manual receipts; attach-only-from-imported-feed; TDS needs
approval + plausibility + quarterly 26AS recon; export batches sequence-numbered immutable
w/ control totals; maker-checker reversals; weekly exception page; monthly statements;
audit log w/ device+IP.
NOVEL — absorb:
- **"Not ours" must EXPORT to Busy as a payable to the sister unit** — it's still this
  entity's bank money; dropping it breaks BRS + audit completeness. (Stronger than our
  "own worklist section": specify payable treatment.)
- Two-step not-ours: proposer ≠ confirmer (GM or second AC confirms).
- **Cash discipline: physical pre-numbered receipt book leaf no. as MANDATORY field; daily
  cash tie-out portal-total vs deposit-slip photo, GM signs day-close; unbanked >1 banking
  day = red exception.**
- **Value-date vs entry-date gap report (>2 days needs reason)** = backdating detector.
- Cheque lifecycle pending→cleared/bounced; bounce AUTO-reopens bill.
- Release-without-payment = in-app GM approval only (never WhatsApp).
- Daily GM day-close page (6 lines, signed in-app); monthly not-ours register confirmed
  vs sister units; monthly statements to top-20 (lapping killer).
- Cash-share-of-collections trend per workshop per week (skimming detector).
- Bills-closed-in-SAP-without-receipt-in-N-days by SA (under-ringing detector).
- GST: service advances taxable on receipt (Sec 13(2)); unlinked receipts = advances needing
  receipt voucher 31(3)(d) monthly flag. MCA audit-trail rule: auditor will ask about the
  feeder's log immutability. Retention: GST 72mo, Cos Act 8y.
- Opening balances frozen 30 days after go-live; dual sign-off.
- No manual UPI entry EVER (vs our UTR-required manual bridge for parser outages —
  tension; resolve: manual UPI allowed ONLY in declared parser-outage mode, flagged,
  reconciled-by-UTR on recovery. Lane 4 supports this via linking).

## LANE 4 — Ops/Reliability (DONE)
Convergent: GH Actions nightly pg_dump (NOT the laptop), healthchecks dead-man on import
success ping + independent staleness checker, keepalive vs auto-pause, store-raw-first,
header fingerprint reject-don't-guess, batch atomicity + reverse-by-batch, UTR unique as
constraint, migration wrapper dump-verify-apply, printed runbook, monthly restore drill.
NOVEL — absorb:
- **`data_complete_through_date` per feed + `pending-feed` as a DISTINCT match verdict**
  (never "unmatched" inside the blind window; excluded from exception queues). Sharper
  than our staleness banner: the HORIZON rule.
- Degradation ladder: >3d stale = amount-fuzzy suppressed entirely; >7d = export needs
  explicit acknowledgment tap (audited). Catch-up invariants: manual matches never
  overwritten; matcher re-run = no-op.
- **Incremental audit-event export every few hours** (RPO hours for hand-entered data —
  the only non-re-derivable data); age-encrypted dumps to private GH repo + R2; monthly
  restore drill with checksum script (rowcounts + SUM(amount) + max event id), timed.
- **Parser column mapping as DB DATA (parser_configs table) → fixable from a phone via
  SQL editor while traveling.** Golden-file CI fixtures per format version.
- Manual-bridge link-on-UTR (import links to manual entry, no double count) ✓ matches ours.
- **Vercel Hobby ToS prohibits commercial use** — suspension risk for the whole portal;
  pre-decide Cloudflare Pages or Vercel Pro. (Portal-wide finding, not just this tool!)
- Supabase Pro trigger pre-committed ("at go-live+90d or when accounts onboards": $25/mo);
  total worst-case spend ~$45/mo — write it down now.
- **Offline = READ-ONLY + hard-block writes; NO offline outbox in v1** (sync-conflict
  classes a solo maintainer can't afford; 20 receipts/day = walk to signal). At most one
  local draft marked NOT SUBMITTED.
  ⚠ CONFLICT with Lane 2's outbox. RESOLUTION for plan: online-required writes + client
  idempotency UUID (mandatory) + local draft persistence; background outbox deferred to
  a later phase with pilot evidence. UX keeps stamps/banners/conflict strips.
- raw_rows retention: >12mo archived to Storage then reversed out. Server-generated
  exports once daily (egress). RPO/RTO declared in writing.

## LANE 5 — Adoption/People (DONE)
Convergent: named uploader + dated handover; per-actor pilot metrics; kill criterion;
peer training; WhatsApp support; no-blame norms; parallel-run bounded; service carrot needed.
NOVEL — absorb:
- **The real competitor is a 10-second WhatsApp voice note + clerk's memory** — every flow
  must beat THAT bar (3 taps, <15s, no typing, pre-filtered to my-workshop-today, PWA
  pinned, session persists weeks). Not Excel.
- **"Not sure / not mine" as a first-class RESPECTABLE action** routed to accounts —
  the escape hatch that prevents both cherry-picking AND force-matching. Healthy band:
  5–20% not-sure rate (0% = gaming, >30% = broken UX/data). ADD as pilot metric.
- **90-day no-blame covenant, said aloud once by owner, never violated** (one scolding
  citing the log = gaming forever, one-way door). First visible mistake publicly thanked.
  NO per-person counts displayed to power for 90 days (log yes, display no — team/workshop
  totals only). [Tension w/ Lane 3's per-clerk fraud reports → resolve: fraud queries run
  weekly for GM/owner eyes ONLY, never cited in front of staff in first 90d.]
- **Pilot = ONE workshop only** (not both); workshop-1 advisor becomes workshop-2 trainer.
  Parallel Excel killed by PUBLIC date at end of week 2 (open-ended parallel = portal
  never becomes the record).
- Owner-done matches EXCLUDED from success metrics (backstopping = success theater);
  trip-wire: owner genuinely unreachable 3 working days in week 4 — if the cycle survives,
  handover happened. Remove upload permission from owner's login after day 10.
- Success #s: ≥80% UPI matched <24h by staff; median <60s; export into Busy with ZERO
  rework every day of weeks 3–4; shadow Excel dead by wk2; not-sure 5–20%.
- Feedback: GM (never owner) runs 1:1s; displacement questions ("what would confuse a
  new joinee", "which step would you skip if nobody watched"); watch time-of-day of
  matches (all-at-6pm = chore batching); anonymous 3-question poll wk2 + wk4.
- Training: senior accounts clerk trains IN GUJARATI on their own phones with that day's
  real payments; each advisor does one deliberate not-sure + one wrong-match-then-undo
  in the session; laminated A5 Gujarati-captioned cheat card; bilingual labels on the 5
  core actions ("match this payment", never "reconcile").
- UI freeze during pilot; changes weekly batched with screenshot note in the group.
- Personal-phone grievances anticipated: PWA no-install, wifi/data token, GM states it's
  part of the role, plain statement of what management can/can't see.

## LANE 7 — GST/Statutory (DONE) — mostly NEW obligations
- **Income-tax Act 2025 in force from 1 Apr 2026** — never hard-code "269ST/194C"; write
  "or corresponding provision of IT Act 2025". Rates/sections in dated CONFIG tables.
- **Service advances taxable on receipt (s.13(2)); goods advances exempt (Notif 66/2017)**
  but Rule 50 RECEIPT VOUCHER required for EVERY advance (goods too). Indeterminate
  advance → 18% deemed. Monthly report: unadjusted service advances → GSTR-1 Table 11A;
  advances adjusted vs earlier-month tax → 11B (needs advance→invoice linkage!); same-month
  netted out. GSTR-3B hard-locked to GSTR-1 since Jul 2025 — get it right first time.
- Sept 2025 rate cut (28%→18% parts/CV): credit notes take ORIGINAL invoice rate; s.14
  transitional for advances straddling changes. Store rate-at-receipt.
- **TDS closure must capture: TAN (mandatory), section (194C/194J/**194Q** 0.1% goods >₹50L),
  FY-of-expected-credit (Rule 37BA), gross base incl/excl GST** → distinct "TDS receivable
  pending 26AS" bucket per deductor; quarterly TAN×section×quarter export. 206C(1H) TCS
  omitted from 1 Apr 2025.
- **Returns/credit notes: tool may TRACK, never ISSUE** — receivable reduction BLOCKED until
  SAP CN no./date/IRN captured; CN rate from original invoice; B2B CNs must be e-invoiced;
  30-day IRP window (AATO≥₹10cr); IMS recipient-acceptance now conditions supplier tax
  reduction — record CN status.
- **269ST hard block**: cash ≥₹2L per payer-day AND per transaction/invoice (all 3 limbs,
  aggregated incl. instalments) — 100% penalty ON DEALERSHIP. No override.
- **Companies (Accounts) Rules Rule 3: daily backup on servers physically IN INDIA** +
  annual ROC intimation of cloud provider. (GH private repo is not India-assured —
  add an India-region object-store copy.) Retention 8y.
- No-write-off policy BLOCKS bad-debt deduction (write-off must occur in books i.e. Busy)
  — periodic management-approved write-off routine in Busy, mirrored back. [Feeds owner
  decision: residues eventually need a Busy-side write-off path.]
- Auditor asks of a feeder system: daily file totals ack'd, monthly signed customer-wise
  recon, serial continuity, audit-trail DB-level immutability, signed opening tie-out.
- Must-match-always list: customer-wise balances, advance credit balances (liability not
  negative receivable), daily cash/mode totals, TDS receivable, CN values, opening TB.

## LANE 8 — Matching algorithm (DONE)
Convergent: tiered/lexicographic signals; note-number top; learned payer capped below
deterministic; explain-one-line; refuse-to-rank; order-pair first-class; customer-scoped
subset only; park advances and re-run on invoice import.
NOVEL — absorb:
- Weight architecture: T1 note=100 / unique-amount=90 · T2 learned≥2-confirms=50 max ·
  T3 single-confirm=20, name=0–25 · T4 date=0–10. Piles of weak signals can't beat T1.
  ε=15 gap → refuse to rank (unordered pool + banner).
- **Name mismatch NEVER subtracts** (drivers pay for firms). Firm-marker detection: person
  payer vs firm customer = expected zero name score, bridge is learned assoc only.
- Indic phonetic canonicalization (~20 regex rules: V↔W, SH→S, BH→B, EE→I, terminal-H drop,
  doubled consonants) NOT Soundex; asymmetric token match (payer⊂customer), prefix≥4
  (truncation), initial expansion; IDF from own customer master (KUMAR/BHAI≈noise).
- Poisoning defense: single confirm = whisper (T3); contradiction_count demotes; 3+
  customers on one payer key = shared_name flag → permanent T4; reversal emits negative
  event (decrement/delete). Confirm only counts after export+14d (ours) — keep both.
- **Honest per-class top-3 contract**: workshop cash 80–95%; counter fixed-price 30–65%
  (refuse-to-rank territory); advances ~0% at receipt BY DESIGN (park+defer); alien money
  success = empty list ≥80%. Blended ~55% cold → 70–75% mature. Log position-of-confirmed,
  class, winning tier, clerk-seconds, reversals-within-30d.
- **Mutual elimination batch screen** for the day's ₹1,930 pool (bipartite greedy; confident
  first, pool shrinks) — one screen, not 17 shortlists. + order-of-day rank correlation
  worth 3 pts.
- **PAISE-TAGGING process change: bill #07 collects ₹1,930.07** — deletes the fixed-price
  degeneracy entirely; works with collect-request flow; fallback ask-note-discipline.
  [ADD to process-levers list for owner.]
- Pre-committed simplification criteria: deterministic ≥85% → delete fuzzy tier; learned
  wins <5% after 8wk → drop store; refuse-rate >30% on counter class → replace ranking
  with set-reconciliation screen. Measure manual baseline for 1 wk BEFORE launch.

## LANE 10 — Security/AuthZ (DONE; read real EF/RLS/session code)
Convergent: EF chokepoint loadX() on EVERY arm; three-way entity checks both ids; RPCs
service-role-only; HMAC+timestamp+dual-secret; held-for-review staging; audit every batch.
NOVEL — absorb:
- **NO write RLS policies for `authenticated` on money tables — ADMIN INCLUDED** (existing
  admin_write FOR ALL pattern = unaudited PostgREST write path bypassing EF+audit). Money
  writes ONLY via service-role.
- **Step-up password re-auth VERIFIED IN THE EF** for: reverse, void, limit-edit,
  group-edit, export. NOT for allocate/classify (adoption). Device binding NOT worth it.
- **Session policy: no remember-me for recon-write roles (sessionStorage only); ≤12h
  absolute / 1–2h inactivity;** runbook: lost phone → is_active=false + admin global
  signOut. [Tension with Lane 2/5 "session persists weeks for adoption" → resolve:
  service-exec matching role gets longer session BUT no remember-me + PIN step-up on
  nothing (they only allocate); accounts/GM get the strict policy since they hold the
  dangerous verbs.]
- **PII: PostgREST has no column RLS → staff read via a matching VIEW (no GSTIN/PAN) or
  PII child table with stricter policy.** PAN masked + tap-to-reveal audited. "UI doesn't
  show it" is not a control.
- Audit log: BEFORE UPDATE/DELETE trigger raising exception (binds even service role);
  **hash-chaining rows + daily off-site chain-digest** (via the export job); dashboard =
  unaudited superuser path → limit org members + 2FA on Supabase accounts.
- Ingest: HMAC over RAW body; nonce replay table; no read-back ever; batch idempotency
  via document numbers as belt-and-braces. IP allowlist NOT available on free tier —
  don't fake it as a control.
- Exports: server-generated on demand; private bucket ≤5-min signed URLs; step-up; row
  count + file hash audited; SOP: never WhatsApp/email; watermark screens with user name
  (screenshot deterrence); screenshots unblockable on web — minimize what's on screen.

## LANE 12 — Devil's advocate (DONE) — the scope challenge
- Labor math: ~2.5 clerk-hr/day ≈ ₹84k/yr; honest savings ceiling ₹50–60k/yr. **Value is
  fraud-control/attribution-at-source, not labor.** Build never pays back in labor alone.
- **WhatsApp pilot (2 weeks, ₹0): counter posts "₹1930 = bill 7458" at payment moment.**
  Kills 70–80% of matching for free AND is the classic anti-lapping control AND tests the
  mobile-capture premise before any code. Measure: % posted <5min, week1 vs week2 decay,
  day-end match time. If staff won't type that into WhatsApp, they won't use a custom app.
  [STRONGEST single recommendation of the whole sweep — cheap, decisive, immediate.]
- Challenges mobile-first: reconciliation gravitates to one desk person BY DESIGN (one
  throat to choke); what's genuinely mobile is CAPTURE at payment time. [Half-agrees with
  Lane 1's claimed-phase idea.]
- Duplication argument: Busy already has bill-wise outstanding/ageing/credit limits at
  voucher entry; portal ageing view re-implements Busy's flagship report. Counter: GM's
  phone view + groups-across-ledgers + pre-Busy-entry state. Partial merit — keep
  Outstanding lean, don't gold-plate.
- Scope-creep flags: customer master/limits (SAP bills anyway — warn can't block), fraud
  reports on day one (no data yet), TDS automation (handful/month). Counter-position:
  owner explicitly required master+limits; keep but A2, keep TDS minimal.
- Solo-maintainer conditions (X/Y/Z): documented manual bypass procedure (1 page);
  Supabase Pro + tested restore; a trained second operator (CA article clerk). Also names:
  owner-dev with god-mode building the fraud-control system is itself an auditor-flagged
  control weakness → external audit-log anchor (Lane 10 hash digest) matters.
- 5 conditions for big build: WhatsApp pilot >70% · day-sheet survives 4wk of real Busy
  round-trips first · zero-MDR pre-attribution tried/failed · X/Y/Z funded · Busy stays
  sole record w/ duplicated modules deferred 2 quarters.

## LANE 9 — Busy integration (DONE) — closes open item 2 substantially
- **The path: Busy's native "Import Vouchers From Excel"** (Standard/Enterprise editions;
  Basic lacks it). Menu: Administration → Utilities → Data Export/Import → Import Vouchers
  From Excel. **There is NO Busy voucher XML** (Tally thinking — strike from plan) and NO
  bank-statement→voucher path. Get THEIR release's sample format file from the import
  screen; don't hard-code formats found online.
- **Export needs TWO voucher types from day one: Receipt AND Journal.** TDS closure =
  JV Dr "TDS Receivable (FY)" / Cr customer with Against Ref (NOT a receipt — no money
  moved). Reversal = JV Dr customer / Cr original bank ledger + **New Ref line with the
  SAME reference number to re-open the invoice** (else Busy shows paid while balance
  disagrees). Never negative receipts. Same-day errors netted out of the file.
- **Terminology fix: bill references = "Bill-by-Bill Balancing" (New Ref/Against Ref/
  On Account/Advance). "Bill Sundry" is invoice-footer charges — WRONG word.**
- Mapping: import matches on EXACT ledger Name (alias support untested per release);
  convention = put SAP customer code in Busy ledger's ALIAS field; seed by exporting
  List of Accounts under Sundry Debtors; **auto-create-master OFF always** (silent
  duplicate ledgers = worst failure). Unmapped → exceptions sheet (keyed-entry rows).
- Bill-by-bill per-ledger flag: if ON and refs = SAP invoice numbers → push Against Ref
  and Busy's bill-wise outstanding equals the portal's matching (the whole point). Carry
  ref columns from day one; inert if flag off; flipping the flag lights them up.
- Advances → Receipt with On Account (default) or Advance ref ADV-<portal-id>.
- Fallback worklist column order mirrors the Receipt screen exactly: Series | Date |
  Customer ledger | Amount | Adj type | Ref(s)+split | Bank/Cash ledger | Cheque/UTR |
  Narration. ~25–90 sec/receipt keyed.
- **5 verbatim accountant questions provided** (title bar/edition screenshot; bill-by-bill
  + what refs contain; voucher series + exact bank/cash/UPI-settlement ledger names; TDS
  closure practice + ledger name; error-correction practice + audit-trail on?) + homework:
  export Sundry Debtors account list.

## LANE 11 — Pilot/Rollout (DONE)
Convergent: one-site-first; champions; parallel-run bounded; per-actor metrics; kill
thresholds pre-written; Gujarati videos/cheat cards; WhatsApp support group; owner-handover
as graduation criterion.
NOVEL — absorb:
- **Seeding order D-7→D-1**: customer master + SAP↔Busy name recon FIRST (D-7, the #1
  silent killer) → groups+limits (owner+GM one sitting, D-6) → opening balances signed
  vs Busy TB (D-5) → **14 days back-data PRE-MATCHED during dry-run** (≤20 open items at
  D0 — empty screens read as "toy", 300 unmatched reads as "already behind") → per-phone
  login test on BOTH networks (D-3) → **Busy export dry-run into a TEST COMPANY copy**
  (D-2; Busy supports company copy = the closest thing to staging) → freeze D-1 noon.
- **Three-phase cutover with numeric gates**: P1 wk1 shadow (export→test company only) ·
  P2 wk2-3 live Busy + daily recon · P3 double-keying STOPS after **10 consecutive ₹0/
  0-line export days** (the non-negotiable gate), hard cap D+28.
- Kill lines ON THE WALL CHART from day 1: same-day entry <60% for 5 days · unexplained
  ₹>1,000 surviving 48h · same-root-cause live-Busy error twice · 3+ down-days per 2wk.
  ("Staff reluctant to criticize will happily point at a pre-agreed number.")
- Week-1 doctrine: **completeness not timeliness** ("the only week-1 sin is a receipt
  never entered"); volume-not-accuracy days 1-2; expect 70-80% honesty and SAY so.
- **17:15 five-minute stand-up**: 3 numbers on a wall chart (entered/matched/carried),
  per-SITE never per-person; owner speaks LAST and only to say what he'll fix.
- Feedback tech: bug bounty (₹100 recharge per new bug, framed by owner as "finding bugs
  helps me"); tool gets a staff-chosen (mocking) NAME so people can abuse "Hisaab-babu"
  not "sir's software"; mandatory Friday "one thing to REMOVE" round; owner's pinned
  "You said → I changed" fix-log (≥2 shipped in wk1).
- Advisors' carrot surfaced DAY 1: customer-outstanding lookup on their phone (kills the
  "call accounts to ask what Patel owes" chore). Clerk net-keystrokes ~neutral even
  during double-keying (tool's collection summary replaces a manual Excel artifact).
- Rollback playbook: Busy authoritative through P1-P2 so books need ≤3 days patching;
  keep EVERYTHING (mapping table is permanently valuable); owner names the retreat as
  "the tool wasn't ready — you were"; pay bounties immediately; retry only with date +
  top-3 fixed + same gates; ≥4wk cool-off, never month-end/festival.
- End-of-double-keying = sweets + thank-you (family firms run on gestures).

## LANE 6 — Ledger data model (DONE) — the strongest technical artifact of the sweep
Convergent: append-only + contra rows; caches exist SO THAT CHECKs fire; deterministic
lock order; three idempotency layers; gap-free serials via counter-row lock (NOT sequences
— sequences gap on rollback); export UNIQUE(doc_kind,doc_id) = exported-once-forever;
match_id as allocation idempotency key; derived status never stored.
NOVEL — absorb:
- **Unified document model: debit docs (invoices, dr-opening) vs credit docs (receipts,
  credit notes, TDS entries, cr-opening) — allocations classify, never change outstanding.**
  Identity A≡B (balance form vs classification form) per group = the corruption detector;
  nightly v_integrity_violations view must be empty. Cleaner than our group_id-on-
  allocation approach — opening balances become ordinary documents. ADOPT this shape.
- **Temporal group membership** (valid_from/valid_to + EXCLUDE gist: one group per customer
  per instant, DB-enforced vs concurrent managers) — as-of reporting falls out free;
  merge/split semantics stop being special cases. ADOPT.
- "No write-offs" lives in the CLOSED kind CHECK list, not in policy docs.
- not_ours as append-only EVENTS (mark/unmark, each exportable as its own journal entry);
  CHECK: not-ours ⇒ allocated=0. Post-export invoice cancellation = auto credit_note
  kind='sap_cancellation' fully allocated (contra travels; flag stays false).
- Full reversals ONLY (partial correction = full reverse + fresh allocation) — simpler
  arithmetic + simpler contra export. TDS entry + its allocation created atomically
  (never floating). Cache columns guarded by set_config internal flag.
- FOR SHARE on both customers' membership rows during allocate (vs concurrent regroup).
- pgTAP: 10 corruption scenarios enumerated (double-spend w/ precheck disabled, overlap
  re-upload, retried match_id, serial rollback, double/partial reversal, cancel-vs-allocate
  race, cache-drift detection, exactly-once export under concurrency, post-export reversal
  round-trip nets zero, membership-move identity).

---
## Cross-lane conflicts — RESOLUTIONS for final plan
1. Offline writes: Lane 2 outbox vs Lane 4 hard-block → **hard-block writes offline +
   mandatory client idempotency UUID + local draft persistence**; outbox deferred.
2. Manual UPI entry: Lane 3 "never" vs parser-outage bridge → **outage-mode only**, flagged,
   UTR/txn-id required, auto-linked on recovery (already_present_manual).
3. TDS: owner said 5% cap no TAN; GST lane says TAN mandatory for 26AS recon → re-present
   consequence ONCE (denied credit at filing) — owner decides final.
4. Two-phase claimed/confirmed + WhatsApp experiment → owner decision (capture-at-counter
   strategy). Options: WhatsApp 2-wk experiment now / claim quick-add in A2 / neither.
5. Outstanding: ADOPT Lane 6 document model (opening balances as documents; A≡B identity
   + integrity view) — supersedes v3's group_id-on-allocation for on_account.
6. Sessions: accounts/GM strict (no remember-me + step-up); service matching role longer
   session, no step-up on allocate (adoption).
7. Paise-tagging (₹1,930.07 = bill 7) → owner decision (counter process change).
8. Cash controls bundle (physical book leaf no. + daily tie-out + GM day-close sign) →
   owner decision (staff process).
9. India-located backup copy (Companies Rule 3) + 8y retention + ROC intimation → adopt.
10. Busy: adopt Lane 9 wholesale (Excel voucher import; Receipt+Journal; JV reversals w/
   New Ref re-open; alias=SAP-code convention; test company for pilot; 5 questions).
11. Vercel Hobby commercial-ToS → surface to owner as portal-wide note.
12. Devil's-advocate gate: day-sheet-first already effectively adopted via staged A1
   (search-and-click = the day-sheet inside the schema); WhatsApp experiment covers
   condition 1; Busy spike front-loaded covers condition 2.
