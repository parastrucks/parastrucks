// supabase/functions/service-jobs/index.ts
// Phase 9.5 — Service Team outside-workshop job tracker.
// Called by the portal client via callEdge('service-jobs', action, payload).
//
// Auth: JWT required. Caller must be a "portal user" (service/accounts dept, any
// manager+, or admin). Per-action authority is enforced below — NOT just the
// dept-code token, because "managers and above" is a permission_level concept.
//
// IMPORTANT: deploy with verify_jwt: false (gateway rejects this project's user
// JWTs; verify() below does the real validation). Mirrors admin-catalog.
//
// All writes flow through here so we can enforce entity-ownership (no IDOR),
// per-action authority, and an append-only audit trail. Reads are direct
// supabase-js under RLS on the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { audit } from "../_shared/auditLog.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"

type Caller = {
  id: string
  full_name: string
  designation: string | null
  permission_level: string | null
  entity_id: string | null
  department_code: string | null
  is_active: boolean
}

type VerifyResult = { err: Response } | { caller: Caller; admin: SupabaseClient }

const SPINE = ["po_generated", "work_completed", "invoice_received"] as const

// ── Authority helpers ──────────────────────────────────────────────
const isAdmin       = (c: Caller) => c.permission_level === "admin"
const isManagerPlus = (c: Caller) => ["manager", "gm", "admin"].includes(c.permission_level ?? "")
const isGmPlus      = (c: Caller) => ["gm", "admin"].includes(c.permission_level ?? "")
const isAccounts    = (c: Caller) => isAdmin(c) || c.department_code === "accounts"
const isPortalUser  = (c: Caller) =>
  isAdmin(c) || isManagerPlus(c) || ["service", "accounts"].includes(c.department_code ?? "")
const isAW = (j: { job_type: string; repair_type: string }) =>
  j.job_type === "ancillary" && j.repair_type === "warranty"

