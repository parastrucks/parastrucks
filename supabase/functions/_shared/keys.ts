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
// flagged DEPRECATED in the dashboard and die on deactivation.
//
// CUTOVER IS A SECRET FLIP, NOT A DEPLOY
// Deliberate: deploying this change is a NO-OP (still legacy), so the code
// rollout carries no cutover risk of its own. Switching key systems is then a
// single Edge Function secret:
//   USE_NEW_API_KEYS unset/anything -> legacy keys  (current behaviour)
//   USE_NEW_API_KEYS = "true"       -> new keys
// Flipping takes effect on the next cold start with no redeploy, and reverting
// is equally instant. That decoupling is the safety net for the prod cutover:
// if anything misbehaves, unset the flag rather than scrambling to redeploy.
//
// GOTCHA (Supabase docs): publishable/secret keys must travel on the `apikey`
// header ONLY. If one is also sent as `Authorization: Bearer …` the gateway
// tries to parse it as a JWT and rejects with `Invalid JWT`. supabase-js is
// expected to handle this via the key prefix; the staging rehearsal exists to
// prove it before prod is touched.

const KEY_NAME = "default"

/** Read one named key out of an injected JSON dictionary. Null if absent/malformed. */
function fromBag(bagVar: string): string | null {
  const raw = Deno.env.get(bagVar)
  if (!raw) return null
  try {
    const key = JSON.parse(raw)?.[KEY_NAME]
    return typeof key === "string" && key.length > 0 ? key : null
  } catch {
    return null // never let a malformed bag take the function down
  }
}

function useNewKeys(): boolean {
  return Deno.env.get("USE_NEW_API_KEYS") === "true"
}

/**
 * Privileged key — bypasses RLS. Was the legacy `service_role` JWT.
 * Falls back to legacy if the flag is off, or if the new-key bag is missing.
 */
export function secretKey(): string {
  if (useNewKeys()) {
    const k = fromBag("SUPABASE_SECRET_KEYS")
    if (k) return k
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
}

/**
 * Low-privilege key — RLS still applies. Was the legacy `anon` JWT.
 * Used to build user-scoped clients, where the caller's own JWT is supplied
 * separately on the Authorization header.
 */
export function publishableKey(): string {
  if (useNewKeys()) {
    const k = fromBag("SUPABASE_PUBLISHABLE_KEYS")
    if (k) return k
  }
  return Deno.env.get("SUPABASE_ANON_KEY")!
}
