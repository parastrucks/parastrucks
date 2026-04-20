import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useToast } from '../context/ToastContext'
import useAsyncAction from '../hooks/useAsyncAction'
import useFocusTrap from '../hooks/useFocusTrap'
import Skeleton from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'

/* ── Permission-level tiers shown in the UI ──────────────────────────────
   `admin` is NEVER offered — the singleton admin is seeded at install time
   and tier changes into/out of admin are rejected by the admin-users EF.
   The partial unique index `users_single_admin` is the DB backstop. */
const PERM_TIERS = ['gm', 'manager', 'executive']
const PERM_LABEL = { admin: 'Admin', gm: 'GM', manager: 'Manager', executive: 'Executive' }
const PERM_BADGE = { admin: 'badge-red', gm: 'badge-purple', manager: 'badge-blue', executive: 'badge-green' }

/* Department codes that trigger specialised form sections (match the
   Phase 6b plan 6b.0 tree — Sales/Service/Spares/Back Office). */
const DEPT_SALES       = 'sales'
const DEPT_SERVICE     = 'service'
const DEPT_SPARES      = 'spares'
const DEPT_BACK_OFFICE = 'back_office'

const EMPTY_FORM = {
  full_name: '',
  email: '',
  password: '',
  entity_id: '',
  department_id: '',
  designation_id: '',
  permission_level: 'executive',
  primary_outlet_id: '',
  subdept_id: '',
  brand_ids: [],
  sales_vertical_ids: [],
  location: '', // legacy text — free-entry alongside structured primary_outlet_id
}

