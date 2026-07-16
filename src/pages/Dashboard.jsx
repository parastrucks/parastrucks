import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useErp, useErpVisible } from '../lib/erp'
import Icon from '../components/Icon'

/* Cards grouped under the same four sections as the sidebar. */
const SECTIONS = [
  {
    label: 'Sales Tools',
    cards: [
      {
        type: 'group', icon: 'file', title: 'Quotations',
        desc: 'Generate a customer quotation PDF.',
        primary: { to: '/quotation', label: 'New Quotation' },
        extras: [
          { to: '/my-quotations', label: 'My Quotations' },
          { to: '/quotation-log', label: 'Quotation Log' },
        ],
      },
      { type: 'link', icon: 'truck', title: 'Vehicle Catalog', desc: 'Price catalog across all brands & segments.', to: '/catalog' },
      { type: 'link', icon: 'bus', title: 'Bus Calculator', desc: 'Step-by-step bus (chassis + body) estimate.', to: '/bus-calculator' },
    ],
  },
  {
    label: 'Service Tools',
    cards: [
      { type: 'link', icon: 'wrench', title: 'Vendor Jobs', desc: 'Track outside-workshop & ancillary repair jobs.', to: '/vendor-jobs' },
      { type: 'erp', icon: 'landmark', title: 'HD Hyundai Service ERP', desc: 'Service ops — job cards, spares, stock & billing.' },
    ],
  },
  {
    label: 'Back Office Tools',
    cards: [
      {
        type: 'group', icon: 'files', title: 'Proforma Invoices',
        desc: 'Generate proforma invoices for physical vehicles.',
        primary: { to: '/proforma-invoice', label: 'New Proforma Invoice' },
        extras: [
          { to: '/my-proformas', label: 'My Proforma Invoices' },
          { to: '/proforma-log', label: 'Proforma Invoice Log' },
        ],
      },
      {
        type: 'group', icon: 'landmark', title: "Financier's Copies",
        desc: "Generate Tax Invoice (Financier's copy) for bank / NBFC disbursement.",
        primary: { to: '/financier-copy', label: "New Financier's Copy" },
        extras: [
          { to: '/my-financier-copies', label: "My Financier's Copies" },
          { to: '/financier-copy-log', label: "Financier's Copy Log" },
        ],
      },
      { type: 'link', icon: 'trending', title: 'TIV Forecast', desc: 'Industry volume forecasting & segment analysis.', to: '/tiv-forecast' },
    ],
  },
  {
    label: 'Operations Tools',
    cards: [
      { type: 'link', icon: 'users', title: 'Employee Management', desc: 'Manage team accounts, access & status.', to: '/employees' },
      { type: 'link', icon: 'shield', title: 'Access Rules', desc: 'Route permissions, entity GMs & reference data.', to: '/access-rules' },
    ],
  },
]

const PERM_LABEL = { admin: 'Admin', gm: 'GM', manager: 'Manager', executive: 'Executive' }

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'   // 17:00–04:59 (incl. late night)
}

function LinkCard({ card }) {
  return (
    <Link to={card.to} className="dcard dcard--link">
      <div className="dcard-top">
        <span className="dcard-ico"><Icon name={card.icon} size={22} color="currentColor" /></span>
        <span className="dcard-corner"><Icon name="arrow-right" size={17} color="currentColor" /></span>
      </div>
      <div className="dcard-title">{card.title}</div>
      <div className="dcard-desc">{card.desc}</div>
    </Link>
  )
}

function ErpCard({ card }) {
  const { openErp, erpBusy } = useErp()
  return (
    <button
      type="button"
      className="dcard dcard--inverted"
      onClick={openErp}
      aria-busy={erpBusy}
      style={{ cursor: erpBusy ? 'wait' : 'pointer' }}
    >
      <div className="dcard-top">
        <span className="dcard-ico"><Icon name={card.icon} size={22} color="currentColor" /></span>
        <span className="dcard-corner"><Icon name="external" size={17} color="currentColor" /></span>
      </div>
      <div className="dcard-title">{card.title}</div>
      <div className="dcard-desc">{erpBusy ? 'Opening…' : card.desc}</div>
    </button>
  )
}

function GroupCard({ card, canAccess }) {
  // Hooks must run before any early return (rules of hooks) — the parent filters
  // cards with the same predicate so the guard below is unreachable today, but
  // keep the hooks unconditional so a future predicate divergence can't blank the tree.
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const primaryAccessible = canAccess(card.primary.to)
  const accessibleExtras = card.extras.filter(e => canAccess(e.to))
  if (!primaryAccessible && accessibleExtras.length === 0) return null

  const effectivePrimaryTo = primaryAccessible ? card.primary.to : accessibleExtras[0].to
  const dropdownExtras = primaryAccessible ? accessibleExtras : accessibleExtras.slice(1)
  const showMore = dropdownExtras.length > 0

  return (
    <div className="dcard dcard--group" ref={ref}>
      <Link to={effectivePrimaryTo} className="dcard-lead">
        <div className="dcard-top">
          <span className="dcard-ico"><Icon name={card.icon} size={22} color="currentColor" /></span>
          <span className="dcard-new">New <Icon name="arrow-right" size={14} color="currentColor" /></span>
        </div>
        <div className="dcard-title">{card.title}</div>
        <div className="dcard-desc">{card.desc}</div>
      </Link>
      {showMore && (
        <>
          <button
            type="button"
            className="dcard-more"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-label={`More options for ${card.title}`}
          >
            More options
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color="currentColor" />
          </button>
          {open && dropdownExtras.map(extra => (
            <Link key={extra.to} to={extra.to} className="dcard-more-item" onClick={() => setOpen(false)}>
              {extra.label}
              <Icon name="arrow-right" size={15} color="currentColor" />
            </Link>
          ))}
        </>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { profile, canAccess } = useAuth()
  const erpVisible = useErpVisible()
  if (!profile) return null

  const firstName = profile.full_name?.split(' ')?.[0] || 'there'
  const tierLabel = PERM_LABEL[profile.permission_level] || '—'
  const sub = `${tierLabel}${profile.location ? ` · ${profile.location}` : ''}`

  function cardVisible(card) {
    if (card.type === 'erp') return erpVisible
    if (card.type === 'group') return canAccess(card.primary.to) || card.extras.some(e => canAccess(e.to))
    return canAccess(card.to)
  }

  return (
    <div>
      <div className="page-header" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 22 }}>
        <h1>{greeting()}, {firstName}<span className="period-accent">.</span></h1>
        <div className="eyebrow" style={{ marginTop: 8 }}>{sub}</div>
      </div>

      {SECTIONS.map(section => {
        const cards = section.cards.filter(cardVisible)
        if (cards.length === 0) return null
        return (
          <div className="dash-section" key={section.label}>
            <div className="eyebrow eyebrow--rule">{section.label}</div>
            <div className="dash-grid">
              {cards.map(card => {
                if (card.type === 'group') return <GroupCard key={card.title} card={card} canAccess={canAccess} />
                if (card.type === 'erp') return <ErpCard key={card.title} card={card} />
                return <LinkCard key={card.title} card={card} />
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
