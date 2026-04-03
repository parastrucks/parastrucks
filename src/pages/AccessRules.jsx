import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ROLES = ['sales', 'back_office', 'hr', 'admin']
const ROLE_LABEL = { sales: 'Sales', back_office: 'Back Office', hr: 'HR', admin: 'Admin' }
const ROLE_BADGE = { admin: 'badge-red', hr: 'badge-amber', back_office: 'badge-blue', sales: 'badge-green' }

// Pages whose access can be configured. /access-rules is always admin-only and not editable.
const PAGES = [
  { route: '/quotation',      label: 'New Quotation',    icon: '📄' },
  { route: '/my-quotations',  label: 'My Quotations',    icon: '🗂' },
  { route: '/quotation-log',  label: 'Quotation Log',    icon: '📊' },
  { route: '/employees',      label: 'Employees',        icon: '👥' },
  { route: '/catalog',        label: 'Vehicle Catalog',  icon: '🚛' },
  { route: '/bus-calculator', label: 'Bus Calculator',   icon: '🚌' },
]

function RoleBadge({ role }) {
  return <span className={`badge ${ROLE_BADGE[role] || 'badge-gray'}`}>{ROLE_LABEL[role] || role}</span>
}

/* ══════════════════════════════════════════════════════════════
   PAGE PERMISSIONS TAB
══════════════════════════════════════════════════════════════ */
function PermissionsMatrix({ accessRules, refreshAccessRules }) {
  const [toggling, setToggling] = useState(null) // 'route:role' while saving
  const [error, setError] = useState('')

  const hasAccess = (route, role) => (accessRules?.[route] || []).includes(role)

  async function toggle(route, role) {
    if (!supabaseAdmin) {
      setError('Service key not configured. Add VITE_SUPABASE_SERVICE_KEY to your .env file.')
      return
    }
    const key = `${route}:${role}`
    setToggling(key)
    setError('')

    if (hasAccess(route, role)) {
      // Remove access
      const { error: err } = await supabaseAdmin
        .from('access_rules')
        .delete()
        .eq('route', route)
        .eq('role', role)
      if (err) { setError(err.message); setToggling(null); return }
    } else {
      // Grant access
      const { error: err } = await supabaseAdmin
        .from('access_rules')
        .insert({ route, role })
      if (err) { setError(err.message); setToggling(null); return }
    }

    await refreshAccessRules()
    setToggling(null)
  }

  return (
    <div>
      <p className="ar-section-desc">
        Toggle which roles can access each page. Changes take effect immediately for new sessions.
        Users already logged in will see the update on next page load.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>⚠</span><span>{error}</span>
        </div>
      )}

      <div className="table-wrap">
        <table className="ar-matrix">
          <thead>
            <tr>
              <th>Page</th>
              {ROLES.map(r => (
                <th key={r} className="ar-role-col">
                  <RoleBadge role={r} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGES.map(page => (
              <tr key={page.route}>
                <td className="ar-page-cell">
                  <span className="ar-page-icon">{page.icon}</span>
                  <span className="ar-page-label">{page.label}</span>
                  <span className="ar-page-route">{page.route}</span>
                </td>
                {ROLES.map(role => {
                  const key = `${page.route}:${role}`
                  const checked = hasAccess(page.route, role)
                  const busy = toggling === key
                  return (
                    <td key={role} className="ar-check-cell">
                      {busy ? (
                        <span className="spinner spinner-sm" />
                      ) : (
                        <input
                          type="checkbox"
                          className="ar-checkbox"
                          checked={checked}
                          onChange={() => toggle(page.route, role)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* /access-rules row — always admin-only, read-only */}
            <tr className="ar-locked-row">
              <td className="ar-page-cell">
                <span className="ar-page-icon">🔐</span>
                <span className="ar-page-label">Access Rules</span>
                <span className="ar-page-route">/access-rules</span>
              </td>
              {ROLES.map(role => (
                <td key={role} className="ar-check-cell">
                  {role === 'admin'
                    ? <span className="ar-lock" title="Always admin-only">🔒</span>
                    : <span className="ar-dash">—</span>
                  }
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   USER ROLES TAB
══════════════════════════════════════════════════════════════ */
function UserRoles() {
  const { profile: currentUser } = useAuth()
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(null) // user id being saved
  const [pending, setPending] = useState({})   // { userId: newRole }
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('users')
      .select('id, full_name, entity, role, designation, is_active')
      .order('full_name')
    setUsers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  function handleRoleChange(userId, newRole) {
    setPending(p => ({ ...p, [userId]: newRole }))
    setError('')
    setSuccess('')
  }

  async function saveRole(user) {
    const newRole = pending[user.id]
    if (!newRole || newRole === user.role) return

    setSaving(user.id)
    setError('')

    const { error: err } = await supabase
      .from('users')
      .update({ role: newRole })
      .eq('id', user.id)

    setSaving(null)
    if (err) { setError(err.message); return }

    setSuccess(`${user.full_name}'s role updated to ${ROLE_LABEL[newRole]}.`)
    setPending(p => { const n = { ...p }; delete n[user.id]; return n })
    await fetchUsers()
    setTimeout(() => setSuccess(''), 3000)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <p className="ar-section-desc">
        Change the role assigned to each team member. Role changes take effect on their next login.
      </p>

      {error   && <div className="alert alert-error"   style={{ marginBottom: 16 }}><span>⚠</span><span>{error}</span></div>}
      {success && <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✓</span><span>{success}</span></div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Entity</th>
              <th>Designation</th>
              <th>Current Role</th>
              <th>Change Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => {
              const isSelf    = user.id === currentUser?.id
              const pendRole  = pending[user.id]
              const isDirty   = pendRole && pendRole !== user.role
              const isSaving  = saving === user.id

              return (
                <tr key={user.id} className={!user.is_active ? 'ar-inactive-row' : ''}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                      {user.full_name}
                      {isSelf && <span className="ar-self-tag">you</span>}
                    </div>
                  </td>
                  <td><span className="badge badge-blue">{user.entity}</span></td>
                  <td style={{ fontSize: 13, color: 'var(--gray-500)' }}>{user.designation || '—'}</td>
                  <td><RoleBadge role={user.role} /></td>
                  <td>
                    <select
                      className="form-select ar-role-select"
                      value={pendRole ?? user.role}
                      onChange={e => handleRoleChange(user.id, e.target.value)}
                      disabled={isSaving}
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {isDirty && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => saveRole(user)}
                        disabled={isSaving}
                      >
                        {isSaving ? <span className="spinner spinner-sm" /> : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function AccessRules() {
  const { accessRules, refreshAccessRules } = useAuth()
  const [tab, setTab] = useState('permissions')

  return (
    <div>
      <div className="page-header">
        <h1>Access Rules</h1>
        <p>Control which roles can access each page, and manage user role assignments.</p>
      </div>

      <div className="ar-tabs">
        <button
          className={`ar-tab ${tab === 'permissions' ? 'active' : ''}`}
          onClick={() => setTab('permissions')}
        >
          Page Permissions
        </button>
        <button
          className={`ar-tab ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          User Roles
        </button>
      </div>

      <div className="ar-tab-body">
        {tab === 'permissions' && (
          <PermissionsMatrix
            accessRules={accessRules}
            refreshAccessRules={refreshAccessRules}
          />
        )}
        {tab === 'users' && <UserRoles />}
      </div>
    </div>
  )
}
