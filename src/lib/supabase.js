import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

// Phase 5 U8 — Remember-me storage adapter.
//
// When the user checks "Remember me" on the login page we persist the
// Supabase session in localStorage (survives tab close + browser restart).
// When unchecked, the session lives in sessionStorage (closes with the tab).
// The flag itself is stored in localStorage under REMEMBER_KEY so it persists
// *between* logins — ticking the box once keeps you remembered until you
// explicitly uncheck it on a subsequent login or sign out.
//
// The adapter is deliberately written so every read falls back across both
// stores. That way switching the flag mid-session doesn't orphan the old
// tokens: the next setItem cleans up the stale bucket.
//
// Admin / service-role operations still go through Supabase Edge Functions
// (src/lib/api.js); the service role key never ships to the browser.
export const REMEMBER_KEY = 'sb-remember-me'

const rememberMeStorage = {
  getItem: (key) => {
    // localStorage first so a restored "remember me" session wins over any
    // stale session-scope token from a previous tab.
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  },
  setItem: (key, value) => {
    const remember = localStorage.getItem(REMEMBER_KEY) === '1'
    if (remember) {
      localStorage.setItem(key, value)
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, value)
      localStorage.removeItem(key)
    }
  },
  removeItem: (key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

// Credit release step 2 (owner, 2026-10-28): a phone with approval alerts on stays signed
// in, like a messaging app — tapping an alert opens the request, not the sign-in page.
// ALERTS_KEY records that the ALERTS (not the person's own "Remember me" tick) kept it, so
// turning alerts off undoes only what the alerts did. Signing in or out clears it.
export const ALERTS_KEY = 'sb-remember-for-alerts'
const SESSION_KEY = 'sb-session'

export function keepSignedInForAlerts(on) {
  if (on) {
    if (localStorage.getItem(REMEMBER_KEY) === '1') return
    localStorage.setItem(REMEMBER_KEY, '1')
    localStorage.setItem(ALERTS_KEY, '1')
  } else {
    if (localStorage.getItem(ALERTS_KEY) !== '1') return
    localStorage.removeItem(REMEMBER_KEY)
    localStorage.removeItem(ALERTS_KEY)
  }
  // Move the live session to the store the flag now names.
  const value = rememberMeStorage.getItem(SESSION_KEY)
  if (value) rememberMeStorage.setItem(SESSION_KEY, value)
}

/** After a sign-in: if this device already gets approval alerts, keep it signed in. */
export async function keepSignedInIfAlertsOn() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/')
    if (await reg?.pushManager?.getSubscription()) keepSignedInForAlerts(true)
  } catch { /* no service worker here — nothing to keep */ }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: rememberMeStorage,
    storageKey: SESSION_KEY,
  }
})
