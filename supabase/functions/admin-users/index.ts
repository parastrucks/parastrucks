// supabase/functions/admin-users/index.ts
// Admin user management — create, update, deactivate, reset password, delete.
// Called by the portal client via callEdge('admin-users', { action, payload }).
//
// Auth: JWT required. Caller must be `hr` or `admin` (admin-only for delete).
// Never exposes the service role key to the browser.
//
// IMPORTANT: this function must be deployed with verify_jwt: false.
// The gateway-level verify_jwt check rejects user JWTs in this project
// (kid/JWKS mismatch). The verify() below does stricter validation
// (getUser + is_active + role whitelist) so nothing is lost.
//
// ── Phase 6c.1 extensions ─────────────────────────────────────────────────
// `create` and `updateProfile` now also accept the new 4-axis columns
// (permission_level, entity_id, department_id, designation_id, primary_outlet_id,
// subdept_id) plus the three user↔ref join tables (user_brands,
// user_sales_verticals, user_outlets). Legacy text columns (role, entity,
// brand, location, department, vertical, designation) are still written so
// Sidebar/BottomNav/Profile — which haven't migrated yet — keep rendering.
//
// permission_level='admin' is rejected on every write path: the singleton
// admin is seeded at install time and changing tier to/from admin is a
// Phase 6c.1 admin-UI-only operation not exposed through this EF. The
// partial unique index `users_single_admin` is the DB-level backstop.
//
// Join-table writes use full-replace semantics on updateProfile: delete all
// rows for the user, then insert the new set. Simpler + correct than diffing,
// and the blast radius per user is tiny (≤ a handful of rows each).

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
  role: string  // derived token: 'admin' | department.code
  permission_level: string | null
  entity_id: string | null
  department_id: string | null
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

  // Verify the JWT belongs to a real auth user
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: json({ error: "Invalid token" }, 401) }

  // Service-role client used for all writes inside this function
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Phase 6c.3: read new 4-axis columns only. Legacy `users.role` is dropped
  // in this phase; the `role` field on CallerProfile is now a derived token
  // (permission_level='admin' → 'admin', else departments.code) used by
  // same-department gates like HR Manager writes.
  const { data: prof } = await admin
    .from("users")
    .select("id, permission_level, entity_id, department_id, is_active, full_name, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: {
        id: string
        permission_level: string | null
        entity_id: string | null
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

  return {
    caller: {
      id:               prof.id,
      role:             token,
      permission_level: prof.permission_level,
      entity_id:        prof.entity_id,
      department_id:    prof.department_id,
      is_active:        prof.is_active,
      full_name:        prof.full_name,
    },
    admin,
  }
}

// Shared guard — reject any attempt to write permission_level='admin' or
// legacy role='admin' via this EF. Admin is a DB-enforced singleton; changing
// tier into/out of admin is not a flow exposed through this function.
function rejectAdminTier(role?: string | null, perm?: string | null): string | null {
  if (role === "admin") return "Cannot assign 'admin' role via this endpoint"
  if (perm === "admin") return "Cannot assign 'admin' permission level via this endpoint"
  if (perm != null && !["gm", "manager", "executive"].includes(perm)) {
    return "permission_level must be one of: gm, manager, executive"
  }
  return null
}

