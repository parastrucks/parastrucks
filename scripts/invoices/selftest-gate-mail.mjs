// Offline test of the gate-invoices Edge Function's parts that need no network:
//   smtp.ts   the whole SMTP conversation against a scripted fake server (split reads,
//             multi-line replies, refusals, a silent server, a dropped connection)
//   mail.ts   the email words and the MIME message — the PDF comes back byte for byte
//   check.ts  the server's re-check of the browser's reading — fed the READER'S OWN
//             output (the boundary between browser and server), then tampered readings
//
// The modules are TypeScript; bundle first (from the repo root):
//   npx --yes esbuild scripts/invoices/selftest-gate-mail.mjs --bundle --platform=node --format=esm \
//     --external:jspdf --external:pdfjs-dist --outfile=<tmp>/gm.mjs
//   node <tmp>/gm.mjs [--real <dir with the SAP sample PDFs>]
// (run the bundle from the repo root so node_modules resolves)

import fs from 'node:fs'
import path from 'node:path'
import { sendSmtp, dotStuff, SmtpError } from '../../supabase/functions/gate-invoices/smtp.ts'
import { invoiceEmail, mimeMessage, encodeHeader, rupees, senderFor, properName } from '../../supabase/functions/gate-invoices/mail.ts'
import { PARAS_LOGO_PNG_B64, AL_LOGO_PNG_B64 } from '../../supabase/functions/gate-invoices/logos.ts'
import { checkReading, cleanEmail, recipientAllowed, mayUse } from '../../supabase/functions/gate-invoices/check.ts'
import { readSapInvoice } from '../../src/invoices/lib/sapInvoice.js'
import { pdfToLines } from '../../src/invoices/lib/pdfLines.js'
import { demoWorkshop, demoCounter } from './demo-invoices.mjs'

let pass = 0, failed = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass++
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

// ── a scripted SMTP server ───────────────────────────────────────────
// `script` maps each command the client sends to the reply; replies are delivered in
// small pieces to prove the client re-assembles them.
function fakeServer({ replies = {}, silentAt = null, closeAt = null, chunk = 7 } = {}) {
  const enc = new TextEncoder(), dec = new TextDecoder()
  const got = []
  let pending = []
  let inData = false, dataBuf = ''
  let waiter = null
  const push = (s) => { pending.push(...enc.encode(s)); if (waiter) { const w = waiter; waiter = null; w() } }
  const R = {
    greeting: '220 smtp.gmail.com ESMTP fake\r\n',
    EHLO: '250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n',
    AUTH: '235 2.7.0 Accepted\r\n', MAIL: '250 2.1.0 OK\r\n', RCPT: '250 2.1.5 OK\r\n',
    DATA: '354 Go ahead\r\n', MESSAGE: '250 2.0.0 OK  1729000000 fake-id.gsmtp\r\n', QUIT: '221 2.0.0 closing\r\n',
    ...replies,
  }
  let closed = false
  const answer = (verb) => {
    if (silentAt === verb) return
    if (closeAt === verb) { closed = true; if (waiter) { const w = waiter; waiter = null; w() } return }
    push(R[verb])
  }
  answer('greeting')
  const conn = {
    async read(p) {
      while (pending.length === 0) {
        if (closed) return null
        await new Promise((res) => { waiter = res })
      }
      const n = Math.min(chunk, p.length, pending.length)
      p.set(pending.splice(0, n)); return n
    },
    async write(p) {
      const s = dec.decode(p)
      if (inData) {
        dataBuf += s
        if (dataBuf.endsWith('\r\n.\r\n')) { inData = false; got.push({ verb: 'MESSAGE', data: dataBuf }); answer('MESSAGE') }
        return Math.min(p.length, 50)   // a short write: the client must loop
          && p.length
      }
      for (const line of s.split('\r\n').filter(Boolean)) {
        const verb = line.split(/[ :]/)[0]
        got.push({ verb, line })
        if (verb === 'DATA') { answer('DATA'); inData = true } else answer(verb)
      }
      return p.length
    },
    close() { closed = true },
  }
  return { conn, got }
}
const opts = (extra = {}) => ({ host: 'smtp.gmail.com', port: 465, user: 'accounts.guj@parastrucks.in', pass: 'app-pass-NOT-REAL',
  from: 'accounts.guj@parastrucks.in', to: 'demo.customer@example.com', message: 'Subject: x\r\n\r\nhello\r\n.dot line\r\n', timeoutMs: 400, ...extra })

