// supabase/functions/admin-users/index.ts
// Admin user management — create, update, deactivate, reset password, delete.
// Called by the portal client via callEdge('admin-users', { action, payload }).
//
// Auth: JWT required. Caller must be `hr` or `admin` (admin-only for delete).
// Never exposes the service role key to the browser.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

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

  // Look up the caller's portal profile
  const { data: prof } = await admin
    .from("users")
    .select("id, role, is_active, full_name")
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

  // All actions require hr or admin; `delete` additionally requires admin.
  const auth = await verify(req, ["admin", "hr"])
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  try {
    switch (action) {
      case "create": {
        const p = payload as {
          full_name?: string
          email?: string
          password?: string
          role?: string
          entity?: string
          brand?: string
          location?: string
          department?: string
          vertical?: string
          designation?: string
        }
        if (!p.full_name?.trim()) return json({ error: "Full name is required" }, 400)
        if (!p.email?.trim()) return json({ error: "Email is required" }, 400)
        if (!p.password || p.password.length < 8) {
          return json({ error: "Password must be at least 8 characters" }, 400)
        }

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
          role: p.role,
          entity: p.entity,
          brand: p.brand || null,
          location: p.location || null,
          department: p.department || null,
          vertical: p.vertical || null,
          designation: p.designation?.trim() || null,
          is_active: true,
        })
        if (pErr) {
          // Roll back the auth user if the profile insert fails
          await admin.auth.admin.deleteUser(authData.user.id)
          return json({ error: pErr.message }, 400)
        }
        return json({ ok: true, id: authData.user.id })
      }

      case "updateProfile": {
        const { id, update } = payload as {
          id?: string
          update?: Record<string, unknown>
        }
        if (!id || !update) return json({ error: "Missing id or update" }, 400)

        // Whitelist updatable columns — no one can change id, email, is_active via this path
        const allowed = [
          "full_name",
          "role",
          "entity",
          "brand",
          "location",
          "department",
          "vertical",
          "designation",
        ]
        const clean: Record<string, unknown> = {}
        for (const k of allowed) {
          if (k in update) clean[k] = update[k] ?? null
        }
        if (Object.keys(clean).length === 0) {
          return json({ error: "No valid fields to update" }, 400)
        }

        const { error } = await admin.from("users").update(clean).eq("id", id)
        if (error) return json({ error: error.message }, 400)
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
        // Deletes the auth user; the FK cascade removes the profile row.
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
