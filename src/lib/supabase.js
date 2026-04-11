import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

// Regular (anon) client used everywhere in the browser. RLS applies.
// sessionStorage: session lives only for the tab lifetime (close tab = logged out,
// new tab = fresh login). This prevents unexpected cross-tab persistence.
// Admin / service-role operations go through Supabase Edge Functions (src/lib/api.js)
// so the service role key never ships to the browser.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,
    storageKey: 'sb-session',
  }
})
