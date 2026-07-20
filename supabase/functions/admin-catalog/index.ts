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

// ── Segment → sales-vertical resolution (red-team-2, T2) ─────────────────────
// vehicle_catalog_select RLS scopes every sales read (catalog AND quotation
// search) on sales_vertical_id, and Phase 6b backfilled that column FROM
// segment. So the vertical is placement data: any write that moves a vehicle's
// segment must move its vertical with it, or the vehicle turns invisible to
// the destination vertical's salespeople while haunting the old vertical's.
// This map mirrors the Phase 6b backfill (20260416_phase6b_stage1_additive.sql)
// with 'MBP Truck' → 'Long Haul Trucks' per the 9.7b consolidation. Verticals
// are per-brand rows, so resolution needs the family's brand too; segments
// with no mapped vertical (or non-AL brands without one) resolve to NULL =
// visible brand-wide, same as every un-backfilled row.
const SEGMENT_VERTICAL_CODE: Record<string, string> = {
  "ICV Truck":       "icv_trucks",
  "Long Haul Trucks": "long_haulage",
  "Tipper":          "tipper",
  "RMC / Boom Pump": "tipper",
  "Bus – ICV":       "buses",
  "Bus – MCV":       "buses",
}
// Doubles as the allow-list for setSubSegmentSegment: one typo'd free-text
// segment recreates the exact blank-dropdown bug the MBP consolidation fixes.
const CATALOG_SEGMENTS = Object.keys(SEGMENT_VERTICAL_CODE)

