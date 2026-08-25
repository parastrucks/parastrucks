// supabase/functions/admin-tiv/index.ts
// TIV Forecast writes — actuals upsert, judgment upsert, model retrain, upload history.
// Called by the portal client via callEdge('admin-tiv', { action, payload }).
//
// Auth: JWT required. Caller must be `admin` or `back_office`.
// Never exposes the service role key to the browser.
//
// IMPORTANT: this function must be deployed with verify_jwt: false.
// The gateway-level verify_jwt check rejects user JWTs in this project
// (kid/JWKS mismatch). The verify() below does stricter validation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"

type CallerProfile = {
  id: string
  role: string
  is_active: boolean
  full_name: string
}

type VerifyResult =
  | { err: Response }
  | { caller: CallerProfile; admin: SupabaseClient }

async function verify(
  req: Request,
  allowedRoles: string[],
): Promise<VerifyResult> {
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return { err: jsonResponse(req, { error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = publishableKey()
  const service = secretKey()

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: jsonResponse(req, { error: "Invalid token" }, 401) }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Phase 6c.3: derive the legacy role token from permission_level +
  // departments.code. Admin → 'admin'; others → department code.
  const { data: prof, error: profErr } = await admin
    .from("users")
    .select("id, permission_level, department_id, is_active, full_name, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: {
        id: string
        permission_level: string | null
        department_id: string | null
        is_active: boolean
        full_name: string
        departments: { code: string } | null
      } | null
      error: { message: string } | null
    }

  // A dead/rejected privileged key makes PostgREST return 401, which
  // supabase-js reports as an error rather than throwing. Without this
  // guard prof is null and the caller is told "Profile not found" — i.e.
  // blamed for a platform failure. Red-team 2026-07-21 (C2).
  if (profErr) {
    console.error("verify: privileged profile read failed:", profErr.message)
    return { err: jsonResponse(req, { error: "backend_unavailable" }, 503) }
  }
  if (!prof) return { err: jsonResponse(req, { error: "Profile not found" }, 403) }
  if (!prof.is_active) return { err: jsonResponse(req, { error: "Account inactive" }, 403) }

  const token =
    prof.permission_level === "admin" ? "admin"
    : (prof.departments?.code ?? null)

  if (!token || !allowedRoles.includes(token)) {
    return { err: jsonResponse(req, { error: "Forbidden" }, 403) }
  }

  return { caller: { id: prof.id, role: token, is_active: prof.is_active, full_name: prof.full_name }, admin }
}

// The table whitelist and the per-table onConflict map used to live here, for
// the eight-call upload the browser used to drive. That path is gone: uploads
// go through tiv_upload_all(), which owns the table list and the conflict
// targets inside one transaction. Nothing here targets a table by name any more.
Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status)
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: { action?: string; payload?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const action = body.action
  const payload = body.payload ?? {}

  // Admin only. This used to accept `back_office` as well, while the upload
  // panel rendered for `permission_level === 'admin'` alone -- so "only the
  // owner uploads" was a client-side appearance, not a rule. Every write here
  // goes through the service-role client and therefore bypasses RLS, so the
  // wider gate meant any back-office JWT could rewrite all six TIV tables from
  // a console. Server contract now matches what the UI has always implied.
  // (Owner decision, 2026-08-25.)
  const auth = await verify(req, ["admin"])
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  // Per-user rate limit: 60 req/min/bucket. Runs after verify() so
  // unauthenticated hits can't pollute the rate_limits table.
  const rl = await rateLimit(admin, caller.id, "admin-tiv")
  if (!rl.allowed) {
    return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)
  }

  try {
    switch (action) {
      // One transaction for the whole upload. The previous flow was eight
      // independent calls from the browser, so a failure part-way left
      // production half-overwritten -- new actuals under the old model -- and
      // a failure of the LAST call (history) reported "Upload failed" for an
      // upload that had fully committed. tiv_upload_all() snapshots, upserts,
      // inserts params and writes history inside a single PL/pgSQL body, which
      // Postgres runs atomically.
      case "uploadAll": {
        const p = payload as {
          entity_id?: string
          brand_id?: string
          tiv?: unknown[]
          ptb?: unknown[]
          al?: unknown[]
          judgment_tiv?: unknown[]
          judgment_ptb?: unknown[]
          raw?: unknown[]
          params?: Record<string, unknown>
          uploader_name?: string
          file_name?: string
          months_loaded?: number
          last_data_month?: string
        }

        if (!p.entity_id || !p.brand_id) {
          return json({ error: "entity_id and brand_id are required" }, 400)
        }
        if (!p.file_name) return json({ error: "file_name required" }, 400)
        if (!p.params || typeof p.params !== "object") {
          return json({ error: "params object required" }, 400)
        }

        const lists: [string, unknown[] | undefined][] = [
          ["tiv", p.tiv], ["ptb", p.ptb], ["al", p.al],
          ["judgment_tiv", p.judgment_tiv], ["judgment_ptb", p.judgment_ptb], ["raw", p.raw],
        ]
        for (const [name, arr] of lists) {
          if (!Array.isArray(arr)) return json({ error: `${name} must be an array` }, 400)
          if (arr.length > 5000) return json({ error: `Max 5000 rows for ${name}` }, 400)
        }
        if (!Array.isArray(p.tiv) || p.tiv.length === 0) {
          return json({ error: "tiv rows are required" }, 400)
        }

        const { data, error } = await admin.rpc("tiv_upload_all", {
          p_entity_id: p.entity_id,
          p_brand_id: p.brand_id,
          p_tiv: p.tiv,
          p_ptb: p.ptb,
          p_al: p.al,
          p_judg_tiv: p.judgment_tiv,
          p_judg_ptb: p.judgment_ptb,
          p_raw: p.raw,
          p_params: p.params,
          // Always from the verified JWT, never from the client.
          p_uploaded_by: caller.id,
          p_uploader_name: p.uploader_name ?? caller.full_name,
          p_file_name: p.file_name,
          p_months_loaded: p.months_loaded ?? 0,
          p_last_data_month: p.last_data_month ?? null,
        })

        if (error) {
          // The function raises this when a month already belongs to another
          // entity/brand -- the documented silent-overwrite path. Give it a
          // status of its own so the client can explain rather than retry.
          if (error.message?.includes("cross_scope_conflict")) {
            return json({ error: error.message, code: "cross_scope_conflict" }, 409)
          }
          return json({ error: error.message }, 400)
        }
        return json({ ok: true, ...(data as Record<string, unknown>) })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Internal error" }, 500)
  }
})
