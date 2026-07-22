// supabase/functions/_shared/rateLimit.ts
// Shared fixed-window rate limiter used by every Edge Function after verify().
// Single round-trip: delegates to public.rate_limit_hit() which performs the
// lock + check + increment atomically inside Postgres. Saves ~200–400 ms per
// EF call vs the old SELECT+UPSERT helper.

import { SupabaseClient } from "npm:@supabase/supabase-js@2.100.1"

export interface RateLimitResult {
  allowed: boolean
  retry_after_s: number
}

/**
 * Fixed-window rate limiter (Postgres-side).
 * Default: 60 requests per 60 seconds per (user_id, bucket) pair.
 *
 * The SQL function aligns windows to wall-clock boundaries, so a new
 * window naturally resets the counter. If the RPC itself fails (network
 * blip, function missing, etc.) we FAIL OPEN — a broken limiter must not
 * lock users out of the portal, since verify() already enforces auth +
 * role checks before we ever reach this call.
 */
export async function rateLimit(
  supabase: SupabaseClient,
  userId: string,
  bucket: string,
  limit = 60,
  windowSec = 60,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("rate_limit_hit", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_sec: windowSec,
  })

  if (error || !Array.isArray(data) || data.length === 0) {
    // Fail open — see rationale above. Keeping that behaviour, but it is now
    // AUDIBLE: a dead/rejected privileged key makes this RPC fail on every
    // call, which silently disables rate limiting across all 8 functions with
    // no external signal whatsoever. Red-team 2026-07-21 (C4) — the gap was
    // never the fail-open decision, it was that nothing said it had happened.
    if (error) {
      console.error(
        `rateLimit: rate_limit_hit RPC failed for bucket=${bucket} ` +
          `— FAILING OPEN (limit not enforced): ${error.message}`,
      )
    }
    return { allowed: true, retry_after_s: 0 }
  }

  const row = data[0] as { allowed: boolean; retry_after_s: number | null }
  return {
    allowed: row.allowed,
    retry_after_s: row.retry_after_s ?? 0,
  }
}
