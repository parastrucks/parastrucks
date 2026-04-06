import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

// Race a promise against a timer. 30 s is generous enough that browser
// background-tab throttling (≥60 s intervals) won't trigger it on a healthy
// but paused request, while still breaking truly hung connections.
function withTimeout(fn, ms = 30000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), ms)
    ),
  ])
}

// Retry a promise up to `attempts` times, waiting `delayMs` between tries.
async function withRetry(fn, attempts = 3, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs))
      } else {
        throw e
      }
    }
  }
}

// Checks whether a user profile satisfies an access rule row.
// permission_level → profile.role (admin/hr/sales/back_office)
// role             → profile.vertical (bus/tipper/icv/long_haul/ce)
function ruleMatches(rule, profile) {
  return (
    (rule.permission_level === null || rule.permission_level === profile?.role) &&
    (rule.brand            === null || rule.brand            === profile?.brand) &&
    (rule.location         === null || rule.location         === profile?.location) &&
    (rule.department       === null || rule.department       === profile?.department) &&
    (rule.role             === null || rule.role             === profile?.vertical)
  )
}

export function AuthProvider({ children }) {
  const [session, setSession]         = useState(undefined) // undefined = still loading
  const [profile, setProfile]         = useState(null)
  const [accessRules, setAccessRules] = useState(null)      // null = still loading

  async function fetchProfile(userId) {
    // maybeSingle() returns null (not a 406 error) when 0 rows match.
    // This avoids a timing issue where the JWT isn't yet attached to the
    // first PostgREST request immediately after signInWithPassword.
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) { console.error('Profile fetch error:', error); return null }
    return data
  }

  async function fetchAccessRules() {
    const { data, error } = await supabase.from('access_rules').select('*')
    if (error) { console.error('Access rules fetch error:', error); return [] }
    return data || []
  }

  async function refreshAccessRules() {
    const rules = await fetchAccessRules()
    setAccessRules(rules)
  }

  useEffect(() => {
    let mounted = true

    // Supabase v2 always fires INITIAL_SESSION on mount, so we use
    // onAuthStateChange as the single source of truth for all auth state
    // (including the first load). This avoids running fetchProfile +
    // fetchAccessRules twice on startup, which was causing the timeout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      setSession(session)
      if (session) {
        try {
          // Retry up to 3 times on transient network errors.
          // Never clear the session here — only Supabase decides when a session expires.
          const [p, rules] = await withRetry(() =>
            withTimeout(() => Promise.all([fetchProfile(session.user.id), fetchAccessRules()]))
          )
          if (!mounted) return
          setProfile(p)
          setAccessRules(rules)
        } catch (e) {
          // All retries exhausted — let the user stay logged in but with
          // empty access rules so they at least reach the dashboard.
          console.error('Profile/rules fetch failed after retries:', e)
          if (mounted) setAccessRules([])
        }
      } else {
        setProfile(null)
        setAccessRules([])
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // Retry profile fetch up to 3 times — the JWT may not be attached to the
    // first PostgREST request immediately after signInWithPassword returns.
    const p = await withRetry(() => fetchProfile(data.user.id).then(r => {
      if (!r) throw new Error('no_profile')
      return r
    })).catch(() => null)
    if (!p) throw new Error('User profile not found. Contact HR.')
    if (!p.is_active) throw new Error('Your account has been deactivated. Contact HR.')
    setProfile(p)
    return p
  }

  async function signOut() {
    // Fire the network call but don't await it — if Supabase is unreachable
    // (the very reason the user is clicking this button), the await would hang
    // and make the button appear broken. Local state is cleared immediately so
    // the UI redirects to /login regardless of network state.
    supabase.auth.signOut().catch(() => {})
    setSession(null)
    setProfile(null)
    setAccessRules([])
  }

  // Returns true if the current user can access the given route.
  // /access-rules is always hardcoded admin-only as a safety net.
  function canAccess(route) {
    if (route === '/access-rules') return profile?.role === 'admin'
    if (!accessRules || !profile) return false
    return accessRules.some(rule => rule.route === route && ruleMatches(rule, profile))
  }

  const value = {
    session,
    profile,
    accessRules,
    refreshAccessRules,
    canAccess,
    loading: session === undefined || (session !== null && accessRules === null),
    signIn,
    signOut,
    isAdmin:      profile?.role === 'admin',
    isHR:         profile?.role === 'hr',
    isBackOffice: profile?.role === 'back_office',
    isSales:      profile?.role === 'sales',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
