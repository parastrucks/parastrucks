import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Skeleton from '../components/Skeleton'
import useFocusTrap from '../hooks/useFocusTrap'

/* ── CONSTANTS ───────────────────────────────────────────────── */
const SEGMENTS = [
  'ICV Truck', 'MBP Truck', 'Tipper',
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

/* ══════════════════════════════════════════════════════════════
   MAIN EXPORT — routes to admin or sales view
══════════════════════════════════════════════════════════════ */
export default function Catalog() {
  const { profile, isAdmin } = useAuth()
  if (!profile) return null
  // Admin + Back Office get the full CRUD view. The admin-users EF (v7)
  // writes legacy `role` alongside the new axes for every user it creates,
  // so checking role === 'back_office' remains correct through 6c.1. When
  // Phase 6c.3 drops legacy role, this flips to a lookup against
  // profile.department_id → departments.code === 'back_office'.
  const canManage = isAdmin || profile.role === 'back_office'
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
      const { data, error } = await supabase
        .from('vehicle_catalog')
        .select('id, cbn, description, brand, segment, sub_category, tyres, mrp_incl_gst, gst_rate, price_circular, effective_date, is_active')
        .order('segment')
        .order('sub_category')
        .order('cbn')
      if (!error) setVehicles(data || [])
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

  const TABS = [
    { key: 'vehicles',      label: 'Vehicles' },
    { key: 'sub-segments',  label: 'Sub-Segments' },
    { key: 'import',        label: 'Import' },
  ]

  return (
    <div>
      <div className="page-header">
        <h1>Vehicle Catalog</h1>
        <p>Manage vehicles, sub-segments and import price circulars</p>
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
      {tab === 'sub-segments' && (
        <SubSegmentsTab
          subSegs={subSegs}
          loading={ssLoading}
          onRefresh={fetchSubSegs}
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
          <div className="empty-state-icon">🚛</div>
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
  cbn: '', description: '', brand: 'al', segment: SEGMENTS[0], sub_category: '',
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

  const subCatOptions = useMemo(
    () => subSegs.filter(ss => ss.segment === form.segment).map(ss => ss.name),
    [subSegs, form.segment]
  )

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setError('')
  }

  async function save() {
    if (!form.cbn.trim())         { setError('CBN is required'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    if (!form.segment)            { setError('Segment is required'); return }
    if (!form.mrp_incl_gst)       { setError('MRP is required'); return }

    setSaving(true)
    const payload = {
      cbn:            form.cbn.trim().toUpperCase(),
      description:    form.description.trim(),
      brand:          form.brand || 'al',
      segment:        form.segment,
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
          {error && <div className="alert alert-error">{error}</div>}

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-cbn">CBN *</label>
              <input
                id="vm-cbn"
                className="form-input"
                value={form.cbn}
                onChange={e => set('cbn', e.target.value)}
                disabled={mode === 'edit'}
                placeholder="e.g. CDB111505C0004_YW"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vm-mrp">MRP incl. GST (₹) *</label>
              <input
                id="vm-mrp"
                className="form-input"
                type="number"
                value={form.mrp_incl_gst}
                onChange={e => set('mrp_incl_gst', e.target.value)}
                placeholder="e.g. 2147202"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="vm-desc">Description *</label>
            <textarea
              id="vm-desc"
              className="form-input"
              rows={3}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Full vehicle description as in price list"
            />
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
                onChange={e => { set('segment', e.target.value); set('sub_category', '') }}
              >
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="vm-subseg">Sub-Segment</label>
              {subCatOptions.length > 0 ? (
                <select
                  id="vm-subseg"
                  className="form-select"
                  value={form.sub_category}
                  onChange={e => set('sub_category', e.target.value)}
                >
                  <option value="">— Select —</option>
                  {subCatOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input
                  id="vm-subseg"
                  className="form-input"
                  value={form.sub_category}
                  onChange={e => set('sub_category', e.target.value)}
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

/* ── SUB-SEGMENTS TAB ────────────────────────────────────────── */
function SubSegmentsTab({ subSegs, loading, onRefresh }) {
  const [modal,       setModal]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [filterBrand, setFilterBrand] = useState('al')
  const [search,      setSearch]      = useState('')

  const filtered = useMemo(() => {
    let list = subSegs
    if (filterBrand) list = list.filter(ss => ss.brand === filterBrand)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(ss =>
        ss.name.toLowerCase().includes(s) ||
        ss.segment.toLowerCase().includes(s)
      )
    }
    return list
  }, [subSegs, filterBrand, search])

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
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setSelected(null); setModal('add') }}
          >
            + Add Sub-Segment
          </button>
        </div>
      </div>

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
                  <th>Brochure</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ss => (
                  <tr key={ss.id}>
                    <td style={{ fontWeight: 600 }}>{ss.name}</td>
                    <td>{ss.segment}</td>
                    <td><span className="badge badge-blue">{ss.brand.toUpperCase()}</span></td>
                    <td>
                      {ss.brochure_url
                        ? <BrochureDownload path={ss.brochure_url} filename={ss.brochure_filename} />
                        : <span className="text-gray text-small">Not uploaded</span>}
                    </td>
                    <td>
                      <span className={`badge ${ss.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {ss.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setSelected(ss); setModal('edit') }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state" style={{ padding: '32px 24px' }}>
                        <div className="empty-state-icon">📁</div>
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

function SubSegmentModal({ mode, subSeg, onClose, onSaved }) {
  const toast = useToast()
  const trapRef = useFocusTrap(true, onClose)
  const [form,         setForm]         = useState(mode === 'edit' ? { ...subSeg } : EMPTY_SUBSEG)
  const [brochureFile, setBrochureFile] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [uploadPct,    setUploadPct]    = useState(null) // null = not uploading
  const [error,        setError]        = useState('')
  const fileRef = useRef()

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); setError('') }

  // Validate brochure file: ≤10 MB + magic-byte %PDF- header.
  // Runs before the Edge Function signed-URL round-trip to reject bad files early.
  async function handleBrochureSelect(e) {
    const f = e.target.files[0] || null
    if (!f) { setBrochureFile(null); return }

    if (f.size > 10 * 1024 * 1024) {
      setError('Brochure must be 10 MB or smaller')
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
        setError('File is not a valid PDF')
        if (fileRef.current) fileRef.current.value = ''
        return
      }
    } catch {
      setError('Could not read file')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setError('')
    setBrochureFile(f)
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.segment)     { setError('Segment is required'); return }

    setSaving(true)
    let brochure_url      = form.brochure_url      || null
    let brochure_filename = form.brochure_filename  || null

    if (brochureFile) {
      const safeName = form.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const path = `${form.brand}/${safeName}.pdf`
      setUploadPct(0)
      try {
        // Ask the Edge Function for a one-shot signed upload URL.
        // The file uploads directly to storage — never passes through the function.
        const { token } = await callEdge('admin-catalog', 'signBrochureUpload', { path })
        const { error: upErr } = await supabase.storage
          .from('brochures')
          .uploadToSignedUrl(path, token, brochureFile, {
            upsert: true,
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
      brochure_url      = path
      brochure_filename = brochureFile.name
    }

    const payload = {
      name:             form.name.trim(),
      segment:          form.segment,
      brand:            form.brand,
      description:      form.description || null,
      brochure_url,
      brochure_filename,
      is_active:        form.is_active,
    }

    let err
    if (mode === 'add') {
      ;({ error: err } = await supabase.from('sub_segments').insert(payload))
    } else {
      ;({ error: err } = await supabase.from('sub_segments').update(payload).eq('id', subSeg.id))
    }
    setSaving(false)
    if (err) { toast.error('Save failed: ' + err.message); return }
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={trapRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === 'add' ? 'Add Sub-Segment' : 'Edit Sub-Segment'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="ssm-name">Name *</label>
            <input
              id="ssm-name"
              className="form-input"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              disabled={mode === 'edit'}
              placeholder="e.g. Boss 11T"
            />
          </div>

          <div className="vc-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="ssm-segment">Segment *</label>
              <select id="ssm-segment" className="form-select" value={form.segment} onChange={e => set('segment', e.target.value)}>
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
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
                <span>📎 {form.brochure_filename || 'Brochure uploaded'}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>
                  Replace
                </button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()}>
                {brochureFile ? `📎 ${brochureFile.name}` : '+ Upload PDF'}
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

          {uploadPct !== null && (
            <div className="form-group">
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Uploading brochure… {uploadPct}%
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--accent)', transition: 'width 0.2s ease' }} />
              </div>
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
      {loading ? <span className="spinner spinner-sm" /> : `📎 ${filename || 'Download'}`}
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
  const [error,         setError]         = useState('')
  const fileRef = useRef()

  const subSegMap = useMemo(
    () => Object.fromEntries(subSegs.map(ss => [ss.name, ss.segment])),
    [subSegs]
  )

  async function processFile(f) {
    setFile(f)
    setPreview(null)
    setError('')
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
        setError('Could not find header row — make sure the file has a "CBN" column.')
        return
      }

      const headers = raw[headerIdx].map(h => String(h).trim())
      const cbnIdx  = findColIdx(headers, ['cbn'])
      const descIdx = findColIdx(headers, ['description', 'desc'])
      const subIdx  = findColIdx(headers, ['sub-category', 'sub_category', 'sub-cat', 'sub cat', 'subcategory'])
      const tyreIdx = findColIdx(headers, ['tyre', 'tire'])
      const mrpIdx  = findColIdx(headers, ['mrp incl', 'mrp', 'incl. gst', 'incl gst'])
      const segIdx  = findColIdx(headers, ['segment'])

      if (cbnIdx  < 0) { setError('CBN column not found.'); return }
      if (mrpIdx  < 0) { setError('MRP column not found.'); return }

      const dataRows = raw.slice(headerIdx + 1)
        .filter(row => String(row[cbnIdx] || '').trim())

      // Fetch existing CBNs to classify as new vs update
      const cbns = dataRows.map(r => String(r[cbnIdx]).trim())
      const { data: existing } = await supabase
        .from('vehicle_catalog')
        .select('cbn')
        .in('cbn', cbns)
      const existingSet = new Set((existing || []).map(r => r.cbn))

      const mapped = dataRows.map(row => {
        const cbn         = String(row[cbnIdx]).trim()
        const sub_category = subIdx >= 0 ? String(row[subIdx]).trim() : ''
        const segment     = (segIdx >= 0 ? String(row[segIdx]).trim() : '')
                          || subSegMap[sub_category]
                          || ''
        const mrpRaw      = String(row[mrpIdx] || '').replace(/[₹,\s]/g, '')
        const mrp         = parseInt(mrpRaw) || 0
        return {
          cbn,
          description:  descIdx >= 0 ? String(row[descIdx]).trim() : '',
          sub_category: sub_category || null,
          segment,
          tyres:        tyreIdx >= 0 ? String(row[tyreIdx]).trim() || null : null,
          mrp_incl_gst: mrp,
          gst_rate:     18,
          brand,
          is_active:    true,
          _isNew:       !existingSet.has(cbn),
        }
      }).filter(r => r.mrp_incl_gst > 0)

      setPreview({
        rows:     mapped,
        updated:  mapped.filter(r => !r._isNew).length,
        newRows:  mapped.filter(r => r._isNew).length,
        skipped:  dataRows.length - mapped.length,
        sample:   mapped.slice(0, 10),
        sheetName,
      })
    } catch (err) {
      setError('Failed to parse file: ' + err.message)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  async function runImport() {
    if (!preview) return
    setImporting(true)
    setError('')
    const payload = preview.rows.map(({ _isNew, ...r }) => ({
      ...r,
      price_circular: priceCircular || null,
      effective_date: effectiveDate || null,
    }))
    try {
      await callEdge('admin-catalog', 'bulkUpsertVehicles', { rows: payload })
    } catch (e) {
      setImporting(false)
      toast.error('Import failed: ' + e.message)
      return
    }
    setImporting(false)
    toast.success(`Import complete — ${preview.updated} updated, ${preview.newRows} new vehicles added.`)
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

        {error && <div className="alert alert-error">{error}</div>}

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
          <div className="vc-dropzone-icon">📊</div>
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
              <span className="vc-import-stat vc-stat-update">{preview.updated} to update</span>
              <span className="vc-import-stat vc-stat-new">{preview.newRows} new</span>
              {preview.skipped > 0 && (
                <span className="vc-import-stat vc-stat-skip">{preview.skipped} skipped</span>
              )}
              <span className="text-gray text-small">sheet: {preview.sheetName}</span>
            </div>

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
function SalesCatalog({ profile }) {
  const [subSegs,        setSubSegs]        = useState([])
  const [vehicles,       setVehicles]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [filterSeg,      setFilterSeg]      = useState('')
  const [selectedSubSeg, setSelectedSubSeg] = useState(null)
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
      let vQuery = supabase
        .from('vehicle_catalog')
        .select('id, cbn, description, brand, segment, sub_category, mrp_incl_gst, tyres, brand_id, sales_vertical_id')
        .eq('is_active', true)
        .in('brand_id', scope.brandIds)
        .order('sub_category')
        .order('mrp_incl_gst')

      if (scope.verticalIds.length > 0) {
        vQuery = vQuery.or(
          `sales_vertical_id.is.null,sales_vertical_id.in.(${scope.verticalIds.join(',')})`,
        )
      } else {
        // No verticals assigned → only show catalog rows with no vertical constraint.
        vQuery = vQuery.is('sales_vertical_id', null)
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

      const [{ data: vData }, { data: ssData }] = await Promise.all([vQuery, ssQuery])
      setVehicles(vData || [])
      setSubSegs(ssData  || [])
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

  const subSegMap = useMemo(
    () => Object.fromEntries(subSegs.map(ss => [ss.name, ss])),
    [subSegs]
  )

  // Build cards: one per unique sub_category with vehicle list + brochure info
  const cards = useMemo(() => {
    const grouped = {}
    for (const v of vehicles) {
      const key = v.sub_category || '(Other)'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(v)
    }
    return Object.entries(grouped).map(([name, vlist]) => ({
      name,
      segment:          vlist[0].segment,
      count:            vlist.length,
      brochure_url:     subSegMap[name]?.brochure_url     || null,
      brochure_filename: subSegMap[name]?.brochure_filename || null,
      vehicles:         vlist,
    }))
  }, [vehicles, subSegMap])

  const availableSegs = useMemo(
    () => [...new Set(cards.map(c => c.segment))].sort(),
    [cards]
  )

  const visibleCards = useMemo(() => {
    let list = cards
    if (filterSeg) list = list.filter(c => c.segment === filterSeg)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(s) ||
        c.segment.toLowerCase().includes(s)
      )
    }
    return list
  }, [cards, filterSeg, search])

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
      <div className="page-header">
        <h1>Vehicle Catalog</h1>
        <p>
          Browse models and download brochures
          {verticalLabels.length > 0 ? ` · ${verticalLabels.join(', ')} range` : ''}
        </p>
      </div>

      <div className="vc-controls">
        <input
          className="form-input vc-search"
          placeholder="Search models…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="vc-filters">
          <select className="form-select" value={filterSeg} onChange={e => setFilterSeg(e.target.value)}>
            <option value="">All Segments</option>
            {availableSegs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Skeleton variant="card" count={3} />
      ) : cards.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🚛</div>
          <h3>No vehicles available</h3>
          <p>No catalog data for your assigned brand / product range</p>
        </div>
      ) : (
        availableSegs
          .filter(seg => !filterSeg || seg === filterSeg)
          .map(seg => {
            const segCards = visibleCards.filter(c => c.segment === seg)
            if (segCards.length === 0) return null
            return (
              <div key={seg} className="vc-segment-group">
                <div className="vc-segment-label">{seg}</div>
                <div className="vc-subseg-grid">
                  {segCards.map(card => (
                    <div key={card.name} className="vc-subseg-card">
                      <div className="vc-subseg-name">{card.name}</div>
                      <div className="vc-subseg-count">
                        {card.count} variant{card.count !== 1 ? 's' : ''}
                      </div>
                      <div className="vc-subseg-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedSubSeg(card)}
                        >
                          View Variants
                        </button>
                        {card.brochure_url && (
                          <BrochureDownload
                            path={card.brochure_url}
                            filename={card.brochure_filename}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
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
  const [search, setSearch] = useState('')

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
