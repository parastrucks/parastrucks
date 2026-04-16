// supabase/functions/admin-access-rules/index.ts
// Admin access-rules management — rules, user permissions, ref data, operating units.
// Called by the portal client via callEdge('admin-access-rules', { action, payload }).
//
// Auth: JWT required. Caller must be `admin`.
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

  // All actions in this function are admin-only
  const auth = await verify(req, ["admin"])
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  // Per-user rate limit: 60 req/min/bucket. Runs after verify() so
  // unauthenticated hits can't pollute the rate_limits table.
  const rl = await rateLimit(admin, caller.id, "admin-access-rules")
  if (!rl.allowed) {
    return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)
  }

  try {
    switch (action) {
      // ── Access rules ──────────────────────────────────────────
      // Phase 6c.1: writes new 4-axis columns. Legacy text columns
      // (brand/location/department/role) are intentionally NOT written —
      // any rule created through this path after the cutover is 4-axis
      // only. The 61 seed rules already follow this shape.
      case "createRule": {
        const p = payload as {
          route?: string
          permission_level?: string
          entity_id?: string
          department_id?: string
          designation_id?: string | null
        }
        if (!p.route)            return json({ error: "route is required" }, 400)
        if (!p.permission_level) return json({ error: "permission_level is required" }, 400)
        if (!["gm", "manager", "executive"].includes(p.permission_level)) {
          return json({ error: "permission_level must be gm, manager, or executive (admin uses hard bypass, not a rule)" }, 400)
        }
        if (!p.entity_id)     return json({ error: "entity_id is required" }, 400)
        if (!p.department_id) return json({ error: "department_id is required" }, 400)
        const { error } = await admin.from("access_rules").insert({
          route: p.route,
          permission_level: p.permission_level,
          entity_id: p.entity_id,
          department_id: p.department_id,
          designation_id: p.designation_id ?? null,
        })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "deleteRule": {
        const { id } = payload as { id?: number | string }
        if (id == null) return json({ error: "id is required" }, 400)
        const { error } = await admin.from("access_rules").delete().eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      // ── Entity GM pointers (Phase 6c.1) ───────────────────────
      // Set gm_service_user_id / gm_spares_user_id / gm_backoffice_user_id on
      // an entity. The UI constrains the choices to users within that
      // entity; server accepts null to clear.
      case "updateEntityGMs": {
        const { entity_id, gm_service_user_id, gm_spares_user_id, gm_backoffice_user_id } = payload as {
          entity_id?: string
          gm_service_user_id?: string | null
          gm_spares_user_id?: string | null
          gm_backoffice_user_id?: string | null
        }
        if (!entity_id) return json({ error: "entity_id is required" }, 400)
        const clean: Record<string, unknown> = {}
        if ("gm_service_user_id"    in payload) clean.gm_service_user_id    = gm_service_user_id    ?? null
        if ("gm_spares_user_id"     in payload) clean.gm_spares_user_id     = gm_spares_user_id     ?? null
        if ("gm_backoffice_user_id" in payload) clean.gm_backoffice_user_id = gm_backoffice_user_id ?? null
        if (Object.keys(clean).length === 0) {
          return json({ error: "No GM fields provided" }, 400)
        }
        const { error } = await admin.from("entities").update(clean).eq("id", entity_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      // ── Reference data (brands, roles, locations, departments) ──
      case "addBrand": {
        const { code, name } = payload as { code?: string; name?: string }
        if (!code || !name) return json({ error: "code and name required" }, 400)
        const { error } = await admin.from("brands").insert({ code, name })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "toggleBrand": {
        const { code, is_active } = payload as {
          code?: string
          is_active?: boolean
        }
        if (!code || typeof is_active !== "boolean") {
          return json({ error: "code and is_active required" }, 400)
        }
        const { error } = await admin
          .from("brands")
          .update({ is_active })
          .eq("code", code)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "addRole": {
        const { name, label } = payload as { name?: string; label?: string }
        if (!name || !label) return json({ error: "name and label required" }, 400)
        const { error } = await admin.from("roles").insert({ name, label })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "toggleRole": {
        const { name, is_active } = payload as {
          name?: string
          is_active?: boolean
        }
        if (!name || typeof is_active !== "boolean") {
          return json({ error: "name and is_active required" }, 400)
        }
        const { error } = await admin
          .from("roles")
          .update({ is_active })
          .eq("name", name)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "addLocation": {
        const { name, state, entity } = payload as {
          name?: string
          state?: string
          entity?: string
        }
        if (!name) return json({ error: "name is required" }, 400)
        const { error } = await admin.from("locations").insert({
          name,
          state: state ?? "",
          entity: entity ?? "PT",
        })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "toggleLocation": {
        const { name, is_active } = payload as {
          name?: string
          is_active?: boolean
        }
        if (!name || typeof is_active !== "boolean") {
          return json({ error: "name and is_active required" }, 400)
        }
        const { error } = await admin
          .from("locations")
          .update({ is_active })
          .eq("name", name)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "addDepartment": {
        const { name } = payload as { name?: string }
        if (!name) return json({ error: "name is required" }, 400)
        const { error } = await admin.from("departments").insert({ name })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "toggleDepartment": {
        const { name, is_active } = payload as {
          name?: string
          is_active?: boolean
        }
        if (!name || typeof is_active !== "boolean") {
          return json({ error: "name and is_active required" }, 400)
        }
        const { error } = await admin
          .from("departments")
          .update({ is_active })
          .eq("name", name)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      // ── Operating units ───────────────────────────────────────
      case "createOperatingUnit": {
        const p = payload as Record<string, unknown>
        if (!p.brand || !p.location) {
          return json({ error: "brand and location required" }, 400)
        }
        const { error } = await admin.from("operating_units").insert({
          brand: p.brand,
          location: p.location,
          entity_code: p.entity_code ?? null,
          full_name: p.full_name ?? null,
          address: p.address ?? null,
          gstin: p.gstin ?? null,
          bank_account: p.bank_account ?? null,
          bank_name: p.bank_name ?? null,
          bank_ifsc: p.bank_ifsc ?? null,
        })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "updateOperatingUnit": {
        const p = payload as Record<string, unknown>
        if (!p.brand || !p.location) {
          return json({ error: "brand and location required" }, 400)
        }
        const { error } = await admin
          .from("operating_units")
          .update({
            entity_code: p.entity_code ?? null,
            full_name: p.full_name ?? null,
            address: p.address ?? null,
            gstin: p.gstin ?? null,
            bank_account: p.bank_account ?? null,
            bank_name: p.bank_name ?? null,
            bank_ifsc: p.bank_ifsc ?? null,
          })
          .eq("brand", p.brand)
          .eq("location", p.location)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }
      case "toggleOperatingUnit": {
        const { id, is_active } = payload as {
          id?: number | string
          is_active?: boolean
        }
        if (id == null || typeof is_active !== "boolean") {
          return json({ error: "id and is_active required" }, 400)
        }
        const { error } = await admin
          .from("operating_units")
          .update({ is_active })
          .eq("id", id)
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
