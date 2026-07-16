import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Icon from '../Icon'

/* Mobile top bar (<760px): hamburger → drawer, centered logo, avatar → Profile. */
export default function TopBar({ onMenu }) {
  const { profile } = useAuth()
  if (!profile) return null
  const initials = profile.full_name
    ?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  return (
    <header className="topbar">
      <button type="button" className="topbar-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" size={22} color="#fff" />
      </button>
      <img className="topbar-logo" src="/paras-logo.png" alt="Paras Trucks" />
      <Link to="/profile" className="topbar-avatar" aria-label="Profile">{initials}</Link>
    </header>
  )
}
