// Service worker — ONLY for the approvers' phone alerts (credit release step 2).
// It is registered only when an approver turns alerts on (src/invoices/lib/pushAlerts.js).
// It deliberately has NO fetch handler and caches nothing: the portal keeps loading straight
// from the network exactly as before, so a new release can never be hidden behind an old copy.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let msg = {}
  try { msg = event.data ? event.data.json() : {} } catch { msg = {} }
  const title = typeof msg.title === 'string' ? msg.title : 'Paras portal'
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof msg.body === 'string' ? msg.body : '',
    tag: typeof msg.tag === 'string' ? msg.tag : undefined,
    renotify: true,
    requireInteraction: true,
    icon: '/icon-192.png',
    data: { url: typeof msg.url === 'string' ? msg.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever open a page of the portal itself.
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/'
  event.waitUntil((async () => {
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
