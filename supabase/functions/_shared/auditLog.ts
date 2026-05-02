// supabase/functions/_shared/auditLog.ts
// Phase 9e M3 — append a row to public.security_audit_log. Failures are
// swallowed (logged to stderr) so a logging glitch never breaks the privileged
// operation that triggered it. The table is service-role write-only via RLS.

import { type SupabaseClient } from "npm:@supabase/supabase-js@2"

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
// REST endpoint. supabase-js v2.39.7 does not expose admin.signOut(userId);
// the underlying GoTrue endpoint is POST /admin/users/{user_id}/logout.
// Failure is non-fatal: the RLS is_active gate (Phase 9d) is the real guard.
export async function adminLogoutUser(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<void> {
  try {
    const r = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${userId}/logout`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      },
    )
    if (!r.ok) {
      const txt = await r.text().catch(() => "")
      console.warn(`adminLogoutUser ${userId} returned ${r.status}: ${txt}`)
    }
  } catch (err) {
    console.warn(`adminLogoutUser ${userId} fetch failed:`, err)
  }
}
