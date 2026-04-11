// src/lib/api.js
// Thin wrapper around Supabase Edge Functions. Handles:
//   • attaching the current user's JWT
//   • unwrapping the { ok, error } envelope
//   • surfacing a single Error the caller can try/catch
//
// All admin-only writes go through here (admin-users, admin-access-rules,
// admin-catalog, admin-tiv). The client no longer holds the service role key.
//
// Why raw fetch() instead of supabase.functions.invoke()?
// invoke() in supabase-js v2.39.7 silently re-uses its internal
// FunctionsClient Authorization header (the anon key) even when a
// `headers.Authorization` option is supplied, when the client is built
// with sessionStorage + a custom storageKey. Raw fetch sidesteps the
// client entirely and guarantees the user JWT reaches the EF.
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

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

  let resp
  try {
    resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, payload }),
    })
  } catch (e) {
    throw new Error(e?.message || 'Network error')
  }

  let body = null
  try { body = await resp.json() } catch { /* non-JSON body */ }

  if (!resp.ok) {
    throw new Error(body?.error || `HTTP ${resp.status}`)
  }
  if (body && body.error) throw new Error(body.error)
  return body
}
