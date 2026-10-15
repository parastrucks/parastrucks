import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import Icon from '../Icon'
import CreateSheet from './CreateSheet'
import { CREATE_ACTIONS, bottomNavLayout } from './navConfig'

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
  const [deptResolved, setDeptResolved] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!profile?.department_id) { setDeptCode(null); setDeptResolved(true); return }
    setDeptResolved(false)
    supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) { setDeptCode(data?.code ?? null); setDeptResolved(true) } })
    return () => { cancelled = true }
  }, [profile?.department_id])

  if (!profile) return null
  // A non-admin with a department whose code is still resolving: render nothing
  // for that one fetch round-trip rather than flashing the wrong FALLBACK tabs.
  if (!isAdmin && profile.department_id && !deptResolved) return null

  const createActions = CREATE_ACTIONS.filter(a => canAccess(a.to))
  const hasCreate = createActions.length > 0
  const { left, right } = bottomNavLayout({ isAdmin, deptCode, canAccess, hasCreate })

  return (
    <>
      <nav className="bottom-nav">
        {left.map(t => <Tab key={t.to} tab={t} />)}
        {hasCreate && (
          <button type="button" className="bottom-nav-create" onClick={() => setCreateOpen(true)} aria-label="Quick actions">
            <Icon name="plus" size={26} color="#fff" />
          </button>
        )}
        {right.map(t => <Tab key={t.to} tab={t} />)}
      </nav>
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} actions={createActions} />
    </>
  )
}
