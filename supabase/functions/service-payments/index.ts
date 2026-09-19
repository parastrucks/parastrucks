// supabase/functions/service-payments/index.ts
// Service Payments — the single write path for UPI→invoice matching.
//
// Called by the portal client via callEdge('service-payments', action, payload).
//
// Auth: JWT required. Caller must be in the SERVICE or ACCOUNTS department, or
// the admin. Rank never grants entry on its own: a Sales GM is a GM, but not
// one who owns service customers' credit. Per-action authority is the plan's
// ladder (docs/backlog/service-payments-plan.md, "Authority ladder").
//
// IMPORTANT: deploy with verify_jwt: false (the gateway rejects this project's
// user JWTs; verify() below does the real validation). Mirrors service-jobs.
//
// WHY EVERY WRITE COMES THROUGH HERE. The money tables grant no INSERT, UPDATE
// or DELETE to `authenticated` — not even to admin — so there is no PostgREST
// path to them at all. Writes happen only inside SECURITY DEFINER RPCs called
// with the service role from this function, which is also the only place that
// can check the caller's entity before the RPC trusts it. Reads are direct
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
  permission_level: string | null
  entity_id: string | null
  department_code: string | null
  is_active: boolean
}

type VerifyResult = { err: Response } | { caller: Caller; admin: SupabaseClient }

