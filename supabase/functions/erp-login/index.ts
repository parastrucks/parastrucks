// ============================================================================
// erp-login — Phase 17d. PORTAL-SIDE Edge Function.
// DEPLOYS TO THE PORTAL PROJECT (mmmxvjaavdtwlpcnjgzy), NOT the ERP project.
//
// Lets someone sign in at erp.parastrucks.in by typing their TEAM PORTAL
// password. Until now the only way in for a synced user was the portal
// dashboard's SSO card: the ERP password they were created with is machine-
// generated and nobody knows it (sync-erp-users calls createUser with no
// password). Measured 2026-08-04: 14 of 22 provisioned staff had never signed
// in even once.
//
// The chain — every step ordered so that nothing distinguishable is said until
// a correct portal password has been supplied:
//   1. lockout check (shared with the portal's own login, email-keyed)
//   2. Turnstile verified SERVER-SIDE
//   3. portal signInWithPassword — the session is discarded immediately, it is
//      only ever used to answer "is this the right password"
//   4. portal users.is_active
//   5. ERP profile: exists + active (JIT-provision once and re-check if not)
//   6. mint a single-use ERP magic-link and hand back the /sso URL
//
// WHAT THIS FUNCTION DELIBERATELY DOES NOT DO: attempt a password grant against
// the ERP project. The original plan had it fall back to ERP GoTrue for local
// accounts, which would have required turning the ERP project's captcha
// enforcement OFF — that enforcement was measured as ON (2026-08-04:
// `captcha_failed / no captcha_token found`), and the only two ERP accounts
// with human-chosen passwords are the two admins, i.e. exactly the accounts
// that protection is worth keeping for. Local accounts instead stay on the ERP
// login page's existing direct sign-in, which carries its own captcha token.
// The page tries this function first and falls back on its own.
//
// Response codes — `invalid_credentials` covers wrong password, no portal user
// AND suspended portal user, so none of the three can be told apart.
// `no_erp_access` is the one distinguishable answer and is only reachable
// AFTER a correct portal password, so observing it costs a valid credential.
//
// Deploy with --no-verify-jwt: there is no caller JWT at login time.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"

// The ERP origin is NOT added to the shared ALLOWED_ORIGINS — that would widen
// all nine portal functions at once. Only this one answers it.
const ERP_ORIGINS = (Deno.env.get("ERP_ALLOWED_ORIGINS") ?? "https://erp.parastrucks.in")
  .split(",").map((s) => s.trim()).filter(Boolean)

const ERP_SSO_URL = "https://erp.parastrucks.in/sso"

type TurnstileResult = "ok" | "failed" | "unavailable"

// Verified with the ERP's OWN Turnstile secret, because the token comes from
// the ERP login page's existing widget (sitekey already authorised for
// erp.parastrucks.in). That means no Cloudflare hostname change is needed and
// the page keeps ONE widget for both of its sign-in paths.
async function verifyTurnstile(token: string | undefined): Promise<TurnstileResult> {
  const secret = Deno.env.get("ERP_TURNSTILE_SECRET")
  const required = Deno.env.get("REQUIRE_CAPTCHA") === "true"
  if (!secret) return required ? "unavailable" : "ok"
  if (!token) return "failed"
  try {
    const form = new FormData()
    form.append("secret", secret)
    form.append("response", token)
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    })
    const data = await r.json().catch(() => null) as
      { success?: boolean; hostname?: string } | null
    if (!data?.success) return "failed"
    // Bind the token to the page that is supposed to have produced it: a token
    // minted on some other site protected by the same sitekey must not be
    // replayable here.
    const allowedHosts = ERP_ORIGINS.map((o) => {
      try { return new URL(o).hostname } catch { return "" }
    }).filter(Boolean)
    if (data.hostname && allowedHosts.length && !allowedHosts.includes(data.hostname)) {
      console.error(`erp-login: turnstile hostname mismatch (${data.hostname})`)
      return "failed"
    }
    return "ok"
  } catch {
    return required ? "unavailable" : "ok"
  }
}

