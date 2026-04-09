import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const ROLE_TABS = {
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
  admin: [
    { to: '/',               icon: '⊞', label: 'Home' },
    { to: '/quotation',      icon: '📄', label: 'Quote' },
    { to: '/tiv-forecast',   icon: '📈', label: 'TIV' },
    { to: '/employees',      icon: '👥', label: 'Team' },
    { to: '/profile',        icon: '👤', label: 'Profile' },
  ],
}

export default function BottomNav() {
  const { profile } = useAuth()
  if (!profile) return null
  const tabs = ROLE_TABS[profile.role] || []

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
