// Web Push — wake an approver's phone when a credit release is asked (owner, 2026-10-26).
//
// Two standards, both with the platform's own WebCrypto (no library):
//   RFC 8291 — the message is encrypted to the phone's key (aes128gcm), so the push service
//              (Google / Apple / Mozilla / Microsoft) carries it without being able to read it;
//   RFC 8292 — VAPID: the request is signed with OUR key, so a push service accepts it only
//              from us. Keys: GATE_VAPID_PUBLIC_KEY (shared with the browser) and
//              GATE_VAPID_PRIVATE_KEY (the secret) — made by scripts/invoices/make-vapid-keys.mjs.
//
// Pure apart from the injected fetch — scripts/invoices/selftest-web-push.mjs checks the
// encryption byte for byte against RFC 8291 Appendix A, and the signature by verifying it.

const enc = new TextEncoder()

export function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToB64url(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** A P-256 key pair from the raw public point (65 bytes, 0x04‖x‖y) and private scalar d. */
async function importPair(publicRaw: Uint8Array, privateD: Uint8Array, usage: "ecdh" | "ecdsa") {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4 || privateD.length !== 32) throw new Error("bad P-256 key")
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: bytesToB64url(publicRaw.subarray(1, 33)), y: bytesToB64url(publicRaw.subarray(33, 65)), d: bytesToB64url(privateD),
  }
  const alg = usage === "ecdh" ? { name: "ECDH", namedCurve: "P-256" } : { name: "ECDSA", namedCurve: "P-256" }
  return await crypto.subtle.importKey("jwk", jwk, alg, false, usage === "ecdh" ? ["deriveBits"] : ["sign"])
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8))
}

export type Subscription = { endpoint: string; p256dh: string; auth: string }
export type EncryptOptions = { senderPublic: Uint8Array; senderPrivate: Uint8Array; salt: Uint8Array }

/**
 * RFC 8291 aes128gcm body: header (salt ‖ rs=4096 ‖ idlen ‖ sender key) ‖ ciphertext.
 * `fixed` exists ONLY so the self-test can reproduce Appendix A; in use, every message gets
 * a fresh one-time sender key and a random salt.
 */
export async function encryptPayload(plaintext: Uint8Array, sub: Pick<Subscription, "p256dh" | "auth">, fixed?: EncryptOptions): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh)
  const authSecret = b64urlToBytes(sub.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad subscription key")
  if (authSecret.length !== 16) throw new Error("bad subscription auth secret")
  if (plaintext.length > 3993) throw new Error("push message too long")   // one 4096-byte record

  let asPublic: Uint8Array, asPrivate: CryptoKey, salt: Uint8Array
  if (fixed) {
    asPublic = fixed.senderPublic
    asPrivate = await importPair(fixed.senderPublic, fixed.senderPrivate, "ecdh")
    salt = fixed.salt
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    asPrivate = pair.privateKey
    salt = crypto.getRandomValues(new Uint8Array(16))
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256))

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12)

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
  const padded = concat(plaintext, new Uint8Array([2]))               // 0x02 = last record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded))

  const header = new Uint8Array(21 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

export type Vapid = { publicKey: string; privateKey: string; subject: string }

/** RFC 8292: `vapid t=<ES256 JWT>, k=<our public key>`. The JWT names the push service's
 *  origin as audience and expires in 12 hours (the RFC's limit is 24). */
export async function vapidAuthorization(endpoint: string, v: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: v.subject })))
  const key = await importPair(b64urlToBytes(v.publicKey), b64urlToBytes(v.privateKey), "ecdsa")
  // WebCrypto's ECDSA signature is already r‖s (64 bytes) — exactly what a JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)))
  return `vapid t=${head}.${claims}.${bytesToB64url(sig)}, k=${v.publicKey}`
}

// Only the browsers' own push services. The endpoint comes from the browser, so without this
// list the server could be pointed at any address and made to POST to it.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/]
export function pushEndpointAllowed(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false
  let u: URL
  try { u = new URL(endpoint) } catch { return false }
  return u.protocol === "https:" && u.port === "" && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname))
}

export type PushResult = { ok: boolean; gone: boolean; status: number; error?: string }

/** Send one notification. `gone` = the push service says the subscription no longer exists
 *  (404/410): the caller deletes it. */
export async function sendPush(sub: Subscription, message: Record<string, unknown>, v: Vapid,
  fetchFn: typeof fetch = fetch): Promise<PushResult> {
  if (!pushEndpointAllowed(sub.endpoint)) return { ok: false, gone: true, status: 0, error: "endpoint not allowed" }
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub)
  const res = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, v),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(4 * 3600),     // an approval older than 4 hours is stale; let it drop
      Urgency: "high",
    },
    body,
  })
  const ok = res.status >= 200 && res.status < 300
  const error = ok ? undefined : (await res.text().catch(() => "")).slice(0, 200) || `HTTP ${res.status}`
  return { ok, gone: res.status === 404 || res.status === 410, status: res.status, error }
}
