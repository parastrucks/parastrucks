import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { generateFinancierCopyPdf, buildFinancierCopyPdfArgs } from '../utils/pdfGenerator'
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

export default function MyFinancierCopies() {
  const { profile, canAccess } = useAuth()
  const [copies, setCopies] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const toast = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('financier_copies')
        .select(`
          id, fc_number, created_at, valid_until,
          chassis_no, engine_no,
          customer_name, customer_address, customer_mobile, customer_gstin, hypothecation,
          line_items, tcs_rate, tcs_amount, rto_tax, insurance, grand_total,
          ship_to, tax_type, seller_state_code, buyer_state_code,
          amount_in_words, customer_pan, pdf_format_version,
          entity_id, entities(code)
        `)
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
      if (err) {
        toast.error("Failed to load financier's copies.")
        setLoading(false)
        return
      }
      setCopies(data || [])
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

      await generateFinancierCopyPdf(
        buildFinancierCopyPdfArgs(p, entityData, entityCode, profile?.full_name)
      )
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate PDF.')
    } finally {
      setDownloadingId(null)
    }
  }

  const pdfBtn = (p) => (
    <button className="btn btn-secondary btn-sm" onClick={() => handleRedownload(p)} disabled={downloadingId === p.id}>
      {downloadingId === p.id
        ? <><span className="spinner spinner-sm" /> Generating…</>
        : <><Icon name="download" size={15} /> PDF</>}
    </button>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Financier's Copies</div>
          <h1 className="page-head-title">My Financier's Copies<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Your financier's copy history — re-download any PDF</div>
        </div>
        {canAccess('/financier-copy') && (
          <Link to="/financier-copy" className="btn btn-primary page-head-right"><Icon name="plus" size={15} /> New Copy</Link>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <Skeleton variant="row" count={5} />
        </div>
      ) : copies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="landmark" size={40} color="var(--text-muted)" /></div>
          <h3>No financier's copies yet</h3>
          <p>Financier's copies you create will appear here.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap only-desktop">
            <table>
              <thead>
                <tr>
                  <th>FC Number</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Chassis No.</th>
                  <th className="text-right">Grand Total</th>
                  <th>Valid Until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {copies.map(p => (
                  <tr key={p.id}>
                    <td><span className="q-number">{p.fc_number}</span></td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>
                      <div className="q-customer">{p.customer_name}</div>
                      {p.customer_mobile && <div className="q-customer-sub">{p.customer_mobile}</div>}
                    </td>
                    <td>
                      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.chassis_no}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.engine_no}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtINR(p.grand_total)}</td>
                    <td>{fmtDate(p.valid_until)}</td>
                    <td>{pdfBtn(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="only-mobile mobile-cards">
            {copies.map(p => (
              <div className="m-card" key={p.id}>
                <div className="m-card-top">
                  <span className="q-number">{p.fc_number}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(p.created_at)}</span>
                </div>
                <div className="q-customer">{p.customer_name}</div>
                {p.customer_mobile && <div className="q-customer-sub">{p.customer_mobile}</div>}
                <div className="m-card-kvs">
                  <div><div className="m-kv-label">Grand Total</div><div className="m-kv-val">{fmtINR(p.grand_total)}</div></div>
                  <div><div className="m-kv-label">Valid Until</div><div className="m-kv-val">{fmtDate(p.valid_until)}</div></div>
                  <div><div className="m-kv-label">Chassis / Engine</div><div className="m-kv-val" style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{p.chassis_no}{p.engine_no ? ` / ${p.engine_no}` : ''}</div></div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>{pdfBtn(p)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
