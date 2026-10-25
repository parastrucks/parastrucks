// supabase/functions/gate-invoices/index.ts
// Credit release step 1 — store an uploaded SAP invoice PDF and email it to the customer.
// Plan: docs/backlog/credit-release-plan.md. Called via callEdge('gate-invoices', action, payload).
//
// Actions:
//   saveDocument { file_b64, reading }              → { ok, document_id, already? }
//   sendEmail    { document_id, to, client_request_id } → { ok, message }
//   pdfUrl       { document_id }                    → { ok, url }   (5-minute signed link)
//
// Who: the admin, or service / accounts / spares staff of the invoice's own company
// (same departments as the /invoices access rules and the gate_* read policies).
// The company is decided by the SELLER GSTIN printed on the invoice, never by the caller.
//
// Email goes from GATE_SMTP_USER (accounts.guj@parastrucks.in) through smtp.gmail.com:465
// with the app password in GATE_SMTP_PASSWORD — set by the owner as a function secret,
// never in chat or in the repo. GATE_EMAIL_ONLY_TO (staging) limits who may receive mail.
//
// Deploy with --no-verify-jwt (verify() below does the real validation), like every portal EF.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"
import { secretKey, publishableKey } from "../_shared/keys.ts"
import { rateLimit } from "../_shared/rateLimit.ts"
import { audit } from "../_shared/auditLog.ts"
import { jsonResponse, preflight } from "../_shared/cors.ts"
import { checkReading, cleanEmail, mayUse, recipientAllowed, type Reading } from "./check.ts"
import { invoiceEmail, mimeMessage } from "./mail.ts"
import { sendSmtp, SmtpError } from "./smtp.ts"

type Caller = {
  id: string
  full_name: string
  permission_level: string | null
  entity_id: string | null
  department_code: string | null
}
type VerifyResult = { err: Response } | { caller: Caller; admin: SupabaseClient }

const isAdmin = (c: Caller) => c.permission_level === "admin"