section('SMTP conversation')
{
  const s = fakeServer()
  const r = await sendSmtp(opts(), async () => s.conn)
  const verbs = s.got.map((g) => g.verb)
  ok('commands in order: EHLO AUTH MAIL RCPT DATA message QUIT', verbs.join(' ') === 'EHLO AUTH MAIL RCPT DATA MESSAGE QUIT', verbs.join(' '))
  const auth = s.got.find((g) => g.verb === 'AUTH').line.split(' ')
  ok('AUTH PLAIN carries \\0user\\0pass', auth[1] === 'PLAIN' && Buffer.from(auth[2], 'base64').toString() === '\0accounts.guj@parastrucks.in\0app-pass-NOT-REAL')
  ok('MAIL FROM / RCPT TO name the addresses', s.got.some((g) => g.line === 'MAIL FROM:<accounts.guj@parastrucks.in>') && s.got.some((g) => g.line === 'RCPT TO:<demo.customer@example.com>'))
  const data = s.got.find((g) => g.verb === 'MESSAGE').data
  ok('a body line starting with "." is dot-stuffed and the message ends CRLF.CRLF', data.includes('\r\n..dot line\r\n') && data.endsWith('\r\n.\r\n'))
  ok("the server's final answer is returned (message id)", /250 2\.0\.0 OK .*fake-id/.test(r.reply), r.reply)
}
{
  const s = fakeServer({ chunk: 1 })
  const r = await sendSmtp(opts(), async () => s.conn)
  ok('replies delivered one byte at a time still parse (multi-line EHLO too)', /fake-id/.test(r.reply))
}
const refused = async (o, srv) => { try { await sendSmtp(opts(o), async () => srv.conn); return null } catch (e) { return e } }
{
  const e = await refused({}, fakeServer({ replies: { AUTH: '535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 https://support.google.com/mail/?p=BadCredentials\r\n' } }))
  ok('wrong app password → SmtpError at auth, 535, says what to check', e instanceof SmtpError && e.stage === 'auth' && e.code === 535 && /app password/.test(e.message), e?.message)
  ok('…and the error text never contains the password', e && !e.message.includes('app-pass-NOT-REAL') && !e.message.includes(Buffer.from('\0accounts.guj@parastrucks.in\0app-pass-NOT-REAL').toString('base64')))
}
{
  const e = await refused({}, fakeServer({ replies: { RCPT: '550 5.1.1 The email account that you tried to reach does not exist.\r\n' } }))
  ok('unknown recipient → refused at rcpt_to with the server text', e?.stage === 'rcpt_to' && e.code === 550 && /does not exist/.test(e.message), e?.message)
  const s = fakeServer({ replies: { RCPT: '550 no\r\n' } })
  await refused({}, s)
  ok('…and no DATA was sent after the refusal', !s.got.some((g) => g.verb === 'DATA'))
}
{
  const e = await refused({}, fakeServer({ silentAt: 'MESSAGE' }))
  ok('a silent server → time-out error, not a hang', e instanceof SmtpError && /did not answer/.test(e.message), e?.message)
  const e2 = await refused({}, fakeServer({ closeAt: 'EHLO' }))
  ok('a dropped connection → clear error', e2 instanceof SmtpError && /closed the connection/.test(e2.message), e2?.message)
  const e3 = await refused({}, fakeServer({ replies: { greeting: 'hello there\r\n' } }))
  ok('a non-SMTP answer → refused', e3 instanceof SmtpError && /Unexpected reply/.test(e3.message), e3?.message)
}
ok('dotStuff: bare LF becomes CRLF; a leading dot doubles', dotStuff('a\n.b\n') === 'a\r\n..b\r\n.\r\n')

