import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useEffect, useRef, useState } from 'react'

export default function TopBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!profile) return null

  const initials = profile.full_name
    ?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <header className="topbar">
      <div className="topbar-user" ref={ref}>
        <button
          type="button"
          className={`topbar-avatar-btn${open ? ' open' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          title={profile.full_name}
        >
          {initials}
        </button>

        {open && (
          <div className="topbar-dropdown" role="menu">
            <div className="topbar-dropdown-name">{profile.full_name}</div>
            <div className="topbar-dropdown-divider" />
            <Link
              to="/profile"
              className="topbar-dropdown-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              👤 Profile
            </Link>
            <button
              type="button"
              className="topbar-dropdown-item topbar-dropdown-signout"
              role="menuitem"
              onClick={handleSignOut}
            >
              ↩ Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