const MAX_PDF_BYTES = 5 * 1024 * 1024
const SAME_RECIPIENT_GAP_MS = 2 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: prof, error: profErr } = await admin
    .from("users")
    .select("id, full_name, permission_level, entity_id, is_active, departments(code)")
    .eq("id", u.user.id)
    .maybeSingle() as unknown as {
      data: { id: string; full_name: string | null; permission_level: string | null; entity_id: string | null; is_active: boolean; departments: { code: string } | null } | null
      error: { message: string } | null
    }
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
  }
  if (!mayUse(caller)) return { err: jsonResponse(req, { error: "Forbidden" }, 403) }
  return { caller, admin }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("")
}
function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}
const sameBills = (a: { bill_no: string; amount_paise: number }[], b: { bill_no: string; amount_paise: number }[]) =>
  JSON.stringify([...a].map((x) => [x.bill_no, Number(x.amount_paise)]).sort()) ===
  JSON.stringify([...b].map((x) => [x.bill_no, Number(x.amount_paise)]).sort())

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

  const rl = await rateLimit(admin, caller.id, "gate-invoices", 30, 60)
  if (!rl.allowed) return json({ ok: false, error: "rate_limited", retry_after_s: rl.retry_after_s }, 429)

  // One chokepoint for "may this caller touch this document?"
  async function loadDocument(id: unknown) {
    if (typeof id !== "string" || !UUID.test(id)) return { err: json({ error: "document_id required" }, 400) }
    const { data: doc, error } = await admin.from("gate_documents").select("*").eq("id", id).maybeSingle()
    if (error) return { err: json({ error: "backend_unavailable" }, 503) }
    if (!doc) return { err: json({ error: "Invoice not found" }, 404) }
    if (!isAdmin(caller) && doc.entity_id !== caller.entity_id) return { err: json({ error: "Forbidden" }, 403) }
    return { doc }
  }

  try {
    switch (action) {
      case "saveDocument": {
        const reading = payload.reading as Reading
        const bad = checkReading(reading)
        if (bad) return json({ error: `The invoice reading was refused: ${bad}` }, 400)
        if (typeof payload.file_b64 !== "string") return json({ error: "file required" }, 400)
        if (payload.file_b64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) return json({ error: "The PDF is larger than 5 MB." }, 413)
        const bytes = fromBase64(payload.file_b64)
        if (!bytes || bytes.length === 0) return json({ error: "The file could not be read." }, 400)
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return json({ error: "The file is not a PDF." }, 400)

        // The company is the SELLER on the invoice; staff may only file their own company's.
        const { data: entity } = await admin.from("entities").select("id, code").eq("gstin", reading.seller_gstin).maybeSingle()
        if (!entity) return json({ error: "The seller GSTIN on this invoice is not one of our companies." }, 400)
        if (!isAdmin(caller) && entity.id !== caller.entity_id) return json({ error: `This invoice was issued by ${entity.code}, not your company.` }, 403)

        const sha = await sha256Hex(bytes)
        const existing = async () => {
          const { data } = await admin.from("gate_documents")
            .select("id, file_sha256, total_paise, created_at, gate_bills(bill_no, amount_paise)")
            .eq("entity_id", entity.id).eq("doc_no", reading.doc_no).maybeSingle()
          return data as null | { id: string; file_sha256: string; total_paise: number; created_at: string; gate_bills: { bill_no: string; amount_paise: number }[] }
        }
        const sameDoc = (d: NonNullable<Awaited<ReturnType<typeof existing>>>) =>
          d.file_sha256 === sha || (Number(d.total_paise) === reading.total_paise && sameBills(d.gate_bills, reading.bills))
        const before = await existing()
        if (before) {
          if (sameDoc(before)) return json({ ok: true, document_id: before.id, already: true })
          return json({ error: `${reading.doc_no} was uploaded before (${before.created_at.slice(0, 10)}) with different bills or amounts. Nothing was saved — check with accounts which one is right.` }, 409)
        }
        const { data: clash } = await admin.from("gate_bills").select("bill_no, gate_documents(doc_no)")
          .eq("entity_id", entity.id).in("bill_no", reading.bills.map((b) => b.bill_no)).limit(1).maybeSingle() as unknown as
          { data: { bill_no: string; gate_documents: { doc_no: string } | null } | null }
        if (clash) return json({ error: `Bill ${clash.bill_no} is already on ${clash.gate_documents?.doc_no ?? "another upload"}. Nothing was saved.` }, 409)

        const path = `${entity.code}/${reading.doc_date.slice(0, 7)}/${reading.doc_no}-${sha.slice(0, 12)}.pdf`
        const up = await admin.storage.from("gate-invoices").upload(path, bytes, { contentType: "application/pdf", upsert: false })
        const uploadedNow = !up.error
        if (up.error && !/exists|duplicate/i.test(up.error.message)) {
          console.error("saveDocument: storage upload failed:", up.error.message)
          return json({ error: "The PDF could not be stored. Try again." }, 503)
        }
        const c = reading.customer, v = reading.vehicle
        const { data: id, error } = await admin.rpc("gate_record_document", {
          p_doc: {
            entity_id: entity.id, layout: reading.layout, sap_form: reading.sap_form, doc_no: reading.doc_no,
            doc_date: reading.doc_date, order_no: reading.order_no, order_type: reading.order_type,
            payment_terms: reading.payment_terms, sap_customer_code: c.sap_code, customer_name: c.name.trim(),
            customer_mobile: c.mobile, customer_pan: c.pan, customer_gstin: c.gstin,
            regn_no: v?.regn_no ?? null, vehicle_model: v?.model ?? null, chassis_no: v?.chassis_no ?? null, engine_no: v?.engine_no ?? null,
            total_paise: reading.total_paise, file_path: path, file_sha256: sha, file_bytes: bytes.length, uploaded_by: caller.id,
          },
          p_bills: reading.bills,
        })
        if (error) {
          // A second click racing the first lands here on the unique key: answer like the first.
          const after = await existing()
          if (after && sameDoc(after)) return json({ ok: true, document_id: after.id, already: true })
          if (uploadedNow) await admin.storage.from("gate-invoices").remove([path])
          console.error("saveDocument: record failed:", error.message)
          return json({ error: /duplicate|unique/i.test(error.message) ? "This job card or one of its bills was just saved by someone else with different details." : "The invoice could not be saved." }, /duplicate|unique/i.test(error.message) ? 409 : 500)
        }
        await audit(admin, { actorId: caller.id, action: "gate_document_saved", targetId: id as string,
          after: { doc_no: reading.doc_no, layout: reading.layout, bills: reading.bills.length, total_paise: reading.total_paise, sha256: sha } })
        return json({ ok: true, document_id: id })
      }

      case "sendEmail": {
        const to = cleanEmail(payload.to)
        if (!to) return json({ error: "That email address does not look right." }, 400)
        const reqId = payload.client_request_id
        if (typeof reqId !== "string" || !UUID.test(reqId)) return json({ error: "client_request_id required" }, 400)
        const r = await loadDocument(payload.document_id); if ("err" in r) return r.err
        const doc = r.doc

        // The same click arriving twice gets the first answer — never a second email.
        const { data: prior } = await admin.from("gate_messages").select("*").eq("client_request_id", reqId).maybeSingle()
        if (prior) {
          if (prior.document_id !== doc.id) return json({ error: "client_request_id reused" }, 409)
          return json({ ok: prior.status !== "failed", message: prior, repeated: true })
        }

        const user = Deno.env.get("GATE_SMTP_USER") ?? "accounts.guj@parastrucks.in"
        const pass = Deno.env.get("GATE_SMTP_PASSWORD")
        if (!pass) return json({ error: "Email is not set up yet: the app password for the sending account has not been added to the server." }, 503)
        if (!recipientAllowed(to, Deno.env.get("GATE_EMAIL_ONLY_TO"))) {
          return json({ error: `On this test system, email may only go to: ${Deno.env.get("GATE_EMAIL_ONLY_TO")}` }, 403)
        }
        const { data: recent } = await admin.from("gate_messages").select("created_at, status")
          .eq("document_id", doc.id).eq("recipient", to).in("status", ["sending", "sent"])
          .gte("created_at", new Date(Date.now() - SAME_RECIPIENT_GAP_MS).toISOString()).limit(1).maybeSingle()
        if (recent) return json({ error: `This invoice was just sent to ${to}. Wait two minutes before sending it again.` }, 409)

        const { data: msg, error: insErr } = await admin.from("gate_messages").insert({
          document_id: doc.id, entity_id: doc.entity_id, channel: "email", recipient: to,
          status: "sending", client_request_id: reqId, sent_by: caller.id,
        }).select("*").single()
        if (insErr) {
          const { data: again } = await admin.from("gate_messages").select("*").eq("client_request_id", reqId).maybeSingle()
          if (again) return json({ ok: again.status !== "failed", message: again, repeated: true })
          return json({ error: "The send could not be recorded." }, 500)
        }

        const finish = async (patch: Record<string, unknown>) => {
          const { data } = await admin.from("gate_messages").update({ ...patch, finished_at: new Date().toISOString() })
            .eq("id", msg.id).select("*").single()
          return data ?? { ...msg, ...patch }
        }
        try {
          const [{ data: file, error: dlErr }, { data: bills }, { data: entity }] = await Promise.all([
            admin.storage.from("gate-invoices").download(doc.file_path),
            admin.from("gate_bills").select("bill_no, amount_paise, bill_date").eq("document_id", doc.id).order("bill_no"),
            admin.from("entities").select("full_name, address").eq("id", doc.entity_id).single(),
          ])
          if (dlErr || !file) throw new Error("The stored PDF could not be read.")
          const pdf = new Uint8Array(await file.arrayBuffer())
          const { subject, text } = invoiceEmail(
            { ...doc, total_paise: Number(doc.total_paise) },
            (bills ?? []).map((b: { bill_no: string; amount_paise: number }) => ({ bill_no: b.bill_no, amount_paise: Number(b.amount_paise) })),
            { company: entity?.full_name ?? "Paras Trucks and Buses", addressLine: String(entity?.address ?? "").split("\n")[0] },
          )
          const message = mimeMessage({
            fromName: `${entity?.full_name ?? "Paras Trucks and Buses"} — Accounts`, from: user, to, subject, text,
            attachment: { filename: `${doc.doc_no}.pdf`, bytes: pdf }, messageId: msg.id, date: new Date(),
          })
          const sent = await sendSmtp(
            { host: "smtp.gmail.com", port: 465, user, pass, from: user, to, message },
            async (hostname, port) => await Deno.connectTls({ hostname, port }),
          )
          const done = await finish({ status: "sent", provider_message_id: sent.reply })
          await admin.from("gate_contacts").upsert(
            { entity_id: doc.entity_id, sap_customer_code: doc.sap_customer_code, email: to, updated_by: caller.id, updated_at: new Date().toISOString() },
            { onConflict: "entity_id,sap_customer_code" },
          )
          await audit(admin, { actorId: caller.id, action: "gate_email_sent", targetId: doc.id, after: { message_id: msg.id, to } })
          return json({ ok: true, message: done })
        } catch (e) {
          const reason = e instanceof SmtpError || e instanceof Error ? e.message : "Sending failed."
          const done = await finish({ status: "failed", error: reason.slice(0, 500) })
          await audit(admin, { actorId: caller.id, action: "gate_email_failed", targetId: doc.id, after: { message_id: msg.id, to, error: reason.slice(0, 300) } })
          return json({ ok: false, error: reason, message: done }, 502)
        }
      }

      case "pdfUrl": {
        const r = await loadDocument(payload.document_id); if ("err" in r) return r.err
        const { data, error } = await admin.storage.from("gate-invoices").createSignedUrl(r.doc.file_path, 300)
        if (error || !data) return json({ error: "The PDF could not be opened." }, 503)
        return json({ ok: true, url: data.signedUrl })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    console.error("gate-invoices:", (e as Error).message)
    return json({ error: "Internal error" }, 500)
  }
})