// Replace a user's rows in a join table. Used on create (skip delete) and
// update (delete-then-insert). IDs is an array of UUIDs; empty array clears.
async function replaceJoin(
  admin: SupabaseClient,
  table: string,
  userId: string,
  fkCol: string,
  ids: string[] | undefined,
  skipDelete = false,
): Promise<string | null> {
  if (!Array.isArray(ids)) return null // undefined = leave untouched
  if (!skipDelete) {
    const { error: dErr } = await admin.from(table).delete().eq("user_id", userId)
    if (dErr) return `Failed to clear ${table}: ${dErr.message}`
  }
  if (ids.length === 0) return null
  const rows = ids.map((v) => ({ user_id: userId, [fkCol]: v }))
  const { error: iErr } = await admin.from(table).insert(rows)
  if (iErr) return `Failed to insert into ${table}: ${iErr.message}`
  return null
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

  // All actions require hr or admin; `delete` additionally requires admin.
  const auth = await verify(req, ["admin", "hr"])
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  // Per-user rate limit: 60 req/min/bucket. Runs after verify() so
  // unauthenticated hits can't pollute the rate_limits table.
  const rl = await rateLimit(admin, caller.id, "admin-users")
  if (!rl.allowed) {
    return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)
  }

  // ── Entity-scoping guard ─────────────────────────────────────────────
  // Non-admin callers (HR) may only operate on users within their own
  // entity. Admin bypasses — they span both entities by design.
  // For actions that target an existing user (update/setActive/reset),
  // we look up the target's entity_id. For create, we check the payload.
  async function requireSameEntity(targetEntityId: string | null | undefined): Promise<Response | null> {
    if (caller.role === "admin") return null // admin bypasses
    if (!caller.entity_id) {
      return json({ error: "Caller has no entity — cannot manage users" }, 403)
    }
    if (targetEntityId !== caller.entity_id) {
      return json({ error: "You can only manage employees within your own entity" }, 403)
    }
    return null
  }

  // For actions targeting an existing user by id, resolve their entity_id
  async function getTargetEntityId(userId: string): Promise<string | null> {
    const { data } = await admin.from("users").select("entity_id").eq("id", userId).maybeSingle()
    return data?.entity_id ?? null
  }

  try {
    switch (action) {
      case "create": {
        const p = payload as {
          full_name?: string
          email?: string
          password?: string
          permission_level?: string
          entity_id?: string
          department_id?: string
          designation_id?: string
          primary_outlet_id?: string | null
          subdept_id?: string | null
          location?: string | null
          brand_ids?: string[]
          sales_vertical_ids?: string[]
          outlet_ids?: string[]
        }
        if (!p.full_name?.trim()) return json({ error: "Full name is required" }, 400)
        if (!p.email?.trim()) return json({ error: "Email is required" }, 400)
        if (!p.password || p.password.length < 8) {
          return json({ error: "Password must be at least 8 characters" }, 400)
        }
        const adminErr = rejectAdminTier(null, p.permission_level)
        if (adminErr) return json({ error: adminErr }, 400)
        if (!p.entity_id)      return json({ error: "entity_id is required" }, 400)
        if (!p.department_id)  return json({ error: "department_id is required" }, 400)
        if (!p.designation_id) return json({ error: "designation_id is required" }, 400)

        // Entity-scoping: HR can only create users in their own entity
        const entityErr = await requireSameEntity(p.entity_id)
        if (entityErr) return entityErr

        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
          email: p.email.trim(),
          password: p.password,
          email_confirm: true,
        })
        if (authErr || !authData?.user) {
          return json({ error: authErr?.message || "Failed to create auth user" }, 400)
        }

        const { error: pErr } = await admin.from("users").insert({
          id: authData.user.id,
          username: p.email.trim(),
          full_name: p.full_name.trim(),
          email: p.email.trim(),
          permission_level: p.permission_level,
          entity_id: p.entity_id,
          department_id: p.department_id,
          designation_id: p.designation_id,
          primary_outlet_id: p.primary_outlet_id ?? null,
          subdept_id: p.subdept_id ?? null,
          location: p.location ?? null,
          is_active: true,
        })
        if (pErr) {
          // Roll back the auth user if the profile insert fails
          await admin.auth.admin.deleteUser(authData.user.id)
          return json({ error: pErr.message }, 400)
        }

        // Join-table inserts. Best-effort: if any fail, we delete the partial
        // user and roll back auth so the admin can retry with clean slate.
        const joinErr =
          (await replaceJoin(admin, "user_brands",          authData.user.id, "brand_id",    p.brand_ids,          true)) ||
          (await replaceJoin(admin, "user_sales_verticals", authData.user.id, "vertical_id", p.sales_vertical_ids, true)) ||
          (await replaceJoin(admin, "user_outlets",         authData.user.id, "outlet_id",   p.outlet_ids,         true))
        if (joinErr) {
          await admin.from("users").delete().eq("id", authData.user.id)
          await admin.auth.admin.deleteUser(authData.user.id)
          return json({ error: joinErr }, 400)
        }

        return json({ ok: true, id: authData.user.id })
      }

      case "updateProfile": {
        const { id, update } = payload as {
          id?: string
          update?: Record<string, unknown>
        }
        if (!id || !update) return json({ error: "Missing id or update" }, 400)

        // Entity-scoping: HR can only edit users in their own entity
        const upEntityErr = await requireSameEntity(await getTargetEntityId(id))
        if (upEntityErr) return upEntityErr

        // Phase 6c.3: legacy text columns removed from the whitelist. Only
        // name + new axis columns + informational location remain.
        const allowed = [
          "full_name",
          "permission_level",
          "entity_id",
          "department_id",
          "designation_id",
          "primary_outlet_id",
          "subdept_id",
          "location",
        ]
        const clean: Record<string, unknown> = {}
        for (const k of allowed) {
          if (k in update) clean[k] = update[k] ?? null
        }
        const adminErr = rejectAdminTier(
          null,
          clean.permission_level as string | null | undefined,
        )
        if (adminErr) return json({ error: adminErr }, 400)

        // Join-table arrays live inside `update` too, extracted separately
        // because they don't go on the users row.
        const brandIds    = Array.isArray(update.brand_ids)          ? update.brand_ids          as string[] : undefined
        const verticalIds = Array.isArray(update.sales_vertical_ids) ? update.sales_vertical_ids as string[] : undefined
        const outletIds   = Array.isArray(update.outlet_ids)         ? update.outlet_ids         as string[] : undefined

        if (Object.keys(clean).length === 0 && !brandIds && !verticalIds && !outletIds) {
          return json({ error: "No valid fields to update" }, 400)
        }

        if (Object.keys(clean).length > 0) {
          const { error } = await admin.from("users").update(clean).eq("id", id)
          if (error) return json({ error: error.message }, 400)
        }

        // Full-replace semantics on the join tables. Undefined arrays leave
        // the table untouched; empty arrays clear it.
        const joinErr =
          (await replaceJoin(admin, "user_brands",          id, "brand_id",    brandIds))    ||
          (await replaceJoin(admin, "user_sales_verticals", id, "vertical_id", verticalIds)) ||
          (await replaceJoin(admin, "user_outlets",         id, "outlet_id",   outletIds))
        if (joinErr) return json({ error: joinErr }, 400)

        return json({ ok: true })
      }

      case "setActive": {
        const { id, is_active } = payload as {
          id?: string
          is_active?: boolean
        }
        if (!id || typeof is_active !== "boolean") {
          return json({ error: "Missing id or is_active" }, 400)
        }
        // Don't allow a user to deactivate themselves (lockout prevention)
        if (id === caller.id && !is_active) {
          return json({ error: "You cannot deactivate your own account" }, 400)
        }
        // Entity-scoping
        const saEntityErr = await requireSameEntity(await getTargetEntityId(id))
        if (saEntityErr) return saEntityErr
        const { error } = await admin
          .from("users")
          .update({ is_active })
          .eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "resetPassword": {
        const { id, password } = payload as {
          id?: string
          password?: string
        }
        if (!id) return json({ error: "Missing id" }, 400)
        if (!password || password.length < 8) {
          return json({ error: "Password must be at least 8 characters" }, 400)
        }
        // Entity-scoping
        const rpEntityErr = await requireSameEntity(await getTargetEntityId(id))
        if (rpEntityErr) return rpEntityErr
        const { error } = await admin.auth.admin.updateUserById(id, { password })
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      case "delete": {
        // Delete is admin-only
        if (caller.role !== "admin") {
          return json({ error: "Only admins can delete users" }, 403)
        }
        const { id } = payload as { id?: string }
        if (!id) return json({ error: "Missing id" }, 400)
        if (id === caller.id) {
          return json({ error: "You cannot delete your own account" }, 400)
        }
        // Deletes the auth user; the FK cascade removes the profile row,
        // which in turn cascades to user_brands/user_sales_verticals/
        // user_outlets/user_profiles (all `on delete cascade` on user_id).
        const { error } = await admin.auth.admin.deleteUser(id)
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
