import { NavLink } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useErp } from '../../lib/erp'
import Icon from '../Icon'
import { NAV_SECTIONS, itemVisible } from './navConfig'

const IDLE = 'rgba(255,255,255,0.75)'

/* Slide-in drawer with the full grouped nav (mobile). Shares NAV_SECTIONS with
   the desktop Sidebar so the two can't diverge. Every item is canAccess-gated. */
export default function MobileDrawer({ open, onClose }) {
  const { canAccess } = useAuth()
  const { openErp } = useErp()

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Navigation">
        <div className="drawer-head">
          <img className="drawer-logo" src="/paras-logo.png" alt="Paras Trucks" />
          <button className="drawer-close" onClick={onClose} aria-label="Close menu">
            <Icon name="x" size={20} color="rgba(255,255,255,0.8)" />
          </button>
        </div>
        <nav className="drawer-nav">
          <NavLink to="/" end className={({ isActive }) => `drawer-link${isActive ? ' active' : ''}`} onClick={onClose}>
            <Icon name="dashboard" size={17} color={IDLE} /> Dashboard
          </NavLink>

          {NAV_SECTIONS.map(section => {
            const visible = section.items.filter(i => itemVisible(i, canAccess))
            if (visible.length === 0) return null
            return (
              <div className="drawer-section" key={section.label}>
                <div className="drawer-section-label">{section.label}</div>
                {visible.map(item => {
                  if (item.type === 'erp') return (
                    <button key="erp" type="button" className="drawer-link" onClick={() => { onClose(); openErp() }}>
                      <Icon name={item.icon} size={17} color={IDLE} /> {item.label}
                      <Icon name="external" size={14} color="rgba(255,255,255,0.4)" style={{ marginLeft: 'auto' }} />
                    </button>
                  )
                  if (item.type === 'group') return (
                    <div key={item.key}>
                      <div className="drawer-group-label">
                        <Icon name={item.icon} size={15} color="rgba(255,255,255,0.55)" /> {item.label}
                      </div>
                      {item.items.filter(c => canAccess(c.to)).map(c => (
                        <NavLink key={c.to} to={c.to} onClick={onClose}
                          className={({ isActive }) => `drawer-link drawer-link--sub${isActive ? ' active' : ''}`}>
                          {c.label}
                        </NavLink>
                      ))}
                    </div>
                  )
                  return (
                    <NavLink key={item.to} to={item.to} onClick={onClose}
                      className={({ isActive }) => `drawer-link${isActive ? ' active' : ''}`}>
                      <Icon name={item.icon} size={17} color={IDLE} /> {item.label}
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