/* ── helpers ── */
function Badge({ tier }) {
  return <span className={`badge ${PERM_BADGE[tier] || 'badge-gray'}`}>{PERM_LABEL[tier] || tier || '—'}</span>
}
function StatusBadge({ active }) {
  return <span className={`badge ${active ? 'badge-green' : 'badge-gray'}`}>{active ? 'Active' : 'Inactive'}</span>
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function Employees() {
  const { profile: caller, isAdmin } = useAuth()

  const [employees, setEmployees]     = useState([])
  const [loading, setLoading]         = useState(true)

  // Filters
  const [search, setSearch]                   = useState('')
  const [filterEntityId, setFilterEntityId]   = useState('')
  const [filterDeptId, setFilterDeptId]       = useState('')
  const [filterTier, setFilterTier]           = useState('')
  const [filterStatus, setFilterStatus]       = useState('active')

  // Reference data
  const [refEntities,    setRefEntities]    = useState([]) // {id, code}
  const [refDepartments, setRefDepartments] = useState([]) // {id, code, name}
  const [refDesignations,setRefDesignations]= useState([]) // {id, department_id, code, name, default_permission_tier}
  const [refBrands,      setRefBrands]      = useState([]) // {id, code, name}
  const [refSalesVert,   setRefSalesVert]   = useState([]) // {id, brand_id, code, name}
  const [refOutlets,     setRefOutlets]     = useState([]) // {id, entity_id, city, facility_type}
  const [refSubdepts,    setRefSubdepts]    = useState([]) // {id, code, name}
  const [refOutletBrands,setRefOutletBrands]= useState([]) // {outlet_id, brand_id, entity_id}

  // Modal state
  const [modal, setModal]       = useState(null) // 'add' | 'edit' | 'password' | 'confirm'
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const { run: runSave, loading: saving, error, setError, clearError } = useAsyncAction()
  const toast = useToast()
  const trapRef = useFocusTrap(!!modal, closeModal)

  // Password reset state
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Confirm action state
  const [confirmAction, setConfirmAction] = useState(null) // { type, employee }

  /* ── fetch employees ───────────────────────────────────────────────── */
  // Phase 6c.3: legacy text columns gone from users. The UUID columns drive
  // every render; the ref-table lookups happen against in-memory maps below.
  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, full_name, email, is_active, location,
          permission_level, entity_id, department_id, designation_id,
          primary_outlet_id, subdept_id
        `)
        .order('full_name')
      if (!error) setEmployees(data || [])
    } catch (e) {
      console.error('fetchEmployees error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchEmployees()
    // Load all the ref tables in parallel. The form cascades through these,
    // so loading up-front beats lazy-loading on modal open (admin typically
    // opens the modal 5-10× per onboarding session).
    Promise.all([
      supabase.from('entities').select('id, code').order('code'),
      supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
      supabase.from('designations').select('id, department_id, code, name, default_permission_tier').eq('is_active', true).order('name'),
      supabase.from('brands').select('id, code, name').eq('is_active', true).order('name'),
      supabase.from('sales_verticals').select('id, brand_id, code, name').eq('is_active', true).order('name'),
      supabase.from('outlets').select('id, entity_id, city, facility_type').eq('is_active', true).order('city'),
      supabase.from('back_office_subdepts').select('id, code, name').eq('is_active', true).order('name'),
      // outlet_brands tells us which brands are sold at which entity's outlets
      supabase.from('outlet_brands').select('outlet_id, brand_id, outlets(entity_id)'),
    ]).then(([e, d, dg, b, sv, o, sd, ob]) => {
      if (cancelled) return
      setRefEntities(e.data || [])
      setRefDepartments(d.data || [])
      setRefDesignations(dg.data || [])
      setRefBrands(b.data || [])
      setRefSalesVert(sv.data || [])
      setRefOutlets(o.data || [])
      setRefSubdepts(sd.data || [])
      setRefOutletBrands(ob.data || [])
    })
    return () => { cancelled = true }
  }, [fetchEmployees])

  /* ── lookup helpers ─────────────────────────────────────────────────── */
  const entityByCode    = useMemo(() => Object.fromEntries(refEntities.map(e => [e.code, e.id])), [refEntities])
  const deptById        = useMemo(() => Object.fromEntries(refDepartments.map(d => [d.id, d])), [refDepartments])
  const designationById = useMemo(() => Object.fromEntries(refDesignations.map(d => [d.id, d])), [refDesignations])
  const entityById      = useMemo(() => Object.fromEntries(refEntities.map(e => [e.id, e])), [refEntities])

  // Derived form state
  const selectedDept = deptById[form.department_id] // may be undefined until user picks
  const designationsForDept = useMemo(
    () => refDesignations.filter(d => d.department_id === form.department_id),
    [refDesignations, form.department_id],
  )
  const outletsForEntity = useMemo(
    () => refOutlets.filter(o => o.entity_id === form.entity_id),
    [refOutlets, form.entity_id],
  )
  // Brands available at the selected entity — derived from outlet_brands.
  // PTB only sells AL; PT sells AL + HDH + Switch. This replaces showing
  // ALL brands regardless of entity (the bug that showed HDH/Switch for PTB).
  const brandsForEntity = useMemo(() => {
    if (!form.entity_id) return refBrands // no entity chosen yet → show all
    const brandIdsAtEntity = new Set(
      refOutletBrands
        .filter(ob => ob.outlets?.entity_id === form.entity_id)
        .map(ob => ob.brand_id)
    )
    return refBrands.filter(b => brandIdsAtEntity.has(b.id))
  }, [refBrands, refOutletBrands, form.entity_id])

  const verticalsForBrands = useMemo(
    () => refSalesVert.filter(v => form.brand_ids.includes(v.brand_id)),
    [refSalesVert, form.brand_ids],
  )

  // Non-admin callers are entity-locked — they can only manage their own entity.
  // Pre-fill the entity on modal open and disable the dropdown.
  const callerEntityLocked = !isAdmin && !!caller?.entity_id

  /* ── filtered list ──────────────────────────────────────────────────── */
  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      e.full_name?.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q) ||
      e.location?.toLowerCase().includes(q)
    const matchEntity = !filterEntityId || e.entity_id === filterEntityId
    const matchDept   = !filterDeptId   || e.department_id === filterDeptId
    const matchTier   = !filterTier     || e.permission_level === filterTier
    const matchStatus =
      filterStatus === ''         ? true :
      filterStatus === 'active'   ? e.is_active :
      !e.is_active
    return matchSearch && matchEntity && matchDept && matchTier && matchStatus
  })

  /* ── stats ──────────────────────────────────────────────────────────── */
  const stats = {
    total:    employees.length,
    active:   employees.filter(e => e.is_active).length,
    ptb:      employees.filter(e => e.entity_id === entityByCode.PTB).length,
    pt:       employees.filter(e => e.entity_id === entityByCode.PT).length,
  }

  /* ── modal open/close ───────────────────────────────────────────────── */
  function openAdd() {
    // Pre-fill entity for non-admin callers (entity-locked)
    setForm({ ...EMPTY_FORM, entity_id: callerEntityLocked ? caller.entity_id : '' })
    setError('')
    setModal('add')
  }

  async function openEdit(emp) {
    setSelected(emp)
    setError('')
    // Load current join-table rows for this user. RLS allows admin/HR/BO + self.
    const [brandRes, vertRes, outletRes] = await Promise.all([
      supabase.from('user_brands').select('brand_id').eq('user_id', emp.id),
      supabase.from('user_sales_verticals').select('vertical_id').eq('user_id', emp.id),
      supabase.from('user_outlets').select('outlet_id').eq('user_id', emp.id),
    ])
    setForm({
      full_name:          emp.full_name          || '',
      email:              emp.email              || '',
      password:           '',
      entity_id:          emp.entity_id          || '',
      department_id:      emp.department_id      || '',
      designation_id:     emp.designation_id     || '',
      permission_level:   emp.permission_level   || 'executive',
      primary_outlet_id:  emp.primary_outlet_id  || '',
      subdept_id:         emp.subdept_id         || '',
      brand_ids:          (brandRes.data  || []).map(r => r.brand_id),
      sales_vertical_ids: (vertRes.data   || []).map(r => r.vertical_id),
      location:           emp.location           || '',
    })
    setModal('edit')
  }

  function openPassword(emp) {
    setSelected(emp)
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setModal('password')
  }

  function openConfirm(type, emp) {
    setConfirmAction({ type, employee: emp })
    setModal('confirm')
  }

  function closeModal() {
    setModal(null)
    setSelected(null)
    clearError()
    setConfirmAction(null)
  }

  /* ── cascaded-field handlers ────────────────────────────────────────── */
  // When entity changes, clear outlet selections (they're entity-scoped).
  // When entity changes, clear outlet + brand selections (both are entity-scoped)
  function onEntityChange(entity_id) {
    setForm(f => ({ ...f, entity_id, primary_outlet_id: '', brand_ids: [], sales_vertical_ids: [] }))
  }

  // When department changes, clear designation + dept-specific fields.
  function onDepartmentChange(department_id) {
    setForm(f => ({
      ...f,
      department_id,
      designation_id: '',
      // Clear the dept-specific field slots so stale values don't leak on save
      primary_outlet_id: '',
      subdept_id: '',
      brand_ids: [],
      sales_vertical_ids: [],
    }))
  }

  // When designation changes, auto-fill permission_level from the ref row's
  // default_permission_tier (admin never appears — designation table has no
  // admin rows). The admin can still override manually via the dropdown.
  function onDesignationChange(designation_id) {
    setForm(f => {
      const d = designationById[designation_id]
      const next = { ...f, designation_id }
      if (d && d.default_permission_tier) next.permission_level = d.default_permission_tier
      return next
    })
  }

  function toggleId(list, id) {
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  }

  /* ── form-field validation ──────────────────────────────────────────── */
  function validateForm({ requirePassword }) {
    if (!form.full_name.trim()) return 'Full name is required.'
    if (!form.email.trim())     return 'Email is required.'
    if (requirePassword && form.password.length < 8) {
      return 'Password must be at least 8 characters.'
    }
    if (!form.entity_id)        return 'Entity is required.'
    if (!form.department_id)    return 'Department is required.'
    if (!form.designation_id)   return 'Designation is required.'
    if (!form.permission_level || !PERM_TIERS.includes(form.permission_level)) {
      return 'Permission level is required.'
    }

    const deptCode = deptById[form.department_id]?.code
    if (deptCode === DEPT_SALES && form.brand_ids.length === 0) {
      return 'Select at least one brand for Sales users.'
    }
    if (deptCode === DEPT_SALES && form.sales_vertical_ids.length === 0) {
      return 'Select at least one sales vertical for Sales users.'
    }
    if ((deptCode === DEPT_SERVICE || deptCode === DEPT_SPARES) && !form.primary_outlet_id) {
      return 'Primary outlet is required for Service/Spares users.'
    }
    if (deptCode === DEPT_BACK_OFFICE && form.permission_level !== 'gm' && !form.subdept_id) {
      return 'Sub-department is required for Back Office users.'
    }
    return null
  }

  /* ── build the EF payload from the current form state ───────────────── */
  // Phase 6c.3: legacy text columns dropped. Only the 4-axis UUIDs + join
  // tables are sent. `location` stays as informational free text.
  function buildCreatePayload() {
    const deptCode = deptById[form.department_id]?.code
    return {
      full_name:         form.full_name.trim(),
      email:             form.email.trim(),
      password:          form.password,
      permission_level:  form.permission_level,
      entity_id:         form.entity_id,
      department_id:     form.department_id,
      designation_id:    form.designation_id,
      primary_outlet_id: form.primary_outlet_id || null,
      subdept_id:        form.subdept_id || null,
      location:          form.location || null,
      brand_ids:          deptCode === DEPT_SALES       ? form.brand_ids
                        : deptCode === DEPT_BACK_OFFICE ? form.brand_ids : [],
      sales_vertical_ids: deptCode === DEPT_SALES ? form.sales_vertical_ids : [],
      outlet_ids:         [],
    }
  }

  function buildUpdatePayload() {
    const deptCode = deptById[form.department_id]?.code
    return {
      full_name:         form.full_name.trim(),
      permission_level:  form.permission_level,
      entity_id:         form.entity_id,
      department_id:     form.department_id,
      designation_id:    form.designation_id,
      primary_outlet_id: form.primary_outlet_id || null,
      subdept_id:        form.subdept_id || null,
      location:          form.location || null,
      brand_ids:          deptCode === DEPT_SALES       ? form.brand_ids
                        : deptCode === DEPT_BACK_OFFICE ? form.brand_ids : [],
      sales_vertical_ids: deptCode === DEPT_SALES ? form.sales_vertical_ids : [],
      outlet_ids:         [],
    }
  }

  /* ── CREATE employee ────────────────────────────────────────────────── */
  async function handleCreate(e) {
    e.preventDefault()
    const err = validateForm({ requirePassword: true })
    if (err) { setError(err); return }

    await runSave(async () => {
      await callEdge('admin-users', 'create', buildCreatePayload())
      toast.success(`${form.full_name} added successfully.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── UPDATE employee ────────────────────────────────────────────────── */
  async function handleUpdate(e) {
    e.preventDefault()
    const err = validateForm({ requirePassword: false })
    if (err) { setError(err); return }

    await runSave(async () => {
      await callEdge('admin-users', 'updateProfile', {
        id: selected.id,
        update: buildUpdatePayload(),
      })
      toast.success('Employee updated.')
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── RESET PASSWORD ─────────────────────────────────────────────────── */
  async function handleResetPassword(e) {
    e.preventDefault()
    if (newPassword.length < 8)          { setError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return }

    await runSave(async () => {
      await callEdge('admin-users', 'resetPassword', {
        id: selected.id,
        password: newPassword,
      })
      toast.success(`Password updated for ${selected.full_name}.`)
      closeModal()
    }).catch(() => {})
  }

  /* ── DEACTIVATE / ACTIVATE ──────────────────────────────────────────── */
  async function handleToggleActive() {
    const emp = confirmAction.employee
    const newStatus = !emp.is_active
    await runSave(async () => {
      await callEdge('admin-users', 'setActive', { id: emp.id, is_active: newStatus })
      toast.success(`${emp.full_name} ${newStatus ? 'activated' : 'deactivated'}.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── DELETE (permanent) ─────────────────────────────────────────────── */
  async function handleDelete() {
    const emp = confirmAction.employee
    await runSave(async () => {
      await callEdge('admin-users', 'delete', { id: emp.id })
      toast.success(`${emp.full_name} deleted.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ══ RENDER ═════════════════════════════════════════════════════════ */
  return (
    <div>
      {/* Page header */}
      <div className="flex-between mb-24" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>Employees</h1>
          <p>Manage team accounts, departments, designations, and access.</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          + Add Employee
        </button>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PTB · Gujarat</div>
          <div className="stat-value">{stats.ptb}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PT · Haryana</div>
          <div className="stat-value">{stats.pt}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          className="form-input"
          style={{ maxWidth: 240, marginBottom: 0 }}
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="form-select" style={{ maxWidth: 150 }}
          value={filterEntityId} onChange={e => setFilterEntityId(e.target.value)}>
          <option value="">All Entities</option>
          {refEntities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 170 }}
          value={filterDeptId} onChange={e => setFilterDeptId(e.target.value)}>
          <option value="">All Departments</option>
          {refDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 160 }}
          value={filterTier} onChange={e => setFilterTier(e.target.value)}>
          <option value="">All Levels</option>
          <option value="admin">{PERM_LABEL.admin}</option>
          {PERM_TIERS.map(r => <option key={r} value={r}>{PERM_LABEL[r]}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 140 }}
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="">All</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={6} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <h3>No employees found</h3>
          <p>Try adjusting the filters or add a new employee.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Entity</th>
                <th>Department · Designation</th>
                <th>Permission</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => {
                const dept = deptById[emp.department_id]
                const desig = designationById[emp.designation_id]
                const ent = entityById[emp.entity_id]
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{emp.full_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-500)' }}>{emp.email}</td>
                    <td><span className="badge badge-blue">{ent?.code || '—'}</span></td>
                    <td>
                      <div style={{ fontSize: 13 }}>{dept?.name || '—'}</div>
                      {desig?.name && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>{desig.name}</div>}
                    </td>
                    <td><Badge tier={emp.permission_level} /></td>
                    <td><StatusBadge active={emp.is_active} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(emp)}>Edit</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openPassword(emp)}>Reset PW</button>
                        <button
                          className={`btn btn-sm ${emp.is_active ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => openConfirm(emp.is_active ? 'deactivate' : 'activate', emp)}
                        >
                          {emp.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ADD / EDIT MODAL ─────────────────────────────────────────── */}
      {(modal === 'add' || modal === 'edit') && (
        <EmployeeFormModal
          mode={modal}
          selected={selected}
          trapRef={trapRef}
          closeModal={closeModal}
          form={form}
          setForm={setForm}
          error={error}
          saving={saving}
          refEntities={refEntities}
          refDepartments={refDepartments}
          designationsForDept={designationsForDept}
          refBrands={brandsForEntity}
          refSalesVert={refSalesVert}
          verticalsForBrands={verticalsForBrands}
          outletsForEntity={outletsForEntity}
          refSubdepts={refSubdepts}
          refOutlets={refOutlets}
          selectedDept={selectedDept}
          onEntityChange={onEntityChange}
          onDepartmentChange={onDepartmentChange}
          onDesignationChange={onDesignationChange}
          toggleId={toggleId}
          onSubmit={modal === 'add' ? handleCreate : handleUpdate}
          canDelete={isAdmin && modal === 'edit' && selected?.id !== caller?.id}
          onDelete={() => { closeModal(); openConfirm('delete', selected) }}
          callerEntityLocked={callerEntityLocked}
        />
      )}

      {/* ── RESET PASSWORD MODAL ─────────────────────────────────────── */}
      {modal === 'password' && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" ref={trapRef} tabIndex={-1}>
            <div className="modal-header">
              <h2>Reset Password — {selected.full_name}</h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error"><span>⚠</span><span>{error}</span></div>}
              <form onSubmit={handleResetPassword} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-new">New Password</label>
                  <input id="pw-new" className="form-input" type="password" placeholder="Min. 8 characters"
                    value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-confirm">Confirm Password</label>
                  <input id="pw-confirm" className="form-input" type="password" placeholder="Re-enter password"
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <span className="spinner spinner-sm" /> : 'Update Password'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM MODAL ────────────────────────────────────────────── */}
      {modal === 'confirm' && confirmAction && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" ref={trapRef} tabIndex={-1} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>
                {confirmAction.type === 'deactivate' ? 'Deactivate Employee' :
                 confirmAction.type === 'activate'   ? 'Activate Employee' :
                 'Delete Employee'}
              </h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error"><span>⚠</span><span>{error}</span></div>}
              {confirmAction.type === 'deactivate' && (
                <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                  Deactivating <strong>{confirmAction.employee.full_name}</strong> will prevent them from logging in.
                  Their quotation history will be preserved. You can reactivate them at any time.
                </p>
              )}
              {confirmAction.type === 'activate' && (
                <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                  This will restore login access for <strong>{confirmAction.employee.full_name}</strong>.
                </p>
              )}
              {confirmAction.type === 'delete' && (
                <div>
                  <div className="alert alert-error" style={{ marginBottom: 12 }}>
                    <span>⚠</span>
                    <span>This is permanent and cannot be undone.</span>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                    Permanently deleting <strong>{confirmAction.employee.full_name}</strong> will remove their
                    account and all associated data. Consider deactivating instead.
                  </p>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  className={`btn ${confirmAction.type === 'activate' ? 'btn-primary' : 'btn-danger'}`}
                  onClick={confirmAction.type === 'delete' ? handleDelete : handleToggleActive}
                  disabled={saving}
                >
                  {saving ? <span className="spinner spinner-sm" /> :
                    confirmAction.type === 'deactivate' ? 'Yes, Deactivate' :
                    confirmAction.type === 'activate'   ? 'Yes, Activate' :
                    'Yes, Delete Permanently'}
                </button>
                <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   EMPLOYEE FORM MODAL — cascading Entity → Department → Designation with
   conditional department-specific sections. Extracted into its own
   component purely for readability; no lifecycle/state of its own.
════════════════════════════════════════════════════════════════════════ */
function EmployeeFormModal({
  mode,
  selected,
  trapRef,
  closeModal,
  form,
  setForm,
  error,
  saving,
  refEntities,
  refDepartments,
  designationsForDept,
  refBrands,
  refSalesVert,
  verticalsForBrands,
  outletsForEntity,
  refSubdepts,
  refOutlets,
  selectedDept,
  onEntityChange,
  onDepartmentChange,
  onDesignationChange,
  toggleId,
  onSubmit,
  canDelete,
  onDelete,
  callerEntityLocked,
}) {
  const deptCode = selectedDept?.code
  const F = (field) => ({
    value: form[field],
    onChange: e => setForm(f => ({ ...f, [field]: e.target.value })),
  })

  const title = mode === 'add' ? 'Add Employee' : `Edit — ${selected?.full_name}`

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
      <div className="modal" ref={trapRef} tabIndex={-1} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={closeModal}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error"><span>⚠</span><span>{error}</span></div>}
          <form onSubmit={onSubmit} noValidate>
            {/* Identity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-name">Full Name *</label>
                <input id="emp-name" className="form-input" placeholder="Ramesh Kumar" {...F('full_name')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-email">Email *</label>
                <input
                  id="emp-email" className="form-input" type="email"
                  placeholder="ramesh@parastrucks.in"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  disabled={mode === 'edit'}
                  style={mode === 'edit' ? { opacity: 0.6 } : undefined}
                />
              </div>
              {mode === 'add' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-pw">Temporary Password *</label>
                  <input id="emp-pw" className="form-input" type="password" placeholder="Min. 8 characters" {...F('password')} />
                </div>
              )}
            </div>

            {/* Organisational axes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-entity">Entity *</label>
                <select
                  id="emp-entity" className="form-select"
                  value={form.entity_id}
                  onChange={e => onEntityChange(e.target.value)}
                  disabled={callerEntityLocked}
                  style={callerEntityLocked ? { opacity: 0.6 } : undefined}
                >
                  <option value="">— Select —</option>
                  {refEntities.map(en => <option key={en.id} value={en.id}>{en.code}</option>)}
                </select>
                {callerEntityLocked && (
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                    Locked to your entity. Admin can create cross-entity users.
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-dept">Department *</label>
                <select
                  id="emp-dept" className="form-select"
                  value={form.department_id}
                  onChange={e => onDepartmentChange(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {refDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-desig">Designation *</label>
                <select
                  id="emp-desig" className="form-select"
                  value={form.designation_id}
                  onChange={e => onDesignationChange(e.target.value)}
                  disabled={!form.department_id}
                >
                  <option value="">— Select —</option>
                  {designationsForDept.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-tier">Permission Level *</label>
                <select id="emp-tier" className="form-select" {...F('permission_level')}>
                  {PERM_TIERS.map(t => <option key={t} value={t}>{PERM_LABEL[t]}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                  Auto-filled from designation. Admin tier never offered.
                </div>
              </div>
            </div>

            {/* Department-specific section */}
            {deptCode === 'sales' && (
              <DeptSection title="Sales details">
                <MultiCheckbox
                  id="sales-brands"
                  label="Brands *"
                  items={refBrands}
                  selected={form.brand_ids}
                  onToggle={id => setForm(f => {
                    const nextBrands = toggleId(f.brand_ids, id)
                    // Prune any selected verticals whose brand is no longer checked.
                    // Uses the full sales_verticals list so we compare against
                    // ground truth, not the currently-rendered subset.
                    const nextVerts = f.sales_vertical_ids.filter(vId => {
                      const row = refSalesVert.find(v => v.id === vId)
                      return row && nextBrands.includes(row.brand_id)
                    })
                    return { ...f, brand_ids: nextBrands, sales_vertical_ids: nextVerts }
                  })}
                  labelKey="name"
                  badgeKey="code"
                />
                <MultiCheckbox
                  id="sales-verticals"
                  label="Sales verticals *"
                  items={verticalsForBrands}
                  selected={form.sales_vertical_ids}
                  onToggle={id => setForm(f => ({ ...f, sales_vertical_ids: toggleId(f.sales_vertical_ids, id) }))}
                  labelKey="name"
                  emptyHint={form.brand_ids.length === 0 ? 'Select one or more brands first.' : null}
                />
              </DeptSection>
            )}

            {(deptCode === 'service' || deptCode === 'spares') && (
              <DeptSection title={deptCode === 'service' ? 'Service details' : 'Spares details'}>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-outlet">Primary outlet *</label>
                  <select
                    id="emp-outlet" className="form-select"
                    value={form.primary_outlet_id}
                    onChange={e => setForm(f => ({ ...f, primary_outlet_id: e.target.value }))}
                    disabled={!form.entity_id}
                  >
                    <option value="">— Select —</option>
                    {outletsForEntity.map(o => (
                      <option key={o.id} value={o.id}>{o.city} ({o.facility_type})</option>
                    ))}
                  </select>
                </div>
              </DeptSection>
            )}

            {deptCode === 'back_office' && (
              <DeptSection title="Back Office details">
                {form.permission_level !== 'gm' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="emp-subdept">Sub-department *</label>
                    <select
                      id="emp-subdept" className="form-select"
                      value={form.subdept_id}
                      onChange={e => setForm(f => ({ ...f, subdept_id: e.target.value }))}
                    >
                      <option value="">— Select —</option>
                      {refSubdepts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <MultiCheckbox
                  id="bo-brands"
                  label="Brands (for quotation log scope)"
                  items={refBrands}
                  selected={form.brand_ids}
                  onToggle={id => setForm(f => ({ ...f, brand_ids: toggleId(f.brand_ids, id) }))}
                  labelKey="name"
                  badgeKey="code"
                />
              </DeptSection>
            )}

            {/* Informational legacy location field — free-select from outlet cities */}
            <div className="form-group">
              <label className="form-label" htmlFor="emp-loc">Location (informational)</label>
              <select id="emp-loc" className="form-select" {...F('location')}>
                <option value="">— None —</option>
                {refOutlets.map(o => <option key={o.id} value={o.city}>{o.city}</option>)}
              </select>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <span className="spinner spinner-sm" /> : (mode === 'add' ? 'Create Employee' : 'Save Changes')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              {canDelete && (
                <button type="button" className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
                  Delete Permanently
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* Simple labelled fieldset for dept-specific sections. */
function DeptSection({ title, children }) {
  return (
    <div style={{ margin: '12px 0 4px', padding: 12, border: '1px solid var(--gray-200)', borderRadius: 8, background: 'var(--gray-50)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-700)', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

/* Reusable multi-checkbox group — used for brands and sales verticals. */
function MultiCheckbox({ id, label, items, selected, onToggle, labelKey = 'name', badgeKey, emptyHint }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <div id={id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{emptyHint || 'No options available.'}</div>
        )}
        {items.map(it => {
          const on = selected.includes(it.id)
          return (
            <label
              key={it.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--blue)' : 'var(--gray-300)'}`,
                background: on ? 'var(--blue-50, #eff6ff)' : '#fff',
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(it.id)}
                style={{ margin: 0 }}
              />
              <span>{it[labelKey]}</span>
              {badgeKey && it[badgeKey] && (
                <span style={{ fontSize: 10, color: 'var(--gray-500)', fontFamily: 'monospace' }}>{it[badgeKey]}</span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

