import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const NAV_GROUPS = [
  {
    key: 'quotations',
    icon: '📄',
    label: 'Quotations',
    items: [
      { to: '/quotation',     icon: '✏️', label: 'New Quotation' },
      { to: '/my-quotations', icon: '🗂', label: 'My Quotations' },
      { to: '/quotation-log', icon: '📊', label: 'Quotation Log' },
    ],
  },
  {
    key: 'proformas',
    icon: '📃',
    label: 'Proforma Invoices',
    items: [
      { to: '/proforma-invoice', icon: '✏️', label: 'New Proforma' },
      { to: '/my-proformas',     icon: '🗃', label: 'My Proformas' },
      { to: '/proforma-log',     icon: '📋', label: 'Proforma Log' },
    ],
  },
  {
    key: 'financier-copies',
    icon: '🏦',
    label: "Financier's Copies",
    items: [
      { to: '/financier-copy',      icon: '✏️', label: 'New Copy' },
      { to: '/my-financier-copies', icon: '🗃', label: 'My Copies' },
      { to: '/financier-copy-log',  icon: '📋', label: 'Copy Log' },
    ],
  },
]

const UNGROUPED = [
  { to: '/employees',      icon: '👥', label: 'Employees'       },
  { to: '/access-rules',   icon: '🔐', label: 'Access Rules'    },
  { to: '/catalog',        icon: '🚛', label: 'Vehicle Catalog' },
  { to: '/bus-calculator', icon: '🚌', label: 'Bus Calculator'  },
  { to: '/tiv-forecast',   icon: '📈', label: 'TIV Forecast'    },
]

function NavGroup({ group, canAccess }) {
  const location = useLocation()
  const accessibleItems = group.items.filter(item => canAccess(item.to))
  if (accessibleItems.length === 0) return null

  const isGroupActive = accessibleItems.some(item => location.pathname === item.to)
  const [open, setOpen] = useState(isGroupActive)

  // Auto-expand when navigating into this group from elsewhere (e.g. dashboard)
  useEffect(() => {
    if (isGroupActive) setOpen(true)
  }, [isGroupActive])

  return (
    <div className={`sidebar-group${open ? ' sidebar-group--open' : ''}`}>
      <button
        type="button"
        className={`sidebar-link sidebar-group-header${isGroupActive ? ' group-active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sidebar-icon">{group.icon}</span>
        <span className="sidebar-group-label">{group.label}</span>
        <span className="sidebar-group-chevron" />
      </button>
      {open && (
        <div className="sidebar-group-items">
          {accessibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link sidebar-link--sub${isActive ? ' active' : ''}`}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { profile, canAccess } = useAuth()

  const [entityCode, setEntityCode] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!profile?.entity_id) { setEntityCode(null); return }
    supabase.from('entities').select('code').eq('id', profile.entity_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setEntityCode(data?.code ?? null) })
    return () => { cancelled = true }
  }, [profile?.entity_id])

  if (!profile) return null

  const ungroupedItems = UNGROUPED.filter(item => canAccess(item.to))

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/paras-logo.png" alt="Paras Trucks" />
      </div>

      <div className="sidebar-entity">
        <span className="entity-badge">{entityCode || '—'}</span>
        <span className="sidebar-username">{profile.full_name}</span>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
          <span className="sidebar-icon">⊞</span>
          Dashboard
        </NavLink>

        {NAV_GROUPS.map(group => (
          <NavGroup key={group.key} group={group} canAccess={canAccess} />
        ))}

        {ungroupedItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

    </aside>
  )
}
