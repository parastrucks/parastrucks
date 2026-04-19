import { useState, useEffect, useRef, useCallback } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { useDebounce } from '../lib/useDebounce'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateProformaPdf } from '../utils/pdfGenerator'

const SEGMENTS = ['All Segments', 'ICV Trucks', 'Long Haul Trucks', 'Tippers', 'Buses', 'RMC / Boom Pump']

const SEGMENT_FILTER = {
  'ICV Trucks':       v => v.segment === 'ICV Truck',
  'Long Haul Trucks': v => v.segment === 'Long Haul Trucks',
  'Tippers':         v => v.segment === 'Tipper',
  'Buses':           v => v.segment === 'Bus – ICV' || v.segment === 'Bus – MCV',
  'RMC / Boom Pump': v => v.segment === 'RMC / Boom Pump',
}

const DEFAULT_TCS = 1

let rowIdCounter = 1
function newRow() {
  return { id: rowIdCounter++, chassis_no: '', engine_no: '', vehicleOverride: null, description: '' }
}

function calcTotals(vehicle, tcsRate, rtoTax, insurance) {
  if (!vehicle) return { vehicleSubtotal: 0, tcsAmount: 0, grandTotal: 0 }
  const vehicleSubtotal = vehicle.mrp_incl_gst
  const tcsAmount = Math.round(vehicleSubtotal * tcsRate / 100)
  const grandTotal = vehicleSubtotal + tcsAmount + (parseInt(rtoTax, 10) || 0) + (parseInt(insurance, 10) || 0)
  return { vehicleSubtotal, tcsAmount, grandTotal }
}

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}

function today() {
  return new Date().toISOString().split('T')[0]
}
function endOfMonth() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}

// Shared vehicle search hook used by both the default picker and per-row override
function useVehicleSearch(catalog, fuseInst) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 150)
  const [segment, setSegment] = useState('All Segments')
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)

  const runSearch = useCallback((q, seg) => {
    if (!q.trim()) { setResults([]); setShowDropdown(false); return }
    const segPred = SEGMENT_FILTER[seg]
    const pool = segPred ? catalog.filter(segPred) : catalog
    const tmpFuse = (!fuseInst || seg !== 'All Segments')
      ? new Fuse(pool, { keys: [{ name: 'sub_category', weight: 3 }, { name: 'cbn', weight: 2 }, { name: 'description', weight: 1 }], threshold: 0.35, minMatchCharLength: 2 })
      : fuseInst
    setResults(tmpFuse.search(q).map(r => r.item).slice(0, 12))
    setShowDropdown(true)
  }, [catalog, fuseInst])

  useEffect(() => { runSearch(debouncedQuery, segment) }, [debouncedQuery, segment, runSearch])

  return { query, setQuery, segment, setSegment, results, showDropdown, setShowDropdown }
}

