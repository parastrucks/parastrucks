import { Routes, Route, Navigate } from 'react-router-dom'
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

// Placeholder for pages not yet built
const Soon = ({ name }) => (
  <div className="page-soon">
    <div className="soon-icon">🔧</div>
    <h2>{name}</h2>
    <p>Coming soon — this module is under construction.</p>
  </div>
)

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="full-center">
        <div className="spinner" />
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
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />

        {/* DB-driven access — ProtectedRoute reads accessRules from context */}
        <Route path="/quotation"      element={<ProtectedRoute><Quotation /></ProtectedRoute>} />
        <Route path="/my-quotations"  element={<ProtectedRoute><MyQuotations /></ProtectedRoute>} />
        <Route path="/bus-calculator" element={<ProtectedRoute><BusCalculator /></ProtectedRoute>} />
        <Route path="/employees"      element={<ProtectedRoute><Employees /></ProtectedRoute>} />
        <Route path="/quotation-log"  element={<ProtectedRoute><QuotationLog /></ProtectedRoute>} />
        <Route path="/catalog"        element={<ProtectedRoute><Soon name="Vehicle Catalog" /></ProtectedRoute>} />

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
