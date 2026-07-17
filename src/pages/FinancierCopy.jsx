import { useState, useEffect, useRef, useCallback } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import Icon from '../components/Icon'
import { useDebounce } from '../lib/useDebounce'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateFinancierCopyPdf } from '../utils/pdfGenerator'
import {
  deriveTaxType, splitGst, stateCodeFromGstin, panFromGstin,
} from '../utils/gstUtils'
import { inrInWords } from '../utils/amountInWords'

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
  // hsn is per-model (same HSN code applies to every chassis row of the same variant).
  // Stored in component state only; persisted into line_items JSONB on save.
  return { id: modelIdCounter++, vehicle, hsn: '', rows: [newRow(vehicle)] }
}

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}

// Format a Date as YYYY-MM-DD using LOCAL calendar fields. Deliberately not
// toISOString() — that converts to UTC, so between 00:00–05:30 IST the date
// would roll back a day (e.g. 31-May 02:00 IST → 30-May UTC).
function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function today() {
  return fmtLocalDate(new Date())
}
function endOfMonth() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  return fmtLocalDate(d)
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
      ? new Fuse(pool, { keys: [{ name: 'sub_category', weight: 3 }, { name: 'cbn', weight: 2 }, { name: 'description', weight: 1 }], threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2 })
      : fuseInst
    setResults(tmpFuse.search(q).map(r => r.item).slice(0, 12))
    setShowDropdown(true)
  }, [catalog, fuseInst])

  useEffect(() => { runSearch(debouncedQuery, segment) }, [debouncedQuery, segment, runSearch])

  return { query, setQuery, segment, setSegment, results, showDropdown, setShowDropdown }
}

