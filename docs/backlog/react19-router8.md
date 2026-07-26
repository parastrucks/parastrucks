# Backlog — React 19 + react-router 8 upgrade

**Status:** TABLED (owner decision, 2026-07-26). Not scheduled.
**Supersedes:** the old one-line backlog item *"react-router 6.x → 7 for its 2 moderate advisories"*, which
was **wrong about the destination** — see below.

---

## TL;DR — do not attempt this as a dependency bump

The portal sits on `react-router-dom@6.22.3`. The intuitive fix for its two moderate advisories is
"upgrade to 7". **That makes CI red.** There is no small version of this change: the only advisory-clean
release requires a React major.

| Version | Advisories | `npm audit --audit-level=high` (the CI gate) |
|---|---|---|
| **6.22.3 — prod today** | 2 moderate | 🟢 **exit 0 — passes** |
| 7.18.1 — latest `react-router-dom` | 1 **HIGH** | 🔴 **fails** |
| React 19 + `react-router` 8.3.0 | none | 🟢 passes |

## Why the middle row is a trap

Three advisories are in play, and their ranges barely overlap:

| Advisory | Severity | Affected range | First fixed |
|---|---|---|---|
| GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in `<Link>`/`useNavigate` | moderate | `6.0.0 – 7.17.0` | 7.18.0 |
| GHSA-337j-9hxr-rhxg — `deserializeErrors` arbitrary constructor injection (SSR hydration) | moderate | `6.0.0 – 7.17.0` | 7.18.0 |
| **GHSA-qwww-vcr4-c8h2 — RSC-mode CSRF bypass** | **high** | **`7.12.0 – 8.2.0`** | **8.3.0** |

The third one had never been catalogued in our notes. Every `7.18.x` release is simultaneously *past* the
moderates and *inside* the high — so upgrading swaps 2 moderates that clear the gate for 1 high that
doesn't, re-breaking the `npm-audit` job that PR #84 (`71cfc5d`) had just repaired.

## What the clean path actually costs

`react-router@8.3.0` declares `peerDependencies: { react: ">=19.2.7", react-dom: ">=19.2.7" }` (verified
against the registry). The portal is on React **18.2**. So the real change is:

1. **React 18 → 19** — an app-wide major. Every dependency must be re-checked for React 19 support
   (supabase-js, react-hot-toast, jsPDF/html2canvas, pdfjs, xlsx, the TIV forecast tree).
2. **`react-router-dom` → `react-router`** — the DOM package is **retired**; its latest is 7.18.1 and v8
   publishes as `react-router` only. All **15** import sites change.
3. **Two router majors at once** (6 → 7 → 8), so every v7 future-flag default applies in one step.
4. A full regression pass over a portal ~36 employees use daily.

## Known behavioural changes to verify if this is ever done

Most v7/v8 breaking changes are **structurally inapplicable** — the app uses only the declarative
`<Routes>`/`<Route>` API with no `createBrowserRouter`, no loaders/actions/fetchers/`<Form>`. That rules out
`v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration` and
`v7_skipActionErrorRevalidation` outright. Two do need checking:

- **`v7_startTransition`** — router state updates get wrapped in `React.startTransition`. `App.jsx` uses
  `lazy()` + a route-level `<Suspense>` fallback. Under a transition React keeps the *previous* page on
  screen while the chunk loads instead of showing the fallback, so the navigation spinner effectively stops
  appearing. Cosmetic but user-visible on a slow connection — the click looks like it did nothing.
- **`v7_relativeSplatPath`** — affects relative links *inside* a splat route. `App.jsx:120` has
  `<Route path="*" element={<Navigate to="/" replace />} />`, whose target is absolute, so no impact today.
  Re-check if the catch-all ever grows children.

## Why it was tabled: none of the three advisories is reachable

Established by reading the call sites, not inferred from the advisory text:

1. **Open redirect** needs a navigation target an attacker can influence. There isn't one. All six
   `navigate()` / `<Navigate to=>` call sites take string literals (`/`, `/login`); every `<Link>` and
   `<NavLink>` target comes from the static `src/components/layout/navConfig.js`; there is no `?redirect=`,
   `returnTo` or `?next=` parameter anywhere; and `ProtectedRoute` reads `pathname` only to *check* access
   (`canAccess(pathname)`), never to navigate to it.
2. **`deserializeErrors`** is SSR-hydration only. The portal is a static SPA built by Vite and served by
   Vercel — there is no server render.
3. **RSC CSRF** requires RSC / data-router mode. Not used.

So the upgrade would buy no actual security, at the cost of a React major on a production app — while the
`npm-audit` gate stays green either way.

## Trigger to revisit

Any of these flips the calculus:

- The portal needs React 19 for its own reasons (a dependency drops React 18 support, or a React 19 feature
  is wanted) — then the router upgrade rides along instead of driving.
- A **reachable** react-router advisory appears — i.e. one that doesn't depend on SSR, RSC, or a
  user-controlled navigation target.
- The app gains a redirect parameter (`?next=`, `returnTo`, or a post-login "return to where you were"
  flow). **That single feature makes advisory #1 live** and would make the upgrade urgent. Anyone building
  that should read this file first.

## Verification performed 2026-07-26

- Installed `react-router-dom@^7.18.1` on a scratch tree → `npm audit` reported the high advisory. Reverted.
- After revert: `package.json` + `package-lock.json` **byte-identical to `origin/portal`**
  (`git diff --stat origin/portal` empty), `npm audit --audit-level=high` **exit 0**, `npm run build` green.
- No application source file was modified at any point.
