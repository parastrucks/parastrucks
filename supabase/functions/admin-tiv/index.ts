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
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { rateLimit } from "../_shared/rateLimit.ts"

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
  if (!authHeader) return { err: json({ error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: json({ error: "Invalid token" }, 401) }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Phase 6c.3: derive the legacy role token from permission_level +
  // departments.code. Admin → 'admin'; others → department code.
  const { data: prof } = await admin
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
    }

  if (!prof) return { err: json({ error: "Profile not found" }, 403) }
  if (!prof.is_active) return { err: json({ error: "Account inactive" }, 403) }

  const token =
    prof.permission_level === "admin" ? "admin"
    : (prof.departments?.code ?? null)

  if (!token || !allowedRoles.includes(token)) {
    return { err: json({ error: "Forbidden" }, 403) }
  }

  return { caller: { id: prof.id, role: token, is_active: prof.is_active, full_name: prof.full_name }, admin }
}

// Whitelisted tables the client is allowed to target.
// Each table's onConflict column is hard-coded here — the client never specifies it.
const TABLE_CONFIG: Record<string, { onConflict: string }> = {
  tiv_forecast_tiv_actuals: { onConflict: "month_label" },
  tiv_forecast_ptb_actuals: { onConflict: "month_label" },
  tiv_forecast_al_actuals: { onConflict: "month_label" },
  tiv_forecast_judgment_tiv: { onConflict: "month_label" },
  tiv_forecast_judgment_ptb: { onConflict: "month_label" },
  tiv_forecast_raw_data: { onConflict: "month_label" },
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: { action?: string; payload?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const action = body.action
  const payload = body.payload ?? {}

  const auth = await verify(req, ["admin", "back_office"])
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
      case "upsertRows": {
        const { table, rows } = payload as {
          table?: string
          rows?: Record<string, unknown>[]
        }
        if (!table || !TABLE_CONFIG[table]) {
          return json({ error: `Unknown or disallowed table: ${table}` }, 400)
        }
        if (!Array.isArray(rows)) {
          return json({ error: "rows array is required" }, 400)
        }
        if (rows.length === 0) return json({ ok: true, count: 0 })
        if (rows.length > 5000) {
          return json({ error: "Max 5000 rows per upsert" }, 400)
        }
        const { onConflict } = TABLE_CONFIG[table]
        const { error } = await admin.from(table).upsert(rows, { onConflict })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, count: rows.length })
      }

      case "insertModelParams": {
        const { params } = payload as { params?: Record<string, unknown> }
        if (!params || typeof params !== "object") {
          return json({ error: "params object required" }, 400)
        }
        const { error } = await admin.from("tiv_forecast_model_params").insert(params)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "insertUploadHistory": {
        const p = payload as {
          uploader_name?: string
          file_name?: string
          months_loaded?: number
          last_data_month?: string
        }
        if (!p.file_name) return json({ error: "file_name required" }, 400)
        // uploaded_by always comes from the verified JWT, never from the client
        const { error } = await admin.from("tiv_forecast_upload_history").insert({
          uploaded_by: caller.id,
          uploader_name: p.uploader_name ?? caller.full_name,
          file_name: p.file_name,
          months_loaded: p.months_loaded ?? 0,
          last_data_month: p.last_data_month ?? null,
        })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Internal error" }, 500)
  }
})
