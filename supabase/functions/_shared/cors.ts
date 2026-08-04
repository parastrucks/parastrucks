// supabase/functions/_shared/cors.ts
// Phase 9c — Locked-down CORS for every Edge Function.
//
// Reads ALLOWED_ORIGINS (comma-separated) at request time. Echoes
// Access-Control-Allow-Origin only when the request's Origin header is in the
// allow-list; otherwise the header is omitted (browsers will block the call).
// Always emits Vary: Origin so caches don't share responses across origins.
//
// If ALLOWED_ORIGINS is unset or empty, NO origin is allowed. That's the safe
// default — set the env var on every Functions deployment.

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type"
const ALLOWED_METHODS = "POST, OPTIONS"

function getAllowList(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? ""
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

// Per-function extras. ALLOWED_ORIGINS is shared by every EF on this project,
// so putting a new origin there widens all of them at once. A function that
// must answer one extra origin (erp-login, called from erp.parastrucks.in)
// passes it here instead — the other functions stay exactly as locked down as
// they were.
export function corsHeaders(
  req: Request,
  extraOrigins: string[] = [],
): Record<string, string> {
  const origin = req.headers.get("Origin") ?? ""
  const allowList = [...getAllowList(), ...extraOrigins]

  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
  }
  if (origin && allowList.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}

export function preflight(req: Request, extraOrigins: string[] = []): Response {
  return new Response(null, { headers: corsHeaders(req, extraOrigins) })
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
  extraOrigins: string[] = [],
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, extraOrigins), "Content-Type": "application/json" },
  })
}
