// /payments — the Match screen, wired to real data.
//
// Reads: supabase-js under RLS (lib/paymentsData.js). Writes: the
// service-payments Edge Function only — the money tables grant no write to any
// signed-in user, admin included. Everything this page decides (queue order,
// how a confirm splits across bills, the stale-bills brake, who may do what)
// lives in lib/matchQueue.js, which is tested without a browser.
//
// v1 is PTB only (owner). The admin works in PTB too; the entity is passed to
// the Edge Function explicitly because the prod admin has no entity of their own.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { callEdge } from '../../lib/api'
import MatchScreen from '../components/MatchScreen.jsx'
import SearchPanel from '../components/SearchPanel.jsx'
import ImportPanel from '../components/ImportPanel.jsx'
import { buildCandidateIndex, matchCandidates, DEFAULT_WINDOW_DAYS } from '../lib/matchCandidates.js'
import {
  capabilitiesFor, toMatchReceipt, orderQueue, invoiceWindow, attachCustomerCodes,
  memoryForMatcher, allocationTargets, matchSignalOf, feedIsStaleFor, searchCandidates,
} from '../lib/matchQueue.js'
import {
  fetchPaymentsEntityId, fetchDepartmentCode, fetchOpenReceipts, fetchOpenInvoices,
  fetchCustomerCodes, fetchPayerMemory, fetchInvoiceFeed, searchOpenInvoices,
} from '../lib/paymentsData.js'
import { formatINR } from '../lib/paise.js'

const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? null

