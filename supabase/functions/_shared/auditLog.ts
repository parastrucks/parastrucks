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

// Phase 9h (2026-07-26) — force-logout a user by revoking their sessions at the
// DB level, via the SECURITY DEFINER RPC public.admin_revoke_user_sessions(uuid)
// (migration 20260726_phase9h_admin_revoke_user_sessions.sql). The RPC deletes the
// user's rows from auth.sessions, which cascades to auth.refresh_tokens — so the
// user can no longer refresh into a new access token.
//
// SUPERSEDES the old GoTrue REST call POST /auth/v1/admin/users/{id}/logout, which
// returns 404 in this project's GoTrue version — meaning Phase 9e H4 force-logout
// had silently never worked (the fetch 404'd, the failure was swallowed, and the
// caller still returned ok). The RLS is_active gate (Phase 9d) was the only thing
// actually locking a deactivated user out.
//
// Called through the service-role `admin` client (only service_role has EXECUTE on
// the RPC). Still best-effort and non-fatal: an already-issued access token (ES256
// JWT) stays valid until it expires (~1h) regardless — the RLS is_active gate
// remains the real guard. Failures are console.error (greppable in EF logs) and the
// boolean return lets callers surface it if they choose.
export async function adminLogoutUser(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { error } = await admin.rpc("admin_revoke_user_sessions", {
      p_user_id: userId,
    })
    if (error) {
      console.error(
        `adminLogoutUser ${userId} FAILED: ${error.message} (sessions NOT revoked)`,
      )
      return false
    }
    return true
  } catch (err) {
    console.error(`adminLogoutUser ${userId} rpc threw:`, err)
    return false
  }
}
