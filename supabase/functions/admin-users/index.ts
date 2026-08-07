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
// Phase 6c.3: writes only new 4-axis columns (permission_level, entity_id,
// department_id, designation_id, primary_outlet_id, subdept_id) + join tables
// (user_brands, user_sales_verticals, user_outlets). Legacy text columns have
// been dropped from the users table. Entity-scoping enforced for non-admin
// callers via requireSameEntity(). permission_level='admin' rejected on all
// write paths; partial unique index users_single_admin is the DB backstop.
// Join-table writes use full-replace semantics (delete-then-insert).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"
import { audit, adminLogoutUser } from "../_shared/auditLog.ts"
import { validateShape } from "../_shared/userShape.ts"
import { MIN_PASSWORD_LENGTH } from "../_shared/passwordPolicy.ts"

// Phase 9e C2 — tier rank for HR-edit guardrails. Higher number = more
// privilege. Caller cannot edit a target whose current OR proposed tier is
// >= caller's own tier. Admin bypasses every check.
const TIER_RANK: Record<string, number> = {
  staff: 1,
  executive: 2,
  manager: 3,
  gm: 4,
  admin: 5,
}
const tierOf = (perm: string | null | undefined): number =>
  TIER_RANK[perm ?? "staff"] ?? 1

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
  if (!authHeader) return { err: jsonResponse(req, { error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = publishableKey()
  const service = secretKey()

  // Verify the JWT belongs to a real auth user
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: jsonResponse(req, { error: "Invalid token" }, 401) }

  // Service-role client used for all writes inside this function
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Phase 6c.3: read new 4-axis columns only. Legacy `users.role` is dropped
  // in this phase; the `role` field on CallerProfile is now a derived token
  // (permission_level='admin' → 'admin', else departments.code) used by
  // same-department gates like HR Manager writes.
  const { data: prof, error: profErr } = await admin
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

// ── changeOwnPassword ───────────────────────────────────────────────────────
// A signed-in employee sets their OWN password. Deliberately self-scoped: the
// target is always the caller's id from the validated token, never the body.
//
// This is the ONLY way the must_change_password flag can be cleared. The client
// cannot do it itself — supabase.auth.updateUser() is blocked from writing
// app_metadata, and that restriction is precisely what makes the flag
// trustworthy. Both halves happen in ONE updateUserById call so there is no
// window where the password changed but the flag stuck, or vice versa.
async function changeOwnPassword(
  req: Request,
  p: { currentPassword?: string; newPassword?: string },
): Promise<Response> {
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status)
  const url = Deno.env.get("SUPABASE_URL")!
  const admin = createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Missing auth" }, 401)

  const anon = createClient(url, publishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await anon.auth.getUser(token)
  if (uErr || !u?.user?.email) return json({ error: "Invalid token" }, 401)
  const callerId = u.user.id
  const email = u.user.email

  // A suspended employee must not be able to re-establish themselves by setting
  // a fresh password. getUser() proves the token is unexpired, not that the
  // account is still live.
  const { data: prof, error: pErr } = await admin
    .from("users").select("is_active").eq("id", callerId).maybeSingle()
  if (pErr) {
    console.error("changeOwnPassword: profile read failed:", pErr.message)
    return json({ error: "backend_unavailable" }, 503)
  }
  if (!prof || prof.is_active === false) return json({ error: "Account inactive" }, 403)

  // Rate-limit BEFORE the password probe. This action returns early, above the
  // handler's own rateLimit() call, and it verifies currentPassword with a raw
  // signInWithPassword that does NOT touch auth_attempt_record — so without
  // this it is an unmetered password oracle. The realistic attack is a stolen
  // access token: the holder cannot change the password without knowing the
  // current one, so unlimited guesses here are what would turn a borrowed
  // session into a permanent account takeover.
  // 10 per hour, not the default 60/min: a person changes their password once.
  const rl = await rateLimit(admin, callerId, "changeOwnPassword", 10, 3600)
  if (!rl.allowed) {
    return json({ error: "Too many attempts. Please wait and try again.", retry_after_s: rl.retry_after_s }, 429)
  }

  const newPassword = p.newPassword ?? ""
  const currentPassword = p.currentPassword ?? ""
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
  }
  if (!currentPassword) return json({ error: "Current password is required" }, 400)
  // Rejecting "new == current" here also covers "you kept the temporary password
  // HR gave you", which is the whole point of the forced change.
  if (newPassword === currentPassword) {
    return json({ error: "Your new password must be different from your current one" }, 400)
  }

  // Re-authenticate. Going through the Edge Function loses GoTrue's own
  // self-service reauth, so prove possession of the current password here —
  // otherwise anyone holding a borrowed access token could change it. The probe
  // session is discarded immediately; it is never returned to the caller.
  const probe = createClient(url, publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: pwErr } = await probe.auth.signInWithPassword({ email, password: currentPassword })
  if (pwErr) return json({ error: "Current password is incorrect" }, 401)
  try { await probe.auth.signOut() } catch { /* probe session is disposable */ }

  // Read-then-spread rather than assuming GoTrue merges app_metadata: correct
  // whether admin update merges or replaces, and provider/providers survive.
  const { data: cur } = await admin.auth.admin.getUserById(callerId)
  const { error: updErr } = await admin.auth.admin.updateUserById(callerId, {
    password: newPassword,
    app_metadata: { ...(cur?.user?.app_metadata ?? {}), must_change_password: false },
  })
  if (updErr) {
    await audit(admin, {
      actorId: callerId, action: "changeOwnPassword", targetId: callerId,
      after: { ok: false, error: updErr.message },
    })
    return json({ error: updErr.message }, 400)
  }

  await audit(admin, {
    actorId: callerId, action: "changeOwnPassword", targetId: callerId,
    after: { ok: true, must_change_password: false },
  })
  return json({ ok: true })
}

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

  // ── changeOwnPassword — SELF-SCOPED, handled BEFORE the role gate ──────
  // Everything below requires hr or admin. This action is for the opposite
  // population: an ordinary employee whose password an admin just reset and who
  // must now choose their own. Routing it through verify(req, ["admin","hr"])
  // would 403 exactly the people it exists for — a permanent lockout loop,
  // since the flag blocks the rest of the app until it is cleared.
  //
  // It only ever acts on the CALLER's own id, taken from the validated token
  // and never from the body, so there is nothing here for a non-admin to abuse.
  if (action === "changeOwnPassword") {
    return await changeOwnPassword(req, payload as { currentPassword?: string; newPassword?: string })
  }

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
        if (!p.password || p.password.length < MIN_PASSWORD_LENGTH) {
          return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
        }
        const adminErr = rejectAdminTier(null, p.permission_level)
        if (adminErr) return json({ error: adminErr }, 400)
        if (!p.entity_id)      return json({ error: "entity_id is required" }, 400)
        if (!p.department_id)  return json({ error: "department_id is required" }, 400)
        if (!p.designation_id) return json({ error: "designation_id is required" }, 400)
        // rejectAdminTier() returns null when permission_level is absent, so an
        // omitted tier used to slip through here and surface as an opaque NOT
        // NULL violation after the auth user had already been created.
        if (!p.permission_level) return json({ error: "permission_level is required" }, 400)

        // Entity-scoping: HR can only create users in their own entity
        const entityErr = await requireSameEntity(p.entity_id)
        if (entityErr) return entityErr

        // ── SHAPE GATE ────────────────────────────────────────────────────
        // Every user carries the same attributes. Enforced HERE, not just in
        // the form: the form is UX and can be bypassed by calling this function
        // directly. Runs BEFORE createUser so a shape rejection never leaves an
        // orphaned auth user behind for the rollback path to clean up.
        const { data: cDept } = await admin
          .from("departments").select("code").eq("id", p.department_id).maybeSingle()
        const shapeErr = validateShape({
          department_code: cDept?.code ?? null,
          permission_level: p.permission_level,
          primary_outlet_id: p.primary_outlet_id,
          subdept_id: p.subdept_id,
          brand_ids: p.brand_ids,
          sales_vertical_ids: p.sales_vertical_ids,
        })
        if (shapeErr) return json({ error: shapeErr }, 400)

        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
          email: p.email.trim(),
          password: p.password,
          email_confirm: true,
          // The password an admin types on this form is a TEMPORARY one they
          // will read out to the new employee, so it is known to at least two
          // people from the moment it exists. Flag it: the employee is made to
          // choose their own on first sign-in before anything else opens.
          app_metadata: { must_change_password: true },
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

        // Phase 9e M3 — audit log
        await audit(admin, {
          actorId: caller.id,
          action: "createUser",
          targetId: authData.user.id,
          after: {
            email: p.email!.trim(),
            permission_level: p.permission_level ?? null,
            entity_id: p.entity_id,
            department_id: p.department_id,
            designation_id: p.designation_id,
          },
        })

        return json({ ok: true, id: authData.user.id })
      }

      case "updateProfile": {
        const { id, update } = payload as {
          id?: string
          update?: Record<string, unknown>
        }
        if (!id || !update) return json({ error: "Missing id or update" }, 400)

        // Phase 9e C2.1 — block self-edit of privilege-sensitive fields.
        // Other self-edits (full_name, location) stay allowed.
        if (id === caller.id) {
          for (const k of ["permission_level", "entity_id", "department_id"]) {
            if (k in update) {
              return json({ error: `Cannot change your own ${k}` }, 403)
            }
          }
        }

        // Phase 9e — fetch target's current state once. Used for entity gate,
        // HR-target gate, tier gate, and as the `before_jsonb` in the audit row.
        const { data: target } = await admin
          .from("users")
          .select("id, full_name, permission_level, entity_id, department_id, designation_id, primary_outlet_id, subdept_id, location, is_active, departments(code)")
          .eq("id", id)
          .maybeSingle() as unknown as {
            data: {
              id: string
              full_name: string | null
              permission_level: string | null
              entity_id: string | null
              department_id: string | null
              designation_id: string | null
              primary_outlet_id: string | null
              subdept_id: string | null
              location: string | null
              is_active: boolean
              departments: { code: string } | null
            } | null
          }
        if (!target) return json({ error: "User not found" }, 404)

        // Entity-scoping: HR can only edit users in their own entity
        const upEntityErr = await requireSameEntity(target.entity_id)
        if (upEntityErr) return upEntityErr

        // Phase 9e C2.2 — non-admin caller cannot edit another HR user.
        // Self-editing your own non-sensitive fields is still allowed
        // (self-edit of privilege fields is already blocked above).
        if (
          caller.role !== "admin"
          && target.departments?.code === "hr"
          && target.id !== caller.id
        ) {
          return json({ error: "You cannot edit another HR user" }, 403)
        }

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

        // Phase 9e C2.3 — tier guard for non-admin callers. Reject when the
        // target's CURRENT or PROPOSED tier is at or above the caller's tier.
        // Admin always bypasses (tier 5 > everyone).
        if (caller.role !== "admin") {
          const callerTier = tierOf(caller.permission_level)
          const currentTier = tierOf(target.permission_level)
          const proposedTier = clean.permission_level
            ? tierOf(clean.permission_level as string)
            : currentTier
          if (currentTier >= callerTier || proposedTier >= callerTier) {
            return json({
              error: "You cannot edit a user at or above your own tier",
            }, 403)
          }
        }

        // Join-table arrays live inside `update` too, extracted separately
        // because they don't go on the users row.
        const brandIds    = Array.isArray(update.brand_ids)          ? update.brand_ids          as string[] : undefined
        const verticalIds = Array.isArray(update.sales_vertical_ids) ? update.sales_vertical_ids as string[] : undefined
        const outletIds   = Array.isArray(update.outlet_ids)         ? update.outlet_ids         as string[] : undefined

        if (Object.keys(clean).length === 0 && !brandIds && !verticalIds && !outletIds) {
          return json({ error: "No valid fields to update" }, 400)
        }

        // ── SHAPE GATE (update) ───────────────────────────────────────────
        // Validate the RESULTING row, not the patch: "is this user complete?"
        // can only be answered against {…target, …clean} plus effective join
        // state. An undefined array means "leave the existing rows alone", so
        // it resolves to the CURRENT count; an empty array is a real request to
        // clear, and is rejected for a required slot.
        //
        // Safe to enforce on update because the 2026-08-07 backfill brought
        // every existing user up to shape first. Enforcing it before that
        // would have blocked HR from editing legacy users at all — including
        // to fix the very gaps being complained about.
        {
          const effDeptId = (clean.department_id as string | undefined) ?? target.department_id
          const effTier   = (clean.permission_level as string | undefined) ?? target.permission_level
          const effOutlet = ("primary_outlet_id" in clean)
            ? (clean.primary_outlet_id as string | null)
            : target.primary_outlet_id
          const effSubdept = ("subdept_id" in clean)
            ? (clean.subdept_id as string | null)
            : target.subdept_id

          // Reuse the department code already fetched with `target` when the
          // department is not changing; only re-read when it is.
          const deptChanged = effDeptId !== target.department_id
          const [{ data: uDept }, curBrands, curVerts] = await Promise.all([
            deptChanged && effDeptId
              ? admin.from("departments").select("code").eq("id", effDeptId).maybeSingle()
              : Promise.resolve({ data: { code: target.departments?.code ?? null } }),
            brandIds  === undefined
              ? admin.from("user_brands").select("brand_id").eq("user_id", id)
              : Promise.resolve({ data: null }),
            verticalIds === undefined
              ? admin.from("user_sales_verticals").select("vertical_id").eq("user_id", id)
              : Promise.resolve({ data: null }),
          ])

          const shapeErr = validateShape({
            department_code: uDept?.code ?? null,
            permission_level: effTier,
            primary_outlet_id: effOutlet,
            subdept_id: effSubdept,
            brand_ids: brandIds ?? (curBrands.data ?? []).map((r: { brand_id: string }) => r.brand_id),
            sales_vertical_ids: verticalIds ?? (curVerts.data ?? []).map((r: { vertical_id: string }) => r.vertical_id),
          })
          if (shapeErr) return json({ error: shapeErr }, 400)
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

        // Phase 9e M3 — audit log. Capture before (from `target` fetched
        // earlier) and after (target ∪ clean) so privilege diffs are
        // reconstructable from the log alone.
        await audit(admin, {
          actorId: caller.id,
          action: "updateProfile",
          targetId: id,
          before: { ...target },
          after: { ...target, ...clean },
        })

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

        // Capture previous state for audit (best-effort)
        const { data: prev } = await admin
          .from("users")
          .select("is_active")
          .eq("id", id)
          .maybeSingle()

        const { error } = await admin
          .from("users")
          .update({ is_active })
          .eq("id", id)
        if (error) return json({ error: error.message }, 400)

        // Phase 9e H4 / 9h — when deactivating, revoke the user's sessions so an
        // existing JWT can't be silently refreshed for another hour. Now via the
        // service-role `admin` client (DB-level RPC; the old GoTrue REST endpoint
        // 404'd). Best-effort; the RLS is_active gate is the real protection.
        if (!is_active) {
          await adminLogoutUser(admin, id)
        }

        // Phase 9e M3 — audit log
        await audit(admin, {
          actorId: caller.id,
          action: "setActive",
          targetId: id,
          before: { is_active: prev?.is_active ?? null },
          after: { is_active },
        })

        return json({ ok: true })
      }

      case "resetPassword": {
        const { id, password } = payload as {
          id?: string
          password?: string
        }
        if (!id) return json({ error: "Missing id" }, 400)
        if (!password || password.length < MIN_PASSWORD_LENGTH) {
          return json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
        }
        // Entity-scoping
        const rpEntityErr = await requireSameEntity(await getTargetEntityId(id))
        if (rpEntityErr) return rpEntityErr

        // ── Tier guard ────────────────────────────────────────────────────
        // This was MISSING: `update` has guarded tier-vs-tier since Phase 9e C2,
        // but resetting a password did not — so an HR *executive* could set the
        // admin's or a GM's password and then sign in as them. Setting someone's
        // password is at least as privileged as editing their record.
        const { data: rpTarget } = await admin
          .from("users").select("id, permission_level, departments(code)").eq("id", id)
          .maybeSingle() as unknown as {
            data: { id: string; permission_level: string | null; departments: { code: string } | null } | null
          }
        if (!rpTarget) return json({ error: "User not found" }, 404)
        if (caller.role !== "admin") {
          if (tierOf(rpTarget.permission_level) >= tierOf(caller.permission_level)) {
            return json({ error: "You cannot reset the password of a user at or above your own level" }, 403)
          }
          if (rpTarget.departments?.code === "hr" && rpTarget.id !== caller.id) {
            return json({ error: "You cannot reset another HR user's password" }, 403)
          }
        }

        // ── Set the password, mark it temporary, and kill live sessions ───
        // must_change_password lives in app_metadata, which is NOT writable by
        // the user from the browser — so nobody can clear their own flag. It is
        // NOT a portal column, because users_update RLS permits `id = auth.uid()`
        // and a self-clearable flag would be decoration.
        //
        // The existing app_metadata is read and spread rather than assuming
        // GoTrue merges: that way this is correct whether admin update merges or
        // replaces, and provider/providers survive either way.
        const { data: rpAuth } = await admin.auth.admin.getUserById(id)
        const { error } = await admin.auth.admin.updateUserById(id, {
          password,
          app_metadata: { ...(rpAuth?.user?.app_metadata ?? {}), must_change_password: true },
        })
        // Audit BOTH outcomes. The failure path used to return here, before the
        // audit() call below — so a failed reset left no trace at all, which is
        // exactly the event worth recording.
        if (error) {
          await audit(admin, {
            actorId: caller.id, action: "resetPassword", targetId: id,
            after: { ok: false, error: error.message },
          })
          return json({ error: error.message }, 400)
        }

        // A reset does not bite until the old token expires (~1h) unless the
        // session is destroyed now. Without this an admin can "reset" a
        // compromised account and the attacker keeps working for the hour.
        try {
          await adminLogoutUser(admin, id)
        } catch (e) {
          console.error("resetPassword: session revoke failed (password WAS changed):", e)
        }

        // Phase 9e M3 — audit log (no before/after for the password itself)
        await audit(admin, {
          actorId: caller.id,
          action: "resetPassword",
          targetId: id,
          after: { ok: true, must_change_password: true, sessions_revoked: true },
        })

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

        // Capture target snapshot before deletion (best-effort) so the audit
        // row contains who was deleted, not just an opaque uuid.
        const { data: prev } = await admin
          .from("users")
          .select("id, full_name, email, permission_level, entity_id, department_id")
          .eq("id", id)
          .maybeSingle()

        // Deletes the auth user; the FK cascade removes the profile row,
        // which in turn cascades to user_brands/user_sales_verticals/
        // user_outlets/user_profiles (all `on delete cascade` on user_id).
        const { error } = await admin.auth.admin.deleteUser(id)
        if (error) return json({ error: error.message }, 400)

        // Phase 9e M3 — audit log
        await audit(admin, {
          actorId: caller.id,
          action: "deleteUser",
          targetId: id,
          before: prev ?? { id },
        })

        return json({ ok: true })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Internal error" }, 500)
  }
})
