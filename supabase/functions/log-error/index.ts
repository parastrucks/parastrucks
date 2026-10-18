// supabase/functions/log-error/index.ts
// Client-side error logging — writes to the error_log table.
// Called from ErrorBoundary, window.onerror, and onunhandledrejection.
//
// Auth: JWT required (any authenticated user can log their own errors).
//
// Rate limit: 120 req/min/user — higher than admin functions so a transient
// burst of client errors doesn't get dropped, but still bounded so a stuck
// client can't hammer the error_log table. The error_log table has strict RLS:
// insert-only for authenticated, select-only for admin. The user_id is always
// set server-side from the JWT.
//
// IMPORTANT: this function must be deployed with verify_jwt: false.
// The gateway-level verify_jwt check rejects user JWTs in this project
// (kid/JWKS mismatch). getUser() inline below does the real validation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"
// The report is read from callEdge's { action, payload } envelope (or a flat
// body) — reading only the top level refused every report ever sent (report.ts).
import { readReport } from "./report.ts"

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status)
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return json({ error: "Missing auth" }, 401)
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = publishableKey()
  const service = secretKey()

  // Verify JWT via anon client
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: "Invalid token" }, 401)

  // Service-role client used for both rate-limit and error insert
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Rate limit: 120 req/min per user. Runs after JWT verification so
  // unauthenticated hits can't pollute the rate_limits table.
  const rl = await rateLimit(admin, u.user.id, "log-error", 120, 60)
  if (!rl.allowed) {
    return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const report = readReport(body)
  if (!report) return json({ error: "message required" }, 400)

  const { error } = await admin.from("error_log").insert({
    user_id: u.user.id,
    url: report.url,
    message: report.message,
    stack: report.stack,
    context: report.context,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
})
