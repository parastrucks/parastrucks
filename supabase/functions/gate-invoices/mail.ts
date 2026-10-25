// The invoice email: its words, and the MIME message that carries the PDF.
//
// Owner, 2026-10-24: "invoice number, the amount, the attachment of the invoice, and basic
// message details thanking them that they got their vehicle worked upon at our workshop."
// ⏭️ The wording below is a DRAFT for the owner to approve.
//
// Pure (no Deno, no network) so scripts/invoices/selftest-gate-mail.mjs checks it offline.

export type MailDoc = {
  layout: "workshop" | "counter_sale"
  doc_no: string
  doc_date: string          // YYYY-MM-DD
  customer_name: string
  regn_no: string | null
  total_paise: number
}
export type MailBill = { bill_no: string; amount_paise: number }
export type Sender = { company: string; addressLine: string }

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

// Names come from the PDF: keep printable characters only, so nothing in a name can
// shape the message.
const printable = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()

export function invoiceEmail(doc: MailDoc, bills: MailBill[], sender: Sender): { subject: string; text: string } {
  const name = printable(doc.customer_name)
  const company = printable(sender.company)
  const sign = ["Regards,", "Accounts", company, printable(sender.addressLine)].filter(Boolean)
  if (doc.layout === "workshop") {
    const width = Math.max(5, ...bills.map((b) => b.bill_no.length))
    const rows = [...bills.map((b) => [b.bill_no, rupees(b.amount_paise)]), ["Total", rupees(doc.total_paise)]]
      .map(([a, b]) => `  ${a.padEnd(width)}   ${b}`)
    return {
      subject: `Invoice for vehicle ${doc.regn_no ?? doc.doc_no} — ${company}`,
      text: [
        `Dear ${name},`,
        "",
        `Thank you for getting your vehicle${doc.regn_no ? ` ${doc.regn_no}` : ""} worked on at our workshop.`,
        "",
        `Your invoice for job card ${doc.doc_no}, dated ${longDate(doc.doc_date)}, is attached:`,
        "",
        ...rows,
        "",
        "If you have any question about this invoice, please reply to this email.",
        "",
        ...sign,
      ].join("\r\n"),
    }
  }
  return {
    subject: `Invoice ${doc.doc_no} — ${company}`,
    text: [
      `Dear ${name},`,
      "",
      `Thank you for your purchase from ${company}.`,
      "",
      `Invoice ${doc.doc_no}, dated ${longDate(doc.doc_date)}, for ${rupees(doc.total_paise)} is attached.`,
      "",
      "If you have any question about this invoice, please reply to this email.",
      "",
      ...sign,
    ].join("\r\n"),
  }
}

export function base64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n")
const utf8b64 = (s: string) => base64(new TextEncoder().encode(s))
/** RFC 2047 encoded-words when the text is not plain ASCII (₹, —). Each word carries at most
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

export function mimeMessage(o: {
  fromName: string
  from: string
  to: string
  subject: string
  text: string
  attachment: { filename: string; bytes: Uint8Array }
  messageId: string
  date: Date
}): string {
  const boundary = `gate-${o.messageId.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`
  const filename = o.attachment.filename.replace(/[^A-Za-z0-9._-]/g, "_")
  const head = [
    `From: ${encodeHeader(o.fromName)}\r\n <${o.from}>`,    // folded: name + address exceed 78
    `To: <${o.to}>`,
    `Reply-To: <${o.from}>`,
    `Subject: ${encodeHeader(o.subject)}`,
    `Date: ${o.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${o.messageId}@parastrucks.in>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
  return [
    ...head,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8b64(o.text)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(base64(o.attachment.bytes)),
    `--${boundary}--`,
    "",
  ].join("\r\n")
}