// ── the email ────────────────────────────────────────────────────────
section('email words + MIME')
// Owner, 2026-10-25: no invoice / job card / bill numbers; the vehicle number; only the total,
// highlighted; the company's own sign-off.
const sender = senderFor({ code: 'PTB', full_name: 'PARAS TRUCKS AND BUSES', address: 'x' })
const wdoc = { layout: 'workshop', doc_no: 'WTY57562627099001', doc_date: '2026-10-24', customer_name: 'DEMO KRISHNA LOGISTICS PVT LTD', regn_no: 'GJ01ZZ0001', total_paise: 4066500 }
const NUMBERS = /WTY\d|[LP]C[RS]\d|MCI\d|\d{10,}/
{
  const m = invoiceEmail(wdoc, sender)
  ok('workshop subject: the vehicle number and the company, nothing else', m.subject === 'Invoice for your vehicle GJ01ZZ0001 – Paras Trucks and Buses', m.subject)
  for (const [k, v] of Object.entries(m)) ok(`no invoice / job card / bill number in the ${k}`, !NUMBERS.test(v), v.match(NUMBERS)?.[0])
  ok('the attachment is named after the vehicle', m.attachmentName === 'Invoice GJ01ZZ0001.pdf')
  ok('text: thank-you for servicing the vehicle, the total once', /Thank you for getting your vehicle GJ01ZZ0001 serviced at our workshop\. Please find your invoice attached\./.test(m.text)
    && (m.text.match(/₹/g) || []).length === 1 && /Total amount: ₹40,665\.00/.test(m.text), m.text)
  ok('html: the total is the one big bold amount', /font-weight:bold[^>]*>₹40,665\.00</.test(m.html) && (m.html.match(/₹/g) || []).length === 1)
  ok('html: the vehicle number in bold', /<b>GJ01ZZ0001<\/b>/.test(m.html))
  ok('no labour / parts split anywhere', !/labour|parts|7,080|33,585/i.test(m.text + m.html))
  ok("SAP's capitals become a proper name (Pvt Ltd)", /Dear Demo Krishna Logistics Pvt Ltd,/.test(m.text) && /Dear Demo Krishna Logistics Pvt Ltd,/.test(m.html))
  ok('sign-off like the company mails: Kind regards · Accounts Team · company · address · mobile · Authorized Dealer',
    /Kind regards\r\nAccounts Team\r\nParas Trucks and Buses\r\n\r\nSurvey No\. 271P, SP Ring Road, Near Concept Motors\r\nSanathal Circle, Sanathal, Ahmedabad - 382210\r\nMobile: \+91 74969 70321\r\n\r\nAuthorized Dealer - Ashok Leyland$/.test(m.text), m.text)
  ok('html sign-off shows both logos by cid', /src="cid:paras-logo"/.test(m.html) && /src="cid:al-logo"/.test(m.html) && /Authorized Dealer -/.test(m.html))
  const c = invoiceEmail({ ...wdoc, layout: 'counter_sale', customer_name: 'DEMO SHIV SPARES', regn_no: null, total_paise: 3140000 }, sender)
  ok('counter sale: no vehicle, no invoice number — "Your invoice from …", total, dated attachment',
    c.subject === 'Your invoice from Paras Trucks and Buses' && /Thank you for your purchase from Paras Trucks and Buses\./.test(c.text)
    && /Total amount: ₹31,400\.00/.test(c.text) && c.attachmentName === 'Invoice 24-Oct-2026.pdf' && !NUMBERS.test(c.subject + c.text + c.html), JSON.stringify(c.subject))
  const noRegn = invoiceEmail({ ...wdoc, regn_no: null }, sender)
  ok('a workshop job without a plate still reads right', noRegn.subject === 'Your invoice from Paras Trucks and Buses' && /Thank you for getting your vehicle serviced/.test(noRegn.text))
  const evil = invoiceEmail({ ...wdoc, customer_name: 'EVIL <script>alert(1)</script>\r\nBcc: x@y.z\u0000 & CO' }, sender)
  ok('a name cannot inject HTML or a new line', !/<script>/i.test(evil.html) && /&lt;script&gt;/.test(evil.html) && !/\r\nBcc/.test(evil.text) && /&amp; CO/.test(evil.html), evil.html.slice(0, 300))
  ok('properName keeps mixed case and LLP / M/S', properName('Shree Hari Bus') === 'Shree Hari Bus' && properName('M/S RAM TRANSPORT LLP') === 'M/S Ram Transport LLP' && properName('A.K. ROADLINES') === 'A.K. Roadlines')
  const other = senderFor({ code: 'PT', full_name: 'Paras Trucks', address: 'Line one\nLine two' })
  ok('another company signs with its own name and address, no borrowed phone', other.company === 'Paras Trucks' && other.addressLines.join('|') === 'Line one|Line two' && other.phone === null)
  ok('rupees: Indian grouping', rupees(12345678) === '₹1,23,456.78' && rupees(5) === '₹0.05')
}
{
  const pdf = demoWorkshop()
  const mail = invoiceEmail(wdoc, sender)
  const images = [{ cid: 'paras-logo', filename: 'paras-logo.png', contentType: 'image/png', base64: PARAS_LOGO_PNG_B64 },
    { cid: 'al-logo', filename: 'ashok-leyland.png', contentType: 'image/png', base64: AL_LOGO_PNG_B64 }]
  const m = mimeMessage({ fromName: 'Paras Trucks and Buses – Accounts', from: 'accounts.guj@parastrucks.in', to: 'demo.customer@example.com',
    subject: mail.subject, text: mail.text, html: mail.html, images, attachment: { filename: mail.attachmentName, bytes: pdf },
    messageId: '0b9c7c9e-1111-4222-8333-944445555666', date: new Date(Date.UTC(2026, 9, 24, 12)) })
  const lines = m.split('\r\n')
  ok('every line ≤ 78 characters, CRLF only', lines.every((l) => l.length <= 78) && !/[^\r]\n/.test(m), String(Math.max(...lines.map((l) => l.length))))
  ok('headers: From, To, Reply-To, Date, Message-ID, multipart/mixed', /^From: =\?UTF-8\?B\?.+\?=\r\n <accounts\.guj@parastrucks\.in>$/m.test(m) && /^To: <demo\.customer@example\.com>$/m.test(m)
    && /^Reply-To: <accounts\.guj@parastrucks\.in>$/m.test(m) && /^Date: Sat, 24 Oct 2026 12:00:00 \+0000$/m.test(m)
    && /^Message-ID: <0b9c7c9e-1111-4222-8333-944445555666@parastrucks\.in>$/m.test(m) && /^Content-Type: multipart\/mixed; boundary="mix-/m.test(m))
  const subjHeader = /^Subject: (.*(?:\r\n .*)*)/m.exec(m)?.[1] ?? ''
  const words = [...subjHeader.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((w) => Buffer.from(w[1], 'base64'))
  ok('Subject is UTF-8 encoded, folded over lines, and decodes back (the – survives)', words.length > 1 && Buffer.concat(words).toString() === mail.subject, subjHeader)
  // Walk the MIME tree: every leaf with its headers and decoded body.
  const leaves = []
  const walk = (raw) => {
    const [head, ...rest] = raw.split('\r\n\r\n'); const body = rest.join('\r\n\r\n')
    const b = /boundary="([^"]+)"/.exec(head)?.[1]
    if (!b) { leaves.push({ head, body: Buffer.from(body.replace(/\r\n/g, ''), 'base64'), type: /Content-Type: ([^;\r]+)/.exec(head)?.[1] }); return }
    ok(`multipart ${/Content-Type: (multipart\/\w+)/.exec(head)[1]} closes its boundary`, body.includes(`--${b}--`))
    body.split(`--${b}`).slice(1, -1).map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, '')).forEach(walk)
  }
  walk(m)
  ok('structure: text, html, two inline logos, the PDF — in that order', leaves.map((l) => l.type).join(',') === 'text/plain,text/html,image/png,image/png,application/pdf', leaves.map((l) => l.type).join(','))
  ok('the text part decodes to the email text (₹ intact)', leaves[0]?.body.toString() === mail.text)
  ok('the html part decodes to the email html', leaves[1]?.body.toString() === mail.html)
  ok('the logos are real PNGs with the cids the html uses', leaves.slice(2, 4).every((l) => l.body.subarray(1, 4).toString() === 'PNG')
    && /Content-ID: <paras-logo>/.test(leaves[2]?.head) && /Content-ID: <al-logo>/.test(leaves[3]?.head) && /inline/.test(leaves[2]?.head))
  ok('the attachment decodes to the PDF byte for byte, named after the vehicle', leaves[4] && Buffer.compare(leaves[4].body, Buffer.from(pdf)) === 0 && /filename="Invoice GJ01ZZ0001\.pdf"/.test(leaves[4].head))
  ok('nothing in the whole message carries the job card or bill numbers', !/WTY57562627099001|LCR5756269900001|PCR5756269900001/.test(m + leaves.slice(0, 2).map((l) => l.body.toString()).join('')))
  ok('encodeHeader leaves plain ASCII alone', encodeHeader('Invoice 1') === 'Invoice 1')
  // and through the client: the whole message survives the SMTP path unchanged
  const s = fakeServer()
  await sendSmtp(opts({ message: m }), async () => s.conn)
  const sentData = s.got.find((g) => g.verb === 'MESSAGE').data
  ok('the MIME message goes through SMTP unchanged (no dot-stuffing needed)', sentData === m.replace(/\r\n$/, '') + '\r\n.\r\n' || sentData === m + '.\r\n')
}

