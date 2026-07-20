import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { fetchAllRows } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import useFocusTrap from '../hooks/useFocusTrap'

/* ── CONSTANTS ───────────────────────────────────────────────── */
// Must contain every segment value that actually exists in the data. Prod uses
// seven; this list carried six, so the 11 families in 'MBP Truck' rendered with
// a blank segment dropdown (the <select> had no matching <option>). The form
// keeps the original value unless the user touches the field, so nothing was
// silently rewritten — but picking any option also clears sub_category, so an
// idle click on a blank dropdown could strand a family's CBNs.
//
// 'MBP Truck' was legacy: Phase 9.7b consolidates it into 'Long Haul Trucks'
// (owner-approved 2026-07-16 — an earlier rename was started and left half
// done). The consolidation migration ships in the same release as this file,
// and the cutover order runs migrations before the frontend deploy — so by the
// time this list renders, no row says 'MBP Truck' and offering it would only
// let an admin re-file vehicles into the just-eliminated segment (invisible to
// every quotation segment tab).
const SEGMENTS = [
  'ICV Truck', 'Long Haul Trucks', 'Tipper',
  'Bus – ICV', 'Bus – MCV', 'RMC / Boom Pump',
]

// Phase 6c.1: the old VERTICAL_SEGMENTS map is gone. vehicle_catalog.brand_id
// and vehicle_catalog.sales_vertical_id (populated by the Stage 1 migration)
// are now the source of truth; SalesCatalog queries them directly against
// user_brands + user_sales_verticals. Rows with sales_vertical_id IS NULL
// (e.g. HDH Excavators, anything whose vertical isn't structurally scoped)
// remain visible to all brand-assigned users, matching the plan 6b.1.2 RLS.

const PER_PAGE = 50

/* ── HELPERS ─────────────────────────────────────────────────── */
function fmtMRP(n) {
  if (!n && n !== 0) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}

// fetchAllRows now lives in ../lib/fetchAll — the quotation-path pages need it
// too (Phase 9.7 R2). See that file for why unpaginated selects are unsafe here.

/* ══════════════════════════════════════════════════════════════
   MAIN EXPORT — routes to admin or sales view
══════════════════════════════════════════════════════════════ */
export default function Catalog() {
  const { profile, isAdmin } = useAuth()
  // Phase 6c.3: Back Office is identified by department_id → departments.code.
  // Loaded once per mount. Render a spinner until the lookup completes so we
  // don't flash the Sales view to a BO user on first paint.
  const [canManage, setCanManage] = useState(null) // null = loading
  useEffect(() => {
    let cancelled = false
    if (!profile) return
    if (isAdmin) { setCanManage(true); return }
    if (!profile.department_id) { setCanManage(false); return }
    supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setCanManage(data?.code === 'back_office')
      })
    return () => { cancelled = true }
  }, [profile?.id, profile?.department_id, isAdmin])

  if (!profile || canManage === null) return <div style={{ padding: 40 }}><div className="spinner" /></div>
  return canManage ? <AdminCatalog profile={profile} /> : <SalesCatalog profile={profile} />
}

/* ══════════════════════════════════════════════════════════════
   ADMIN / BACK-OFFICE VIEW
══════════════════════════════════════════════════════════════ */
function AdminCatalog() {
  const [tab, setTab]       = useState('vehicles')
  const [vehicles, setVehicles] = useState([])
  const [subSegs, setSubSegs]   = useState([])
  const [vLoading, setVLoading] = useState(true)
  const [ssLoading, setSsLoading] = useState(true)

  const fetchVehicles = useCallback(async () => {
    setVLoading(true)
    try {
      // Paginated: the table is past PostgREST's 1000-row cap. See fetchAllRows.
      const data = await fetchAllRows(() => supabase
        .from('vehicle_catalog')
        .select('id, cbn, description, brand, segment, sub_segment_id, sub_category, tyres, mrp_incl_gst, gst_rate, price_circular, effective_date, is_active')
        .order('segment')
        .order('sub_category')
        .order('cbn'))
      setVehicles(data)
    } catch (e) { console.error(e) }
    finally { setVLoading(false) }
  }, [])

  const fetchSubSegs = useCallback(async () => {
    setSsLoading(true)
    try {
      const { data, error } = await supabase
        .from('sub_segments')
        .select('*')
        .order('segment')
        .order('name')
      if (!error) setSubSegs(data || [])
    } catch (e) { console.error(e) }
    finally { setSsLoading(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchVehicles()
    fetchSubSegs()
    return () => { cancelled = true }
  }, [fetchVehicles, fetchSubSegs])

  // Count of unassigned active CBNs — the triage backlog, shown as a badge so
  // the queue can't sit forgotten.
  const triageCount = useMemo(
    () => vehicles.filter(v => v.is_active && !v.sub_segment_id).length,
    [vehicles]
  )

  const TABS = [
    { key: 'vehicles',      label: 'Vehicles' },
    { key: 'reshuffle',     label: 'Reshuffle' },
    { key: 'triage',        label: triageCount > 0 ? `Triage (${triageCount})` : 'Triage' },
    { key: 'rules',         label: 'Rules' },
    { key: 'sub-segments',  label: 'Sub-Segments' },
    { key: 'import',        label: 'Import' },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Sales Tools</div>
          <h1 className="page-head-title">Vehicle Catalog<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Manage vehicles, sub-segments and import price circulars</div>
        </div>
      </div>

      <div className="vc-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`vc-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'vehicles' && (
        <VehiclesTab
          vehicles={vehicles}
          subSegs={subSegs}
          loading={vLoading}
          onRefresh={fetchVehicles}
        />
      )}
      {tab === 'reshuffle' && (
        <ReshuffleTab
          vehicles={vehicles}
          subSegs={subSegs}
          loading={vLoading}
          onRefresh={() => { fetchVehicles(); fetchSubSegs() }}
        />
      )}
      {tab === 'triage' && (
        <TriageTab
          vehicles={vehicles}
          subSegs={subSegs}
          loading={vLoading}
          onRefresh={() => { fetchVehicles(); fetchSubSegs() }}
        />
      )}
      {tab === 'rules' && (
        <RulesTab subSegs={subSegs} />
      )}
      {tab === 'sub-segments' && (
        <SubSegmentsTab
          subSegs={subSegs}
          vehicles={vehicles}
          loading={ssLoading}
          // Phase 9.7a: saving a sub-segment can now write vehicle_catalog too —
          // a rename rewrites sub_category on every linked CBN, and add-mode
          // assignment sets sub_segment_id. Refetching only sub_segments left the
          // Vehicles tab showing the old family name until a manual reload.
          onRefresh={() => { fetchSubSegs(); fetchVehicles() }}
        />
      )}
      {tab === 'import' && (
        <ImportTab subSegs={subSegs} onRefresh={fetchVehicles} />
      )}
    </div>
  )
}

