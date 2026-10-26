// Minimal SMTP client — implicit TLS (SMTPS, port 465), AUTH PLAIN, one recipient.
//
// Why not a library: Supabase Edge Functions block outbound ports 25 and 587 (docs,
// "Functions → Limits"), so Gmail is reached on 465 with TLS from the first byte, which
// Deno.connectTls does natively. The conversation is eight commands; owning it means no
// dependency whose Deno/edge-runtime support we cannot verify, and the whole exchange is
// tested offline against a scripted server (scripts/invoices/selftest-gate-mail.mjs).
//
// The password is only ever sent inside AUTH PLAIN; no error message or log line built
// here contains it.

export type Conn = {
  read(p: Uint8Array): Promise<number | null>
  write(p: Uint8Array): Promise<number>
  close(): void
}
export type Connect = (host: string, port: number) => Promise<Conn>

export type SmtpSend = {
  host: string
  port: number
  user: string
  pass: string
  from: string
  to: string
  message: string        // the full RFC 5322 message, CRLF line endings
  heloName?: string
  timeoutMs?: number
}

export class SmtpError extends Error {
  constructor(public stage: string, public code: number | null, message: string) { super(message) }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function base64Ascii(s: string): string {
  return btoa(String.fromCharCode(...enc.encode(s)))
}

/** Lines starting with "." get one more (RFC 5321 §4.5.2); the body ends with CRLF.CRLF. */
export function dotStuff(message: string): string {
  const body = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..")
  return (body.endsWith("\r\n") ? body : body + "\r\n") + ".\r\n"
}

export async function sendSmtp(o: SmtpSend, connect: Connect): Promise<{ reply: string }> {
  const timeoutMs = o.timeoutMs ?? 20000
  const conn = await withTimeout(connect(o.host, o.port), timeoutMs, "connect")
  let buf = ""
  const chunk = new Uint8Array(4096)

  async function reply(stage: string): Promise<{ code: number; text: string }> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      // A reply is complete at a line "NNN text" (a hyphen after the code means more follow).
      const lines = buf.split("\r\n")
      for (let i = 0; i < lines.length - 1; i++) {
        const m = /^(\d{3})([ -])(.*)$/.exec(lines[i])
        if (!m) throw new SmtpError(stage, null, `Unexpected reply from the mail server: ${lines[i].slice(0, 120)}`)
        if (m[2] === " ") {
          const text = lines.slice(0, i + 1).map((l) => l.slice(4)).join(" ")
          buf = lines.slice(i + 1).join("\r\n")
          return { code: Number(m[1]), text }
        }
      }
      const left = deadline - Date.now()
      if (left <= 0) throw new SmtpError(stage, null, `The mail server did not answer (${stage}).`)
      const n = await withTimeout(conn.read(chunk), left, stage)
      if (n === null) throw new SmtpError(stage, null, `The mail server closed the connection (${stage}).`)
      buf += dec.decode(chunk.subarray(0, n), { stream: true })
    }
  }
  async function send(line: string) {
    const bytes = enc.encode(line)
    let off = 0
    while (off < bytes.length) off += await conn.write(bytes.subarray(off))
  }
  async function step(stage: string, line: string | null, ok: number[]) {
    if (line !== null) await send(line)
    const r = await reply(stage)
    if (!ok.includes(r.code)) throw new SmtpError(stage, r.code, explain(stage, r.code, r.text))
    return r
  }

  try {
    await step("greeting", null, [220])
    await step("ehlo", `EHLO ${o.heloName ?? "portal.parastrucks.in"}\r\n`, [250])
    await step("auth", `AUTH PLAIN ${base64Ascii(`\u0000${o.user}\u0000${o.pass}`)}\r\n`, [235])
    await step("mail_from", `MAIL FROM:<${o.from}>\r\n`, [250])
    await step("rcpt_to", `RCPT TO:<${o.to}>\r\n`, [250, 251])
    await step("data", "DATA\r\n", [354])
    const done = await step("message", dotStuff(o.message), [250])
    try { await send("QUIT\r\n"); await reply("quit") } catch { /* already delivered */ }
    return { reply: `${done.code} ${done.text}`.slice(0, 300) }
  } finally {
    try { conn.close() } catch { /* closed */ }
  }
}

function explain(stage: string, code: number, text: string): string {
  const said = text.replace(/\s+/g, " ").slice(0, 200)
  if (stage === "auth") return `Gmail refused the sign-in for the sending account (${code}). Check the app password and that 2-Step Verification is on. Server said: ${said}`
  if (stage === "rcpt_to") return `The mail server refused the address (${code}): ${said}`
  return `The mail server refused at ${stage} (${code}): ${said}`
}

function withTimeout<T>(p: Promise<T>, ms: number, stage: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new SmtpError(stage, null, `The mail server did not answer in time (${stage}).`)), ms) }),
  ])
}
