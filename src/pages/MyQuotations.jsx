import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { generateQuotationPDF } from '../utils/pdfGenerator'

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MyQuotations() {
  const { profile } = useAuth()
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null) // quotation id being downloaded
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('quotations')
        .select('id, quotation_number, created_at, valid_until, customer_name, customer_address, customer_mobile, customer_gstin, hypothecation, line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total, entity')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
      if (err) {
        setError('Failed to load quotations.')
        setLoading(false)
        return
      }
      setQuotations(data || [])
      setLoading(false)
    }
    if (profile?.id) load()
  }, [profile?.id])

  async function handleRedownload(q) {
    setDownloadingId(q.id)
    try {
      const { data: entityData, error: eErr } = await supabase
        .from('entities')
        .select('full_name, address, gstin, bank_name, bank_account, bank_ifsc')
        .eq('code', q.entity)
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
        entityCode: q.entity,
        lineItems: q.line_items,
        tcsRate: q.tcs_rate,
        tcsAmount: q.tcs_amount,
        rtoTax: q.rto_tax,
        insurance: q.insurance,
        grandTotal: q.grand_total,
        preparedBy: profile?.full_name,
      })
    } catch (err) {
      console.error(err)
      setError('Failed to generate PDF.')
      setTimeout(() => setError(''), 4000)
    } finally {
      setDownloadingId(null)
    }
  }

  const vehicleCount = (q) =>
    (q.line_items || []).reduce((s, i) => s + (i.qty || 1), 0)

  return (
    <div>
      <div className="page-header">
        <h1>My Quotations</h1>
        <p>Your quotation history — re-download any PDF</p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span>⚠</span> {error}
        </div>
      )}

      {loading ? (
        <div className="full-center" style={{ height: 240 }}>
          <span className="spinner" />
        </div>
      ) : quotations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <h3>No quotations yet</h3>
          <p>Quotations you create will appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quotation No.</th>
                <th>Date</th>
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
      )}
    </div>
  )
}
