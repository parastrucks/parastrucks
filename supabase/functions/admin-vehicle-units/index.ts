// supabase/functions/admin-vehicle-units/index.ts
// Phase 10 — the Vehicle Tracker's only door. Called by the portal client via
// callEdge('admin-vehicle-units', action, payload).
//
// Every read and write of the tracker goes through here: no API role has any grant on the
// tracker tables (migration 20261021_phase10_tracker_foundation.sql), because row-level security
// hides rows, not columns, and the incentive figures must stay hidden from most tracker users.
//
// Auth: JWT required, checked with a FRESH getUser() on every call — app_metadata.tracker_access
// is read from GoTrue, never from the token's claims, so switching someone off bites on their
// next call, not when their token expires. Who may do what lives in authority.ts (ROLE_GATES is
// asked once, before any payload is read); value checks live in validate.ts / columns.ts.
//
// IMPORTANT: deploy with verify_jwt: false (the gateway rejects this project's user JWTs;
// verify() below does the real validation). Same as the other portal functions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { audit } from "../_shared/auditLog.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"
import { type Caller, gate, canSeeIncentives, canExport, canManageSharedViews, canEditView } from "./authority.ts"
import { INCENTIVE_COLUMNS, isIncentive } from "./columns.ts"
import {
  EDIT_SOURCES, isUuid, isKnownColumn, planRead, requestKey,
  validateChanges, validateFormats, validateLayoutColumns, validateValues,
} from "./validate.ts"

const PAGE = 1000          // PostgREST's row cap; `list` pages at it
const ID_CHUNK = 150       // ids per .in() filter, to keep the request URL short

type VerifyResult = { err: Response } | { caller: Caller; admin: SupabaseClient }