// ── Authority ──────────────────────────────────────────────────────
// Department first, then rank. The first draft admitted every manager and GM
// in the company — Sales, HR, Back Office — and then let "any manager" void
// receipts, key cash, close TDS and declassify money, the four verbs the plan
// gives to accounts alone. Found reading the code before its first real call
// (2026-09-19); on prod that was 4 Sales managers, 2 GMs outside service and
// accounts, and an HR manager, none of whom the plan lets near this ledger.
const PAYMENTS_DEPTS = ["service", "accounts"]
const isAdmin    = (c: Caller) => c.permission_level === "admin"
const inScope    = (c: Caller) => isAdmin(c) || PAYMENTS_DEPTS.includes(c.department_code ?? "")
const isAccounts = (c: Caller) => isAdmin(c) || c.department_code === "accounts"
// Safe ONLY because verify() refuses everyone outside PAYMENTS_DEPTS first:
// past that gate, "gm" can only mean the service or accounts GM.
const isGmPlus   = (c: Caller) => ["gm", "admin"].includes(c.permission_level ?? "")
// Service executives match UPI — that IS their job, and it is the whole reason
// this feature is phone-first. They cannot do anything that moves money out of
// the ordinary path: no reversals of exported work, no TDS, no voids.

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
    .select("id, full_name, permission_level, entity_id, is_active, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: {
        id: string
        full_name: string | null
        permission_level: string | null
        entity_id: string | null
        is_active: boolean
        departments: { code: string } | null
      } | null
      error: { message: string } | null
    }

  // A dead or rejected privileged key makes PostgREST return 401, which
  // supabase-js reports as an error rather than throwing. Without this guard
  // prof is null and the caller is told "Profile not found" — i.e. blamed for a
  // platform failure.
  if (profErr) {
    console.error("verify: privileged profile read failed:", profErr.message)
    return { err: jsonResponse(req, { error: "backend_unavailable" }, 503) }
  }
  if (!prof) return { err: jsonResponse(req, { error: "Profile not found" }, 403) }
  if (!prof.is_active) return { err: jsonResponse(req, { error: "Account inactive" }, 403) }

  const caller: Caller = {
    id: prof.id,
    full_name: prof.full_name ?? "",
    permission_level: prof.permission_level,
    entity_id: prof.entity_id,
    department_code: prof.departments?.code ?? null,
    is_active: prof.is_active,
  }
  if (!inScope(caller)) {
    return { err: jsonResponse(req, { error: "Service payments is for the service and accounts teams." }, 403) }
  }
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

  const rl = await rateLimit(admin, caller.id, "service-payments")
  if (!rl.allowed) return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)

  // THE entity chokepoint. Every RPC below takes p_entity_id, and it is taken
  // from the caller's PROFILE, never from the request body — otherwise any
  // authenticated user could post another entity's id and move its money.
  // Admin is the one account that may name an entity explicitly, because the
  // singleton admin has no entity of their own.
  const entityId = isAdmin(caller)
    ? (typeof payload.entity_id === "string" ? payload.entity_id : caller.entity_id)
    : caller.entity_id
  if (!entityId) return json({ error: "No entity on this account" }, 403)

  // A PL/pgSQL RAISE arrives as a PostgREST error. Its message is written for a
  // person ("this receipt still settles 2 bills; reverse those first"), so pass
  // it through rather than replacing it with a generic failure.
  const rpc = async (fn: string, args: Record<string, unknown>, ok = 200) => {
    const { data, error } = await admin.rpc(fn, args)
    if (error) {
      console.error(`${fn} failed:`, error.message)
      return json({ ok: false, error: error.message }, 400)
    }
    return json({ ok: true, ...(data as Record<string, unknown>) }, ok)
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

  try {
    switch (action) {
      // ── Matching. The high-frequency flow, and the only one a service
      // executive can reach. Deliberately NOT step-up authenticated: asking for
      // a password every few taps is how a phone-first tool gets abandoned.
      case "allocate": {
        const receiptId = str(payload.receipt_id)
        const targets = payload.targets
        if (!receiptId) return json({ error: "receipt_id required" }, 400)
        if (!Array.isArray(targets) || targets.length === 0) {
          return json({ error: "targets must be a non-empty array" }, 400)
        }
        if (targets.length > 25) return json({ error: "too many invoices in one confirm" }, 400)
        // Service staff match UPI. Cash, cheque and bank receipts are keyed by
        // accounts and matched by accounts (plan: "non-UPI allocation — accounts").
        if (!isAccounts(caller)) {
          const { data: rcpt, error: rErr } = await admin
            .from("payment_receipts").select("mode")
            .eq("id", receiptId).eq("entity_id", entityId).maybeSingle()
          if (rErr) return json({ error: rErr.message }, 400)
          if (!rcpt) return json({ error: "Receipt not found" }, 404)
          if (rcpt.mode !== "upi") {
            return json({ error: "Accounts matches cash, cheque and bank receipts." }, 403)
          }
        }
        return await rpc("payments_allocate", {
          p_entity_id: entityId,
          p_receipt_id: receiptId,
          p_targets: targets,
          p_actor: caller.id,
          p_client_request_id: str(payload.client_request_id),
          p_match_signal: str(payload.match_signal),
        })
      }

      case "on_account": {
        // Parking money against a group (an advance, or settling an opening
        // balance) is a ledger judgment, not a match — accounts makes it.
        if (!isAccounts(caller)) {
          return json({ error: "Accounts places money on a customer's account." }, 403)
        }
        const receiptId = str(payload.receipt_id)
        const groupId = str(payload.group_id)
        const amount = Number(payload.amount_paise)
        if (!receiptId || !groupId) return json({ error: "receipt_id and group_id required" }, 400)
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          return json({ error: "amount_paise must be a positive whole number of paise" }, 400)
        }
        return await rpc("payments_on_account", {
          p_entity_id: entityId,
          p_receipt_id: receiptId,
          p_group_id: groupId,
          p_amount: amount,
          p_actor: caller.id,
          p_client_request_id: str(payload.client_request_id),
        })
      }

      // ── Reversal. The maker may undo their own un-exported work; anything
      // already sent to Busy needs a GM, because it cannot be un-sent and has
      // to travel as a contra entry in the next file.
      case "reverse_allocation": {
        const allocId = str(payload.allocation_id)
        const reason = str(payload.reason)
        if (!allocId) return json({ error: "allocation_id required" }, 400)
        if (!reason) return json({ error: "A reversal must say why." }, 400)

        const { data: alloc, error } = await admin
          .from("payment_allocations")
          .select("id, entity_id, allocated_by, export_batch_id, reversed_at")
          .eq("id", allocId).maybeSingle()
        if (error) return json({ error: error.message }, 400)
        if (!alloc) return json({ error: "Allocation not found" }, 404)
        if (!isAdmin(caller) && alloc.entity_id !== caller.entity_id) {
          return json({ error: "Forbidden" }, 403)
        }
        if (alloc.export_batch_id && !isGmPlus(caller)) {
          return json({
            error: "This entry has already gone to Busy. A GM can reverse it; it will travel as a correcting entry.",
          }, 403)
        }
        const isMaker = alloc.allocated_by === caller.id
        if (!isMaker && !isAccounts(caller) && !isGmPlus(caller)) {
          return json({ error: "Only the person who matched this, or accounts, can undo it." }, 403)
        }
        return await rpc("payments_reverse_allocation", {
          p_allocation_id: allocId, p_actor: caller.id, p_reason: reason,
        })
      }

      // ── Accounts-only verbs. Service staff match; they do not classify
      // money as non-service, close bills against tax, or void receipts.
      case "classify_receipt": {
        if (!isAccounts(caller)) {
          return json({ error: "Accounts decides what is not a service payment." }, 403)
        }
        const receiptId = str(payload.receipt_id)
        const classification = str(payload.classification)
        if (!receiptId) return json({ error: "receipt_id required" }, 400)
        if (!classification || !["service", "not_service", "unknown"].includes(classification)) {
          return json({ error: "classification must be service, not_service or unknown" }, 400)
        }
        return await rpc("payments_classify_receipt", {
          p_entity_id: entityId,
          p_receipt_id: receiptId,
          p_classification: classification,
          p_kind: str(payload.not_service_kind),
          p_actor: caller.id,
        })
      }

      case "close_tds": {
        // Accounts closes up to the 5% cap; a GM may be the one asked to go over.
        if (!isAccounts(caller) && !isGmPlus(caller)) {
          return json({ error: "Accounts closes bills against TDS." }, 403)
        }
        const invoiceId = str(payload.invoice_id)
        const amount = Number(payload.amount_paise)
        if (!invoiceId) return json({ error: "invoice_id required" }, 400)
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          return json({ error: "amount_paise must be a positive whole number of paise" }, 400)
        }
        // Over 5% is a GM decision. The RPC enforces the cap itself; this only
        // decides who is allowed to ask for the override.
        const allowOverCap = payload.allow_over_cap === true && isGmPlus(caller)
        return await rpc("payments_close_tds", {
          p_entity_id: entityId,
          p_invoice_id: invoiceId,
          p_amount: amount,
          p_actor: caller.id,
          p_allow_over_cap: allowOverCap,
        })
      }

      case "manual_receipt": {
        if (!isAccounts(caller)) {
          return json({ error: "Accounts enters cash and cheque receipts." }, 403)
        }
        const row = payload.row
        if (!row || typeof row !== "object") return json({ error: "row required" }, 400)
        const amount = Number((row as Record<string, unknown>).amount_paise)
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          return json({ error: "amount_paise must be a positive whole number of paise" }, 400)
        }
        return await rpc("payments_manual_receipt", {
          p_entity_id: entityId, p_row: row, p_actor: caller.id,
        })
      }

      case "void_receipt": {
        if (!isAccounts(caller)) {
          return json({ error: "Accounts voids receipts." }, 403)
        }
        const receiptId = str(payload.receipt_id)
        const reason = str(payload.reason)
        if (!receiptId) return json({ error: "receipt_id required" }, 400)
        if (!reason) return json({ error: "A void must say why." }, 400)
        await audit(admin, {
          actorId: caller.id, action: "payments.void_receipt",
          targetId: receiptId, after: { reason },
        })
        return await rpc("payments_void_receipt", {
          p_entity_id: entityId, p_receipt_id: receiptId,
          p_reason: reason, p_actor: caller.id,
        })
      }

      // ── Imports. Admin during the pilot; accounts after the handover, which
      // is a dated event rather than a vague "for now".
      case "import_invoices": {
        if (!isAdmin(caller) && !isAccounts(caller)) {
          return json({ error: "Only accounts or an admin can import bills." }, 403)
        }
        const rows = payload.rows
        if (!Array.isArray(rows)) return json({ error: "rows must be an array" }, 400)
        if (rows.length === 0) return json({ error: "nothing to import" }, 400)
        if (rows.length > 5000) {
          return json({ error: "too many rows in one batch — split the file" }, 400)
        }
        return await rpc("payments_import_invoices", {
          p_entity_id: entityId,
          p_rows: rows,
          p_batch: payload.batch ?? {},
          p_actor: caller.id,
        })
      }

      case "import_receipts": {
        if (!isAdmin(caller) && !isAccounts(caller)) {
          return json({ error: "Only accounts or an admin can import payments." }, 403)
        }
        const rows = payload.rows
        if (!Array.isArray(rows)) return json({ error: "rows must be an array" }, 400)
        if (rows.length === 0) return json({ error: "nothing to import" }, 400)
        if (rows.length > 5000) {
          return json({ error: "too many rows in one batch — split the file" }, 400)
        }
        return await rpc("payments_import_receipts", {
          p_entity_id: entityId,
          p_rows: rows,
          p_batch: payload.batch ?? {},
          p_actor: caller.id,
        })
      }

      // ── Groups and limits are the GM's, not accounts'. Accounts proposes.
      case "create_group": {
        if (!isGmPlus(caller)) {
          return json({ error: "A GM or admin creates customer groups." }, 403)
        }
        const name = str(payload.name)
        if (!name) return json({ error: "name required" }, 400)
        const limit = payload.credit_limit_paise === null || payload.credit_limit_paise === undefined
          ? null : Number(payload.credit_limit_paise)
        if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
          return json({ error: "credit_limit_paise must be a whole number of paise" }, 400)
        }
        const { data, error } = await admin.from("customer_groups").insert({
          entity_id: entityId, name, credit_limit_paise: limit,
          busy_ledger_name: str(payload.busy_ledger_name),
          created_by: caller.id,
        }).select("id, name").maybeSingle()
        if (error) return json({ ok: false, error: error.message }, 400)
        await admin.from("payment_events").insert({
          entity_id: entityId, event_type: "group_edit", actor_id: caller.id,
          actor_name: caller.full_name, group_id: data?.id,
          detail: { created: true, name, credit_limit_paise: limit },
        })
        return json({ ok: true, group: data })
      }

      case "assign_customer_group": {
        if (!isGmPlus(caller)) {
          return json({ error: "A GM or admin assigns customers to groups." }, 403)
        }
        const customerId = str(payload.customer_id)
        const groupId = str(payload.group_id)
        if (!customerId) return json({ error: "customer_id required" }, 400)

        const { data: cust, error: cErr } = await admin
          .from("customers").select("id, entity_id").eq("id", customerId).maybeSingle()
        if (cErr) return json({ error: cErr.message }, 400)
        if (!cust) return json({ error: "Customer not found" }, 404)
        if (!isAdmin(caller) && cust.entity_id !== caller.entity_id) {
          return json({ error: "Forbidden" }, 403)
        }
        // The GROUP must be checked too, and BEFORE the open membership is
        // closed. The first draft checked only the customer, so a PTB customer
        // could be filed under a PT group; and a bad group id failed only after
        // the old membership was already closed, leaving the customer ungrouped.
        if (groupId) {
          const { data: grp, error: gErr } = await admin
            .from("customer_groups").select("id, entity_id").eq("id", groupId).maybeSingle()
          if (gErr) return json({ error: gErr.message }, 400)
          if (!grp) return json({ error: "Group not found" }, 404)
          if (grp.entity_id !== cust.entity_id) {
            return json({ error: "That group belongs to the other company." }, 403)
          }
        }

        // Membership is temporal: close the open row, then open a new one. The
        // EXCLUDE constraint makes "one group per customer per instant" a
        // database guarantee, so two GMs editing at once cannot both win.
        const now = new Date().toISOString()
        const { error: closeErr } = await admin
          .from("customer_group_memberships")
          .update({ valid_to: now })
          .eq("customer_id", customerId).is("valid_to", null)
        if (closeErr) return json({ ok: false, error: closeErr.message }, 400)

        if (groupId) {
          const { error: openErr } = await admin.from("customer_group_memberships").insert({
            customer_id: customerId, group_id: groupId,
            valid_from: now, assigned_by: caller.id, reason: str(payload.reason),
          })
          if (openErr) return json({ ok: false, error: openErr.message }, 400)
        }

        await admin.from("payment_events").insert({
          entity_id: cust.entity_id, event_type: "group_edit", actor_id: caller.id,
          actor_name: caller.full_name, customer_id: customerId, group_id: groupId,
          detail: { moved_to: groupId, reason: str(payload.reason) },
        })
        return json({ ok: true, customer_id: customerId, group_id: groupId })
      }

      case "set_credit_limit": {
        if (!isGmPlus(caller)) {
          return json({ error: "A GM or admin sets credit limits." }, 403)
        }
        const groupId = str(payload.group_id)
        if (!groupId) return json({ error: "group_id required" }, 400)
        const limit = payload.credit_limit_paise === null || payload.credit_limit_paise === undefined
          ? null : Number(payload.credit_limit_paise)
        if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
          return json({ error: "credit_limit_paise must be a whole number of paise" }, 400)
        }
        const { data: before } = await admin
          .from("customer_groups").select("id, entity_id, credit_limit_paise")
          .eq("id", groupId).maybeSingle()
        if (!before) return json({ error: "Group not found" }, 404)
        if (!isAdmin(caller) && before.entity_id !== caller.entity_id) {
          return json({ error: "Forbidden" }, 403)
        }
        const { error } = await admin.from("customer_groups")
          .update({ credit_limit_paise: limit, updated_at: new Date().toISOString() })
          .eq("id", groupId)
        if (error) return json({ ok: false, error: error.message }, 400)
        await admin.from("payment_events").insert({
          entity_id: before.entity_id, event_type: "limit_edit", actor_id: caller.id,
          actor_name: caller.full_name, group_id: groupId,
          detail: { from: before.credit_limit_paise, to: limit },
        })
        return json({ ok: true, group_id: groupId, credit_limit_paise: limit })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error("service-payments threw:", err)
    return json({ error: "Unexpected error" }, 500)
  }
})