export default function ProformaInvoice() {
  const { profile } = useAuth()
  const toast = useToast()

  // Catalog
  const [catalog, setCatalog] = useState([])
  const [fuseInst, setFuseInst] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)

  // Default vehicle (shared across all rows unless overridden)
  const [defaultVehicle, setDefaultVehicle] = useState(null)
  const defaultSearchRef = useRef(null)
  const defaultSearch = useVehicleSearch(catalog, fuseInst)

  // Per-row override search — track which row is expanding its override
  const [overrideOpenId, setOverrideOpenId] = useState(null)
  const [overrideQuery, setOverrideQuery] = useState('')
  const debouncedOverrideQuery = useDebounce(overrideQuery, 150)
  const [overrideResults, setOverrideResults] = useState([])
  const overrideRef = useRef(null)

  useEffect(() => {
    if (!overrideQuery.trim()) { setOverrideResults([]); return }
    const tmpFuse = new Fuse(catalog, { keys: [{ name: 'sub_category', weight: 3 }, { name: 'cbn', weight: 2 }, { name: 'description', weight: 1 }], threshold: 0.35, minMatchCharLength: 2 })
    setOverrideResults(tmpFuse.search(overrideQuery).map(r => r.item).slice(0, 8))
  }, [debouncedOverrideQuery, catalog])

  // Chassis/engine rows
  const [rows, setRows] = useState([newRow()])

  // Customer fields
  const [customer, setCustomer] = useState({
    name: '', address: '', mobile: '', gstin: '', hypothecation: '',
  })
  const [validUntil, setValidUntil] = useState(endOfMonth())

  // Extras (apply to every PI in the batch)
  const [rtoTax, setRtoTax] = useState('')
  const [insurance, setInsurance] = useState('')
  const [tcsRate] = useState(DEFAULT_TCS)

  // Submission state
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [error, setError] = useState('')

  // Load catalog on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setCatalogLoading(true)
      setCatalogError(false)
      try {
        const { data, error: err } = await supabase
          .from('vehicle_catalog')
          .select('id, cbn, description, sub_category, segment, tyres, mrp_incl_gst, brand_id')
          .eq('is_active', true)
          .order('segment').order('sub_category').order('description')
        if (cancelled) return
        if (err) { setCatalogError(true); return }
        setCatalog(data || [])
        setFuseInst(new Fuse(data || [], {
          keys: [{ name: 'sub_category', weight: 3 }, { name: 'cbn', weight: 2 }, { name: 'description', weight: 1 }],
          threshold: 0.35,
          minMatchCharLength: 2,
        }))
      } catch { if (!cancelled) setCatalogError(true) }
      finally { if (!cancelled) setCatalogLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // When default vehicle changes, pre-fill descriptions for rows that haven't been edited yet
  useEffect(() => {
    if (!defaultVehicle) return
    setRows(prev => prev.map(r =>
      !r.vehicleOverride && r.description === ''
        ? { ...r, description: defaultVehicle.description }
        : r
    ))
  }, [defaultVehicle])

  // Close dropdowns on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (defaultSearchRef.current && !defaultSearchRef.current.contains(e.target)) {
        defaultSearch.setShowDropdown(false)
      }
      if (overrideRef.current && !overrideRef.current.contains(e.target)) {
        setOverrideOpenId(null)
        setOverrideQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function addRow() {
    setRows(prev => [...prev, newRow()])
  }

  function removeRow(id) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function updateRow(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function openOverride(rowId) {
    setOverrideOpenId(rowId)
    setOverrideQuery('')
    setOverrideResults([])
  }

  function clearOverride(rowId) {
    setRows(prev => prev.map(r => r.id === rowId
      ? { ...r, vehicleOverride: null, description: defaultVehicle?.description || '' }
      : r
    ))
    setOverrideOpenId(null)
  }

  function selectOverrideVehicle(rowId, vehicle) {
    setRows(prev => prev.map(r => r.id === rowId
      ? { ...r, vehicleOverride: vehicle, description: vehicle.description }
      : r
    ))
    setOverrideOpenId(null)
    setOverrideQuery('')
    setOverrideResults([])
  }

  const { vehicleSubtotal, tcsAmount, grandTotal } = calcTotals(defaultVehicle, tcsRate, rtoTax, insurance)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSavedCount(0)

    if (!customer.name.trim()) { setError('Customer name is required.'); return }
    if (!defaultVehicle) { setError('Select a default vehicle.'); return }

    const emptyRow = rows.find(r => !r.chassis_no.trim() || !r.engine_no.trim())
    if (emptyRow) { setError('All rows require both Chassis No and Engine No.'); return }

    setSaving(true)

    try {
      // Resolve entity once
      const { data: ent, error: eErr } = profile?.entity_id
        ? await supabase.from('entities')
            .select('id, code, full_name, address, gstin, bank_name, bank_account, bank_ifsc')
            .eq('id', profile.entity_id).single()
        : await supabase.from('entities')
            .select('id, code, full_name, address, gstin, bank_name, bank_account, bank_ifsc')
            .eq('code', 'PTB').single()
      if (eErr) throw eErr

      const entityId   = ent.id
      const entityCode = ent.code
      const entityData = { full_name: ent.full_name, address: ent.address, gstin: ent.gstin, bank_name: ent.bank_name, bank_account: ent.bank_account, bank_ifsc: ent.bank_ifsc }

      const rtoVal = parseInt(rtoTax, 10) || null
      const insVal = parseInt(insurance, 10) || null

      let count = 0
      for (const row of rows) {
        const vehicle = row.vehicleOverride || defaultVehicle
        const brandId = vehicle.brand_id

        const lineItems = [{
          cbn:         vehicle.cbn,
          description: row.description.trim() || vehicle.description,
          qty:         1,
          mrp:         vehicle.mrp_incl_gst,
          total_cost:  vehicle.mrp_incl_gst,
          basic_amt:   Math.round(vehicle.mrp_incl_gst / 1.18),
          gst_amt:     vehicle.mrp_incl_gst - Math.round(vehicle.mrp_incl_gst / 1.18),
          brand_id:    brandId,
        }]

        const rowTcsAmount = Math.round(vehicle.mrp_incl_gst * tcsRate / 100)
        const rowGrandTotal = vehicle.mrp_incl_gst + rowTcsAmount + (rtoVal || 0) + (insVal || 0)

        const { data: piNum, error: rpcErr } = await supabase.rpc('next_proforma_number', { p_entity_id: entityId })
        if (rpcErr) throw new Error(`Row ${count + 1}: ${rpcErr.message}`)

        const { error: insertErr } = await supabase.from('proforma_invoices').insert({
          pi_number:        piNum,
          entity_id:        entityId,
          brand_id:         brandId,
          created_by:       profile.id,
          chassis_no:       row.chassis_no.trim(),
          engine_no:        row.engine_no.trim(),
          customer_name:    customer.name.trim(),
          customer_address: customer.address.trim() || null,
          customer_mobile:  customer.mobile.trim() || null,
          customer_gstin:   customer.gstin.trim() || null,
          hypothecation:    customer.hypothecation.trim() || null,
          valid_until:      validUntil,
          line_items:       lineItems,
          tcs_rate:         tcsRate,
          tcs_amount:       rowTcsAmount,
          rto_tax:          rtoVal,
          insurance:        insVal,
          grand_total:      rowGrandTotal,
        })
        if (insertErr) throw new Error(`Row ${count + 1}: ${insertErr.message}`)

        await generateProformaPdf({
          piNumber:   piNum,
          date:       today(),
          validUntil,
          customer:   { name: customer.name, address: customer.address, mobile: customer.mobile, gstin: customer.gstin, hypothecation: customer.hypothecation },
          entity:     entityData,
          entityCode,
          lineItems,
          tcsRate,
          tcsAmount:  rowTcsAmount,
          rtoTax:     rtoVal,
          insurance:  insVal,
          grandTotal: rowGrandTotal,
          chassisNo:  row.chassis_no.trim(),
          engineNo:   row.engine_no.trim(),
          preparedBy: profile?.full_name,
        })

        count++
        setSavedCount(count)
      }

      toast.success(`${count} Proforma Invoice${count !== 1 ? 's' : ''} generated and downloaded.`)

      // Reset form
      setRows([newRow()])
      setDefaultVehicle(null)
      defaultSearch.setQuery('')
      setCustomer({ name: '', address: '', mobile: '', gstin: '', hypothecation: '' })
      setRtoTax('')
      setInsurance('')
      setValidUntil(endOfMonth())
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to generate proforma invoices.')
    } finally {
      setSaving(false)
    }
  }

  const validRowCount = rows.filter(r => r.chassis_no.trim() && r.engine_no.trim()).length
  const totalRows = rows.length

  return (
    <div>
      <div className="page-header">
        <h1>Proforma Invoice</h1>
        <p>Generate proforma invoices for physical vehicles</p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span>⚠</span> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="q-layout">
          {/* ── LEFT COLUMN ─────────────────────────────────────── */}
          <div className="q-col-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Customer Details */}
            <div className="q-section">
              <div className="q-section-title">Customer Details</div>
              <div className="customer-grid">
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-name">Customer Name *</label>
                  <input
                    id="pi-cust-name"
                    className="form-input"
                    value={customer.name}
                    onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))}
                    placeholder="Full name or company name"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-mobile">Mobile</label>
                  <input
                    id="pi-cust-mobile"
                    className="form-input"
                    value={customer.mobile}
                    onChange={e => setCustomer(c => ({ ...c, mobile: e.target.value }))}
                    placeholder="10-digit number"
                    maxLength={15}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-gstin">GSTIN</label>
                  <input
                    id="pi-cust-gstin"
                    className="form-input"
                    value={customer.gstin}
                    onChange={e => setCustomer(c => ({ ...c, gstin: e.target.value.toUpperCase() }))}
                    placeholder="22AAAAA0000A1Z5"
                    maxLength={15}
                  />
                </div>
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-addr">Address</label>
                  <input
                    id="pi-cust-addr"
                    className="form-input"
                    value={customer.address}
                    onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))}
                    placeholder="City, State"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-hyp">Hypothecation</label>
                  <input
                    id="pi-cust-hyp"
                    className="form-input"
                    value={customer.hypothecation}
                    onChange={e => setCustomer(c => ({ ...c, hypothecation: e.target.value }))}
                    placeholder="Bank / NBFC name"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-valid-until">Valid Until</label>
                  <input
                    id="pi-valid-until"
                    type="date"
                    className="form-input"
                    value={validUntil}
                    min={today()}
                    onChange={e => setValidUntil(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Default Vehicle */}
            <div className="q-section">
              <div className="q-section-title">Vehicle (default for all rows)</div>

              {catalogError && (
                <div className="alert alert-error" style={{ marginBottom: 8 }}>
                  Failed to load vehicle catalog.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  className="form-select"
                  value={defaultSearch.segment}
                  onChange={e => defaultSearch.setSegment(e.target.value)}
                  style={{ width: 160, flexShrink: 0 }}
                  aria-label="Segment filter"
                >
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ position: 'relative', flex: 1 }} ref={defaultSearchRef}>
                  <input
                    className="form-input"
                    placeholder={catalogLoading ? 'Loading catalog…' : 'Search model or sub-segment…'}
                    disabled={catalogLoading || catalogError}
                    value={defaultSearch.query}
                    onChange={e => defaultSearch.setQuery(e.target.value)}
                    onFocus={() => defaultSearch.results.length > 0 && defaultSearch.setShowDropdown(true)}
                    aria-label="Vehicle search"
                    autoComplete="off"
                  />
                  {defaultSearch.showDropdown && defaultSearch.results.length > 0 && (
                    <div className="search-dropdown">
                      {defaultSearch.results.map(v => (
                        <div
                          key={v.id}
                          className="search-item"
                          onMouseDown={e => {
                            e.preventDefault()
                            setDefaultVehicle(v)
                            defaultSearch.setQuery('')
                            defaultSearch.setShowDropdown(false)
                          }}
                        >
                          <div className="search-item-name">{v.sub_category || v.description}</div>
                          <div className="search-item-meta">{v.cbn} · {v.segment} · {fmtINR(v.mrp_incl_gst)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {defaultVehicle && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 6, padding: '8px 12px', marginTop: 4 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--gray-900)' }}>{defaultVehicle.description}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>
                      {defaultVehicle.cbn} · {fmtINR(defaultVehicle.mrp_incl_gst)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setDefaultVehicle(null)}
                    style={{ marginLeft: 8, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Chassis / Engine Grid */}
            <div className="q-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="q-section-title" style={{ marginBottom: 0 }}>Chassis &amp; Engine Numbers</div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
                  + Add Row
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((row, idx) => (
                  <div key={row.id} style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 12px', background: 'var(--gray-50)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-400)', width: 20, flexShrink: 0 }}>#{idx + 1}</span>
                      <input
                        className="form-input"
                        placeholder="Chassis No."
                        value={row.chassis_no}
                        onChange={e => updateRow(row.id, 'chassis_no', e.target.value)}
                        style={{ flex: 1, minWidth: 120 }}
                        aria-label={`Row ${idx + 1} chassis number`}
                      />
                      <input
                        className="form-input"
                        placeholder="Engine No."
                        value={row.engine_no}
                        onChange={e => updateRow(row.id, 'engine_no', e.target.value)}
                        style={{ flex: 1, minWidth: 120 }}
                        aria-label={`Row ${idx + 1} engine number`}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--gray-500)' }}
                        onClick={() => overrideOpenId === row.id ? setOverrideOpenId(null) : openOverride(row.id)}
                        title="Use a different vehicle for this row"
                      >
                        {row.vehicleOverride ? '✏ vehicle' : '+ vehicle'}
                      </button>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red-500)', padding: '4px 8px' }}
                          onClick={() => removeRow(row.id)}
                          aria-label={`Remove row ${idx + 1}`}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Editable Particulars */}
                    <div style={{ paddingLeft: 28 }}>
                      <textarea
                        className="form-input"
                        rows={3}
                        style={{ minHeight: 60, resize: 'vertical' }}
                        value={row.description}
                        onChange={e => updateRow(row.id, 'description', e.target.value)}
                        placeholder="Particulars / model description"
                        aria-label={`Row ${idx + 1} description`}
                      />
                    </div>

                    {/* Per-row vehicle override chip */}
                    {row.vehicleOverride && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: overrideOpenId === row.id ? 8 : 0, paddingLeft: 28 }}>
                        <span style={{ fontSize: 11.5, background: 'var(--blue-100)', color: 'var(--blue-700)', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                          {row.vehicleOverride.sub_category || row.vehicleOverride.description}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '1px 5px', color: 'var(--gray-400)' }}
                          onClick={() => clearOverride(row.id)}
                          title="Remove vehicle override"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Override search expander */}
                    {overrideOpenId === row.id && (
                      <div style={{ paddingLeft: 28, marginTop: 8 }} ref={overrideRef}>
                        <input
                          className="form-input"
                          placeholder="Search override vehicle…"
                          value={overrideQuery}
                          onChange={e => setOverrideQuery(e.target.value)}
                          autoFocus
                          style={{ marginBottom: 4 }}
                        />
                        {overrideResults.length > 0 && (
                          <div className="search-dropdown" style={{ position: 'relative', boxShadow: 'none', border: '1px solid var(--gray-200)' }}>
                            {overrideResults.map(v => (
                              <div
                                key={v.id}
                                className="search-item"
                                onMouseDown={e => { e.preventDefault(); selectOverrideVehicle(row.id, v) }}
                              >
                                <div className="search-item-name">{v.sub_category || v.description}</div>
                                <div className="search-item-meta">{v.cbn} · {fmtINR(v.mrp_incl_gst)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* ── RIGHT COLUMN (sticky summary) ───────────────────── */}
          <div className="q-col-side">
            <div className="price-summary">
              <div className="ps-title">Per-Vehicle Summary</div>

              {defaultVehicle ? (
                <>
                  <div className="ps-row">
                    <span>Vehicle MRP</span>
                    <span>{fmtINR(defaultVehicle.mrp_incl_gst)}</span>
                  </div>
                  <div className="ps-row">
                    <span>TCS {tcsRate}%</span>
                    <span>{fmtINR(tcsAmount)}</span>
                  </div>

                  <div className="ps-extra">
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <label className="form-label" htmlFor="pi-rto">RTO Tax (additional)</label>
                      <input
                        id="pi-rto"
                        className="form-input"
                        type="number"
                        value={rtoTax}
                        onChange={e => setRtoTax(e.target.value)}
                        placeholder="0"
                        min="0"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="pi-ins">Insurance (additional)</label>
                      <input
                        id="pi-ins"
                        className="form-input"
                        type="number"
                        value={insurance}
                        onChange={e => setInsurance(e.target.value)}
                        placeholder="0"
                        min="0"
                      />
                    </div>
                  </div>

                  <div className="ps-divider" />
                  <div className="ps-row ps-total">
                    <span>Grand Total</span>
                    <span>{fmtINR(grandTotal)}</span>
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--gray-400)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                  Select a vehicle to see pricing
                </div>
              )}

              {!defaultVehicle && (
                <>
                  <div className="ps-extra">
                    <div className="form-group" style={{ marginBottom: 10 }}>
                      <label className="form-label" htmlFor="pi-rto">RTO Tax (additional)</label>
                      <input id="pi-rto" className="form-input" type="number" value={rtoTax} onChange={e => setRtoTax(e.target.value)} placeholder="0" min="0" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="pi-ins">Insurance (additional)</label>
                      <input id="pi-ins" className="form-input" type="number" value={insurance} onChange={e => setInsurance(e.target.value)} placeholder="0" min="0" />
                    </div>
                  </div>
                </>
              )}

              <div style={{ marginTop: 16 }}>
                {saving && savedCount > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', textAlign: 'center', marginBottom: 8 }}>
                    {savedCount} of {totalRows} generated…
                  </div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={saving || !defaultVehicle || !customer.name.trim()}
                >
                  {saving
                    ? <><span className="spinner spinner-sm" /> Generating…</>
                    : `Generate ${totalRows} Proforma Invoice${totalRows !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
