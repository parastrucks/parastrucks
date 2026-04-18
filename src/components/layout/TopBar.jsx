import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function TopBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  if (!profile) return null

  const initials = profile.full_name
    ?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <header className="topbar">
      <div className="topbar-right">
        <NavLink to="/profile" className="topbar-profile" title="Profile">
          <span className="topbar-avatar">{initials}</span>
          <span className="topbar-name">{profile.full_name}</span>
        </NavLink>
        <button className="topbar-signout" onClick={handleSignOut} title="Sign out">
          ↩
        </button>
      </div>
    </header>
  )
}
