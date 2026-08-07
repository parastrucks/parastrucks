import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, allowedRoles, authOnly }) {
  const { session, profile, loading, canAccess, loadError, mustChangePassword } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F8F8F8' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // The password was set by HR or an admin, so it is known to more than one
  // person. Nothing else opens until they choose their own.
  //
  // Placed BEFORE the loadError branch on purpose: a profile read can fail for
  // reasons that have nothing to do with the password, and a flagged user must
  // always be able to reach the one page that unblocks them. Placed after the
  // session check because there is nothing to force on a signed-out visitor.
  //
  // This is a forcing function, not a containment control — the token stays
  // fully privileged against PostgREST. The real gates are server-side: the
  // reset revokes live sessions, and erp-login and erp-sso both refuse a
  // flagged user outright.
  if (mustChangePassword && pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  // Backend read failed (red-team 2026-07-21, H2). Previously profile/accessRules
  // simply stayed empty, canAccess() returned false for everything, and the user
  // was bounced to a portal with an empty sidebar and NO explanation — which
  // looks exactly like "you have no permissions". Say what actually happened.
  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F8F8F8', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Couldn’t load your profile</h2>
          <p style={{ color: '#666', marginBottom: 4 }}>
            This is a problem on our side, not with your account.
          </p>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 20 }}>{loadError}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

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
