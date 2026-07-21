// ============================================================================
// erp-sso — SSO Option C, PORTAL-SIDE Edge Function.
// DEPLOYS TO THE PORTAL PROJECT (mmmxvjaavdtwlpcnjgzy), NOT the ERP project.
// (Staged here in the ERP repo for review; see ../README.md for deploy steps.)
//
// Flow: an authenticated portal user clicks the "HD Hyundai Service ERP" card.
// The card calls this EF with their portal session JWT. We:
//   1. validate the portal session (getUser) — the caller must be signed in,
//   2. take the email FROM THE VALIDATED SESSION (never from the request body,
//      so nobody can mint a token for another person),
//   3. mint a single-use magic-link token against the ERP project using the
//      ERP service-role key (a secret on THIS project),
//   4. return the fixed ERP /sso URL with the token in the fragment.
// The browser then navigates there; erp.parastrucks.in/sso runs verifyOtp.
//
// Deploy with verify_jwt: false (we validate the caller ourselves), same as the
// other portal EFs. Matches the Phase 9 CORS/getUser pattern.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.100.1"
import { publishableKey } from "../_shared/keys.ts"
import { corsHeaders, preflight, jsonResponse } from "../_shared/cors.ts"

const ERP_SSO_URL = "https://erp.parastrucks.in/sso"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405)

  try {
    const portalUrl  = Deno.env.get("SUPABASE_URL")!
    const portalAnon = publishableKey()
    const erpUrl     = Deno.env.get("ERP_SUPABASE_URL")!
    const erpService = Deno.env.get("ERP_SERVICE_ROLE_KEY")!

    // 1. validate the caller's portal session
    const authHeader = req.headers.get("Authorization") ?? ""
    const token = authHeader.replace(/^Bearer\s+/i, "")
    if (!token) return jsonResponse(req, { error: "unauthenticated" }, 401)

    const portal = createClient(portalUrl, portalAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userErr } = await portal.auth.getUser(token)
    if (userErr || !userData?.user?.email) {
      return jsonResponse(req, { error: "unauthenticated" }, 401)
    }
    const email = userData.user.email

    // 2. mint a single-use magic-link token against the ERP project
    const erp = createClient(erpUrl, erpService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    async function mint() {
      return await erp.auth.admin.generateLink({ type: "magiclink", email })
    }
    let { data: link, error: linkErr } = await mint()

    // JIT provisioning: if the user has no ERP account yet, run a one-user sync
    // (portal → ERP) and retry once. If they're out of HDH scope the sync is a
    // no-op and the retry still fails → genuine no_erp_access.
    if (linkErr || !link?.properties?.hashed_token) {
      try {
        await fetch(`${portalUrl}/functions/v1/sync-erp-users`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SYNC_SECRET")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        })
      } catch (e) { console.error("erp-sso JIT sync failed:", e) }
      ;({ data: link, error: linkErr } = await mint())
    }
    if (linkErr || !link?.properties?.hashed_token) {
      console.error("erp-sso generateLink failed:", linkErr?.message)
      return jsonResponse(req, { error: "no_erp_access" }, 403)
    }

    // 3. return the fixed ERP /sso URL with the token in the fragment
    const url = `${ERP_SSO_URL}#token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink`
    return jsonResponse(req, { url })
  } catch (e) {
    console.error("erp-sso error:", e)
    return jsonResponse(req, { error: "internal_error" }, 500)
  }
})
