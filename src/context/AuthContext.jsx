import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  // Fetch the full user profile from the users table
  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) { console.error('Profile fetch error:', error); return null }
    return data
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session) {
        const p = await fetchProfile(session.user.id)
        setProfile(p)
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session) {
          const p = await fetchProfile(session.user.id)
          setProfile(p)
        } else {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Check user is active
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
  }

  const value = {
    session,
    profile,
    loading: session === undefined,
    signIn,
    signOut,
    // Convenience flags
    isAdmin: profile?.role === 'admin',
    isHR: profile?.role === 'hr',
    isBackOffice: profile?.role === 'back_office',
    isSales: profile?.role === 'sales',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
