import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, REMEMBER_KEY } from '../lib/supabase'
import { callEdgePublic } from '../lib/api'

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6c.1 cutover — route gate uses the new 4-axis schema.
//
// Axes:   permission_level × entity_id × department_id × designation_id
// Values: permission_level ∈ {admin, gm, manager, executive}
//         designation_id   NULL on a rule = "any designation within this dept"
//
// Legacy columns on both tables (users.role, users.vertical, users.brand,
// users.location, users.department, access_rules.brand/location/department/role)
// are still present in the DB but ruleMatches no longer reads them. They're
// dead after the Phase 6c.1 seed migration populated the new axes on every row
// and will be dropped in Phase 6c.3 after the verification window.
//
// A handful of UI callers (Sidebar entity badge, BottomNav tabs by profile.role,
// Profile/Dashboard label lookups, Catalog admin-mode check, Quotation
// canEditPrice) still read the legacy `profile.role` / `profile.vertical` /
// `profile.entity` text columns. Those migrate to the new columns in the
// subsequent 6c.1 surface-by-surface PRs (Employees rebuild, Catalog, etc.).
// During the interim every such caller still works for the sole real user
// (admin) — non-admin users don't exist until HR-Manager onboarding lands.
// ─────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext(null)

// Checks whether a user profile satisfies an access rule row.
// Exact equality on the 3 NOT-NULL-from-seed axes; designation_id is
// nullable-on-rule (NULL = "any designation"). Admin bypass lives in
// canAccess, not here — ruleMatches never sees an admin profile in practice.
function ruleMatches(rule, profile) {
  if (!profile) return false
  return (
    rule.permission_level === profile.permission_level &&
    rule.entity_id        === profile.entity_id &&
    rule.department_id    === profile.department_id &&
    (rule.designation_id === null || rule.designation_id === profile.designation_id)
  )
}

// Shallow-equal check for user profile objects. Compares the fields that
// AuthContext consumers actually read. Prevents re-renders when loadUserData
// fetches the same profile row a second time.
//
// Covers BOTH column generations during the 6c.1 cutover window:
//   - new axes (permission_level, entity_id, department_id, designation_id)
//     drive ruleMatches and the forthcoming scoped RLS.
//   - legacy text columns (role, vertical, brand, location, department, entity)
//     are still read by Sidebar/BottomNav/Profile/Catalog/Quotation until their
//     own cutover PRs land. Checked here to keep dedup honest across the window.
function profileEqual(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id               === b.id               &&
    a.permission_level === b.permission_level &&
    a.entity_id        === b.entity_id        &&
    a.department_id    === b.department_id    &&
    a.designation_id   === b.designation_id   &&
    a.role             === b.role             &&
    a.vertical         === b.vertical         &&
    a.brand            === b.brand            &&
    a.location         === b.location         &&
    a.department       === b.department       &&
    a.entity           === b.entity           &&
    a.is_active        === b.is_active        &&
    a.full_name        === b.full_name        &&
    a.email            === b.email
  )
}

// Shallow-equal check for access rule arrays. Used by the visibility handler
// to avoid replacing `accessRules` state with a byte-identical array, which
// would otherwise rebuild the AuthContext value on every tab focus and
// cascade re-renders through every page that subscribes to useAuth().
// Compares only the fields that ruleMatches() actually reads — route + the
// 4 axes. Legacy columns on the rule row are ignored; they're dead after the
// 6c.1 seed and will disappear in 6c.3.
function accessRulesEqual(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  const byId = new Map(a.map(r => [r.id, r]))
  for (const rb of b) {
    const ra = byId.get(rb.id)
    if (!ra) return false
    if (
      ra.route            !== rb.route            ||
      ra.permission_level !== rb.permission_level ||
      ra.entity_id        !== rb.entity_id        ||
      ra.department_id    !== rb.department_id    ||
      ra.designation_id   !== rb.designation_id
    ) return false
  }
  return true
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
  const dataLoadRef  = useRef(null)
  const mountedRef   = useRef(true)
  // In-flight dedup: track which userId loadUserData is currently fetching for.
  // If onAuthStateChange fires INITIAL_SESSION then SIGNED_IN for the same user,
  // the second call returns the existing promise instead of spawning a duplicate.
  const loadingForRef = useRef(null)

  // Fetches profile + access rules in one parallel call.
  // No timeout or retry wrappers — Supabase JS v2 has its own internal fetch
  // timeout (~8 s). Adding another layer on top created the 96-second worst-case
  // and the background-tab throttling false-positive that caused logouts.
  // On failure: degrade gracefully (empty rules) and move to ready phase.
  async function loadUserData(userId) {
    // In-flight guard — if we're already fetching for this user, return the
    // existing promise so callers (signIn → dataLoadRef.current) still resolve.
    if (loadingForRef.current === userId && dataLoadRef.current) {
      return dataLoadRef.current
    }
    loadingForRef.current = userId
    setPhase('loading-data')
    try {
      const [{ data: p }, { data: rules }] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId).maybeSingle(),
        supabase.from('access_rules').select('*'),
      ])
      if (!mountedRef.current) return
      // Shallow-diff: only replace state when the data actually changed.
      // Avoids new object references that would cascade re-renders through
      // every useAuth() consumer.
      setProfile(prev => profileEqual(prev, p ?? null) ? prev : (p ?? null))
      setAccessRules(prev => accessRulesEqual(prev, rules ?? []) ? prev : (rules ?? []))
    } catch (e) {
      console.error('loadUserData error:', e)
      if (!mountedRef.current) return
      setAccessRules([])
    }
    if (mountedRef.current) setPhase('ready')
    loadingForRef.current = null
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
      // Only replace state if the rules *actually* changed. Otherwise every
      // tab focus would create a new array reference, rebuild the context
      // value, and cascade re-renders through every useAuth() consumer —
      // which in turn re-runs their data-loading effects and re-fetches.
      // Use a functional setter so we compare against the freshest state
      // without needing `accessRules` in this effect's deps (which would
      // re-subscribe the visibility listener on every rule change).
      setAccessRules(prev => accessRulesEqual(prev, rules ?? []) ? prev : (rules ?? []))
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

  // Route gate:
  //   - No profile yet → deny (loading screen will be showing anyway)
  //   - Admin → bypass every rule (including /access-rules itself — that's the
  //     intentional escape hatch so a rule-editor bug can never lock the admin
  //     out of the rule editor)
  //   - Non-admin /access-rules → hard-deny regardless of seeded rules
  //   - Otherwise → at least one access_rules row must match on all 4 axes
  function canAccess(route) {
    if (!profile) return false
    if (profile.permission_level === 'admin') return true
    if (route === '/access-rules') return false
    return accessRules.some(rule => rule.route === route && ruleMatches(rule, profile))
  }

  // Role-identity flags. `isAdmin` follows the new column. The HR/BO/Sales
  // flags still read the legacy text `profile.role` because their only
  // consumers (Sidebar badge, BottomNav ROLE_TABS, Catalog admin-mode check,
  // Quotation canEditPrice, UploadPanel gate) have not yet been cut over to
  // the new department-id model. Those PRs migrate these flags off .role as
  // each surface is rebuilt; until then the only real user (admin) still
  // satisfies isAdmin via the new column and nothing else is broken.
  const value = {
    session,
    profile,
    accessRules,
    refreshAccessRules,
    canAccess,
    loading: phase === 'initializing' || phase === 'loading-data',
    signIn,
    signOut,
    isAdmin:      profile?.permission_level === 'admin',
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
