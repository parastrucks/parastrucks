import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateQuotationPDF } from '../utils/pdfGenerator'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹ ' + Number(n).toLocaleString('en-IN')
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MyQuotations() {
  const { profile } = useAuth()
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const toast = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      // Phase 6c.3: quotations.entity text dropped; read entity_code via FK join.
      const { data, error: err } = await supabase
        .from('quotations')
        .select(`
          id, quotation_number, created_at, valid_until,
          customer_name, customer_address, customer_mobile, customer_gstin, hypothecation,
          line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total,
          entity_id, entities(code)
        `)
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
      if (err) {
        toast.error('Failed to load quotations.')
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
        preparedBy: profile?.full_name,
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

  const pdfBtn = (q) => (
    <button
      className="btn btn-secondary btn-sm"
      onClick={() => handleRedownload(q)}
      disabled={downloadingId === q.id}
    >
      {downloadingId === q.id
        ? <><span className="spinner spinner-sm" /> Generating…</>
        : <><Icon name="download" size={15} /> PDF</>}
    </button>
  )

  const units = (q) => `${vehicleCount(q)} unit${vehicleCount(q) !== 1 ? 's' : ''}`

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Quotations</div>
          <h1 className="page-head-title">My Quotations<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Your quotation history — re-download any PDF</div>
        </div>
        <Link to="/quotation" className="btn btn-primary page-head-right"><Icon name="plus" size={15} /> New Quotation</Link>
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={5} />
        </div>
      ) : quotations.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="file" size={40} color="var(--text-muted)" /></div>
          <h3>No quotations yet</h3>
          <p>Quotations you create will appear here.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap only-desktop">
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
                      {q.customer_mobile && <div className="q-customer-sub">{q.customer_mobile}</div>}
                    </td>
                    <td><span className="badge badge-blue">{units(q)}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtINR(q.grand_total)}</td>
                    <td>{fmtDate(q.valid_until)}</td>
                    <td>{pdfBtn(q)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="only-mobile mobile-cards">
            {quotations.map(q => (
              <div className="m-card" key={q.id}>
                <div className="m-card-top">
                  <span className="q-number">{q.quotation_number}</span>
                  <span className="badge badge-blue">{units(q)}</span>
                </div>
                <div className="q-customer">{q.customer_name}</div>
                <div className="q-customer-sub">{q.customer_mobile ? `${q.customer_mobile} · ` : ''}{fmtDate(q.created_at)}</div>
                <div className="m-card-kvs">
                  <div><div className="m-kv-label">Grand Total</div><div className="m-kv-val">{fmtINR(q.grand_total)}</div></div>
                  <div><div className="m-kv-label">Valid Until</div><div className="m-kv-val">{fmtDate(q.valid_until)}</div></div>
                </div>
                <div style={{ marginTop: 12 }}>{pdfBtn(q)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
