import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useToast } from '../context/ToastContext'
import useAsyncAction from '../hooks/useAsyncAction'
import useFocusTrap from '../hooks/useFocusTrap'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
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

/* Which departments actually RENDER a control for each join table. This is the
   single source of truth for "did the admin get a chance to set this?" — and it
   is what the payload builders key on.

   It matters because the EF's replaceJoin() treats the two absent-ish values
   very differently: `undefined` leaves the table untouched, `[]` DELETES every
   row and inserts none. Sending `[]` for a department whose control was never
   rendered therefore wipes assignments the admin was never shown and could not
   have intended to clear. Departments with no control must send NOTHING. */
const DEPTS_WITH_BRAND_PICKER    = new Set([DEPT_SALES, DEPT_SERVICE, DEPT_SPARES, DEPT_BACK_OFFICE])
const DEPTS_WITH_VERTICAL_PICKER = new Set([DEPT_SALES])

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
  const [showFilters, setShowFilters]         = useState(false)
  const filterRef = useRef(null)

  // Reference data
  const [refEntities,    setRefEntities]    = useState([]) // {id, code}
  const [refDepartments, setRefDepartments] = useState([]) // {id, code, name}
  const [refDesignations,setRefDesignations]= useState([]) // {id, department_id, code, name, default_permission_tier}
  const [refBrands,      setRefBrands]      = useState([]) // {id, code, name}
  const [refSalesVert,   setRefSalesVert]   = useState([]) // {id, brand_id, code, name}
  const [refOutlets,     setRefOutlets]     = useState([]) // {id, entity_id, city, facility_type}
  const [refSubdepts,    setRefSubdepts]    = useState([]) // {id, code, name}
  const [refOutletBrands,setRefOutletBrands]= useState([]) // {outlet_id, brand_id, entity_id}
  // Non-null when any reference table failed to load. Editing is disabled while
  // set, because an empty ref table makes the form render every assignment as
  // unchecked and a save would strip it (red-team 2026-07-21, M4).
  const [refLoadError,   setRefLoadError]   = useState(null)

  // Modal state
  const [modal, setModal]       = useState(null) // 'add' | 'edit' | 'password' | 'confirm'
  const [selected, setSelected] = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const { run: runSave, loading: saving, error, setError, clearError } = useAsyncAction()
  const [errorField, setErrorField] = useState(null) // which field to flag red on validation
  const toast = useToast()
  const trapRef = useFocusTrap(!!modal, closeModal)

  // Server/EF failures never get a banner — they surface as a toast. Validation
  // errors are rendered inline at the offending field instead.
  const toastOnError = { onError: e => toast.error(e?.message || 'Something went wrong.') }

  // Map a validation field key → the DOM id of the control to scroll/focus.
  const FIELD_EL_ID = {
    full_name: 'emp-name',
    email: 'emp-email',
    password: 'emp-pw',
    entity_id: 'emp-entity',
    department_id: 'emp-dept',
    designation_id: 'emp-desig',
    permission_level: 'emp-tier',
    primary_outlet_id: 'emp-outlet',
    subdept_id: 'emp-subdept',
    brand_ids: 'emp-brands',
    sales_vertical_ids: 'sales-verticals',
    'new-pw': 'pw-new',
    'confirm-pw': 'pw-confirm',
  }
  function focusField(field) {
    const el = document.getElementById(FIELD_EL_ID[field] || '')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }) } catch { el.focus() } }
  }

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
      // Red-team 2026-07-21 (M4, worst case): these errors were discarded.
      // supabase-js does not throw on HTTP errors, so a failed read (e.g. a
      // rejected API key) silently produced EMPTY ref tables. The edit modal
      // then opened with every brand/vertical/outlet checkbox UNCHECKED, and
      // saving would have written that back — silently STRIPPING a user's real
      // assignments. Data loss disguised as a normal edit. Refuse to arm the
      // form when the reference data is incomplete.
      const refErr = [e, d, dg, b, sv, o, sd, ob].find(r => r?.error)?.error
      if (refErr) {
        console.error('Employees: reference table load failed:', refErr.message)
        setRefLoadError(refErr.message)
        toast.error('Could not load reference data — editing is disabled. Please reload.')
        return
      }
      setRefLoadError(null)
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

  // Count of non-default filters, for the Filters button badge (search is separate).
  const activeFilterCount =
    (filterEntityId ? 1 : 0) + (filterDeptId ? 1 : 0) +
    (filterTier ? 1 : 0) + (filterStatus !== 'active' ? 1 : 0)

  // Close the filter popover on an outside click.
  useEffect(() => {
    if (!showFilters) return
    const onDown = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showFilters])

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
    setErrorField(null)
    setModal('add')
  }

  async function openEdit(emp) {
    // Reference data incomplete → every checkbox would render unchecked and a
    // save would strip the user's assignments (red-team 2026-07-21, M4).
    if (refLoadError) {
      toast.error('Reference data failed to load — reload the page before editing.')
      return
    }
    setSelected(emp)
    setError('')
    setErrorField(null)
    // Load current join-table rows for this user. RLS allows admin/HR/BO + self.
    // `user_outlets` is deliberately NOT read: this form renders no control for
    // it and no longer writes it, so a failed read of it must not block the
    // editor. (It used to be fetched, gated on, and then thrown away.)
    const [brandRes, vertRes] = await Promise.all([
      supabase.from('user_brands').select('brand_id').eq('user_id', emp.id),
      supabase.from('user_sales_verticals').select('vertical_id').eq('user_id', emp.id),
    ])
    // These two ARE the user's current assignments. If a read fails,
    // supabase-js returns {data:null,error} without throwing — the form would
    // then show nothing selected and Save would persist that emptiness,
    // silently wiping real assignments. Refuse to open instead.
    const joinErr = [brandRes, vertRes].find(r => r?.error)?.error
    if (joinErr) {
      console.error('openEdit: user join-table read failed:', joinErr.message)
      toast.error('Could not load this employee’s current assignments — not opening the editor.')
      return
    }
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
    setErrorField(null)
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
    setErrorField(null)
    setConfirmAction(null)
  }

  /* ── cascaded-field handlers ────────────────────────────────────────── */
  // When entity changes, clear outlet selections (they're entity-scoped).
  // When entity changes, clear outlet + brand selections (both are entity-scoped)
  function onEntityChange(entity_id) {
    setForm(f => ({ ...f, entity_id, primary_outlet_id: '', brand_ids: [], sales_vertical_ids: [] }))
    setErrorField(f => f === 'entity_id' ? null : f)
  }

  // When department changes, clear designation + dept-specific fields.
  function onDepartmentChange(department_id) {
    setErrorField(f => f === 'department_id' ? null : f)
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
    setErrorField(f => f === 'designation_id' ? null : f)
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
  // Returns null when valid, else { message, field } — the message is rendered
  // inline under `field` and that control is flagged red.
  function validateForm({ requirePassword }) {
    if (!form.full_name.trim()) return { message: 'Full name is required.', field: 'full_name' }
    if (!form.email.trim())     return { message: 'Email is required.', field: 'email' }
    if (requirePassword && form.password.length < 8) {
      return { message: 'Password must be at least 8 characters.', field: 'password' }
    }
    if (!form.entity_id)        return { message: 'Entity is required.', field: 'entity_id' }
    if (!form.department_id)    return { message: 'Department is required.', field: 'department_id' }
    if (!form.designation_id)   return { message: 'Designation is required.', field: 'designation_id' }
    if (!form.permission_level || !PERM_TIERS.includes(form.permission_level)) {
      return { message: 'Permission level is required.', field: 'permission_level' }
    }

    const deptCode = deptById[form.department_id]?.code
    if (deptCode === DEPT_SALES && form.brand_ids.length === 0) {
      return { message: 'Select at least one brand for Sales users.', field: 'brand_ids' }
    }
    if (deptCode === DEPT_SALES && form.sales_vertical_ids.length === 0) {
      return { message: 'Select at least one sales vertical for Sales users.', field: 'sales_vertical_ids' }
    }
    if ((deptCode === DEPT_SERVICE || deptCode === DEPT_SPARES) && !form.primary_outlet_id) {
      return { message: 'Primary outlet is required for Service/Spares users.', field: 'primary_outlet_id' }
    }
    if ((deptCode === DEPT_SERVICE || deptCode === DEPT_SPARES) && form.brand_ids.length === 0) {
      return { message: 'Select at least one brand for Service/Spares users.', field: 'brand_ids' }
    }
    if (deptCode === DEPT_BACK_OFFICE && form.permission_level !== 'gm' && !form.subdept_id) {
      return { message: 'Sub-department is required for Back Office users.', field: 'subdept_id' }
    }
    return null
  }

  /* ── build the EF payload from the current form state ───────────────── */
  // Phase 6c.3: legacy text columns dropped. Only the 4-axis UUIDs + join
  // tables are sent. `location` stays as informational free text.
  /* Join-table keys are OMITTED (not sent as []) for any department whose
     control this form never rendered — see DEPTS_WITH_*_PICKER above. Omitting
     makes replaceJoin() leave the table alone; `[]` would delete every row.

     `outlet_ids` is never sent at all: there is no outlet multi-select anywhere
     in this modal, so the form has no opinion on user_outlets and must not
     express one. (It used to send a hardcoded `[]`, which silently wiped that
     table on every single employee save.) */
  function joinKeys(deptCode) {
    const keys = {}
    if (DEPTS_WITH_BRAND_PICKER.has(deptCode))    keys.brand_ids          = form.brand_ids
    if (DEPTS_WITH_VERTICAL_PICKER.has(deptCode)) keys.sales_vertical_ids = form.sales_vertical_ids
    return keys
  }

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
      ...joinKeys(deptCode),
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
      ...joinKeys(deptCode),
    }
  }

  /* ── CREATE employee ────────────────────────────────────────────────── */
  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setErrorField(null)
    const err = validateForm({ requirePassword: true })
    if (err) { setError(err.message); setErrorField(err.field); focusField(err.field); return }

    await runSave(async () => {
      await callEdge('admin-users', 'create', buildCreatePayload())
      toast.success(`${form.full_name} added successfully.`)
      await fetchEmployees()
      closeModal()
    }, toastOnError).catch(() => {})
  }

  /* ── UPDATE employee ────────────────────────────────────────────────── */
  async function handleUpdate(e) {
    e.preventDefault()
    setError('')
    setErrorField(null)
    const err = validateForm({ requirePassword: false })
    if (err) { setError(err.message); setErrorField(err.field); focusField(err.field); return }

    await runSave(async () => {
      await callEdge('admin-users', 'updateProfile', {
        id: selected.id,
        update: buildUpdatePayload(),
      })
      toast.success('Employee updated.')
      await fetchEmployees()
      closeModal()
    }, toastOnError).catch(() => {})
  }

  /* ── RESET PASSWORD ─────────────────────────────────────────────────── */
  async function handleResetPassword(e) {
    e.preventDefault()
    setError('')
    setErrorField(null)
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      setErrorField('new-pw')
      focusField('new-pw')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      setErrorField('confirm-pw')
      focusField('confirm-pw')
      return
    }

    await runSave(async () => {
      await callEdge('admin-users', 'resetPassword', {
        id: selected.id,
        password: newPassword,
      })
      toast.success(`Password updated for ${selected.full_name}.`)
      closeModal()
    }, toastOnError).catch(() => {})
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
    }, toastOnError).catch(() => {})
  }

  /* ── DELETE (permanent) ─────────────────────────────────────────────── */
  async function handleDelete() {
    const emp = confirmAction.employee
    await runSave(async () => {
      await callEdge('admin-users', 'delete', { id: emp.id })
      toast.success(`${emp.full_name} deleted.`)
      await fetchEmployees()
      closeModal()
    }, toastOnError).catch(() => {})
  }

  /* ══ RENDER ═════════════════════════════════════════════════════════ */
  return (
    <div>
      {/* Page header */}
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Operations Tools</div>
          <h1 className="page-head-title">Employees<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Manage team accounts, departments, designations, and access.</div>
        </div>
        <button className="btn btn-primary page-head-right" onClick={openAdd}>
          <Icon name="plus" size={15} /> Add Employee
        </button>
      </div>

      {/* Stat strip */}
      <div className="stat-strip">
        <div className="stat-block">
          <div className="stat-block-label">Total</div>
          <div className="stat-block-value stat-block-value--accent">{stats.total}</div>
        </div>
        <div className="stat-block">
          <div className="stat-block-label">Active</div>
          <div className="stat-block-value" style={{ color: 'var(--green)' }}>{stats.active}</div>
        </div>
        <div className="stat-block">
          <div className="stat-block-label">PTB · Gujarat</div>
          <div className="stat-block-value">{stats.ptb}</div>
        </div>
        <div className="stat-block">
          <div className="stat-block-label">PT · Haryana</div>
          <div className="stat-block-value">{stats.pt}</div>
        </div>
      </div>

      {/* Search inline; the four filters collapse behind a Filters button + popover
          so the toolbar stays one row (they used to stack into a 4-row block on mobile). */}
      <div className="sj-toolbar" style={{ marginBottom: 16 }}>
        <input
          className="form-input sj-search"
          style={{ marginBottom: 0 }}
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="sj-filter-wrap" ref={filterRef}>
          <button type="button" className={`btn btn-secondary sj-filter-btn${activeFilterCount ? ' has-active' : ''}`}
            aria-haspopup="dialog" aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)}>
            <Icon name="filter-alt" size={15} /> Filters
            {activeFilterCount > 0 && <span className="sj-filter-badge">{activeFilterCount}</span>}
          </button>
          {showFilters && (
            <div className="sj-filter-pop" role="dialog" aria-label="Filter employees">
              <div className="form-group">
                <label className="form-label" htmlFor="emp-f-entity">Entity</label>
                <select id="emp-f-entity" className="form-select"
                  value={filterEntityId} onChange={e => setFilterEntityId(e.target.value)}>
                  <option value="">All Entities</option>
                  {refEntities.map(e => <option key={e.id} value={e.id}>{e.code}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-f-dept">Department</label>
                <select id="emp-f-dept" className="form-select"
                  value={filterDeptId} onChange={e => setFilterDeptId(e.target.value)}>
                  <option value="">All Departments</option>
                  {refDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-f-tier">Permission level</label>
                <select id="emp-f-tier" className="form-select"
                  value={filterTier} onChange={e => setFilterTier(e.target.value)}>
                  <option value="">All Levels</option>
                  <option value="admin">{PERM_LABEL.admin}</option>
                  {PERM_TIERS.map(r => <option key={r} value={r}>{PERM_LABEL[r]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-f-status">Status</label>
                <select id="emp-f-status" className="form-select"
                  value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                  <option value="">All</option>
                </select>
              </div>
              <div className="sj-filter-pop-foot">
                <button type="button" className="btn btn-sm btn-secondary" disabled={!activeFilterCount}
                  onClick={() => { setFilterEntityId(''); setFilterDeptId(''); setFilterTier(''); setFilterStatus('active') }}>
                  Clear filters
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowFilters(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={6} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="users" size={40} color="var(--text-muted)" /></div>
          <h3>No employees found</h3>
          <p>Try adjusting the filters or add a new employee.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap only-desktop">
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
                      <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{emp.full_name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{emp.email}</td>
                      <td><span className="badge badge-blue">{ent?.code || '—'}</span></td>
                      <td>
                        <div style={{ fontSize: 13 }}>{dept?.name || '—'}</div>
                        {desig?.name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desig.name}</div>}
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

          <div className="only-mobile mobile-cards">
            {filtered.map(emp => {
              const dept = deptById[emp.department_id]
              const desig = designationById[emp.designation_id]
              const ent = entityById[emp.entity_id]
              return (
                <div className="m-card" key={emp.id}>
                  <div className="m-card-top">
                    <span style={{ fontWeight: 700 }}>{emp.full_name}</span>
                    <Badge tier={emp.permission_level} />
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{emp.email}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span className="badge badge-blue">{ent?.code || '—'}</span>
                    <span style={{ fontSize: 12.5 }}>{dept?.name || '—'}{desig?.name ? <span style={{ color: 'var(--text-secondary)' }}> · {desig.name}</span> : null}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-faint)', gap: 8, flexWrap: 'wrap' }}>
                    <StatusBadge active={emp.is_active} />
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
                  </div>
                </div>
              )
            })}
          </div>
        </>
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
          errorField={errorField}
          setErrorField={setErrorField}
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
              <form onSubmit={handleResetPassword} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-new">New Password</label>
                  <input id="pw-new" className={`form-input ${errorField === 'new-pw' ? 'error' : ''}`} type="password" placeholder="Min. 8 characters"
                    value={newPassword}
                    onChange={e => { setNewPassword(e.target.value); setErrorField(f => f === 'new-pw' ? null : f) }}
                    autoFocus />
                  {errorField === 'new-pw' && <div className="form-error">{error}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-confirm">Confirm Password</label>
                  <input id="pw-confirm" className={`form-input ${errorField === 'confirm-pw' ? 'error' : ''}`} type="password" placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setErrorField(f => f === 'confirm-pw' ? null : f) }} />
                  {errorField === 'confirm-pw' && <div className="form-error">{error}</div>}
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
                  <p style={{ fontSize: 14, color: 'var(--gray-600)', lineHeight: 1.6 }}>
                    Permanently deleting <strong>{confirmAction.employee.full_name}</strong> will remove their
                    account and all associated data. Consider deactivating instead.
                  </p>
                  <div className="form-error" style={{ marginTop: 8, fontWeight: 600 }}>
                    This is permanent and cannot be undone.
                  </div>
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
  errorField,
  setErrorField,
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
    onChange: e => {
      setForm(f => ({ ...f, [field]: e.target.value }))
      setErrorField(f => f === field ? null : f)
    },
  })
  // Red-border helper + the inline message rendered right under the control.
  const cls = (base, field) => `${base} ${errorField === field ? 'error' : ''}`
  const FieldError = ({ field }) => (
    errorField === field ? <div className="form-error">{error}</div> : null
  )

  const title = mode === 'add' ? 'Add Employee' : `Edit — ${selected?.full_name}`

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeModal()}>
      <div className="modal" ref={trapRef} tabIndex={-1} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={closeModal}>×</button>
        </div>
        <div className="modal-body">
          <form onSubmit={onSubmit} noValidate>
            {/* Identity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-name">Full Name *</label>
                <input id="emp-name" className={cls('form-input', 'full_name')} placeholder="Ramesh Kumar" {...F('full_name')} />
                <FieldError field="full_name" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-email">Email *</label>
                <input
                  id="emp-email" className={cls('form-input', 'email')} type="email"
                  placeholder="ramesh@parastrucks.in"
                  value={form.email}
                  onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setErrorField(f => f === 'email' ? null : f) }}
                  disabled={mode === 'edit'}
                  style={mode === 'edit' ? { opacity: 0.6 } : undefined}
                />
                <FieldError field="email" />
              </div>
              {mode === 'add' && (
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-pw">Temporary Password *</label>
                  <input id="emp-pw" className={cls('form-input', 'password')} type="password" placeholder="Min. 8 characters" {...F('password')} />
                  <FieldError field="password" />
                </div>
              )}
            </div>

            {/* Organisational axes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-entity">Entity *</label>
                <select
                  id="emp-entity" className={cls('form-select', 'entity_id')}
                  value={form.entity_id}
                  onChange={e => onEntityChange(e.target.value)}
                  disabled={callerEntityLocked}
                  style={callerEntityLocked ? { opacity: 0.6 } : undefined}
                >
                  <option value="">— Select —</option>
                  {refEntities.map(en => <option key={en.id} value={en.id}>{en.code}</option>)}
                </select>
                <FieldError field="entity_id" />
                {callerEntityLocked && (
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                    Locked to your entity. Admin can create cross-entity users.
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-dept">Department *</label>
                <select
                  id="emp-dept" className={cls('form-select', 'department_id')}
                  value={form.department_id}
                  onChange={e => onDepartmentChange(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {refDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <FieldError field="department_id" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-desig">Designation *</label>
                <select
                  id="emp-desig" className={cls('form-select', 'designation_id')}
                  value={form.designation_id}
                  onChange={e => onDesignationChange(e.target.value)}
                  disabled={!form.department_id}
                >
                  <option value="">— Select —</option>
                  {designationsForDept.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <FieldError field="designation_id" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-tier">Permission Level *</label>
                <select id="emp-tier" className={cls('form-select', 'permission_level')} {...F('permission_level')}>
                  {PERM_TIERS.map(t => <option key={t} value={t}>{PERM_LABEL[t]}</option>)}
                </select>
                <FieldError field="permission_level" />
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                  Auto-filled from designation. Admin tier never offered.
                </div>
              </div>
            </div>

            {/* Department-specific section */}
            {deptCode === 'sales' && (
              <DeptSection title="Sales details">
                <MultiCheckbox
                  id="emp-brands"
                  label="Brands *"
                  items={refBrands}
                  selected={form.brand_ids}
                  onToggle={id => {
                    setErrorField(f => f === 'brand_ids' ? null : f)
                    setForm(f => {
                      const nextBrands = toggleId(f.brand_ids, id)
                      // Prune any selected verticals whose brand is no longer checked.
                      // Uses the full sales_verticals list so we compare against
                      // ground truth, not the currently-rendered subset.
                      const nextVerts = f.sales_vertical_ids.filter(vId => {
                        const row = refSalesVert.find(v => v.id === vId)
                        return row && nextBrands.includes(row.brand_id)
                      })
                      return { ...f, brand_ids: nextBrands, sales_vertical_ids: nextVerts }
                    })
                  }}
                  labelKey="name"
                  badgeKey="code"
                  error={errorField === 'brand_ids' ? error : null}
                />
                <MultiCheckbox
                  id="sales-verticals"
                  label="Sales verticals *"
                  items={verticalsForBrands}
                  selected={form.sales_vertical_ids}
                  onToggle={id => {
                    setErrorField(f => f === 'sales_vertical_ids' ? null : f)
                    setForm(f => ({ ...f, sales_vertical_ids: toggleId(f.sales_vertical_ids, id) }))
                  }}
                  labelKey="name"
                  emptyHint={form.brand_ids.length === 0 ? 'Select one or more brands first.' : null}
                  error={errorField === 'sales_vertical_ids' ? error : null}
                />
              </DeptSection>
            )}

            {(deptCode === 'service' || deptCode === 'spares') && (
              <DeptSection title={deptCode === 'service' ? 'Service details' : 'Spares details'}>
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-outlet">Primary outlet *</label>
                  <select
                    id="emp-outlet" className={cls('form-select', 'primary_outlet_id')}
                    value={form.primary_outlet_id}
                    onChange={e => {
                      setForm(f => ({ ...f, primary_outlet_id: e.target.value }))
                      setErrorField(f => f === 'primary_outlet_id' ? null : f)
                    }}
                    disabled={!form.entity_id}
                  >
                    <option value="">— Select —</option>
                    {outletsForEntity.map(o => (
                      <option key={o.id} value={o.id}>{o.city} ({o.facility_type})</option>
                    ))}
                  </select>
                  <FieldError field="primary_outlet_id" />
                </div>
                <MultiCheckbox
                  id="emp-brands"
                  label="Brands *"
                  items={refBrands}
                  selected={form.brand_ids}
                  onToggle={id => {
                    setErrorField(f => f === 'brand_ids' ? null : f)
                    setForm(f => ({ ...f, brand_ids: toggleId(f.brand_ids, id) }))
                  }}
                  labelKey="name"
                  badgeKey="code"
                  error={errorField === 'brand_ids' ? error : null}
                />
              </DeptSection>
            )}

            {deptCode === 'back_office' && (
              <DeptSection title="Back Office details">
                {form.permission_level !== 'gm' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="emp-subdept">Sub-department *</label>
                    <select
                      id="emp-subdept" className={cls('form-select', 'subdept_id')}
                      value={form.subdept_id}
                      onChange={e => {
                        setForm(f => ({ ...f, subdept_id: e.target.value }))
                        setErrorField(f => f === 'subdept_id' ? null : f)
                      }}
                    >
                      <option value="">— Select —</option>
                      {refSubdepts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <FieldError field="subdept_id" />
                  </div>
                )}
                <MultiCheckbox
                  id="emp-brands"
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
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <span className="spinner spinner-sm" /> : (mode === 'add' ? 'Create Employee' : 'Save Changes')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              {canDelete && (
                <button type="button" className="btn btn-danger modal-actions-end" onClick={onDelete}>
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
function MultiCheckbox({ id, label, items, selected, onToggle, labelKey = 'name', badgeKey, emptyHint, error }) {
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
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

