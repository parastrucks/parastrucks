import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

// Department-code-keyed tab bars. Admin still gets the broad tab set based
// on permission_level, everyone else on their department. Legacy role values
// map 1:1 to dept codes for back_office/hr/sales so pre-6c.1 users still get
// their expected tabs without a migration touch.
const DEPT_TABS = {
  sales: [
    { to: '/',               icon: '⊞', label: 'Home' },
    { to: '/quotation',      icon: '📄', label: 'Quote' },
    { to: '/my-quotations',  icon: '🗂', label: 'History' },
    { to: '/profile',        icon: '👤', label: 'Profile' },
  ],
  back_office: [
    { to: '/',               icon: '⊞', label: 'Home' },
    { to: '/quotation',      icon: '📄', label: 'Quote' },
    { to: '/tiv-forecast',   icon: '📈', label: 'TIV' },
    { to: '/profile',        icon: '👤', label: 'Profile' },
  ],
  hr: [
    { to: '/',               icon: '⊞', label: 'Home' },
    { to: '/employees',      icon: '👥', label: 'Employees' },
    { to: '/profile',        icon: '👤', label: 'Profile' },
  ],
}

const ADMIN_TABS = [
  { to: '/',               icon: '⊞', label: 'Home' },
  { to: '/quotation',      icon: '📄', label: 'Quote' },
  { to: '/tiv-forecast',   icon: '📈', label: 'TIV' },
  { to: '/employees',      icon: '👥', label: 'Team' },
  { to: '/profile',        icon: '👤', label: 'Profile' },
]

const FALLBACK_TABS = [
  { to: '/',         icon: '⊞', label: 'Home' },
  { to: '/profile',  icon: '👤', label: 'Profile' },
]

export default function BottomNav() {
  const { profile, isAdmin } = useAuth()

  // Resolve department code from department_id. Legacy role value is the
  // fallback during the 6c.1 transition window.
  const [deptCode, setDeptCode] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!profile?.department_id) { setDeptCode(null); return }
    supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setDeptCode(data?.code ?? null) })
    return () => { cancelled = true }
  }, [profile?.department_id])

  if (!profile) return null
  const key = isAdmin ? '__admin__' : (deptCode || profile.role)
  const tabs = key === '__admin__' ? ADMIN_TABS : (DEPT_TABS[key] || FALLBACK_TABS)

  return (
    <nav className="bottom-nav">
      {tabs.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `bottom-tab ${isActive ? 'active' : ''}`}
        >
          <span className="bottom-tab-icon">{tab.icon}</span>
          <span className="bottom-tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
