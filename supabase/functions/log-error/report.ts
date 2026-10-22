// supabase/functions/log-error/report.ts
// Reading a crash report out of the request body. Pure — no Deno, no network —
// so scripts/selftest-log-error.mjs runs it in Node.
//
// ⚠️ THE BUG THIS FIXES (found 2026-10-18): the browser's logger
// (src/lib/errorLog.js) goes through callEdge (src/lib/api.js), which sends
// EVERY Edge Function call as { action, payload }. This function read
// body.message at the top level, found nothing, and answered 400 "message
// required" — and errorLog swallows failures by design. So no crash has EVER
// reached error_log on prod: first the module never loaded (fixed in PR #124,
// 2026-09-19), then every report was refused here. Seen on staging: a real
// crash on 2026-10-17 produced three 400s and zero rows.
//
// Both shapes are accepted, so every client already in the field starts
// reporting as soon as this is deployed — no frontend release needed.

/** Truncate long strings to prevent payload-bomb DoS. */
export const trunc = (v: unknown, max: number): string | null => {
  if (v == null) return null
  const s = typeof v === "string" ? v : String(v)
  return s.length > max ? s.slice(0, max) : s
}

export type Report = {
  message: string
  stack: string | null
  url: string | null
  context: Record<string, unknown> | null
}

// A browser extension's own crash (2026-10-22: one user's Urban VPN Proxy sent
// 8,270 in three days). Same rule as the browser's src/lib/errorSource.js —
// scripts/selftest-log-error.mjs checks the two agree. Kept here too because a
// browser still running the old code keeps sending them until it reloads.
const EXT = /\b((?:chrome|moz|safari-web|safari|ms-browser)-extension:\/\/[^/\s)]+)/

/**
 * The extension origin when EVERY URL frame of the stack (plus the file the
 * error came from, if any) belongs to a browser extension; otherwise null.
 */
export function extensionOrigin(stack: unknown, file?: unknown): string | null {
  const urls: string[] = []
  for (const line of String(stack ?? "").split("\n")) {
    const m = line.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/i)
    if (m) urls.push(m[0])
  }
  if (file) urls.push(String(file))
  if (urls.length === 0) return null
  let origin: string | null = null
  for (const u of urls) {
    const m = u.match(EXT)
    if (!m) return null
    origin = origin ?? m[1]
  }
  return origin
}

/** The report inside a request body, or null when there is no message. */
export function readReport(body: unknown): Report | null {
  const outer = body && typeof body === "object" ? body as Record<string, unknown> : {}
  // callEdge's envelope { action, payload }; a flat body still works.
  const p = outer.payload && typeof outer.payload === "object"
    ? outer.payload as Record<string, unknown>
    : outer
  const message = trunc(p.message, 2000)
  if (!message) return null
  return {
    message,
    stack: trunc(p.stack, 8000),
    url: trunc(p.url, 500),
    context: p.context && typeof p.context === "object" && !Array.isArray(p.context)
      ? p.context as Record<string, unknown>
      : null,
  }
}
