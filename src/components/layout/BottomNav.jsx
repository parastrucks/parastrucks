import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import Icon from '../Icon'
import CreateSheet from './CreateSheet'
import { CREATE_ACTIONS } from './navConfig'

// Department-code-keyed tab bars (icons are Lucide names). Admin gets the broad
// set; everyone else on their department; unknown codes fall back to home+profile.
const DEPT_TABS = {
  sales: [
    { to: '/',              icon: 'dashboard', label: 'Home' },
    { to: '/quotation',     icon: 'file',      label: 'Quote' },
    { to: '/my-quotations', icon: 'clipboard', label: 'History' },
    { to: '/profile',       icon: 'user',      label: 'Profile' },
  ],
  back_office: [
    { to: '/',             icon: 'dashboard', label: 'Home' },
    { to: '/quotation',    icon: 'file',      label: 'Quote' },
    { to: '/tiv-forecast', icon: 'trending',  label: 'TIV' },
    { to: '/profile',      icon: 'user',      label: 'Profile' },
  ],
  hr: [
    { to: '/',          icon: 'dashboard', label: 'Home' },
    { to: '/employees', icon: 'users',     label: 'Employees' },
    { to: '/profile',   icon: 'user',      label: 'Profile' },
  ],
  service: [
    { to: '/',            icon: 'dashboard', label: 'Home' },
    { to: '/vendor-jobs', icon: 'wrench',    label: 'Jobs' },
    { to: '/profile',     icon: 'user',      label: 'Profile' },
  ],
  accounts: [
    { to: '/',            icon: 'dashboard', label: 'Home' },
    { to: '/vendor-jobs', icon: 'wrench',    label: 'Jobs' },
    { to: '/profile',     icon: 'user',      label: 'Profile' },
  ],
}

// 4 icons + the raised center Create (+) = 5 slots. "Quote" is omitted here
// because New Quotation is already the first action in the Create sheet.
const ADMIN_TABS = [
  { to: '/',             icon: 'dashboard', label: 'Home' },
  { to: '/tiv-forecast', icon: 'trending',  label: 'TIV' },
  { to: '/employees',    icon: 'users',     label: 'Team' },
  { to: '/profile',      icon: 'user',      label: 'Profile' },
]

const FALLBACK_TABS = [
  { to: '/',        icon: 'dashboard', label: 'Home' },
  { to: '/profile', icon: 'user',      label: 'Profile' },
]

function Tab({ tab }) {
  return (
    <NavLink to={tab.to} end={tab.to === '/'} className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
      {({ isActive }) => (
        <>
          <Icon name={tab.icon} size={21} color={isActive ? 'var(--accent)' : 'var(--text-muted)'} className="bottom-tab-icon" />
          <span className="bottom-tab-label">{tab.label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function BottomNav() {
  const { profile, isAdmin, canAccess } = useAuth()
  const [deptCode, setDeptCode] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!profile?.department_id) { setDeptCode(null); return }
    supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setDeptCode(data?.code ?? null) })
    return () => { cancelled = true }
  }, [profile?.department_id])

  if (!profile) return null

  let tabs = isAdmin ? ADMIN_TABS : (DEPT_TABS[deptCode] || FALLBACK_TABS)
  const createActions = CREATE_ACTIONS.filter(a => canAccess(a.to))
  const hasCreate = createActions.length > 0

  // Keep the raised Create (+) visually centred by splitting an EVEN number of
  // tabs around it (equal on both sides). If the count is odd, drop the last
  // tab (Profile — still reachable via the top-bar avatar and the drawer).
  if (hasCreate && tabs.length % 2 === 1) tabs = tabs.slice(0, -1)
  const mid = tabs.length / 2
  const left = hasCreate ? tabs.slice(0, mid) : tabs
  const right = hasCreate ? tabs.slice(mid) : []

  return (
    <>
      <nav className="bottom-nav">
        {left.map(t => <Tab key={t.to} tab={t} />)}
        {hasCreate && (
          <button type="button" className="bottom-nav-create" onClick={() => setCreateOpen(true)} aria-label="Create new">
            <Icon name="plus" size={26} color="#fff" />
          </button>
        )}
        {right.map(t => <Tab key={t.to} tab={t} />)}
      </nav>
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} actions={createActions} />
    </>
  )
}