async function resolveVerticalId(
  admin: SupabaseClient,
  brandCode: string | null,
  segment: string | null,
): Promise<string | null> {
  const code = SEGMENT_VERTICAL_CODE[segment ?? ""]
  if (!code || !brandCode) return null
  const { data: b } = await admin
    .from("brands").select("id").eq("code", brandCode).maybeSingle()
  if (!b) return null
  const { data: v } = await admin
    .from("sales_verticals").select("id")
    .eq("brand_id", b.id).eq("code", code).maybeSingle()
  return (v?.id as string | undefined) ?? null
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
        // vehicle_catalog.brand_id is NOT NULL. The form only sends the legacy
        // `brand` text code, so resolve the uuid here — the single-add path had
        // never set it (pre-9.7 bug: every "Add Vehicle" hit the NOT-NULL
        // constraint). Mirrors the import's client-side resolution.
        const brandCode = (p.brand as string) ?? "al"
        const { data: brandRow, error: brandErr } = await admin
          .from("brands").select("id").eq("code", brandCode).maybeSingle()
        if (brandErr) return json({ error: brandErr.message }, 400)
        if (!brandRow) return json({ error: `Unknown brand code "${brandCode}"` }, 400)
        const { error } = await admin.from("vehicle_catalog").insert({
          cbn: p.cbn,
          description: p.description,
          brand: brandCode,
          brand_id: brandRow.id,
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
      // Phase 9.7b3 (red-team R1) — a price circular updates PRICES. It does
      // NOT get to re-file vehicles.
      //
      // The old version upserted every column for every row, which meant the
      // spreadsheet's sub_category text overwrote whatever was in the database.
      // Two ways that bites:
      //   • After a rename, the next circular still carries the OLD family name
      //     and stamps it back over rows whose sub_segment_id points at the
      //     renamed family — so the admin table (reads text) and the sales cards
      //     (read id) disagree, and Quotation search shows the stale name.
      //   • Worse once the id is written too: a CBN an admin triaged BY HAND
      //     would be un-assigned by the next circular whose text matches no
      //     family. Every import would silently undo the triage queue.
      //
      // So the rows are split by whether the CBN already exists:
      //   • NEW      → inserted whole, including the family resolved by the
      //                client from the spreadsheet text (or null → triage).
      //   • EXISTING → only price-ish fields are updated. The family columns
      //                (sub_segment_id / sub_category / segment) are NEVER
      //                touched: a human decided those, and a human outranks a
      //                spreadsheet. Reshuffle is where they change.
      case "bulkUpsertVehicles": {
        const { rows } = payload as { rows?: Record<string, unknown>[] }
        if (!Array.isArray(rows) || rows.length === 0) {
          return json({ error: "rows array is required" }, 400)
        }
        if (rows.length > 5000) {
          return json({ error: "Max 5000 rows per import" }, 400)
        }

        const cbns = rows.map((r) => String(r.cbn ?? "")).filter(Boolean)
        if (cbns.length !== rows.length) {
          return json({ error: "Every row needs a cbn" }, 400)
        }

        // Which already exist? Chunked: a full circular is ~1000 CBNs and
        // PostgREST puts .in() values in the query string (414 risk), while the
        // response itself is capped at 1000 rows.
        const existing = new Set<string>()
        const CHUNK = 300
        for (let i = 0; i < cbns.length; i += CHUNK) {
          const slice = cbns.slice(i, i + CHUNK)
          const { data, error } = await admin
            .from("vehicle_catalog").select("cbn").in("cbn", slice)
          if (error) return json({ error: error.message }, 400)
          for (const r of data ?? []) existing.add(r.cbn as string)
        }

        const toInsert = rows.filter((r) => !existing.has(String(r.cbn)))
        const toUpdate = rows.filter((r) =>  existing.has(String(r.cbn)))

        let inserted = 0
        if (toInsert.length > 0) {
          const { error } = await admin.from("vehicle_catalog").insert(toInsert)
          if (error) return json({ error: error.message }, 400)
          inserted = toInsert.length
        }

        // Price-ish only. Anything not on this list is left exactly as it is.
        // gst_rate and is_active are deliberately NOT here: a price circular
        // re-listing a hand-deactivated CBN must never resurrect it, and no
        // circular carries a GST column — both were being stamped with client
        // defaults (true / 18) on every imported row. Server-enforced so even
        // a stale client can't reintroduce it.
        const PRICE_FIELDS = [
          "description", "tyres", "mrp_incl_gst",
          "price_circular", "effective_date",
        ]
        let updated = 0
        for (const r of toUpdate) {
          const patch: Record<string, unknown> = {}
          for (const k of PRICE_FIELDS) if (k in r) patch[k] = r[k]
          if (Object.keys(patch).length === 0) continue
          const { error } = await admin
            .from("vehicle_catalog").update(patch).eq("cbn", String(r.cbn))
          if (error) return json({ error: error.message }, 400)
          updated++
        }

        return json({ ok: true, inserted, updated, count: inserted + updated })
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
        // The name fans out into sub_category on every linked CBN — cap it
        // before a pathological value is written hundreds of times.
        if (clean.length > 120) {
          return json({ error: "Name too long (max 120 characters)" }, 400)
        }

        const { data: existing, error: exErr } = await admin
          .from("sub_segments").select("id, name").eq("id", id).maybeSingle()
        if (exErr) return json({ error: exErr.message }, 400)
        if (!existing) return json({ error: "Sub-segment not found" }, 404)

        // NO unchanged-value early-return (red-team-2 T6): the rename is two
        // non-atomic writes (family row, then CBN text), so "the family
        // already says X" does not imply its CBNs do. The old early-return
        // made the advertised recovery ("re-run the rename to retry") a
        // silent no-op. Falling through to the sync makes a re-run — and
        // every ordinary save — the repair tool; both writes are idempotent.
        if (existing.name !== clean) {
          // sub_segments.name is UNIQUE — surface the collision as a clean 409
          // instead of a raw Postgres constraint error. The new name is
          // escaped (%/_ are ILIKE wildcards — red-team-2 H1: unescaped, a
          // name like "Haulage_19T" matched unrelated families and blocked
          // legitimate renames), limit(1) so multiple matches can't error out
          // of maybeSingle, and the error is surfaced, not discarded.
          const pat = clean.replace(/[%_\\]/g, (m) => "\\" + m)
          const { data: clash, error: clashErr } = await admin
            .from("sub_segments").select("id").ilike("name", pat).neq("id", id)
            .limit(1).maybeSingle()
          if (clashErr) return json({ error: clashErr.message }, 400)
          if (clash) return json({ error: `A sub-segment named "${clean}" already exists` }, 409)

          const { error: nameErr } = await admin
            .from("sub_segments").update({ name: clean }).eq("id", id)
          if (nameErr) return json({ error: nameErr.message }, 400)
        }

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
        let familySegment: string | null = null
        let familyVertical: string | null = null
        if (sub_segment_id !== null && sub_segment_id !== undefined) {
          if (!Number.isInteger(sub_segment_id)) {
            return json({ error: "sub_segment_id must be an integer or null" }, 400)
          }
          const { data: fam, error: famErr } = await admin
            .from("sub_segments")
            .select("id, name, segment, is_active, brand")
            .eq("id", sub_segment_id)
            .maybeSingle()
          if (famErr) return json({ error: famErr.message }, 400)
          if (!fam) return json({ error: "Sub-segment not found" }, 404)
          if (!fam.is_active) {
            return json({ error: `"${fam.name}" is retired — reactivate it before moving CBNs into it` }, 409)
          }
          familyName = fam.name
          // The destination's segment travels with the move. Without this, a CBN
          // moved across segments keeps its old one and the family disagrees with
          // its own vehicles — the exact drift the MBP consolidation cleaned up.
          familySegment = fam.segment
          // …and the vertical travels with the segment (RLS scopes sales reads
          // on it — see SEGMENT_VERTICAL_CODE above).
          familyVertical = await resolveVerticalId(admin, fam.brand, fam.segment)
        }

        // Via RPC, not .update().in(): PostgREST would put all 5000 CBNs in the
        // query string (a ~100 KB request line — 414 territory), and a chunked
        // loop could half-apply. The RPC is one atomic UPDATE, array in the body.
        // It writes both halves of the link; family name is null when unassigning.
        const { data: moved, error } = await admin.rpc("move_cbns_to_family", {
          p_cbns: cbns as string[],
          p_sub_segment_id: sub_segment_id ?? null,
          p_family_name: familyName,
          p_segment: familySegment,  // null on unassign — the RPC keeps the old segment
          p_sales_vertical_id: familyVertical,  // applied on real moves only (see RPC)
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
        // Pinned to the known list: one typo'd free-text segment recreates the
        // exact blank-dropdown bug the MBP consolidation fixes (red-team-2 H10).
        if (!CATALOG_SEGMENTS.includes(clean)) {
          return json({ error: `Unknown segment "${clean}" — must be one of: ${CATALOG_SEGMENTS.join(", ")}` }, 400)
        }

        const { data: fam, error: fErr } = await admin
          .from("sub_segments").select("id, name, segment, brand").eq("id", id).maybeSingle()
        if (fErr) return json({ error: fErr.message }, 400)
        if (!fam) return json({ error: "Sub-segment not found" }, 404)

        // NO unchanged-value early-return (red-team-2 T6): the two writes below
        // are not atomic, so "family already says X" does NOT imply its CBNs
        // do. The old early-return made the advertised recovery ("re-run to
        // retry") a silent no-op — a failed sync became unrepairable from the
        // UI. Falling through makes a re-run the repair tool it claims to be;
        // both writes are idempotent.
        if (fam.segment !== clean) {
          const { error: segErr } = await admin
            .from("sub_segments").update({ segment: clean }).eq("id", id)
          if (segErr) return json({ error: segErr.message }, 400)
        }

        // The vertical travels with the segment (RLS scopes every sales read
        // on sales_vertical_id — see SEGMENT_VERTICAL_CODE above).
        const vertical = await resolveVerticalId(admin, fam.brand, clean)
        const { data: synced, error: syncErr } = await admin
          .from("vehicle_catalog")
          .update({ segment: clean, sales_vertical_id: vertical })
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

      // ── Cover thumbnail upload (Phase 9.7c c2, R7) ────────────
      // A separate action from signBrochureUpload: covers are .webp, not .pdf.
      // Same private `brochures` bucket (its RLS keys on bucket_id, not path),
      // so a cover is exactly as protected as the brochure it was rendered from.
      // The client renders page 1 via pdfjs and PUTs the webp to this URL.
      case "signCoverUpload": {
        const path = `${crypto.randomUUID()}.webp`
        const { data, error } = await admin.storage
          .from("brochures")
          .createSignedUploadUrl(path)
        if (error || !data) {
          return json({ error: error?.message || "Failed to sign cover upload" }, 400)
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
