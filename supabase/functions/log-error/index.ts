// supabase/functions/log-error/index.ts
// Client-side error logging — writes to the error_log table.
// Called from ErrorBoundary, window.onerror, and onunhandledrejection.
//
// Auth: JWT required (any authenticated user can log their own errors).
// No rate limiting at function level — a cheap insert per error is fine.
// The error_log table has strict RLS: insert-only for authenticated,
// select-only for admin. The user_id is always set server-side from the JWT.

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

// Truncate long strings to prevent payload-bomb DoS.
const trunc = (v: unknown, max: number): string | null => {
  if (v == null) return null
  const s = typeof v === "string" ? v : String(v)
  return s.length > max ? s.slice(0, max) : s
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return json({ error: "Missing auth" }, 401)
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  // Verify JWT via anon client
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: "Invalid token" }, 401)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const message = trunc(body.message, 2000)
  const stack = trunc(body.stack, 8000)
  const pageUrl = trunc(body.url, 500)
  const context = body.context && typeof body.context === "object"
    ? body.context
    : null

  if (!message) return json({ error: "message required" }, 400)

  // Write via service-role client so RLS doesn't trip on the insert
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await admin.from("error_log").insert({
    user_id: u.user.id,
    url: pageUrl,
    message,
    stack,
    context,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
})