// ── the server's check of the browser's reading ─────────────────────
section('server re-check of the reading')
const pdfjs = await import(`file:///${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/legacy/build/pdf.mjs`)
const readings = []
for (const [name, bytes] of [['DEMO workshop', demoWorkshop()], ['DEMO workshop cash', demoWorkshop({ credit: false })], ['DEMO counter', demoCounter()]]) {
  readings.push([name, readSapInvoice(await pdfToLines(pdfjs, bytes))])
}
const realAt = process.argv.indexOf('--real')
if (realAt > 0) {
  const dir = process.argv[realAt + 1]
  let i = 0
  for (const f of fs.readdirSync(dir).filter((f) => /tax invoice\.pdf$/i.test(f))) {
    readings.push([`real #${++i}`, readSapInvoice(await pdfToLines(pdfjs, new Uint8Array(fs.readFileSync(path.join(dir, f)))))])
  }
}
for (const [name, r] of readings) {
  ok(`${name}: the reader's output passes the server's check`, r.ok && checkReading(r) === null, r.ok ? checkReading(r) : r.reason)
}
const base = readings[0][1]
const tamper = (f) => { const c = structuredClone(base); f(c); return checkReading(c) }
ok('total one paisa off → refused', tamper((c) => { c.total_paise += 1 }) !== null)
ok('a bill listed twice → refused', tamper((c) => { c.bills.push({ ...c.bills[0] }); c.total_paise += c.bills[0].amount_paise }) !== null)
ok('a float amount → refused', tamper((c) => { c.bills[0].amount_paise += 0.5; c.total_paise += 0.5 }) !== null)
ok('a negative bill balancing a bigger one → refused', tamper((c) => { c.bills[0].amount_paise = -100; c.bills[1].amount_paise += 708100 }) !== null)
ok('another SAP form → refused', tamper((c) => { c.sap_form = 'ZDBMF_COVERING_LETTER_002' }) !== null)
ok('form/layout mismatch → refused', tamper((c) => { c.layout = 'counter_sale' }) !== null)
ok('31 Feb → refused', tamper((c) => { c.doc_date = '2026-02-31' }) !== null)
ok('no seller GSTIN → refused', tamper((c) => { c.seller_gstin = null }) !== null)
ok('SAP code with letters → refused', tamper((c) => { c.customer.sap_code = '12AB' }) !== null)
ok('an 11-digit mobile → refused', tamper((c) => { c.customer.mobile = '90000000011' }) !== null)
ok('a 2,000-character name → refused', tamper((c) => { c.customer.name = 'A'.repeat(2000) }) !== null)
ok('a workshop job with no vehicle → refused', tamper((c) => { c.vehicle = null }) !== null)
ok('nothing sent → refused', checkReading(null) !== null && checkReading({}) !== null)

