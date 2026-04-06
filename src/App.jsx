import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'

// Pages
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Employees from './pages/Employees'
import Quotation from './pages/Quotation'
import MyQuotations from './pages/MyQuotations'
import QuotationLog from './pages/QuotationLog'
import BusCalculator from './pages/BusCalculator'
import AccessRules from './pages/AccessRules'
import Catalog from './pages/Catalog'

// Placeholder for pages not yet built
const Soon = ({ name }) => (
  <div className="page-soon">
    <div className="soon-icon">🔧</div>
    <h2>{name}</h2>
    <p>Coming soon — this module is under construction.</p>
  </div>
)

export default function App() {
  const { session, loading, signOut } = useAuth()
  const [showEscape, setShowEscape] = useState(false)

  // If loading takes more than 15 s, show a sign-out escape hatch so the user
  // isn't permanently stuck (can happen when the session is stale but still in
  // sessionStorage and profile/rules fetches keep timing out).
  useEffect(() => {
    if (!loading) { setShowEscape(false); return }
    const t = setTimeout(() => setShowEscape(true), 15000)
    return () => clearTimeout(t)
  }, [loading])

  if (loading) {
    return (
      <div className="full-center" style={{ flexDirection: 'column', gap: 16 }}>
        <div className="spinner" />
        {showEscape && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>
              Taking too long?
            </p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => signOut()}
            >
              Sign out and try again
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected — all roles */}
      <Route element={<ProtectedRoute authOnly><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />

        {/* DB-driven access — ProtectedRoute reads accessRules from context */}
        <Route path="/quotation"      element={<ProtectedRoute><Quotation /></ProtectedRoute>} />
        <Route path="/my-quotations"  element={<ProtectedRoute><MyQuotations /></ProtectedRoute>} />
        <Route path="/bus-calculator" element={<ProtectedRoute><BusCalculator /></ProtectedRoute>} />
        <Route path="/employees"      element={<ProtectedRoute><Employees /></ProtectedRoute>} />
        <Route path="/quotation-log"  element={<ProtectedRoute><QuotationLog /></ProtectedRoute>} />
        <Route path="/catalog"        element={<ProtectedRoute><Catalog /></ProtectedRoute>} />

        {/* Access rules — always admin-only (hardcoded safety net) */}
        <Route
          path="/access-rules"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AccessRules />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
