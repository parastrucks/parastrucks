import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { generateQuotationPDF } from '../utils/pdfGenerator'
import Skeleton from '../components/Skeleton'

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PAGE_SIZE = 25

export default function QuotationLog() {
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(0)
    }, 150)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // Phase 6c.3: quotations.entity dropped; users.role dropped.
        // Prepared-by column now shows designation via designations FK.
        let query = supabase
          .from('quotations')
          .select(`
            id, quotation_number, created_at, valid_until,
            customer_name, customer_address, customer_mobile, customer_gstin, hypothecation,
            line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total,
            entity_id, entities(code),
            users:created_by ( full_name, designations(name) )
          `, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        if (debouncedSearch) {
          query = query.or(
            `quotation_number.ilike.%${debouncedSearch}%,customer_name.ilike.%${debouncedSearch}%`
          )
        }

        const { data, count, error: err } = await query
        if (cancelled) return
        if (err) {
          toast.error('Failed to load quotations.')
          setQuotations([])
          setTotalCount(0)
          return
        }
        setQuotations(data || [])
        setTotalCount(count || 0)
      } catch (e) {
        if (!cancelled) {
          console.error(e)
          toast.error('Failed to load quotations.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, debouncedSearch])

  async function handleRedownload(q) {
    if (!q.customer_name || !(q.line_items || []).length) {
      toast.error('Cannot re-download — customer or line items are missing.')
      return
    }
    try {
      setDownloadingId(q.id)
      const entityCode = q.entities?.code
      const { data: entityData, error: eErr } = await supabase
        .from('entities')
        .select('full_name, address, gstin, bank_name, bank_account, bank_ifsc')
        .eq('id', q.entity_id)
        .single()
      if (eErr) throw eErr

      await generateQuotationPDF({
        quotationNumber: q.quotation_number,
        date: q.created_at?.split('T')[0],
        validUntil: q.valid_until,
        customer: {
          name: q.customer_name,
          address: q.customer_address,
          mobile: q.customer_mobile,
          gstin: q.customer_gstin,
          hypothecation: q.hypothecation,
        },
        entity: entityData,
        entityCode,
        lineItems: q.line_items,
        tcsRate: q.tcs_rate,
        tcsAmount: q.tcs_amount,
        rtoTax: q.rto_tax,
        insurance: q.insurance,
        grandTotal: q.grand_total,
        preparedBy: q.users?.full_name,
      })
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate PDF.')
    } finally {
      setDownloadingId(null)
    }
  }

  const vehicleCount = (q) =>
    (q.line_items || []).reduce((s, i) => s + (i.qty || 1), 0)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasPrev = page > 0
  const hasNext = (page + 1) * PAGE_SIZE < totalCount

  return (
    <div>
      <div className="page-header flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Quotation Log</h1>
          <p>All quotations across all users</p>
        </div>
        <input
          className="form-input"
          style={{ maxWidth: 260 }}
          placeholder="Search quotation no. or customer…"
          aria-label="Search quotations"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={6} />
        </div>
      ) : quotations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <h3>{debouncedSearch ? 'No results found' : 'No quotations yet'}</h3>
          <p>{debouncedSearch ? 'Try a different search term.' : 'Quotations created by the team will appear here.'}</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--gray-500)' }}>
            {totalCount} quotation{totalCount !== 1 ? 's' : ''}
            {debouncedSearch && ` matching "${debouncedSearch}"`}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quotation No.</th>
                  <th>Date</th>
                  <th>Prepared By</th>
                  <th>Customer</th>
                  <th>Vehicles</th>
                  <th className="text-right">Grand Total</th>
                  <th>Valid Until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {quotations.map(q => (
                  <tr key={q.id}>
                    <td><span className="q-number">{q.quotation_number}</span></td>
                    <td>{fmtDate(q.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: 13 }}>
                        {q.users?.full_name || '—'}
                      </div>
                      {q.users?.designations?.name && (
                        <div style={{ fontSize: 11.5, color: 'var(--gray-400)' }}>
                          {q.users.designations.name}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="q-customer">{q.customer_name}</div>
                      {q.customer_mobile && (
                        <div className="q-customer-sub">{q.customer_mobile}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-blue">{vehicleCount(q)} unit{vehicleCount(q) !== 1 ? 's' : ''}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtINR(q.grand_total)}</td>
                    <td>{fmtDate(q.valid_until)}</td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRedownload(q)}
                        disabled={downloadingId === q.id}
                      >
                        {downloadingId === q.id
                          ? <><span className="spinner spinner-sm" /> Generating…</>
                          : '↓ PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 12,
              marginTop: 16,
            }}
          >
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={!hasPrev}
            >
              ← Previous
            </button>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNext}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
