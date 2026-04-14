import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Skeleton from '../components/Skeleton'
import useFocusTrap from '../hooks/useFocusTrap'

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
  const toast = useToast()
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
    try {
      const { data, error: err } = await supabase.from('access_rules').select('*').order('route').order('id')
      if (err) toast.error(err.message)
      else setRules(data || [])
    } catch (e) {
      toast.error('Failed to load rules: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.route) { setError('Route is required.'); return }
    setError('')

    try {
      await callEdge('admin-access-rules', 'createRule', {
        route:            form.route,
        permission_level: form.permission_level || null,
        brand:            form.brand            || null,
        location:         form.location         || null,
        department:       form.department       || null,
        role:             form.role             || null,
      })
      setShowAdd(false)
      setForm({ route: '', permission_level: '', brand: '', location: '', department: '', role: '' })
      await loadRules()
      await refreshAccessRules()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    try {
      await callEdge('admin-access-rules', 'deleteRule', { id })
      await loadRules()
      await refreshAccessRules()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(null)
    }
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
                <label className="form-label" htmlFor="ar-route">Route *</label>
                <select id="ar-route" className="form-select" {...F('route')}>
                  <option value="">— Select route —</option>
                  {ALL_ROUTES.map(r => <option key={r.route} value={r.route}>{r.label} ({r.route})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-level">Permission Level</label>
                <select id="ar-level" className="form-select" {...F('permission_level')}>
                  <option value="">Any</option>
                  {PERMISSION_LEVELS.map(p => <option key={p} value={p}>{PERMISSION_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-brand">Brand</label>
                <select id="ar-brand" className="form-select" {...F('brand')}>
                  <option value="">Any</option>
                  {ref.brands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-location">Location</label>
                <select id="ar-location" className="form-select" {...F('location')}>
                  <option value="">Any</option>
                  {ref.locations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-department">Department</label>
                <select id="ar-department" className="form-select" {...F('department')}>
                  <option value="">Any</option>
                  {ref.departments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-role">Role</label>
                <select id="ar-role" className="form-select" {...F('role')}>
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
        <Skeleton variant="row" count={4} />
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
  const toast = useToast()
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState({})
  const [saving, setSaving]   = useState(null)
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
  }

  function isDirty(user) {
    const p = pending[user.id]
    if (!p) return false
    return Object.entries(p).some(([k, v]) => v !== (user[k] ?? ''))
  }

  async function save(user) {
    const changes = pending[user.id]
    if (!changes) return
    setSaving(user.id)

    const update = {}
    if (changes.role       !== undefined) update.role       = changes.role       || null
    if (changes.brand      !== undefined) update.brand      = changes.brand      || null
    if (changes.location   !== undefined) update.location   = changes.location   || null
    if (changes.department !== undefined) update.department = changes.department || null
    if (changes.vertical   !== undefined) update.vertical   = changes.vertical   || null

    try {
      await callEdge('admin-access-rules', 'updateUserPermissions', { id: user.id, update })
    } catch (err) {
      setSaving(null)
      toast.error(err.message)
      return
    }
    setSaving(null)
    toast.success(`${user.full_name} updated.`)
    setPending(p => { const n = { ...p }; delete n[user.id]; return n })
    await loadUsers()
  }

  function val(user, field) {
    return pending[user.id]?.[field] ?? (user[field] || '')
  }

  if (loading) return <Skeleton variant="row" count={4} />

  return (
    <div>
      <p className="ar-section-desc">Assign brand, location, department, role and permission level to each user. Changes to permission level take effect on their next login.</p>
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
          <label className="form-label" htmlFor={`ar-ref-${title.toLowerCase()}-name`}>{nameKey === 'code' ? 'Code' : 'Name'}</label>
          <input id={`ar-ref-${title.toLowerCase()}-name`} className="form-input" placeholder={addPlaceholder}
            value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        {labelKey && (
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}>
            <label className="form-label" htmlFor={`ar-ref-${title.toLowerCase()}-label`}>Label (display name)</label>
            <input id={`ar-ref-${title.toLowerCase()}-label`} className="form-input" placeholder="e.g. Long Haul"
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

  async function addBrand(code, name) {
    if (!name) return 'Display name is required.'
    try {
      await callEdge('admin-access-rules', 'addBrand', { code, name })
    } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleBrand(code, active) {
    try {
      await callEdge('admin-access-rules', 'toggleBrand', { code, is_active: active })
    } catch (e) { /* surfaced via RefTable next refresh */ }
    await load()
  }

  async function addRole(name, label) {
    if (!label) return 'Label is required.'
    try {
      await callEdge('admin-access-rules', 'addRole', { name, label })
    } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleRole(name, active) {
    try {
      await callEdge('admin-access-rules', 'toggleRole', { name, is_active: active })
    } catch (e) { /* surfaced via RefTable next refresh */ }
    await load()
  }

  async function addLocation(name) {
    try {
      await callEdge('admin-access-rules', 'addLocation', { name, state: '', entity: 'PT' })
    } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleLocation(name, active) {
    try {
      await callEdge('admin-access-rules', 'toggleLocation', { name, is_active: active })
    } catch (e) { /* surfaced via RefTable next refresh */ }
    await load()
  }

  async function addDept(name) {
    try {
      await callEdge('admin-access-rules', 'addDepartment', { name })
    } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleDept(name, active) {
    try {
      await callEdge('admin-access-rules', 'toggleDepartment', { name, is_active: active })
    } catch (e) { /* surfaced via RefTable next refresh */ }
    await load()
  }

  return (
    <div>
      <p className="ar-section-desc">Manage reference data used across the portal. Deactivating an item hides it from dropdowns but does not remove existing data.</p>
      <div className="ar-cfg-tabs">
        {[['brands','Brands'],['roles','Roles'],['locations','Locations'],['departments','Departments'],['ou','Operating Units']].map(([k,l]) => (
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
      {cfgTab === 'ou' && (
        <OperatingUnits brands={brands} locations={locations} />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   OPERATING UNITS (sub-component used inside ConfigTab)
══════════════════════════════════════════════════════════════ */
const OU_EMPTY = { brand: '', location: '', entity_code: '', full_name: '', address: '', gstin: '', bank_account: '', bank_name: '', bank_ifsc: '' }

function OperatingUnits({ brands, locations }) {
  const [units,   setUnits]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(null)   // null | 'add' | 'edit'
  const [form,    setForm]    = useState(OU_EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const trapRef = useFocusTrap(!!modal, closeModal)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('operating_units').select('*').order('brand').order('location')
    setUnits(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm(OU_EMPTY); setError(''); setModal('add')
  }
  function openEdit(ou) {
    setForm({ brand: ou.brand, location: ou.location, entity_code: ou.entity_code || '', full_name: ou.full_name || '', address: ou.address || '', gstin: ou.gstin || '', bank_account: ou.bank_account || '', bank_name: ou.bank_name || '', bank_ifsc: ou.bank_ifsc || '' })
    setError(''); setModal('edit')
  }
  function closeModal() { setModal(null); setError('') }

  const F = field => ({ value: form[field], onChange: e => setForm(f => ({ ...f, [field]: e.target.value })) })

  async function handleSave(e) {
    e.preventDefault()
    if (!form.brand || !form.location) { setError('Brand and Location are required.'); return }
    setSaving(true); setError('')

    const payload = {
      brand:        form.brand,
      location:     form.location,
      entity_code:  form.entity_code  || null,
      full_name:    form.full_name    || null,
      address:      form.address      || null,
      gstin:        form.gstin        || null,
      bank_account: form.bank_account || null,
      bank_name:    form.bank_name    || null,
      bank_ifsc:    form.bank_ifsc    || null,
    }

    try {
      if (modal === 'add') {
        await callEdge('admin-access-rules', 'createOperatingUnit', payload)
      } else {
        await callEdge('admin-access-rules', 'updateOperatingUnit', payload)
      }
    } catch (e) {
      setSaving(false)
      setError(e.message)
      return
    }

    setSaving(false)
    closeModal(); await load()
  }

  async function toggleActive(ou) {
    try {
      await callEdge('admin-access-rules', 'toggleOperatingUnit', { id: ou.id, is_active: !ou.is_active })
    } catch (e) { /* surfaced via load() */ }
    await load()
  }

  const brandName = code => brands.find(b => b.code === code)?.name || code

  return (
    <div>
      <div className="flex-between mb-24" style={{ flexWrap: 'wrap', gap: 12 }}>
        <p className="ar-section-desc" style={{ margin: 0 }}>
          Each operating unit defines entity details (letterhead, bank, GSTIN) used in quotation PDFs for a specific brand + location combination.
        </p>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Operating Unit</button>
      </div>

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Location</th>
                <th>Entity Code</th>
                <th>Company Name</th>
                <th>GSTIN</th>
                <th>Bank</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {units.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 32 }}>No operating units defined.</td></tr>
              )}
              {units.map(ou => (
                <tr key={ou.id}>
                  <td><span className="ar-chip">{brandName(ou.brand)}</span></td>
                  <td style={{ fontWeight: 600 }}>{ou.location}</td>
                  <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{ou.entity_code || '—'}</td>
                  <td style={{ fontSize: 13 }}>{ou.full_name || <span style={{ color: 'var(--gray-300)' }}>Not set</span>}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{ou.gstin || '—'}</td>
                  <td style={{ fontSize: 12 }}>{ou.bank_name ? ou.bank_name.slice(0, 24) + (ou.bank_name.length > 24 ? '…' : '') : <span style={{ color: 'var(--gray-300)' }}>Not set</span>}</td>
                  <td><span className={`badge ${ou.is_active ? 'badge-green' : 'badge-gray'}`}>{ou.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(ou)}>Edit</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(ou)}>{ou.is_active ? 'Deactivate' : 'Activate'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" ref={trapRef} tabIndex={-1} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>{modal === 'add' ? 'Add Operating Unit' : `Edit — ${form.brand.toUpperCase()} · ${form.location}`}</h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>⚠</span><span>{error}</span></div>}
              <form onSubmit={handleSave} noValidate>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-brand">Brand *</label>
                    <select id="ou-brand" className="form-select" {...F('brand')} disabled={modal === 'edit'}>
                      <option value="">— Select —</option>
                      {brands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-location">Location *</label>
                    <select id="ou-location" className="form-select" {...F('location')} disabled={modal === 'edit'}>
                      <option value="">— Select —</option>
                      {locations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-entity-code">Entity Code</label>
                    <select id="ou-entity-code" className="form-select" {...F('entity_code')}>
                      <option value="">— Select —</option>
                      <option value="PTB">PTB — Gujarat</option>
                      <option value="PT">PT — Haryana</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-full-name">Company Full Name</label>
                    <input id="ou-full-name" className="form-input" placeholder="PARAS TRUCKS AND BUSES" {...F('full_name')} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="ou-address">Address</label>
                  <input id="ou-address" className="form-input" placeholder="Survey No. …" {...F('address')} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-gstin">GSTIN</label>
                    <input id="ou-gstin" className="form-input" placeholder="24ABCDE1234F1Z5" {...F('gstin')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-bank-account">Bank Account No.</label>
                    <input id="ou-bank-account" className="form-input" placeholder="50200012345678" {...F('bank_account')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-bank-name">Bank Name</label>
                    <input id="ou-bank-name" className="form-input" placeholder="Punjab National Bank" {...F('bank_name')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="ou-bank-ifsc">IFSC Code</label>
                    <input id="ou-bank-ifsc" className="form-input" placeholder="PUNB0123456" {...F('bank_ifsc')} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <span className="spinner spinner-sm" /> : modal === 'add' ? 'Add Unit' : 'Save Changes'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   TAB 4 — ERROR LOG VIEWER (admin-only, gated at route level)
══════════════════════════════════════════════════════════════ */
function ErrorsTab() {
  const toast = useToast()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const closeDetail = useCallback(() => setSelected(null), [])
  const trapRef = useFocusTrap(!!selected, closeDetail)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const { data, error: err } = await supabase
          .from('error_log')
          .select('id, created_at, user_id, url, message, stack, context, user:users(full_name, email)')
          .order('created_at', { ascending: false })
          .limit(100)
        if (cancelled) return
        if (err) toast.error(err.message)
        else setRows(data || [])
      } catch (e) {
        if (!cancelled) toast.error('Failed to load errors: ' + e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const truncate = (s, n = 120) => (s && s.length > n ? s.slice(0, n) + '…' : s || '')
  const userLabel = r => r.user?.full_name || r.user?.email || '—'

  return (
    <div>
      <p className="ar-section-desc">
        Most recent 100 client-side errors reported via the <code>log-error</code> edge function. Click a row to see the full stack trace and context.
      </p>

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>URL</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 32 }}>No errors logged.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={{ fontSize: 13 }}>{userLabel(r)}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }} title={r.url || ''}>{truncate(r.url, 48)}</td>
                  <td style={{ fontSize: 13 }} title={r.message || ''}>{truncate(r.message, 120)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeDetail()}>
          <div className="modal" ref={trapRef} tabIndex={-1} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h2>Error Detail</h2>
              <button className="modal-close" onClick={closeDetail}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 12 }}>
                {new Date(selected.created_at).toLocaleString()} · {userLabel(selected)}
                {selected.url && <> · <code>{selected.url}</code></>}
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.message || '—'}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Stack</label>
                <pre style={{ background: 'var(--gray-50)', padding: 12, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 280, whiteSpace: 'pre-wrap' }}>
                  {selected.stack || '(no stack captured)'}
                </pre>
              </div>
              <div className="form-group">
                <label className="form-label">Context</label>
                <pre style={{ background: 'var(--gray-50)', padding: 12, borderRadius: 4, fontSize: 11, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
                  {selected.context ? JSON.stringify(selected.context, null, 2) : '(none)'}
                </pre>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={closeDetail}>Close</button>
              </div>
            </div>
          </div>
        </div>
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
        {[['rules','Access Rules'],['users','User Permissions'],['config','Configuration'],['errors','Errors']].map(([k,l]) => (
          <button key={k} className={`ar-tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="ar-tab-body">
        {tab === 'rules'  && <RulesTab accessRules={accessRules} refreshAccessRules={refreshAccessRules} />}
        {tab === 'users'  && <UserPermissionsTab />}
        {tab === 'config' && <ConfigTab />}
        {tab === 'errors' && <ErrorsTab />}
      </div>
    </div>
  )
}