export default function FinancierCopy() {
  const { profile } = useAuth()
  const toast = useToast()

  const [catalog, setCatalog] = useState([])
  const [fuseInst, setFuseInst] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState(false)

  const searchRef = useRef(null)
  const search = useVehicleSearch(catalog, fuseInst)

  // models: [{ id, vehicle, rows: [{id, chassis_no, engine_no, description, mrp, rtoTax, insurance}] }]
  const [models, setModels] = useState([])

  const [customer, setCustomer] = useState({
    name: '', address: '', mobile: '', gstin: '', hypothecation: '',
  })
  // Optional "ship to a different address" block. Off by default; when off
  // the PDF renders ship = bill.
  const [shipTo, setShipTo] = useState({
    enabled: false, name: '', address: '', gstin: '', state: '',
  })
  const [validUntil, setValidUntil] = useState(endOfMonth())
  const [tcsRate] = useState(DEFAULT_TCS)

  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState(null) // which field to flag red on validation

  useEffect(() => {
    let cancelled = false
    async function load() {
      setCatalogLoading(true)
      setCatalogError(false)
      try {
        // Phase 9.7 R2: paginated — see ../lib/fetchAll. fetchAllRows throws on
        // a failed page, which the catch below already turns into a catalog
        // error, so a partial list can never reach the search index.
        const data = await fetchAllRows(() => supabase
          .from('vehicle_catalog')
          .select('id, cbn, description, sub_category, segment, tyres, mrp_incl_gst, brand_id')
          .eq('is_active', true)
          .order('segment').order('sub_category').order('description')
          .order('id'))  // tiebreak: offset paging needs a total order
        if (cancelled) return
        setCatalog(data || [])
        setFuseInst(new Fuse(data || [], {
          keys: [{ name: 'sub_category', weight: 3 }, { name: 'cbn', weight: 2 }, { name: 'description', weight: 1 }],
          threshold: 0.35,
          ignoreLocation: true,
          minMatchCharLength: 2,
        }))
      } catch {
        if (!cancelled) { setCatalogError(true); toast.error('Failed to load vehicle catalog.') }
      }
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
    setErrorField(f => f === 'search' ? null : f)
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
    // Clear the inline error as soon as the offending field is touched.
    if (field === 'chassis_no' || field === 'engine_no') {
      setErrorField(f => f === `ce-${modelId}-${rowId}` ? null : f)
    } else if (field === 'mrp') {
      setErrorField(f => f === `mrp-${modelId}-${rowId}` ? null : f)
    }
  }

  function updateModelHsn(modelId, value) {
    setModels(prev => prev.map(m =>
      m.id === modelId ? { ...m, hsn: value.replace(/[^0-9]/g, '').slice(0, 12) } : m
    ))
  }

  const totalRows = models.reduce((n, m) => n + m.rows.length, 0)

  // Batch totals
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
    setErrorField(null)
    setSavedCount(0)

    const focusEl = (el) => {
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }) } catch { el.focus() } }
    }

    if (!customer.name.trim()) {
      setError('Customer name is required.')
      setErrorField('name')
      focusEl(document.getElementById('fc-cust-name'))
      return
    }
    if (customer.gstin.trim() && customer.gstin.trim().length !== 15) {
      setError('GSTIN must be exactly 15 characters.')
      setErrorField('gstin')
      focusEl(document.getElementById('fc-cust-gstin'))
      return
    }
    if (totalRows === 0) {
      setError('Select at least one vehicle.')
      setErrorField('search')
      focusEl(document.getElementById('fc-search'))
      return
    }

    // Ship-to validation (only when toggled on). State is optional — it's
    // derived from the ship-to GSTIN when provided, and falls back to the
    // bill-to state otherwise. Only the GSTIN length rule is enforced.
    if (shipTo.enabled && shipTo.gstin.trim() && shipTo.gstin.trim().length !== 15) {
      setError('Ship-to GSTIN must be exactly 15 characters.')
      setErrorField('ship-gstin')
      focusEl(document.getElementById('fc-ship-gstin'))
      return
    }

    for (let mi = 0; mi < models.length; mi++) {
      const m = models[mi]
      for (let ri = 0; ri < m.rows.length; ri++) {
        const r = m.rows[ri]
        if (!r.chassis_no.trim() || !r.engine_no.trim()) {
          setError(`Model ${mi + 1} row ${ri + 1}: Chassis No and Engine No required.`)
          setErrorField(`ce-${m.id}-${r.id}`)
          focusEl(document.getElementById(
            !r.chassis_no.trim() ? `fc-chassis-${m.id}-${r.id}` : `fc-engine-${m.id}-${r.id}`
          ))
          return
        }
        if (!(parseInt(r.mrp, 10) > 0)) {
          setError(`Model ${mi + 1} row ${ri + 1}: MRP must be greater than 0.`)
          setErrorField(`mrp-${m.id}-${r.id}`)
          focusEl(document.getElementById(`fc-mrp-${m.id}-${r.id}`))
          return
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

      // ── Derive tax regime & state codes ONCE — same for every row in this batch,
      // since they all share the same buyer and seller.
      const sellerStateCode = stateCodeFromGstin(entityData.gstin)
      const buyerGstinForTax = (shipTo.enabled && shipTo.gstin.trim())
        ? shipTo.gstin.trim()
        : customer.gstin.trim()
      const taxType = deriveTaxType({
        sellerGstin: entityData.gstin,
        buyerGstin:  buyerGstinForTax,
        fallback:    'intra',
      })
      const buyerStateCode = stateCodeFromGstin(buyerGstinForTax) || sellerStateCode
      const customerPan    = panFromGstin(customer.gstin)

      let count = 0
      for (const model of models) {
        const vehicle = model.vehicle
        const brandId = vehicle.brand_id
        const hsn     = (model.hsn || '').trim()

        for (const row of model.rows) {
          const mrpIncl = parseInt(row.mrp, 10) || 0         // GST-inclusive MRP (what the user entered)
          const rtoVal  = parseInt(row.rtoTax, 10) || null
          const insVal  = parseInt(row.insurance, 10) || null

          // Reverse-calculate taxable value and per-head tax split.
          // 18% is the only GST rate in our flow (per plan).
          const taxable = Math.round(mrpIncl / 1.18)
          const { cgst, sgst, igst } = splitGst(taxable, 18, taxType)

          // Line "Total Amt" = taxable + tax heads. Since mrpIncl was our input
          // (GST-inclusive), this equals mrpIncl back within +/- 1 rupee of rounding.
          const lineTotal = taxable + cgst + sgst + igst
          const lineItem = {
            cbn:         vehicle.cbn,
            description: row.description.trim() || vehicle.description,
            hsn:         hsn || null,
            qty:         1,
            mrp_incl:    mrpIncl,
            taxable,
            cgst_rate:   taxType === 'intra' ? 9  : 0,
            cgst_amt:    cgst,
            sgst_rate:   taxType === 'intra' ? 9  : 0,
            sgst_amt:    sgst,
            igst_rate:   taxType === 'inter' ? 18 : 0,
            igst_amt:    igst,
            total:       lineTotal,
            chassis_no:  row.chassis_no.trim(),
            engine_no:   row.engine_no.trim(),
            rto:         rtoVal,
            insurance:   insVal,
            brand_id:    brandId,
          }
          const lineItems = [lineItem]

          // Totals for THIS FC (single line)
          const taxableTotal = lineItem.taxable
          const cgstTotal    = lineItem.cgst_amt
          const sgstTotal    = lineItem.sgst_amt
          const igstTotal    = lineItem.igst_amt
          const afterTax     = taxableTotal + cgstTotal + sgstTotal + igstTotal
          const rowTcsAmount = Math.round(mrpIncl * tcsRate / 100)
          const gTotal       = afterTax + (rtoVal || 0) + (insVal || 0) + rowTcsAmount
          const amountInWords = inrInWords(gTotal)

          const { data: fcNum, error: rpcErr } = await supabase.rpc('next_financier_copy_number', { p_entity_id: entityId })
          if (rpcErr) throw new Error(`Row ${count + 1}: ${rpcErr.message}`)

          const { error: insertErr } = await supabase.from('financier_copies').insert({
            fc_number:          fcNum,
            entity_id:          entityId,
            brand_id:           brandId,
            created_by:         profile.id,
            chassis_no:         row.chassis_no.trim(),
            engine_no:          row.engine_no.trim(),
            customer_name:      customer.name.trim(),
            customer_address:   customer.address.trim() || null,
            customer_mobile:    customer.mobile.trim() || null,
            customer_gstin:     customer.gstin.trim() || null,
            hypothecation:      customer.hypothecation.trim() || null,
            valid_until:        validUntil,
            line_items:         lineItems,
            tcs_rate:           tcsRate,
            tcs_amount:         rowTcsAmount,
            rto_tax:            rtoVal,
            insurance:          insVal,
            grand_total:        gTotal,
            // V2 snapshot columns — persisted so re-download reproduces byte-identically
            ship_to:            shipTo.enabled ? shipTo : null,
            tax_type:           taxType,
            seller_state_code:  sellerStateCode,
            buyer_state_code:   buyerStateCode,
            amount_in_words:    amountInWords,
            customer_pan:       customerPan,
            pdf_format_version: 2,
          })
          if (insertErr) throw new Error(`Row ${count + 1}: ${insertErr.message}`)

          await generateFinancierCopyPdf({
            pdf_format_version: 2,
            fcNumber:           fcNum,
            date:               today(),
            customer,
            shipTo:             shipTo.enabled ? shipTo : null,
            entity:             entityData,
            entityCode,
            lineItems,
            taxType,
            sellerStateCode,
            buyerStateCode,
            tcsRate,
            tcsAmount:          rowTcsAmount,
            totals: {
              taxableTotal, cgstTotal, sgstTotal, igstTotal,
              rtoTotal: rtoVal || 0,
              insTotal: insVal || 0,
              afterTax, gTotal,
            },
            amountInWords,
          })

          count++
          setSavedCount(count)
        }
      }

      toast.success(`${count} Financier's Cop${count !== 1 ? 'ies' : 'y'} generated and downloaded.`)

      setModels([])
      search.setQuery('')
      setCustomer({ name: '', address: '', mobile: '', gstin: '', hypothecation: '' })
      setShipTo({ enabled: false, name: '', address: '', gstin: '', state: '' })
      setValidUntil(endOfMonth())
    } catch (err) {
      console.error(err)
      // No banner: save failures surface as a toast (validation errors show
      // inline at the offending field instead).
      toast.error(err.message || "Failed to generate financier's copies.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Financier's Copies</div>
          <h1 className="page-head-title">Financier's Copy<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Generate a Tax Invoice (Financier's copy) for bank/NBFC disbursement</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="q-layout">
          <div className="q-col-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Customer Details */}
            <div className="q-section">
              <div className="q-section-title">Customer Details</div>
              <div className="customer-grid">
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="fc-cust-name">Customer Name *</label>
                  <input id="fc-cust-name" className={`form-input ${errorField === 'name' ? 'error' : ''}`} value={customer.name}
                    onChange={e => { setCustomer(c => ({ ...c, name: e.target.value })); setErrorField(f => f === 'name' ? null : f) }}
                    placeholder="Full name or company name" />
                  {errorField === 'name' && <div className="form-error">{error}</div>}
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="fc-cust-mobile">Mobile</label>
                  <input id="fc-cust-mobile" className="form-input" value={customer.mobile}
                    onChange={e => setCustomer(c => ({ ...c, mobile: e.target.value }))}
                    placeholder="10-digit number" maxLength={15} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="fc-cust-gstin">GSTIN</label>
                  <input id="fc-cust-gstin" className={`form-input ${errorField === 'gstin' ? 'error' : ''}`} value={customer.gstin}
                    onChange={e => { setCustomer(c => ({ ...c, gstin: e.target.value.toUpperCase() })); setErrorField(f => f === 'gstin' ? null : f) }}
                    placeholder="22AAAAA0000A1Z5" maxLength={15} />
                  {errorField === 'gstin' && <div className="form-error">{error}</div>}
                </div>
                <div className="form-group span-2" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="fc-cust-addr">Address</label>
                  <input id="fc-cust-addr" className="form-input" value={customer.address}
                    onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))}
                    placeholder="City, State" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor="fc-cust-hyp">Hypothecation</label>
                  <input id="fc-cust-hyp" className="form-input" value={customer.hypothecation}
                    onChange={e => setCustomer(c => ({ ...c, hypothecation: e.target.value }))}
                    placeholder="Bank / NBFC name" />
                </div>
              </div>

              {/* Optional ship-to block — off by default; when enabled the PDF
                  renders a separate "Ship To" block and the tax regime (intra vs
                  inter) is decided from the ship-to state. */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--gray-200)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>
                  <input type="checkbox" checked={shipTo.enabled}
                    onChange={e => setShipTo(s => ({ ...s, enabled: e.target.checked }))} />
                  Ship to a different address
                </label>

                {shipTo.enabled && (
                  <div className="customer-grid" style={{ marginTop: 10 }}>
                    <div className="form-group span-2" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="fc-ship-name">Ship-to Name</label>
                      <input id="fc-ship-name" className="form-input" value={shipTo.name}
                        onChange={e => setShipTo(s => ({ ...s, name: e.target.value }))}
                        placeholder="Consignee name (leave blank = same as customer)" />
                    </div>
                    <div className="form-group span-2" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="fc-ship-addr">Ship-to Address</label>
                      <input id="fc-ship-addr" className="form-input" value={shipTo.address}
                        onChange={e => setShipTo(s => ({ ...s, address: e.target.value }))}
                        placeholder="City, State" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="fc-ship-gstin">Ship-to GSTIN</label>
                      <input id="fc-ship-gstin" className={`form-input ${errorField === 'ship-gstin' ? 'error' : ''}`} value={shipTo.gstin}
                        onChange={e => { setShipTo(s => ({ ...s, gstin: e.target.value.toUpperCase() })); setErrorField(f => f === 'ship-gstin' ? null : f) }}
                        placeholder="22AAAAA0000A1Z5" maxLength={15} />
                      {errorField === 'ship-gstin' && <div className="form-error">{error}</div>}
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="fc-ship-state">Ship-to State</label>
                      <input id="fc-ship-state" className="form-input" value={shipTo.state}
                        onChange={e => setShipTo(s => ({ ...s, state: e.target.value }))}
                        placeholder="Only needed when GSTIN is blank" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Vehicle search */}
            <div className="q-section">
              <div className="q-section-title">
                Vehicle Selection
                {catalogError && (
                  <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--red)', fontWeight: 400 }}>
                    Failed to load vehicle catalog.
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <select className="form-select" value={search.segment}
                  onChange={e => search.setSegment(e.target.value)}
                  style={{ width: 160, flexShrink: 0 }} aria-label="Segment filter">
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div style={{ position: 'relative', flex: 1 }} ref={searchRef}>
                  <input id="fc-search" className={`form-input ${errorField === 'search' ? 'error' : ''}`}
                    placeholder={catalogLoading ? 'Loading catalog…' : 'Search model or sub-segment…'}
                    disabled={catalogLoading || catalogError}
                    value={search.query}
                    onChange={e => { search.setQuery(e.target.value); setErrorField(f => f === 'search' ? null : f) }}
                    onFocus={() => search.results.length > 0 && search.setShowDropdown(true)}
                    aria-label="Vehicle search" autoComplete="off" />
                  {search.showDropdown && search.results.length > 0 && (
                    <div className="search-dropdown">
                      {search.results.map(v => (
                        <div key={v.id} className="search-item"
                          onMouseDown={e => { e.preventDefault(); addModel(v) }}>
                          <div className="search-item-name">{v.sub_category || v.description}</div>
                          {v.sub_category && v.description && (
                            <div className="search-item-desc" title={v.description}>{v.description}</div>
                          )}
                          <div className="search-item-meta">{v.cbn} · {v.segment} · {fmtINR(v.mrp_incl_gst)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {errorField === 'search' && <div className="form-error">{error}</div>}
            </div>

            {/* Model chips */}
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
                    <Icon name="x" size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 0', flexWrap: 'wrap' }}>
                  <label className="form-label" style={{ margin: 0, fontSize: 12, color: 'var(--gray-600)' }}>
                    HSN Code
                  </label>
                  <input className="form-input" type="text" inputMode="numeric"
                    value={model.hsn}
                    onChange={e => updateModelHsn(model.id, e.target.value)}
                    placeholder="e.g. 87060019"
                    style={{ width: 140, padding: '4px 8px', fontSize: 13 }}
                    aria-label={`Model ${mi + 1} HSN code`} />
                  <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                    (printed on the tax invoice; not stored on the catalog)
                  </span>
                </div>

                <div className="model-chip-subtitle">
                  Chassis &amp; Engine ({model.rows.length})
                </div>

                <div className="model-chip-rows">
                  {model.rows.map((row, ri) => (
                    <div key={row.id} className="model-chip-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-400)', width: 20, flexShrink: 0 }}>#{ri + 1}</span>
                        <input id={`fc-chassis-${model.id}-${row.id}`}
                          className={`form-input ${errorField === `ce-${model.id}-${row.id}` && !row.chassis_no.trim() ? 'error' : ''}`}
                          placeholder="Chassis No."
                          value={row.chassis_no}
                          onChange={e => updateRow(model.id, row.id, 'chassis_no', e.target.value)}
                          style={{ flex: 1, minWidth: 120 }}
                          aria-label={`Model ${mi + 1} row ${ri + 1} chassis number`} />
                        <input id={`fc-engine-${model.id}-${row.id}`}
                          className={`form-input ${errorField === `ce-${model.id}-${row.id}` && !row.engine_no.trim() ? 'error' : ''}`}
                          placeholder="Engine No."
                          value={row.engine_no}
                          onChange={e => updateRow(model.id, row.id, 'engine_no', e.target.value)}
                          style={{ flex: 1, minWidth: 120 }}
                          aria-label={`Model ${mi + 1} row ${ri + 1} engine number`} />
                        <button type="button" className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', padding: '4px 8px' }}
                          onClick={() => removeRow(model.id, row.id)}
                          aria-label={`Remove row ${ri + 1}`}>
                          <Icon name="x" size={18} />
                        </button>
                      </div>
                      {errorField === `ce-${model.id}-${row.id}` && <div className="form-error">{error}</div>}

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
                          <input id={`fc-mrp-${model.id}-${row.id}`}
                            className={`form-input ${errorField === `mrp-${model.id}-${row.id}` ? 'error' : ''}`}
                            type="number" min="0"
                            value={row.mrp}
                            onChange={e => updateRow(model.id, row.id, 'mrp', e.target.value)} />
                          {errorField === `mrp-${model.id}-${row.id}` && <div className="form-error">{error}</div>}
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
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
                  disabled={saving || !customer.name.trim() || totalRows === 0 || anyInvalidMrp}>
                  {saving
                    ? <><span className="spinner spinner-sm" /> Generating…</>
                    : `Generate ${totalRows} Financier's Cop${totalRows !== 1 ? 'ies' : 'y'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
