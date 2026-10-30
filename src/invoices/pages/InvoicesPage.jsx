// Credit release step 1 — Invoices & Payments (/invoices; "Send Invoice" until 2026-10-28).
// Service / spares / accounts upload the SAP invoice PDF; the portal reads it in the
// browser (nobody types the values), shows what it read, and on one tap stores it and
// emails it to the customer. Reads are direct under RLS (gate_* tables); every write goes
// through the gate-invoices Edge Function. Plan: docs/backlog/credit-release-plan.md.
// ONE tool (owner, 2026-10-29): payments matching lives here too, as the Match / Import /
// Cash & cheque tabs (PaymentsPage, embedded). Those tabs keep their own rules: the
// /payments access rule (PTB service + accounts) AND the service-payments authority.
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { callEdge } from '../../lib/api'
import { formatRupees } from '../lib/sapInvoice'
import { readInvoiceFile, toBase64 } from '../lib/readInvoiceFile'
import { istTime, latestRelease, mayUse, releaseState, revealForm, useDeptCode, whoFrom } from '../lib/releases'
import ReleasesPanel from '../components/ReleasesPanel'
import FollowUpPanel from '../components/FollowUpPanel'
import { capabilitiesFor } from '../../service-payments/lib/matchQueue.js'
import '../invoices.css'

const PaymentsPage = lazy(() => import('../../service-payments/pages/PaymentsPage'))

// Every tab of the one tool, in order. `pay` tabs are the payments screen's own.
const TABS = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'releases', label: 'Credit releases' },
  // Paid comes only from matching, so Follow-up needs the matching tool too (step 3).
  { key: 'followup', label: 'Follow-up',      needsPaid: true },
  { key: 'match',    label: 'Match',          pay: true },
  { key: 'import',   label: 'Import',         pay: true },
  { key: 'cash',     label: 'Cash & cheque',  pay: true },
]
const SUBTITLE = {
  invoices: 'Upload the invoice PDF from SAP. The portal reads it and emails it to the customer.',
  releases: 'Ask for a vehicle to leave on credit; the GM approves or holds it.',
  followup: 'Released on credit and not paid yet — broken promises first.',
  match:    'Which bill is this payment for?',
  import:   'Load the SAP Billing Report and the HDFC payments report.',
  cash:     'Record money that did not come through the HDFC report.',
}

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

// The release line on an invoice row (step 2): its state, or the button to ask.
function ReleaseLine({ rel }) {
  const s = releaseState(rel)
  if (s === 'waiting') return <span className="badge badge-amber">Release asked</span>
  if (s === 'released') return <span className="badge badge-green">Released until {istTime(rel.valid_until)}</span>
  if (s === 'held') return <span className="badge badge-red">Release held</span>
  return null
}

