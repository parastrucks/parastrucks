import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Skeleton from '../components/Skeleton'
import useFocusTrap from '../hooks/useFocusTrap'

// Phase 6c.1: new tier vocabulary. Admin never appears in rule rows — admin
// bypass is hard-coded in AuthContext.canAccess. Rule tiers are gm/manager/executive.
const RULE_TIERS = ['gm', 'manager', 'executive']
const TIER_LABEL = { admin: 'Admin', gm: 'GM', manager: 'Manager', executive: 'Executive' }
const TIER_BADGE = { admin: 'badge-red', gm: 'badge-purple', manager: 'badge-blue', executive: 'badge-green' }

const ALL_ROUTES = [
  { route: '/quotation',      label: 'New Quotation'   },
  { route: '/my-quotations',  label: 'My Quotations'   },
  { route: '/quotation-log',  label: 'Quotation Log'   },
  { route: '/employees',      label: 'Employees'       },
  { route: '/catalog',        label: 'Vehicle Catalog' },
  { route: '/bus-calculator', label: 'Bus Calculator'  },
  { route: '/tiv-forecast',   label: 'TIV Forecast'    },
]

/* ══════════════════════════════════════════════════════════════
   TAB 1 — ACCESS RULES (4-axis)
   Route × permission_level × entity × department (+ optional designation)
══════════════════════════════════════════════════════════════ */
function RulesTab({ refreshAccessRules }) {
  const toast = useToast()
  const [rules, setRules]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [showAdd, setShowAdd]       = useState(false)
  const [deleting, setDeleting]     = useState(null)
  const [error, setError]           = useState('')
  const [refEntities, setRefEntities]   = useState([])
  const [refDepartments, setRefDepartments] = useState([])
  const [refDesignations, setRefDesignations] = useState([])

  const [form, setForm] = useState({
    route: '', permission_level: 'executive',
    entity_id: '', department_id: '', designation_id: '',
  })

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [r, e, d, dg] = await Promise.all([
        supabase.from('access_rules').select('*').order('route').order('id'),
        supabase.from('entities').select('id, code').order('code'),
        supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
        supabase.from('designations').select('id, department_id, code, name').eq('is_active', true).order('name'),
      ])
      if (r.error) toast.error(r.error.message)
      else setRules(r.data || [])
      setRefEntities(e.data || [])
      setRefDepartments(d.data || [])
      setRefDesignations(dg.data || [])
    } catch (e) {
      toast.error('Failed to load rules: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadAll() }, [loadAll])

  const entityById = useMemo(() => Object.fromEntries(refEntities.map(e => [e.id, e])), [refEntities])
  const deptById   = useMemo(() => Object.fromEntries(refDepartments.map(d => [d.id, d])), [refDepartments])
  const desById    = useMemo(() => Object.fromEntries(refDesignations.map(d => [d.id, d])), [refDesignations])
  const designationsForDept = useMemo(
    () => refDesignations.filter(d => d.department_id === form.department_id),
    [refDesignations, form.department_id],
  )

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    if (!form.route)         { setError('Route is required.'); return }
    if (!form.entity_id)     { setError('Entity is required.'); return }
    if (!form.department_id) { setError('Department is required.'); return }

    try {
      await callEdge('admin-access-rules', 'createRule', {
        route:            form.route,
        permission_level: form.permission_level,
        entity_id:        form.entity_id,
        department_id:    form.department_id,
        designation_id:   form.designation_id || null,
      })
      setShowAdd(false)
      setForm({ route: '', permission_level: 'executive', entity_id: '', department_id: '', designation_id: '' })
      await loadAll()
      await refreshAccessRules()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    try {
      await callEdge('admin-access-rules', 'deleteRule', { id })
      await loadAll()
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
          Each rule grants route access to users matching all 3 required axes (permission level × entity × department). Designation is optional — NULL means "any designation in this department". Admin bypasses every rule.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(true); setError('') }}>
          + Add Rule
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><span>⚠</span><span>{error}</span></div>}

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
                <label className="form-label" htmlFor="ar-level">Permission Level *</label>
                <select id="ar-level" className="form-select" {...F('permission_level')}>
                  {RULE_TIERS.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-entity">Entity *</label>
                <select id="ar-entity" className="form-select" {...F('entity_id')}>
                  <option value="">— Select —</option>
                  {refEntities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-department">Department *</label>
                <select id="ar-department" className="form-select"
                  value={form.department_id}
                  onChange={e => setForm(f => ({ ...f, department_id: e.target.value, designation_id: '' }))}>
                  <option value="">— Select —</option>
                  {refDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="ar-designation">Designation</label>
                <select id="ar-designation" className="form-select"
                  value={form.designation_id}
                  onChange={e => setForm(f => ({ ...f, designation_id: e.target.value }))}
                  disabled={!form.department_id}>
                  <option value="">Any (within department)</option>
                  {designationsForDept.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
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
                <th>Entity</th>
                <th>Department</th>
                <th>Designation</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 32 }}>No rules defined.</td></tr>
              ) : rules.map(rule => (
                <tr key={rule.id}>
                  <td><code style={{ fontSize: 12 }}>{rule.route}</code></td>
                  <td>
                    <span className={`badge ${TIER_BADGE[rule.permission_level] || 'badge-gray'}`}>
                      {TIER_LABEL[rule.permission_level] || rule.permission_level || '—'}
                    </span>
                  </td>
                  <td>{entityById[rule.entity_id]?.code || <span className="ar-any">—</span>}</td>
                  <td>{deptById[rule.department_id]?.name || <span className="ar-any">—</span>}</td>
                  <td>{rule.designation_id ? (desById[rule.designation_id]?.name || '?') : <span className="ar-any">any</span>}</td>
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
   TAB 2 — ENTITIES (GM pointers) — Phase 6c.1 new tab
   Assign GM Service / GM Spares / GM Back Office per entity. Used by
   quotation notifications, escalation paths, and later-phase reporting.
══════════════════════════════════════════════════════════════ */
function EntitiesTab() {
  const toast = useToast()
  const [entities, setEntities]       = useState([])
  const [gmCandidates, setGmCandidates] = useState([]) // all active users with permission_level='gm'
  const [saving, setSaving]           = useState(null)
  const [loading, setLoading]         = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [e, u] = await Promise.all([
      supabase.from('entities').select('id, code, gm_service_user_id, gm_spares_user_id, gm_backoffice_user_id').order('code'),
      supabase.from('users').select('id, full_name, entity_id, permission_level, department_id').eq('permission_level', 'gm').eq('is_active', true).order('full_name'),
    ])
    setEntities(e.data || [])
    setGmCandidates(u.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(entity_id, field, value) {
    setSaving(`${entity_id}:${field}`)
    try {
      await callEdge('admin-access-rules', 'updateEntityGMs', {
        entity_id,
        [field]: value || null,
      })
      toast.success('Updated.')
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <Skeleton variant="row" count={2} />

  return (
    <div>
      <p className="ar-section-desc">
        GM pointers per entity. Only users with permission level = <strong>GM</strong> assigned to the matching entity are eligible. Leave blank to clear — GM Spares falls back to GM Service at the app layer when unset.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>GM Service</th>
              <th>GM Spares</th>
              <th>GM Back Office</th>
            </tr>
          </thead>
          <tbody>
            {entities.map(ent => {
              const candidatesForEntity = gmCandidates.filter(u => u.entity_id === ent.id)
              return (
                <tr key={ent.id}>
                  <td style={{ fontWeight: 700 }}>{ent.code}</td>
                  <GMPicker label="GM Service"
                    entity_id={ent.id} field="gm_service_user_id" current={ent.gm_service_user_id}
                    options={candidatesForEntity} onSave={save} saving={saving} />
                  <GMPicker label="GM Spares"
                    entity_id={ent.id} field="gm_spares_user_id" current={ent.gm_spares_user_id}
                    options={candidatesForEntity} onSave={save} saving={saving} />
                  <GMPicker label="GM Back Office"
                    entity_id={ent.id} field="gm_backoffice_user_id" current={ent.gm_backoffice_user_id}
                    options={candidatesForEntity} onSave={save} saving={saving} />
                </tr>
              )
            })}
            {entities.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--gray-400)', padding: 32 }}>No entities configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GMPicker({ entity_id, field, current, options, onSave, saving }) {
  const busy = saving === `${entity_id}:${field}`
  return (
    <td>
      <select
        className="form-select"
        value={current || ''}
        onChange={e => onSave(entity_id, field, e.target.value)}
        disabled={busy}
      >
        <option value="">— None —</option>
        {options.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      {busy && <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>Saving…</div>}
    </td>
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
                  <button className="btn btn-sm btn-secondary"
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
  const [locations,   setLocations]   = useState([])
  const [departments, setDepartments] = useState([])
  const [cfgTab,      setCfgTab]      = useState('brands')

  const load = useCallback(async () => {
    const [b, l, d] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('departments').select('*').order('name'),
    ])
    setBrands(b.data || [])
    setLocations(l.data || [])
    setDepartments(d.data || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function addBrand(code, name) {
    if (!name) return 'Display name is required.'
    try { await callEdge('admin-access-rules', 'addBrand', { code, name }) } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleBrand(code, active) {
    try { await callEdge('admin-access-rules', 'toggleBrand', { code, is_active: active }) } catch (e) { /* surfaced on reload */ }
    await load()
  }

  async function addLocation(name) {
    try { await callEdge('admin-access-rules', 'addLocation', { name, state: '', entity: 'PT' }) } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleLocation(name, active) {
    try { await callEdge('admin-access-rules', 'toggleLocation', { name, is_active: active }) } catch (e) { /* surfaced on reload */ }
    await load()
  }

  async function addDept(name) {
    try { await callEdge('admin-access-rules', 'addDepartment', { name }) } catch (e) { return e.message }
    await load(); return null
  }
  async function toggleDept(name, active) {
    try { await callEdge('admin-access-rules', 'toggleDepartment', { name, is_active: active }) } catch (e) { /* surfaced on reload */ }
    await load()
  }

  return (
    <div>
      <p className="ar-section-desc">Manage legacy reference tables. Brands and Departments remain live; Locations are informational only (outlets are the structured replacement). Deactivating hides from dropdowns but does not remove existing data.</p>
      <div className="ar-cfg-tabs">
        {[['brands','Brands'],['locations','Locations'],['departments','Departments'],['ou','Operating Units']].map(([k,l]) => (
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

const OU_EMPTY = { brand: '', location: '', entity_code: '', full_name: '', address: '', gstin: '', bank_account: '', bank_name: '', bank_ifsc: '' }

function OperatingUnits({ brands, locations }) {
  const [units,   setUnits]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(null)
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

  function openAdd() { setForm(OU_EMPTY); setError(''); setModal('add') }
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
      if (modal === 'add') await callEdge('admin-access-rules', 'createOperatingUnit', payload)
      else                 await callEdge('admin-access-rules', 'updateOperatingUnit', payload)
    } catch (e) {
      setSaving(false); setError(e.message); return
    }
    setSaving(false); closeModal(); await load()
  }

  async function toggleActive(ou) {
    try { await callEdge('admin-access-rules', 'toggleOperatingUnit', { id: ou.id, is_active: !ou.is_active }) } catch (e) { /* surfaced on reload */ }
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
                <th>Brand</th><th>Location</th><th>Entity Code</th><th>Company Name</th>
                <th>GSTIN</th><th>Bank</th><th>Status</th><th></th>
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
   TAB 4 — ERROR LOG VIEWER
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
  }, [toast])

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
                <th>When</th><th>User</th><th>URL</th><th>Message</th>
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
   MAIN PAGE — 4 tabs
══════════════════════════════════════════════════════════════ */
export default function AccessRules() {
  const { refreshAccessRules } = useAuth()
  const [tab, setTab] = useState('rules')

  return (
    <div>
      <div className="page-header">
        <h1>Access Rules</h1>
        <p>Define route-level access, assign entity GMs, manage reference data.</p>
      </div>

      <div className="ar-tabs">
        {[
          ['rules',    'Access Rules'],
          ['entities', 'Entities'],
          ['config',   'Configuration'],
          ['errors',   'Errors'],
        ].map(([k, l]) => (
          <button key={k} className={`ar-tab ${tab===k?'active':''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="ar-tab-body">
        {tab === 'rules'    && <RulesTab refreshAccessRules={refreshAccessRules} />}
        {tab === 'entities' && <EntitiesTab />}
        {tab === 'config'   && <ConfigTab />}
        {tab === 'errors'   && <ErrorsTab />}
      </div>
    </div>
  )
}
