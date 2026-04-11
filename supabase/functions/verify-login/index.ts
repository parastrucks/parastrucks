// supabase/functions/verify-login/index.ts
// Phase 5 U8 — Login hardening. Server-side wrapper around
// supabase.auth.signInWithPassword so we can enforce:
//   • email-based lockout (5 failures in 15 min → 15 min lockout)
//   • optional Cloudflare Turnstile CAPTCHA
//
// The client (src/context/AuthContext.signIn) calls this function instead of
// calling supabase-js signInWithPassword directly. On success it hands back
// the access_token + refresh_token which the client installs via
// supabase.auth.setSession(...). That fires SIGNED_IN → existing
// onAuthStateChange handler → loadUserData runs as normal.
//
// IMPORTANT: this function must be deployed with verify_jwt: false.
// There is no caller JWT at login time — that's the whole point — and the
// gateway's verify_jwt check would 401 the request. This is the same
// deployment flag used by the other 5 EFs for a different reason (JWKS/kid
// mismatch); here it's required by the nature of the endpoint.
//
// Threat-model notes (honest ones):
//   • The lockout is email-keyed, not IP-keyed. An attacker can still try 5
//     different emails from one IP unbounded via this EF. Per-IP limiting is
//     left to Cloudflare WAF when that's wired up.
//   • This EF cannot stop an attacker who scripts /auth/v1/token directly,
//     bypassing the portal's login form entirely. The real mitigation for
//     that is the Supabase dashboard auth settings (rate limits, leaked-
//     password protection) — tracked as a separate item outside the code.
//   • Turnstile failures do NOT count toward lockout. Reason: CAPTCHA flaky
//     for some real users (mobile Safari, screen readers), and we don't
//     want to lock them out through no fault of their own.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })

// Verify a Turnstile token against Cloudflare's siteverify endpoint.
// Returns true when no secret is configured (inert mode — dev & pre-Turnstile
// prod), true on success, false on Cloudflare rejection.
async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET")
  if (!secret) return true // inert until env var is set
  if (!token) return false

  try {
    const form = new FormData()
    form.append("secret", secret)
    form.append("response", token)
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    )
    const data = await r.json().catch(() => null) as { success?: boolean } | null
    return !!data?.success
  } catch {
    // Network error calling Cloudflare. Fail open on the CAPTCHA so a
    // Cloudflare outage doesn't block all logins. Password check still runs.
    return true
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const turnstileToken = typeof body.turnstile_token === "string"
    ? body.turnstile_token
    : undefined

  if (!email || !password) {
    return json({ error: "email and password required" }, 400)
  }

  // Service-role client for lockout bookkeeping.
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Check lockout BEFORE touching passwords or CAPTCHA. If locked, the
  //    attacker gets no signal about whether the password is right — we just
  //    say "come back later". This is read-only, no counter increment.
  const { data: checkData, error: checkErr } = await admin.rpc("auth_attempt_check", {
    p_email: email,
  })
  if (!checkErr && Array.isArray(checkData) && checkData.length > 0) {
    const row = checkData[0] as { locked: boolean; retry_after_s: number | null }
    if (row.locked) {
      return json({
        error: "locked",
        retry_after_s: row.retry_after_s ?? 0,
      }, 429)
    }
  }
  // If checkErr — fail open and continue. A broken lockout must not deny
  // legit users; the password check below still runs.

  // 2. CAPTCHA verification. Failures here do NOT hit auth_attempt_record —
  //    they're not password failures.
  const captchaOk = await verifyTurnstile(turnstileToken)
  if (!captchaOk) {
    return json({ error: "captcha_failed" }, 403)
  }

  // 3. Password grant via anon client (same endpoint the browser would hit).
  //    persistSession:false so we don't try to write to Deno storage.
  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: signInData, error: signInErr } = await anonClient.auth
    .signInWithPassword({ email, password })

  if (signInErr || !signInData?.session) {
    // 4a. Failure path — record against the lockout table.
    const { data: recData } = await admin.rpc("auth_attempt_record", {
      p_email: email,
      p_success: false,
    })
    const row = Array.isArray(recData) && recData.length > 0
      ? recData[0] as { locked: boolean; retry_after_s: number | null; fails_remaining: number | null }
      : null

    // If that increment pushed us over the edge, surface a locked response.
    if (row?.locked) {
      return json({
        error: "locked",
        retry_after_s: row.retry_after_s ?? 0,
      }, 429)
    }

    return json({
      error: "invalid_credentials",
      fails_remaining: row?.fails_remaining ?? null,
    }, 401)
  }

  // 4b. Success — clear the lockout row for this email.
  await admin.rpc("auth_attempt_record", {
    p_email: email,
    p_success: true,
  }).catch(() => {
    // If the cleanup call fails, the login still succeeds. Stale lockout
    // rows auto-expire when the 15-min window rolls over on the next failure.
  })

  const s = signInData.session
  return json({
    ok: true,
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? null,
  })
})
