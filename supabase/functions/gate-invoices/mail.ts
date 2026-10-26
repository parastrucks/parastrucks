// The invoice email: its words, and the MIME message that carries the PDF.
//
// Owner, 2026-10-25, after the first real send:
//   - no invoice / job card / bill numbers — the vehicle's registration number is the only
//     thing the customer is concerned about (subject, body AND the attachment's name);
//   - only the TOTAL billed amount, highlighted — not labour and parts separately;
//   - sign off like the company's own mails: "Kind regards", name + role, the Paras logo,
//     the address, a phone number, "Authorized Dealer -" + the Ashok Leyland logo.
//   - most of these invoices are for vehicles released ON CREDIT (a vehicle paid before release
//     rarely comes through here), so every message asks for timely payment and says why: without
//     it we cannot keep providing the best of our service. One line thanks anyone who has paid.
// HTML for the highlight and the logos (embedded, cid:), with a plain-text twin for mail
// apps that show text only.
//
// Pure (no Deno, no network) so scripts/invoices/selftest-gate-mail.mjs checks it offline.

export type MailDoc = {
  layout: "workshop" | "counter_sale"
  doc_date: string          // YYYY-MM-DD
  customer_name: string
  regn_no: string | null
  total_paise: number
}
export type Sender = {
  company: string           // "Paras Trucks and Buses"
  team: string              // "Accounts Team"
  addressLines: string[]
  phone: string | null
}
export type Email = { subject: string; text: string; html: string; attachmentName: string }

// The sign-off. PTB's lines are the ones the company's own mail signatures use (info.guj@,
// ceo@ — read 2026-10-25); the number is the one SAP prints as the dealer's "Mob No" on every
// invoice — confirmed by the owner 2026-10-25. Another company falls back to its entities row.
const SIGNATURES: Record<string, Omit<Sender, "team">> = {
  PTB: {
    company: "Paras Trucks and Buses",
    addressLines: ["Survey No. 271P, SP Ring Road, Near Concept Motors", "Sanathal Circle, Sanathal, Ahmedabad - 382210"],
    phone: "+91 74969 70321",
  },
}
export function senderFor(entity: { code?: string | null; full_name?: string | null; address?: string | null } | null): Sender {
  const known = entity?.code ? SIGNATURES[entity.code] : undefined
  if (known) return { ...known, team: "Accounts Team" }
  return {
    company: entity?.full_name ?? "Paras Trucks and Buses",
    team: "Accounts Team",
    addressLines: String(entity?.address ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3),
    phone: null,
  }
}

export function rupees(paise: number): string {
  const r = String(Math.floor(Math.abs(paise) / 100))
  const g = r.length > 3 ? r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + r.slice(-3) : r
  return `${paise < 0 ? "-" : ""}₹${g}.${String(Math.abs(paise) % 100).padStart(2, "0")}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// Names come from the PDF: printable characters only, so nothing in a name can shape the message.
const printable = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

// SAP prints names in capitals; "Dear SHREE HARI BUS SERVICES" reads as shouting.
const KEEP_UPPER = new Set(["LLP", "HUF", "M/S", "OPC", "II", "III", "PSU"])
export function properName(raw: string): string {
  const s = printable(raw)
  if (/[a-z]/.test(s)) return s                       // already mixed case — leave it
  return s.split(" ").map((w) =>
    KEEP_UPPER.has(w) || /\d/.test(w) ? w : w.toLowerCase().replace(/(^|[(&/.-])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  ).join(" ")
}

export function invoiceEmail(doc: MailDoc, sender: Sender): Email {
  const name = properName(doc.customer_name)
  const company = printable(sender.company)
  const regn = doc.layout === "workshop" && doc.regn_no ? printable(doc.regn_no) : null
  const total = rupees(doc.total_paise)

  const subject = regn ? `Invoice for your vehicle ${regn} – ${company}` : `Your invoice from ${company}`
  const thanks = doc.layout === "workshop"
    ? `Thank you for getting your vehicle${regn ? ` ${regn}` : ""} serviced at our workshop.`
    : `Thank you for your purchase from ${company}.`
  const attachmentName = regn ? `Invoice ${regn}.pdf` : `Invoice ${longDate(doc.doc_date).replace(/ /g, "-")}.pdf`
  const payAsk = "We request you to kindly make this payment on time."
  const payWhy = "Timely payments are what allow us to keep providing you the best of our service — without them, we will not be able to continue doing so."
  const paid = "If you have already paid, thank you, and please ignore this note."

  const signText = [
    "Kind regards",
    sender.team,
    company,
    "",
    ...sender.addressLines.map(printable),
    ...(sender.phone ? [`Mobile: ${sender.phone}`] : []),
    "",
    "Authorized Dealer - Ashok Leyland",
  ]
  const text = [
    `Dear ${name},`,
    "",
    `${thanks} Please find your invoice attached.`,
    "",
    `Total amount: ${total}`,
    "",
    `${payAsk} ${payWhy} ${paid}`,
    "",
    "If you have any questions about this invoice, simply reply to this email.",
    "",
    ...signText,
  ].join("\r\n")

  const thanksHtml = regn ? esc(thanks).replace(esc(regn), `<b>${esc(regn)}</b>`) : esc(thanks)
  const small = "font-size:12px;color:#555555;line-height:1.45"
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="font-family:Calibri,Carlito,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:560px;padding:8px 4px">
<p style="margin:0 0 14px">Dear ${esc(name)},</p>
<p style="margin:0 0 14px">${thanksHtml} Please find your invoice attached.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 18px">
<tr><td style="background:#EAF0FE;border-left:4px solid #2563EB;padding:12px 20px">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#555555">Total amount</div>
<div style="font-size:26px;font-weight:bold;color:#000000;line-height:1.25">${esc(total)}</div>
</td></tr></table>
<p style="margin:0 0 14px"><b>${esc(payAsk)}</b> ${esc(payWhy)} ${esc(paid)}</p>
<p style="margin:0 0 22px">If you have any questions about this invoice, simply reply to this email.</p>
<div style="color:#222222">Kind regards</div>
<div style="color:#222222"><b>${esc(sender.team)}</b></div>
<div style="color:#222222;margin-bottom:6px"><i>${esc(company)}</i></div>
<img src="cid:paras-logo" width="150" height="62" alt="${esc(company)}" style="display:block;border:0;margin:0 0 6px">
<div style="${small}">${sender.addressLines.map((l) => esc(printable(l))).join("<br>")}${sender.phone ? `<br>Mobile: ${esc(sender.phone)}` : ""}</div>
<div style="color:#222222;font-size:13px;margin-top:12px">Authorized Dealer -</div>
<img src="cid:al-logo" width="188" height="40" alt="Ashok Leyland" style="display:block;border:0;margin-top:2px">
</div></body></html>`

  return { subject, text, html, attachmentName }
}

