import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, REMEMBER_KEY } from '../lib/supabase'
import { callEdgePublic } from '../lib/api'

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
  // When the user returns to a backgrounded tab, validate the session and
  // refresh access_rules. Browsers throttle auto-refresh timers in inactive
  // tabs, so the access token may have expired without a TOKEN_REFRESHED event
  // firing. Detect this here and redirect to /login cleanly rather than
  // letting the first API call fail. Also re-pull access_rules so admin
  // changes made in another tab/session take effect on tab re-focus.
  useEffect(() => {
    let cancelled = false
    async function onVisible() {
      if (document.visibilityState !== 'visible' || phase !== 'ready') return
      const { data: { session: current } } = await supabase.auth.getSession()
      if (cancelled || !mountedRef.current) return
      if (!current) {
        setSession(null)
        setProfile(null)
        setAccessRules([])
        setPhase('unauthenticated')
        return
      }
      const { data: rules } = await supabase.from('access_rules').select('*')
      if (cancelled || !mountedRef.current) return
      setAccessRules(rules ?? [])
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase])

  // ── Public API ─────────────────────────────────────────────────────────────

  async function refreshAccessRules() {
    const { data } = await supabase.from('access_rules').select('*')
    if (mountedRef.current) setAccessRules(data ?? [])
  }

  // Phase 5 U8 — login goes through the verify-login Edge Function instead of
  // supabase.auth.signInWithPassword directly. The EF enforces:
  //   • email-keyed lockout (5 fails in 15 min → 15 min lockout)
  //   • optional Cloudflare Turnstile CAPTCHA
  // and hands back access_token + refresh_token which we install via
  // setSession(). That fires SIGNED_IN → the onAuthStateChange handler above
  // runs loadUserData as normal. The is-active / profile-exists checks live
  // here because the EF can't run them without coupling itself to the users
  // table's RLS surface.
  //
  // On error, we throw a SignInError — a plain Error subclass that carries
  // structured `code` + `retry_after_s` + `fails_remaining` so Login.jsx can
  // render the right message without string-matching.
  async function signIn(email, password, { rememberMe = false, turnstileToken } = {}) {
    // Set the remember-me flag BEFORE any supabase write so the storage
    // adapter picks the right bucket for the session that's about to land.
    if (rememberMe) localStorage.setItem(REMEMBER_KEY, '1')
    else            localStorage.removeItem(REMEMBER_KEY)

    let resp
    try {
      resp = await callEdgePublic('verify-login', {
        email,
        password,
        turnstile_token: turnstileToken,
      })
    } catch (e) {
      const err = new Error(e?.message || 'Network error. Check your connection and try again.')
      err.code = 'network'
      throw err
    }

    if (!resp.ok) {
      const body = resp.body || {}
      const err = new Error(signInErrorMessage(body.error))
      err.code = body.error || 'unknown'
      if (body.retry_after_s != null) err.retryAfter = body.retry_after_s
      if (body.fails_remaining != null) err.failsRemaining = body.fails_remaining
      throw err
    }

    const { access_token, refresh_token } = resp.body
    if (!access_token || !refresh_token) {
      const err = new Error('Unexpected login response. Contact HR.')
      err.code = 'bad_response'
      throw err
    }

    // Install the session client-side. This fires SIGNED_IN which triggers
    // loadUserData via the onAuthStateChange handler above.
    const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
    if (setErr) {
      const err = new Error(setErr.message || 'Failed to start session.')
      err.code = 'session_install'
      throw err
    }

    // is-active / profile-exists check. Runs after setSession so RLS sees the
    // caller's JWT. If either fails, we sign out and surface a specific error.
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: check } = await supabase
        .from('users')
        .select('is_active')
        .eq('id', user.id)
        .maybeSingle()

      if (!check) {
        supabase.auth.signOut().catch(() => {})
        const err = new Error('User profile not found. Contact HR.')
        err.code = 'no_profile'
        throw err
      }
      if (!check.is_active) {
        supabase.auth.signOut().catch(() => {})
        const err = new Error('Your account has been deactivated. Contact HR.')
        err.code = 'inactive'
        throw err
      }
    }

    // Yield one microtask so the SIGNED_IN handler above has already stored
    // the loadUserData promise in dataLoadRef, then await it so profile is
    // populated before Login.jsx calls navigate('/').
    await Promise.resolve()
    if (dataLoadRef.current) await dataLoadRef.current
  }

  // Map EF error codes to user-visible strings. Kept as a bare function
  // (not a hook / context value) so it's easy to tweak.
  function signInErrorMessage(code) {
    switch (code) {
      case 'locked':
        return 'Too many failed attempts. Try again later.'
      case 'invalid_credentials':
        return 'Incorrect email or password.'
      case 'captcha_required':
      case 'captcha_failed':
        return 'Please complete the CAPTCHA and try again.'
      case 'email and password required':
        return 'Please enter your email and password.'
      default:
        return 'Sign in failed. Please try again.'
    }
  }

  function signOut() {
    // Fire-and-forget — don't await. If Supabase is unreachable (the exact
    // scenario the escape hatch is designed for), awaiting would hang and make
    // the button appear broken. State is cleared synchronously so the UI
    // redirects to /login regardless of network state.
    supabase.auth.signOut().catch(() => {})
    // Clear the remember-me flag so the next login defaults back to session
    // storage. The user has to re-tick the checkbox to opt back in.
    localStorage.removeItem(REMEMBER_KEY)
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
