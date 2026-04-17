import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateProformaPdf } from '../utils/pdfGenerator'
import Skeleton from '../components/Skeleton'

function fmtINR(n) {
  if (!n && n !== 0) return '—'
  return '₹\u00a0' + Number(n).toLocaleString('en-IN')
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MyProformas() {
  const { profile } = useAuth()
  const [proformas, setProformas] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const toast = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('proforma_invoices')
        .select(`
          id, pi_number, created_at, valid_until,
          chassis_no, engine_no,
          customer_name, customer_address, customer_mobile, customer_gstin, hypothecation,
          line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total,
          entity_id, entities(code)
        `)
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
      if (err) {
        toast.error('Failed to load proforma invoices.')
        setLoading(false)
        return
      }
      setProformas(data || [])
      setLoading(false)
    }
    if (profile?.id) load()
  }, [profile?.id])

  async function handleRedownload(p) {
    setDownloadingId(p.id)
    try {
      const entityCode = p.entities?.code
      const { data: entityData, error: eErr } = await supabase
        .from('entities')
        .select('full_name, address, gstin, bank_name, bank_account, bank_ifsc')
        .eq('id', p.entity_id)
        .single()
      if (eErr) throw eErr

      await generateProformaPdf({
        piNumber:   p.pi_number,
        date:       p.created_at?.split('T')[0],
        validUntil: p.valid_until,
        customer: {
          name:          p.customer_name,
          address:       p.customer_address,
          mobile:        p.customer_mobile,
          gstin:         p.customer_gstin,
          hypothecation: p.hypothecation,
        },
        entity:     entityData,
        entityCode,
        lineItems:  p.line_items,
        tcsRate:    p.tcs_rate,
        tcsAmount:  p.tcs_amount,
        rtoTax:     p.rto_tax,
        insurance:  p.insurance,
        grandTotal: p.grand_total,
        chassisNo:  p.chassis_no,
        engineNo:   p.engine_no,
        preparedBy: profile?.full_name,
      })
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate PDF.')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>My Proforma Invoices</h1>
        <p>Your proforma invoice history — re-download any PDF</p>
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={5} />
        </div>
      ) : proformas.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <h3>No proforma invoices yet</h3>
          <p>Proforma invoices you create will appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PI Number</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Chassis No.</th>
                <th className="text-right">Grand Total</th>
                <th>Valid Until</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proformas.map(p => (
                <tr key={p.id}>
                  <td><span className="q-number">{p.pi_number}</span></td>
                  <td>{fmtDate(p.created_at)}</td>
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
                  <td>{fmtDate(p.valid_until)}</td>
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
      )}
    </div>
  )
}
