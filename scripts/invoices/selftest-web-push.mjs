// Self-test for supabase/functions/gate-invoices/push.ts (Web Push: RFC 8291 + RFC 8292).
// push.ts is TypeScript, so bundle it first (from the repo root):
//   npx --yes esbuild supabase/functions/gate-invoices/push.ts --format=esm --outfile=<tmp>/push.mjs
//   node scripts/invoices/selftest-web-push.mjs <tmp>/push.mjs
//
// What it proves:
//   1. the encryption reproduces RFC 8291 Appendix A BYTE FOR BYTE (same keys, same salt);
//   2. a normal (random-key) message decrypts back to the text, the way a phone does it;
//   3. the VAPID header is a valid ES256 JWT, signed by our key, for the push service's origin;
//   4. only the browsers' push services are ever contacted (the endpoint comes from a browser);
//   5. sendPush sends the right headers, treats 404/410 as "subscription gone", and does not
//      touch the network for an endpoint outside the list.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const P = await import(pathToFileURL(resolve(process.argv[2] ?? '')).href)
const { b64urlToBytes: d, bytesToB64url: e } = P
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name) } }
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// ── 1. RFC 8291 Appendix A (values copied from the RFC, whitespace removed) ──
const A = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  as_public: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  as_private: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  ua_public: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  ua_private: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
}
const body = await P.encryptPayload(d(A.plaintext), { p256dh: A.ua_public, auth: A.auth },
  { senderPublic: d(A.as_public), senderPrivate: d(A.as_private), salt: d(A.salt) })
const expected = new Uint8Array([...d(A.header), ...d(A.ciphertext)])
ok(d(A.header).length === 86, 'Appendix A: the header is 86 octets (as the RFC says)')
ok(eq(body.subarray(0, 86), d(A.header)), 'Appendix A: header byte for byte')
ok(eq(body, expected), 'Appendix A: the whole message byte for byte')

// ── 2. the receiver side — decrypt like a phone (an independent re-derivation) ──
async function decrypt(msg, uaPublicB64, uaPrivateB64, authB64) {
  const salt = msg.subarray(0, 16), idlen = msg[20], asPublic = msg.subarray(21, 21 + idlen), ct = msg.subarray(21 + idlen)
  const rs = new DataView(msg.buffer, msg.byteOffset).getUint32(16)
  const uaPub = d(uaPublicB64)
  const priv = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: e(uaPub.subarray(1, 33)), y: e(uaPub.subarray(33)), d: uaPrivateB64 },
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, priv, 256))
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info },
    await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8))
  const t = new TextEncoder()
  const ikm = await hk(d(authB64), secret, new Uint8Array([...t.encode('WebPush: info\0'), ...uaPub, ...asPublic]), 32)
  const cek = await hk(salt, ikm, t.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hk(salt, ikm, t.encode('Content-Encoding: nonce\0'), 12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce },
    await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct))
  return { rs, plain }
}
const back = await decrypt(expected, A.ua_public, A.ua_private, A.auth)
ok(back.rs === 4096 && back.plain.at(-1) === 2 && eq(back.plain.subarray(0, -1), d(A.plaintext)), 'the receiver decrypts Appendix A to its plaintext')

const phone = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const phonePub = e(new Uint8Array(await crypto.subtle.exportKey('raw', phone.publicKey)))
const phonePriv = (await crypto.subtle.exportKey('jwk', phone.privateKey)).d
const phoneAuth = e(crypto.getRandomValues(new Uint8Array(16)))
const text = JSON.stringify({ title: 'Credit release asked', body: 'GJ01AB1234 · ₹12,345 — tap to approve or hold', url: '/invoices?release=x' })
const m1 = await P.encryptPayload(new TextEncoder().encode(text), { p256dh: phonePub, auth: phoneAuth })
const m2 = await P.encryptPayload(new TextEncoder().encode(text), { p256dh: phonePub, auth: phoneAuth })
const got = await decrypt(m1, phonePub, phonePriv, phoneAuth)
ok(new TextDecoder().decode(got.plain.subarray(0, -1)) === text, 'a random-key message decrypts on the phone to the same text (₹ and · intact)')
ok(!eq(m1.subarray(0, 16), m2.subarray(0, 16)) && !eq(m1.subarray(21, 86), m2.subarray(21, 86)), 'every message gets a fresh salt and a fresh one-time key')
let wrongAuth = false
try { await decrypt(m1, phonePub, phonePriv, e(crypto.getRandomValues(new Uint8Array(16)))) } catch { wrongAuth = true }
ok(wrongAuth, 'with another auth secret the message does not decrypt')
for (const [sub, why] of [[{ p256dh: phonePub.slice(0, 40), auth: phoneAuth }, 'a short key'], [{ p256dh: phonePub, auth: 'AAAA' }, 'a short auth secret']]) {
  let threw = false
  try { await P.encryptPayload(new Uint8Array([1]), sub) } catch { threw = true }
  ok(threw, `refuses ${why}`)
}

