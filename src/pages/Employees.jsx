import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useToast } from '../context/ToastContext'
import useAsyncAction from '../hooks/useAsyncAction'
import useFocusTrap from '../hooks/useFocusTrap'
import Skeleton from '../components/Skeleton'

// Permission levels are fixed system concepts
const PERMISSION_LEVELS = ['sales', 'back_office', 'hr', 'admin']
const PERMISSION_LABEL  = { admin: 'Admin', hr: 'HR', back_office: 'Back Office', sales: 'Sales' }
const PERMISSION_BADGE  = { admin: 'badge-red', hr: 'badge-amber', back_office: 'badge-blue', sales: 'badge-green' }

// Kept for backward compat in column header
const ROLE_LABEL = PERMISSION_LABEL
const ROLE_BADGE = PERMISSION_BADGE

const ENTITIES = ['PTB', 'PT']

const EMPTY_FORM = {
  full_name: '', email: '', password: '',
  role: 'sales', entity: 'PTB', brand: '', location: '',
  department: '', vertical: '', designation: '',
  is_active: true,
}

/* ── helpers ── */
function Badge({ role }) {
  return <span className={`badge ${PERMISSION_BADGE[role] || 'badge-gray'}`}>{PERMISSION_LABEL[role] || role}</span>
}
function StatusBadge({ active }) {
  return <span className={`badge ${active ? 'badge-green' : 'badge-gray'}`}>{active ? 'Active' : 'Inactive'}</span>
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function Employees() {
  const [employees, setEmployees]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterRole, setFilterRole]     = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')

  // Reference data (loaded from DB)
  const [refBrands,      setRefBrands]      = useState([])
  const [refLocations,   setRefLocations]   = useState([])
  const [refDepartments, setRefDepartments] = useState([])
  const [refRoles,       setRefRoles]       = useState([])

  // Modal state
  const [modal, setModal]   = useState(null) // 'add' | 'edit' | 'password' | 'confirm'
  const [selected, setSelected] = useState(null)
  const [form, setForm]     = useState(EMPTY_FORM)
  const { run: runSave, loading: saving, error, setError, clearError } = useAsyncAction()
  const toast = useToast()
  const trapRef = useFocusTrap(!!modal, closeModal)

  // Password reset state
  const [newPassword, setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Confirm action state
  const [confirmAction, setConfirmAction] = useState(null) // { type: 'deactivate'|'activate'|'delete', employee }

  /* ── fetch employees ── */
  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, role, entity, brand, location, department, vertical, designation, is_active')
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
    // Load reference tables
    Promise.all([
      supabase.from('brands').select('code,name').eq('is_active', true).order('name'),
      supabase.from('locations').select('name').eq('is_active', true).order('name'),
      supabase.from('departments').select('name').eq('is_active', true).order('name'),
      supabase.from('roles').select('name,label').eq('is_active', true).order('label'),
    ]).then(([b, l, d, r]) => {
      if (cancelled) return
      setRefBrands(b.data || [])
      setRefLocations(l.data || [])
      setRefDepartments(d.data || [])
      setRefRoles(r.data || [])
    })
    return () => { cancelled = true }
  }, [fetchEmployees])

  /* ── filtered list ── */
  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      e.full_name?.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q) ||
      e.location?.toLowerCase().includes(q)
    const matchRole   = !filterRole   || e.role === filterRole
    const matchEntity = !filterEntity || e.entity === filterEntity
    const matchStatus =
      filterStatus === ''         ? true :
      filterStatus === 'active'   ? e.is_active :
      !e.is_active
    return matchSearch && matchRole && matchEntity && matchStatus
  })

  /* ── stats ── */
  const stats = {
    total:    employees.length,
    active:   employees.filter(e => e.is_active).length,
    ptb:      employees.filter(e => e.entity === 'PTB').length,
    pt:       employees.filter(e => e.entity === 'PT').length,
  }

  /* ── open modals ── */
  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setModal('add')
  }

  function openEdit(emp) {
    setSelected(emp)
    setForm({
      full_name:   emp.full_name   || '',
      email:       emp.email       || '',
      password:    '',
      role:        emp.role        || 'sales',
      entity:      emp.entity      || 'PTB',
      brand:       emp.brand       || '',
      location:    emp.location    || '',
      department:  emp.department  || '',
      vertical:    emp.vertical    || '',
      designation: emp.designation || '',
      is_active:   emp.is_active,
    })
    setError('')
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

  /* ── form field helper ── */
  const F = (field) => ({
    value: form[field],
    onChange: e => setForm(f => ({ ...f, [field]: e.target.value }))
  })

  /* ── CREATE employee ── */
  async function handleCreate(e) {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Full name is required.'); return }
    if (!form.email.trim())     { setError('Email is required.'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return }

    await runSave(async () => {
      await callEdge('admin-users', 'create', {
        full_name:   form.full_name.trim(),
        email:       form.email.trim(),
        password:    form.password,
        role:        form.role,
        entity:      form.entity,
        brand:       form.brand      || null,
        location:    form.location   || null,
        department:  form.department || null,
        vertical:    form.vertical   || null,
        designation: form.designation.trim() || null,
      })
      toast.success(`${form.full_name} added successfully.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── UPDATE employee ── */
  async function handleUpdate(e) {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Full name is required.'); return }

    await runSave(async () => {
      await callEdge('admin-users', 'updateProfile', {
        id: selected.id,
        update: {
          full_name:   form.full_name.trim(),
          role:        form.role,
          entity:      form.entity,
          brand:       form.brand       || null,
          location:    form.location    || null,
          department:  form.department  || null,
          vertical:    form.vertical    || null,
          designation: form.designation.trim() || null,
        },
      })
      toast.success('Employee updated.')
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── RESET PASSWORD ── */
  async function handleResetPassword(e) {
    e.preventDefault()
    if (newPassword.length < 8)        { setError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword){ setError('Passwords do not match.'); return }

    await runSave(async () => {
      await callEdge('admin-users', 'resetPassword', {
        id: selected.id,
        password: newPassword,
      })
      toast.success(`Password updated for ${selected.full_name}.`)
      closeModal()
    }).catch(() => {})
  }

  /* ── DEACTIVATE / ACTIVATE ── */
  async function handleToggleActive() {
    const emp = confirmAction.employee
    const newStatus = !emp.is_active

    await runSave(async () => {
      await callEdge('admin-users', 'setActive', {
        id: emp.id,
        is_active: newStatus,
      })
      toast.success(`${emp.full_name} ${newStatus ? 'activated' : 'deactivated'}.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ── DELETE (permanent) ── */
  async function handleDelete() {
    const emp = confirmAction.employee

    await runSave(async () => {
      await callEdge('admin-users', 'delete', { id: emp.id })
      toast.success(`${emp.full_name} deleted.`)
      await fetchEmployees()
      closeModal()
    }).catch(() => {})
  }

  /* ══ RENDER ══════════════════════════════════════════════════ */
  return (
    <div>
      {/* Page header */}
      <div className="flex-between mb-24" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>Employees</h1>
          <p>Manage team accounts, roles, and access.</p>
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
          value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">All Levels</option>
          {PERMISSION_LEVELS.map(r => <option key={r} value={r}>{PERMISSION_LABEL[r]}</option>)}
        </select>
        <select className="form-select" style={{ maxWidth: 130 }}
          value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
          <option value="">All Entities</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
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
                <th>Permission Level</th>
                <th>Entity</th>
                <th>Location</th>
                <th>Dept / Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(emp => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{emp.full_name}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-500)' }}>{emp.email}</td>
                  <td><Badge role={emp.role} /></td>
                  <td><span className="badge badge-blue">{emp.entity}</span></td>
                  <td>{emp.location || '—'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{emp.department || '—'}</div>
                    {emp.vertical && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>{emp.vertical}</div>}
                  </td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ADD EMPLOYEE MODAL ── */}
      {modal === 'add' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" ref={trapRef} tabIndex={-1}>
            <div className="modal-header">
              <h2>Add Employee</h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error"><span>⚠</span><span>{error}</span></div>}
              <form onSubmit={handleCreate} noValidate>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-name">Full Name *</label>
                    <input id="add-name" className="form-input" placeholder="Ramesh Kumar" {...F('full_name')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-email">Email *</label>
                    <input id="add-email" className="form-input" type="email" placeholder="ramesh@parastrucks.in" {...F('email')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-pw">Temporary Password *</label>
                    <input id="add-pw" className="form-input" type="password" placeholder="Min. 8 characters" {...F('password')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-level">Permission Level *</label>
                    <select id="add-level" className="form-select" {...F('role')}>
                      {PERMISSION_LEVELS.map(r => <option key={r} value={r}>{PERMISSION_LABEL[r]}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-entity">Entity *</label>
                    <select id="add-entity" className="form-select" {...F('entity')}>
                      {ENTITIES.map(e => <option key={e} value={e}>{e === 'PTB' ? 'PTB — Gujarat' : 'PT — Haryana'}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-brand">Brand</label>
                    <select id="add-brand" className="form-select" {...F('brand')}>
                      <option value="">— Select —</option>
                      {refBrands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-loc">Location</label>
                    <select id="add-loc" className="form-select" {...F('location')}>
                      <option value="">— Select —</option>
                      {refLocations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-desig">Designation</label>
                    <input id="add-desig" className="form-input" placeholder="Executive" {...F('designation')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-dept">Department</label>
                    <select id="add-dept" className="form-select" {...F('department')}>
                      <option value="">— Select —</option>
                      {refDepartments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="add-role">Role</label>
                    <select id="add-role" className="form-select" {...F('vertical')}>
                      <option value="">— Select —</option>
                      {refRoles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <span className="spinner spinner-sm" /> : 'Create Employee'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT EMPLOYEE MODAL ── */}
      {modal === 'edit' && selected && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="modal" ref={trapRef} tabIndex={-1}>
            <div className="modal-header">
              <h2>Edit — {selected.full_name}</h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-error"><span>⚠</span><span>{error}</span></div>}
              <form onSubmit={handleUpdate} noValidate>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-name">Full Name *</label>
                    <input id="edit-name" className="form-input" {...F('full_name')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-email">Email</label>
                    <input id="edit-email" className="form-input" value={selected?.email || ''} disabled style={{ opacity: 0.6 }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-level">Permission Level *</label>
                    <select id="edit-level" className="form-select" {...F('role')}>
                      {PERMISSION_LEVELS.map(r => <option key={r} value={r}>{PERMISSION_LABEL[r]}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-entity">Entity *</label>
                    <select id="edit-entity" className="form-select" {...F('entity')}>
                      {ENTITIES.map(e => <option key={e} value={e}>{e === 'PTB' ? 'PTB — Gujarat' : 'PT — Haryana'}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-brand">Brand</label>
                    <select id="edit-brand" className="form-select" {...F('brand')}>
                      <option value="">— Select —</option>
                      {refBrands.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-loc">Location</label>
                    <select id="edit-loc" className="form-select" {...F('location')}>
                      <option value="">— Select —</option>
                      {refLocations.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-desig">Designation</label>
                    <input id="edit-desig" className="form-input" {...F('designation')} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-dept">Department</label>
                    <select id="edit-dept" className="form-select" {...F('department')}>
                      <option value="">— Select —</option>
                      {refDepartments.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-role">Role</label>
                    <select id="edit-role" className="form-select" {...F('vertical')}>
                      <option value="">— Select —</option>
                      {refRoles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <span className="spinner spinner-sm" /> : 'Save Changes'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                  <button type="button" className="btn btn-danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { closeModal(); openConfirm('delete', selected) }}>
                    Delete Permanently
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── RESET PASSWORD MODAL ── */}
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

      {/* ── CONFIRM MODAL (deactivate / activate / delete) ── */}
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
                  className={`btn ${confirmAction.type === 'delete' ? 'btn-danger' : confirmAction.type === 'deactivate' ? 'btn-danger' : 'btn-primary'}`}
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