Deno.serve(async (req: Request) => {
  let stage = "enter"
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status, ERP_ORIGINS)

  try {
    if (req.method === "OPTIONS") return preflight(req, ERP_ORIGINS)
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

    stage = "read-env"
    const portalUrl = Deno.env.get("SUPABASE_URL")!
    const portalAnon = publishableKey()
    const portalService = secretKey()
    const erpUrl = Deno.env.get("ERP_SUPABASE_URL")!
    const erpService = Deno.env.get("ERP_SERVICE_ROLE_KEY")!

    stage = "parse-body"
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""
    const turnstileToken = typeof body.turnstile_token === "string" ? body.turnstile_token : undefined
    if (!email || !password) return json({ error: "invalid_credentials" }, 401)

    const admin = createClient(portalUrl, portalService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    stage = "lockout-check"
    // Read-only; no counter increment. Shares the portal's own login lockout so
    // an attacker cannot get a fresh budget of guesses by switching endpoints.
    const { data: checkData, error: checkErr } = await admin.rpc("auth_attempt_check", {
      p_email: email,
    })
    if (checkErr) {
      console.error(
        "erp-login: auth_attempt_check FAILED — FAILING OPEN " +
          `(lockout not enforced for this attempt): ${checkErr.message}`,
      )
    } else if (Array.isArray(checkData) && checkData.length > 0) {
      const row = checkData[0] as { locked: boolean; retry_after_s: number | null }
      if (row.locked) return json({ error: "locked", retry_after_s: row.retry_after_s ?? 0 }, 429)
    }

    stage = "captcha"
    // Captcha failures never touch the lockout counter — they are not password
    // failures, and Turnstile is flaky enough for real users that it would lock
    // people out through no fault of their own.
    const captchaResult = await verifyTurnstile(turnstileToken)
    if (captchaResult === "unavailable") return json({ error: "captcha_unavailable" }, 503)
    if (captchaResult === "failed") return json({ error: "captcha_failed" }, 403)

    stage = "portal-signin"
    const portalAnonClient = createClient(portalUrl, portalAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: signInData, error: signInErr } = await portalAnonClient.auth
      .signInWithPassword({ email, password })

    if (signInErr || !signInData?.session) {
      stage = "portal-signin-failed"
      const { data: recData, error: recErr } = await admin.rpc("auth_attempt_record", {
        p_email: email,
        p_success: false,
      })
      if (recErr) {
        console.error(
          "erp-login: auth_attempt_record FAILED — lockout counter NOT " +
            `incremented (brute-force protection degraded): ${recErr.message}`,
        )
      }
      const row = Array.isArray(recData) && recData.length > 0
        ? recData[0] as { locked: boolean; retry_after_s: number | null }
        : null
      if (row?.locked) return json({ error: "locked", retry_after_s: row.retry_after_s ?? 0 }, 429)
      return json({ error: "invalid_credentials" }, 401)
    }

    // The password was right. Throw the session away — this function never
    // hands a portal session to an ERP page.
    const portalUserId = signInData.user?.id ?? null
    try { await portalAnonClient.auth.signOut() } catch { /* best effort */ }

    stage = "signin-success-cleanup"
    try {
      await admin.rpc("auth_attempt_record", { p_email: email, p_success: true })
    } catch (cleanupErr) {
      console.error("erp-login cleanup rpc failed:", cleanupErr)
    }

    stage = "portal-active-check"
    // The portal enforces is_active in its own client only, so a suspended
    // employee whose auth user still exists can still pass signInWithPassword.
    // Checked here so a suspension actually closes this door.
    //
    // public.users.id IS the auth user id on the portal (sync-erp-users maps
    // emails by exactly that equality). Fails CLOSED: no row means this is not
    // a current portal employee, and an unreadable row means we cannot say they
    // are active — neither should open the ERP.
    if (!portalUserId) return json({ error: "invalid_credentials" }, 401)
    const { data: pu, error: puErr } = await admin
      .from("users").select("is_active").eq("id", portalUserId).maybeSingle()
    if (puErr) {
      console.error("erp-login: portal users lookup failed:", puErr.message)
      return json({ error: "internal_error" }, 500)
    }
    // Deliberately indistinguishable from a wrong password.
    if (!pu || pu.is_active === false) return json({ error: "invalid_credentials" }, 401)

    stage = "erp-profile-check"
    const erp = createClient(erpUrl, erpService, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    async function erpProfile() {
      const { data, error } = await erp
        .from("profiles").select("user_id, is_active").eq("email", email).maybeSingle()
      if (error) {
        console.error("erp-login: ERP profile lookup failed:", error.message)
        return undefined
      }
      return data as { user_id: string; is_active: boolean } | null
    }

    let profile = await erpProfile()
    if (profile === undefined) return json({ error: "internal_error" }, 500)

    if (!profile) {
      stage = "jit-sync"
      // Same JIT provisioning erp-sso does: run a one-user sync and re-check.
      // Out of ERP scope (wrong department/brand) → no-op → genuine no_erp_access.
      try {
        await fetch(`${portalUrl}/functions/v1/sync-erp-users`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SYNC_SECRET")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        })
      } catch (e) {
        console.error("erp-login JIT sync failed:", e)
      }
      profile = await erpProfile()
      if (profile === undefined) return json({ error: "internal_error" }, 500)
    }

    // No ERP account, or one that an admin has deactivated. Both are "you do
    // not have access to the ERP" and both cost a correct portal password to
    // observe, so they share one honest message.
    if (!profile || profile.is_active === false) return json({ error: "no_erp_access" }, 403)

    stage = "mint"
    const { data: link, error: linkErr } = await erp.auth.admin.generateLink({
      type: "magiclink",
      email,
    })
    if (linkErr || !link?.properties?.hashed_token) {
      // A profile exists but no ERP auth user does — the two can drift (see the
      // orphan rows found 2026-08-04). Nothing the user can do about it.
      console.error("erp-login generateLink failed:", linkErr?.message)
      return json({ error: "no_erp_access" }, 403)
    }

    const url = `${ERP_SSO_URL}#token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink`
    return json({ ok: true, url })
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    const stack = (e as Error)?.stack || null
    console.error(`erp-login crashed at stage=${stage}:`, msg, stack)
    return json({ error: "internal_error" }, 500)
  }
})