section('addresses + who may use it')
ok('email: lower-cased and trimmed', cleanEmail('  Demo.Customer@Example.COM ') === 'demo.customer@example.com')
for (const bad of ['a@b.com\r\nBcc: c@d.com', 'a@b.com, c@d.com', 'a@b', 'a b@c.com', '<a@b.com>', 'a@@b.com', 'a@b..com', `${'a'.repeat(250)}@b.com`, null]) {
  ok(`email refused: ${JSON.stringify(bad)?.slice(0, 40)}`, cleanEmail(bad) === null)
}
ok('allow-list: empty allows all', recipientAllowed('x@example.com', undefined) && recipientAllowed('x@example.com', ' '))
ok('allow-list: domain and exact address', recipientAllowed('a@parastrucks.in', '@parastrucks.in,x@gmail.com') && recipientAllowed('x@gmail.com', '@parastrucks.in,x@gmail.com')
  && !recipientAllowed('y@gmail.com', '@parastrucks.in,x@gmail.com') && !recipientAllowed('a@evilparastrucks.in', '@parastrucks.in'))
ok('who: service, accounts, spares, admin — and not sales, hr, back office, pdi, nobody',
  ['service', 'accounts', 'spares'].every((d) => mayUse({ permission_level: 'executive', department_code: d }))
  && mayUse({ permission_level: 'admin', department_code: null })
  && ['sales', 'hr', 'back_office', 'pdi', 'admin', null].every((d) => !mayUse({ permission_level: 'gm', department_code: d })))

console.log(`\n${pass} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