export function base64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n")
const utf8b64 = (s: string) => base64(new TextEncoder().encode(s))
const unwrapB64 = (s: string) => s.replace(/\s+/g, "")

/** RFC 2047 encoded-words when the text is not plain ASCII (₹, –). Each word carries at most
 *  39 bytes (52 base64 characters: "Subject: " + one word stays under 78) and never splits a character;
 *  words are folded onto continuation lines, which keeps every header line under 78. */
export function encodeHeader(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s
  const enc = new TextEncoder()
  const words: string[] = []
  let cur = ""
  for (const ch of s) {
    if (enc.encode(cur + ch).length > 39) { words.push(cur); cur = "" }
    cur += ch
  }
  if (cur) words.push(cur)
  return words.map((w) => `=?UTF-8?B?${utf8b64(w)}?=`).join("\r\n ")
}

export type InlineImage = { cid: string; filename: string; contentType: string; base64: string }

/** multipart/mixed[ multipart/related[ multipart/alternative[text, html], images… ], pdf ] */
export function mimeMessage(o: {
  fromName: string
  from: string
  to: string
  subject: string
  text: string
  html: string
  images: InlineImage[]
  attachment: { filename: string; bytes: Uint8Array }
  messageId: string
  date: Date
}): string {
  const tag = o.messageId.replace(/[^a-z0-9]/gi, "").slice(0, 20)
  const mixed = `mix-${tag}`, related = `rel-${tag}`, alt = `alt-${tag}`
  const filename = o.attachment.filename.replace(/[^A-Za-z0-9._ -]/g, "_")
  const part = (headers: string[], body: string) => [...headers, "", body].join("\r\n")
  const textPart = part(["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"], wrap76(utf8b64(o.text)))
  const htmlPart = part(["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"], wrap76(utf8b64(o.html)))
  const images = o.images.map((im) => part([
    `Content-Type: ${im.contentType}; name="${im.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${im.cid}>`,
    `Content-Disposition: inline; filename="${im.filename}"`,
  ], wrap76(unwrapB64(im.base64))))
  const pdfPart = part([
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
  ], wrap76(base64(o.attachment.bytes)))
  const multipart = (boundary: string, parts: string[]) =>
    [...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join("\r\n")

  const alternative = part([`Content-Type: multipart/alternative; boundary="${alt}"`], multipart(alt, [textPart, htmlPart]))
  const relatedPart = part([`Content-Type: multipart/related; boundary="${related}";\r\n type="multipart/alternative"`],
    multipart(related, [alternative, ...images]))
  return [
    `From: ${encodeHeader(o.fromName)}\r\n <${o.from}>`,    // folded: name + address exceed 78
    `To: <${o.to}>`,
    `Reply-To: <${o.from}>`,
    `Subject: ${encodeHeader(o.subject)}`,
    `Date: ${o.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${o.messageId}@parastrucks.in>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    multipart(mixed, [relatedPart, pdfPart]),
  ].join("\r\n")
}