// ── 3. VAPID ──
const ours = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const vapid = {
  publicKey: e(new Uint8Array(await crypto.subtle.exportKey('raw', ours.publicKey))),
  privateKey: (await crypto.subtle.exportKey('jwk', ours.privateKey)).d,
  subject: 'mailto:accounts.guj@parastrucks.in',
}
const now = 1793000000
const authz = await P.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', vapid, now)
const mm = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authz)
ok(!!mm, 'Authorization is "vapid t=<jwt>, k=<key>"')
if (mm) {
  const head = JSON.parse(new TextDecoder().decode(d(mm[1]))), claims = JSON.parse(new TextDecoder().decode(d(mm[2])))
  ok(head.alg === 'ES256' && head.typ === 'JWT', 'JWT header ES256')
  ok(claims.aud === 'https://fcm.googleapis.com', 'audience = the push service origin, no path')
  ok(claims.exp === now + 12 * 3600 && claims.exp - now <= 24 * 3600, 'expires in 12 h (RFC 8292 caps it at 24 h)')
  ok(claims.sub === vapid.subject, 'subject = our contact')
  ok(mm[4] === vapid.publicKey, 'k = our public key')
  ok(d(mm[3]).length === 64 && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ours.publicKey, d(mm[3]),
    new TextEncoder().encode(`${mm[1]}.${mm[2]}`)), 'the signature verifies with our public key')
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  ok(!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, other.publicKey, d(mm[3]),
    new TextEncoder().encode(`${mm[1]}.${mm[2]}`)), 'and does not verify with another key')
}

// ── 4. only the browsers' push services ──
const allowed = ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
  'https://web.push.apple.com/QK2x', 'https://wns2-pn1p.notify.windows.com/w/?token=x']
const refused = ['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com',
  'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'https://localhost/x',
  'https://notify.windows.com.evil.com/x', 'https://evilpush.services.mozilla.com.attacker.io/x', 'https://web.push.apple.com.x.io/', '',
  null, 42, 'not a url', `https://fcm.googleapis.com/${'a'.repeat(1000)}`]
for (const u of allowed) ok(P.pushEndpointAllowed(u), `allowed: ${u.slice(0, 50)}`)
for (const u of refused) ok(!P.pushEndpointAllowed(u), `refused: ${String(u).slice(0, 50)}`)

// ── 5. sendPush, with a fake network ──
const calls = []
const fakeFetch = (status) => async (url, init) => { calls.push({ url, init }); return new Response(status === 201 ? '' : 'gone', { status }) }
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: phonePub, auth: phoneAuth }
const r1 = await P.sendPush(sub, { title: 't', body: 'b' }, vapid, fakeFetch(201))
const h = calls[0]?.init?.headers ?? {}
ok(r1.ok && !r1.gone && calls.length === 1, '201 = sent')
ok(h['Content-Encoding'] === 'aes128gcm' && /^vapid t=/.test(h.Authorization) && Number(h.TTL) > 0 && h.Urgency === 'high', 'headers: aes128gcm, VAPID, TTL, Urgency high')
ok(calls[0]?.init?.method === 'POST' && calls[0].init.body instanceof Uint8Array && calls[0].init.body.length > 86, 'POSTs the encrypted body')
const sent = await decrypt(calls[0].init.body, phonePub, phonePriv, phoneAuth)
ok(JSON.parse(new TextDecoder().decode(sent.plain.subarray(0, -1))).title === 't', 'what was posted decrypts to the message')
for (const s of [404, 410]) { const r = await P.sendPush(sub, { t: 1 }, vapid, fakeFetch(s)); ok(!r.ok && r.gone, `${s} = subscription gone`) }
const r5 = await P.sendPush(sub, { t: 1 }, vapid, fakeFetch(500))
ok(!r5.ok && !r5.gone, '500 = failed, keep the subscription')
const before = calls.length
const r6 = await P.sendPush({ ...sub, endpoint: 'https://evil.example/x' }, { t: 1 }, vapid, fakeFetch(201))
ok(!r6.ok && calls.length === before, 'an endpoint outside the list is never contacted')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