export default function InvoicesPage() {
  const toast = useToast()
  const { profile, canAccess } = useAuth()
  const deptCode = useDeptCode(profile)
  const who = whoFrom(profile, deptCode)
  // The payments tabs: the access rule for /payments first (it stays the switch per company and
  // department), then the same rules the service-payments Edge Function holds.
  const pay = deptCode !== undefined && canAccess('/payments') ? capabilitiesFor(profile, deptCode) : null
  const shown = TABS.filter((t) => t.needsPaid ? Boolean(pay?.canMatch) : !t.pay || (pay?.canMatch && (
    t.key === 'match' || (t.key === 'import' && pay.canImport) || (t.key === 'cash' && pay.canRecordCash))))
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab = shown.some((t) => t.key === asked) ? asked : 'invoices'
  const focusRelease = params.get('release')
  const setTab = (t) => setParams(t === 'invoices' ? {} : { tab: t }, { replace: true })
  const [toMatch, setToMatch] = useState(0)
  const [waiting, setWaiting] = useState(0)
  // On a phone the tab row scrolls sideways: keep the open tab in view (the row only, never the page).
  const tabsRef = useRef(null)
  useEffect(() => {
    const row = tabsRef.current
    const b = row?.querySelector('[aria-selected="true"]')
    if (!b) return
    const left = b.offsetLeft, right = left + b.offsetWidth
    if (left < row.scrollLeft) row.scrollLeft = left - 8
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 8
  }, [tab, shown.length, toMatch, waiting])   // the count badges widen tabs after they load
  const [askFor, setAskFor] = useState(null)      // { id, note } — the inline "ask to release" row
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
      .select('id, entity_id, layout, doc_no, doc_date, customer_name, sap_customer_code, regn_no, total_paise, created_at, gate_messages(status, recipient, error, created_at, finished_at), gate_releases(id, status, valid_until, requested_at)')
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) { setLoadErr(error.message); return }
    setLoadErr(null)
    setDocs(data)
    const { count } = await supabase.from('gate_releases').select('id', { count: 'exact', head: true }).eq('status', 'asked')
    setWaiting(count ?? 0)
  }, [])

  async function askRelease(doc) {
    setBusy('saving')
    try {
      const r = await callEdge('gate-invoices', 'requestRelease', {
        document_id: doc.id, note: askFor?.note ?? '', client_request_id: crypto.randomUUID(),
      })
      const a = r.alerted
      if (r.already) toast.success(`A release for ${doc.regn_no} was already asked — waiting for the GM.`)
      else if (a && a.sent > 0) toast.success(`Asked. The GM was alerted on ${a.sent} phone${a.sent === 1 ? '' : 's'}.`)
      else toast.success('Asked. No approver has phone alerts turned on — tell the GM it is waiting.')
      setAskFor(null)
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null); await load() }
  }
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
      // Only the people who match payments need to know; the invoice itself is saved.
      if (r.matching_error && pay?.canMatch) toast.error(r.matching_error)
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
          <h1 className="page-head-title">Invoices &amp; Payments<span className="period-accent">.</span></h1>
          <div className="page-head-sub">{SUBTITLE[tab]}</div>
        </div>
      </div>

      <div className="inv-tabs" role="tablist" aria-label="Invoices & Payments" ref={tabsRef}>
        {shown.map((t) => (
          <button key={t.key} className="inv-tab" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'releases' && waiting > 0 && <span className="badge badge-amber">{waiting} waiting</span>}
            {/* Payments waiting for their bill are not counted (they are not unfinished work). */}
            {t.key === 'match' && toMatch > 0 && <span className="badge badge-blue">{toMatch}</span>}
          </button>
        ))}
      </div>

      {TABS.find((t) => t.key === tab)?.pay && (
        <Suspense fallback={<div className="full-center"><div className="spinner" /></div>}>
          <PaymentsPage embedded tab={tab} onTab={setTab} onCount={setToMatch} />
        </Suspense>
      )}

      {tab === 'releases' && <ReleasesPanel who={who} focusId={focusRelease} onChanged={load} seesPaid={Boolean(pay?.canMatch)} />}
      {tab === 'followup' && <FollowUpPanel />}

      {tab === 'invoices' && <>
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
            const rel = latestRelease(d.gate_releases)
            const relState = releaseState(rel)
            // Only workshop jobs with a vehicle number reach the gate; counter sales are send-only.
            const canAsk = d.layout === 'workshop' && d.regn_no && mayUse(who) && !['waiting', 'released'].includes(relState)
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
                  <ReleaseLine rel={rel} />
                </div>
                <div className="inv-row-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => openPdf(d.id)}><Icon name="file" size={14} /> PDF</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => startSend(d)}><Icon name="mail" size={14} /> {last?.status === 'sent' ? 'Send again' : 'Email'}</button>
                  {canAsk && <button className="btn btn-sm btn-secondary" onClick={() => setAskFor({ id: d.id, note: '' })}><Icon name="shield" size={14} /> {relState === 'held' || relState === 'expired' ? 'Ask again' : 'Ask to release'}</button>}
                </div>
                {askFor?.id === d.id && (
                  <form className="inv-release-form" ref={revealForm} onSubmit={(e) => { e.preventDefault(); askRelease(d) }}>
                    <input className="form-input" maxLength={300} autoFocus aria-label="Note for the GM (optional)"
                      placeholder="Note for the GM (optional) — e.g. cheque promised Friday" value={askFor.note}
                      onChange={(e) => setAskFor({ ...askFor, note: e.target.value })} />
                    <button className="btn btn-sm btn-primary" type="submit" disabled={!!busy}>{busy === 'saving' ? 'Asking…' : `Ask GM to release ${d.regn_no}`}</button>
                    <button className="btn btn-sm btn-secondary" type="button" onClick={() => setAskFor(null)}>Cancel</button>
                  </form>
                )}
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
      </>}
    </div>
  )
}
