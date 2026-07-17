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
import { jsonResponse, preflight } from "../_shared/cors.ts"

type CallerProfile = {
  id: string
  role: string  // derived token: 'admin' | department.code | null
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
  if (!authHeader) return { err: jsonResponse(req, { error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

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
  // departments.code. Admin → 'admin'; everyone else → department code
  // ('sales','hr','back_office','service','spares','accounts','pdi').
  // Mirrors the SQL-side current_user_role() function exactly so an EF
  // check accepts the same callers a matching RLS policy would.
  const { data: prof } = await admin
    .from("users")
    .select("id, permission_level, department_id, is_active, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: {
        id: string
        permission_level: string | null
        department_id: string | null
        is_active: boolean
        departments: { code: string } | null
      } | null
    }

  if (!prof) return { err: jsonResponse(req, { error: "Profile not found" }, 403) }
  if (!prof.is_active) return { err: jsonResponse(req, { error: "Account inactive" }, 403) }

  const token =
    prof.permission_level === "admin" ? "admin"
    : (prof.departments?.code ?? null)

  if (!token || !allowedRoles.includes(token)) {
    return { err: jsonResponse(req, { error: "Forbidden" }, 403) }
  }

  return { caller: { id: prof.id, role: token, is_active: prof.is_active }, admin }
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
          // Phase 9.7a: sub_segment_id is the real link; sub_category text is
          // dual-written alongside it until every reader has moved to the id
          // (Quotation / ProformaInvoice / FinancierCopy still search the text).
          sub_segment_id: p.sub_segment_id ?? null,
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
          "description", "brand", "segment", "sub_segment_id", "sub_category", "tyres",
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

      // ── Rename a sub-segment (Phase 9.7a) ─────────────────────
      // Renaming used to be forbidden in the UI: vehicle_catalog.sub_category
      // was free text matched against sub_segments.name, so a rename stranded
      // every CBN in the family. Now sub_segment_id carries the link and the
      // rename is safe — but the text column is still what Quotation /
      // ProformaInvoice / FinancierCopy search, so it must move in step.
      //
      // The two writes are NOT in one transaction (PostgREST gives us no
      // transaction across calls). The id link is the source of truth, so the
      // failure mode is a stale text column, never a stranded CBN — and the
      // 3c integrity query in the 9.7a migration detects exactly that drift.
      // If the second write fails we report it rather than silently succeed.
      case "renameSubSegment": {
        const { id, name } = payload as { id?: number; name?: string }
        if (id == null || !name?.trim()) {
          return json({ error: "id and name are required" }, 400)
        }
        const clean = name.trim()

        const { data: existing, error: exErr } = await admin
          .from("sub_segments").select("id, name").eq("id", id).maybeSingle()
        if (exErr) return json({ error: exErr.message }, 400)
        if (!existing) return json({ error: "Sub-segment not found" }, 404)
        if (existing.name === clean) return json({ ok: true, renamed: 0, unchanged: true })

        // sub_segments.name is UNIQUE — surface the collision as a clean 409
        // instead of a raw Postgres constraint error.
        const { data: clash } = await admin
          .from("sub_segments").select("id").ilike("name", clean).neq("id", id).maybeSingle()
        if (clash) return json({ error: `A sub-segment named "${clean}" already exists` }, 409)

        const { error: nameErr } = await admin
          .from("sub_segments").update({ name: clean }).eq("id", id)
        if (nameErr) return json({ error: nameErr.message }, 400)

        const { data: synced, error: syncErr } = await admin
          .from("vehicle_catalog")
          .update({ sub_category: clean })
          .eq("sub_segment_id", id)
          .select("id")
        if (syncErr) {
          return json({
            ok: false,
            error: `Renamed to "${clean}", but the CBN text did not sync: ${syncErr.message}. ` +
                   `The id link is intact — re-run the rename to retry.`,
          }, 500)
        }
        return json({ ok: true, renamed: synced?.length ?? 0 })
      }

      // ── Reshuffle: move CBNs to a family (Phase 9.7b) ─────────
      // The first bulk write in the catalog. It lives server-side, as one
      // statement, on purpose: a client-side loop could die halfway and leave
      // half the selection moved with no record of which half.
      //
      // Writes BOTH halves of the link — sub_segment_id (the truth) and
      // sub_category (what Quotation/ProformaInvoice/FinancierCopy still
      // search). Writing only one is exactly the drift 9.7a set out to end.
      case "moveCbns": {
        const { cbns, sub_segment_id } = payload as {
          cbns?: unknown
          sub_segment_id?: number | null
        }
        if (!Array.isArray(cbns) || cbns.length === 0) {
          return json({ error: "cbns array is required" }, 400)
        }
        if (!cbns.every((c) => typeof c === "string" && c.trim())) {
          return json({ error: "cbns must be non-empty strings" }, 400)
        }
        // Matches bulkUpsertVehicles' ceiling. Also keeps the .in() list below
        // well clear of any request-line limit.
        if (cbns.length > 5000) {
          return json({ error: "Max 5000 CBNs per move" }, 400)
        }

        // sub_segment_id null = unassign (send back to the triage queue).
        // Anything else must resolve to a real, ACTIVE family: moving CBNs
        // into a retired family would hide them from every employee surface
        // while looking like a successful move.
        let familyName: string | null = null
        if (sub_segment_id !== null && sub_segment_id !== undefined) {
          if (!Number.isInteger(sub_segment_id)) {
            return json({ error: "sub_segment_id must be an integer or null" }, 400)
          }
          const { data: fam, error: famErr } = await admin
            .from("sub_segments")
            .select("id, name, is_active")
            .eq("id", sub_segment_id)
            .maybeSingle()
          if (famErr) return json({ error: famErr.message }, 400)
          if (!fam) return json({ error: "Sub-segment not found" }, 404)
          if (!fam.is_active) {
            return json({ error: `"${fam.name}" is retired — reactivate it before moving CBNs into it` }, 409)
          }
          familyName = fam.name
        }

        // Via RPC, not .update().in(): PostgREST would put all 5000 CBNs in the
        // query string (a ~100 KB request line — 414 territory), and a chunked
        // loop could half-apply. The RPC is one atomic UPDATE, array in the body.
        // It writes both halves of the link; family name is null when unassigning.
        const { data: moved, error } = await admin.rpc("move_cbns_to_family", {
          p_cbns: cbns as string[],
          p_sub_segment_id: sub_segment_id ?? null,
          p_family_name: familyName,
        })
        if (error) return json({ error: error.message }, 400)

        // Report what actually moved, not what was asked for: a CBN that does
        // not exist is silently a no-op, and "moved 40" when you selected 42 is
        // a signal the caller should see rather than a rounding error.
        return json({
          ok: true,
          moved: typeof moved === "number" ? moved : 0,
          requested: cbns.length,
          family: familyName,
        })
      }

      // ── Retire / reactivate a family (Phase 9.7b) ─────────────
      // Families are NEVER deleted — standing rule, and the 9.7 lifecycle
      // model. Retire hides a family from every employee surface while keeping
      // its brochure and history intact.
      case "setSubSegmentActive": {
        const { id, is_active } = payload as { id?: number; is_active?: boolean }
        if (id == null || typeof is_active !== "boolean") {
          return json({ error: "id and is_active required" }, 400)
        }

        // Retire is only legal at zero ACTIVE CBNs. Retiring a family that
        // still holds live vehicles would vanish them from the sales catalog
        // with no trace — the CBNs stay active but their family is hidden.
        if (is_active === false) {
          const { count, error: cErr } = await admin
            .from("vehicle_catalog")
            .select("id", { count: "exact", head: true })
            .eq("sub_segment_id", id)
            .eq("is_active", true)
          if (cErr) return json({ error: cErr.message }, 400)
          if ((count ?? 0) > 0) {
            return json({
              error: `Cannot retire: ${count} active CBN${count === 1 ? "" : "s"} still assigned. ` +
                     `Move them to another family first.`,
            }, 409)
          }
        }

        const { error } = await admin
          .from("sub_segments").update({ is_active }).eq("id", id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      }

      // ── Change a family's segment (Phase 9.7b, red-team R3) ───
      // sub_segments.segment and vehicle_catalog.segment are separate columns
      // that must agree. Editing the family's segment alone recreates exactly
      // the drift the MBP Truck consolidation just cleaned up: the family says
      // one segment, its own vehicles say another, and the sales browse view
      // (which groups by the family's segment) disagrees with the admin table
      // (which shows the vehicle's).
      //
      // Same non-atomic caveat as renameSubSegment: PostgREST gives us no
      // cross-call transaction. The family row is written first, so a failure
      // leaves vehicles lagging — visible, reported, and re-runnable — rather
      // than a family stranded in a segment none of its vehicles share.
      case "setSubSegmentSegment": {
        const { id, segment } = payload as { id?: number; segment?: string }
        if (id == null || !segment?.trim()) {
          return json({ error: "id and segment are required" }, 400)
        }
        const clean = segment.trim()

        const { data: fam, error: fErr } = await admin
          .from("sub_segments").select("id, name, segment").eq("id", id).maybeSingle()
        if (fErr) return json({ error: fErr.message }, 400)
        if (!fam) return json({ error: "Sub-segment not found" }, 404)
        if (fam.segment === clean) return json({ ok: true, synced: 0, unchanged: true })

        const { error: segErr } = await admin
          .from("sub_segments").update({ segment: clean }).eq("id", id)
        if (segErr) return json({ error: segErr.message }, 400)

        const { data: synced, error: syncErr } = await admin
          .from("vehicle_catalog")
          .update({ segment: clean })
          .eq("sub_segment_id", id)
          .select("id")
        if (syncErr) {
          return json({
            ok: false,
            error: `Segment changed to "${clean}", but its CBNs did not follow: ${syncErr.message}. ` +
                   `Re-run to retry.`,
          }, 500)
        }
        return json({ ok: true, synced: synced?.length ?? 0 })
      }

      // ── Brochure upload: return a one-shot signed URL ─────────
      // Phase 9f M5 — server generates an unguessable UUID filename.
      // The client-supplied `path` is ignored entirely. The original filename
      // (for the download UX) lives on vehicle_catalog.brochure_filename and
      // is set by the client when it patches the vehicle row after upload.
      // The client POSTs the PDF directly to the signed URL — the file never
      // passes through the Edge Function (no payload size limits).
      case "signBrochureUpload": {
        const path = `${crypto.randomUUID()}.pdf`
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
