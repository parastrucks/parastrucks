import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, allowedRoles, authOnly }) {
  const { session, profile, loading, canAccess } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F8F8F8' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Layout-level guard — only checks authentication, not route access
  if (authOnly) return children

  // Hard-coded override (used for /access-rules as a safety net). Matches
  // against the new permission_level column post-Phase-6c.1 cutover; admin
  // still satisfies this but the check is now aligned with AuthContext.canAccess.
  if (allowedRoles) {
    if (profile && !allowedRoles.includes(profile.permission_level)) return <Navigate to="/" replace />
    return children
  }

  // DB-driven multi-dimensional check
  if (!canAccess(pathname)) return <Navigate to="/" replace />

  return children
}
