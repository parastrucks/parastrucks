import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const ROLE_NAV = {
  sales: [
    { to: '/',              icon: '⊞',  label: 'Dashboard' },
    { to: '/quotation',     icon: '📄', label: 'New Quotation' },
    { to: '/my-quotations', icon: '🗂', label: 'My Quotations' },
    { to: '/bus-calculator',icon: '🚌', label: 'Bus Calculator', busOnly: true },
  ],
  back_office: [
    { to: '/',              icon: '⊞',  label: 'Dashboard' },
    { to: '/quotation',     icon: '📄', label: 'New Quotation' },
    { to: '/my-quotations', icon: '🗂', label: 'My Quotations' },
    { to: '/bus-calculator',icon: '🚌', label: 'Bus Calculator', busOnly: true },
  ],
  hr: [
    { to: '/',              icon: '⊞',  label: 'Dashboard' },
    { to: '/employees',     icon: '👥', label: 'Employees' },
  ],
  admin: [
    { to: '/',              icon: '⊞',  label: 'Dashboard' },
    { to: '/quotation',     icon: '📄', label: 'New Quotation' },
    { to: '/my-quotations', icon: '🗂', label: 'My Quotations' },
    { to: '/quotation-log', icon: '📊', label: 'Quotation Log' },
    { to: '/employees',     icon: '👥', label: 'Employees' },
    { to: '/access-rules',  icon: '🔐', label: 'Access Rules' },
    { to: '/catalog',       icon: '🚛', label: 'Vehicle Catalog' },
    { to: '/bus-calculator',icon: '🚌', label: 'Bus Calculator' },
  ],
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  if (!profile) return null

  const navItems = ROLE_NAV[profile.role] || []
  // Filter bus calculator for sales/back_office — only show if vertical includes Bus
  const filtered = navItems.filter(item => {
    if (item.busOnly) {
      return profile.vertical?.toLowerCase().includes('bus')
    }
    return true
  })

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/paras-logo.png" alt="Paras Trucks" />
      </div>

      <div className="sidebar-entity">
        <span className="entity-badge">{profile.entity || 'PTB'}</span>
        <span className="sidebar-username">{profile.full_name}</span>
      </div>

      <nav className="sidebar-nav">
        {filtered.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/profile" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span className="sidebar-icon">👤</span>
          Profile
        </NavLink>
        <button className="sidebar-link sidebar-signout" onClick={handleSignOut}>
          <span className="sidebar-icon">↩</span>
          Sign Out
        </button>
      </div>
    </aside>
  )
}
