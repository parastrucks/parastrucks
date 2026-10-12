# Service Payments — red team 4: end-to-end UI/UX from a layman's seat

**Status: IN PROGRESS (2026-10-12).** Lanes running; consolidation not started. See the resume
log at the end.

## Why this round

Rounds 1–3 (`service-payments-plan.md`, `service-payments-redteam3-cleanroom.md`) attacked the
design: money logic, security, workflow, adoption. The screens have since been built and walked
through once in a browser (2026-10-10), which found nine screen defects that seventy green checks
had missed. This round attacks only what a mechanic, a service advisor or an accounts clerk
**sees**, with no training, on the phone they actually carry. Owner's brief: *"approach it from a
layman's perspective — this will mostly be used by mechanics and ground staff."*

Decisions taken before the run (owner, 2026-10-12): static renders in the cloud, no live app
(interaction is out of scope and listed for a later live run) · layman lanes see screenshots and
on-screen text only, one expert lane reads code · all screens in scope, including the entry path
and the Import tab · language: **simpler English, never another language** · output = ranked
findings, no fixes · plan delivered in chat, record kept here.

## Method

**Rig** — `scripts/payments/redteam4-rig/` (`render.mjs`, `shoot.mjs`, `README.md`). Renders 46
states to static HTML inside a replica of the app shell (top bar, bottom nav, sidebar on desktop)
and screenshots each at 360×640, 390×844, 412×915, 667×375 landscape and 1280×800, plus
scroll-step shots at 80% of the viewport height so a reviewer sees what a thumb sees. Also dumps
each state's visible text in reading order. `MatchScreen` and `SearchPanel` are the **real
components**; the page head, tabs, empty states, Import preview/done, nav, Create sheet and
drawer are **hand-copied replicas** (same classes and strings; marked in `index.json`).

**Rig limits, stated:** static markup only — no taps, toasts, timing, focus or scroll feel. The
"selected" states patch the real render's class the way the component would emit it. The
Import screens are replicas because `ImportPanel` keeps its stage in state. The logo image
sometimes failed to paint in scrolled shots (screenshot artifact, lanes were told to ignore it).
The rig needed its own `node_modules` because the repo's `xlsx` tarball host is blocked from the
cloud container (`npm ci` 403s on `cdn.sheetjs.com`).

**Lanes** — seven agents, each cold-started with `briefs/common.md` + its own brief
(`scripts/payments/redteam4-rig/briefs/`), run in parallel, no cross-talk until consolidation:

| Lane | Persona | Viewport | Sees |
|---|---|---|---|
| L1 | Floor mechanic, 10th pass, Gujarati-first, cracked 5.5" phone | 360 | screenshots + text |
| L2 | Service advisor at the counter, 20 s per payment | 390, landscape | screenshots + text |
| L3 | Accounts clerk, 52, Excel and Busy, counts paise | desktop + 390 | screenshots + text |
| L4 | First day, no training, asks what every word means | 412 | screenshots + text |
| L5 | Plain-English editor for 8th-grade Indian-English readers | text dumps + 390 | text + screenshots |
| L6 | Supervisor once blamed for a wrong entry: "can I undo?" | 390, 360 | screenshots + text |
| X1 | Mobile web engineer: measurements only | all five | code + CSS + screenshots |

Layman lanes had a banned-word list (affordance, hierarchy, contrast ratio, component, …) and a
list of owner decisions they may not re-litigate. Every finding must cite a state ID and a
screenshot. Severity: **Blocks** (cannot finish, or wrong money action unknowingly) ·
**Confuses** (stops, would ask or guess) · **Slows** · **Polish**. Every suggested change must
say what it pushes further down the page.

## States rendered

E1a–c entry (home bottom nav · Create sheet · drawer) · E2 page head with tabs · E3 service
view with "Not a service payment" opened · E4 denied · E5 loading · M1/M1s one clear bill ·
M2 part payment · M3 no bill · M4 two equal bills · M5 "2 bills" job · M6 five identical ranked
· M7 four identical unranked · M8 stale banner · M9a/b wait question · M10 waiting view ·
M11 returned payment · M12a–d empty states · M13 not-service reasons · M14a saving · M14b
load error · M15 no name · M16 selected with reasons · M17 long names · M18 partly matched ·
S1–S5 search · I0–I9 import.

## Findings

*(consolidation pending)*

## Needs a live run

*(pending)*

## Raised, out of scope (frozen decisions)

*(pending)*

## Resume log

- 2026-10-12 — Plan agreed in chat (seven questions answered by the owner). Local branch
  `redteam4` cut from `origin/claude/payments-reconciliation-tool-6eaab4` (`12450a3`).
  GitHub refused pushes from this session (403, app access); all commits are local until the
  owner reconnects — **a fresh session must start from this branch's latest local commit or
  re-run the rig from the committed scripts.**
- 2026-10-12 — Rig built and verified by eye (nav and confirm bar present at phone widths,
  landscape shows the squeeze); 46 states, 393 screenshots in the session scratchpad
  (`scratchpad/rig/out/`, not committed). Scroll steps needed a 300 ms settle.
- 2026-10-12 — Seven lanes launched in parallel. Lane outputs land in
  `scratchpad/findings/<lane>.md`. **Next:** consolidate per the method (dedupe · verify against
  screenshot · strike frozen decisions · rank · "pushes down the page" · write Findings here),
  then CLAUDE.md state bullet + PORTAL_HISTORY entry, commit, and push once GitHub is back.
