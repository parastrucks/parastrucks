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

        {/* Sales + Back Office + Admin */}
        <Route
          path="/quotation"
          element={
            <ProtectedRoute allowedRoles={['sales', 'back_office', 'admin']}>
              <Quotation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-quotations"
          element={
            <ProtectedRoute allowedRoles={['sales', 'back_office', 'admin']}>
              <MyQuotations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bus-calculator"
          element={
            <ProtectedRoute allowedRoles={['sales', 'back_office', 'admin']}>
              <Soon name="Bus Price Calculator" />
            </ProtectedRoute>
          }
        />

        {/* HR + Admin */}
        <Route
          path="/employees"
          element={
            <ProtectedRoute allowedRoles={['hr', 'admin']}>
              <Employees />
            </ProtectedRoute>
          }
        />

        {/* Admin only */}
        <Route
          path="/quotation-log"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <QuotationLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/access-rules"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <Soon name="Access Rules" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog"
          element={
            <ProtectedRoute allowedRoles={['admin', 'back_office']}>
              <Soon name="Vehicle Catalog" />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
