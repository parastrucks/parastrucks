import { useState, useEffect, useRef, useCallback } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { useDebounce } from '../lib/useDebounce'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateQuotationPDF } from '../utils/pdfGenerator'

const SEGMENTS = ['All Segments', 'ICV Trucks', 'MBP Trucks', 'Tippers', 'Buses', 'RMC / Boom Pump']

// Maps each UI segment label to a DB segment filter predicate
const SEGMENT_FILTER = {
  'ICV Trucks':      v => v.segment === 'ICV Truck',
  'MBP Trucks':      v => v.segment === 'MBP Truck',
  'Tippers':         v => v.segment === 'Tipper',
  'Buses':           v => v.segment === 'Bus – ICV' || v.segment === 'Bus – MCV',
  'RMC / Boom Pump': v => v.segment === 'RMC / Boom Pump',
}
const DEFAULT_TCS = 1

function calcItem(item) {
  const total_cost = Math.round(item.mrp * item.qty)
  const basic_amt = Math.round(total_cost / 1.18)
  const gst_amt = total_cost - basic_amt
  return { ...item, total_cost, basic_amt, gst_amt }
}

function today() {
  return new Date().toISOString().split('T')[0]
}
function endOfMonth() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}
function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}

export default function Quotation() {
  const { profile, isAdmin, isBackOffice } = useAuth()
  const canEditPrice = isAdmin || isBackOffice
  const canEditDescription = isAdmin || isBackOffice

  // Catalog state
  const [catalog, setCatalog] = useState([])
  const [fuseInst, setFuseInst] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)

  // Search state
  const [segment, setSegment] = useState('All Segments')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 150)
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef(null)

  // Line items
  const [lineItems, setLineItems] = useState([])

  // Customer fields
  const [customer, setCustomer] = useState({
    name: '', address: '', mobile: '', gstin: '', hypothecation: '',
  })
  const [validUntil, setValidUntil] = useState(endOfMonth())

  // Extras
  const [rtoTax, setRtoTax] = useState('')
  const [insurance, setInsurance] = useState('')
  const [tcsRate] = useState(DEFAULT_TCS)

  // UI state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()

  // Load catalog on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setCatalogLoading(true)
      setCatalogError(false)
      try {
        const query = supabase
          .from('vehicle_catalog')
          .select('id, cbn, description, sub_category, segment, tyres, mrp_incl_gst')
          .eq('is_active', true)
          .order('segment')
          .order('sub_category')
          .order('description')

        const { data, error: err } = await Promise.race([
          query,
          new Promise((_, reject) => setTimeout(() => reject(new Error('catalog_timeout')), 15000)),
        ])

        if (cancelled) return
        if (err) { console.error('Catalog load error:', err); setCatalogError(true); return }
        setCatalog(data || [])
        setFuseInst(
          new Fuse(data || [], {
            keys: [
              { name: 'sub_category', weight: 3 },
              { name: 'cbn', weight: 2 },
              { name: 'description', weight: 1 },
            ],
            threshold: 0.35,
            minMatchCharLength: 2,
          })
        )
      } catch (e) {
        if (!cancelled) { console.error('Catalog load exception:', e); setCatalogError(true) }
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const runSearch = useCallback(
    (q, seg) => {
      if (!q.trim()) { setResults([]); setShowDropdown(false); return }
      const segPred = SEGMENT_FILTER[seg]
      let pool = segPred ? catalog.filter(segPred) : catalog
      let found
      if (!fuseInst || seg !== 'All Segments') {
        const tmpFuse = new Fuse(pool, {
          keys: [
            { name: 'sub_category', weight: 3 },
            { name: 'cbn', weight: 2 },
            { name: 'description', weight: 1 },
          ],
          threshold: 0.35,
          minMatchCharLength: 2,
        })
        found = tmpFuse.search(q).map(r => r.item)
      } else {
        found = fuseInst.search(q).map(r => r.item)
      }
      setResults(found.slice(0, 12))
      setShowDropdown(found.length > 0)
    },
    [catalog, fuseInst]
  )

  useEffect(() => {
    runSearch(debouncedQuery, segment)
  }, [debouncedQuery, segment, runSearch])

  function handleQueryChange(e) {
    setQuery(e.target.value)
  }

  function handleSegmentChange(e) {
    setSegment(e.target.value)
  }

  function addVehicle(vehicle) {
    // Prevent exact duplicate CBN
    if (lineItems.some(li => li.cbn === vehicle.cbn)) {
      toast.error('This vehicle is already in the quotation.')
      setShowDropdown(false)
      return
    }
    const newItem = calcItem({
      cbn: vehicle.cbn,
      description: vehicle.description,
      original_description: vehicle.description,
      tyres: vehicle.tyres,
      qty: 1,
      mrp: vehicle.mrp_incl_gst,
      basic_amt: 0,
      gst_amt: 0,
      total_cost: 0,
    })
    setLineItems(prev => [...prev, newItem])
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  function removeItem(idx) {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx, field, raw) {
    setLineItems(prev => {
      const copy = [...prev]
      const item = { ...copy[idx] }
      if (field === 'qty') {
        item.qty = Math.max(1, parseInt(raw, 10) || 1)
        copy[idx] = calcItem(item)
      } else if (field === 'mrp') {
        item.mrp = parseInt(raw, 10) || 0
        copy[idx] = calcItem(item)
      } else if (field === 'description') {
        item.description = raw
        copy[idx] = item
      }
      return copy
    })
  }

  function resetDescription(idx) {
    setLineItems(prev => {
      const copy = [...prev]
      const item = { ...copy[idx] }
      item.description = item.original_description || item.description
      copy[idx] = item
      return copy
    })
  }

  // Computed totals
  const vehicleSubtotal = lineItems.reduce((s, i) => s + i.total_cost, 0)
  const tcsAmount = Math.round(vehicleSubtotal * tcsRate / 100)
  const grandTotal = vehicleSubtotal + tcsAmount + (parseInt(rtoTax, 10) || 0) + (parseInt(insurance, 10) || 0)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!customer.name.trim()) { setError('Customer name is required.'); return }
    if (lineItems.length === 0) { setError('Add at least one vehicle.'); return }
    const emptyDescIdx = lineItems.findIndex(li => !String(li.description || '').trim())
    if (emptyDescIdx !== -1) {
      setError(`Vehicle #${emptyDescIdx + 1} description cannot be empty.`)
      return
    }

    // Determine entity code for quotation numbering:
    // Prefer operating_unit → location → entity mapping, fall back to profile.entity
    let entityCode = profile?.entity || 'PTB'
    let entityData = null

    setSaving(true)
    try {
      // Try to get entity details from operating_units (brand + location specific)
      if (profile?.brand && profile?.location) {
        const { data: ou } = await supabase
          .from('operating_units')
          .select('entity_code, full_name, address, gstin, bank_name, bank_account, bank_ifsc')
          .eq('brand', profile.brand)
          .eq('location', profile.location)
          .eq('is_active', true)
          .single()
        if (ou) {
          entityCode = ou.entity_code || entityCode
          entityData = { full_name: ou.full_name, address: ou.address, gstin: ou.gstin, bank_name: ou.bank_name, bank_account: ou.bank_account, bank_ifsc: ou.bank_ifsc }
        }
      }

      // Fall back to entities table if operating_unit not found
      if (!entityData) {
        const { data: ent, error: eErr } = await supabase
          .from('entities')
          .select('full_name, address, gstin, bank_name, bank_account, bank_ifsc')
          .eq('code', entityCode)
          .single()
        if (eErr) throw eErr
        entityData = ent
      }

      // Get next quotation number (atomic RPC)
      const { data: qNum, error: rpcErr } = await supabase.rpc('next_quotation_number', { p_entity: entityCode })
      if (rpcErr) throw rpcErr

      const rtoVal = parseInt(rtoTax, 10) || null
      const insVal = parseInt(insurance, 10) || null

      // Insert quotation
      const { error: insertErr } = await supabase.from('quotations').insert({
        quotation_number: qNum,
        entity: entityCode,
        created_by: profile.id,
        valid_until: validUntil,
        customer_name: customer.name.trim(),
        customer_address: customer.address.trim() || null,
        customer_mobile: customer.mobile.trim() || null,
        customer_gstin: customer.gstin.trim() || null,
        hypothecation: customer.hypothecation.trim() || null,
        line_items: lineItems,
        tcs_rate: tcsRate,
        tcs_amount: tcsAmount,
        rto_tax: rtoVal,
        insurance: insVal,
        grand_total: grandTotal,
      })
      if (insertErr) throw insertErr

      // Generate PDF
      await generateQuotationPDF({
        quotationNumber: qNum,
        date: today(),
        validUntil,
        customer: {
          name: customer.name,
          address: customer.address,
          mobile: customer.mobile,
          gstin: customer.gstin,
          hypothecation: customer.hypothecation,
        },
        entity: entityData,
        entityCode,
        lineItems,
        tcsRate,
        tcsAmount,
        rtoTax: rtoVal,
        insurance: insVal,
        grandTotal,
        preparedBy: profile?.full_name,
      })

      toast.success(`Quotation ${qNum} saved and PDF downloaded.`)
      // Reset form
      setLineItems([])
      setCustomer({ name: '', address: '', mobile: '', gstin: '', hypothecation: '' })
      setRtoTax('')
      setInsurance('')
      setValidUntil(endOfMonth())
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to save quotation.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>New Quotation</h1>
        <p>Create a truck price quotation for a customer</p>
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
                  <label className="form-label" htmlFor="q-cust-name">Customer Name *</label>
                  <input
                    id="q-cust-name"
                    className="form-input"
                    value={customer.name}
                    onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))}
                    placeholder="Full name or company name"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-cust-mobile">Mobile</label>
                  <input
                    id="q-cust-mobile"
                    className="form-input"
                    value={customer.mobile}
                    onChange={e => setCustomer(c => ({ ...c, mobile: e.target.value }))}
                    placeholder="10-digit number"
                    maxLength={15}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-cust-gstin">GSTIN</label>
                  <input
                    id="q-cust-gstin"
                    className="form-input"
                    value={customer.gstin}
                    onChange={e => setCustomer(c => ({ ...c, gstin: e.target.value.toUpperCase() }))}
                    placeholder="22AAAAA0000A1Z5"
                    maxLength={15}
                  />
                </div>
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-cust-addr">Address</label>
                  <input
                    id="q-cust-addr"
                    className="form-input"
                    value={customer.address}
                    onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))}
                    placeholder="City, State"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-cust-hyp">Hypothecation</label>
                  <input
                    id="q-cust-hyp"
                    className="form-input"
                    value={customer.hypothecation}
                    onChange={e => setCustomer(c => ({ ...c, hypothecation: e.target.value }))}
                    placeholder="Bank / NBFC name"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-valid-until">Valid Until</label>
                  <input
                    id="q-valid-until"
                    type="date"
                    className="form-input"
                    value={validUntil}
                    min={today()}
                    onChange={e => setValidUntil(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Vehicle Search */}
            <div className="q-section">
              <div className="q-section-title">
                Vehicles
                {catalogLoading && (
                  <span style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                    <span className="spinner spinner-sm" style={{ display: 'inline-block' }} />
                  </span>
                )}
                {catalogError && (
                  <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--red)', fontWeight: 400 }}>
                    Failed to load —{' '}
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      style={{ color: 'var(--blue)', fontWeight: 600, fontSize: 13, textDecoration: 'underline' }}
                    >
                      Retry
                    </button>
                  </span>
                )}
              </div>

              <div className="search-wrap" ref={searchRef} style={{ marginBottom: 16 }}>
                <div className="search-row">
                  <select
                    className="form-select"
                    value={segment}
                    onChange={handleSegmentChange}
                    style={{ width: 160 }}
                    aria-label="Vehicle segment filter"
                  >
                    {SEGMENTS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    value={query}
                    onChange={handleQueryChange}
                    onFocus={() => results.length > 0 && setShowDropdown(true)}
                    placeholder="Search by model name or CBN…"
                    disabled={catalogLoading}
                    autoComplete="off"
                  />
                </div>

                {showDropdown && (
                  <div className="search-dropdown">
                    {results.map(v => (
                      <div
                        key={v.cbn}
                        className="search-item"
                        onMouseDown={() => addVehicle(v)}
                      >
                        <div className="search-item-info">
                          <div className="search-item-name">{v.sub_category || v.description}</div>
                          <div className="search-item-meta">{v.cbn} · {v.tyres}</div>
                        </div>
                        <div className="search-item-price">{fmtINR(v.mrp_incl_gst)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Line items table */}
              <div className="table-wrap">
                <table className="line-items-table">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Tyres</th>
                      <th>Qty</th>
                      <th className="text-right">MRP (incl. GST)</th>
                      <th className="text-right">Basic Amt</th>
                      <th className="text-right">GST 18%</th>
                      <th className="text-right">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="line-items-empty">
                          Search and add vehicles above
                        </td>
                      </tr>
                    ) : (
                      lineItems.map((item, idx) => {
                        const isEdited =
                          item.original_description != null &&
                          item.description !== item.original_description
                        return (
                        <tr key={`${item.cbn}-${idx}`}>
                          <td className="td-vehicle">
                            {canEditDescription ? (
                              <textarea
                                className="form-input"
                                value={item.description || ''}
                                rows={2}
                                placeholder="Edit description for this quotation only…"
                                onChange={e => updateItem(idx, 'description', e.target.value)}
                                onInput={e => {
                                  e.currentTarget.style.height = 'auto'
                                  e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
                                }}
                                style={{
                                  width: '100%',
                                  minHeight: 44,
                                  resize: 'vertical',
                                  fontWeight: 600,
                                  fontSize: 13.5,
                                  lineHeight: 1.35,
                                  padding: '6px 8px',
                                }}
                              />
                            ) : (
                              <strong>{item.description}</strong>
                            )}
                            <span>{item.cbn}</span>
                            {isEdited && (
                              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span className="badge badge-amber">edited</span>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => resetDescription(idx)}
                                  title="Revert to the current catalog description"
                                >
                                  Reset to catalog
                                </button>
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{item.tyres || '—'}</td>
                          <td className="td-qty">
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={item.qty}
                              onChange={e => updateItem(idx, 'qty', e.target.value)}
                            />
                          </td>
                          <td className="td-price text-right">
                            <input
                              type="number"
                              value={item.mrp}
                              readOnly={!canEditPrice}
                              onChange={e => canEditPrice && updateItem(idx, 'mrp', e.target.value)}
                            />
                          </td>
                          <td className="text-right" style={{ fontWeight: 500 }}>
                            {fmtINR(item.basic_amt)}
                          </td>
                          <td className="text-right" style={{ color: 'var(--gray-500)' }}>
                            {fmtINR(item.gst_amt)}
                          </td>
                          <td className="text-right" style={{ fontWeight: 700 }}>
                            {fmtINR(item.total_cost)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="remove-btn"
                              onClick={() => removeItem(idx)}
                              title="Remove"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {!canEditPrice && (
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>
                  Prices are locked to catalog MRP. Contact back office to adjust pricing.
                </p>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN ─────────────────────────────────────── */}
          <div className="q-col-side" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Extras */}
            <div className="q-section">
              <div className="q-section-title">Additional Charges</div>
              <div className="extras-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-rto">RTO Tax (₹)</label>
                  <input
                    id="q-rto"
                    type="number"
                    className="form-input"
                    value={rtoTax}
                    onChange={e => setRtoTax(e.target.value)}
                    placeholder="0"
                    min={0}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="q-insurance">Insurance (₹)</label>
                  <input
                    id="q-insurance"
                    type="number"
                    className="form-input"
                    value={insurance}
                    onChange={e => setInsurance(e.target.value)}
                    placeholder="0"
                    min={0}
                  />
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 10 }}>
                TCS @ {tcsRate}% on vehicle subtotal is applied automatically.
              </p>
            </div>

            {/* Summary */}
            <div className="q-section">
              <div className="q-section-title">Price Summary</div>
              <div className="q-summary">
                <div className="q-summary-row">
                  <span className="q-summary-label">Vehicle Subtotal</span>
                  <span className="q-summary-value">{fmtINR(vehicleSubtotal)}</span>
                </div>
                <div className="q-summary-row">
                  <span className="q-summary-label">TCS @ {tcsRate}%</span>
                  <span className="q-summary-value">{fmtINR(tcsAmount)}</span>
                </div>
                {rtoTax && (
                  <div className="q-summary-row">
                    <span className="q-summary-label">RTO Tax</span>
                    <span className="q-summary-value">{fmtINR(parseInt(rtoTax, 10))}</span>
                  </div>
                )}
                {insurance && (
                  <div className="q-summary-row">
                    <span className="q-summary-label">Insurance</span>
                    <span className="q-summary-value">{fmtINR(parseInt(insurance, 10))}</span>
                  </div>
                )}
                <div className="q-summary-row total">
                  <span>Grand Total</span>
                  <span>{fmtINR(grandTotal)}</span>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                style={{ marginTop: 16 }}
                disabled={saving || lineItems.length === 0 || !customer.name.trim()}
              >
                {saving ? (
                  <><span className="spinner spinner-sm" /> Saving…</>
                ) : (
                  '💾 Save & Download PDF'
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
