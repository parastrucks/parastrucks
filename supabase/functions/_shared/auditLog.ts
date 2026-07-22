// supabase/functions/_shared/auditLog.ts
// Phase 9e M3 — append a row to public.security_audit_log. Failures are
// swallowed (logged to stderr) so a logging glitch never breaks the privileged
// operation that triggered it. The table is service-role write-only via RLS.

import { type SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"

export type AuditEntry = {
  actorId: string
  action: string
  targetId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export async function audit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from("security_audit_log").insert({
      actor_id: e.actorId,
      action: e.action,
      target_id: e.targetId ?? null,
      before_jsonb: e.before ?? null,
      after_jsonb: e.after ?? null,
    })
    if (error) console.error("audit insert failed:", error.message)
  } catch (err) {
    console.error("audit insert threw:", err)
  }
}

// Phase 9e H4 — revoke all refresh tokens for a user via the GoTrue admin
// REST endpoint. supabase-js does not expose admin.signOut(userId); the
// underlying GoTrue endpoint is POST /admin/users/{user_id}/logout.
//
// NEW-API-KEY GOTCHA (red-team 2026-07-21, found by 3 independent lanes):
// this is a hand-rolled fetch, so nothing in supabase-js can help it. New-format
// keys (`sb_secret_…`) are NOT JWTs and must travel on `apikey` ONLY — sent as
// `Authorization: Bearer` the gateway tries to parse them as a JWT and rejects
// the call. Previously this sent BOTH unconditionally, so after the legacy-key
// cutover every revocation would have 401'd — silently, because the failure was
// downgraded to console.warn while the caller still returned {ok:true}.
// Net effect: a deactivated employee kept a working session until their refresh
// token expired (up to 12h). Legacy JWT keys still get the Bearer header so
// behaviour is unchanged until the flip.
//
// Failure remains non-fatal (the RLS is_active gate from Phase 9d is the real
// guard) but is now console.error, not console.warn, so it is greppable in the
// EF logs, and the boolean return lets callers surface it if they choose.
export async function adminLogoutUser(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<boolean> {
  const isLegacyJwt = !serviceKey.startsWith("sb_")
  try {
    const r = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${userId}/logout`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          // Only legacy JWT keys may ride Authorization: Bearer.
          ...(isLegacyJwt ? { Authorization: `Bearer ${serviceKey}` } : {}),
          "Content-Type": "application/json",
        },
      },
    )
    if (!r.ok) {
      const txt = await r.text().catch(() => "")
      console.error(
        `adminLogoutUser ${userId} FAILED ${r.status}: ${txt} ` +
          `(session NOT revoked; keyType=${isLegacyJwt ? "legacy" : "new"})`,
      )
      return false
    }
    return true
  } catch (err) {
    console.error(`adminLogoutUser ${userId} fetch threw:`, err)
    return false
  }
}
