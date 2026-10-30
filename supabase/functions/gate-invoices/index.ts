// supabase/functions/gate-invoices/index.ts
// Credit release step 1 — store an uploaded SAP invoice PDF and email it to the customer.
// Plan: docs/backlog/credit-release-plan.md. Called via callEdge('gate-invoices', action, payload).
//
// Actions:
//   saveDocument { file_b64, reading }              → { ok, document_id, already? }
//   sendEmail    { document_id, to, client_request_id } → { ok, message }
//   pdfUrl       { document_id }                    → { ok, url }   (5-minute signed link)
// Step 2 (2026-10-26):
//   requestRelease  { document_id, note?, client_request_id } → { ok, release, alerted }
//   withdrawRelease { release_id }                            → { ok, release }
//   decideRelease   { release_id, decision: approve|hold, note? } → { ok, release }
//   pushKey / pushSubscribe { endpoint, p256dh, auth } / pushUnsubscribe { endpoint }
//   gateCheck       { regn_no }                               → { ok, result: may_go|hold, … }
// 2026-10-27:
//   gateList        {}                                        → { ok, as_of, released[], waiting[] }
//
// Who: authority.ts — ONE table, asked before any payload is read. Upload / send / ask:
// service, accounts, spares of the invoice's company + admin. Approve / hold: ONLY the
// Service GM of that company, or the admin. Gate check: Security guards (+ admin).
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
import { checkReading, cleanEmail, recipientAllowed, type Reading } from "./check.ts"
import { ACTION_GATES, isAdmin, mayDecideFor, mayDo, RELEASE_HOURS } from "./authority.ts"
import { pushEndpointAllowed, sendPush, type Vapid } from "./push.ts"
import { invoiceEmail, mimeMessage, properName, rupees, senderFor } from "./mail.ts"
import { AL_LOGO_PNG_B64, PARAS_LOGO_PNG_B64 } from "./logos.ts"
import { sendSmtp, SmtpError } from "./smtp.ts"
import { cleanPromiseDay, customerSummary, istToday, PROMISE_MAX_DAYS } from "./paid.ts"
import { loadReleased } from "./released.ts"

