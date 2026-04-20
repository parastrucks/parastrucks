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
let modelIdCounter = 1

function newRow(vehicle) {
  return {
    id: rowIdCounter++,
    chassis_no: '',
    engine_no: '',
    description: vehicle?.description || '',
    mrp: vehicle?.mrp_incl_gst ?? '',
    rtoTax: '',
    insurance: '',
  }
}

function newModel(vehicle) {
  return { id: modelIdCounter++, vehicle, rows: [newRow(vehicle)] }
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

  const [catalog, setCatalog] = useState([])
  const [fuseInst, setFuseInst] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)

  const searchRef = useRef(null)
  const search = useVehicleSearch(catalog, fuseInst)

  const [models, setModels] = useState([])

  const [customer, setCustomer] = useState({
    name: '', address: '', mobile: '', gstin: '', hypothecation: '',
  })
  const [validUntil, setValidUntil] = useState(endOfMonth())
  const [tcsRate] = useState(DEFAULT_TCS)

  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [error, setError] = useState('')

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

  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        search.setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function addModel(vehicle) {
    setModels(prev => [...prev, newModel(vehicle)])
    search.setQuery('')
    search.setShowDropdown(false)
  }

  function removeModel(modelId) {
    setModels(prev => prev.filter(m => m.id !== modelId))
  }

  function addRow(modelId) {
    setModels(prev => prev.map(m =>
      m.id === modelId ? { ...m, rows: [...m.rows, newRow(m.vehicle)] } : m
    ))
  }

  function removeRow(modelId, rowId) {
    setModels(prev => {
      const next = prev.map(m =>
        m.id === modelId ? { ...m, rows: m.rows.filter(r => r.id !== rowId) } : m
      )
      return next.filter(m => m.rows.length > 0)
    })
  }

  function updateRow(modelId, rowId, field, value) {
    setModels(prev => prev.map(m =>
      m.id === modelId
        ? { ...m, rows: m.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r) }
        : m
    ))
  }

  const totalRows = models.reduce((n, m) => n + m.rows.length, 0)

  const totalMrp = models.reduce((s, m) => s + m.rows.reduce((ss, r) => ss + (parseInt(r.mrp, 10) || 0), 0), 0)
  const totalTcs = models.reduce((s, m) =>
    s + m.rows.reduce((ss, r) => ss + Math.round(((parseInt(r.mrp, 10) || 0) * tcsRate) / 100), 0), 0)
  const totalRto = models.reduce((s, m) => s + m.rows.reduce((ss, r) => ss + (parseInt(r.rtoTax, 10) || 0), 0), 0)
  const totalIns = models.reduce((s, m) => s + m.rows.reduce((ss, r) => ss + (parseInt(r.insurance, 10) || 0), 0), 0)
  const grandTotal = totalMrp + totalTcs + totalRto + totalIns

  const anyInvalidMrp = models.some(m => m.rows.some(r => !(parseInt(r.mrp, 10) > 0)))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSavedCount(0)

    if (!customer.name.trim()) { setError('Customer name is required.'); return }
    if (customer.gstin.trim() && customer.gstin.trim().length !== 15) {
      setError('GSTIN must be exactly 15 characters.'); return
    }
    if (totalRows === 0) { setError('Select at least one vehicle.'); return }

    for (let mi = 0; mi < models.length; mi++) {
      const m = models[mi]
      for (let ri = 0; ri < m.rows.length; ri++) {
        const r = m.rows[ri]
        if (!r.chassis_no.trim() || !r.engine_no.trim()) {
          setError(`Model ${mi + 1} row ${ri + 1}: Chassis No and Engine No required.`); return
        }
        if (!(parseInt(r.mrp, 10) > 0)) {
          setError(`Model ${mi + 1} row ${ri + 1}: MRP must be greater than 0.`); return
        }
      }
    }

    setSaving(true)

    try {
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

      let count = 0
      for (const model of models) {
        const vehicle = model.vehicle
        const brandId = vehicle.brand_id

        for (const row of model.rows) {
          const mrp = parseInt(row.mrp, 10) || 0
          const rtoVal = parseInt(row.rtoTax, 10) || null
          const insVal = parseInt(row.insurance, 10) || null

          const lineItems = [{
            cbn:         vehicle.cbn,
            description: row.description.trim() || vehicle.description,
            qty:         1,
            mrp,
            total_cost:  mrp,
            basic_amt:   Math.round(mrp / 1.18),
            gst_amt:     mrp - Math.round(mrp / 1.18),
            brand_id:    brandId,
          }]

          const rowTcsAmount = Math.round(mrp * tcsRate / 100)
          const rowGrandTotal = mrp + rowTcsAmount + (rtoVal || 0) + (insVal || 0)

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
      }

      toast.success(`${count} Proforma Invoice${count !== 1 ? 's' : ''} generated and downloaded.`)

      setModels([])
      search.setQuery('')
      setCustomer({ name: '', address: '', mobile: '', gstin: '', hypothecation: '' })
      setValidUntil(endOfMonth())
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to generate proforma invoices.')
    } finally {
      setSaving(false)
    }
  }

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
          <div className="q-col-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div className="q-section">
              <div className="q-section-title">Customer Details</div>
              <div className="customer-grid">
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-name">Customer Name *</label>
                  <input id="pi-cust-name" className="form-input" value={customer.name}
                    onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))}
                    placeholder="Full name or company name" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-mobile">Mobile</label>
                  <input id="pi-cust-mobile" className="form-input" value={customer.mobile}
                    onChange={e => setCustomer(c => ({ ...c, mobile: e.target.value }))}
                    placeholder="10-digit number" maxLength={15} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-gstin">GSTIN</label>
                  <input id="pi-cust-gstin" className="form-input" value={customer.gstin}
                    onChange={e => setCustomer(c => ({ ...c, gstin: e.target.value.toUpperCase() }))}
                    placeholder="22AAAAA0000A1Z5" maxLength={15} />
                </div>
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-addr">Address</label>
                  <input id="pi-cust-addr" className="form-input" value={customer.address}
                    onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))}
                    placeholder="City, State" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-cust-hyp">Hypothecation</label>
                  <input id="pi-cust-hyp" className="form-input" value={customer.hypothecation}
                    onChange={e => setCustomer(c => ({ ...c, hypothecation: e.target.value }))}
                    placeholder="Bank / NBFC name" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="pi-valid-until">Valid Until</label>
                  <input id="pi-valid-until" type="date" className="form-input" value={validUntil}
                    min={today()} onChange={e => setValidUntil(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="q-section">
              <div className="q-section-title">Vehicle Selection</div>

              {catalogError && (
                <div className="alert alert-error" style={{ marginBottom: 8 }}>
                  Failed to load vehicle catalog.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <select className="form-select" value={search.segment}
                  onChange={e => search.setSegment(e.target.value)}
                  style={{ width: 160, flexShrink: 0 }} aria-label="Segment filter">
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ position: 'relative', flex: 1 }} ref={searchRef}>
                  <input className="form-input"
                    placeholder={catalogLoading ? 'Loading catalog…' : 'Search model or sub-segment…'}
                    disabled={catalogLoading || catalogError}
                    value={search.query}
                    onChange={e => search.setQuery(e.target.value)}
                    onFocus={() => search.results.length > 0 && search.setShowDropdown(true)}
                    aria-label="Vehicle search" autoComplete="off" />
                  {search.showDropdown && search.results.length > 0 && (
                    <div className="search-dropdown">
                      {search.results.map(v => (
                        <div key={v.id} className="search-item"
                          onMouseDown={e => { e.preventDefault(); addModel(v) }}>
                          <div className="search-item-name">{v.sub_category || v.description}</div>
                          <div className="search-item-meta">{v.cbn} · {v.segment} · {fmtINR(v.mrp_incl_gst)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {models.map((model, mi) => (
              <div key={model.id} className="model-chip">
                <div className="model-chip-header">
                  <div>
                    <div className="model-chip-name">{model.vehicle.description}</div>
                    <div className="model-chip-meta">
                      {model.vehicle.cbn} · catalog {fmtINR(model.vehicle.mrp_incl_gst)}
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => removeModel(model.id)}
                    aria-label={`Remove model ${mi + 1}`}>
                    ✕
                  </button>
                </div>

                <div className="model-chip-subtitle">
                  Chassis &amp; Engine ({model.rows.length})
                </div>

                <div className="model-chip-rows">
                  {model.rows.map((row, ri) => (
                    <div key={row.id} className="model-chip-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-400)', width: 20, flexShrink: 0 }}>#{ri + 1}</span>
                        <input className="form-input" placeholder="Chassis No."
                          value={row.chassis_no}
                          onChange={e => updateRow(model.id, row.id, 'chassis_no', e.target.value)}
                          style={{ flex: 1, minWidth: 120 }}
                          aria-label={`Model ${mi + 1} row ${ri + 1} chassis number`} />
                        <input className="form-input" placeholder="Engine No."
                          value={row.engine_no}
                          onChange={e => updateRow(model.id, row.id, 'engine_no', e.target.value)}
                          style={{ flex: 1, minWidth: 120 }}
                          aria-label={`Model ${mi + 1} row ${ri + 1} engine number`} />
                        <button type="button" className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', padding: '4px 8px' }}
                          onClick={() => removeRow(model.id, row.id)}
                          aria-label={`Remove row ${ri + 1}`}>
                          ✕
                        </button>
                      </div>

                      <div style={{ paddingLeft: 28, marginTop: 8 }}>
                        <textarea className="form-input" rows={3}
                          style={{ minHeight: 60, resize: 'vertical' }}
                          value={row.description}
                          onChange={e => updateRow(model.id, row.id, 'description', e.target.value)}
                          placeholder="Particulars / model description"
                          aria-label={`Model ${mi + 1} row ${ri + 1} description`} />
                      </div>

                      <div className="model-chip-row-prices">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">MRP (₹) *</label>
                          <input className="form-input" type="number" min="0"
                            value={row.mrp}
                            onChange={e => updateRow(model.id, row.id, 'mrp', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">RTO Tax (₹)</label>
                          <input className="form-input" type="number" min="0"
                            value={row.rtoTax}
                            onChange={e => updateRow(model.id, row.id, 'rtoTax', e.target.value)}
                            placeholder="0" />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Insurance (₹)</label>
                          <input className="form-input" type="number" min="0"
                            value={row.insurance}
                            onChange={e => updateRow(model.id, row.id, 'insurance', e.target.value)}
                            placeholder="0" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button type="button" className="btn btn-secondary btn-sm model-chip-add-row"
                  onClick={() => addRow(model.id)}>
                  + Add chassis for this model
                </button>
              </div>
            ))}

          </div>

          <div className="q-col-side">
            <div className="price-summary">
              <div className="ps-title">Batch Summary</div>

              {totalRows > 0 ? (
                <>
                  <div className="ps-row">
                    <span>Total MRP</span>
                    <span>{fmtINR(totalMrp)}</span>
                  </div>
                  <div className="ps-row">
                    <span>Total TCS {tcsRate}%</span>
                    <span>{fmtINR(totalTcs)}</span>
                  </div>
                  <div className="ps-row">
                    <span>Total RTO</span>
                    <span>{fmtINR(totalRto)}</span>
                  </div>
                  <div className="ps-row">
                    <span>Total Insurance</span>
                    <span>{fmtINR(totalIns)}</span>
                  </div>
                  <div className="ps-divider" />
                  <div className="ps-row ps-total">
                    <span>Grand Total</span>
                    <span>{fmtINR(grandTotal)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--gray-500)', textAlign: 'center', marginTop: 8 }}>
                    {totalRows} row{totalRows !== 1 ? 's' : ''} across {models.length} model{models.length !== 1 ? 's' : ''}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--gray-400)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                  Search and select a vehicle to begin
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                {saving && savedCount > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', textAlign: 'center', marginBottom: 8 }}>
                    {savedCount} of {totalRows} generated…
                  </div>
                )}
                {error && (
                  <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8, textAlign: 'center' }}>
                    {error}
                  </div>
                )}
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
                  disabled={saving || !customer.name.trim() || totalRows === 0 || anyInvalidMrp}>
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