async function verify(req: Request): Promise<VerifyResult> {
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) return { err: jsonResponse(req, { error: "Missing auth" }, 401) }
  const jwt = authHeader.replace("Bearer ", "")

  const url = Deno.env.get("SUPABASE_URL")!
  const anon = publishableKey()
  const service = secretKey()

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: u, error: uErr } = await userClient.auth.getUser(jwt)
  if (uErr || !u?.user) return { err: jsonResponse(req, { error: "Invalid token" }, 401) }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: prof, error: profErr } = await admin
    .from("users")
    .select("id, full_name, permission_level, entity_id, is_active, departments(code), designations(name)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: {
        id: string
        full_name: string | null
        permission_level: string | null
        entity_id: string | null
        is_active: boolean
        departments: { code: string } | null
        designations: { name: string } | null
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

  const caller: Caller = {
    id: prof.id,
    full_name: prof.full_name ?? "",
    designation: prof.designations?.name ?? null,
    permission_level: prof.permission_level,
    entity_id: prof.entity_id,
    department_code: prof.departments?.code ?? null,
    is_active: prof.is_active,
  }
  if (!isPortalUser(caller)) return { err: jsonResponse(req, { error: "Forbidden" }, 403) }
  return { caller, admin }
}

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => jsonResponse(req, b, status)
  if (req.method === "OPTIONS") return preflight(req)
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: { action?: string; payload?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  const action = body.action
  const payload = body.payload ?? {}

  const auth = await verify(req)
  if ("err" in auth) return auth.err
  const { caller, admin } = auth

  const rl = await rateLimit(admin, caller.id, "service-jobs")
  if (!rl.allowed) return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)

  // Shared chokepoint: load a job, enforce entity-ownership + (optionally) not-closed.
  async function loadJob(jobId: unknown, opts: { allowClosed?: boolean } = {}) {
    if (!jobId || typeof jobId !== "string") return { err: json({ error: "jobId required" }, 400) }
    const { data: job, error } = await admin.from("service_jobs").select("*").eq("id", jobId).maybeSingle()
    if (error) return { err: json({ error: error.message }, 400) }
    if (!job) return { err: json({ error: "Job not found" }, 404) }
    if (!isAdmin(caller) && job.entity_id !== caller.entity_id) {
      return { err: json({ error: "Forbidden" }, 403) }
    }
    if (job.closed_at && !opts.allowClosed && !isAdmin(caller)) {
      return { err: json({ error: "Job is closed (read-only)" }, 409) }
    }
    return { job }
  }

  function logEvent(
    jobId: string, type: string,
    extra: { from?: string | null; to?: string | null; note?: string | null; reverted?: string | null } = {},
  ) {
    return admin.from("service_job_events").insert({
      job_id: jobId, actor_id: caller.id, event_type: type,
      from_value: extra.from ?? null, to_value: extra.to ?? null,
      note: extra.note ?? null, reverted_event_id: extra.reverted ?? null,
    })
  }

  // Milestone-driven closure (cancel sets closed_at directly elsewhere).
  async function recomputeClosure(jobId: string) {
    const { data: j } = await admin.from("service_jobs")
      .select("job_type, repair_type, payment_done_at, settlement_status, closed_at, cancelled_at")
      .eq("id", jobId).maybeSingle()
    if (!j || j.closed_at || j.cancelled_at) return
    const complete = isAW(j)
      ? j.settlement_status === "warranty_processed"
      : (j.payment_done_at != null && j.settlement_status != null)
    if (!complete) return
    const { data: updated } = await admin.from("service_jobs")
      .update({ closed_at: new Date().toISOString(), final_outcome: "completed" })
      .eq("id", jobId).is("closed_at", null).select("id").maybeSingle()
    if (updated) await logEvent(jobId, "closed", { to: "completed" })
  }

  try {
    switch (action) {
      // ── Vendors (managers+ only) ───────────────────────────────
      case "createVendor": {
        if (!isManagerPlus(caller)) return json({ error: "Forbidden" }, 403)
        const p = payload as Record<string, unknown>
        if (!p.name || typeof p.name !== "string") return json({ error: "name is required" }, 400)
        const isAuthorized = p.is_authorized === true
        if (isAuthorized && (!p.oem || typeof p.oem !== "string")) return json({ error: "OEM is required for an authorized dealer" }, 400)
        const { data, error } = await admin.from("service_vendors").insert({
          entity_id: caller.entity_id,
          name: p.name,
          is_authorized: isAuthorized,
          oem: isAuthorized ? p.oem : null, // general vendors never carry an OEM
          address: p.address ?? null,
          gstin: p.gstin ?? null,
          contact: p.contact ?? null,
          created_by: caller.id,
        }).select("*").single()
        if (error) return json({ error: error.message }, 400)
        await audit(admin, { actorId: caller.id, action: "service_vendor_created", targetId: data.id, after: data })
        return json({ ok: true, vendor: data })
      }

      case "updateVendor": {
        if (!isManagerPlus(caller)) return json({ error: "Forbidden" }, 403)
        const { id, update } = payload as { id?: string; update?: Record<string, unknown> }
        if (!id || !update) return json({ error: "Missing id or update" }, 400)
        const { data: existing } = await admin.from("service_vendors").select("*").eq("id", id).maybeSingle()
        if (!existing) return json({ error: "Vendor not found" }, 404)
        if (!isAdmin(caller) && existing.entity_id !== caller.entity_id) return json({ error: "Forbidden" }, 403)
        const allowed = ["name", "oem", "is_authorized", "address", "gstin", "contact", "is_active"]
        const clean: Record<string, unknown> = {}
        for (const k of allowed) if (k in update) clean[k] = update[k]
        if (Object.keys(clean).length === 0) return json({ error: "No valid fields" }, 400)
        // Keep oem consistent with authorization: authorized ⇒ oem required; general ⇒ oem cleared.
        const willBeAuthorized = "is_authorized" in clean ? clean.is_authorized === true : existing.is_authorized
        if (willBeAuthorized) {
          const oem = "oem" in clean ? clean.oem : existing.oem
          if (!oem) return json({ error: "OEM is required for an authorized dealer" }, 400)
        } else if (willBeAuthorized === false) {
          clean.oem = null
        }
        const { data, error } = await admin.from("service_vendors").update(clean).eq("id", id).select("*").single()
        if (error) return json({ error: error.message }, 400)
        await audit(admin, { actorId: caller.id, action: "service_vendor_updated", targetId: id, before: existing, after: data })
        return json({ ok: true, vendor: data })
      }

      // ── Create job (all portal users) ──────────────────────────
      case "createJob": {
        const p = payload as Record<string, unknown>
        const jobType = p.job_type, repairType = p.repair_type
        if (jobType !== "outside" && jobType !== "ancillary") return json({ error: "invalid job_type" }, 400)
        if (repairType !== "warranty" && repairType !== "paid") return json({ error: "invalid repair_type" }, 400)
        if (!p.vehicle_registration_no || typeof p.vehicle_registration_no !== "string") {
          return json({ error: "vehicle_registration_no is required" }, 400)
        }
        if (!p.customer_name) return json({ error: "customer_name is required" }, 400)
        if (!p.vendor_id) return json({ error: "vendor is required" }, 400)
        const aw = jobType === "ancillary" && repairType === "warranty"
        // customer_name is a common column now; these are the AW-letter-only extras.
        const letterCols = ["chassis_no", "engine_no", "km_hrs", "date_of_sale",
          "model", "make", "complaint_date", "complaint", "check_item", "serial_no", "qty"]
        if (aw) {
          for (const k of ["chassis_no", "engine_no", "check_item"]) {
            if (!p[k]) return json({ error: `${k} is required for ancillary warranty` }, 400)
          }
        }
        // Material-out defaults to today and is compulsory; material-returned is auto-set
        // on advance to work_completed; ancillary_ref is added later (post AL-portal upload).
        const today = new Date().toISOString().slice(0, 10)

        // Vendor snapshot (must belong to caller's entity).
        let vName = null, vGstin = null, vAddr = null, vOem = null
        if (p.vendor_id) {
          const { data: v } = await admin.from("service_vendors")
            .select("id, entity_id, name, gstin, address, oem").eq("id", p.vendor_id).maybeSingle()
          if (!v) return json({ error: "Vendor not found" }, 400)
          if (!isAdmin(caller) && v.entity_id !== caller.entity_id) return json({ error: "Vendor not in your entity" }, 403)
          vName = v.name; vGstin = v.gstin; vAddr = v.address; vOem = v.oem
        }

        const job: Record<string, unknown> = {
          brand_id: p.brand_id ?? null,
          vehicle_registration_no: p.vehicle_registration_no,
          customer_name: p.customer_name,
          job_type: jobType,
          repair_type: repairType,
          job_description: p.job_description ?? null,
          vendor_id: p.vendor_id ?? null,
          vendor_name_snapshot: vName,
          vendor_gstin_snapshot: vGstin,
          vendor_address_snapshot: vAddr,
          vendor_oem_snapshot: vOem,
          ancillary_ref: null,                          // set later, post AL-portal upload
          material_out_date: p.material_out_date || today,
          material_return_date: null,                   // auto-set on work_completed
        }
        // Letter fields only on AW; stripped otherwise (no stray data on simple jobs).
        for (const k of letterCols) job[k] = aw ? (p[k] ?? null) : null

        const clientRequestId = (p.client_request_id as string) ?? null
        const { data, error } = await admin.rpc("create_service_job", {
          p_created_by: caller.id,
          p_created_by_name: caller.full_name,
          p_created_by_designation: caller.designation,
          p_entity_id: caller.entity_id,
          p_client_request_id: clientRequestId,
          p_job: job,
        })
        if (error) return json({ error: error.message }, 400)
        const row = Array.isArray(data) ? data[0] : data
        if (!row?.idempotent) {
          await audit(admin, { actorId: caller.id, action: "service_job_created", targetId: row.id, after: { po_number: row.po_number, ...job } })
        }
        return json({ ok: true, id: row.id, po_number: row.po_number, idempotent: !!row.idempotent })
      }

      // ── Edit job data (all portal users) ───────────────────────
      case "updateJob": {
        const { id, update } = payload as { id?: string; update?: Record<string, unknown> }
        if (!update) return json({ error: "Missing update" }, 400)
        const r = await loadJob(id); if ("err" in r) return r.err
        const job = r.job
        // Whitelist: data + (letter fields only if the job is AW). Lifecycle,
        // ownership, numbering, closure, and job_type/repair_type are excluded.
        const base = ["vehicle_registration_no", "customer_name", "job_description", "ancillary_ref",
          "material_out_date", "material_return_date"]
        const letterCols = ["chassis_no", "engine_no", "km_hrs", "date_of_sale",
          "model", "make", "complaint_date", "complaint", "check_item", "serial_no", "qty"]
        const allowed = isAW(job) ? [...base, ...letterCols] : base
        const clean: Record<string, unknown> = {}
        for (const k of allowed) if (k in update) clean[k] = update[k]
        // Re-snapshot vendor if changed.
        if ("vendor_id" in update) {
          const vid = update.vendor_id
          if (vid) {
            const { data: v } = await admin.from("service_vendors")
              .select("id, entity_id, name, gstin, address, oem").eq("id", vid).maybeSingle()
            if (!v) return json({ error: "Vendor not found" }, 400)
            if (!isAdmin(caller) && v.entity_id !== caller.entity_id) return json({ error: "Vendor not in your entity" }, 403)
            clean.vendor_id = v.id; clean.vendor_name_snapshot = v.name
            clean.vendor_gstin_snapshot = v.gstin; clean.vendor_address_snapshot = v.address; clean.vendor_oem_snapshot = v.oem
          } else {
            clean.vendor_id = null; clean.vendor_name_snapshot = null
            clean.vendor_gstin_snapshot = null; clean.vendor_address_snapshot = null; clean.vendor_oem_snapshot = null
          }
        }
        if (Object.keys(clean).length === 0) return json({ error: "No valid fields" }, 400)
        // Ancillary portal ref is captured only after the work is completed (post AL-portal upload).
        if ("ancillary_ref" in clean && job.stage === "po_generated") {
          return json({ error: "Ancillary portal ref can be added only after work is completed" }, 400)
        }
        const { error } = await admin.from("service_jobs").update(clean).eq("id", id)
        if (error) return json({ error: error.message }, 400)
        await logEvent(id as string, "update", { note: Object.keys(clean).join(",") })
        await audit(admin, { actorId: caller.id, action: "service_job_updated", targetId: id, before: job, after: clean })
        return json({ ok: true })
      }

      // ── Advance spine ──────────────────────────────────────────
      // Advancing to work_completed is open to any portal user (incl. service
      // executives — they run the physical job). Advancing to invoice_received
      // stays manager+.
      case "advanceStage": {
        const { jobId, toStage } = payload as { jobId?: string; toStage?: string }
        if (toStage === "invoice_received" && !isManagerPlus(caller)) {
          return json({ error: "Forbidden — only managers can mark invoice received" }, 403)
        }
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const job = r.job
        const curIdx = SPINE.indexOf(job.stage)
        const nextIdx = SPINE.indexOf(toStage as typeof SPINE[number])
        if (nextIdx === -1) return json({ error: "invalid toStage" }, 400)
        if (nextIdx !== curIdx + 1) return json({ error: "stage must advance one step forward" }, 400)
        if (isAW(job) && toStage === "invoice_received") {
          return json({ error: "Ancillary warranty caps at work_completed" }, 400)
        }
        // Material returned is auto-stamped when work is completed (the part is back).
        const stageUpd: Record<string, unknown> = { stage: toStage }
        if (toStage === "work_completed" && !job.material_return_date) {
          stageUpd.material_return_date = new Date().toISOString().slice(0, 10)
        }
        const { error } = await admin.from("service_jobs").update(stageUpd).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "advance_stage", { from: job.stage, to: toStage,
          note: stageUpd.material_return_date ? `material returned ${stageUpd.material_return_date}` : null })
        await audit(admin, { actorId: caller.id, action: "service_job_advance_stage", targetId: jobId, before: { stage: job.stage }, after: { stage: toStage } })
        return json({ ok: true })
      }

      // ── Material dates (all portal users) ──────────────────────
      case "setMaterialDates": {
        const { jobId } = payload as { jobId?: string; out?: string | null; return?: string | null }
        const p = payload as Record<string, unknown>
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const clean: Record<string, unknown> = {}
        if ("out" in p) clean.material_out_date = p.out ?? null
        if ("return" in p) clean.material_return_date = p.return ?? null
        if (Object.keys(clean).length === 0) return json({ error: "No dates supplied" }, 400)
        const { error } = await admin.from("service_jobs").update(clean).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "material_dates", {
          note: `out=${clean.material_out_date ?? "—"} return=${clean.material_return_date ?? "—"}`,
        })
        await audit(admin, { actorId: caller.id, action: "service_job_material_dates", targetId: jobId, after: clean })
        return json({ ok: true })
      }

      // ── Vendor payout (accounts) ───────────────────────────────
      case "markPaymentDone": {
        if (!isAccounts(caller)) return json({ error: "Forbidden" }, 403)
        const { jobId } = payload as { jobId?: string }
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const job = r.job
        if (isAW(job)) return json({ error: "No vendor payment for ancillary warranty" }, 400)
        if (job.stage !== "invoice_received") return json({ error: "Requires stage invoice_received" }, 400)
        if (job.payment_done_at) return json({ error: "Payment already marked done" }, 409)
        const { error } = await admin.from("service_jobs")
          .update({ payment_done_at: new Date().toISOString(), payment_done_by: caller.id }).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "payment_done", { to: "payment_done" })
        await audit(admin, { actorId: caller.id, action: "service_job_payment_done", targetId: jobId })
        await recomputeClosure(jobId as string)
        return json({ ok: true })
      }

      // ── Settlement (warranty=managers+, paid=accounts) ─────────
      case "setSettlement": {
        const { jobId } = payload as { jobId?: string }
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const job = r.job
        if (job.settlement_status) return json({ error: "Settlement already recorded" }, 409)
        let status: "warranty_processed" | "payment_received"
        if (job.repair_type === "warranty") {
          if (!isManagerPlus(caller)) return json({ error: "Forbidden — warranty approval is manager+" }, 403)
          const reqStage = isAW(job) ? "work_completed" : "invoice_received"
          if (job.stage !== reqStage) return json({ error: `Requires stage ${reqStage}` }, 400)
          status = "warranty_processed"
        } else {
          if (!isAccounts(caller)) return json({ error: "Forbidden — payment is accounts" }, 403)
          if (job.stage !== "invoice_received") return json({ error: "Requires stage invoice_received" }, 400)
          status = "payment_received"
        }
        const { error } = await admin.from("service_jobs")
          .update({ settlement_status: status, settlement_at: new Date().toISOString(), settlement_by: caller.id })
          .eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "settlement", { to: status })
        await audit(admin, { actorId: caller.id, action: "service_job_settlement", targetId: jobId, after: { settlement_status: status } })
        await recomputeClosure(jobId as string)
        return json({ ok: true })
      }

      // ── Cancel (managers+) ─────────────────────────────────────
      case "cancelJob": {
        if (!isManagerPlus(caller)) return json({ error: "Forbidden" }, 403)
        const { jobId, reason } = payload as { jobId?: string; reason?: string }
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const { error } = await admin.from("service_jobs").update({
          cancelled_at: new Date().toISOString(), cancelled_by: caller.id,
          cancel_reason: reason ?? null, final_outcome: "cancelled", closed_at: new Date().toISOString(),
        }).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "cancel", { to: "cancelled", note: reason ?? null })
        await audit(admin, { actorId: caller.id, action: "service_job_cancel", targetId: jobId, after: { final_outcome: "cancelled" } })
        return json({ ok: true })
      }

      // ── Convert warranty → paid (managers+) ────────────────────
      case "convertToPaid": {
        if (!isManagerPlus(caller)) return json({ error: "Forbidden" }, 403)
        const { jobId } = payload as { jobId?: string }
        const r = await loadJob(jobId); if ("err" in r) return r.err
        const job = r.job
        if (job.repair_type !== "warranty") return json({ error: "Only warranty jobs can convert to paid" }, 400)
        const { error } = await admin.from("service_jobs").update({ repair_type: "paid" }).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "convert_to_paid", { from: "warranty", to: "paid" })
        await audit(admin, { actorId: caller.id, action: "service_job_convert_to_paid", targetId: jobId, before: { repair_type: "warranty" }, after: { repair_type: "paid" } })
        return json({ ok: true })
      }

      // ── Undo last status change (gm/admin only) ────────────────
      case "undoLastStatus": {
        if (!isGmPlus(caller)) return json({ error: "Forbidden — undo is gm/admin only" }, 403)
        const { jobId } = payload as { jobId?: string }
        const r = await loadJob(jobId, { allowClosed: true }); if ("err" in r) return r.err
        const job = r.job

        // Latest undoable event not already reverted.
        const undoable = ["advance_stage", "payment_done", "settlement", "convert_to_paid", "cancel"]
        const { data: reverted } = await admin
          .from("service_job_events").select("reverted_event_id")
          .eq("job_id", jobId).not("reverted_event_id", "is", null)
        const revertedIds = new Set((reverted ?? []).map((e: { reverted_event_id: string }) => e.reverted_event_id))
        const { data: events } = await admin.from("service_job_events")
          .select("*").eq("job_id", jobId).in("event_type", undoable)
          .order("created_at", { ascending: false })
        const target = (events ?? []).find((e: { id: string }) => !revertedIds.has(e.id))
        if (!target) return json({ error: "Nothing to undo" }, 400)

        const upd: Record<string, unknown> = {}
        switch (target.event_type) {
          case "advance_stage":   upd.stage = target.from_value; break
          case "payment_done":    upd.payment_done_at = null; upd.payment_done_by = null; break
          case "settlement":      upd.settlement_status = null; upd.settlement_at = null; upd.settlement_by = null; break
          case "convert_to_paid": upd.repair_type = target.from_value; break // back to 'warranty'
          case "cancel":          upd.cancelled_at = null; upd.cancelled_by = null; upd.cancel_reason = null; break
        }

        // Recompute closure after reversal (clear if no longer complete / un-cancel).
        const after = { ...job, ...upd }
        const complete = after.cancelled_at == null && (isAW(after)
          ? after.settlement_status === "warranty_processed"
          : (after.payment_done_at != null && after.settlement_status != null))
        if (!complete) { upd.closed_at = null; upd.final_outcome = null }

        const { error } = await admin.from("service_jobs").update(upd).eq("id", jobId)
        if (error) return json({ error: error.message }, 400)
        await logEvent(jobId as string, "undo", {
          from: target.to_value, to: target.from_value, reverted: target.id,
          note: `undo of ${target.event_type}`,
        })
        await audit(admin, { actorId: caller.id, action: "service_job_undo", targetId: jobId, before: job, after: upd })
        return json({ ok: true, undone: target.event_type })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message || "Internal error" }, 500)
  }
})
