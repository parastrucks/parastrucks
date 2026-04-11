// supabase/functions/admin-catalog/index.ts
// Admin vehicle catalog — upsert, toggle, bulk import, brochure upload URL.
// Called by the portal client via callEdge('admin-catalog', { action, payload }).
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

  const { data: prof } = await admin
    .from("users")
    .select("id, role, is_active")
    .eq("id", u.user.id)
    .maybeSingle()

  if (!prof) return { err: json({ error: "Profile not found" }, 403) }
  if (!prof.is_active) return { err: json({ error: "Account inactive" }, 403) }
  if (!allowedRoles.includes(prof.role)) {
    return { err: json({ error: "Forbidden" }, 403) }
  }

  return { caller: prof as CallerProfile, admin }
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
  const rl = await rateLimit(admin, caller.id, "admin-catalog")
  if (!rl.allowed) {
    return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)
  }

  try {
    switch (action) {
      // ── Single vehicle upsert ─────────────────────────────────
      case "createVehicle": {
        const p = payload as Record<string, unknown>
        if (!p.cbn) return json({ error: "cbn is required" }, 400)
        if (!p.description) return json({ error: "description is required" }, 400)
        const { error } = await admin.from("vehicle_catalog").insert({
          cbn: p.cbn,
          description: p.description,
          brand: p.brand ?? "al",
          segment: p.segment,
          sub_category: p.sub_category ?? null,
          tyres: p.tyres ?? null,
          mrp_incl_gst: p.mrp_incl_gst,
          gst_rate: p.gst_rate ?? 18,
          price_circular: p.price_circular ?? null,
          effective_date: p.effective_date ?? null,
          is_active: p.is_active ?? true,
        })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "updateVehicle": {
        const { id, update } = payload as {
          id?: number | string
          update?: Record<string, unknown>
        }
        if (id == null || !update) return json({ error: "Missing id or update" }, 400)
        // Whitelist of updatable fields
        const allowed = [
          "description", "brand", "segment", "sub_category", "tyres",
          "mrp_incl_gst", "gst_rate", "price_circular", "effective_date", "is_active",
        ]
        const clean: Record<string, unknown> = {}
        for (const k of allowed) {
          if (k in update) clean[k] = update[k]
        }
        if (Object.keys(clean).length === 0) {
          return json({ error: "No valid fields" }, 400)
        }
        const { error } = await admin.from("vehicle_catalog").update(clean).eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "toggleVehicleActive": {
        const { id, is_active } = payload as {
          id?: number | string
          is_active?: boolean
        }
        if (id == null || typeof is_active !== "boolean") {
          return json({ error: "id and is_active required" }, 400)
        }
        const { error } = await admin
          .from("vehicle_catalog")
          .update({ is_active })
          .eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      // ── Bulk price-circular import ────────────────────────────
      case "bulkUpsertVehicles": {
        const { rows } = payload as { rows?: Record<string, unknown>[] }
        if (!Array.isArray(rows) || rows.length === 0) {
          return json({ error: "rows array is required" }, 400)
        }
        if (rows.length > 5000) {
          return json({ error: "Max 5000 rows per import" }, 400)
        }
        const { error } = await admin
          .from("vehicle_catalog")
          .upsert(rows, { onConflict: "cbn", ignoreDuplicates: false })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, count: rows.length })
      }

      // ── Brochure upload: return a one-shot signed URL ─────────
      // The client POSTs the PDF directly to this URL — the file never
      // passes through the Edge Function (no payload size limits, no cold-start cost).
      case "signBrochureUpload": {
        const { path } = payload as { path?: string }
        if (!path || !/^[a-z0-9_\-\/]+\.pdf$/i.test(path)) {
          return json({ error: "Invalid brochure path" }, 400)
        }
        const { data, error } = await admin.storage
          .from("brochures")
          .createSignedUploadUrl(path)
        if (error || !data) {
          return json({ error: error?.message || "Failed to sign upload" }, 400)
        }
        return json({ ok: true, signedUrl: data.signedUrl, token: data.token, path: data.path })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Internal error" }, 500)
  }
})
