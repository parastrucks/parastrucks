// ============================================================================
// sync-erp-users — PORTAL-SIDE Edge Function. Live user sync portal → ERP.
// DEPLOYS TO THE PORTAL PROJECT (mmmxvjaavdtwlpcnjgzy), NOT the ERP project.
// (Staged in the ERP repo for review; see ../README.md for deploy steps.)
//
// Scope (owner decision): entity = PT (Paras Trucks Haryana), linked to the
// HD Hyundai brand, department in {service, spares, accounts, sales}.
// Mapping:  permission_level → ERP tier (executive→executor), EXCEPT the sales
//           department which pins tier `sales` (see SALES_FUNC below); department
//           → ERP function; the user's PT outlet → ERP branch (Hisar/Karnal/Rohtak/
//           Charkhi Dadri/Sirsa). The outlet is read from users.primary_outlet_id
//           (the portal's compulsory field) with the legacy user_outlets join as a
//           fallback. Role ownership is HYBRID: seeded from the portal,
//           but the ERP sync leaves tier/func/branch alone once role_overridden.
// Identity (email/name) and is_active always flow from the portal.
//
// Auth: caller must present Authorization: Bearer <SYNC_SECRET>. Used by the
// nightly cron, the users-table DB webhook, and erp-sso JIT provisioning.
// Deploy with verify_jwt: false (we check the shared secret ourselves).
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey } from "../_shared/keys.ts"
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
const ERP_FUNCS = ["service", "spares", "accounts", "sales"]
// Tiers that ride ALL branches, so branch_id stays null. gm/admin because they
// are never pinned to one outlet; `sales` because the ERP's sales persona is
// deliberately branch-less (ERP Phase 13c) and its CHECK constraint
// `sales_is_branchless_sales_func` REJECTS a sales profile that carries a branch.
const BRANCHLESS_TIERS = new Set(["gm", "admin", "sales"])
// The sales department maps to the ERP `sales` tier regardless of the portal
// permission_level — a sales GM is a portal gm, but ERP `gm` bypasses every
// functional gate at the DB level, so mapping them there would hand the sales
// team the whole workshop. The sales tier's ONLY power is approving credit /
// discount within the per-user ceilings an ERP admin grants (Phase 13a/13b).
// This pin is deliberately unconditional (it also demotes a portal admin who
// sits in the sales department); the intended escape hatch for an exception is
// the ERP's own `role_overridden` flag, which this sync honours.
const SALES_FUNC = "sales"

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

  const portal = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(),
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
               primary_outlet:outlets!primary_outlet_id(city),
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
      const func = (r.dept as { code: string }).code
      // permission_level must still be a recognised portal level even for sales —
      // an unmapped value means a malformed portal record, not a sales user.
      const tier = func === SALES_FUNC
        ? (TIER[r.permission_level as string] ? "sales" : undefined)
        : TIER[r.permission_level as string]
      if (!tier || !ERP_FUNCS.includes(func)) { skipped.push({ email, reason: `unmappable tier/func (${r.permission_level}/${func})` }); continue }
      // branch: gm/admin/sales ride ALL branches (branch_id stays null — they are
      // never pinned to one, even though they do have a home outlet in the portal);
      // manager/executor MUST resolve to a mapped outlet or they are skipped.
      //
      // The outlet comes from users.primary_outlet_id — the portal employee form's
      // COMPULSORY field. The legacy user_outlets join table is effectively never
      // written (it held exactly ONE hand-inserted row in prod, which is what masked
      // this bug and left 14 of 16 users unprovisioned). primary_outlet FIRST,
      // user_outlets kept only as a fallback.
      let branch_code: string | null = null
      if (!BRANCHLESS_TIERS.has(tier)) {
        const cities = [
          (r.primary_outlet as { city?: string } | null)?.city,
          ...(r.user_outlets ?? []).map((uo: { outlets?: { city?: string } }) => uo.outlets?.city),
        ].filter(Boolean) as string[]
        for (const c of cities) { const code = cityToBranch(c); if (code) { branch_code = code; break } }
        if (!branch_code) {
          skipped.push({ email, reason: `no ERP-branch outlet for ${tier} (outlets: ${cities.join(", ") || "none"})` }); continue
        }
      }
      mapped.push({ portal_id: r.id, email, full_name: r.full_name ?? email, is_active: r.is_active, tier, func, branch_code })
    }

    // 4. ERP reference + existing portal-sourced profiles
    const { data: branches } = await erp.from("branches").select("id, code")
    const branchId = new Map((branches ?? []).map((b: { code: string; id: string }) => [b.code, b.id]))
    const { data: erpProfiles } = await erp.from("profiles")
      .select("user_id, email, portal_user_id, source, role_overridden, is_active, username, suspend_overridden")
    const byPortalId = new Map((erpProfiles ?? []).filter(p => p.portal_user_id).map(p => [p.portal_user_id, p]))
    const byEmail = new Map((erpProfiles ?? []).map(p => [p.email?.toLowerCase(), p]))
    const byUserId = new Map((erpProfiles ?? []).map(p => [p.user_id, p]))
    const takenUsernames = new Set((erpProfiles ?? []).map(p => p.username))

    // Every ERP auth user, by email. Needed for two things a profiles-only view
    // cannot see: (a) an auth user whose email has drifted from the portal's —
    // erp-sso and erp-login both mint BY EMAIL, so drift is a permanent SSO
    // lockout that no later sync repairs; (b) an auth user with no profile row.
    // Two such orphans exist on prod (created 2026-07-10 and 2026-07-14) and
    // would make createUser fail forever for those addresses.
    const authIdByEmail = new Map<string, string>()
    const authEmailById = new Map<string, string>()
    try {
      for (let page = 1; page <= 20; page++) {
        const { data: listed, error: lErr } = await erp.auth.admin.listUsers({ page, perPage: 200 })
        if (lErr) { console.error("sync-erp-users listUsers failed:", lErr.message); break }
        const users = listed?.users ?? []
        for (const u of users) {
          if (!u.email) continue
          authIdByEmail.set(u.email.toLowerCase(), u.id)
          authEmailById.set(u.id, u.email.toLowerCase())
        }
        if (users.length < 200) break
      }
    } catch (e) {
      console.error("sync-erp-users listUsers threw:", e)
    }

    const result = { created: 0, updated: 0, reactivated: 0, deactivated: 0, skipped, dryRun, single: single ?? undefined }

    // 5. upsert each mapped user
    for (const m of mapped) {
      // Third fallback, via the auth user: a profile whose email has drifted
      // from the portal's is found by neither portal_user_id (if it was never
      // stamped) nor by email. Without this it falls to the create path, adopts
      // that same auth user, and the profile insert dies on the primary key.
      const authIdForEmail = authIdByEmail.get(m.email.toLowerCase())
      const existing = byPortalId.get(m.portal_id) ?? byEmail.get(m.email)
        ?? (authIdForEmail ? byUserId.get(authIdForEmail) : undefined)
      const branch = m.branch_code ? branchId.get(m.branch_code) ?? null : null
      if (existing) {
        const patch: Record<string, unknown> = {
          full_name: m.full_name, email: m.email,
          source: "portal", portal_user_id: m.portal_id,
        }
        // is_active normally flows from the portal — but an ERP admin who
        // suspends someone must not have it silently undone by the next
        // reconcile (≤30 min). profiles.suspend_overridden is set on an ERP
        // suspension and cleared when they are reactivated there.
        if (existing.suspend_overridden) {
          if (m.is_active) {
            console.log(`sync-erp-users: is_active NOT patched for ${m.email} — ERP suspension overrides the portal`)
          }
        } else {
          patch.is_active = m.is_active
          if (existing.is_active === false && m.is_active) result.reactivated++
        }
        if (!existing.role_overridden) { patch.tier = m.tier; patch.func = m.func; patch.branch_id = branch }
        if (!dryRun) {
          await erp.from("profiles").update(patch).eq("user_id", existing.user_id)
          // Repair the ERP AUTH email too. profiles.email alone is not enough:
          // erp-sso and erp-login mint magic links by auth email, so a portal
          // email change used to lock the person out of the ERP permanently.
          const authEmail = authEmailById.get(existing.user_id)
          if (authEmail && authEmail !== m.email.toLowerCase()) {
            const { error: uErr } = await erp.auth.admin.updateUserById(existing.user_id, {
              email: m.email, email_confirm: true,
            })
            if (uErr) {
              skipped.push({ email: m.email, reason: `auth email repair failed: ${uErr.message}` })
            } else {
              console.log(`sync-erp-users: repaired auth email ${authEmail} → ${m.email}`)
            }
          }
        }
        result.updated++
      } else {
        if (dryRun) { result.created++; continue }
        // ADOPT an existing auth user before trying to create one. An auth user
        // with no profile row is invisible to the profiles-only view above, so
        // createUser would fail with "already registered" on every run, forever
        // — the address could never be provisioned. Two such rows exist on prod.
        let authUserId = authIdByEmail.get(m.email.toLowerCase()) ?? null
        if (authUserId) {
          console.log(`sync-erp-users: adopting existing ERP auth user for ${m.email}`)
        } else {
          const { data: created, error: cErr } = await erp.auth.admin.createUser({ email: m.email, email_confirm: true })
          if (created?.user) {
            authUserId = created.user.id
          } else {
            // Lost a race with a concurrent JIT provision (erp-sso / erp-login
            // both create users). Re-read rather than skipping: skipping here is
            // what orphans the auth user in the first place.
            const { data: relisted } = await erp.auth.admin.listUsers({ page: 1, perPage: 200 })
            authUserId = (relisted?.users ?? [])
              .find(u => u.email?.toLowerCase() === m.email.toLowerCase())?.id ?? null
            if (!authUserId) {
              skipped.push({ email: m.email, reason: `createUser failed: ${cErr?.message}` })
              continue
            }
            console.log(`sync-erp-users: adopted ${m.email} after createUser race`)
          }
        }
        authIdByEmail.set(m.email.toLowerCase(), authUserId)
        let username = m.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "")
        if (takenUsernames.has(username)) username = `${username}-${m.portal_id.slice(0, 4)}`
        takenUsernames.add(username)
        const { error: pErr } = await erp.from("profiles").insert({
          user_id: authUserId, username, full_name: m.full_name, email: m.email,
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