async function verify(req: Request): Promise<VerifyResult> {
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return { err: jsonResponse(req, { error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const userClient = createClient(url, publishableKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: jsonResponse(req, { error: "Invalid token" }, 401) }

  const admin = createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: prof, error: profErr } = await admin
    .from("users")
    .select("id, permission_level, is_active, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: { id: string; permission_level: string | null; is_active: boolean; departments: { code: string } | null } | null
      error: { message: string } | null
    }
  if (profErr) {
    console.error("verify: privileged profile read failed:", profErr.message)
    return { err: jsonResponse(req, { error: "backend_unavailable" }, 503) }
  }
  if (!prof) return { err: jsonResponse(req, { error: "Profile not found" }, 403) }

  const meta = (u.user.app_metadata ?? {}) as Record<string, unknown>
  return {
    caller: {
      id: prof.id,
      permission_level: prof.permission_level,
      department_code: prof.departments?.code ?? null,
      is_active: prof.is_active,
      tracker_access: meta.tracker_access === true,
      tracker_export: meta.tracker_export === true,
    },
    admin,
  }
}

// Postgres errors → something a person can act on. Unknown errors are not echoed.
function dbError(e: { code?: string; message?: string }): { status: number; error: string } {
  const msg = e.message ?? ""
  if (e.code === "23505") return { status: 409, error: "That chassis number is already in the book" }
  if (e.code === "23514") return { status: 400, error: "A value is outside what is allowed" }
  if (e.code?.startsWith("22")) return { status: 400, error: `A value could not be saved: ${msg}` }
  if (msg.includes("already rebilled")) return { status: 409, error: "This row was already rebilled" }
  if (msg.includes("no such row")) return { status: 404, error: "Row not found" }
  console.error("db error:", e.code, msg)
  return { status: 500, error: "The save failed on the server" }
}

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status)
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: { action?: string; payload?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  const action = String(body.action ?? "")
  const payload = (body.payload ?? {}) as Record<string, unknown>

  const auth = await verify(req)
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  const g = gate(action, caller)
  if (!g.ok) return json({ error: g.error }, g.status)

  // A grid saves every committed edit, so this is looser than the 60/min other functions use.
  const rl = await rateLimit(admin, caller.id, "admin-vehicle-units", 240, 60)
  if (!rl.allowed) return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)

  const seeIncentives = canSeeIncentives(caller)

  // Full rows for ids (the grid needs the recomputed figures after a save).
  async function rowsById(ids: string[]) {
    const out: Record<string, unknown>[] = []
    const uniq = [...new Set(ids)]
    for (let i = 0; i < uniq.length; i += ID_CHUNK) {
      const { data, error } = await admin.from("vehicle_units").select("*").in("id", uniq.slice(i, i + ID_CHUNK))
      if (error) throw error
      out.push(...(data ?? []))
    }
    return out
  }

  // Every row of a small table, page by page (notes, formats).
  async function fetchAll(table: string, select: string, orderCols: string[]) {
    const out: Record<string, unknown>[] = []
    for (let from = 0; ; from += PAGE) {
      let q = admin.from(table).select(select)
      for (const c of orderCols) q = q.order(c)
      const { data, error } = await q.range(from, from + PAGE - 1)
      if (error) throw error
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]))
      if (!data || data.length < PAGE) return out
    }
  }

  async function namesFor(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))]
    const names: Record<string, string> = {}
    for (let i = 0; i < uniq.length; i += ID_CHUNK) {
      const { data } = await admin.from("users").select("id, full_name").in("id", uniq.slice(i, i + ID_CHUNK))
      for (const u of data ?? []) names[u.id] = u.full_name
    }
    return names
  }

  try {
    switch (action) {
      // ── Read the book: one page of the layout's columns ─────────────────────────────────
      case "list": {
        const plan = planRead(payload.columns, seeIncentives)
        if (!plan.ok) return json({ error: plan.error }, 400)
        const offset = Number.isInteger(payload.offset) && (payload.offset as number) >= 0 ? payload.offset as number : 0
        const limit = Math.min(Number.isInteger(payload.limit) && (payload.limit as number) > 0 ? payload.limit as number : PAGE, PAGE)

        let q = admin.from("vehicle_units")
          .select(plan.unitCols.join(","), offset === 0 ? { count: "exact" } : undefined)
          .order("created_at").order("id")
        if (payload.includeSuperseded !== true) q = q.is("superseded_at", null)
        const { data, error, count } = await q.range(offset, offset + limit - 1)
        if (error) { const d = dbError(error); return json({ error: d.error }, d.status) }
        const rows = (data ?? []) as unknown as Record<string, unknown>[]

        if (plan.incentiveCols.length && rows.length) {
          const ids = rows.map((r) => r.id as string)
          const byUnit: Record<string, Record<string, unknown>> = {}
          for (let i = 0; i < ids.length; i += ID_CHUNK) {
            const { data: inc, error: incErr } = await admin.from("vehicle_unit_incentives")
              .select(["unit_id", ...plan.incentiveCols].join(",")).in("unit_id", ids.slice(i, i + ID_CHUNK))
            if (incErr) throw incErr
            for (const r of (inc ?? []) as unknown as Record<string, unknown>[]) byUnit[r.unit_id as string] = r
          }
          for (const r of rows) for (const k of plan.incentiveCols) r[k] = byUnit[r.id as string]?.[k] ?? null
        }
        return json({
          ok: true, rows, hidden: plan.hidden, total: count ?? undefined,
          nextOffset: rows.length < limit ? null : offset + limit,
        })
      }

      // ── Who changed what on one row ─────────────────────────────────────────────────────
      case "history": {
        if (!isUuid(payload.unit_id)) return json({ error: "unit_id required" }, 400)
        let q = admin.from("tracker_audit")
          .select("id, column_key, old_value, new_value, actor, source, batch_id, created_at")
          .eq("unit_id", payload.unit_id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200)
        if (payload.column_key !== undefined) {
          if (!isKnownColumn(payload.column_key)) return json({ error: "unknown column" }, 400)
          q = q.eq("column_key", payload.column_key as string)
        }
        const { data, error } = await q
        if (error) throw error
        const names = await namesFor((data ?? []).map((r) => r.actor))
        return json({ ok: true, history: (data ?? []).map((r) => ({ ...r, actor_name: names[r.actor] ?? null })) })
      }

      // ── Cell notes ──────────────────────────────────────────────────────────────────────
      case "listNotes": {
        let notes = await fetchAll("unit_cell_notes", "id, unit_id, column_key, body, author_id, source, created_at", ["created_at", "id"])
        if (!seeIncentives) notes = notes.filter((n) => !isIncentive(n.column_key as string))
        const names = await namesFor(notes.map((n) => n.author_id as string))
        return json({ ok: true, notes: notes.map((n) => ({ ...n, author_name: names[n.author_id as string] ?? null })) })
      }

      case "addNote": {
        const { unit_id, column_key } = payload
        const text = typeof payload.body === "string" ? payload.body.trim() : ""
        if (!isUuid(unit_id)) return json({ error: "unit_id required" }, 400)
        if (!isKnownColumn(column_key)) return json({ error: "unknown column" }, 400)
        if (isIncentive(column_key as string) && !seeIncentives) return json({ error: "Forbidden" }, 403)
        if (!text) return json({ error: "A note cannot be empty" }, 400)
        if (text.length > 2000) return json({ error: "A note is limited to 2000 characters" }, 400)
        const { data, error } = await admin.from("unit_cell_notes")
          .insert({ unit_id, column_key, body: text, author_id: caller.id, source: "portal" })
          .select("id, unit_id, column_key, body, author_id, source, created_at").single()
        if (error) { const d = error.code === "23503" ? { status: 404, error: "Row not found" } : dbError(error); return json({ error: d.error }, d.status) }
        return json({ ok: true, note: data })
      }

      // ── Cell formatting (Univer's style objects; {} = cleared) ───────────────────────────
      case "listFormats": {
        let formats = await fetchAll("unit_cell_formats", "unit_id, column_key, format", ["unit_id", "column_key"])
        if (!seeIncentives) formats = formats.filter((f) => !isIncentive(f.column_key as string))
        return json({ ok: true, formats })
      }

      case "setFormats": {
        const v = validateFormats(payload.formats)
        if (!v.ok) return json({ error: v.error }, 400)
        if (!seeIncentives && v.clean.some((f) => isIncentive(f.column_key))) return json({ error: "Forbidden" }, 403)
        const now = new Date().toISOString()
        const { error } = await admin.from("unit_cell_formats")
          .upsert(v.clean.map((f) => ({ ...f, updated_at: now, updated_by: caller.id })), { onConflict: "unit_id,column_key" })
        if (error) { const d = error.code === "23503" ? { status: 404, error: "Row not found" } : dbError(error); return json({ error: d.error }, d.status) }
        return json({ ok: true, saved: v.clean.length })
      }

      // ── Saved layouts ───────────────────────────────────────────────────────────────────
      case "listViews": {
        const { data, error } = await admin.from("tracker_views")
          .select("id, owner_id, name, columns, filters, anchor_col, updated_at")
          .or(`owner_id.is.null,owner_id.eq.${caller.id}`).order("name")
        if (error) throw error
        // A layout may name incentive columns; those who may not see them simply do not get them.
        const views = (data ?? []).map((v) => seeIncentives ? v
          : { ...v, columns: (v.columns as string[]).filter((k) => !isIncentive(k)) })
        return json({ ok: true, views })
      }

      case "saveView": {
        const name = typeof payload.name === "string" ? payload.name.trim() : ""
        if (!name || name.length > 80) return json({ error: "A layout needs a name (up to 80 characters)" }, 400)
        const colErr = validateLayoutColumns(payload.columns)
        if (colErr) return json({ error: colErr }, 400)
        const filters = payload.filters ?? {}
        if (typeof filters !== "object" || Array.isArray(filters) || JSON.stringify(filters).length > 8192) {
          return json({ error: "bad filters" }, 400)
        }
        const anchor = payload.anchor_col ?? null
        if (anchor !== null && !isKnownColumn(anchor)) return json({ error: "unknown anchor column" }, 400)
        const shared = payload.shared === true
        if (shared && !canManageSharedViews(caller)) return json({ error: "Only admin can publish a shared layout" }, 403)
        const fields = { name, columns: payload.columns, filters, anchor_col: anchor, updated_at: new Date().toISOString() }

        if (payload.id !== undefined) {
          if (!isUuid(payload.id)) return json({ error: "bad layout id" }, 400)
          const { data: cur } = await admin.from("tracker_views").select("id, owner_id").eq("id", payload.id).maybeSingle()
          if (!cur) return json({ error: "Layout not found" }, 404)
          if (!canEditView(caller, cur)) return json({ error: "Forbidden" }, 403)
          const { data, error } = await admin.from("tracker_views").update(fields).eq("id", payload.id).select().single()
          if (error) { const d = error.code === "23505" ? { status: 409, error: "A layout with that name already exists" } : dbError(error); return json({ error: d.error }, d.status) }
          return json({ ok: true, view: data })
        }
        const { data, error } = await admin.from("tracker_views")
          .insert({ ...fields, owner_id: shared ? null : caller.id }).select().single()
        if (error) { const d = error.code === "23505" ? { status: 409, error: "A layout with that name already exists" } : dbError(error); return json({ error: d.error }, d.status) }
        return json({ ok: true, view: data })
      }

      case "deleteView": {
        if (!isUuid(payload.id)) return json({ error: "bad layout id" }, 400)
        const { data: cur } = await admin.from("tracker_views").select("id, owner_id, name").eq("id", payload.id).maybeSingle()
        if (!cur) return json({ error: "Layout not found" }, 404)
        if (!canEditView(caller, cur)) return json({ error: "Forbidden" }, 403)
        const { error } = await admin.from("tracker_views").delete().eq("id", payload.id)
        if (error) throw error
        if (cur.owner_id === null) {
          await audit(admin, { actorId: caller.id, action: "tracker_shared_view_deleted", targetId: cur.id, before: { name: cur.name } })
        }
        return json({ ok: true })
      }

      // ── The only cell write path ────────────────────────────────────────────────────────
      case "applyChanges": {
        const key = requestKey(caller.id, payload.client_request_id)
        if (!key) return json({ error: "client_request_id required (8–100 characters)" }, 400)
        const source = payload.source ?? "typed"
        if (!(EDIT_SOURCES as readonly string[]).includes(source as string)) return json({ error: "unknown edit source" }, 400)
        if (payload.batch_id !== undefined && !isUuid(payload.batch_id)) return json({ error: "bad batch id" }, 400)
        const v = validateChanges(payload.changes)
        if (!v.ok) {
          if ("error" in v) return json({ error: v.error }, 400)
          // same shape as the database's refusal, so the save adapter handles one shape
          return json({ ok: false, applied: 0, conflicts: [], rejected: v.rejected, replayed: false })
        }
        const { data, error } = await admin.rpc("tracker_apply_changes", {
          p_actor: caller.id,
          p_batch: (payload.batch_id as string | undefined) ?? crypto.randomUUID(),
          p_changes: v.clean,
          p_request_id: key,
          p_source: source,
        })
        if (error) { const d = dbError(error); return json({ error: d.error }, d.status) }
        const result = data as { ok: boolean }
        // the recomputed rows, so the grid shows the new totals without a reload
        const rows = result.ok ? await rowsById(v.clean.map((c) => c.unit_id)) : []
        return json({ ...result, rows })
      }

      // ── Quick entry: one new row ────────────────────────────────────────────────────────
      case "createUnit": {
        const v = validateValues(payload.values, { requireChassis: true })
        if (!v.ok) return json({ ok: false, rejected: v.rejected })
        const { data: id, error } = await admin.rpc("tracker_create_unit", {
          p_actor: caller.id, p_batch: crypto.randomUUID(), p_values: v.clean,
        })
        if (error) { const d = dbError(error); return json({ error: d.error }, d.status) }
        const [row] = await rowsById([id as string])
        return json({ ok: true, id, row })
      }

      // ── Cancel / rebill: close the old row, open a new one, in one transaction ──────────
      case "supersedeUnit": {
        if (!isUuid(payload.unit_id)) return json({ error: "unit_id required" }, 400)
        const v = validateValues(payload.values ?? {}, { requireChassis: false })
        if (!v.ok) return json({ ok: false, rejected: v.rejected })
        const { data: id, error } = await admin.rpc("tracker_supersede_unit", {
          p_actor: caller.id, p_old: payload.unit_id, p_values: v.clean,
        })
        if (error) { const d = dbError(error); return json({ error: d.error }, d.status) }
        const rows = await rowsById([payload.unit_id as string, id as string])
        return json({ ok: true, id, rows })
      }

      // ── Export / copy: the file is built in the browser; this records that it happened ──
      case "logExport": {
        const kind = payload.kind
        if (kind !== "export" && kind !== "copy") return json({ error: "kind must be export or copy" }, 400)
        if (kind === "export" && !canExport(caller)) return json({ error: "Downloading the book needs its own permission" }, 403)
        const rows = Number.isInteger(payload.rows) ? payload.rows as number : null
        const cols = Array.isArray(payload.columns) ? (payload.columns as unknown[]).filter(isKnownColumn).slice(0, 200) : []
        await audit(admin, {
          actorId: caller.id, action: kind === "export" ? "tracker_export" : "tracker_copy",
          after: { rows, columns: cols, incentives: cols.some((k) => (INCENTIVE_COLUMNS as readonly string[]).includes(k as string)) },
        })
        return json({ ok: true })
      }
    }
    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    const d = dbError(e as { code?: string; message?: string })
    return json({ error: d.error }, d.status)
  }
})
