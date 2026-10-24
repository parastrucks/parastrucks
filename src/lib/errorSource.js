// src/lib/errorSource.js
// Is a crash ours, or a browser extension's?
//
// ⚠️ WHY (2026-10-22): one user's "Urban VPN Proxy" extension
// (chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon, publicly reported as
// harvesting page content) threw ~2 errors a second on every portal page —
// 8,270 rows in error_log in three days, burying every real crash. Every
// report also called getSession(), and the only 3 other rows were that same
// user's "lock:sb-session … stolen" errors (inferred, not proven, to be caused
// by that traffic).
//
// Dropping these outright would have hidden the extension, which was the real
// finding. So an extension-only error is reported ONCE per extension, per
// browser, per day, labelled as such. Mirror on the server:
// supabase/functions/log-error/report.ts (extensionOrigin).

const EXT = /\b((?:chrome|moz|safari-web|safari|ms-browser)-extension:\/\/[^/\s)]+)/

/**
 * The extension origin when EVERY URL frame of the stack (plus the file the
 * error came from, if any) belongs to a browser extension; otherwise null.
 * Any frame from our own code means the portal is involved → null.
 */
export function extensionOrigin(stack, file) {
  const urls = []
  for (const line of String(stack || '').split('\n')) {
    const m = line.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/i)
    if (m) urls.push(m[0])
  }
  if (file) urls.push(String(file))
  if (urls.length === 0) return null
  let origin = null
  for (const u of urls) {
    const m = u.match(EXT)
    if (!m) return null
    origin = origin ?? m[1]
  }
  return origin
}

const seen = new Set()

/** True the first time today (local day) this browser reports this extension. */
export function firstTodayFor(origin) {
  const day = new Date().toLocaleDateString('en-CA')
  const key = `errlog-ext:${origin}`
  try {
    if (localStorage.getItem(key) === day) return false
    localStorage.setItem(key, day)
    return true
  } catch {
    // No storage (private window, blocked): once per page load instead.
    if (seen.has(origin)) return false
    seen.add(origin)
    return true
  }
}
