import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PERMISSION_LEVELS = ['admin', 'hr', 'back_office', 'sales']
const PERMISSION_LABEL  = { admin: 'Admin', hr: 'HR', back_office: 'Back Office', sales: 'Sales' }
const PERMISSION_BADGE  = { admin: 'badge-red', hr: 'badge-amber', back_office: 'badge-blue', sales: 'badge-green' }

const ALL_ROUTES = [
  { route: '/quotation',      label: 'New Quotation'   },
  { route: '/my-quotations',  label: 'My Quotations'   },
  { route: '/quotation-log',  label: 'Quotation Log'   },
  { route: '/employees',      label: 'Employees'       },
  { route: '/catalog',        label: 'Vehicle Catalog' },
  { route: '/bus-calculator', label: 'Bus Calculator'  },
]

function Val({ v }) {
  return v
    ? <span className="ar-chip">{v}</span>
    : <span className="ar-any">any</span>
}

function useRefData() {
  const [brands,      setBrands]      = useState([])
  const [locations,   setLocations]   = useState([])
  const [departments, setDepartments] = useState([])
  const [roles,       setRoles]       = useState([])

  const load = useCallback(async () => {
    const [b, l, d, r] = await Promise.all([
      supabase.from('brands').select('code,name').eq('is_active', true).order('name'),
      supabase.from('locations').select('name').eq('is_active', true).order('name'),
      supabase.from('departments').select('name').eq('is_active', true).order('name'),
      supabase.from('roles').select('name,label').eq('is_active', true).order('label'),
    ])
    setBrands(b.data || [])
    setLocations(l.data || [])
    setDepartments(d.data || [])
    setRoles(r.data || [])
  }, [])

  useEffect(() => { load() }, [load])

  return { brands, locations, departments, roles, reload: load }
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — ACCESS RULES
══════════════════════════════════════════════════════════════ */
function RulesTab({ accessRules, refreshAccessRules }) {
  const ref = useRefData()
  const [rules, setRules]   = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError]   = useState('')

  const [form, setForm] = useState({
    route: '', permission_level: '', brand: '', location: '', department: '', role: '',
  })

  const loadRules = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('access_rules').select('*').order('route').order('id')
    setRules(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.route) { setError('Route is required.'); return }
    if (!supabaseAdmin) { setError('Service key not configured.'); return }
    setError('')

    const payload = {
      route:            form.route,
      permission_level: form.permission_level || null,
      brand:            form.brand            || null,
      location:         form.location         || null,
      department:       form.department       || null,
      role:             form.role             || null,
    }
    const { error: err } = await supabaseAdmin.from('access_rules').insert(payload)
    if (err) { setError(err.message); return }
    setShowAdd(false)
    setForm({ route: '', permission_level: '', brand: '', location: '', department: '', role: '' })
    await loadRules()
    await refreshAccessRules()
  }

  async function handleDelete(id) {
    if (!supabaseAdmin) { setError('Service key not configured.'); return }
    setDeleting(id)
    await supabaseAdmin.from('access_rules').delete().eq('id', id)
    setDeleting(null)
    await loadRules()
    await refreshAccessRules()
  }

  const F = field => ({
    value: form[field],
    onChange: e => setForm(f => ({ ...f, [field]: e.target.value })),
  })

  return (
    <div>
      <div className="flex-between mb-24" style={{ flexWrap: 'wrap', gap: 12 }}>
        <p className="ar-section-desc" style={{ margin: 0 }}>
          Each rule grants access to a route for users matching all specified attributes. Leave a field blank to match any value.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(true); setError('') }}>
          + Add Rule
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span><span>{error}</span></div>}

      {/* Add rule form */}
      {showAdd && (
        <div className="ar-add-form">
          <h3 style={{ marginBottom: 12, fontSize: 14 }}>New Access Rule</h3>
          <form onSubmit={handleAdd}>
            <div className="ar-form-grid">
              <div className="form-group">
                <label className="form-label">Route *</label>
                <select className="form-select" {...F('route')}>
                  <option value="">— Select route —</option>
                  {ALL_ROUTES.map(r => <option key={r.route} value={r.route}>{r.label} ({r.route})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Permission Level</label>
                <select className="form-select" {...F('permission_level')}>
                  <option value="">Any</option>
                  {PERMISSION_LEVELS.map(p => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Brand</label>
                <select className="form-select" {...F('brand')}>
                  <option value="">Any</option>
                  {ref.brands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Location</label>
                <select className="form-select" {...F('location')}>
                  <option value="">Any</option>
                  {ref.locations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Department</label>
                <select className="form-select" {...F('department')}>
                  <option value="">Any</option>
                  {ref.departments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-select" {...F('role')}>
                  <option value="">Any</option>
                  {ref.roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary btn-sm">Add Rule</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Permission Level</th>
                <th>Brand</th>
                <th>Location</th>
                <th>Department</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 32 }}>No rules defined.</td></tr>
              ) : rules.map(rule => (
                <tr key={rule.id}>
                  <td><code style={{ fontSize: 12 }}>{rule.route}</code></td>
                  <td>{rule.permission_level
                    ? <span className={`badge ${PERMISSION_BADGE[rule.permission_level] || 'badge-gray'}`}>{PERMISSION_LABEL[rule.permission_level] || rule.permission_level}</span>
                    : <span className="ar-any">any</span>}
                  </td>
                  <td><Val v={rule.brand} /></td>
                  <td><Val v={rule.location} /></td>
                  <td><Val v={rule.department} /></td>
                  <td><Val v={rule.role} /></td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(rule.id)}
                      disabled={deleting === rule.id}
                    >
                      {deleting === rule.id ? <span className="spinner spinner-sm" /> : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — USER PERMISSIONS
══════════════════════════════════════════════════════════════ */
function UserPermissionsTab() {
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState({})
  const [saving, setSaving]   = useState(null)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const { profile: self }     = useAuth()
  const ref = useRefData()

  const loadUsers = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('users')
      .select('id,full_name,entity,role,brand,location,department,vertical,is_active')
      .order('full_name')
    setUsers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  function set(userId, field, value) {
    setPending(p => ({ ...p, [userId]: { ...(p[userId] || {}), [field]: value } }))
    setError(''); setSuccess('')
  }

  function isDirty(user) {
    const p = pending[user.id]
    if (!p) return false
    return Object.entries(p).some(([k, v]) => v !== (user[k] ?? ''))
  }

  async function save(user) {
    const changes = pending[user.id]
    if (!changes) return
    setSaving(user.id); setError('')

    const update = {}
    if (changes.role       !== undefined) update.role       = changes.role       || null
    if (changes.brand      !== undefined) update.brand      = changes.brand      || null
    if (changes.location   !== undefined) update.location   = changes.location   || null
    if (changes.department !== undefined) update.department = changes.department || null
    if (changes.vertical   !== undefined) update.vertical   = changes.vertical   || null

    const { error: err } = await supabase.from('users').update(update).eq('id', user.id)
    setSaving(null)
    if (err) { setError(err.message); return }
    setSuccess(`${user.full_name} updated.`)
    setPending(p => { const n = { ...p }; delete n[user.id]; return n })
    await loadUsers()
    setTimeout(() => setSuccess(''), 3000)
  }

  function val(user, field) {
    return pending[user.id]?.[field] ?? (user[field] || '')
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>

  return (
    <div>
      <p className="ar-section-desc">Assign brand, location, department, role and permission level to each user. Changes to permission level take effect on their next login.</p>
      {error   && <div className="alert alert-error"   style={{ marginBottom: 16 }}><span>⚠</span><span>{error}</span></div>}
      {success && <div className="alert alert-success" style={{ marginBottom: 16 }}><span>✓</span><span>{success}</span></div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Permission Level</th>
              <th>Brand</th>
              <th>Location</th>
              <th>Department</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className={!user.is_active ? 'ar-inactive-row' : ''}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                    {user.full_name}
                    {user.id === self?.id && <span className="ar-self-tag">you</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{user.entity}</div>
                </td>
                <td>
                  <select className="form-select ar-role-select"
                    value={val(user, 'role')}
                    onChange={e => set(user.id, 'role', e.target.value)}
                    disabled={saving === user.id}>
                    {PERMISSION_LEVELS.map(p => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
                  </select>
                </td>
                <td>
                  <select className="form-select ar-role-select"
                    value={val(user, 'brand')}
                    onChange={e => set(user.id, 'brand', e.target.value)}
                    disabled={saving === user.id}>
                    <option value="">—</option>
                    {ref.brands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </select>
                </td>
                <td>
                  <select className="form-select ar-role-select"
                    value={val(user, 'location')}
                    onChange={e => set(user.id, 'location', e.target.value)}
                    disabled={saving === user.id}>
                    <option value="">—</option>
                    {ref.locations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </td>
                <td>
                  <select className="form-select ar-role-select"
                    value={val(user, 'department')}
                    onChange={e => set(user.id, 'department', e.target.value)}
                    disabled={saving === user.id}>
                    <option value="">—</option>
                    {ref.departments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                  </select>
                </td>
                <td>
                  <select className="form-select ar-role-select"
                    value={val(user, 'vertical')}
                    onChange={e => set(user.id, 'vertical', e.target.value)}
                    disabled={saving === user.id}>
                    <option value="">—</option>
                    {ref.roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                  </select>
                </td>
                <td>
                  {isDirty(user) && (
                    <button className="btn btn-primary btn-sm"
                      onClick={() => save(user)}
                      disabled={saving === user.id}>
                      {saving === user.id ? <span className="spinner spinner-sm" /> : 'Save'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   TAB 3 — CONFIGURATION (Brands / Roles / Locations / Departments)
══════════════════════════════════════════════════════════════ */
function RefTable({ title, items, onAdd, onToggle, addPlaceholder, nameKey = 'name', labelKey = null, extraFields = null }) {
  const [newName,  setNewName]  = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true); setError('')
    const err = await onAdd(newName.trim(), newLabel.trim())
    setSaving(false)
    if (err) { setError(err); return }
    setNewName(''); setNewLabel('')
  }

  return (
    <div className="ar-ref-table">
      <h3 className="ar-ref-title">{title}</h3>
      {error && <div className="alert alert-error" style={{ marginBottom: 10, padding: '6px 10px' }}><span>⚠</span><span style={{ fontSize: 12 }}>{error}</span></div>}
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{nameKey === 'code' ? 'Code' : 'Name'}</th>
              {labelKey && <th>Label</th>}
              {extraFields && extraFields.map(f => <th key={f.key}>{f.label}</th>)}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 20 }}>None yet.</td></tr>
            )}
            {items.map(item => (
              <tr key={item[nameKey]}>
                <td style={{ fontWeight: 600 }}>{item[nameKey]}</td>
                {labelKey && <td>{item[labelKey]}</td>}
                {extraFields && extraFields.map(f => <td key={f.key} style={{ fontSize: 12, color: 'var(--gray-500)' }}>{item[f.key] || '—'}</td>)}
                <td><span className={`badge ${item.is_active ? 'badge-green' : 'badge-gray'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button className={`btn btn-sm ${item.is_active ? 'btn-secondary' : 'btn-secondary'}`}
                    onClick={() => onToggle(item[nameKey], !item.is_active)}>
                    {item.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
          <label className="form-label">{nameKey === 'code' ? 'Code' : 'Name'}</label>
          <input className="form-input" placeholder={addPlaceholder}
            value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        {labelKey && (
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label className="form-label">Label (display name)</label>
            <input className="form-input" placeholder="e.g. Long Haul"
              value={newLabel} onChange={e => setNewLabel(e.target.value)} />
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !newName.trim()}>
          {saving ? <span className="spinner spinner-sm" /> : `Add ${title.replace(/s$/, '')}`}
        </button>
      </form>
    </div>
  )
}

function ConfigTab() {
  const [brands,      setBrands]      = useState([])
  const [roles,       setRoles]       = useState([])
  const [locations,   setLocations]   = useState([])
  const [departments, setDepartments] = useState([])
  const [cfgTab,      setCfgTab]      = useState('brands')

  const load = useCallback(async () => {
    const [b, r, l, d] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('roles').select('*').order('label'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('departments').select('*').order('name'),
    ])
    setBrands(b.data || [])
    setRoles(r.data || [])
    setLocations(l.data || [])
    setDepartments(d.data || [])
  }, [])

  useEffect(() => { load() }, [load])

  if (!supabaseAdmin) {
    return (
      <div className="alert alert-error"><span>⚠</span>
        <span>Service key not configured. Add VITE_SUPABASE_SERVICE_KEY to your .env file to manage reference data.</span>
      </div>
    )
  }

  async function addBrand(code, name) {
    if (!name) return 'Display name is required.'
    const { error } = await supabaseAdmin.from('brands').insert({ code, name })
    if (error) return error.message
    await load(); return null
  }
  async function toggleBrand(code, active) {
    await supabaseAdmin.from('brands').update({ is_active: active }).eq('code', code)
    await load()
  }

  async function addRole(name, label) {
    if (!label) return 'Label is required.'
    const { error } = await supabaseAdmin.from('roles').insert({ name, label })
    if (error) return error.message
    await load(); return null
  }
  async function toggleRole(name, active) {
    await supabaseAdmin.from('roles').update({ is_active: active }).eq('name', name)
    await load()
  }

  async function addLocation(name) {
    const { error } = await supabaseAdmin.from('locations').insert({ name, state: '', entity: 'PT' })
    if (error) return error.message
    await load(); return null
  }
  async function toggleLocation(name, active) {
    await supabaseAdmin.from('locations').update({ is_active: active }).eq('name', name)
    await load()
  }

  async function addDept(name) {
    const { error } = await supabaseAdmin.from('departments').insert({ name })
    if (error) return error.message
    await load(); return null
  }
  async function toggleDept(name, active) {
    await supabaseAdmin.from('departments').update({ is_active: active }).eq('name', name)
    await load()
  }

  return (
    <div>
      <p className="ar-section-desc">Manage reference data used across the portal. Deactivating an item hides it from dropdowns but does not remove existing data.</p>
      <div className="ar-cfg-tabs">
        {[['brands','Brands'],['roles','Roles'],['locations','Locations'],['departments','Departments']].map(([k,l]) => (
          <button key={k} className={`ar-cfg-tab ${cfgTab===k?'active':''}`} onClick={() => setCfgTab(k)}>{l}</button>
        ))}
      </div>

      {cfgTab === 'brands' && (
        <RefTable
          title="Brands"
          items={brands}
          nameKey="code"
          labelKey="name"
          addPlaceholder="e.g. hdh"
          onAdd={addBrand}
          onToggle={toggleBrand}
          extraFields={[{ key: 'logo_path', label: 'Logo Path' }]}
        />
      )}
      {cfgTab === 'roles' && (
        <RefTable
          title="Roles"
          items={roles}
          nameKey="name"
          labelKey="label"
          addPlaceholder="e.g. long_haul"
          onAdd={addRole}
          onToggle={toggleRole}
        />
      )}
      {cfgTab === 'locations' && (
        <RefTable
          title="Locations"
          items={locations}
          nameKey="name"
          addPlaceholder="e.g. Panipat"
          onAdd={addLocation}
          onToggle={toggleLocation}
          extraFields={[{ key: 'state', label: 'State' }, { key: 'entity', label: 'Entity' }]}
        />
      )}
      {cfgTab === 'departments' && (
        <RefTable
          title="Departments"
          items={departments}
          nameKey="name"
          addPlaceholder="e.g. Finance"
          onAdd={addDept}
          onToggle={toggleDept}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function AccessRules() {
  const { accessRules, refreshAccessRules } = useAuth()
  const [tab, setTab] = useState('rules')

  return (
    <div>
      <div className="page-header">
        <h1>Access Rules</h1>
        <p>Define who can access each tool, manage user permissions, and configure reference data.</p>
      </div>

      <div className="ar-tabs">
        {[['rules','Access Rules'],['users','User Permissions'],['config','Configuration']].map(([k,l]) => (
          <button key={k} className={`ar-tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="ar-tab-body">
        {tab === 'rules'  && <RulesTab accessRules={accessRules} refreshAccessRules={refreshAccessRules} />}
        {tab === 'users'  && <UserPermissionsTab />}
        {tab === 'config' && <ConfigTab />}
      </div>
    </div>
  )
}
