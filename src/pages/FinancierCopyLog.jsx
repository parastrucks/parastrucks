import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateFinancierCopyPdf, buildFinancierCopyPdfArgs } from '../utils/pdfGenerator'
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

export default function FinancierCopyLog() {
  const { profile } = useAuth()
  const [copies, setCopies] = useState([])
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
        let query = supabase
          .from('financier_copies')
          .select(`
            id, fc_number, created_at, valid_until,
            chassis_no, engine_no,
            customer_name, customer_address, customer_mobile, customer_gstin, hypothecation,
            line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total,
            ship_to, tax_type, seller_state_code, buyer_state_code,
            amount_in_words, customer_pan, pdf_format_version,
            entity_id, entities(code),
            users:created_by ( full_name, designations(name) )
          `, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        if (debouncedSearch) {
          query = query.or(
            `fc_number.ilike.%${debouncedSearch}%,customer_name.ilike.%${debouncedSearch}%,chassis_no.ilike.%${debouncedSearch}%,engine_no.ilike.%${debouncedSearch}%`
          )
        }

        const { data, count, error: err } = await query
        if (cancelled) return
        if (err) {
          toast.error("Failed to load financier's copies.")
          setCopies([])
          setTotalCount(0)
          return
        }
        setCopies(data || [])
        setTotalCount(count || 0)
      } catch (e) {
        if (!cancelled) {
          console.error(e)
          toast.error("Failed to load financier's copies.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, debouncedSearch])

  async function handleRedownload(p) {
    if (!p.customer_name || !(p.line_items || []).length) {
      toast.error('Cannot re-download — customer or line items are missing.')
      return
    }
    try {
      setDownloadingId(p.id)
      const entityCode = p.entities?.code
      const { data: entityData, error: eErr } = await supabase
        .from('entities')
        .select('full_name, address, gstin, bank_name, bank_account, bank_ifsc')
        .eq('id', p.entity_id)
        .single()
      if (eErr) throw eErr

      await generateFinancierCopyPdf(
        buildFinancierCopyPdfArgs(p, entityData, entityCode, p.users?.full_name)
      )
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate PDF.')
    } finally {
      setDownloadingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const hasPrev = page > 0
  const hasNext = (page + 1) * PAGE_SIZE < totalCount

  return (
    <div>
      <div className="page-header flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Financier's Copy Log</h1>
          <p>All financier's copies across all users</p>
        </div>
        <input
          className="form-input"
          style={{ maxWidth: 300 }}
          placeholder="Search FC no., customer, chassis, engine…"
          aria-label="Search financier's copies"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={6} />
        </div>
      ) : copies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <h3>{debouncedSearch ? 'No results found' : "No financier's copies yet"}</h3>
          <p>{debouncedSearch ? 'Try a different search term.' : "Financier's copies created by the team will appear here."}</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--gray-500)' }}>
            {totalCount} financier's cop{totalCount !== 1 ? 'ies' : 'y'}
            {debouncedSearch && ` matching "${debouncedSearch}"`}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>FC Number</th>
                  <th>Date</th>
                  <th>Prepared By</th>
                  <th>Customer</th>
                  <th>Chassis / Engine</th>
                  <th className="text-right">Grand Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {copies.map(p => (
                  <tr key={p.id}>
                    <td><span className="q-number">{p.fc_number}</span></td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: 13 }}>
                        {p.users?.full_name || '—'}
                      </div>
                      {p.users?.designations?.name && (
                        <div style={{ fontSize: 11.5, color: 'var(--gray-400)' }}>
                          {p.users.designations.name}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="q-customer">{p.customer_name}</div>
                      {p.customer_mobile && (
                        <div className="q-customer-sub">{p.customer_mobile}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.chassis_no}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'monospace' }}>{p.engine_no}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtINR(p.grand_total)}</td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRedownload(p)}
                        disabled={downloadingId === p.id}
                      >
                        {downloadingId === p.id
                          ? <><span className="spinner spinner-sm" /> Generating…</>
                          : '↓ PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
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
