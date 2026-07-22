// supabase/functions/_shared/keys.ts
//
// Key resolution for the legacy-key retirement.
//
// WHY THIS EXISTS
// A live prod `service_role` JWT leaked into git history. It only stops working
// when the project's LEGACY keys are deactivated — and legacy `anon` +
// `service_role` deactivate TOGETHER, so every client must move to the new
// publishable/secret keys first.
//
// Supabase injects the new keys as JSON dictionaries keyed by name:
//   SUPABASE_SECRET_KEYS      -> {"default":"sb_secret_…"}
//   SUPABASE_PUBLISHABLE_KEYS -> {"default":"sb_publishable_…"}
// The legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY still exist but are
// flagged DEPRECATED in the dashboard and go DEAD on deactivation.
//
// CUTOVER IS A SECRET FLIP, NOT A DEPLOY
//   USE_NEW_API_KEYS unset/anything -> legacy keys  (deploying this is a no-op)
//   USE_NEW_API_KEYS = "true"       -> new keys
//
// ⚠️ ROLLBACK IS NOT INSTANT (corrected 2026-07-21 by red-team; the earlier
// claim in this file was wrong). `Deno.env` is snapshotted when an isolate
// BOOTS. Changing the secret does not restart live isolates — they must idle
// out. So a flip reaches production gradually, and a rollback does too. To make
// either deterministic you must REDEPLOY the functions. Practical consequences:
//   - Do not smoke-test within seconds of a flip: a warm isolate can still be
//     on the old key and hand you a false green.
//   - Rollback procedure = unset the flag AND redeploy all 9 functions.
//   - The genuinely instant lever is re-enabling the legacy keys in the
//     dashboard, which restores every client at once. Use that first in an
//     incident, then debug.
//
// FAIL LOUD, NOT QUIET (red-team 2026-07-21)
// This file previously fell back to the legacy key whenever the new-key bag was
// missing or malformed. That inverted from a safety net into a trap: after
// deactivation the legacy vars still EXIST but their values are DEAD, so a
// typo'd flag or an absent bag would silently select a dead key. Worse, it made
// pre-cutover verification meaningless — every test would pass green because
// legacy was quietly still in use, right up until deactivation broke everything
// at once. Now: if the flag is ON and the bag is unusable we THROW.
// NOTE: in most functions this throw lands outside the request try/catch, so the
// browser may see an opaque 500/CORS error — but the EF log carries the explicit
// reason below, which is what matters while running a cutover.
//
// HEADER GOTCHA — new keys must travel on `apikey` ONLY. Sent as
// `Authorization: Bearer` the gateway parses them as a JWT and rejects them.
// supabase-js does NOT special-case the `sb_` prefix (verified in 2.100.1
// source: it sets `Authorization: Bearer <key>` whenever there is no user
// session). Empirically the gateway TOLERATES this — the staging rehearsal ran
// with legacy keys fully deactivated and login, reads and writes all worked —
// but any HAND-ROLLED fetch must still send `apikey` only. See
// `_shared/auditLog.ts` (adminLogoutUser) for the one place that mattered.

const KEY_NAME = "default"

/** Read one named key out of an injected JSON dictionary. Null if absent/malformed. */
function fromBag(bagVar: string): string | null {
  const raw = Deno.env.get(bagVar)
  if (!raw) return null
  try {
    const key = JSON.parse(raw)?.[KEY_NAME]
    return typeof key === "string" && key.length > 0 ? key : null
  } catch {
    return null
  }
}

function useNewKeys(): boolean {
  return Deno.env.get("USE_NEW_API_KEYS") === "true"
}

// One-shot boot diagnostic. Runs once per isolate; logs no secret material —
// only the flag value and whether each bag is present. During a cutover this is
// the single fastest way to tell which key system an isolate actually chose,
// which is exactly what a green smoke test cannot tell you.
{
  const flag = Deno.env.get("USE_NEW_API_KEYS") ?? "(unset)"
  const secretBag = !!Deno.env.get("SUPABASE_SECRET_KEYS")
  const pubBag = !!Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  console.log(
    `keys.ts boot: USE_NEW_API_KEYS=${flag} secretBag=${secretBag} ` +
      `publishableBag=${pubBag} -> using ${flag === "true" ? "NEW" : "LEGACY"} keys`,
  )
  // Split-brain guard: one bag usable and the other not would give us e.g.
  // secret=new + publishable=dead-legacy, which surfaces to users as
  // "Invalid token" on every request and reads like an expired session.
  if (flag === "true" && secretBag !== pubBag) {
    console.error(
      `keys.ts CONFIG ERROR: inconsistent new-key bags ` +
        `(secretBag=${secretBag}, publishableBag=${pubBag}). Expect partial failure.`,
    )
  }
}

function resolve(bagVar: string, legacyVar: string, label: string): string {
  if (useNewKeys()) {
    const k = fromBag(bagVar)
    if (k) return k
    // Fail loud — see "FAIL LOUD, NOT QUIET" above. Falling back here would
    // select a key that is dead post-deactivation, with no diagnostic.
    throw new Error(
      `keys.ts: USE_NEW_API_KEYS=true but ${bagVar} has no usable "${KEY_NAME}" ` +
        `${label} key (missing or malformed JSON). Refusing to fall back to the ` +
        `deprecated ${legacyVar}, which is dead once legacy keys are deactivated.`,
    )
  }
  const legacy = Deno.env.get(legacyVar)
  if (!legacy) {
    throw new Error(
      `keys.ts: ${legacyVar} is not set and USE_NEW_API_KEYS is not "true". ` +
        `No ${label} key available.`,
    )
  }
  return legacy
}

/**
 * Privileged key — bypasses RLS. Was the legacy `service_role` JWT.
 */
export function secretKey(): string {
  return resolve("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", "secret")
}

/**
 * Low-privilege key — RLS still applies. Was the legacy `anon` JWT.
 * Used to build user-scoped clients, where the caller's own JWT is supplied
 * separately on the Authorization header.
 */
export function publishableKey(): string {
  return resolve("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY", "publishable")
}
