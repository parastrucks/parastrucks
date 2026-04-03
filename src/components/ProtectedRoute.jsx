import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, allowedRoles }) {
  const { session, profile, loading, accessRules } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F8F8F8' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Hard-coded override takes priority (used for /access-rules safety net)
  if (allowedRoles) {
    if (profile && !allowedRoles.includes(profile.role)) return <Navigate to="/" replace />
    return children
  }

  // DB-driven check
  const allowed = accessRules?.[pathname]
  if (allowed && profile && !allowed.includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  return children
}
