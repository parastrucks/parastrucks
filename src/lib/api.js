// src/lib/api.js
// Thin wrapper around Supabase Edge Functions. Handles:
//   • attaching the current user's JWT
//   • unwrapping the { ok, error } envelope
//   • surfacing a single Error the caller can try/catch
//
// All admin-only writes go through here (admin-users, admin-access-rules,
// admin-catalog, admin-tiv). The client no longer holds the service role key.
import { supabase } from './supabase'

/**
 * Invoke a Supabase Edge Function.
 * @param {string} fn      Function name (e.g. 'admin-users')
 * @param {string} action  Action dispatcher key (e.g. 'create', 'setActive')
 * @param {object} payload Arbitrary JSON payload for the action
 * @returns {Promise<any>} Parsed response data on success
 * @throws  {Error}        On network failure, 4xx/5xx, or { error } body
 */
export async function callEdge(fn, action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  // Explicitly pass the session access token. supabase-js v2 auto-attaches
  // on an auth-state-change listener, but with our sessionStorage + custom
  // storageKey setup the FunctionsClient sometimes falls back to the anon
  // key, which the EF then rejects as "Invalid token".
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { action, payload },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  })

  // Network / non-2xx error
  if (error) {
    // FunctionsHttpError exposes the JSON body via .context.response.json()
    let detail = error.message
    try {
      const resp = error.context?.response
      if (resp) {
        const body = await resp.json()
        if (body?.error) detail = body.error
      }
    } catch { /* ignore parse failures */ }
    throw new Error(detail)
  }

  // Application-level error envelope
  if (data && data.error) throw new Error(data.error)
  return data
}
