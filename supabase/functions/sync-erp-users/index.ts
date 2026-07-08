// ============================================================================
// sync-erp-users — PORTAL-SIDE Edge Function. Live user sync portal → ERP.
// DEPLOYS TO THE PORTAL PROJECT (mmmxvjaavdtwlpcnjgzy), NOT the ERP project.
// (Staged in the ERP repo for review; see ../README.md for deploy steps.)
//
// Scope (owner decision): entity = PT (Paras Trucks Haryana), linked to the
// HD Hyundai brand, department in {service, spares, accounts}.
// Mapping:  permission_level → ERP tier (executive→executor); department → ERP
//           function; a matching PT outlet → ERP branch (Hisar/Karnal/Rohtak/
//           Charkhi Dadri). Role ownership is HYBRID: seeded from the portal,
//           but the ERP sync leaves tier/func/branch alone once role_overridden.
// Identity (email/name) and is_active always flow from the portal.
//
// Auth: caller must present Authorization: Bearer <SYNC_SECRET>. Used by the
// nightly cron, the users-table DB webhook, and erp-sso JIT provisioning.
// Deploy with verify_jwt: false (we check the shared secret ourselves).
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2"
import { corsHeaders, preflight, jsonResponse } from "../_shared/cors.ts"

const TIER: Record<string, string> = { admin: "admin", gm: "gm", manager: "manager", executive: "executor" }
// City → ERP branch. Keys are normalised (lower-case, single-spaced) and include
// common spelling variants so a stray "Hissar"/extra whitespace doesn't silently
// skip a manager/executor (that bug cost us a day of head-scratching once).
const BRANCH_BY_CITY: Record<string, string> = {
  "hisar": "HSR", "hissar": "HSR",
  "karnal": "KNL",
  "rohtak": "RTK",
  "charkhi dadri": "CHD", "dadri": "CHD",
  "sirsa": "SRS",
}
const cityToBranch = (city?: string | null): string | null =>
  city ? (BRANCH_BY_CITY[city.trim().toLowerCase().replace(/\s+/g, " ")] ?? null) : null
const ERP_FUNCS = ["service", "spares", "accounts"]