export default function PaymentsPage() {
  const { profile } = useAuth()
  const toast = useToast()

  const [phase, setPhase] = useState('loading')   // loading | ready | denied | error
  const [loadError, setLoadError] = useState('')
  const [entityId, setEntityId] = useState(null)
  const [caps, setCaps] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [invoices, setInvoices] = useState([])
  const [found, setFound] = useState([])          // bills picked through search
  const [memory, setMemory] = useState([])
  const [feed, setFeed] = useState(null)
  const [skipped, setSkipped] = useState([])
  const [doneToday, setDoneToday] = useState(0)
  const [pendingId, setPendingId] = useState(null)
  const [override, setOverride] = useState(null)  // { receiptId, result } from search
  const [searching, setSearching] = useState(false)
  const [tab, setTab] = useState('match')          // match | import (import: accounts/admin)

  // One idempotency key per (receipt, candidate, amount). A retry after a
  // dropped connection reuses it, so the server answers "already done" instead
  // of allocating twice. It is forgotten only once the server has said yes.
  const requestIds = useRef(new Map())

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile) return
    if (!quiet) setPhase('loading')
    try {
      const deptCode = await fetchDepartmentCode(profile.department_id)
      const c = capabilitiesFor(profile, deptCode)
      setCaps(c)
      if (!c.canMatch) { setPhase('denied'); return }

      const ent = await fetchPaymentsEntityId()
      setEntityId(ent)
      const [rows, feedRow] = await Promise.all([fetchOpenReceipts(ent), fetchInvoiceFeed(ent)])
      // Only the receipts this person can actually confirm: service staff match
      // UPI; cash, cheque and bank money is accounts' to place.
      const workable = rows.filter((r) => c.canMatchMode(r.mode)).map(toMatchReceipt)

      const win = invoiceWindow(workable, DEFAULT_WINDOW_DAYS)
      const inv = win ? await fetchOpenInvoices(ent, win) : []
      const mem = await fetchPayerMemory(ent, workable.map((r) => r.normalized_payer_name))
      const customers = await fetchCustomerCodes([
        ...inv.map((v) => v.customer_id), ...mem.map((m) => m.customer_id),
      ])

      setReceipts(workable)
      setInvoices(attachCustomerCodes(inv, customers))
      setMemory(memoryForMatcher(mem, customers))
      setFeed(feedRow)
      setPhase('ready')
    } catch (e) {
      setLoadError(e?.message || String(e))
      setPhase('error')
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  const index = useMemo(() => buildCandidateIndex(invoices), [invoices])
  const invoicesById = useMemo(
    () => new Map([...invoices, ...found].map((v) => [v.id, v])),
    [invoices, found])

  const skippedSet = useMemo(() => new Set(skipped), [skipped])
  const ordered = useMemo(() => orderQueue(receipts, skipped), [receipts, skipped])
  const current = ordered.find((r) => !skippedSet.has(r.id)) ?? null
  const stale = current ? feedIsStaleFor(current, feed) : false

  const result = useMemo(() => {
    if (!current) return undefined
    if (override?.receiptId === current.id) return override.result
    return matchCandidates(current, index, { payerMemory: memory, feedIsStale: stale })
  }, [current, index, memory, stale, override])

  const search = useCallback(async (q) => {
    const rows = await searchOpenInvoices(entityId, q)
    const customers = await fetchCustomerCodes(rows.map((v) => v.customer_id))
    return attachCustomerCodes(rows, customers)
  }, [entityId])

  const handleConfirm = async (candidate) => {
    if (!current) return
    let targets
    try {
      targets = allocationTargets(candidate, invoicesById, current.amount_paise)
    } catch (e) {
      toast.error(e.message)
      return
    }
    const key = `${current.id}:${candidate.id}:${current.amount_paise}`
    if (!requestIds.current.has(key)) requestIds.current.set(key, newRequestId())
    setPendingId(candidate.id)
    try {
      await callEdge('service-payments', 'allocate', {
        entity_id: entityId,
        receipt_id: current.id,
        targets,
        client_request_id: requestIds.current.get(key),
        match_signal: matchSignalOf(candidate),
      })
      requestIds.current.delete(key)
      const placed = targets.reduce((a, t) => a + t.amount_paise, 0)
      toast.success(`Matched ${formatINR(placed)} to ${candidate.label}`)
      setDoneToday((n) => n + 1)
      setOverride(null)
      await load({ quiet: true })
    } catch (e) {
      // Reload even on failure: if the write DID land and only the answer was
      // lost, the queue must show that before anyone picks a different bill.
      toast.error(e?.message || 'Could not save the match')
      await load({ quiet: true })
    } finally {
      setPendingId(null)
    }
  }

  const handleNotService = async (kind) => {
    if (!current) return
    setPendingId('not-service')
    try {
      await callEdge('service-payments', 'classify_receipt', {
        entity_id: entityId,
        receipt_id: current.id,
        classification: 'not_service',
        not_service_kind: kind,
      })
      toast.success('Set aside as not a service payment')
      setOverride(null)
      await load({ quiet: true })
    } catch (e) {
      toast.error(e?.message || 'Could not set it aside')
    } finally {
      setPendingId(null)
    }
  }

  const handleSkip = () => {
    if (!current) return
    setOverride(null)
    setSkipped((s) => [...s, current.id])
  }

  const handlePick = (invoice) => {
    setFound((f) => [...f.filter((v) => v.id !== invoice.id), invoice])
    setOverride({
      receiptId: current.id,
      result: {
        candidates: searchCandidates([invoice]),
        refuse_to_rank: false,
        confident: false,
        reason: 'You found this bill by searching. Check the customer and amount before confirming.',
        searched: 1,
      },
    })
    setSearching(false)
  }

  const header = (
    <>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Service Tools</div>
          <h1 className="page-head-title">Match Payments<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Which bill did each UPI payment pay?</div>
        </div>
      </div>
      {/* Import is accounts' (and the admin's during the pilot). Service staff
          never see the tab, so the Match screen stays the whole page for them. */}
      {caps?.canImport && phase === 'ready' && (
        <div className="seg pay-tabs" role="tablist" aria-label="Payments">
          <button type="button" role="tab" aria-selected={tab === 'match'}
                  className={`seg-btn ${tab === 'match' ? 'active' : ''}`} onClick={() => setTab('match')}>
            Match{receipts.length ? ` (${receipts.length})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'import'}
                  className={`seg-btn ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>
            Import
          </button>
        </div>
      )}
    </>
  )

  if (phase === 'loading') {
    return <div className="page">{header}<div className="full-center"><div className="spinner" /></div></div>
  }
  if (phase === 'error') {
    return (
      <div className="page">{header}
        <div className="pay-match">
          <p className="pay-banner pay-banner-warn" role="alert">
            <strong>Couldn’t load payments.</strong> {loadError}
          </p>
          <button type="button" className="pay-secondary" onClick={() => load()}>Try again</button>
        </div>
      </div>
    )
  }
  if (phase === 'denied') {
    return (
      <div className="page">{header}
        <div className="pay-match">
          <p className="pay-hint" role="status">Matching payments is for the service and accounts teams.</p>
        </div>
      </div>
    )
  }

  if (tab === 'import' && caps?.canImport) {
    return (
      <div className="page">{header}
        <ImportPanel
          entityId={entityId}
          onImported={() => load({ quiet: true })}
          onGoMatch={() => { setSkipped([]); setOverride(null); setTab('match') }}
        />
      </div>
    )
  }

  if (!current && skipped.length > 0) {
    return (
      <div className="page">{header}
        <div className="pay-match pay-match-empty">
          <h2 className="pay-empty-title">{skipped.length} skipped</h2>
          <p className="pay-empty-sub">
            Everything else is matched. The skipped payments are still waiting
            {caps?.canClassify ? '.' : ' — accounts will see them too.'}
          </p>
          <button type="button" className="pay-secondary" onClick={() => setSkipped([])}>
            Go through the skipped ones again
          </button>
        </div>
      </div>
    )
  }

  if (searching && current) {
    return (
      <div className="page">{header}
        <SearchPanel
          receipt={current}
          search={search}
          onPick={handlePick}
          onCancel={() => setSearching(false)}
        />
      </div>
    )
  }

  return (
    <div className="page">
      {header}
      <MatchScreen
        // A new receipt, or a new list for the same one, starts with nothing
        // picked — a selection must never carry over to a different bill.
        key={`${current?.id ?? 'none'}:${current?.amount_paise ?? 0}:${override?.receiptId === current?.id ? 'search' : 'shortlist'}`}
        receipt={current}
        result={result}
        remaining={receipts.length}
        doneToday={doneToday}
        feedIsStale={stale}
        feedAsOf={feedLabel(feed)}
        pendingId={pendingId}
        onConfirm={handleConfirm}
        onSkip={handleSkip}
        onNotService={caps?.canClassify ? handleNotService : undefined}
        onSearch={() => setSearching(true)}
      />
    </div>
  )
}

function feedLabel(feed) {
  if (!feed?.covered_until) return 'never'
  const d = new Date(feed.covered_until)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}