/* ── VEHICLES TAB ────────────────────────────────────────────── */
function VehiclesTab({ vehicles, subSegs, loading, onRefresh }) {
  const toast = useToast()
  const [searchInput,     setSearchInput]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterSeg,       setFilterSeg]       = useState('')
  const [filterStatus,    setFilterStatus]    = useState('active')
  const [page,            setPage]            = useState(1)
  const [modal,           setModal]           = useState(null)  // 'add'|'edit'
  const [selected,        setSelected]        = useState(null)
  const [confirming,      setConfirming]      = useState(null)
  const [saving,          setSaving]          = useState(false)
  const confirmTrapRef = useFocusTrap(!!confirming, () => setConfirming(null))

  // Local 150 ms debounce so fast typists don't re-filter on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 150)
    return () => clearTimeout(t)
  }, [searchInput])

  const filtered = useMemo(() => {
    let list = vehicles
    if (filterStatus === 'active')   list = list.filter(v => v.is_active)
    if (filterStatus === 'inactive') list = list.filter(v => !v.is_active)
    if (filterSeg)                   list = list.filter(v => v.segment === filterSeg)
    if (debouncedSearch.trim()) {
      const s = debouncedSearch.trim().toLowerCase()
      const mrpNum = s.replace(/[₹,\s]/g, '')
      list = list.filter(v =>
        v.cbn.toLowerCase().includes(s) ||
        v.description.toLowerCase().includes(s) ||
        (v.sub_category && v.sub_category.toLowerCase().includes(s)) ||
        String(v.mrp_incl_gst).includes(mrpNum)
      )
    }
    return list
  }, [vehicles, debouncedSearch, filterSeg, filterStatus])

  const paged = useMemo(() => {
    const start = (page - 1) * PER_PAGE
    return filtered.slice(start, start + PER_PAGE)
  }, [filtered, page])

  const totalPages = Math.ceil(filtered.length / PER_PAGE)

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, filterSeg, filterStatus])

  async function toggleActive(v) {
    setSaving(true)
    try {
      await callEdge('admin-catalog', 'toggleVehicleActive', {
        id: v.id,
        is_active: !v.is_active,
      })
    } catch (e) {
      toast.error('Toggle failed: ' + e.message)
    }
    setSaving(false)
    setConfirming(null)
    onRefresh()
  }

  return (
    <>
      {/* Controls */}
      <div className="vc-controls">
        <input
          className="form-input vc-search"
          placeholder="Search CBN, description, sub-segment or MRP…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />
        <div className="vc-filters">
          <select className="form-select" value={filterSeg} onChange={e => setFilterSeg(e.target.value)}>
            <option value="">All Segments</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setSelected(null); setModal('add') }}
          >
            + Add Vehicle
          </button>
        </div>
      </div>

      <div className="vc-stats-row">
        <span>{filtered.length} of {vehicles.length} vehicles</span>
        {searchInput && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSearchInput('')}>
            Clear search
          </button>
        )}
      </div>

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="truck" size={36} color="var(--text-muted)" /></div>
          <h3>No vehicles found</h3>
          <p>Try adjusting your search or filters</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-wrap vc-desktop-table">
            <table>
              <thead>
                <tr>
                  <th>CBN</th>
                  <th>Description</th>
                  <th>Sub-Segment</th>
                  <th>Segment</th>
                  <th style={{ textAlign: 'right' }}>MRP (incl. GST)</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(v => (
                  <tr key={v.id}>
                    <td className="vc-cbn">{v.cbn}</td>
                    <td className="vc-desc" title={v.description}>{v.description}</td>
                    <td>{v.sub_category || '—'}</td>
                    <td><span className="badge badge-blue">{v.segment}</span></td>
                    <td className="vc-mrp-cell">{fmtMRP(v.mrp_incl_gst)}</td>
                    <td>
                      <span className={`badge ${v.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {v.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="vc-row-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setSelected(v); setModal('edit') }}
                        >
                          Edit
                        </button>
                        <button
                          className={`btn btn-sm ${v.is_active ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => setConfirming(v)}
                        >
                          {v.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="vc-mobile-cards">
            {paged.map(v => (
              <div key={v.id} className="vc-vehicle-card">
                <div className="vc-vc-top">
                  <span className="vc-vc-cbn">{v.cbn}</span>
                  <span className={`badge ${v.is_active ? 'badge-green' : 'badge-gray'}`}>
                    {v.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="vc-vc-desc">{v.description}</div>
                <div className="vc-vc-meta">
                  <span>{v.sub_category || '—'}</span>
                  <span className="vc-vc-mrp">{fmtMRP(v.mrp_incl_gst)}</span>
                </div>
                <div className="vc-row-actions mt-8">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setSelected(v); setModal('edit') }}
                  >
                    Edit
                  </button>
                  <button
                    className={`btn btn-sm ${v.is_active ? 'btn-danger' : 'btn-secondary'}`}
                    onClick={() => setConfirming(v)}
                  >
                    {v.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="vc-pagination">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => p - 1)}
                disabled={page === 1}
              >
                ← Prev
              </button>
              <span className="vc-page-info">
                Page {page} of {totalPages} · {filtered.length} vehicles
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <VehicleModal
          mode={modal}
          vehicle={selected}
          subSegs={subSegs}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh() }}
        />
      )}

      {/* Confirm deactivate / activate */}
      {confirming && (
        <div className="modal-overlay">
          <div className="modal" ref={confirmTrapRef} tabIndex={-1} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>{confirming.is_active ? 'Deactivate' : 'Activate'} Vehicle</h2>
              <button className="modal-close" onClick={() => setConfirming(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 16 }}>
                {confirming.is_active
                  ? `Deactivating ${confirming.cbn} will hide it from quotation search.`
                  : `Activating ${confirming.cbn} will make it visible in quotation search again.`}
              </p>
              <div className="flex gap-8">
                <button className="btn btn-secondary" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
                <button
                  className={`btn ${confirming.is_active ? 'btn-danger' : 'btn-primary'}`}
                  disabled={saving}
                  onClick={() => toggleActive(confirming)}
                >
                  {saving
                    ? <span className="spinner spinner-sm" />
                    : confirming.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── VEHICLE ADD / EDIT MODAL ────────────────────────────────── */
const EMPTY_VEHICLE = {
  cbn: '', description: '', brand: 'al', segment: SEGMENTS[0],
  sub_segment_id: '', sub_category: '',
  tyres: '', mrp_incl_gst: '', gst_rate: 18,
  price_circular: '', effective_date: '', is_active: true,
}

function VehicleModal({ mode, vehicle, subSegs, onClose, onSaved }) {
  const toast = useToast()
  const trapRef = useFocusTrap(true, onClose)
  const [form,   setForm]   = useState(
    mode === 'edit'
      ? { ...vehicle, mrp_incl_gst: vehicle.mrp_incl_gst ?? '' }
      : EMPTY_VEHICLE
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [errorField, setErrorField] = useState(null) // which field to flag red on validation

  // Phase 9.7a: options carry the whole family row now, not just its name —
  // the <select> binds to sub_segment_id. Still filtered by segment only (not
  // brand), matching the pre-9.7 behaviour deliberately: narrowing by brand
  // here would be a separate change with its own blast radius.
  //
  // Phase 9.7b (R4): retired families are not assignment targets. But a vehicle
  // ALREADY in a retired family must still show it — dropping it from the
  // options would render the field blank against a non-empty value, which is
  // exactly the MBP Truck bug (and picking any option then silently clears the
  // family). So: active families, plus this vehicle's current one regardless.
  const subSegOptions = useMemo(
    () => subSegs.filter(ss =>
      ss.segment === form.segment &&
      (ss.is_active || ss.id === form.sub_segment_id)
    ),
    [subSegs, form.segment, form.sub_segment_id]
  )

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
    setErrorField(null)
  }

  // Flag the offending field red, show the message under it, and scroll/focus it.
  function fail(msg, field, elId) {
    setError(msg)
    setErrorField(field)
    const el = document.getElementById(elId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }) } catch { el.focus() } }
    }
  }

  async function save() {
    setError('')
    setErrorField(null)
    if (!form.cbn.trim())         { fail('CBN is required',         'cbn',          'vm-cbn');     return }
    if (!form.description.trim()) { fail('Description is required', 'description',  'vm-desc');    return }
    if (!form.segment)            { fail('Segment is required',     'segment',      'vm-segment'); return }
    if (!form.mrp_incl_gst)       { fail('MRP is required',         'mrp_incl_gst', 'vm-mrp');     return }

    setSaving(true)
    const payload = {
      cbn:            form.cbn.trim().toUpperCase(),
      description:    form.description.trim(),
      brand:          form.brand || 'al',
      segment:        form.segment,
      sub_segment_id: form.sub_segment_id || null,
      sub_category:   form.sub_category || null,
      tyres:          form.tyres || null,
      mrp_incl_gst:   parseInt(form.mrp_incl_gst),
      gst_rate:       parseFloat(form.gst_rate) || 18,
      price_circular: form.price_circular || null,
      effective_date: form.effective_date || null,
      is_active:      form.is_active,
    }

    try {
      if (mode === 'add') {
        await callEdge('admin-catalog', 'createVehicle', payload)
      } else {
        await callEdge('admin-catalog', 'updateVehicle', { id: vehicle.id, update: payload })
      }
    } catch (e) {
      setSaving(false)
      toast.error('Save failed: ' + e.message)
      return
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal vc-wide-modal" ref={trapRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === 'add' ? 'Add Vehicle' : 'Edit Vehicle'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-cbn">CBN *</label>
              <input
                id="vm-cbn"
                className={`form-input ${errorField === 'cbn' ? 'error' : ''}`}
                value={form.cbn}
                onChange={e => set('cbn', e.target.value)}
                disabled={mode === 'edit'}
                placeholder="e.g. CDB111505C0004_YW"
              />
              {errorField === 'cbn' && <div className="form-error">{error}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vm-mrp">MRP incl. GST (₹) *</label>
              <input
                id="vm-mrp"
                className={`form-input ${errorField === 'mrp_incl_gst' ? 'error' : ''}`}
                type="number"
                value={form.mrp_incl_gst}
                onChange={e => set('mrp_incl_gst', e.target.value)}
                placeholder="e.g. 2147202"
              />
              {errorField === 'mrp_incl_gst' && <div className="form-error">{error}</div>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="vm-desc">Description *</label>
            <textarea
              id="vm-desc"
              className={`form-input ${errorField === 'description' ? 'error' : ''}`}
              rows={3}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Full vehicle description as in price list"
            />
            {errorField === 'description' && <div className="form-error">{error}</div>}
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-brand">Brand *</label>
              <select id="vm-brand" className="form-select" value={form.brand} onChange={e => set('brand', e.target.value)}>
                <option value="al">Ashok Leyland</option>
                <option value="switch">Switch Mobility</option>
                <option value="hdh">HD Hyundai</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vm-segment">Segment *</label>
              <select
                id="vm-segment"
                className="form-select"
                value={form.segment}
                onChange={e => {
                  // Changing segment invalidates the family — drop BOTH halves
                  // of the link, or the row keeps an id pointing at a family in
                  // the old segment.
                  setForm(f => ({
                    ...f, segment: e.target.value, sub_segment_id: null, sub_category: '',
                  }))
                  setError(''); setErrorField(null)
                }}
              >
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-subseg">Sub-Segment</label>
              {subSegOptions.length > 0 ? (
                <select
                  id="vm-subseg"
                  className="form-select"
                  value={form.sub_segment_id ?? ''}
                  onChange={e => {
                    // Keep the id and the text in lockstep — the id is the link,
                    // the text is what Quotation search still reads.
                    const id = e.target.value
                    const ss = subSegOptions.find(o => String(o.id) === id)
                    setForm(f => ({
                      ...f,
                      sub_segment_id: id ? Number(id) : null,
                      sub_category:   ss ? ss.name : null,
                    }))
                    setError(''); setErrorField(null)
                  }}
                >
                  <option value="">— Select —</option>
                  {subSegOptions.map(ss => (
                    <option key={ss.id} value={ss.id}>
                      {ss.name}{ss.is_active ? '' : ' (retired)'}
                    </option>
                  ))}
                </select>
              ) : (
                // No families in this segment yet. Free text still allowed, but
                // it produces an UNLINKED row (sub_segment_id null) that surfaces
                // in 9.7b's import-triage queue rather than silently vanishing.
                <input
                  id="vm-subseg"
                  className="form-input"
                  value={form.sub_category || ''}
                  onChange={e => setForm(f => ({
                    ...f, sub_category: e.target.value, sub_segment_id: null,
                  }))}
                  placeholder="Sub-segment name"
                />
              )}
            </div>
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-tyres">Tyres</label>
              <input
                id="vm-tyres"
                className="form-input"
                value={form.tyres || ''}
                onChange={e => set('tyres', e.target.value)}
                placeholder="e.g. 11R22.5 (16+2)"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vm-gst">GST Rate (%)</label>
              <input
                id="vm-gst"
                className="form-input"
                type="number"
                value={form.gst_rate}
                onChange={e => set('gst_rate', e.target.value)}
              />
            </div>
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-pc">Price Circular</label>
              <input
                id="vm-pc"
                className="form-input"
                value={form.price_circular || ''}
                onChange={e => set('price_circular', e.target.value)}
                placeholder="e.g. Sep2025"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vm-effdate">Effective Date</label>
              <input
                id="vm-effdate"
                className="form-input"
                type="date"
                value={form.effective_date || ''}
                onChange={e => set('effective_date', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group flex gap-8" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              id="vc-active"
              checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)}
            />
            <label htmlFor="vc-active" style={{ fontSize: 14, cursor: 'pointer' }}>
              Active (visible in quotation search)
            </label>
          </div>

          <div className="flex gap-8 mt-16">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>
              {saving
                ? <span className="spinner spinner-sm" />
                : mode === 'add' ? 'Add Vehicle' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── RESHUFFLE TAB (Phase 9.7b) ──────────────────────────────── */
/* Filter CBNs, select them (including every match, not just the visible page),
   and move them to another family in one server-side call. Replaces the old
   assign-CBNs-inside-the-add-modal flow, which could only assign at creation.

   The whole tab runs off the already-loaded `vehicles` array, which is fully
   paginated (see fetchAllRows) — that matters more here than anywhere else:
   "select all matching" over a silently truncated list would drive a bulk
   reassign that quietly skips rows. */
function ReshuffleTab({ vehicles, subSegs, loading, onRefresh }) {
  const toast = useToast()
  const [filterInput, setFilterInput]   = useState('')
  const [filter, setFilter]             = useState('')
  const [filterSeg, setFilterSeg]       = useState('')
  const [filterFam, setFilterFam]       = useState('')   // '' all · 'none' unassigned · <id>
  const [selected, setSelected]         = useState(new Set())
  const [dest, setDest]                 = useState('')
  const [moving, setMoving]             = useState(false)
  const [confirming, setConfirming]     = useState(false)
  const [newFamOpen, setNewFamOpen]     = useState(false)
  const confirmTrapRef = useFocusTrap(confirming, () => setConfirming(null))

  useEffect(() => {
    const t = setTimeout(() => setFilter(filterInput), 150)
    return () => clearTimeout(t)
  }, [filterInput])

  const famById = useMemo(
    () => Object.fromEntries(subSegs.map(ss => [ss.id, ss])),
    [subSegs]
  )

  // Tokenised: every token must appear in CBN + description + family text.
  // Matches how the employees actually search (they know CBNs and families
  // cold, and type fragments of both).
  const matches = useMemo(() => {
    let list = vehicles.filter(v => v.is_active)
    if (filterSeg) list = list.filter(v => v.segment === filterSeg)
    if (filterFam === 'none')      list = list.filter(v => !v.sub_segment_id)
    else if (filterFam)            list = list.filter(v => String(v.sub_segment_id) === filterFam)
    const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length) {
      list = list.filter(v => {
        const hay = `${v.cbn} ${v.description} ${v.sub_category || ''}`.toLowerCase()
        return tokens.every(t => hay.includes(t))
      })
    }
    return list
  }, [vehicles, filter, filterSeg, filterFam])

  // Selection survives filter changes (you may filter twice to build one set),
  // so the count shown is always of what will ACTUALLY move, not what is visible.
  const selectedList = useMemo(() => [...selected], [selected])
  const allMatchingSelected = matches.length > 0 && matches.every(v => selected.has(v.cbn))

  const destFam = dest ? famById[Number(dest)] : null
  // Which of the selected CBNs are crossing segments — the case that silently
  // corrupted data before R10. Surfaced so the admin sees it before committing.
  const crossSegment = useMemo(() => {
    if (!destFam) return []
    return selectedList
      .map(c => vehicles.find(v => v.cbn === c))
      .filter(v => v && v.segment !== destFam.segment)
  }, [selectedList, destFam, vehicles])

  async function doMove() {
    setMoving(true)
    try {
      const res = await callEdge('admin-catalog', 'moveCbns', {
        cbns: selectedList,
        sub_segment_id: dest === 'none' ? null : Number(dest),
      })
      // Report what the server actually moved, not what we asked for: a CBN
      // that no longer exists is a silent no-op server-side.
      if (res.moved !== res.requested) {
        toast.info(`Moved ${res.moved} of ${res.requested} — ${res.requested - res.moved} no longer exist.`)
      } else {
        toast.success(`Moved ${res.moved} CBN${res.moved === 1 ? '' : 's'}${res.family ? ` to ${res.family}` : ' — unassigned'}.`)
      }
      setSelected(new Set())
      setDest('')
      setConfirming(false)
      onRefresh()
    } catch (e) {
      toast.error('Move failed: ' + e.message)
    }
    setMoving(false)
  }

  const activeFams = useMemo(
    () => subSegs.filter(ss => ss.is_active).sort((a, b) =>
      a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name)),
    [subSegs]
  )

  return (
    <>
      <div className="vc-controls">
        <input
          className="form-input vc-search"
          placeholder="Filter by CBN, description or family — every word must match…"
          value={filterInput}
          onChange={e => setFilterInput(e.target.value)}
        />
        <div className="vc-filters">
          <select className="form-select" value={filterSeg} onChange={e => setFilterSeg(e.target.value)}>
            <option value="">All Segments</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-select" value={filterFam} onChange={e => setFilterFam(e.target.value)}>
            <option value="">All Families</option>
            <option value="none">— Unassigned —</option>
            {activeFams.map(ss => <option key={ss.id} value={ss.id}>{ss.name}</option>)}
          </select>
        </div>
      </div>

      <div className="vc-stats-row">
        <span>
          {matches.length} match{matches.length === 1 ? '' : 'es'}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>
        <div className="flex gap-8">
          {matches.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(s => {
                const next = new Set(s)
                if (allMatchingSelected) matches.forEach(v => next.delete(v.cbn))
                else                     matches.forEach(v => next.add(v.cbn))
                return next
              })}
            >
              {allMatchingSelected ? 'Deselect' : 'Select'} all {matches.length} matching
            </button>
          )}
          {selected.size > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          )}
        </div>
      </div>

      {/* Move bar — appears only with a selection */}
      {selected.size > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>Move {selected.size} CBN{selected.size === 1 ? '' : 's'} to:</strong>
          <select className="form-select" style={{ maxWidth: 280 }} value={dest} onChange={e => {
            if (e.target.value === '__new__') { setNewFamOpen(true); return }
            setDest(e.target.value)
          }}>
            <option value="">— Choose family —</option>
            <option value="none">— Unassign (send to triage) —</option>
            {activeFams.map(ss => (
              <option key={ss.id} value={ss.id}>{ss.segment} · {ss.name}</option>
            ))}
            <option value="__new__">+ New sub-segment…</option>
          </select>
          <button className="btn btn-primary btn-sm" disabled={!dest} onClick={() => setConfirming(true)}>
            Move
          </button>
          {crossSegment.length > 0 && (
            <span className="text-small" style={{ color: '#92400e' }}>
              {crossSegment.length} cross{crossSegment.length === 1 ? 'es' : ''} into {destFam.segment}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="truck" size={36} color="var(--text-muted)" /></div>
          <h3>No CBNs match</h3>
          <p>Try a shorter filter, or clear the segment / family filters</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>CBN</th>
                <th>Description</th>
                <th>Current family</th>
                <th>Segment</th>
              </tr>
            </thead>
            <tbody>
              {/* Cap the DOM at 200 rows — a 900-row table is unusable and slow.
                  Select-all still operates on ALL matches, not just these; the
                  banner below says so explicitly so the cap can never be
                  mistaken for the selection being capped too. */}
              {matches.slice(0, 200).map(v => (
                <tr key={v.cbn} style={selected.has(v.cbn) ? { background: 'var(--blue-50, #eff6ff)' } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(v.cbn)}
                      onChange={e => setSelected(s => {
                        const next = new Set(s)
                        e.target.checked ? next.add(v.cbn) : next.delete(v.cbn)
                        return next
                      })}
                    />
                  </td>
                  <td className="vc-cbn">{v.cbn}</td>
                  <td className="vc-desc" title={v.description}>{v.description}</td>
                  <td>
                    {v.sub_segment_id
                      ? (famById[v.sub_segment_id]?.name || v.sub_category)
                      : <span className="badge badge-gray">Unassigned</span>}
                  </td>
                  <td><span className="badge badge-blue">{v.segment}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {matches.length > 200 && (
            <div className="text-small text-gray" style={{ padding: '8px 4px' }}>
              Showing the first 200 of {matches.length}. “Select all {matches.length} matching” covers every match, not just these.
            </div>
          )}
        </div>
      )}

      {/* Confirm — bulk writes get a checkpoint, with the cross-segment warning */}
      {confirming && (
        <div className="modal-overlay">
          <div className="modal" ref={confirmTrapRef} tabIndex={-1} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2>Move {selected.size} CBN{selected.size === 1 ? '' : 's'}</h2>
              <button className="modal-close" onClick={() => setConfirming(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 12 }}>
                {dest === 'none'
                  ? <>These CBNs will be <strong>unassigned</strong> and queue up in import triage. Their segment is kept.</>
                  : <>Moving to <strong>{destFam?.name}</strong> ({destFam?.segment}).</>}
              </p>
              {crossSegment.length > 0 && (
                <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                  <strong>{crossSegment.length} CBN{crossSegment.length === 1 ? '' : 's'} will change segment</strong> to {destFam.segment}.
                  Their segment follows the family — this also changes where they appear in quotation search.
                </div>
              )}
              <div className="flex gap-8">
                <button className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={moving} onClick={doMove}>
                  {moving ? <span className="spinner spinner-sm" /> : 'Move'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Inline "+ new sub-segment…" — create and select it in one stroke */}
      {newFamOpen && (
        <SubSegmentModal
          mode="add"
          subSeg={null}
          inline
          onClose={() => setNewFamOpen(false)}
          onSaved={(created) => {
            setNewFamOpen(false)
            if (created?.id) setDest(String(created.id))
            onRefresh()
          }}
        />
      )}
    </>
  )
}

/* ── RULE MATCHING (shared by Triage) ────────────────────────── */
/* A rule matches a CBN when its pattern appears in "cbn + description" AND none
   of its NOT-terms do. Rules only SUGGEST — a human confirms in triage. When
   several rules match, the one with the most hits wins (most battle-tested);
   `hits` ties break toward the rule that has proven itself, then arbitrarily. */
function suggestFamily(vehicle, rules) {
  const hay = `${vehicle.cbn} ${vehicle.description || ''}`.toLowerCase()
  const matched = rules.filter(r => {
    const pat = r.pattern.trim().toLowerCase()
    if (!pat || !hay.includes(pat)) return false
    return !(r.not_terms || []).some(nt => nt && hay.includes(nt.toLowerCase()))
  })
  if (matched.length === 0) return null
  matched.sort((a, b) => (b.hits || 0) - (a.hits || 0))
  return matched[0].sub_segment_id
}

/* ── TRIAGE TAB (Phase 9.7b3) ─────────────────────────────────── */
/* Unassigned active CBNs — the queue new imports feed and manual unassigns add
   to. Each gets a rule-suggested family the admin can accept, override, or skip.
   Assignment goes through moveCbns (writes id + text + segment together). */
function TriageTab({ vehicles, subSegs, loading, onRefresh }) {
  const toast = useToast()
  const [rules, setRules]     = useState([])
  const [choice, setChoice]   = useState({})   // cbn -> chosen sub_segment_id ('' = skip)
  const [busy, setBusy]       = useState(false)

  const activeFams = useMemo(
    () => subSegs.filter(ss => ss.is_active).sort((a, b) =>
      a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name)),
    [subSegs]
  )

  // Rules are admin-only; fetch here rather than lifting to the parent.
  const loadRules = useCallback(async () => {
    const { data } = await supabase.from('catalog_assign_rules').select('*')
    setRules(data || [])
  }, [])
  useEffect(() => { loadRules() }, [loadRules])

  const queue = useMemo(
    () => vehicles.filter(v => v.is_active && !v.sub_segment_id),
    [vehicles]
  )

  // The effective destination for a row: the admin's explicit override if they
  // set one, otherwise the live rule suggestion. Deriving it (rather than
  // pre-seeding `choice` in an effect) sidesteps a race — rules load async, so
  // any seed that runs before they arrive would lock in a blank the later load
  // can't correct.
  const effective = useCallback((v) => {
    if (choice[v.cbn] !== undefined) return choice[v.cbn]
    const s = suggestFamily(v, rules)
    return s != null ? String(s) : ''
  }, [choice, rules])

  const suggestedCount = queue.filter(v => effective(v)).length

  async function assign(cbnList) {
    // Group by chosen family — moveCbns takes one destination per call.
    const groups = {}
    for (const cbn of cbnList) {
      const v = queue.find(q => q.cbn === cbn)
      const fam = v ? effective(v) : ''
      if (!fam) continue
      ;(groups[fam] ||= []).push(cbn)
    }
    const famIds = Object.keys(groups)
    if (famIds.length === 0) { toast.info('Nothing to assign — pick a family first.'); return }
    setBusy(true)
    let moved = 0
    try {
      for (const fam of famIds) {
        const res = await callEdge('admin-catalog', 'moveCbns', {
          cbns: groups[fam], sub_segment_id: Number(fam),
        })
        moved += res.moved || 0
      }
      // Bump hits on rules whose suggestion was accepted, so the Rules tab can
      // show which ones earn their keep. Best-effort; a failure here doesn't
      // undo the assignment.
      const accepted = cbnList
        .map(cbn => { const v = queue.find(q => q.cbn === cbn); return { v, fam: v ? effective(v) : '' } })
        .filter(x => x.v && x.fam)
      const bumps = {}
      for (const { v, fam } of accepted) {
        const s = suggestFamily(v, rules)
        if (s != null && String(s) === fam) {
          const rule = rules.filter(r => r.sub_segment_id === s)
            .sort((a, b) => (b.hits || 0) - (a.hits || 0))[0]
          if (rule) bumps[rule.id] = (bumps[rule.id] || rule.hits || 0) + 1
        }
      }
      for (const [id, hits] of Object.entries(bumps)) {
        await supabase.from('catalog_assign_rules').update({ hits }).eq('id', id)
      }
      toast.success(`Assigned ${moved} CBN${moved === 1 ? '' : 's'}.`)
      onRefresh(); loadRules()
    } catch (e) {
      toast.error('Assign failed: ' + e.message)
    }
    setBusy(false)
  }

  if (loading) return <Skeleton variant="row" count={4} />

  if (queue.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Icon name="check" size={36} color="var(--text-muted)" /></div>
        <h3>Triage queue is empty</h3>
        <p>Every active vehicle belongs to a family. New unmatched imports show up here.</p>
      </div>
    )
  }

  return (
    <>
      <div className="vc-stats-row">
        <span>{queue.length} unassigned · {suggestedCount} with a suggested family</span>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || suggestedCount === 0}
          onClick={() => assign(queue.filter(v => effective(v)).map(v => v.cbn))}
        >
          {busy ? <span className="spinner spinner-sm" /> : `Accept all ${suggestedCount} suggestions`}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CBN</th>
              <th>Description</th>
              <th>Assign to family</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {queue.slice(0, 200).map(v => {
              const suggested = suggestFamily(v, rules)
              const val = effective(v)
              return (
                <tr key={v.cbn}>
                  <td className="vc-cbn">{v.cbn}</td>
                  <td className="vc-desc" title={v.description}>{v.description}</td>
                  <td>
                    <select
                      className="form-select"
                      style={{ maxWidth: 260 }}
                      value={val}
                      onChange={e => setChoice(c => ({ ...c, [v.cbn]: e.target.value }))}
                    >
                      <option value="">— Skip for now —</option>
                      {activeFams.map(ss => (
                        <option key={ss.id} value={ss.id}>
                          {ss.segment} · {ss.name}{ss.id === suggested ? '  ⟵ suggested' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy || !val}
                      onClick={() => assign([v.cbn])}
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {queue.length > 200 && (
          <div className="text-small text-gray" style={{ padding: '8px 4px' }}>
            Showing the first 200 of {queue.length}. “Accept all” covers every suggested match.
          </div>
        )}
      </div>
    </>
  )
}

/* ── RULES TAB (Phase 9.7b3) ─────────────────────────────────── */
/* CRUD over catalog_assign_rules. Writes go direct via PostgREST — the table's
   RLS already restricts everything to admin/back_office, and these are
   single-table writes with no cross-table invariant to enforce (unlike the
   family lifecycle actions, which is why those live in the EF). */
function RulesTab({ subSegs }) {
  const toast = useToast()
  const [rules, setRules]   = useState([])
  const [loading, setLoad]  = useState(true)
  const [famId, setFamId]   = useState('')
  const [pattern, setPat]   = useState('')
  const [notTerms, setNot]  = useState('')
  const [saving, setSaving] = useState(false)

  const activeFams = useMemo(
    () => subSegs.filter(ss => ss.is_active).sort((a, b) =>
      a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name)),
    [subSegs]
  )
  const famById = useMemo(() => Object.fromEntries(subSegs.map(ss => [ss.id, ss])), [subSegs])

  const load = useCallback(async () => {
    setLoad(true)
    const { data } = await supabase.from('catalog_assign_rules')
      .select('*').order('sub_segment_id')
    setRules(data || [])
    setLoad(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function add() {
    if (!famId)         { toast.error('Pick a family'); return }
    if (!pattern.trim()){ toast.error('Pattern is required'); return }
    setSaving(true)
    const terms = notTerms.split(',').map(t => t.trim()).filter(Boolean)
    const { error } = await supabase.from('catalog_assign_rules').insert({
      sub_segment_id: Number(famId),
      pattern: pattern.trim(),
      not_terms: terms,
    })
    setSaving(false)
    if (error) {
      // Unique (family, pattern) collision surfaces here as a 409-ish message.
      toast.error(/duplicate/i.test(error.message)
        ? 'That family already has this pattern.'
        : 'Save failed: ' + error.message)
      return
    }
    setPat(''); setNot('')
    toast.success('Rule added.')
    load()
  }

  async function remove(id) {
    const { error } = await supabase.from('catalog_assign_rules').delete().eq('id', id)
    if (error) { toast.error('Delete failed: ' + error.message); return }
    load()
  }

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Add a suggestion rule</h3>
        <p className="text-small text-gray" style={{ margin: '0 0 12px' }}>
          When a CBN’s number or description contains the <strong>pattern</strong> and none of the
          <strong> NOT-terms</strong>, this family is suggested during triage. Rules only suggest — you confirm each.
        </p>
        <div className="vc-form-grid">
          <div className="form-group">
            <label className="form-label">Family</label>
            <select className="form-select" value={famId} onChange={e => setFamId(e.target.value)}>
              <option value="">— Choose —</option>
              {activeFams.map(ss => <option key={ss.id} value={ss.id}>{ss.segment} · {ss.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Pattern</label>
            <input className="form-input" value={pattern} onChange={e => setPat(e.target.value)} placeholder="e.g. 1009.9" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">NOT-terms <span className="text-gray">(comma-separated, optional)</span></label>
          <input className="form-input" value={notTerms} onChange={e => setNot(e.target.value)} placeholder="e.g. school, staff" />
        </div>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={add}>
          {saving ? <span className="spinner spinner-sm" /> : 'Add rule'}
        </button>
      </div>

      {loading ? (
        <Skeleton variant="row" count={3} />
      ) : rules.length === 0 ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <h3>No rules yet</h3>
          <p>Add one above to speed up import triage.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Pattern</th>
                <th>NOT-terms</th>
                <th style={{ textAlign: 'right' }}>Accepted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => {
                const fam = famById[r.sub_segment_id]
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>
                      {fam ? fam.name : `#${r.sub_segment_id}`}
                      {fam && !fam.is_active && <span className="badge badge-gray" style={{ marginLeft: 6 }}>retired</span>}
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{r.pattern}</td>
                    <td className="text-small">{(r.not_terms || []).join(', ') || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hits || 0}</td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ── SUB-SEGMENTS TAB ────────────────────────────────────────── */
function SubSegmentsTab({ subSegs, vehicles = [], loading, onRefresh }) {
  const toast = useToast()
  const [modal,       setModal]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [filterBrand, setFilterBrand] = useState('al')
  const [filterState, setFilterState] = useState('active')  // active | retired | all
  const [search,      setSearch]      = useState('')
  const [busyId,      setBusyId]      = useState(null)

  // Live CBN counts per family — drives both the empty-family flag and the
  // retire affordance. Counted from the (fully paginated) vehicles array so it
  // agrees with what the server's retire guard will independently check.
  const cbnCount = useMemo(() => {
    const t = {}
    for (const v of vehicles) if (v.is_active && v.sub_segment_id) t[v.sub_segment_id] = (t[v.sub_segment_id] || 0) + 1
    return t
  }, [vehicles])

  const filtered = useMemo(() => {
    let list = subSegs
    if (filterBrand) list = list.filter(ss => ss.brand === filterBrand)
    if (filterState === 'active')  list = list.filter(ss => ss.is_active)
    if (filterState === 'retired') list = list.filter(ss => !ss.is_active)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(ss =>
        ss.name.toLowerCase().includes(s) ||
        ss.segment.toLowerCase().includes(s)
      )
    }
    return list
  }, [subSegs, filterBrand, filterState, search])

  // c2 backfill — families with a brochure but no cover yet. Rendered in the
  // admin browser because pdfjs needs a DOM/canvas; a Node script can't (no
  // node-canvas installed). This is THE way covers get generated for brochures
  // that were uploaded before c2, so it must be run once on prod at cutover.
  const [covering, setCovering] = useState(null)  // {done,total} | null
  const missingCovers = useMemo(
    () => subSegs.filter(ss => ss.is_active && ss.brochure_url && !ss.cover_url),
    [subSegs]
  )
  async function backfillCovers() {
    if (missingCovers.length === 0) { toast.info('Every brochure already has a cover.'); return }
    setCovering({ done: 0, total: missingCovers.length })
    let ok = 0, fail = 0
    try {
      const { generateCoverWebp } = await import('../lib/coverGen')
      for (const ss of missingCovers) {
        try {
          const { data: signed, error: sErr } = await supabase.storage
            .from('brochures').createSignedUrl(ss.brochure_url, 300)
          if (sErr || !signed?.signedUrl) throw new Error('sign brochure failed')
          const buf = await (await fetch(signed.signedUrl)).arrayBuffer()
          const blob = await generateCoverWebp(buf)
          if (!blob) throw new Error('generate returned null')
          const path = await uploadCoverBlob(blob)
          if (!path) throw new Error('cover upload failed')
          const { error } = await supabase.from('sub_segments').update({ cover_url: path }).eq('id', ss.id)
          if (error) throw error
          ok++
        } catch { fail++ }
        setCovering(c => ({ ...c, done: c.done + 1 }))
      }
    } catch (e) {
      toast.error('Cover generation unavailable: ' + e.message)
    }
    setCovering(null)
    toast.success(`Covers generated: ${ok}${fail ? ` · ${fail} failed` : ''}.`)
    onRefresh()
  }

  // Retire/reactivate go through the EF: it enforces "retire only at 0 active
  // CBNs" server-side. The client count below is a UX hint only — the server
  // is the authority, and its 409 is surfaced verbatim.
  async function setActive(ss, is_active) {
    setBusyId(ss.id)
    try {
      await callEdge('admin-catalog', 'setSubSegmentActive', { id: ss.id, is_active })
      toast.success(`${ss.name} ${is_active ? 'reactivated' : 'retired'}.`)
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    }
    setBusyId(null)
  }

  return (
    <>
      <div className="vc-controls">
        <input
          className="form-input vc-search"
          placeholder="Search sub-segments…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="vc-filters">
          <select className="form-select" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
            <option value="">All Brands</option>
            <option value="al">Ashok Leyland</option>
            <option value="switch">Switch Mobility</option>
            <option value="hdh">HD Hyundai</option>
          </select>
          {/* Retired families are hidden by default but never gone — the whole
              point of retire over delete is that they stay recoverable. */}
          <select className="form-select" value={filterState} onChange={e => setFilterState(e.target.value)}>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="all">All</option>
          </select>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setSelected(null); setModal('add') }}
          >
            + Add Sub-Segment
          </button>
        </div>
      </div>

      {/* c2 cover backfill — only shows when there are brochures without covers */}
      {missingCovers.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="text-small">
            {missingCovers.length} brochure{missingCovers.length === 1 ? '' : 's'} {missingCovers.length === 1 ? 'has' : 'have'} no cover thumbnail yet.
          </span>
          <button className="btn btn-secondary btn-sm" disabled={!!covering} onClick={backfillCovers}>
            {covering
              ? `Generating… ${covering.done}/${covering.total}`
              : `Generate ${missingCovers.length} cover${missingCovers.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {loading ? (
        <Skeleton variant="row" count={4} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-wrap vc-desktop-table">
            <table>
              <thead>
                <tr>
                  <th>Sub-Segment</th>
                  <th>Segment</th>
                  <th>Brand</th>
                  <th style={{ textAlign: 'right' }}>CBNs</th>
                  <th>Brochure</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ss => {
                  const n = cbnCount[ss.id] || 0
                  return (
                  <tr key={ss.id} style={ss.is_active ? undefined : { opacity: 0.6 }}>
                    <td style={{ fontWeight: 600 }}>
                      {ss.name}
                      {/* Empty + active = a family nobody can reach anything through.
                          Flagged, not auto-retired: it may be newly created and
                          awaiting its CBNs. */}
                      {ss.is_active && n === 0 && (
                        <span className="badge badge-gray" style={{ marginLeft: 8, fontWeight: 400 }}>empty</span>
                      )}
                    </td>
                    <td>{ss.segment}</td>
                    <td><span className="badge badge-blue">{ss.brand.toUpperCase()}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</td>
                    <td>
                      {ss.brochure_url
                        ? <BrochureDownload path={ss.brochure_url} filename={ss.brochure_filename} />
                        : <span className="text-gray text-small">Not uploaded</span>}
                    </td>
                    <td>
                      <span className={`badge ${ss.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {ss.is_active ? 'Active' : 'Retired'}
                      </span>
                    </td>
                    <td>
                      <div className="vc-row-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setSelected(ss); setModal('edit') }}
                        >
                          Edit
                        </button>
                        {ss.is_active ? (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busyId === ss.id || n > 0}
                            title={n > 0
                              ? `Move its ${n} CBN${n === 1 ? '' : 's'} elsewhere first`
                              : 'Hide from all employee surfaces; brochure and history kept'}
                            onClick={() => setActive(ss, false)}
                          >
                            {busyId === ss.id ? <span className="spinner spinner-sm" /> : 'Retire'}
                          </button>
                        ) : (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busyId === ss.id}
                            onClick={() => setActive(ss, true)}
                          >
                            {busyId === ss.id ? <span className="spinner spinner-sm" /> : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )})}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state" style={{ padding: '32px 24px' }}>
                        <div className="empty-state-icon"><Icon name="folder" size={36} color="var(--text-muted)" /></div>
                        <h3>No sub-segments found</h3>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="vc-mobile-cards">
            {filtered.map(ss => (
              <div key={ss.id} className="vc-vehicle-card">
                <div className="vc-vc-top">
                  <span style={{ fontWeight: 700 }}>{ss.name}</span>
                  <span className={`badge ${ss.is_active ? 'badge-green' : 'badge-gray'}`}>
                    {ss.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="vc-vc-meta" style={{ marginTop: 6 }}>
                  <span>{ss.segment}</span>
                  <span className="badge badge-blue">{ss.brand.toUpperCase()}</span>
                </div>
                <div className="vc-row-actions mt-8">
                  {ss.brochure_url && (
                    <BrochureDownload path={ss.brochure_url} filename={ss.brochure_filename} />
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setSelected(ss); setModal('edit') }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {modal && (
        <SubSegmentModal
          mode={modal}
          subSeg={selected}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh() }}
        />
      )}
    </>
  )
}

/* ── SUB-SEGMENT ADD / EDIT MODAL ───────────────────────────── */
const EMPTY_SUBSEG = {
  name: '', segment: SEGMENTS[0], brand: 'al', description: '', is_active: true,
}

// `inline` (Phase 9.7b): opened from Reshuffle's move menu to create a family
// mid-move. Hides the add-mode CBN checklist — the caller is already holding a
// selection and will move it the moment this returns. onSaved receives the
// created row so the caller can select it without a refetch round-trip.
function SubSegmentModal({ mode, subSeg, onClose, onSaved, inline = false }) {
  const toast = useToast()
  const trapRef = useFocusTrap(true, onClose)
  const [form,            setForm]            = useState(mode === 'edit' ? { ...subSeg } : EMPTY_SUBSEG)
  const [brochureFile,    setBrochureFile]    = useState(null)
  const [saving,          setSaving]          = useState(false)
  const [uploadPct,       setUploadPct]       = useState(null)
  const [error,           setError]           = useState('')
  const [errorField,      setErrorField]      = useState(null) // which field to flag red on validation
  const [allocatedCBNs,   setAllocatedCBNs]   = useState([])   // edit: vehicles in this sub-seg
  const [cbnOptions,      setCbnOptions]      = useState([])   // add:  all vehicles in segment/brand (carry current sub_category)
  const [selectedCBNs,    setSelectedCBNs]    = useState(new Set())
  const [cbnSearch,       setCbnSearch]       = useState('')
  const [cbnLoading,      setCbnLoading]      = useState(false)
  const fileRef = useRef()

  // Editing a field clears its own inline validation error (Quotation pattern).
  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrorField(f => (f === field ? null : f))
  }

  // Edit mode: load CBNs belonging to this sub-segment. Phase 9.7a — keyed on
  // sub_segment_id, not the name text. Keyed on subSeg.id (stable) rather than
  // form.name, so typing a new name no longer re-queries and blanks the list.
  useEffect(() => {
    if (mode !== 'edit') return
    setCbnLoading(true)
    supabase.from('vehicle_catalog')
      .select('cbn, description')
      .eq('sub_segment_id', subSeg.id)
      .order('cbn')
      .then(({ data }) => { setAllocatedCBNs(data || []); setCbnLoading(false) })
  }, [mode, subSeg?.id])

  // Add mode: reload all CBNs in this segment/brand (with their CURRENT
  // sub_category) whenever segment or brand changes. We show every CBN and mark
  // the ones already in another sub-segment; selecting one MOVES it (a CBN can
  // only ever be in one sub-segment — sub_category is a single column).
  useEffect(() => {
    if (mode !== 'add' || inline) return   // inline: no checklist, so don't fetch it
    setCbnLoading(true)
    setSelectedCBNs(new Set())
    supabase.from('vehicle_catalog')
      .select('cbn, description, sub_segment_id, sub_category')
      .eq('segment', form.segment)
      .eq('brand', form.brand)
      .order('cbn')
      .then(({ data }) => {
        setCbnOptions(data || [])
        setCbnLoading(false)
      })
  }, [mode, form.segment, form.brand])

  // Validate brochure file: ≤10 MB + magic-byte %PDF- header.
  // Runs before the Edge Function signed-URL round-trip to reject bad files early.
  async function handleBrochureSelect(e) {
    const f = e.target.files[0] || null
    if (!f) { setBrochureFile(null); return }

    if (f.size > 10 * 1024 * 1024) {
      toast.error('Brochure must be 10 MB or smaller')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    try {
      const header = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const bytes = new Uint8Array(reader.result)
          let s = ''
          for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
          resolve(s)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(f.slice(0, 5))
      })
      if (!header.startsWith('%PDF-')) {
        toast.error('File is not a valid PDF')
        if (fileRef.current) fileRef.current.value = ''
        return
      }
    } catch {
      toast.error('Could not read file')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setBrochureFile(f)
  }

  async function save() {
    setError('')
    setErrorField(null)
    if (!form.name.trim()) { setError('Name is required');    setErrorField('name');    return }
    if (!form.segment)     { setError('Segment is required'); setErrorField('segment'); return }

    setSaving(true)
    let brochure_url      = form.brochure_url      || null
    let brochure_filename = form.brochure_filename  || null
    let cover_url         = form.cover_url          || null

    if (brochureFile) {
      // Phase 9f M5 — the EF generates an unguessable UUID filename
      // server-side; the client no longer chooses the path. The original
      // filename is preserved on vehicle_catalog.brochure_filename so the
      // download UX can use it via Content-Disposition.
      setUploadPct(0)
      let serverPath = null
      try {
        const { path: uuidPath, token } = await callEdge('admin-catalog', 'signBrochureUpload', {})
        serverPath = uuidPath
        const { error: upErr } = await supabase.storage
          .from('brochures')
          .uploadToSignedUrl(uuidPath, token, brochureFile, {
            upsert: false, // server-generated UUID; collisions impossible
            contentType: 'application/pdf',
          })
        setUploadPct(null)
        if (upErr) { toast.error('Brochure upload failed: ' + upErr.message); setSaving(false); return }
      } catch (e) {
        setUploadPct(null)
        toast.error('Brochure upload failed: ' + e.message)
        setSaving(false)
        return
      }
      brochure_url      = serverPath
      brochure_filename = brochureFile.name

      // c2: render page 1 → webp cover from the same file, best-effort. A new
      // brochure always regenerates the cover (a replaced PDF must not keep the
      // old page-1 image). Failure leaves cover_url null → typographic fallback.
      setUploadPct(null)
      try {
        const buf = await brochureFile.arrayBuffer()
        cover_url = await generateAndUploadCover(buf)
      } catch { cover_url = null }
    }

    const payload = {
      name:             form.name.trim(),
      segment:          form.segment,
      brand:            form.brand,
      description:      form.description || null,
      brochure_url,
      brochure_filename,
      cover_url,
      is_active:        form.is_active,
    }

    let err
    let createdRow = null
    if (mode === 'add') {
      // Case-insensitive clash pre-check (red-team-2): rename enforces this in
      // the EF, but add only had the DB's case-SENSITIVE unique — so
      // "BOSS 11T" could be created alongside "Boss 11T", and the import's
      // case-folded famByName would then collapse the two and file CBNs under
      // whichever it iterated last. %/_ are escaped: they are ILIKE wildcards.
      const namePat = payload.name.replace(/[%_\\]/g, m => '\\' + m)
      const { data: clash } = await supabase.from('sub_segments')
        .select('id, name').ilike('name', namePat).limit(1).maybeSingle()
      if (clash) {
        setSaving(false)
        setError(`A sub-segment named "${clash.name}" already exists`)
        setErrorField('name')
        return
      }
      // Born-retired + CBNs (red-team-2): assigning CBNs to an inactive family
      // hides them from every employee surface AND from triage (their
      // sub_segment_id is set). moveCbns below would 409 anyway — block early
      // with a message that says what to do instead.
      if (!inline && selectedCBNs.size > 0 && !payload.is_active) {
        setSaving(false)
        setError('An inactive sub-segment cannot take CBNs — save it as Active, or clear the CBN selection.')
        setErrorField('name')
        return
      }
      // Need the new id back to link CBNs by FK, so insert().select().single().
      const { data: created, error: insErr } = await supabase
        .from('sub_segments').insert(payload).select('*').single()
      err = insErr
      createdRow = created
      if (!err && !inline && selectedCBNs.size > 0) {
        // Latest assignment takes priority: a selected CBN already in another
        // family is reassigned here (a CBN is only ever in one family). Count
        // the reassignments to report them non-blockingly.
        const movedCount = [...selectedCBNs]
          .map(c => cbnOptions.find(v => v.cbn === c))
          .filter(v => v && (v.sub_segment_id || v.sub_category)).length
        // Through moveCbns, NOT a direct PostgREST write (red-team-2): the EF
        // writes all four placement columns (id + text + segment + vertical)
        // atomically via the RPC, refuses retired destinations, and carries
        // the CBN list in the POST body instead of an unchunked .in() query
        // string. The old direct write set id + text only — the exact
        // partial-placement drift the RPC exists to end, re-entering through
        // the create path.
        try {
          await callEdge('admin-catalog', 'moveCbns', {
            cbns: [...selectedCBNs], sub_segment_id: created.id,
          })
          if (movedCount > 0) toast.info(`${movedCount} CBN${movedCount > 1 ? 's' : ''} reassigned here — latest assignment takes priority.`)
        } catch (e) {
          toast.error('Sub-segment saved but CBN assignment failed: ' + e.message)
        }
      }
    } else {
      // Phase 9.7a: renaming is allowed now. The name goes through the Edge
      // Function, which also rewrites sub_category on every CBN linked by id —
      // the client can't do that atomically and mustn't try. Everything else is
      // a plain row update.
      //
      // Rename and segment are sent UNCONDITIONALLY, even when unchanged
      // (red-team-2 T6): both EF flows are two non-atomic writes, so "the
      // family row already says X" does not imply its CBNs do. Skipping the
      // call when the value looks unchanged made a half-applied sync
      // unrepairable — the family row updated first, so every retry compared
      // equal and skipped the very sync that failed. Both EF actions resync
      // idempotently on unchanged values, which makes Save the repair tool.
      try {
        await callEdge('admin-catalog', 'renameSubSegment', { id: subSeg.id, name: payload.name })
      } catch (e) {
        setSaving(false)
        toast.error('Rename failed: ' + e.message)
        return
      }
      // Segment and is_active must NOT be written directly (Phase 9.7b).
      //   • segment: setSubSegmentSegment also syncs vehicle_catalog.segment
      //     AND sales_vertical_id on every linked CBN (red-team R3 + T2). A
      //     direct write moves the family and leaves its own vehicles behind —
      //     the drift the MBP consolidation just cleaned up.
      //   • is_active: setSubSegmentActive enforces "retire only at 0 active
      //     CBNs". A direct write sails straight past that guard and hides a
      //     family whose vehicles are still live.
      // Both are stripped from the direct update and sent through the EF.
      // (RLS still permits a direct write, so this is a UX guard for trusted
      // admins, not a security boundary — see the backlog note.)
      try {
        await callEdge('admin-catalog', 'setSubSegmentSegment', {
          id: subSeg.id, segment: payload.segment,
        })
      } catch (e) {
        setSaving(false)
        toast.error('Segment change failed: ' + e.message)
        return
      }
      if (payload.is_active !== subSeg.is_active) {
        try {
          await callEdge('admin-catalog', 'setSubSegmentActive', {
            id: subSeg.id, is_active: payload.is_active,
          })
        } catch (e) {
          setSaving(false)
          // The 409 "still has N active CBNs" lands here — surface it verbatim,
          // it tells the admin exactly what to do next.
          toast.error(e.message)
          return
        }
      }
      const { name: _n, segment: _s, is_active: _a, ...rest } = payload
      ;({ error: err } = await supabase.from('sub_segments').update(rest).eq('id', subSeg.id))
    }
    setSaving(false)
    if (err) { toast.error('Save failed: ' + err.message); return }
    onSaved(createdRow)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={trapRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === 'add' ? 'Add Sub-Segment' : 'Edit Sub-Segment'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="ssm-name">Name *</label>
            <input
              id="ssm-name"
              className={`form-input ${errorField === 'name' ? 'error' : ''}`}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Boss 11T"
            />
            {errorField === 'name' && <div className="form-error">{error}</div>}
            {/* Phase 9.7a unlocked this. It was disabled because CBNs were tied
                to the family by name text, so a rename stranded them. They are
                tied by sub_segment_id now and the rename syncs the text. */}
            {mode === 'edit' && form.name !== subSeg.name && (
              <div className="text-small text-gray mt-4">
                Renaming updates this family on {allocatedCBNs.length} linked CBN
                {allocatedCBNs.length === 1 ? '' : 's'}.
              </div>
            )}
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="ssm-segment">Segment *</label>
              <select
                id="ssm-segment"
                className={`form-select ${errorField === 'segment' ? 'error' : ''}`}
                value={form.segment}
                onChange={e => set('segment', e.target.value)}
              >
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {errorField === 'segment' && <div className="form-error">{error}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="ssm-brand">Brand</label>
              <select id="ssm-brand" className="form-select" value={form.brand} onChange={e => set('brand', e.target.value)}>
                <option value="al">Ashok Leyland</option>
                <option value="switch">Switch Mobility</option>
                <option value="hdh">HD Hyundai</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ssm-desc">Description</label>
            <textarea
              id="ssm-desc"
              className="form-input"
              rows={2}
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional notes about this sub-segment"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Brochure PDF</label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleBrochureSelect}
            />
            {form.brochure_url && !brochureFile ? (
              <div className="vc-current-brochure">
                <span><Icon name="file" size={14} /> {form.brochure_filename || 'Brochure uploaded'}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>
                  Replace
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()}>
                {brochureFile ? <><Icon name="file" size={14} /> {brochureFile.name}</> : '+ Upload PDF'}
              </button>
            )}
            {/* Progress bar appears directly below the file button so the user
                can see upload status right next to the file they selected */}
            {uploadPct !== null && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Uploading… {uploadPct}%
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--accent)', transition: 'width 0.2s ease' }} />
                </div>
              </div>
            )}
          </div>

          <div className="form-group flex gap-8" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              id="ss-active"
              checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)}
            />
            <label htmlFor="ss-active" style={{ fontSize: 14, cursor: 'pointer' }}>Active</label>
          </div>


          {/* Edit mode: read-only list of CBNs in this sub-segment */}
          {mode === 'edit' && (
            <div className="form-group">
              <label className="form-label">
                CBN Numbers{allocatedCBNs.length > 0 ? ` (${allocatedCBNs.length})` : ''}
              </label>
              {cbnLoading ? (
                <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Loading…</div>
              ) : allocatedCBNs.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>No vehicles assigned to this sub-segment yet.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {allocatedCBNs.map(v => (
                    <span key={v.cbn} title={v.description || ''} style={{
                      fontSize: 12, fontFamily: 'monospace',
                      background: 'var(--gray-100)', border: '1px solid var(--gray-200)',
                      borderRadius: 4, padding: '2px 8px', color: 'var(--gray-700)',
                    }}>{v.cbn}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add mode: filterable checklist of unallocated CBNs.
              Hidden when inline — Reshuffle already holds the selection. */}
          {mode === 'add' && !inline && (
            <div className="form-group">
              <label className="form-label">Assign CBN Numbers (optional)</label>
              {cbnLoading ? (
                <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Loading…</div>
              ) : cbnOptions.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>No CBNs in this segment / brand.</div>
              ) : (
                <>
                  <input
                    className="form-input"
                    placeholder="Filter by CBN or description…"
                    value={cbnSearch}
                    onChange={e => setCbnSearch(e.target.value)}
                    style={{ marginBottom: 6 }}
                  />
                  <div style={{
                    maxHeight: 200, overflowY: 'auto',
                    border: '1px solid var(--gray-200)', borderRadius: 6,
                  }}>
                    {cbnOptions
                      .filter(v => !cbnSearch ||
                        v.cbn.toLowerCase().includes(cbnSearch.toLowerCase()) ||
                        (v.description || '').toLowerCase().includes(cbnSearch.toLowerCase())
                      )
                      .map(v => (
                        <label key={v.cbn} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '7px 12px', cursor: 'pointer',
                          background: selectedCBNs.has(v.cbn) ? 'var(--blue-50, #eff6ff)' : 'transparent',
                          borderBottom: '1px solid var(--gray-100)',
                        }}>
                          <input
                            type="checkbox"
                            checked={selectedCBNs.has(v.cbn)}
                            onChange={e => setSelectedCBNs(s => {
                              const next = new Set(s)
                              e.target.checked ? next.add(v.cbn) : next.delete(v.cbn)
                              return next
                            })}
                            style={{ marginTop: 2, flexShrink: 0 }}
                          />
                          <span>
                            <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{v.cbn}</span>
                            {v.description && (
                              <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 8 }}>
                                {v.description.length > 70 ? v.description.substring(0, 70) + '…' : v.description}
                              </span>
                            )}
                            {v.sub_category && (
                              <span style={{ fontSize: 11, color: '#b45309', marginLeft: 8, whiteSpace: 'nowrap' }}>
                                • in {v.sub_category}
                              </span>
                            )}
                          </span>
                        </label>
                      ))
                    }
                  </div>
                  {selectedCBNs.size > 0 && (
                    <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 6 }}>
                      {selectedCBNs.size} CBN{selectedCBNs.size > 1 ? 's' : ''} selected
                    </div>
                  )}
                  {(() => {
                    const reassigning = [...selectedCBNs]
                      .map(c => cbnOptions.find(v => v.cbn === c))
                      .filter(v => v && v.sub_category).length
                    return reassigning > 0 ? (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                        {reassigning} selected CBN{reassigning > 1 ? 's are' : ' is'} already in another sub-segment and will be reassigned here — latest assignment takes priority.
                      </div>
                    ) : null
                  })()}
                </>
              )}
            </div>
          )}

          <div className="flex gap-8 mt-16">
            <button className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>
              {uploadPct !== null
                ? `Uploading… ${uploadPct}%`
                : saving
                  ? 'Saving…'
                  : mode === 'add' ? 'Add Sub-Segment' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Cover thumbnail upload (Phase 9.7c c2) ───────────────────
   generate + upload are best-effort: a cover failure must NEVER block the
   brochure save, and a missing cover simply falls back to the typographic
   tile. pdfjs is pulled in via the lazy coverGen import, keeping it out of the
   employee bundle. */
async function uploadCoverBlob(webpBlob) {
  try {
    const { path, token } = await callEdge('admin-catalog', 'signCoverUpload', {})
    const { error } = await supabase.storage.from('brochures')
      .uploadToSignedUrl(path, token, webpBlob, { upsert: false, contentType: 'image/webp' })
    return error ? null : path
  } catch { return null }
}
async function generateAndUploadCover(pdfArrayBuffer) {
  try {
    const { generateCoverWebp } = await import('../lib/coverGen')
    const blob = await generateCoverWebp(pdfArrayBuffer)
    return blob ? await uploadCoverBlob(blob) : null
  } catch { return null }
}

/* ── BROCHURE DOWNLOAD BUTTON ────────────────────────────────── */
function BrochureDownload({ path, filename }) {
  const [loading, setLoading] = useState(false)

  async function download() {
    setLoading(true)
    const { data, error } = await supabase.storage
      .from('brochures')
      .createSignedUrl(path, 3600)
    setLoading(false)
    if (!error && data?.signedUrl) {
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = filename || 'brochure.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={download} disabled={loading}>
      {loading ? <span className="spinner spinner-sm" /> : <><Icon name="file" size={14} /> {filename || 'Download'}</>}
    </button>
  )
}

/* ── IMPORT TAB ──────────────────────────────────────────────── */
function findColIdx(headers, patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(p))
    if (idx >= 0) return idx
  }
  return -1
}

function ImportTab({ subSegs, onRefresh }) {
  const toast = useToast()
  const [file,          setFile]          = useState(null)
  const [preview,       setPreview]       = useState(null)
  const [brand,         setBrand]         = useState('al')
  const [priceCircular, setPriceCircular] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [importing,     setImporting]     = useState(false)
  const fileRef = useRef()

  // Resolves a spreadsheet sub-category text to a real family (Phase 9.7b3, R1).
  // Keyed on trimmed/case-folded name, matching the 9.7a backfill's comparison
  // so the import and the backfill can never disagree about what "matches".
  // Retired families are excluded (R4): an import must never quietly file new
  // CBNs under a family taken out of service — they go to triage instead.
  const famByName = useMemo(() => {
    const m = new Map()
    for (const ss of subSegs) if (ss.is_active) m.set(ss.name.trim().toLowerCase(), ss)
    return m
  }, [subSegs])

  async function processFile(f) {
    setFile(f)
    setPreview(null)
    try {
      const buffer = await f.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
      // Prefer "All Vehicles" sheet
      const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('all')) || wb.SheetNames[0]
      const ws   = wb.Sheets[sheetName]
      const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      // Find header row (look for CBN column)
      let headerIdx = -1
      for (let i = 0; i < Math.min(6, raw.length); i++) {
        if (raw[i].some(c => String(c).toLowerCase().trim() === 'cbn')) {
          headerIdx = i; break
        }
      }
      if (headerIdx < 0) {
        toast.error('Could not find header row — make sure the file has a "CBN" column.')
        return
      }

      const headers = raw[headerIdx].map(h => String(h).trim())
      const cbnIdx  = findColIdx(headers, ['cbn'])
      const descIdx = findColIdx(headers, ['description', 'desc'])
      const subIdx  = findColIdx(headers, ['sub-category', 'sub_category', 'sub-cat', 'sub cat', 'subcategory'])
      const tyreIdx = findColIdx(headers, ['tyre', 'tire'])
      const mrpIdx  = findColIdx(headers, ['mrp incl', 'mrp', 'incl. gst', 'incl gst'])
      const segIdx  = findColIdx(headers, ['segment'])

      if (cbnIdx  < 0) { toast.error('CBN column not found.'); return }
      if (mrpIdx  < 0) { toast.error('MRP column not found.'); return }

      const dataRows = raw.slice(headerIdx + 1)
        .filter(row => String(row[cbnIdx] || '').trim())

      // Fetch existing CBNs to classify as new vs update. Chunked AND paginated:
      // a full circular is ~1000 CBNs, which hits two separate ceilings — a
      // single .in() list that long risks a 414 on the request URL, and the
      // response would be capped at 1000 rows anyway. Either one silently
      // mislabels existing vehicles as "New" in the preview. The upsert itself
      // is keyed on cbn so the import stays correct; it's the counts you approve
      // that would lie.
      // Uppercased to match how the vehicle modal stores CBNs (every CBN in the
      // prod catalog is uppercase — verified against the seed dump). Without
      // this, a circular typed in lowercase fails the existence check and forks
      // the catalog with case-variant duplicate rows.
      const cbns = dataRows.map(r => String(r[cbnIdx]).trim().toUpperCase())
      const IN_CHUNK = 300
      const existingSet = new Set()
      for (let i = 0; i < cbns.length; i += IN_CHUNK) {
        const slice = cbns.slice(i, i + IN_CHUNK)
        const rows = await fetchAllRows(() => supabase
          .from('vehicle_catalog')
          .select('cbn')
          .in('cbn', slice)
          .order('cbn'))
        for (const r of rows) existingSet.add(r.cbn)
      }

      // Resolve the uuid brand_id for the selected brand code — vehicle_catalog.brand_id
      // is NOT NULL, so every imported row must carry it (the legacy `brand` text
      // column alone is not enough for the insert to succeed).
      const { data: brandRow, error: brandErr } = await supabase
        .from('brands')
        .select('id')
        .eq('code', brand)
        .single()
      if (brandErr || !brandRow) {
        toast.error(`Could not resolve brand "${brand}" — no matching row in the brands table.`)
        return
      }
      const brand_id = brandRow.id

      const mapped = dataRows.map(row => {
        const cbn         = String(row[cbnIdx]).trim().toUpperCase()
        const rawSubCat   = subIdx >= 0 ? String(row[subIdx]).trim() : ''
        // R1: resolve the family by id, not by leaving free text to be matched
        // later. No match = null = it queues in triage, rather than being
        // guessed at.
        const fam         = rawSubCat ? famByName.get(rawSubCat.toLowerCase()) : null
        // A matched family owns the canonical spelling and the segment — that
        // is what keeps id, text and segment in step from the moment of import.
        const sub_category = fam ? fam.name : (rawSubCat || null)
        const segment     = fam
                          ? fam.segment
                          : ((segIdx >= 0 ? String(row[segIdx]).trim() : '') || '')
        const mrpRaw      = String(row[mrpIdx] || '').replace(/[₹,\s]/g, '')
        const mrp         = parseInt(mrpRaw) || 0
        const description = descIdx >= 0 ? String(row[descIdx]).trim() : ''
        const tyres       = tyreIdx >= 0 ? String(row[tyreIdx]).trim() || null : null
        const _isNew      = !existingSet.has(cbn)

        // A key that isn't on the row is a field the import does not touch —
        // the EF applies only present keys. NEW rows are inserted whole (they
        // need every column). EXISTING rows get price data only, and a blank
        // cell means "leave what is there alone", never "erase it": the same
        // rule the price_circular/effective_date stamp already follows. In
        // particular gst_rate and is_active are NEVER sent for existing rows —
        // a circular re-listing a hand-deactivated CBN must not resurrect it.
        const r = _isNew
          ? { cbn, description, sub_segment_id: fam ? fam.id : null, sub_category,
              segment, tyres, mrp_incl_gst: mrp, gst_rate: 18, brand, brand_id,
              is_active: true }
          : { cbn, mrp_incl_gst: mrp }
        if (!_isNew) {
          if (description) r.description = description
          if (tyres)       r.tyres = tyres
        }
        return { ...r, _isNew, _rawSubCat: rawSubCat }
      }).filter(r => r.mrp_incl_gst > 0)

      // Same CBN twice in one file: keep the LAST occurrence (matches the
      // update loop's last-in-file-wins) — two copies of a NEW cbn would
      // otherwise land in one INSERT and abort the whole import on the unique
      // constraint with a raw Postgres error.
      const byCbn = new Map()
      for (const r of mapped) byCbn.set(r.cbn, r)
      const deduped = [...byCbn.values()]
      const duplicates = mapped.length - deduped.length
      if (duplicates > 0) {
        toast.info(`${duplicates} duplicate CBN row${duplicates === 1 ? '' : 's'} in the file — keeping the last occurrence of each.`)
      }

      // New CBNs whose family text matched nothing — these land unassigned and
      // become the triage queue. Surfaced up front so the number is a decision
      // the admin makes, not a surprise found later.
      const unresolved = deduped.filter(r => r._isNew && !r.sub_segment_id)
      const unresolvedNames = [...new Set(unresolved.map(r => r._rawSubCat || '(blank)'))]
      setPreview({
        rows:     deduped,
        updated:  deduped.filter(r => !r._isNew).length,
        newRows:  deduped.filter(r => r._isNew).length,
        unresolved: unresolved.length,
        unresolvedNames,
        skipped:  dataRows.length - mapped.length,
        sample:   deduped.slice(0, 10),
        sheetName,
      })
    } catch (err) {
      toast.error('Failed to parse file: ' + err.message)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  // Blank template matching exactly what processFile() looks for. The note row
  // sits ABOVE the header (the header-finder scans for the "CBN" cell, so rows
  // before it are ignored) and there are deliberately NO example data rows —
  // an unedited upload must import zero vehicles, not junk ones.
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['One row per vehicle. CBN and MRP are compulsory; Segment may be left blank when the Sub-Category is a known sub-segment (it auto-fills). Existing CBNs get their price updated; new CBNs are added.'],
      ['CBN', 'Description', 'Sub-Category', 'Tyres', 'MRP Incl. GST', 'Segment'],
    ])
    ws['!cols'] = [{ wch: 18 }, { wch: 60 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'All Vehicles')
    XLSX.writeFile(wb, 'Price_Circular_Template.xlsx')
  }

  async function runImport() {
    if (!preview) return
    setImporting(true)
    // Only send these when the admin actually filled them in. Blank must mean
    // "leave what is there alone", never "erase it": sending null wiped
    // price_circular + effective_date on every row of the import, silently
    // destroying the provenance of vehicles the circular merely re-priced.
    // (Pre-existing behaviour — the old upsert did the same. Caught on staging
    // 2026-07-17 by an import run with both fields blank, which nulled 797 rows.)
    const stamp = {}
    if (priceCircular.trim()) stamp.price_circular = priceCircular.trim()
    if (effectiveDate)        stamp.effective_date = effectiveDate
    const payload = preview.rows.map(({ _isNew, _rawSubCat, ...r }) => ({ ...r, ...stamp }))
    let res
    try {
      res = await callEdge('admin-catalog', 'bulkUpsertVehicles', { rows: payload })
    } catch (e) {
      setImporting(false)
      toast.error('Import failed: ' + e.message)
      return
    }
    setImporting(false)
    // Report the server's counts, not the preview's prediction — they diverge
    // if the catalog changed between preview and import.
    toast.success(`Import complete — ${res.updated ?? 0} price-updated, ${res.inserted ?? 0} added.`)
    if (preview.unresolved > 0) {
      toast.info(`${preview.unresolved} new CBN${preview.unresolved === 1 ? '' : 's'} need a family — see the Triage tab.`)
    }
    setPreview(null)
    setFile(null)
    onRefresh()
  }

  return (
    <div className="vc-import">
      <div className="card">
        <h3 className="vc-import-title">Import Price Circular</h3>
        <p className="vc-import-desc">
          Upload the Excel price list. Existing vehicles are updated by CBN; new CBNs are inserted.
          Expected columns: <strong>CBN, Description, Sub-Category, Tyres, MRP incl. 18% GST</strong>
        </p>
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }}
          onClick={downloadTemplate}>
          <Icon name="download" size={14} /> Download template
        </button>

        <div className="form-group" style={{ maxWidth: 260, marginBottom: 16 }}>
          <label className="form-label" htmlFor="imp-brand">Brand *</label>
          <select id="imp-brand" className="form-select" value={brand} onChange={e => { setBrand(e.target.value); setPreview(null); setFile(null) }}>
            <option value="al">Ashok Leyland</option>
            <option value="switch">Switch Mobility</option>
            <option value="hdh">HD Hyundai</option>
          </select>
        </div>

        {/* Drop zone */}
        <div
          className={`vc-dropzone ${file ? 'vc-dropzone-filled' : ''}`}
          onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => e.target.files[0] && processFile(e.target.files[0])}
          />
          <div className="vc-dropzone-icon"><Icon name="upload" size={34} strokeWidth={1.4} color="var(--text-muted)" /></div>
          {file ? (
            <div>
              <div style={{ fontWeight: 600 }}>{file.name}</div>
              <div className="text-gray text-small mt-4">
                {(file.size / 1024).toFixed(0)} KB · Click to change
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 600 }}>Drag & drop Excel file here</div>
              <div className="text-gray text-small mt-4">or click to browse · .xlsx / .xls</div>
            </div>
          )}
        </div>

        {preview && (
          <>
            <div className="vc-import-stats">
              <span className="vc-import-stat vc-stat-update">{preview.updated} price updates</span>
              <span className="vc-import-stat vc-stat-new">{preview.newRows} new</span>
              {preview.unresolved > 0 && (
                <span className="vc-import-stat vc-stat-skip">{preview.unresolved} need a family</span>
              )}
              {preview.skipped > 0 && (
                <span className="vc-import-stat vc-stat-skip">{preview.skipped} skipped</span>
              )}
              <span className="text-gray text-small">sheet: {preview.sheetName}</span>
            </div>

            {/* Say plainly what this import will NOT do. Before 9.7b3 a circular
                silently re-filed existing vehicles from its own Sub-Category
                column, which quietly undid hand-triage and re-broke renames. */}
            <div className="text-small text-gray" style={{ marginTop: 8 }}>
              Existing vehicles get prices updated only — their sub-segment is left as it is.
              Use Reshuffle to move vehicles between families.
            </div>

            {preview.unresolved > 0 && (
              <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 10, marginTop: 10 }}>
                <strong>{preview.unresolved} new CBN{preview.unresolved === 1 ? '' : 's'} match no existing sub-segment</strong> and
                will be imported unassigned, ready to triage:
                <div style={{ marginTop: 4 }}>{preview.unresolvedNames.slice(0, 6).join(' · ')}{preview.unresolvedNames.length > 6 ? ` · +${preview.unresolvedNames.length - 6} more` : ''}</div>
              </div>
            )}

            <div className="vc-form-grid mt-16">
              <div className="form-group">
                <label className="form-label" htmlFor="imp-pc">Price Circular</label>
                <input
                  id="imp-pc"
                  className="form-input"
                  value={priceCircular}
                  onChange={e => setPriceCircular(e.target.value)}
                  placeholder="e.g. Sep2025"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="imp-effdate">Effective Date</label>
                <input
                  id="imp-effdate"
                  className="form-input"
                  type="date"
                  value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)}
                />
              </div>
            </div>

            <div className="vc-preview-label">
              Preview — first {preview.sample.length} of {preview.rows.length} rows
            </div>
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>CBN</th>
                    <th>Sub-Segment</th>
                    <th style={{ textAlign: 'right' }}>MRP</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`badge ${r._isNew ? 'badge-green' : 'badge-blue'}`}>
                          {r._isNew ? 'New' : 'Update'}
                        </span>
                      </td>
                      <td className="vc-cbn">{r.cbn}</td>
                      <td>{r.sub_category || '—'}</td>
                      <td className="vc-mrp-cell">{fmtMRP(r.mrp_incl_gst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button className="btn btn-primary" disabled={importing} onClick={runImport}>
              {importing
                ? <><span className="spinner spinner-sm" /> Importing…</>
                : `Import ${preview.rows.length} vehicles`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   SALES VIEW
══════════════════════════════════════════════════════════════ */
/* ── Shelf: per-employee most-opened families (Phase 9.7c F1) ──
   localStorage, per-device — the plan's deliberate starting point over a
   catalog_family_opens table (zero schema, and a salesperson works from one
   phone). Keyed by the family's stable card key (sub_segment_id, or the raw
   text key for not-yet-triaged orphans). Namespaced by user id so a shared
   device doesn't blend two people's shelves. All access is wrapped: private
   mode / disabled storage must degrade to "no shelf", never throw. */
const SHELF_PREFIX = 'ptb_catalog_shelf_v1:'
function shelfKey(userId) { return SHELF_PREFIX + (userId || 'anon') }
function readShelf(userId) {
  try { return JSON.parse(localStorage.getItem(shelfKey(userId))) || {} }
  catch { return {} }
}
function bumpShelf(userId, cardKey) {
  const s = readShelf(userId)
  s[String(cardKey)] = (s[String(cardKey)] || 0) + 1
  try { localStorage.setItem(shelfKey(userId), JSON.stringify(s)) } catch { /* storage full/blocked — shelf just won't persist */ }
  return s
}

/* ── Family share (Phase 9.7d, S1) ────────────────────────────
   Hands the OS share sheet the brochure PDF + a pre-filled caption; in
   WhatsApp it lands as an editable draft the employee reviews before sending.
   FAMILY-LEVEL ONLY — never a single CBN's price. One brochure serves many
   CBNs at different prices, so the caption says "prices on request", never a
   number. */
const BRAND_LABEL = { al: 'Ashok Leyland', switch: 'Switch Mobility', hdh: 'HD Hyundai' }

function buildShareCaption(card) {
  const brand = BRAND_LABEL[card.brand] || 'Ashok Leyland'
  return [
    `*${brand} — ${card.name}*`,
    `${card.segment} · ${card.count} variant${card.count !== 1 ? 's' : ''}`,
    '',
    'Full model brochure attached. Prices on request.',
    '',
    '— Paras Trucks & Buses',
    'team.parastrucks.in',
  ].join('\n')
}

async function fetchBrochureFile(card) {
  if (!card.brochure_url) return null
  const { data, error } = await supabase.storage
    .from('brochures').createSignedUrl(card.brochure_url, 300)
  if (error || !data?.signedUrl) return null
  const res = await fetch(data.signedUrl)
  if (!res.ok) return null
  const blob = await res.blob()
  const raw = (card.brochure_filename || `${card.name}.pdf`).replace(/[^\w.\- ]+/g, '_')
  const name = raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`
  return new File([blob], name, { type: 'application/pdf' })
}

// Returns a short status the caller can toast. Never throws.
async function shareFamily(card) {
  const caption = buildShareCaption(card)
  let file = null
  try { file = await fetchBrochureFile(card) } catch { /* fall through to text/desktop */ }

  // Mobile: OS share sheet with the PDF + caption. Android Chrome supports
  // files; the caption arrives in WhatsApp as an editable draft.
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: caption, title: card.name }); return { ok: true } }
    catch (e) { if (e?.name === 'AbortError') return { ok: true, cancelled: true } /* else fall through */ }
  }
  // Some phones share text but not files.
  if (!file && navigator.share) {
    try { await navigator.share({ text: caption, title: card.name }); return { ok: true } }
    catch (e) { if (e?.name === 'AbortError') return { ok: true, cancelled: true } }
  }

  // Desktop fallback: copy the caption, download the PDF, tell the user to paste.
  let copied = false
  try { await navigator.clipboard.writeText(caption); copied = true } catch { /* clipboard blocked */ }
  if (file) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url; a.download = file.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { ok: true, desktop: true, copied, downloaded: true }
  }
  return { ok: true, desktop: true, copied, downloaded: false }
}

/* One cover tile on the brochure wall. Shows the real page-1 thumbnail once
   9.7c c2 populates cover_url; until then a typographic title block (zero cost,
   always available). The whole tile opens the variants modal; brochure download
   stays a distinct affordance inside the modal. */
function FamilyCoverCard({ card, onOpen }) {
  return (
    <div className="vc-cover-card" onClick={() => onOpen(card)} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(card) } }}>
      <div className="vc-cover-art">
        {card.cover_url ? (
          <img src={card.cover_url} alt={card.name} loading="lazy" />
        ) : (
          <div className="vc-cover-fallback">
            <div className="vc-cover-fallback-seg">{card.segment}</div>
            <div className="vc-cover-fallback-name">{card.name}</div>
          </div>
        )}
        {card.brochure_url && (
          <span className="vc-cover-badge"><Icon name="file" size={10} color="#fff" /> PDF</span>
        )}
      </div>
      <div className="vc-cover-body">
        <div className="vc-cover-name">{card.name}</div>
        <div className="vc-cover-count">{card.count} variant{card.count !== 1 ? 's' : ''}</div>
      </div>
    </div>
  )
}

function SalesCatalog({ profile }) {
  const [subSegs,        setSubSegs]        = useState([])
  const [vehicles,       setVehicles]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [selectedSubSeg, setSelectedSubSeg] = useState(null)
  const [shelf,          setShelf]          = useState(() => readShelf(profile.id))

  // Opening a family both records the visit (shelf ranking) and shows variants.
  const openFamily = useCallback((card) => {
    setShelf(bumpShelf(profile.id, card.key))
    setSelectedSubSeg(card)
  }, [profile.id])
  // Phase 6c.1 scope derived from the user's join tables instead of the
  // legacy profile.brand + VERTICAL_SEGMENTS map. Loaded once per mount;
  // RLS on vehicle_catalog will (once landed) enforce the same constraints
  // server-side regardless of what the client asks for.
  const [scope,          setScope]          = useState(null) // {brandIds, verticalIds} or null while loading

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [brandRes, vertRes] = await Promise.all([
        supabase.from('user_brands').select('brand_id').eq('user_id', profile.id),
        supabase.from('user_sales_verticals').select('vertical_id').eq('user_id', profile.id),
      ])
      if (cancelled) return
      setScope({
        brandIds:    (brandRes.data || []).map(r => r.brand_id),
        verticalIds: (vertRes.data  || []).map(r => r.vertical_id),
      })
    })()
    return () => { cancelled = true }
  }, [profile.id])

  const fetchData = useCallback(async () => {
    if (!scope) return
    setLoading(true)
    try {
      // Sales user with no brand assignment sees nothing. Callers should
      // never reach this state in practice — onboarding requires ≥ 1 brand.
      if (scope.brandIds.length === 0) {
        setVehicles([])
        setSubSegs([])
        setLoading(false)
        return
      }

      // Vehicles: brand ∈ user_brands AND (sales_vertical_id IS NULL OR vertical ∈ user_sales_verticals)
      // The .or() expresses the NULL-or-match half using PostgREST's filter syntax.
      // Paginated for the same reason as the admin fetch: active rows are under
      // PostgREST's 1000-row cap today (897 on prod) but the margin is thin, and
      // silently losing vehicles from the sales view is worse than in admin —
      // nobody would notice a model quietly missing from the catalog.
      const buildVQuery = () => {
        let q = supabase
          .from('vehicle_catalog')
          .select('id, cbn, description, brand, segment, sub_segment_id, sub_category, mrp_incl_gst, tyres, brand_id, sales_vertical_id')
          .eq('is_active', true)
          .in('brand_id', scope.brandIds)
          .order('sub_category')
          .order('mrp_incl_gst')
          .order('id')  // tiebreak: paging needs a total order or rows can repeat/vanish across pages
        if (scope.verticalIds.length > 0) {
          q = q.or(`sales_vertical_id.is.null,sales_vertical_id.in.(${scope.verticalIds.join(',')})`)
        } else {
          // No verticals assigned → only show catalog rows with no vertical constraint.
          q = q.is('sales_vertical_id', null)
        }
        return q
      }

      // Sub-segments: brand-scoped by the legacy `brand` text until a brand_id
      // column is added to sub_segments. Resolve brand codes from user_brands
      // via the brands table.
      const { data: brandRows } = await supabase
        .from('brands').select('code').in('id', scope.brandIds)
      const brandCodes = (brandRows || []).map(r => r.code)
      const ssQuery = brandCodes.length > 0
        ? supabase.from('sub_segments').select('*').eq('is_active', true).in('brand', brandCodes)
        : supabase.from('sub_segments').select('*').eq('is_active', true)

      const [vData, { data: ssData }] = await Promise.all([
        fetchAllRows(buildVQuery),
        ssQuery,
      ])
      setVehicles(vData)
      setSubSegs(ssData || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    let cancelled = false
    fetchData()
    return () => { cancelled = true }
  }, [fetchData])

  // Phase 9.7a: keyed by sub_segment_id, so a renamed family keeps its brochure.
  const subSegById = useMemo(
    () => Object.fromEntries(subSegs.map(ss => [ss.id, ss])),
    [subSegs]
  )

  // c2: covers live in the private brochures bucket, so an <img src> needs a
  // signed URL. Batch-sign every cover path in ONE request (createSignedUrls
  // plural) rather than N calls for a wall of tiles. Refreshed with subSegs.
  const [coverUrls, setCoverUrls] = useState({})   // storage path → signed URL
  useEffect(() => {
    const paths = subSegs.filter(s => s.cover_url).map(s => s.cover_url)
    if (paths.length === 0) { setCoverUrls({}); return }
    let cancelled = false
    supabase.storage.from('brochures').createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancelled || !data) return
      const map = {}
      for (const d of data) if (d.signedUrl && !d.error) map[d.path] = d.signedUrl
      setCoverUrls(map)
    })
    return () => { cancelled = true }
  }, [subSegs])

  // Build cards: one per family. CBNs with no sub_segment_id (the ~30 orphans
  // awaiting 9.7b triage) still group under their raw text so they stay visible
  // to sales — they just have no brochure until an admin files them.
  const cards = useMemo(() => {
    const grouped = new Map()
    for (const v of vehicles) {
      const key = v.sub_segment_id ?? `text:${v.sub_category || '(Other)'}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(v)
    }
    return [...grouped.entries()].map(([key, vlist]) => {
      const ss = typeof key === 'number' ? subSegById[key] : null
      return {
        key,
        // Prefer the family's own name — it is the one the rename updates.
        name:              ss?.name || vlist[0].sub_category || '(Other)',
        segment:           ss?.segment || vlist[0].segment,
        brand:             ss?.brand || vlist[0].brand || 'al',
        count:             vlist.length,
        brochure_url:      ss?.brochure_url      || null,
        brochure_filename: ss?.brochure_filename || null,
        // Resolved signed URL for the <img>, or null → typographic fallback.
        cover_url:         (ss?.cover_url && coverUrls[ss.cover_url]) || null,
        vehicles:          vlist,
      }
    })
  }, [vehicles, subSegById, coverUrls])

  const availableSegs = useMemo(
    () => [...new Set(cards.map(c => c.segment))].sort(),
    [cards]
  )

  // Tokenised search over the family AND its variants: (visibleCards removed —
  // the old flat filter is superseded by searchResults + the wall.) every token must appear
  // somewhere in name + segment + each CBN + each description. This is what lets
  // an employee type "1920 haulage" or a CBN fragment and land on the family —
  // hits point at the family (the unit of everything), brochure one tap away.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const tokens = q.split(/\s+/).filter(Boolean)
    return cards
      .filter(c => {
        const hay = `${c.name} ${c.segment} ${c.vehicles.map(v => `${v.cbn} ${v.description || ''}`).join(' ')}`.toLowerCase()
        return tokens.every(t => hay.includes(t))
      })
      .sort((a, b) => a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name))
  }, [cards, search])

  // Shelf tiles: the employee's most-opened families, most-first, still present
  // in their current scope. Falls back to empty (new employee / cleared storage)
  // — the wall is always one tap away, so an empty shelf is never a dead end.
  const shelfCards = useMemo(() => {
    const byKey = new Map(cards.map(c => [String(c.key), c]))
    return Object.entries(shelf)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => byKey.get(k))
      .filter(Boolean)
      .slice(0, 8)
  }, [shelf, cards])

  // Show the current user's assigned verticals as subtitle context.
  // Lookup happens once when scope resolves — no async render.
  const [verticalLabels, setVerticalLabels] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!scope || scope.verticalIds.length === 0) { setVerticalLabels([]); return }
    supabase
      .from('sales_verticals')
      .select('name')
      .in('id', scope.verticalIds)
      .then(({ data }) => {
        if (cancelled) return
        setVerticalLabels((data || []).map(r => r.name))
      })
    return () => { cancelled = true }
  }, [scope])

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Sales Tools</div>
          <h1 className="page-head-title">Vehicle Catalog<span className="period-accent">.</span></h1>
          <div className="page-head-sub">
            Find the right brochure fast
            {verticalLabels.length > 0 ? ` · ${verticalLabels.join(', ')} range` : ''}
          </div>
        </div>
      </div>

      {/* F1 — hero search: the primary way in */}
      <div className="vc-hero-search">
        <span className="vc-hero-icon"><Icon name="search" size={18} /></span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search model or CBN — e.g. “1920 haulage” or a CBN number"
          aria-label="Search catalog"
        />
      </div>

      {loading ? (
        <Skeleton variant="card" count={3} />
      ) : cards.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="truck" size={36} color="var(--text-muted)" /></div>
          <h3>No vehicles available</h3>
          <p>No catalog data for your assigned brand / product range</p>
        </div>

      /* ── Search results: flat, ranked, brochure one tap away ── */
      ) : searchResults ? (
        searchResults.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon name="search" size={36} color="var(--text-muted)" /></div>
            <h3>Nothing matches “{search.trim()}”</h3>
            <p>Try fewer words, or a CBN fragment</p>
          </div>
        ) : (
          <>
            <div className="vc-shelf-head">
              <span className="vc-shelf-title">{searchResults.length} famil{searchResults.length === 1 ? 'y' : 'ies'}</span>
            </div>
            <div className="vc-wall-grid">
              {searchResults.map(card => (
                <FamilyCoverCard key={card.key} card={card} onOpen={openFamily} />
              ))}
            </div>
          </>
        )

      /* ── Landing: shelf + the full brochure wall, grouped by segment ── */
      ) : (
        <>
          {shelfCards.length > 0 && (
            <div className="vc-shelf">
              <div className="vc-shelf-head">
                <span className="vc-shelf-title">Your shelf</span>
                <span className="vc-shelf-hint">most-opened families on this device</span>
              </div>
              <div className="vc-wall-grid">
                {shelfCards.map(card => (
                  <FamilyCoverCard key={card.key} card={card} onOpen={openFamily} />
                ))}
              </div>
            </div>
          )}

          <div className="vc-shelf-head">
            <span className="vc-shelf-title">Browse</span>
          </div>
          {availableSegs.map(seg => {
            const segCards = cards.filter(c => c.segment === seg)
            if (segCards.length === 0) return null
            return (
              <div key={seg} className="vc-segment-group">
                <div className="vc-segment-label">{seg}</div>
                <div className="vc-wall-grid">
                  {segCards.map(card => (
                    <FamilyCoverCard key={card.key} card={card} onOpen={openFamily} />
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {selectedSubSeg && (
        <VehicleListModal
          subSeg={selectedSubSeg}
          onClose={() => setSelectedSubSeg(null)}
        />
      )}
    </div>
  )
}

/* ── VEHICLE LIST MODAL (sales view) ─────────────────────────── */
function VehicleListModal({ subSeg, onClose }) {
  const trapRef = useFocusTrap(true, onClose)
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [sharing, setSharing] = useState(false)

  async function onShare() {
    setSharing(true)
    const r = await shareFamily(subSeg)
    setSharing(false)
    if (r.cancelled) return
    if (r.desktop) {
      if (r.copied && r.downloaded) toast.success('Caption copied & brochure downloaded — paste into WhatsApp and attach the file.')
      else if (r.downloaded)        toast.info('Brochure downloaded. Copy the caption manually to share.')
      else if (r.copied)            toast.success('Caption copied — paste into WhatsApp.')
      else                          toast.info('Sharing not available on this browser.')
    }
    // Mobile success is silent — the OS share sheet already gave feedback.
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return subSeg.vehicles
    const s = search.toLowerCase()
    const mrpNum = s.replace(/[₹,\s]/g, '')
    return subSeg.vehicles.filter(v =>
      v.cbn.toLowerCase().includes(s) ||
      v.description.toLowerCase().includes(s) ||
      String(v.mrp_incl_gst).includes(mrpNum)
    )
  }, [subSeg.vehicles, search])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal vc-wide-modal" ref={trapRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{subSeg.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 3 }}>
              {subSeg.segment} · {subSeg.count} variant{subSeg.count !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-8" style={{ alignItems: 'flex-start' }}>
            <button className="btn btn-primary btn-sm" onClick={onShare} disabled={sharing}
              title="Share this family's brochure on WhatsApp">
              {sharing ? <span className="spinner spinner-sm" /> : <><Icon name="share" size={14} /> Share</>}
            </button>
            {subSeg.brochure_url && (
              <BrochureDownload path={subSeg.brochure_url} filename={subSeg.brochure_filename} />
            )}
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="modal-body">
          <input
            className="form-input mb-16"
            placeholder="Search CBN, description or MRP…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />

          {/* Desktop table */}
          <div className="table-wrap vc-desktop-table">
            <table>
              <thead>
                <tr>
                  <th>CBN</th>
                  <th>Description</th>
                  <th>Tyres</th>
                  <th style={{ textAlign: 'right' }}>MRP (incl. GST)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id}>
                    <td className="vc-cbn">{v.cbn}</td>
                    <td className="vc-desc" title={v.description}>{v.description}</td>
                    <td>{v.tyres || '—'}</td>
                    <td className="vc-mrp-cell">{fmtMRP(v.mrp_incl_gst)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <div className="empty-state" style={{ padding: 24 }}>
                        No variants match your search
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="vc-mobile-cards">
            {filtered.map(v => (
              <div key={v.id} className="vc-vehicle-card">
                <div className="vc-vc-cbn">{v.cbn}</div>
                <div className="vc-vc-desc">{v.description}</div>
                {v.tyres && (
                  <div className="text-gray text-small mt-4">{v.tyres}</div>
                )}
                <div className="vc-vc-mrp mt-8">{fmtMRP(v.mrp_incl_gst)}</div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                No variants match your search
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
