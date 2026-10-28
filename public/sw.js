// Service worker — ONLY for the approvers' phone alerts (credit release step 2).
// It is registered only when an approver turns alerts on (src/invoices/lib/pushAlerts.js).
// It deliberately has NO fetch handler and caches nothing: the portal keeps loading straight
// from the network exactly as before, so a new release can never be hidden behind an old copy.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Two kinds of message, both carrying the release's tag so the newer one replaces the older:
//  - "asked" (default): rings and vibrates, and stays until tapped — like a chat message.
//  - "closed": someone has already answered; it quietly replaces the asked alert (no sound,
//    no buzz, dismissable) so nobody taps a request that is already decided.
self.addEventListener('push', (event) => {
  let msg = {}
  try { msg = event.data ? event.data.json() : {} } catch { msg = {} }
  const closed = msg.kind === 'closed'
  const title = typeof msg.title === 'string' ? msg.title : 'Paras portal'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof msg.body === 'string' ? msg.body : '',
    tag: typeof msg.tag === 'string' ? msg.tag : undefined,
    renotify: !closed,
    silent: closed,
    requireInteraction: !closed,
    vibrate: closed ? [] : [200, 100, 200, 100, 200],
    icon: '/icon-192.png',
    badge: '/badge-96.png',       // Android's status-bar icon: white on transparent
    data: { url: typeof msg.url === 'string' ? msg.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever open a page of the portal itself.
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/'
  event.waitUntil((async () => {
    // Android: always OPEN — Chrome hands a link inside the app's scope to the installed app.
    // Reusing an open window would pick a Chrome tab of the portal over the app (owner, 10-28:
    // the tap landed in Chrome, not the app), and a worker cannot tell the two apart.
    if (/Android/i.test(self.navigator.userAgent)) { await self.clients.openWindow(url); return }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus()
        if ('navigate' in w) { try { await w.navigate(url) } catch { /* not controlled yet: fall through */ } }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
