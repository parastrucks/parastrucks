import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useErp, useErpVisible } from '../../lib/erp'
import useFocusTrap from '../../hooks/useFocusTrap'
import Icon from '../Icon'
import { NAV_SECTIONS, itemVisible } from './navConfig'

const IDLE = 'rgba(255,255,255,0.78)'

/* A collapsible nav group inside the drawer — mirrors the desktop Sidebar:
   auto-expands the group holding the active route, otherwise user-toggled. */
function DrawerGroup({ item, canAccess, onNavigate }) {
  const location = useLocation()
  const children = item.items.filter(c => canAccess(c.to))
  const isActive = children.some(c => location.pathname === c.to)
  const [open, setOpen] = useState(isActive)
  useEffect(() => { if (isActive) setOpen(true) }, [isActive])
  if (children.length === 0) return null
  return (
    <div className="drawer-group">
      <button
        type="button"
        className={`drawer-group-header${isActive ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <Icon name={item.icon} size={20} color={isActive ? '#fff' : IDLE} />
        <span className="drawer-group-label-text">{item.label}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color="rgba(255,255,255,0.5)" />
      </button>
      {open && children.map(c => (
        <NavLink key={c.to} to={c.to} onClick={onNavigate}
          className={({ isActive }) => `drawer-link drawer-link--sub${isActive ? ' active' : ''}`}>
          {c.label}
        </NavLink>
      ))}
    </div>
  )
}

/* Slide-in drawer with the full grouped nav (mobile). Shares NAV_SECTIONS with
   the desktop Sidebar so the two can't diverge. Every item is canAccess-gated. */
export default function MobileDrawer({ open, onClose }) {
  const { canAccess } = useAuth()
  const { openErp } = useErp()
  const erpVisible = useErpVisible()
  // Trap Tab focus inside the drawer + handle Escape → close (no text inputs
  // here, so the historical per-keystroke focus-steal bug can't apply).
  const trapRef = useFocusTrap(open, onClose)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // lock the page behind the drawer
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" ref={trapRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="drawer-head">
          <img className="drawer-logo" src="/paras-logo.png" alt="Paras Trucks" />
          <button className="drawer-close" onClick={onClose} aria-label="Close menu">
            <Icon name="x" size={22} color="rgba(255,255,255,0.8)" />
          </button>
        </div>
        <nav className="drawer-nav">
          <NavLink to="/" end className={({ isActive }) => `drawer-link${isActive ? ' active' : ''}`} onClick={onClose}>
            <Icon name="dashboard" size={20} color={IDLE} /> Dashboard
          </NavLink>

          {NAV_SECTIONS.map(section => {
            const visible = section.items.filter(i => i.type === 'erp' ? erpVisible : itemVisible(i, canAccess))
            if (visible.length === 0) return null
            return (
              <div className="drawer-section" key={section.label}>
                <div className="drawer-section-label">{section.label}</div>
                {visible.map(item => {
                  if (item.type === 'erp') return (
                    <button key="erp" type="button" className="drawer-link" onClick={() => { onClose(); openErp() }}>
                      <Icon name={item.icon} size={20} color={IDLE} /> {item.label}
                      <Icon name="external" size={16} color="rgba(255,255,255,0.4)" style={{ marginLeft: 'auto' }} />
                    </button>
                  )
                  if (item.type === 'group') return (
                    <DrawerGroup key={item.key} item={item} canAccess={canAccess} onNavigate={onClose} />
                  )
                  return (
                    <NavLink key={item.to} to={item.to} onClick={onClose}
                      className={({ isActive }) => `drawer-link${isActive ? ' active' : ''}`}>
                      <Icon name={item.icon} size={20} color={IDLE} /> {item.label}
                    </NavLink>
                  )
                })}
              </div>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
