// Make the VAPID key pair the gate-invoices Edge Function signs phone alerts with, and put it
// straight into that project's function secrets. The PRIVATE key is never printed, logged or
// written to disk — it goes from memory to `supabase secrets set` through a temporary env file
// that is deleted at once. Only the public key is printed (it is public by design).
//
//   node scripts/invoices/make-vapid-keys.mjs <project-ref>
//
// Run it ONCE per project (staging, and prod at go-live). Running it again replaces the keys,
// and every phone that turned alerts on must turn them on again (their subscription was made
// for the old public key). It refuses if the project already has keys unless --replace is given.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ref = process.argv[2]
const replace = process.argv.includes('--replace')
if (!/^[a-z]{20}$/.test(ref ?? '')) { console.error('usage: node scripts/invoices/make-vapid-keys.mjs <project-ref> [--replace]'); process.exit(2) }

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const cli = (args) => execFileSync(npx, ['--yes', 'supabase@2.109.1', ...args], { encoding: 'utf8', shell: process.platform === 'win32' })

const listed = cli(['secrets', 'list', '--project-ref', ref])
if (/GATE_VAPID_PRIVATE_KEY/.test(listed) && !replace) {
  console.error('This project already has GATE_VAPID_PRIVATE_KEY. Re-run with --replace to make new keys (every phone must then turn alerts on again).')
  process.exit(1)
}

const b64url = (b) => Buffer.from(b).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d

const dir = mkdtempSync(join(tmpdir(), 'vapid-'))
const file = join(dir, 'vapid.env')
try {
  writeFileSync(file, `GATE_VAPID_PUBLIC_KEY=${publicKey}\nGATE_VAPID_PRIVATE_KEY=${privateKey}\n`, { mode: 0o600 })
  cli(['secrets', 'set', '--project-ref', ref, '--env-file', file])
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`VAPID keys set on ${ref}. Public key (safe to share): ${publicKey}`)
