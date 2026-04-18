import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const UNGROUPED_TOOLS = [
  { to: '/employees',      icon: '👥', title: 'Employee Management', desc: 'Create, edit, and manage team accounts' },
  { to: '/access-rules',   icon: '🔐', title: 'Access Rules',        desc: 'Configure roles, brands, and tool access' },
  { to: '/catalog',        icon: '🚛', title: 'Vehicle Catalog',     desc: 'Manage the vehicle price catalog' },
  { to: '/bus-calculator', icon: '🚌', title: 'Bus Calculator',      desc: 'Build a bus price estimate step by step' },
  { to: '/tiv-forecast',   icon: '📈', title: 'TIV Forecast',        desc: 'Industry volume forecasting and segment analysis' },
]

const GROUPS = [
  {
    key: 'quotations',
    icon: '📄',
    title: 'Quotations',
    desc: 'Generate a customer quotation PDF',
    primary: { to: '/quotation', label: 'New Quotation' },
    extras: [
      { to: '/my-quotations',  icon: '🗂', label: 'My Quotations' },
      { to: '/quotation-log',  icon: '📊', label: 'Quotation Log' },
    ],
  },
  {
    key: 'proformas',
    icon: '📃',
    title: 'Proforma Invoices',
    desc: 'Generate proforma invoices for physical vehicles',
    primary: { to: '/proforma-invoice', label: 'New Proforma Invoice' },
    extras: [
      { to: '/my-proformas', icon: '🗃', label: 'My Proforma Invoices' },
      { to: '/proforma-log', icon: '📋', label: 'Proforma Invoice Log' },
    ],
  },
  {
    key: 'financier-copies',
    icon: '🏦',
    title: "Financier's Copies",
    desc: "Generate Tax Invoice (Financier's copy) for bank/NBFC disbursement",
    primary: { to: '/financier-copy', label: "New Financier's Copy" },
    extras: [
      { to: '/my-financier-copies', icon: '🗃', label: "My Financier's Copies" },
      { to: '/financier-copy-log',  icon: '📋', label: "Financier's Copy Log" },
    ],
  },
]

// Phase 6c.3: permission_level is the only label source.
const PERM_LABEL = {
  admin:       'Admin',
  gm:          'GM',
  manager:     'Manager',
  executive:   'Executive',
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function GroupCard({ group, canAccess }) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef(null)

  const primaryAccessible = canAccess(group.primary.to)
  const accessibleExtras = group.extras.filter(e => canAccess(e.to))

  // Hide entire group if neither primary nor any extra is accessible
  if (!primaryAccessible && accessibleExtras.length === 0) return null

  // Determine effective primary destination
  const effectivePrimaryTo = primaryAccessible
    ? group.primary.to
    : accessibleExtras[0].to

  // Show chevron only if there are extras beyond the primary destination
  const showChevron = accessibleExtras.length > 0 && (primaryAccessible || accessibleExtras.length > 1)
  // Extras to show in dropdown: if primary not accessible, skip the first extra (already used as primary)
  const dropdownExtras = primaryAccessible ? accessibleExtras : accessibleExtras.slice(1)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className={`tool-card tool-card-group${open ? ' tool-card-group--open' : ''}`} ref={cardRef}>
      <Link to={effectivePrimaryTo} className="tool-card-group-primary">
        <div className="tool-card-icon">{group.icon}</div>
        <h3>{group.title}</h3>
        <p>{group.desc}</p>
      </Link>
      {showChevron && dropdownExtras.length > 0 && (
        <>
          <button
            className="tool-card-group-chevron"
            onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={`More options for ${group.title}`}
            type="button"
          >
            {open ? '▲' : '▼'}
          </button>
          {open && (
            <div className="tool-card-group-menu" role="menu">
              {dropdownExtras.map(extra => (
                <Link
                  key={extra.to}
                  to={extra.to}
                  className="tool-card-group-menu-item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <span style={{ marginRight: 8 }}>{extra.icon}</span>
                  {extra.label}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { profile, canAccess } = useAuth()
  if (!profile) return null

  const ungroupedTools = UNGROUPED_TOOLS.filter(t => canAccess(t.to))
  const tierLabel = PERM_LABEL[profile.permission_level] || '—'

  return (
    <div>
      <div className="page-header">
        <h1>{greeting()}, {profile?.full_name?.split(' ')?.[0] || 'there'} 👋</h1>
        <p>
          {tierLabel}
          {profile.location ? ` · ${profile.location}` : ''}
        </p>
      </div>

      <div className="tool-grid">
        {GROUPS.map(group => (
          <GroupCard key={group.key} group={group} canAccess={canAccess} />
        ))}
        {ungroupedTools.map(tool => (
          <Link key={tool.to} to={tool.to} className="tool-card">
            <div className="tool-card-icon">{tool.icon}</div>
            <h3>{tool.title}</h3>
            <p>{tool.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
