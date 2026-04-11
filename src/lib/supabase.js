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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: rememberMeStorage,
    storageKey: 'sb-session',
  }
})