type Mapped = {
  portal_id: string; email: string; full_name: string; is_active: boolean;
  tier: string; func: string; branch_code: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return jsonResponse(req, { error: "method_not_allowed" }, 405)

  // shared-secret gate (cron / webhook / erp-sso JIT are all server-to-server)
  const secret = Deno.env.get("SYNC_SECRET")!
  const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!secret || auth !== secret) return jsonResponse(req, { error: "unauthorized" }, 401)

  let opts: { email?: string; dryRun?: boolean } = {}
  try { opts = await req.json() } catch { /* full reconcile, no body */ }
  const single = opts.email ? opts.email.toLowerCase() : null
  const dryRun = !!opts.dryRun

  const portal = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const erp = createClient(Deno.env.get("ERP_SUPABASE_URL")!, Deno.env.get("ERP_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    // 1. in-scope portal users (public schema): PT + hdh brand + service/spares/accounts
    const { data: rows, error: qErr } = await portal
      .from("users")
      .select(`id, full_name, is_active, permission_level,
               ent:entities!entity_id!inner(code),
               dept:departments!department_id!inner(code),
               user_brands!inner(brands!inner(code)),
               user_outlets(outlets(city))`)
      .eq("ent.code", "PT")
      .in("dept.code", ERP_FUNCS)
      .eq("user_brands.brands.code", "hdh")
    if (qErr) throw qErr

    // 2. emails live in auth.users — build an id → email map
    const emailById = new Map<string, string>()
    let page = 1
    for (;;) {
      const { data: list, error } = await portal.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      for (const u of list.users) if (u.email) emailById.set(u.id, u.email.toLowerCase())
      if (list.users.length < 1000) break
      page++
    }

    // 3. map + collect skips
    const skipped: { email?: string; reason: string }[] = []
    const mapped: Mapped[] = []
    for (const r of (rows ?? [])) {
      const email = emailById.get(r.id)
      if (!email) { skipped.push({ reason: `no email for portal user ${r.id}` }); continue }
      if (single && email !== single) continue
      const tier = TIER[r.permission_level as string]
      const func = (r.dept as { code: string }).code
      if (!tier || !ERP_FUNCS.includes(func)) { skipped.push({ email, reason: `unmappable tier/func (${r.permission_level}/${func})` }); continue }
      // branch: gm/admin ride all branches (null); manager/executor need a mapped outlet
      let branch_code: string | null = null
      const cities = (r.user_outlets ?? []).map((uo: { outlets?: { city?: string } }) => uo.outlets?.city).filter(Boolean) as string[]
      for (const c of cities) { const code = cityToBranch(c); if (code) { branch_code = code; break } }
      if (tier !== "gm" && tier !== "admin" && !branch_code) {
        skipped.push({ email, reason: `no ERP-branch outlet for ${tier} (outlets: ${cities.join(", ") || "none"})` }); continue
      }
      mapped.push({ portal_id: r.id, email, full_name: r.full_name ?? email, is_active: r.is_active, tier, func, branch_code })
    }

    // 4. ERP reference + existing portal-sourced profiles
    const { data: branches } = await erp.from("branches").select("id, code")
    const branchId = new Map((branches ?? []).map((b: { code: string; id: string }) => [b.code, b.id]))
    const { data: erpProfiles } = await erp.from("profiles")
      .select("user_id, email, portal_user_id, source, role_overridden, is_active, username")
    const byPortalId = new Map((erpProfiles ?? []).filter(p => p.portal_user_id).map(p => [p.portal_user_id, p]))
    const byEmail = new Map((erpProfiles ?? []).map(p => [p.email?.toLowerCase(), p]))
    const takenUsernames = new Set((erpProfiles ?? []).map(p => p.username))

    const result = { created: 0, updated: 0, reactivated: 0, deactivated: 0, skipped, dryRun, single: single ?? undefined }

    // 5. upsert each mapped user
    for (const m of mapped) {
      const existing = byPortalId.get(m.portal_id) ?? byEmail.get(m.email)
      const branch = m.branch_code ? branchId.get(m.branch_code) ?? null : null
      if (existing) {
        const patch: Record<string, unknown> = {
          full_name: m.full_name, email: m.email, is_active: m.is_active,
          source: "portal", portal_user_id: m.portal_id,
        }
        if (!existing.role_overridden) { patch.tier = m.tier; patch.func = m.func; patch.branch_id = branch }
        if (existing.is_active === false && m.is_active) result.reactivated++
        if (!dryRun) await erp.from("profiles").update(patch).eq("user_id", existing.user_id)
        result.updated++
      } else {
        if (dryRun) { result.created++; continue }
        // create the ERP auth user (SSO/magic-link login; no password needed)
        const { data: created, error: cErr } = await erp.auth.admin.createUser({ email: m.email, email_confirm: true })
        if (cErr || !created?.user) { skipped.push({ email: m.email, reason: `createUser failed: ${cErr?.message}` }); continue }
        let username = m.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "")
        if (takenUsernames.has(username)) username = `${username}-${m.portal_id.slice(0, 4)}`
        takenUsernames.add(username)
        const { error: pErr } = await erp.from("profiles").insert({
          user_id: created.user.id, username, full_name: m.full_name, email: m.email,
          tier: m.tier, func: m.func, branch_id: branch, is_active: m.is_active,
          source: "portal", portal_user_id: m.portal_id,
        })
        if (pErr) { skipped.push({ email: m.email, reason: `profile insert failed: ${pErr.message}` }); continue }
        result.created++
      }
    }

    // 6. deactivation sweep (full reconcile only): portal-sourced ERP profiles no
    //    longer in the active in-scope set → disable in the ERP (RLS denies them).
    if (!single) {
      const activeIds = new Set(mapped.filter(m => m.is_active).map(m => m.portal_id))
      for (const p of (erpProfiles ?? [])) {
        if (p.source === "portal" && p.is_active && p.portal_user_id && !activeIds.has(p.portal_user_id)) {
          if (!dryRun) {
            await erp.from("profiles").update({ is_active: false }).eq("user_id", p.user_id)
            await erp.auth.admin.signOut(p.user_id).catch(() => {})   // revoke any live session
          }
          result.deactivated++
        }
      }
    }

    return jsonResponse(req, result)
  } catch (e) {
    console.error("sync-erp-users error:", e)
    return jsonResponse(req, { error: "internal_error", detail: String((e as Error)?.message ?? e) }, 500)
  }
})
