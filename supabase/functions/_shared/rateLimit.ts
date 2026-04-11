// supabase/functions/_shared/rateLimit.ts
// Shared fixed-window rate limiter used by every Edge Function after verify().
// Reads/writes public.rate_limits via the service-role client passed in.

import { SupabaseClient } from "npm:@supabase/supabase-js@2"

export interface RateLimitResult {
  allowed: boolean
  retry_after_s: number
  current: number
}

/**
 * Simple fixed-window rate limiter.
 * Default: 60 requests per 60 seconds per (user_id, bucket) pair.
 *
 * Windows are aligned to wall-clock boundaries (floor(now / windowMs) * windowMs)
 * so every caller in the same window sees the same start timestamp, and a new
 * window naturally resets the counter.
 */
export async function rateLimit(
  supabase: SupabaseClient,
  userId: string,
  bucket: string,
  limit = 60,
  windowSec = 60,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowMs = windowSec * 1000
  const windowStart = new Date(
    Math.floor(now / windowMs) * windowMs,
  ).toISOString()

  // Read the current row for this (user, bucket)
  const { data: existing } = await supabase
    .from("rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .eq("bucket", bucket)
    .maybeSingle()

  if (!existing || existing.window_start !== windowStart) {
    // New window — reset the counter to 1
    await supabase
      .from("rate_limits")
      .upsert({ user_id: userId, bucket, window_start: windowStart, count: 1 })
    return { allowed: true, retry_after_s: 0, current: 1 }
  }

  if (existing.count >= limit) {
    const retry = windowSec - Math.floor((now % windowMs) / 1000)
    return { allowed: false, retry_after_s: retry, current: existing.count }
  }

  // Increment within the existing window
  await supabase
    .from("rate_limits")
    .update({ count: existing.count + 1 })
    .eq("user_id", userId)
    .eq("bucket", bucket)

  return { allowed: true, retry_after_s: 0, current: existing.count + 1 }
}
