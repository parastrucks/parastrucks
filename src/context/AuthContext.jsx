import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]         = useState(undefined) // undefined = loading
  const [profile, setProfile]         = useState(null)
  const [accessRules, setAccessRules] = useState(null)      // null = loading

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) { console.error('Profile fetch error:', error); return null }
    return data
  }

  async function fetchAccessRules() {
    const { data, error } = await supabase.from('access_rules').select('route, role')
    if (error) { console.error('Access rules fetch error:', error); return {} }
    const rules = {}
    for (const row of data || []) {
      if (!rules[row.route]) rules[row.route] = []
      rules[row.route].push(row.role)
    }
    return rules
  }

  // Call this from AccessRules page after saving changes so nav/routes update
  async function refreshAccessRules() {
    const rules = await fetchAccessRules()
    setAccessRules(rules)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session) {
        const [p, rules] = await Promise.all([
          fetchProfile(session.user.id),
          fetchAccessRules(),
        ])
        setProfile(p)
        setAccessRules(rules)
      } else {
        setAccessRules({})
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session) {
          const [p, rules] = await Promise.all([
            fetchProfile(session.user.id),
            fetchAccessRules(),
          ])
          setProfile(p)
          setAccessRules(rules)
        } else {
          setProfile(null)
          setAccessRules({})
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const p = await fetchProfile(data.user.id)
    if (!p) throw new Error('User profile not found. Contact HR.')
    if (!p.is_active) throw new Error('Your account has been deactivated. Contact HR.')

    setProfile(p)
    return p
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setAccessRules({})
  }

  const value = {
    session,
    profile,
    accessRules,
    refreshAccessRules,
    // loading = true while we don't know session, or session exists but rules not loaded yet
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
