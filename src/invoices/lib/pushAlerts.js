// Phone alerts for approvers (credit release step 2, owner 2026-10-26: "phone notification").
// Turning alerts on = register public/sw.js, ask the phone's permission, subscribe with the
// server's public key, and hand the subscription to the gate-invoices Edge Function, which
// keeps it where no browser can read it. The server signs and encrypts every alert (push.ts).
import { callEdge } from '../../lib/api'

const SW_URL = '/sw.js'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// iPhone / iPad: web push works only in a portal opened from the Home Screen (iOS 16.4+).
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

function keyBytes(b64url) {
  const b = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i])

/** 'unsupported' | 'needs-home-screen' | 'blocked' | 'on' | 'off' */
export async function alertStatus() {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export async function turnAlertsOn() {
  if (!pushSupported()) throw new Error(isIos() ? 'On iPhone, add the portal to the Home Screen first (Share → Add to Home Screen), open it from there, then turn alerts on.' : 'This browser cannot show phone alerts.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Alerts were not allowed. Allow notifications for this site in the phone settings, then try again.')
  const { publicKey } = await callEdge('gate-invoices', 'pushKey', {})
  const serverKey = keyBytes(publicKey)
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  // Made for an older server key (keys replaced): it would never be delivered — start again.
  if (sub && !sameKey(sub.options?.applicationServerKey, serverKey)) { await sub.unsubscribe(); sub = null }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })
  const j = sub.toJSON()
  await callEdge('gate-invoices', 'pushSubscribe', {
    endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: navigator.userAgent.slice(0, 300),
  })
}

export async function turnAlertsOff() {
  const reg = await navigator.serviceWorker?.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await callEdge('gate-invoices', 'pushUnsubscribe', { endpoint })
}