type Caller = {
  id: string
  full_name: string
  permission_level: string | null
  entity_id: string | null
  department_code: string | null
}
type VerifyResult = { err: Response } | { caller: Caller; admin: SupabaseClient }

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
/** A free-text note: trimmed, printable, ≤300 — null when empty, false when too long. */
function cleanNote(s: unknown): string | null | false {
  if (s === undefined || s === null) return null
  if (typeof s !== "string") return false
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > 300 ? false : t
}
/** "26 Oct, 4:30 pm" in India time — the time a guard or approver reads. */
const istTime = (iso: string) => new Date(iso).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
})
function vapid(): Vapid | null {
  const publicKey = Deno.env.get("GATE_VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("GATE_VAPID_PRIVATE_KEY")
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: `mailto:${Deno.env.get("GATE_SMTP_USER") ?? "accounts.guj@parastrucks.in"}` }
}
const PUSH_TIMEOUT_MS = 5000
/** The customer's name as the guard reads it (owner, 2026-10-27: plate + customer name). */
const customerOf = (d: { customer_name: string } | null) => d?.customer_name ? properName(d.customer_name) : null

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

  if (typeof action !== "string" || !Object.hasOwn(ACTION_GATES, action)) return json({ error: `Unknown action: ${action}` }, 400)
  const auth = await verify(req)
  if ("err" in auth) return auth.err
  const { caller, admin } = auth
  // The one role check — before any payload is read (authority.ts).
  if (!mayDo(action, caller)) return json({ error: "Forbidden" }, 403)

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

  // The same chokepoint for a release. A Service GM's own-company rule is applied by the
  // decide action (mayDecideFor); everyone but the admin stays inside their own company.
  async function loadRelease(id: unknown) {
    if (typeof id !== "string" || !UUID.test(id)) return { err: json({ error: "release_id required" }, 400) }
    const { data: rel, error } = await admin.from("gate_releases").select("*").eq("id", id).maybeSingle()
    if (error) return { err: json({ error: "backend_unavailable" }, 503) }
    if (!rel) return { err: json({ error: "Release request not found" }, 404) }
    if (!isAdmin(caller) && rel.entity_id !== caller.entity_id) return { err: json({ error: "Forbidden" }, 403) }
    return { rel }
  }

  // Wake the phones of everyone who may decide: the Service GMs of that company and the
  // admin — except `exceptId`, the person who just acted, whose own phone stays quiet.
  // Never fails the request — the release is saved either way, and the screen says how many
  // phones were reached so nobody assumes the GM knows.
  async function alertApprovers(entityId: string, message: Record<string, unknown>, exceptId?: string) {
    const v = vapid()
    if (!v) return { approvers: 0, phones: 0, sent: 0, set_up: false }
    const { data: svc } = await admin.from("departments").select("id").eq("code", "service").single()
    const { data: people } = await admin.from("users").select("id").eq("is_active", true)
      .or(`permission_level.eq.admin,and(permission_level.eq.gm,department_id.eq.${svc?.id},entity_id.eq.${entityId})`)
    const ids = (people ?? []).map((p: { id: string }) => p.id).filter((id: string) => id !== exceptId)
    if (ids.length === 0) return { approvers: 0, phones: 0, sent: 0, set_up: true }
    const { data: subs } = await admin.from("gate_push_subscriptions").select("id, endpoint, p256dh, auth, failures").in("user_id", ids)
    const timed: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) })
    let sent = 0
    await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string; failures: number }) => {
      try {
        const res = await sendPush(s, message, v, timed)
        if (res.ok) { sent++; await admin.from("gate_push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0, last_error: null }).eq("id", s.id) }
        else if (res.gone) await admin.from("gate_push_subscriptions").delete().eq("id", s.id)
        else await admin.from("gate_push_subscriptions").update({ failures: s.failures + 1, last_error: res.error ?? null }).eq("id", s.id)
      } catch (e) {
        await admin.from("gate_push_subscriptions").update({ failures: s.failures + 1, last_error: String((e as Error).message).slice(0, 200) }).eq("id", s.id)
      }
    }))
    return { approvers: ids.length, phones: subs?.length ?? 0, sent, set_up: true }
  }
  // The alert that asks: one per release (its tag), so a later message replaces it.
  const askMessage = (doc: Record<string, unknown>, rel: { id: string; regn_no: string }) => ({
    title: `Release asked: ${rel.regn_no}`,
    body: `${properName(String(doc.customer_name))} · ${rupees(Number(doc.total_paise))} — tap to approve or hold`,
    url: `/invoices?tab=releases&release=${rel.id}`,
    tag: `release-${rel.id}`,
  })
  // Once someone has answered, the other approvers' "asked" alert is replaced — quietly — by
  // who answered, so nobody taps a request that is already decided (2026-10-28: "like
  // instant messaging apps"). A browser must show something for every push, hence a quiet
  // replacement rather than nothing.
  const closedMessage = (rel: { id: string; regn_no: string }, what: string) => ({
    kind: "closed",
    title: `${rel.regn_no}: ${what}`,
    body: "Nothing to do — tap to see it.",
    url: `/invoices?tab=releases&release=${rel.id}`,
    tag: `release-${rel.id}`,
  })

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
        // The bills go into matching the same day (owner, 2026-10-30: "invoices first"). Called on
        // every save AND every repeat of one, so a call that failed heals on the next upload. A
        // failure never fails the save: the invoice is the customer's; the Billing Report brings
        // the same bills the next morning anyway.
        const toMatching = async (documentId: string) => {
          const { data, error } = await admin.rpc("payments_bills_from_gate_document", { p_document_id: documentId })
          if (error) {
            console.error("saveDocument: bills to matching failed:", error.message)
            return { matching_error: "The invoice is saved, but its bills did not reach matching yet. They will come with the next Billing Report." }
          }
          return { matching: data }
        }
        const before = await existing()
        if (before) {
          if (sameDoc(before)) return json({ ok: true, document_id: before.id, already: true, ...(await toMatching(before.id)) })
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
          if (after && sameDoc(after)) return json({ ok: true, document_id: after.id, already: true, ...(await toMatching(after.id)) })
          if (uploadedNow) await admin.storage.from("gate-invoices").remove([path])
          console.error("saveDocument: record failed:", error.message)
          return json({ error: /duplicate|unique/i.test(error.message) ? "This job card or one of its bills was just saved by someone else with different details." : "The invoice could not be saved." }, /duplicate|unique/i.test(error.message) ? 409 : 500)
        }
        await audit(admin, { actorId: caller.id, action: "gate_document_saved", targetId: id as string,
          after: { doc_no: reading.doc_no, layout: reading.layout, bills: reading.bills.length, total_paise: reading.total_paise, sha256: sha } })
        return json({ ok: true, document_id: id, ...(await toMatching(id as string)) })
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
          const [{ data: file, error: dlErr }, { data: entity }] = await Promise.all([
            admin.storage.from("gate-invoices").download(doc.file_path),
            admin.from("entities").select("code, full_name, address").eq("id", doc.entity_id).single(),
          ])
          if (dlErr || !file) throw new Error("The stored PDF could not be read.")
          const pdf = new Uint8Array(await file.arrayBuffer())
          const sender = senderFor(entity)
          const mail = invoiceEmail({ ...doc, total_paise: Number(doc.total_paise) }, sender)
          const message = mimeMessage({
            fromName: `${sender.company} – Accounts`, from: user, to,
            subject: mail.subject, text: mail.text, html: mail.html,
            images: [
              { cid: "paras-logo", filename: "paras-logo.png", contentType: "image/png", base64: PARAS_LOGO_PNG_B64 },
              { cid: "al-logo", filename: "ashok-leyland.png", contentType: "image/png", base64: AL_LOGO_PNG_B64 },
            ],
            attachment: { filename: mail.attachmentName, bytes: pdf }, messageId: msg.id, date: new Date(),
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

      // ── Step 2: ask for a credit release ──
      case "requestRelease": {
        const reqId = payload.client_request_id
        if (typeof reqId !== "string" || !UUID.test(reqId)) return json({ error: "client_request_id required" }, 400)
        const note = cleanNote(payload.note)
        if (note === false) return json({ error: "The note is longer than 300 characters." }, 400)
        const r = await loadDocument(payload.document_id); if ("err" in r) return r.err
        const doc = r.doc
        if (doc.layout !== "workshop") return json({ error: "A counter sale has no gate step — only workshop jobs are released at the gate." }, 400)
        if (!doc.regn_no) return json({ error: "This job card carries no vehicle number, so the guard could not check it." }, 400)

        const { data: prior } = await admin.from("gate_releases").select("*").eq("client_request_id", reqId).maybeSingle()
        if (prior) {
          if (prior.document_id !== doc.id) return json({ error: "client_request_id reused" }, 409)
          return json({ ok: true, release: prior, repeated: true })
        }
        const { data: live } = await admin.from("gate_releases").select("*").eq("document_id", doc.id)
          .or(`status.eq.asked,and(status.eq.approved,valid_until.gt.${new Date().toISOString()})`)
          .order("requested_at", { ascending: false }).limit(1).maybeSingle()
        if (live?.status === "asked") return json({ ok: true, release: live, already: true })
        if (live?.status === "approved") return json({ error: `Already released — the guard will let ${doc.regn_no} out until ${istTime(live.valid_until)}.` }, 409)

        const { data: rel, error } = await admin.from("gate_releases").insert({
          entity_id: doc.entity_id, document_id: doc.id, regn_no: doc.regn_no, request_note: note,
          requested_by: caller.id, client_request_id: reqId,
        }).select("*").single()
        if (error) {
          // Two people asking at once: the one-open-request index lets one in; answer with it.
          const { data: open } = await admin.from("gate_releases").select("*").eq("document_id", doc.id).eq("status", "asked").maybeSingle()
          if (open) return json({ ok: true, release: open, already: true })
          console.error("requestRelease:", error.message)
          return json({ error: "The request could not be saved." }, 500)
        }
        await audit(admin, { actorId: caller.id, action: "gate_release_asked", targetId: rel.id,
          after: { document_id: doc.id, regn_no: doc.regn_no, total_paise: doc.total_paise } })
        const alerted = await alertApprovers(doc.entity_id, askMessage(doc, rel))
        return json({ ok: true, release: rel, alerted })
      }

      case "withdrawRelease": {
        const r = await loadRelease(payload.release_id); if ("err" in r) return r.err
        const { data, error } = await admin.from("gate_releases")
          .update({ status: "withdrawn", decided_by: caller.id, decided_at: new Date().toISOString() })
          .eq("id", r.rel.id).eq("status", "asked").select("*").maybeSingle()
        if (error) return json({ error: "The request could not be withdrawn." }, 500)
        if (!data) return json({ error: "This request was already answered." }, 409)
        await audit(admin, { actorId: caller.id, action: "gate_release_withdrawn", targetId: data.id })
        await alertApprovers(data.entity_id, closedMessage(data, `request withdrawn by ${caller.full_name || "the asker"}`), caller.id)
        return json({ ok: true, release: data })
      }

      // ── Step 2: approve or hold — the Service GM of that company, or the admin ──
      case "decideRelease": {
        const decision = payload.decision
        if (decision !== "approve" && decision !== "hold") return json({ error: "decision must be approve or hold" }, 400)
        const note = cleanNote(payload.note)
        if (note === false) return json({ error: "The note is longer than 300 characters." }, 400)
        if (decision === "hold" && !note) return json({ error: "Say why it is held — the service team sees the note." }, 400)
        // Step 3: an approval MAY carry a promise — the day the customer will pay by, and/or the
        // staff member responsible (owner, 2026-10-28/29). A hold never does.
        const today = istToday()
        const promisedBy = cleanPromiseDay(payload.promised_by, today)
        if (promisedBy === false) return json({ error: `The promise date must be a day from today to ${PROMISE_MAX_DAYS} days ahead.` }, 400)
        const responsibleId = payload.responsible_id === undefined || payload.responsible_id === null || payload.responsible_id === "" ? null : payload.responsible_id
        if (responsibleId !== null && (typeof responsibleId !== "string" || !UUID.test(responsibleId))) return json({ error: "Pick the responsible person from the list." }, 400)
        if (decision === "hold" && (promisedBy || responsibleId)) return json({ error: "A promise goes with an approval, not a hold." }, 400)

        const r = await loadRelease(payload.release_id); if ("err" in r) return r.err
        const rel = r.rel
        if (!mayDecideFor(caller, rel.entity_id)) return json({ error: "Only the Service GM of this company or the owner can approve or hold." }, 403)

        // The responsible person is an active staff member of the invoice's company (or the owner),
        // never a guard — someone the Follow-up list can name and, later, remind.
        let responsibleName: string | null = null
        if (responsibleId) {
          const { data: who } = await admin.from("users").select("full_name, is_active, entity_id, permission_level, departments(code)")
            .eq("id", responsibleId).maybeSingle() as unknown as
            { data: { full_name: string; is_active: boolean; entity_id: string | null; permission_level: string; departments: { code: string } | null } | null }
          const fits = who && who.is_active && who.departments?.code !== "security" &&
            (who.permission_level === "admin" || who.entity_id === rel.entity_id)
          if (!fits) return json({ error: "The responsible person must be an active staff member of this company." }, 400)
          responsibleName = who.full_name
        }

        // What the card showed: this customer's earlier releases through this tool and — from the
        // matching tool — what is still unpaid on them (step 3; paid comes only from matching).
        // Only invoices released through the portal: NOT their whole Busy balance.
        const { data: doc } = await admin.from("gate_documents").select("sap_customer_code, total_paise, regn_no").eq("id", rel.document_id).single()
        const earlier = await loadReleased(admin, {
          entityId: rel.entity_id, sapCode: doc?.sap_customer_code ?? "", excludeDocumentId: rel.document_id,
        }).catch((e) => { console.error("decideRelease earlier:", (e as Error).message); return null })
        const card = {
          regn_no: doc?.regn_no, total_paise: Number(doc?.total_paise ?? 0),
          earlier_releases: earlier?.length ?? 0,
          earlier_total_paise: (earlier ?? []).reduce((s, e) => s + e.total_paise, 0),
          ...(earlier ? { earlier_unpaid: customerSummary(earlier, today) } : { earlier_unpaid_error: true }),
        }
        const now = new Date()
        const patch = decision === "approve"
          ? { status: "approved", valid_until: new Date(now.getTime() + RELEASE_HOURS * 3600_000).toISOString(),
              promised_by: promisedBy, responsible_id: responsibleId }
          : { status: "held" }
        const { data, error } = await admin.from("gate_releases")
          .update({ ...patch, decided_by: caller.id, decided_at: now.toISOString(), decision_note: note, card })
          .eq("id", rel.id).eq("status", "asked").select("*").maybeSingle()
        if (error) { console.error("decideRelease:", error.message); return json({ error: "The decision could not be saved." }, 500) }
        if (!data) {
          const { data: cur } = await admin.from("gate_releases").select("status, decided_at, users:decided_by(full_name)").eq("id", rel.id).single() as unknown as
            { data: { status: string; decided_at: string | null; users: { full_name: string } | null } }
          return json({ error: `Already ${cur.status === "approved" ? "approved" : cur.status === "held" ? "held" : cur.status} by ${cur.users?.full_name ?? "someone"}${cur.decided_at ? ` at ${istTime(cur.decided_at)}` : ""}.` }, 409)
        }
        await audit(admin, { actorId: caller.id, action: decision === "approve" ? "gate_release_approved" : "gate_release_held",
          targetId: data.id, after: { regn_no: data.regn_no, valid_until: data.valid_until, note, card,
            promised_by: data.promised_by ?? null, responsible: responsibleName } })
        const who = caller.full_name || "an approver"
        await alertApprovers(data.entity_id, closedMessage(data, decision === "approve"
          ? `released by ${who} until ${istTime(data.valid_until)}` : `held by ${who}`), caller.id)
        return json({ ok: true, release: data })
      }

      // ── Step 2: the approvers' phone alerts ──
      case "pushKey": {
        const v = vapid()
        if (!v) return json({ error: "Phone alerts are not set up on the server yet." }, 503)
        return json({ ok: true, publicKey: v.publicKey })
      }

      case "pushSubscribe": {
        const { endpoint, p256dh, auth: authKey } = payload as Record<string, unknown>
        if (!pushEndpointAllowed(endpoint)) return json({ error: "This browser's push service is not one we send to." }, 400)
        if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || typeof authKey !== "string" || !/^[A-Za-z0-9_-]{16,32}$/.test(authKey)) {
          return json({ error: "The browser's subscription keys look wrong." }, 400)
        }
        const ua = typeof payload.user_agent === "string" ? payload.user_agent.slice(0, 300) : null
        // The endpoint is the phone: if it was someone else's before, it is now this user's.
        const { error } = await admin.from("gate_push_subscriptions").upsert(
          { user_id: caller.id, endpoint, p256dh, auth: authKey, user_agent: ua, failures: 0, last_error: null },
          { onConflict: "endpoint" })
        if (error) { console.error("pushSubscribe:", error.message); return json({ error: "Alerts could not be turned on." }, 500) }
        await audit(admin, { actorId: caller.id, action: "gate_push_subscribed", after: { host: new URL(endpoint as string).hostname } })
        return json({ ok: true })
      }

      case "pushUnsubscribe": {
        if (typeof payload.endpoint !== "string") return json({ error: "endpoint required" }, 400)
        await admin.from("gate_push_subscriptions").delete().eq("endpoint", payload.endpoint).eq("user_id", caller.id)
        return json({ ok: true })
      }

      // ── Step 2: the guard's check — "may go" or "hold", nothing else ──
      case "gateCheck": {
        const typed = typeof payload.regn_no === "string" ? payload.regn_no : ""
        const regn = typed.toUpperCase().replace(/[^A-Z0-9]/g, "")
        if (!/^[A-Z0-9]{6,12}$/.test(regn)) return json({ error: "Type the full vehicle number, e.g. GJ01AB1234." }, 400)
        if (!isAdmin(caller) && !caller.entity_id) return json({ error: "Your login has no company set — ask HR." }, 403)
        const nowIso = new Date().toISOString()
        let q = admin.from("gate_releases")
          .select("id, entity_id, decided_at, valid_until, users:decided_by(full_name), gate_documents(customer_name)")
          .eq("regn_no", regn).eq("status", "approved").gt("valid_until", nowIso)
          .order("valid_until", { ascending: false }).limit(1)
        if (!isAdmin(caller)) q = q.eq("entity_id", caller.entity_id)
        const { data: hit, error } = await q.maybeSingle() as unknown as
          { data: { id: string; entity_id: string; decided_at: string; valid_until: string; users: { full_name: string } | null; gate_documents: { customer_name: string } | null } | null; error: { message: string } | null }
        if (error) return json({ error: "The check could not be made. Try again." }, 503)

        let waiting = false
        if (!hit) {
          let w = admin.from("gate_releases").select("id").eq("regn_no", regn).eq("status", "asked").limit(1)
          if (!isAdmin(caller)) w = w.eq("entity_id", caller.entity_id)
          waiting = !!(await w.maybeSingle()).data
        }
        const entityId = hit?.entity_id ?? caller.entity_id
        if (entityId) {
          await admin.from("gate_checks").insert({ entity_id: entityId, guard_id: caller.id, regn_query: regn,
            result: hit ? "may_go" : "hold", release_id: hit?.id ?? null })
        }
        return json(hit
          ? { ok: true, result: "may_go", regn_no: regn, customer: customerOf(hit.gate_documents),
              decided_by: hit.users?.full_name ?? null, decided_at: hit.decided_at, valid_until: hit.valid_until }
          : { ok: true, result: "hold", regn_no: regn, waiting })
      }

      // ── The guard's list (owner, 2026-10-27): every vehicle that may go now, and every one
      // waiting for the GM — plate, customer name, until when. No amounts, no notes, no held
      // reasons: anything not in the "may go" list is HOLD. Not logged as a check — a tap on a
      // row runs gateCheck, which is.
      case "gateList": {
        if (!isAdmin(caller) && !caller.entity_id) return json({ error: "Your login has no company set — ask HR." }, 403)
        const nowIso = new Date().toISOString()
        let r = admin.from("gate_releases")
          .select("id, regn_no, decided_at, valid_until, users:decided_by(full_name), gate_documents(customer_name)")
          .eq("status", "approved").gt("valid_until", nowIso)
          .order("decided_at", { ascending: false }).limit(300)
        let w = admin.from("gate_releases")
          .select("id, regn_no, requested_at, gate_documents(customer_name)")
          .eq("status", "asked")
          .order("requested_at", { ascending: true }).limit(200)
        if (!isAdmin(caller)) { r = r.eq("entity_id", caller.entity_id); w = w.eq("entity_id", caller.entity_id) }
        const [rel, wait] = await Promise.all([r, w]) as unknown as [
          { data: { id: string; regn_no: string; decided_at: string; valid_until: string; users: { full_name: string } | null; gate_documents: { customer_name: string } | null }[] | null; error: unknown },
          { data: { id: string; regn_no: string; requested_at: string; gate_documents: { customer_name: string } | null }[] | null; error: unknown },
        ]
        if (rel.error || wait.error) return json({ error: "The list could not be loaded. Try again." }, 503)
        // One row per plate: two invoices for one truck show once, with the later expiry —
        // the same answer gateCheck gives. A plate that may go is not also listed as waiting.
        const released = new Map<string, Record<string, unknown>>()
        for (const x of rel.data ?? []) {
          const prev = released.get(x.regn_no)
          if (prev && String(prev.valid_until) >= x.valid_until) continue
          released.set(x.regn_no, { id: x.id, regn_no: x.regn_no, customer: customerOf(x.gate_documents),
            decided_by: x.users?.full_name ?? null, decided_at: x.decided_at, valid_until: x.valid_until })
        }
        const waiting = new Map<string, Record<string, unknown>>()
        for (const x of wait.data ?? []) {
          if (released.has(x.regn_no) || waiting.has(x.regn_no)) continue
          waiting.set(x.regn_no, { id: x.id, regn_no: x.regn_no, customer: customerOf(x.gate_documents), requested_at: x.requested_at })
        }
        return json({ ok: true, as_of: nowIso, released: [...released.values()], waiting: [...waiting.values()] })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    console.error("gate-invoices:", (e as Error).message)
    return json({ error: "Internal error" }, 500)
  }
})
