import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const ALL_PAGES = [
  { to: '/quotation',      icon: '📄', label: 'New Quotation'   },
  { to: '/my-quotations',  icon: '🗂', label: 'My Quotations'   },
  { to: '/quotation-log',  icon: '📊', label: 'Quotation Log'   },
  { to: '/employees',      icon: '👥', label: 'Employees'       },
  { to: '/access-rules',   icon: '🔐', label: 'Access Rules'    },
  { to: '/catalog',        icon: '🚛', label: 'Vehicle Catalog' },
  { to: '/bus-calculator', icon: '🚌', label: 'Bus Calculator'  },
]

export default function Sidebar() {
  const { profile, signOut, canAccess } = useAuth()
  const navigate = useNavigate()
  if (!profile) return null

  const navItems = ALL_PAGES.filter(page => canAccess(page.to))

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
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span className="sidebar-icon">⊞</span>
          Dashboard
        </NavLink>

        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
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
