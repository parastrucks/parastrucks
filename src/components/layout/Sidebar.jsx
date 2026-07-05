import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useErp, useErpVisible } from '../../lib/erp'
import Icon from '../Icon'
import { NAV_SECTIONS, itemVisible } from './navConfig'

const ICON_ACTIVE = '#6AA0FF'
const ICON_IDLE = 'rgba(255,255,255,0.7)'

function SidebarLink({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} size={17} color={isActive ? ICON_ACTIVE : ICON_IDLE} className="sidebar-icon" />
          {label}
        </>
      )}
    </NavLink>
  )
}

function NavGroup({ group, canAccess }) {
  const accessibleItems = group.items.filter(item => canAccess(item.to))
  if (accessibleItems.length === 0) return null

  const location = useLocation()
  const isGroupActive = accessibleItems.some(item => location.pathname === item.to)
  // Collapsed by default — do NOT auto-expand on active (design decision).
  const [open, setOpen] = useState(false)

  return (
    <div className={`sidebar-group${open ? ' sidebar-group--open' : ''}`}>
      <button
        type="button"
        className={`sidebar-link sidebar-group-header${isGroupActive ? ' group-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <Icon name={group.icon} size={17} color={isGroupActive ? ICON_ACTIVE : ICON_IDLE} className="sidebar-icon" />
        <span className="sidebar-group-label">{group.label}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} color="rgba(255,255,255,0.45)" />
      </button>
      {open && (
        <div className="sidebar-group-items">
          {accessibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link sidebar-link--sub${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function ErpItem({ item }) {
  const { openErp, erpBusy } = useErp()
  return (
    <button
      type="button"
      className="sidebar-link"
      onClick={openErp}
      aria-busy={erpBusy}
      style={{ width: '100%' }}
    >
      <Icon name={item.icon} size={17} color={ICON_IDLE} className="sidebar-icon" />
      {item.label}
      <Icon name="external" size={14} color="rgba(255,255,255,0.4)" style={{ marginLeft: 'auto' }} />
    </button>
  )
}

function UserMenu({ profile, entityCode }) {
  const navigate = useNavigate()
  const { signOut } = useAuth()
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

  const initials = profile.full_name
    ?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`sidebar-entity sidebar-entity--menu${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="sidebar-entity-trigger"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="sidebar-avatar-sm">{initials}</span>
        <span className="sidebar-entity-info">
          <span className="sidebar-username">{profile.full_name}</span>
          {entityCode && <span className="entity-badge">{entityCode}</span>}
        </span>
        <span className="sidebar-entity-caret" />
      </button>

      {open && (
        <div className="sidebar-entity-dropdown" role="menu">
          <Link
            to="/profile"
            className="sidebar-user-dropdown-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Icon name="user" size={16} /> Profile
          </Link>
          <button
            type="button"
            className="sidebar-user-dropdown-item sidebar-user-dropdown-signout"
            role="menuitem"
            onClick={handleSignOut}
          >
            <Icon name="logout" size={16} /> Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { profile, canAccess } = useAuth()
  const erpVisible = useErpVisible()

  const [entityCode, setEntityCode] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!profile?.entity_id) { setEntityCode(null); return }
    supabase.from('entities').select('code').eq('id', profile.entity_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setEntityCode(data?.code ?? null) })
    return () => { cancelled = true }
  }, [profile?.entity_id])

  if (!profile) return null

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/paras-logo.png" alt="Paras Trucks" />
      </div>

      <UserMenu profile={profile} entityCode={entityCode} />

      <nav className="sidebar-nav">
        <SidebarLink to="/" icon="dashboard" label="Dashboard" />

        {NAV_SECTIONS.map(section => {
          const visible = section.items.filter(item => item.type === 'erp' ? erpVisible : itemVisible(item, canAccess))
          if (visible.length === 0) return null
          return (
            <div className="sidebar-section" key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {visible.map(item => {
                if (item.type === 'group') return <NavGroup key={item.key} group={item} canAccess={canAccess} />
                if (item.type === 'erp') return <ErpItem key="erp" item={item} />
                return <SidebarLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
              })}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
