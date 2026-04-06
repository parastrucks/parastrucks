import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

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
  // Explicit phase replaces the confusing (session === undefined) loading sentinel.
  // 'initializing'  — waiting for INITIAL_SESSION from Supabase
  // 'loading-data'  — session found, fetching profile + rules
  // 'ready'         — profile and rules loaded, app can render
  // 'unauthenticated' — no valid session
  const [phase,        setPhase]        = useState('initializing')
  const [session,      setSession]      = useState(null)
  const [profile,      setProfile]      = useState(null)
  const [accessRules,  setAccessRules]  = useState([]) // never null

  // dataLoadRef holds the promise from loadUserData so signIn() can await it
  // and ensure profile is populated before Login.jsx navigates.
  const dataLoadRef = useRef(null)
  const mountedRef  = useRef(true)

  // Fetches profile + access rules in one parallel call.
  // No timeout or retry wrappers — Supabase JS v2 has its own internal fetch
  // timeout (~8 s). Adding another layer on top created the 96-second worst-case
  // and the background-tab throttling false-positive that caused logouts.
  // On failure: degrade gracefully (empty rules) and move to ready phase.
  async function loadUserData(userId) {
    setPhase('loading-data')
    try {
      const [{ data: p }, { data: rules }] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId).maybeSingle(),
        supabase.from('access_rules').select('*'),
      ])
      if (!mountedRef.current) return
      setProfile(p ?? null)
      setAccessRules(rules ?? [])
    } catch (e) {
      console.error('loadUserData error:', e)
      if (!mountedRef.current) return
      setAccessRules([])
    }
    if (mountedRef.current) setPhase('ready')
  }

  // ── Main auth effect ───────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mountedRef.current) return

      // TOKEN_REFRESHED: only update the token — do NOT refetch profile/rules.
      // Profile data doesn't change when the token refreshes. Refetching creates
      // a new profile object reference which triggers page useEffect re-runs and
      // loading spinners (the root cause of most reported UX issues).
      if (_event === 'TOKEN_REFRESHED') {
        setSession(newSession)
        return
      }

      if (_event === 'SIGNED_OUT') {
        setSession(null)
        setProfile(null)
        setAccessRules([])
        setPhase('unauthenticated')
        return
      }

      // INITIAL_SESSION or SIGNED_IN
      if (newSession) {
        setSession(newSession)
        const promise = loadUserData(newSession.user.id)
        dataLoadRef.current = promise
      } else {
        // INITIAL_SESSION with no session = not logged in
        setSession(null)
        setPhase('unauthenticated')
      }
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visibility handler ─────────────────────────────────────────────────────
  // When the user returns to a backgrounded tab, validate the session.
  // Browsers throttle auto-refresh timers in inactive tabs, so the access token
  // may have expired without a TOKEN_REFRESHED event firing. Detect this here
  // and redirect to /login cleanly rather than letting the first API call fail.
  useEffect(() => {
    async function onVisible() {
      if (document.visibilityState !== 'visible' || phase !== 'ready') return
      const { data: { session: current } } = await supabase.auth.getSession()
      if (!current && mountedRef.current) {
        setSession(null)
        setProfile(null)
        setAccessRules([])
        setPhase('unauthenticated')
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [phase])

  // ── Public API ─────────────────────────────────────────────────────────────

  async function refreshAccessRules() {
    const { data } = await supabase.from('access_rules').select('*')
    if (mountedRef.current) setAccessRules(data ?? [])
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Lightweight validation — just check the user row exists and is active.
    // The full profile load is handled by the SIGNED_IN onAuthStateChange event.
    const { data: check } = await supabase
      .from('users')
      .select('is_active')
      .eq('id', data.user.id)
      .maybeSingle()

    if (!check) {
      supabase.auth.signOut().catch(() => {})
      throw new Error('User profile not found. Contact HR.')
    }
    if (!check.is_active) {
      supabase.auth.signOut().catch(() => {})
      throw new Error('Your account has been deactivated. Contact HR.')
    }

    // Yield one microtask to ensure the SIGNED_IN handler has fired and stored
    // the loadUserData promise in dataLoadRef, then await it so that profile is
    // populated before Login.jsx calls navigate('/').
    await Promise.resolve()
    if (dataLoadRef.current) await dataLoadRef.current
  }

  function signOut() {
    // Fire-and-forget — don't await. If Supabase is unreachable (the exact
    // scenario the escape hatch is designed for), awaiting would hang and make
    // the button appear broken. State is cleared synchronously so the UI
    // redirects to /login regardless of network state.
    supabase.auth.signOut().catch(() => {})
    setSession(null)
    setProfile(null)
    setAccessRules([])
    setPhase('unauthenticated')
  }

  function canAccess(route) {
    if (route === '/access-rules') return profile?.role === 'admin'
    if (!profile) return false
    return accessRules.some(rule => rule.route === route && ruleMatches(rule, profile))
  }

  const value = {
    session,
    profile,
    accessRules,
    refreshAccessRules,
    canAccess,
    loading: phase === 'initializing' || phase === 'loading-data',
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
