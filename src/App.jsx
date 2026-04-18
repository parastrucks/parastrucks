import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import ErrorBoundary from './components/ErrorBoundary'

// Landing pages — eagerly imported so there's no lazy-chunk waterfall on
// the first screen users see after login. The bundle cost is small and the
// perceived-load win is large (saved ~1–2 s on Dashboard first paint).
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Heavier routes stay lazy — each ships its own chunk and a broken page
// doesn't take down the whole bundle.
const Profile          = lazy(() => import('./pages/Profile'))
const Employees        = lazy(() => import('./pages/Employees'))
const Quotation        = lazy(() => import('./pages/Quotation'))
const MyQuotations     = lazy(() => import('./pages/MyQuotations'))
const QuotationLog     = lazy(() => import('./pages/QuotationLog'))
const BusCalculator    = lazy(() => import('./pages/BusCalculator'))
const AccessRules      = lazy(() => import('./pages/AccessRules'))
const Catalog          = lazy(() => import('./pages/Catalog'))
const TivForecastPage  = lazy(() => import('./tiv-forecast/pages/TivForecastPage'))
const ProformaInvoice  = lazy(() => import('./pages/ProformaInvoice'))
const MyProformas      = lazy(() => import('./pages/MyProformas'))
const ProformaLog      = lazy(() => import('./pages/ProformaLog'))

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
    const t = setTimeout(() => setShowEscape(true), 10000)
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
    <ErrorBoundary>
      <Suspense fallback={<div className="full-center"><div className="spinner" /></div>}>
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
            <Route path="/tiv-forecast"      element={<ProtectedRoute><TivForecastPage /></ProtectedRoute>} />
            <Route path="/proforma-invoice"  element={<ProtectedRoute><ProformaInvoice /></ProtectedRoute>} />
            <Route path="/my-proformas"      element={<ProtectedRoute><MyProformas /></ProtectedRoute>} />
            <Route path="/proforma-log"      element={<ProtectedRoute><ProformaLog /></ProtectedRoute>} />

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
      </Suspense>
    </ErrorBoundary>
  )
}
