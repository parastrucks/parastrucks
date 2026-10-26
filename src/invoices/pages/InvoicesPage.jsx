// Credit release step 1 — Send Invoice (/invoices).
// Service / spares / accounts upload the SAP invoice PDF; the portal reads it in the
// browser (nobody types the values), shows what it read, and on one tap stores it and
// emails it to the customer. Reads are direct under RLS (gate_* tables); every write goes
// through the gate-invoices Edge Function. Plan: docs/backlog/credit-release-plan.md.
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { callEdge } from '../../lib/api'
import { formatRupees } from '../lib/sapInvoice'
import { readInvoiceFile, toBase64 } from '../lib/readInvoiceFile'
import '../invoices.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const when = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// A send still marked "sending" after this long most likely never finished.
const STUCK_MS = 2 * 60 * 1000

async function rememberedEmail(sapCode, entityId) {
  let q = supabase.from('gate_contacts').select('email').eq('sap_customer_code', sapCode)
  if (entityId) q = q.eq('entity_id', entityId)
  const { data } = await q.limit(1).maybeSingle()
  return data?.email ?? ''
}

function latestMessage(doc) {
  return [...(doc.gate_messages ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

function SendStatus({ msg }) {
  if (!msg) return <span className="badge badge-gray">Not sent</span>
  if (msg.status === 'sent') return <span className="badge badge-green">Emailed · {when(msg.finished_at ?? msg.created_at)}</span>
  if (msg.status === 'failed') return <span className="badge badge-red">Email failed</span>
  const stuck = Date.now() - new Date(msg.created_at).getTime() > STUCK_MS
  return <span className="badge badge-amber">{stuck ? 'Not confirmed — send again' : 'Sending…'}</span>
}

export default function InvoicesPage() {
  const toast = useToast()
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(null)          // 'reading' | 'saving' | null
  const [picked, setPicked] = useState(null)      // { name, bytes, reading }
  const [email, setEmail] = useState('')
  const [docs, setDocs] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [sendFor, setSendFor] = useState(null)    // { id, email } — the inline "send again" row

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('gate_documents')
      .select('id, entity_id, layout, doc_no, doc_date, customer_name, sap_customer_code, regn_no, total_paise, created_at, gate_messages(status, recipient, error, created_at, finished_at)')
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) { setLoadErr(error.message); return }
    setLoadErr(null)
    setDocs(data)
  }, [])
  useEffect(() => { load() }, [load])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPicked(null); setEmail(''); setBusy('reading')
    try {
      const { reading, bytes } = await readInvoiceFile(file)
      setPicked({ name: file.name, bytes, reading })
      if (reading.ok) setEmail(await rememberedEmail(reading.customer.sap_code))
    } catch (err) {
      setPicked({ name: file.name, reading: { ok: false, reason: `The PDF could not be opened (${err.message}).` } })
    } finally { setBusy(null) }
  }

  async function sendEmail(documentId, to) {
    try {
      await callEdge('gate-invoices', 'sendEmail', { document_id: documentId, to: to.trim(), client_request_id: crypto.randomUUID() })
      toast.success(`Emailed to ${to.trim()}`)
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }

  async function save(withEmail) {
    if (!picked?.reading?.ok) return
    if (withEmail && !EMAIL_OK.test(email.trim())) { toast.error('Enter the customer\'s email address, or choose "Save only".'); return }
    setBusy('saving')
    try {
      const r = await callEdge('gate-invoices', 'saveDocument', { file_b64: toBase64(picked.bytes), reading: picked.reading })
      if (r.already) toast.success(`${picked.reading.doc_no} was saved before — using that copy.`)
      if (withEmail) await sendEmail(r.document_id, email)
      else if (!r.already) toast.success(`${picked.reading.doc_no} saved.`)
      setPicked(null); setEmail('')
      await load()
    } catch (err) {
      toast.error(err.message)
    } finally { setBusy(null) }
  }

  async function openPdf(id) {
    // Open the tab inside the click, then point it at the signed link (pop-up blockers).
    const w = window.open('', '_blank')
    try {
      const { url } = await callEdge('gate-invoices', 'pdfUrl', { document_id: id })
      if (w) w.location.href = url; else window.location.href = url
    } catch (err) { w?.close(); toast.error(err.message) }
  }

  async function startSend(doc) {
    const last = latestMessage(doc)
    setSendFor({ id: doc.id, email: last?.recipient ?? await rememberedEmail(doc.sap_customer_code, doc.entity_id) })
  }

  const r = picked?.reading
  return (
    <div className="inv-page">
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Service Tools</div>
          <h1 className="page-head-title">Send Invoice<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Upload the invoice PDF from SAP. The portal reads it and emails it to the customer.</div>
        </div>
      </div>

      <section className="card inv-upload">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFile} hidden />
        {!picked && (
          <button className="inv-drop" onClick={() => fileRef.current?.click()} disabled={busy === 'reading'}>
            {busy === 'reading'
              ? <><span className="spinner" /> Reading the invoice…</>
              : <><Icon name="upload" size={22} /> <span><strong>Choose the invoice PDF</strong><br />The workshop job PDF, or a counter-sale invoice</span></>}
          </button>
        )}

        {picked && !r.ok && (
          <div className="inv-refused" role="alert">
            <Icon name="alert" size={18} />
            <div>
              <strong>This file was not read.</strong>
              <p>{r.reason}</p>
              <p className="inv-file">{picked.name}</p>
              <button className="btn btn-sm btn-secondary" onClick={() => { setPicked(null); fileRef.current?.click() }}>Choose another file</button>
            </div>
          </div>
        )}

        {picked && r.ok && (
          <div className="inv-read">
            <div className="inv-read-head">
              <div>
                <div className="inv-customer">{r.customer.name}</div>
                <div className="inv-meta">SAP {r.customer.sap_code}{r.customer.mobile ? ` · ${r.customer.mobile}` : ''}</div>
              </div>
              <div className="inv-vehicle">{r.layout === 'workshop' ? (r.vehicle?.regn_no ?? 'No vehicle no.') : 'Counter sale'}</div>
            </div>
            <div className="inv-meta">
              {r.layout === 'workshop' ? `Job card ${r.doc_no}` : `Invoice ${r.doc_no}`} · {day(r.doc_date)}
              {r.payment_terms ? ` · ${r.payment_terms === 'credit' ? 'Credit' : r.payment_terms}` : ''}
            </div>
            <table className="inv-bills">
              <tbody>
                {r.bills.map((b) => (
                  <tr key={b.bill_no}>
                    <td>{b.bill_no}</td>
                    <td>{b.terms && <span className={`badge ${b.terms === 'credit' ? 'badge-amber' : 'badge-gray'}`}>{b.terms === 'credit' ? 'Credit' : 'Cash'}</span>}</td>
                    <td className="num">{formatRupees(b.amount_paise)}</td>
                  </tr>
                ))}
                <tr className="inv-total"><td>Total</td><td /><td className="num">{formatRupees(r.total_paise)}</td></tr>
              </tbody>
            </table>
            <p className="inv-checks"><Icon name="check" size={14} /> {r.checks.join(' · ')}</p>

            <div className="form-group">
              <label className="form-label" htmlFor="inv-email">Customer's email</label>
              <input id="inv-email" className="form-input" type="email" inputMode="email" autoComplete="off"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              <div className="field-hint">SAP invoices carry no email. The address is remembered for this customer next time.</div>
            </div>
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={() => save(true)} disabled={!!busy}>
                {busy === 'saving' ? 'Saving…' : <><Icon name="mail" size={15} /> Save and email</>}
              </button>
              <button className="btn btn-secondary" onClick={() => save(false)} disabled={!!busy}>Save only</button>
              <button className="btn btn-secondary inv-cancel" onClick={() => { setPicked(null); setEmail('') }} disabled={!!busy}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <h2 className="inv-h2">Recent invoices</h2>
      {loadErr && <div className="form-error" role="alert">Could not load the list: {loadErr}</div>}
      {!docs && !loadErr && <div className="inv-empty"><span className="spinner" /></div>}
      {docs && docs.length === 0 && <div className="inv-empty">No invoices uploaded yet.</div>}
      {docs && docs.length > 0 && (
        <ul className="inv-list">
          {docs.map((d) => {
            const last = latestMessage(d)
            return (
              <li key={d.id} className="inv-row">
                <div className="inv-row-main">
                  <div className="inv-row-name">{d.customer_name}</div>
                  <div className="inv-meta">
                    {d.layout === 'workshop' ? (d.regn_no ?? d.doc_no) : 'Counter sale'} · {d.doc_no} · {day(d.doc_date)}
                  </div>
                  {last?.status === 'sent' && <div className="inv-meta">To {last.recipient}</div>}
                  {last?.status === 'failed' && <div className="inv-fail">{last.error}</div>}
                </div>
                <div className="inv-row-side">
                  <div className="inv-amount">{formatRupees(Number(d.total_paise))}</div>
                  <SendStatus msg={last} />
                </div>
                <div className="inv-row-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => openPdf(d.id)}><Icon name="file" size={14} /> PDF</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => startSend(d)}><Icon name="mail" size={14} /> {last?.status === 'sent' ? 'Send again' : 'Email'}</button>
                </div>
                {sendFor?.id === d.id && (
                  <form className="inv-send" onSubmit={async (e) => {
                    e.preventDefault()
                    if (!EMAIL_OK.test(sendFor.email.trim())) { toast.error('That email address does not look right.'); return }
                    setBusy('saving')
                    const sent = await sendEmail(d.id, sendFor.email)
                    setBusy(null)
                    if (sent) setSendFor(null)
                    await load()
                  }}>
                    <input className="form-input" type="email" inputMode="email" aria-label="Customer's email" value={sendFor.email}
                      onChange={(e) => setSendFor({ ...sendFor, email: e.target.value })} placeholder="name@company.com" autoFocus />
                    <button className="btn btn-sm btn-primary" type="submit" disabled={!!busy}>{busy === 'saving' ? 'Sending…' : 'Send'}</button>
                    <button className="btn btn-sm btn-secondary" type="button" onClick={() => setSendFor(null)}>Cancel</button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
