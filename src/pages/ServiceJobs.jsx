// Phase 9.5 — Service Team: Outside-Workshop Job Tracker.
// Tracks the four cases {outside, ancillary} × {warranty, paid}. Reads are direct
// supabase under RLS; every write goes through the `service-jobs` Edge Function.
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { generateServicePoPdf } from '../utils/pdfGenerator'

const JOB_TYPES = [
  { value: 'outside', label: 'Outside Job' },
  { value: 'ancillary', label: 'Ancillary Work' },
]
const REPAIR_TYPES = [
  { value: 'warranty', label: 'Warranty' },
  { value: 'paid', label: 'Paid' },
]
const STAGE_LABEL = {
  po_generated: 'PO Generated',
  work_completed: 'Work Completed',
  invoice_received: 'Invoice Received',
}
const SPINE = ['po_generated', 'work_completed', 'invoice_received']
// customer_name is now a common field (see the form); these are AW-letter-only extras.
const LETTER_FIELDS = [
  ['chassis_no', 'Chassis Number'],
  ['engine_no', 'Engine No'], ['km_hrs', 'Km / HRS'], ['date_of_sale', 'Date of Sale', 'date'],
  ['model', 'Model'], ['make', 'Make (component)'], ['complaint_date', 'Complaint Date', 'date'],
  ['complaint', 'Complaint'], ['check_item', 'Check the ___'], ['serial_no', 'Serial No'], ['qty', 'Qty'],
]

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Spark 1: Parts-Out Clock — time-based aging / staleness signals ──────────
// The portal already knows material_out / return dates; surface the clock so a
// part stuck at a vendor is visible instead of buried. All client-derived.
const MS_DAY = 86400000
const daysSince = (val) => val ? Math.max(0, Math.floor((Date.now() - new Date(val).getTime()) / MS_DAY)) : 0
// Aging severity (uniform): 0–1 day = green (ok), 2 days = amber, 3+ days = red.
const agingSev = (days) => days >= 3 ? 'red' : days >= 2 ? 'amber' : 'green'
// A part is physically out while the job is open and hasn't reached work_completed
// (material_return_date auto-stamps on advance to work_completed).
function partIsOut(j) { return !j.closed_at && j.stage === 'po_generated' && !!j.material_out_date }
function jobAging(j) {
  if (j.closed_at) return null
  if (partIsOut(j)) {
    const days = daysSince(j.material_out_date)
    return { kind: 'out', days, overdue: days >= 3, sev: agingSev(days), label: `out ${days}d` }
  }
  const days = daysSince(j.updated_at)
  return { kind: 'idle', days, overdue: false, sev: agingSev(days), label: `idle ${days}d` }
}
// Rank: overdue parts first, then by days-out, then idle staleness.
function urgencyScore(j) {
  const a = jobAging(j); if (!a) return -1
  return a.kind === 'out' ? 10000 + (a.overdue ? 5000 : 0) + a.days : a.days
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// Settlement summary text (also used as a sort key).
const settleText = (j) => j.settlement_status ? j.settlement_status.replace('_', ' ') : (j.payment_done_at ? 'vendor paid' : '—')

// Sortable table columns: display label + value accessor (+ numeric flag for the comparator).
const SORT_COLS = {
  aging: { label: 'Age', get: (j) => urgencyScore(j), num: true },
  po: { label: 'PO No', get: (j) => j.po_number || '' },
  reg: { label: 'Reg No', get: (j) => j.vehicle_registration_no || '' },
  type: { label: 'Type', get: (j) => j.job_type || '' },
  basis: { label: 'Warranty / Paid', get: (j) => j.repair_type || '' },
  stage: { label: 'Stage', get: (j) => j.final_outcome === 'cancelled' ? 99 : SPINE.indexOf(j.stage), num: true },
  vendor: { label: 'Vendor', get: (j) => (j.vendor_name_snapshot || '').toLowerCase() },
  settle: { label: 'Settlement', get: (j) => settleText(j) },
}

// ── Role-aware "Needs you" model ─────────────────────────────────────────────
// Each open job exposes a small set of *pending actions*; the Needs-you view
// surfaces only the ones the current lens (role) is allowed to act on. All
// derived client-side from the already-loaded jobs — no extra reads.
function jobPending(j) {
  if (j.closed_at) return []
  const aw = j.job_type === 'ancillary' && j.repair_type === 'warranty'
  const curIdx = SPINE.indexOf(j.stage)
  const settleStage = j.repair_type === 'warranty' ? (aw ? 'work_completed' : 'invoice_received') : 'invoice_received'
  const out = []
  // Spine advancement (the manager/exec's core operational work): someone must
  // mark work completed, then (non-AW) mark the vendor invoice received.
  if (j.stage === 'po_generated') out.push('advance_work')
  else if (!aw && j.stage === 'work_completed') out.push('advance_invoice')
  if (!j.settlement_status && j.stage === settleStage)
    out.push(j.repair_type === 'warranty' ? 'approve_warranty' : 'settle_payment')
  if (!aw && !j.payment_done_at && j.stage === 'invoice_received') out.push('pay_vendor')
  if (j.job_type === 'ancillary' && curIdx >= 1 && !j.ancillary_ref) out.push('anc_ref')
  const a = jobAging(j)
  if (a?.kind === 'out' && a.overdue) out.push('chase')
  return out
}

// Capability profile per lens. The real mutation is always re-checked by the EF;
// this only decides which buckets a lens *sees*. Admin can preview any lens.
function capsForRole(role) {
  switch (role) {
    case 'admin':    return { canManage: true,  isAccounts: true,  canGm: true }
    case 'gm':       return { canManage: true,  isAccounts: false, canGm: true }
    case 'manager':  return { canManage: true,  isAccounts: false, canGm: false }
    case 'accounts': return { canManage: false, isAccounts: true,  canGm: false }
    default:         return { canManage: false, isAccounts: false, canGm: false } // exec / capture
  }
}
const ADMIN_LENSES = [['admin', 'Everything'], ['gm', 'GM'], ['manager', 'Manager'], ['accounts', 'Accounts'], ['exec', 'Executive']]

// Group the open jobs into the action queues this lens should act on.
function buildBuckets(open, caps, myId) {
  const byUrgency = (a, b) => urgencyScore(b) - urgencyScore(a)
  const has = (j, k) => jobPending(j).includes(k)
  // "Capture" roles handle the physical part / job data (exec + any manager+).
  // Pure accounts users only deal with money, so they never see chase / ref.
  const capture = caps.canManage || !caps.isAccounts
  const list = []
  if (caps.canManage) {
    const aw1 = open.filter(j => has(j, 'advance_work'))
    if (aw1.length) list.push({ key: 'advance_work', title: 'Mark work completed', tone: 'blue', hint: 'Vendor has finished — advance the job', jobs: aw1 })
    const ai = open.filter(j => has(j, 'advance_invoice'))
    if (ai.length) list.push({ key: 'advance_invoice', title: 'Mark invoice received', tone: 'blue', hint: 'Vendor invoice in — enables payment', jobs: ai })
    const w = open.filter(j => has(j, 'approve_warranty'))
    if (w.length) list.push({ key: 'approve_warranty', title: 'Warranty to approve', tone: 'amber', hint: 'Process the claim, or convert to paid', jobs: w })
  }
  if (caps.isAccounts) {
    const pv = open.filter(j => has(j, 'pay_vendor'))
    if (pv.length) list.push({ key: 'pay_vendor', title: 'Vendor payments due', tone: 'blue', hint: 'Invoice received — pay the vendor', jobs: pv })
    const sp = open.filter(j => has(j, 'settle_payment'))
    if (sp.length) list.push({ key: 'settle_payment', title: 'Customer payments to record', tone: 'blue', hint: 'Record the customer payment received', jobs: sp })
  }
  if (capture) {
    const chase = open.filter(j => has(j, 'chase')).filter(j => caps.canManage || j.created_by === myId)
    if (chase.length) list.push({ key: 'chase', title: 'Parts overdue', tone: 'red', hint: 'Out 3+ days — follow up with the vendor', jobs: chase })
    const ref = open.filter(j => has(j, 'anc_ref')).filter(j => caps.canManage || j.created_by === myId)
    if (ref.length) list.push({ key: 'anc_ref', title: 'Add ancillary portal ref', tone: 'gray', hint: 'Work done — capture the AL-portal reference', jobs: ref })
  }
  if (!caps.canManage && !caps.isAccounts) {
    const mine = open.filter(j => j.created_by === myId)
    if (mine.length) list.push({ key: 'mine', title: 'My open jobs', tone: 'gray', hint: 'Jobs you created that are still open', jobs: mine })
  }
  for (const b of list) b.jobs = b.jobs.slice().sort(byUrgency)
  return list
}

const blankForm = () => ({
  job_type: 'outside', repair_type: 'paid', vehicle_registration_no: '',
  job_description: '', vendor_id: '', ancillary_ref: '',
  material_out_date: fmtLocalDate(new Date()), material_return_date: '',
  customer_name: '', chassis_no: '', engine_no: '', km_hrs: '', date_of_sale: '',
  model: '', make: '', complaint_date: '', complaint: '', check_item: '', serial_no: '', qty: '',
})

// Admin lens switcher. Custom dropdown (not a native <select>) — native option
// popups can't be styled and render as a messy bleed-over-content overlay on
// mobile. This matches the Dashboard/Sidebar dropdown pattern (outside-click +
// Esc to close, fully controlled appearance, high z-index).
function LensDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const label = (ADMIN_LENSES.find(([r]) => r === value) || ['', value])[1]
  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className={`sj-lens${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="sj-lens-trigger" aria-haspopup="menu" aria-expanded={open}
        aria-label="View Needs-you as role" onClick={() => setOpen(o => !o)}>
        <span className="sj-lens-cap">Viewing:</span>
        <span className="sj-lens-val">{label}</span>
        <span className="sj-lens-arrow" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sj-lens-menu" role="menu">
          {ADMIN_LENSES.map(([r, lbl]) => (
            <button key={r} type="button" role="menuitemradio" aria-checked={r === value}
              className={`sj-lens-item${r === value ? ' active' : ''}`}
              onClick={() => { onChange(r); setOpen(false) }}>
              {lbl}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ServiceJobs() {
  const { profile } = useAuth()
  const [entity, setEntity] = useState(null)
  const [deptCode, setDeptCode] = useState(null)
  const [vendors, setVendors] = useState([])
  const [jobs, setJobs] = useState([])
  const [tab, setTab] = useState('active')
  const [filters, setFilters] = useState({ q: '', job_type: '', repair_type: '', stage: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [selected, setSelected] = useState(null)
  const [events, setEvents] = useState([])
  const [toast, setToast] = useState(null) // { msg, kind }
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState(null) // { key, dir: 'asc'|'desc' } | null = default order
  const [mode, setMode] = useState('needs') // 'needs' | 'all'
  const [asRole, setAsRole] = useState('admin') // admin-only lens switcher
  const [recent, setRecent] = useState([]) // GM/admin "recent changes → undo" feed
  const filterRef = useRef(null)
  const selectedRef = useRef(null)
  selectedRef.current = selected

  const showToast = useCallback((msg, kind = 'success') => setToast({ msg, kind }), [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(id)
  }, [toast])

  // Close the filter popover on outside-click / Esc.
  useEffect(() => {
    if (!showFilters) return
    function onDown(e) { if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false) }
    function onKey(e) { if (e.key === 'Escape') setShowFilters(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [showFilters])

  const perm = profile?.permission_level
  const isAdmin = perm === 'admin'
  const canManage = ['manager', 'gm', 'admin'].includes(perm)
  const canGm = ['gm', 'admin'].includes(perm)
  const isAccounts = isAdmin || deptCode === 'accounts'
  // "Capture" roles handle the physical job (service exec + any manager+, not pure
  // accounts). They may advance a job to work_completed; invoice_received stays manager+.
  const canCapture = canManage || !isAccounts
  const myId = profile?.id

  // The lens deciding which Needs-you buckets show. Non-admins are pinned to
  // their real capabilities; only admin gets a role switcher to preview others.
  const myLens = isAdmin ? 'admin' : canGm ? 'gm' : isAccounts ? 'accounts' : canManage ? 'manager' : 'exec'
  const viewCaps = isAdmin ? capsForRole(asRole) : { canManage, isAccounts, canGm }

  // Entity row (for PDF + code) and the caller's department code.
  useEffect(() => {
    let off = false
    if (!profile?.entity_id) return
    supabase.from('entities')
      .select('id, code, full_name, address, gstin, bank_name, bank_account, bank_ifsc')
      .eq('id', profile.entity_id).maybeSingle()
      .then(({ data }) => { if (!off) setEntity(data || null) })
    if (profile.department_id) {
      supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
        .then(({ data }) => { if (!off) setDeptCode(data?.code ?? null) })
    }
    return () => { off = true }
  }, [profile?.entity_id, profile?.department_id])

  const loadVendors = useCallback(async () => {
    const { data } = await supabase.from('service_vendors')
      .select('id, name, oem, gstin, address, is_active, is_authorized').order('name')
    setVendors(data || [])
  }, [])

  const loadJobs = useCallback(async () => {
    setLoading(true)
    const { data, error: e } = await supabase.from('service_jobs')
      .select('*').order('created_at', { ascending: false })
    if (e) setError(e.message)
    setJobs(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadVendors(); loadJobs() }, [loadVendors, loadJobs])

  const loadEvents = useCallback(async (jobId) => {
    const { data } = await supabase.from('service_job_events')
      .select('*').eq('job_id', jobId).order('created_at', { ascending: false })
    const evs = data || []
    // Resolve each event's actor → display name (same-entity reads allowed by RLS).
    const ids = [...new Set(evs.map(e => e.actor_id).filter(Boolean))]
    let names = {}
    if (ids.length) {
      const { data: us } = await supabase.from('users').select('id, full_name').in('id', ids)
      names = Object.fromEntries((us || []).map(u => [u.id, u.full_name]))
    }
    setEvents(evs.map(e => ({ ...e, actor_name: names[e.actor_id] || null })))
  }, [])

  // GM/admin "recent changes" feed — latest status change per job, newest first,
  // each with a one-click Undo (reverses that job's last status). Cross-job read.
  const loadRecent = useCallback(async () => {
    const { data } = await supabase.from('service_job_events')
      .select('id, job_id, actor_id, event_type, from_value, to_value, created_at')
      .order('created_at', { ascending: false }).limit(60)
    const evs = data || []
    const ids = [...new Set(evs.map(e => e.actor_id).filter(Boolean))]
    let names = {}
    if (ids.length) {
      const { data: us } = await supabase.from('users').select('id, full_name').in('id', ids)
      names = Object.fromEntries((us || []).map(u => [u.id, u.full_name]))
    }
    const seen = new Set(), rows = []
    for (const e of evs) {
      if (e.event_type === 'created' || e.event_type === 'update') continue // not a status change
      if (seen.has(e.job_id)) continue
      seen.add(e.job_id)
      rows.push({ ...e, actor_name: names[e.actor_id] || null })
      if (rows.length >= 12) break
    }
    setRecent(rows)
  }, [])

  function openDetail(job) { setError(''); setSelected(job); loadEvents(job.id) }
  function openNew() { setError(''); setForm(blankForm()); setShowNew(true) }

  async function refreshSelected(jobId) {
    await loadJobs()
    const { data } = await supabase.from('service_jobs').select('*').eq('id', jobId).maybeSingle()
    if (data) setSelected(data)
    loadEvents(jobId)
  }

  const visible = useMemo(() => {
    const base = jobs.filter(j => {
      if (tab === 'past' ? !j.closed_at : j.closed_at) return false   // active & parts → open jobs
      if (tab === 'parts' && !partIsOut(j)) return false
      if (filters.job_type && j.job_type !== filters.job_type) return false
      if (filters.repair_type && j.repair_type !== filters.repair_type) return false
      if (filters.stage && j.stage !== filters.stage) return false
      if (filters.q && !((j.vehicle_registration_no || '') + ' ' + (j.po_number || ''))
        .toLowerCase().includes(filters.q.toLowerCase())) return false
      return true
    })
    if (sort) {
      // User-chosen column sort overrides the default ordering.
      const col = SORT_COLS[sort.key]
      return base.slice().sort((a, b) => {
        const av = col.get(a), bv = col.get(b)
        const c = col.num ? (av - bv) : String(av).localeCompare(String(bv))
        return sort.dir === 'desc' ? -c : c
      })
    }
    if (tab === 'past') return base // already newest-first from the query
    // Active & Parts Out: most-urgent first (stuck/overdue floats up, recency hides it otherwise).
    return base.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a) ||
      (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
  }, [jobs, tab, filters, sort])

  // Radar summary over all open jobs (drives the exception banner).
  const radar = useMemo(() => {
    let open = 0, partsOut = 0, overdueParts = 0, stuck = 0
    for (const j of jobs) {
      if (j.closed_at) continue
      open++
      const a = jobAging(j)
      if (a?.kind === 'out') { partsOut++; if (a.overdue) overdueParts++ }
      else if (a?.kind === 'idle' && a.days >= 3) stuck++
    }
    return { open, partsOut, overdueParts, stuck }
  }, [jobs])

  // Admin "Overview" exposure dashboard — working-capital + flow stats.
  const overview = useMemo(() => {
    const now = Date.now(), weekAgo = now - 7 * MS_DAY
    let partsOut = 0, overdue = 0, weOwe = 0, owedUs = 0, createdWk = 0, closedWk = 0, turnSum = 0, turnN = 0
    for (const j of jobs) {
      if (new Date(j.created_at).getTime() >= weekAgo) createdWk++
      if (j.closed_at) {
        if (new Date(j.closed_at).getTime() >= weekAgo) closedWk++
        if (j.final_outcome === 'completed') { turnSum += new Date(j.closed_at).getTime() - new Date(j.created_at).getTime(); turnN++ }
        continue
      }
      const pend = jobPending(j), a = jobAging(j)
      if (partIsOut(j)) partsOut++
      if (a?.kind === 'out' && a.overdue) overdue++
      if (pend.includes('pay_vendor')) weOwe++
      if (pend.includes('approve_warranty') || pend.includes('settle_payment')) owedUs++
    }
    const top = jobs.filter(j => !j.closed_at)
      .map(j => ({ j, a: jobAging(j) }))
      .filter(x => x.a && (x.a.overdue || x.a.sev !== 'green'))
      .sort((x, y) => urgencyScore(y.j) - urgencyScore(x.j))
      .slice(0, 3)
    return { partsOut, overdue, weOwe, owedUs, createdWk, closedWk, avgTurn: turnN ? turnSum / turnN / MS_DAY : null, top }
  }, [jobs])

  // ── Needs-you derivations ──────────────────────────────────────────────────
  const openJobs = useMemo(() => jobs.filter(j => !j.closed_at), [jobs])
  const jobById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs])
  const buckets = useMemo(
    () => buildBuckets(openJobs, viewCaps, myId),
    [openJobs, viewCaps.canManage, viewCaps.isAccounts, myId] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const needCount = buckets.reduce((n, b) => n + b.jobs.length, 0)

  // Load the recent-changes feed when a GM/admin lens is on the Needs-you view.
  useEffect(() => {
    if (mode === 'needs' && viewCaps.canGm) loadRecent()
  }, [mode, viewCaps.canGm, asRole, jobs, loadRecent])

  function pdfFor(job) {
    return generateServicePoPdf({
      poNumber: job.po_number,
      date: job.created_at ? job.created_at.slice(0, 10) : fmtLocalDate(new Date()),
      entity, entityCode: entity?.code,
      generatedByName: job.created_by_name,
      generatedByDesignation: job.created_by_designation,
      job,
    })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const aw = form.job_type === 'ancillary' && form.repair_type === 'warranty'
      const payload = {
        client_request_id: globalThis.crypto?.randomUUID?.() ?? null,
        job_type: form.job_type, repair_type: form.repair_type,
        vehicle_registration_no: form.vehicle_registration_no.trim(),
        customer_name: form.customer_name.trim(),
        job_description: form.job_description.trim() || null,
        vendor_id: form.vendor_id || null,
        material_out_date: form.material_out_date || null,
        // ancillary_ref + material_return_date are NOT set at creation (added/auto-set later).
      }
      if (aw) {
        for (const [key, , type] of LETTER_FIELDS) {
          const v = form[key]
          payload[key] = type === 'date' ? (v || null) : (v.trim?.() || null)
        }
      }
      const res = await callEdge('service-jobs', 'createJob', payload)
      // Re-fetch the stored row so the PO renders from server snapshots
      // (po_number, created_by_name/designation, vendor snapshots, defaulted material_out).
      const { data: row } = await supabase.from('service_jobs').select('*').eq('id', res.id).maybeSingle()
      if (row) await pdfFor(row)
      setShowNew(false); setForm(blankForm())
      await loadJobs()
      showToast('Job created · PO downloaded')
    } catch (err) {
      setError(err.message || 'Failed to create job')
    } finally { setBusy(false) }
  }

  async function act(action, payload, jobId, successMsg) {
    setError(''); setBusy(true)
    try {
      await callEdge('service-jobs', action, payload)
      await refreshSelected(jobId)
      if (successMsg) showToast(successMsg)
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally { setBusy(false) }
  }

  // Inline action from a Needs-you card / feed row — no drawer; just refresh the
  // lists and toast. (The drawer's `act` refreshes the open job instead.)
  async function quickAct(action, payload, msg) {
    setError(''); setBusy(true)
    try {
      await callEdge('service-jobs', action, payload)
      await loadJobs()
      if (viewCaps.canGm) await loadRecent()
      if (msg) showToast(msg)
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally { setBusy(false) }
  }

  // Column sort: click cycles asc → desc → off (back to the default order).
  function toggleSort(key) {
    setSort(s => (!s || s.key !== key) ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null)
  }
  const ariaSort = (key) => sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  const sortInd = (key) => sort?.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''

  if (!profile) return null

  const filtersActive = filters.q || filters.job_type || filters.repair_type || filters.stage
  const dropdownCount = ['job_type', 'repair_type', 'stage'].filter(k => filters[k]).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Service Tools</div>
          <h1 className="page-head-title">Vendor Jobs<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Track outside-workshop &amp; ancillary repair jobs end to end</div>
        </div>
        <button className="btn btn-primary page-head-right" onClick={openNew}>+ New Job</button>
      </div>

      {/* Load/page-level errors only when no modal is open (action errors render inside the modal). */}
      {error && !showNew && !selected && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Top-level mode switch + (admin) lens dropdown. */}
      <div className="sj-needs-bar">
        <div className="seg sj-modebar">
          <button className={`seg-btn ${mode === 'needs' ? 'active' : ''}`} onClick={() => setMode('needs')}>
            Needs you{needCount ? <span className="sj-mode-count">{needCount}</span> : ''}
          </button>
          <button className={`seg-btn ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>All jobs</button>
          {canManage && (
            <button className={`seg-btn ${mode === 'overview' ? 'active' : ''}`} onClick={() => setMode('overview')}>Overview</button>
          )}
        </div>
        {/* Admin-only lens switcher (hidden for single-role users). */}
        {isAdmin && mode === 'needs' && (
          <LensDropdown value={asRole} onChange={setAsRole} />
        )}
      </div>

      {mode === 'overview' ? (
        <div className="sj-view sj-needs" key="overview">
          {loading && jobs.length === 0 ? <div className="spinner" /> : (
            <OverviewDash overview={overview} onOpen={openDetail}
              onJumpParts={() => { setMode('all'); setTab('parts') }}
              onJumpAccounts={() => { setMode('all'); setTab('active') }} />
          )}
        </div>
      ) : mode === 'needs' ? (
        <div className="sj-view sj-needs" key={`needs:${isAdmin ? asRole : myLens}`}>
          {loading && jobs.length === 0 ? <div className="spinner" /> : (
            <>
              {needCount > 0 && (
                <p className="sj-needs-cap">
                  <strong>{needCount}</strong> {needCount === 1 ? 'job needs' : 'jobs need'} your attention
                </p>
              )}
              {buckets.map((bk, bi) => (
                <section className="sj-bucket" key={bk.key} style={{ animationDelay: `${Math.min(bi, 6) * 70}ms` }}>
                  <div className="sj-bucket-head">
                    <span className={`sj-bucket-ico tone-${bk.tone}`}><BIcon name={bk.key} /></span>
                    <span className="sj-bucket-title">{bk.title}</span>
                    <span className={`sj-bucket-count tone-${bk.tone}`}>{bk.jobs.length}</span>
                    <span className="sj-bucket-hint">{bk.hint}</span>
                  </div>
                  <div className="sj-need-list">
                    {bk.jobs.map((j, i) => (
                      <NeedCard key={j.id} job={j} bucket={bk} index={bi * 3 + i} busy={busy}
                        onOpen={() => openDetail(j)} onQuick={quickAct}
                        onReprint={() => { pdfFor(j); showToast('PO downloaded') }} />
                    ))}
                  </div>
                </section>
              ))}

              {needCount === 0 && !(viewCaps.canGm && recent.length > 0) && (
                <div className="sj-caughtup">
                  <div className="sj-caughtup-mark" aria-hidden="true">✓</div>
                  <div className="sj-caughtup-title">You’re all caught up</div>
                  <div className="sj-caughtup-sub">
                    {openJobs.length ? `${plural(openJobs.length, 'job')} in progress — nothing needs you right now.` : 'No active jobs right now.'}
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('all')}>Browse all jobs →</button>
                </div>
              )}

              {/* GM / admin: recent status changes with one-click undo (shown in every lens). */}
              {viewCaps.canGm && recent.length > 0 && (
                <section className="sj-bucket">
                  <div className="sj-bucket-head">
                    <span className="sj-bucket-title">Recent changes</span>
                    <span className="sj-bucket-hint">Undo reverses that job’s last status</span>
                  </div>
                  <ul className="sj-feed">
                    {recent.map(r => {
                      const j = jobById[r.job_id]
                      return (
                        <li className="sj-feed-row" key={r.id}>
                          <button type="button" className="sj-feed-main" onClick={() => j && openDetail(j)}>
                            <span className="sj-feed-po">{j?.po_number || 'Job'}</span>
                            <span className="sj-feed-ev">{r.event_type.replace(/_/g, ' ')}{r.to_value ? ` → ${r.to_value}` : ''}</span>
                            <span className="sj-feed-when">{r.actor_name ? `${r.actor_name} · ` : ''}{new Date(r.created_at).toLocaleString('en-IN')}</span>
                          </button>
                          <button type="button" className="btn btn-sm btn-secondary" disabled={busy}
                            onClick={() => quickAct('undoLastStatus', { jobId: r.job_id }, 'Last status undone')}>↩ Undo</button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
      <div className="sj-view" key="all">
      <div className="seg sj-tabs">
        {[['active', 'Active'], ['parts', `Parts Out${radar.partsOut ? ` (${radar.partsOut})` : ''}`], ['past', 'Past Record']].map(([t, label]) => (
          <button key={t} className={`seg-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {/* Parts-Out Clock — exception banner over all open jobs. */}
      {tab !== 'past' && radar.open > 0 && (
        (radar.overdueParts || radar.stuck) ? (
          <div className="sj-radar sj-radar-warn">
            <span>⏰ {[
              radar.overdueParts ? `${plural(radar.overdueParts, 'part')} overdue` : null,
              radar.stuck ? `${plural(radar.stuck, 'job')} idle 3+ days` : null,
            ].filter(Boolean).join(' · ')}</span>
            {radar.overdueParts > 0 && tab !== 'parts' && (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setTab('parts')}>View parts out</button>
            )}
          </div>
        ) : (
          <div className="sj-radar sj-radar-ok">✓ All {plural(radar.open, 'active job')} on track{radar.partsOut ? ` · ${plural(radar.partsOut, 'part')} out` : ''}</div>
        )
      )}

      <div className="sj-toolbar">
        <input className="form-input sj-search" aria-label="Search by registration or PO number"
          placeholder="Search reg no / PO no" value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
        <div className="sj-filter-wrap" ref={filterRef}>
          <button type="button" className={`btn btn-secondary sj-filter-btn${dropdownCount ? ' has-active' : ''}`}
            aria-haspopup="dialog" aria-expanded={showFilters} onClick={() => setShowFilters(s => !s)}>
            <span aria-hidden="true">⚙</span> Filters
            {dropdownCount > 0 && <span className="sj-filter-badge">{dropdownCount}</span>}
          </button>
          {showFilters && (
            <div className="sj-filter-pop" role="dialog" aria-label="Filter jobs">
              <div className="form-group">
                <label className="form-label" htmlFor="sj-f-type">Job type</label>
                <select id="sj-f-type" className="form-select" value={filters.job_type} onChange={e => setFilters(f => ({ ...f, job_type: e.target.value }))}>
                  <option value="">All types</option>{JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sj-f-basis">Warranty / Paid</label>
                <select id="sj-f-basis" className="form-select" value={filters.repair_type} onChange={e => setFilters(f => ({ ...f, repair_type: e.target.value }))}>
                  <option value="">All bases</option>{REPAIR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sj-f-stage">Stage</label>
                <select id="sj-f-stage" className="form-select" value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}>
                  <option value="">All stages</option>{SPINE.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
              </div>
              <div className="sj-filter-pop-foot">
                <button type="button" className="btn btn-sm btn-secondary" disabled={!dropdownCount}
                  onClick={() => setFilters(f => ({ ...f, job_type: '', repair_type: '', stage: '' }))}>Clear filters</button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowFilters(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sj-swap" key={`list:${tab}`}>
      {!loading && visible.length > 0 && (
        <div className="sj-count" aria-live="polite">{visible.length} {visible.length === 1 ? 'job' : 'jobs'}</div>
      )}

      {loading && jobs.length === 0 ? <div className="spinner" /> : visible.length === 0 ? (
        <div className="empty-state">{filtersActive ? 'No jobs match these filters.' : 'No jobs yet — create one with + New Job.'}</div>
      ) : (
        <>
          {/* Mobile: sort control (the desktop table sorts via its headers). */}
          <div className="sj-sortbar">
            <span className="sj-sortbar-lbl">Sort</span>
            <select className="form-select" aria-label="Sort jobs by" value={sort?.key || ''}
              onChange={e => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir || 'asc' } : null)}>
              <option value="">Default order</option>
              {Object.entries(SORT_COLS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-secondary" disabled={!sort}
              aria-label="Toggle sort direction"
              onClick={() => setSort(s => s ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)}>
              {sort?.dir === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
          </div>

          {/* Desktop: table */}
          <div className="table-wrap sj-desktop-table">
            <table aria-label="Service jobs">
              <thead>
                <tr>
                  {[['aging', 'Age'], ['po', 'PO No'], ['reg', 'Reg No'], ['type', 'Type'],
                    ['basis', 'Warranty / Paid'], ['stage', 'Stage'], ['vendor', 'Vendor'], ['settle', 'Settlement']].map(([k, label]) => (
                    <th key={k} scope="col" aria-sort={ariaSort(k)}>
                      <button type="button" className={`sj-sort${sort?.key === k ? ' active' : ''}`} onClick={() => toggleSort(k)}>
                        {label}<span className="ind" aria-hidden="true">{sortInd(k)}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(j => {
                  const a = jobAging(j)
                  return (
                  <tr key={j.id} tabIndex={0} role="button" aria-label={`Open job ${j.po_number}`}
                    onClick={() => openDetail(j)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(j) } }}>
                    <td className="sj-dot-cell">{a && <span className={`sj-dot sj-dot-${a.sev}`} title={a.label} />}</td>
                    <td className="po">{j.po_number}</td>
                    <td>{j.vehicle_registration_no}</td>
                    <td>{JOB_TYPES.find(t => t.value === j.job_type)?.label}</td>
                    <td>{REPAIR_TYPES.find(t => t.value === j.repair_type)?.label}</td>
                    <td>{j.final_outcome === 'cancelled' ? 'Cancelled' : STAGE_LABEL[j.stage]}
                      {a && <span className={`sj-age sj-age-${a.sev}`}>{a.label}</span>}</td>
                    <td>{j.vendor_name_snapshot || '—'}</td>
                    <td>{settleText(j)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile: cards */}
          <div className="sj-mobile-cards">
            {visible.map(j => {
              const b = statusBadges(j)[0]
              const a = jobAging(j)
              return (
                <button key={j.id} type="button" className={`sj-job-card${a ? ` sev-${a.sev}` : ''}`} onClick={() => openDetail(j)}>
                  <div className="sj-jc-top">
                    <span className="sj-jc-po">{j.po_number}</span>
                    <span className={`badge ${b.cls}`}>{b.text}</span>
                  </div>
                  <div className="sj-jc-reg">{j.vehicle_registration_no}</div>
                  <div className="sj-jc-meta">
                    <span>{JOB_TYPES.find(t => t.value === j.job_type)?.label}</span><span className="dot">·</span>
                    <span>{REPAIR_TYPES.find(t => t.value === j.repair_type)?.label}</span><span className="dot">·</span>
                    <span>{j.vendor_name_snapshot || 'No vendor'}</span>
                    {a && <><span className="dot">·</span><span className={`sj-age sj-age-${a.sev}`}>{a.label}</span></>}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
      </div>
      </div>
      )}

      {showNew && (
        <Modal wide error={error} onClose={() => { setError(''); setShowNew(false) }} title="New Service Job"
          subtitle="Generate a PO / warranty-request letter for outside-workshop work">
          <NewJobForm
            form={form} setForm={setForm} vendors={vendors} canManage={canManage}
            onReloadVendors={loadVendors} onSubmit={handleCreate} busy={busy} entityName={entity?.full_name}
          />
        </Modal>
      )}

      {selected && (
        <Modal error={error} onClose={() => { setError(''); setSelected(null) }} title={selected.po_number}
          subtitle={`Reg ${selected.vehicle_registration_no}`}
          headerExtra={(
            <div className="sj-badges">
              {statusBadges(selected).map((b, i) => <span key={i} className={`badge ${b.cls}`}>{b.text}</span>)}
            </div>
          )}>
          <JobDetail
            key={selected.id}
            job={selected} events={events} busy={busy}
            caps={{ isAdmin, canManage, canGm, isAccounts, canCapture }}
            onAct={act} onReprint={() => { pdfFor(selected); showToast('PO downloaded') }}
          />
        </Modal>
      )}

      {toast && (
        <div className={`sj-toast sj-toast-${toast.kind}`} role="status" aria-live="polite">{toast.msg}</div>
      )}
    </div>
  )
}

// Stroke icons (Tabler-style) per bucket — gives the Needs-you view its polish.
function BIcon({ name }) {
  const paths = {
    approve_warranty: <><path d="M12 3l7 3v5c0 4.6-3 7.2-7 8.5-4-1.3-7-3.9-7-8.5V6l7-3z" /><path d="M9 12l2 2 4-4.5" /></>,
    pay_vendor: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.4" /><path d="M6 9.5v.01M18 14.5v.01" /></>,
    settle_payment: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8h5M9.5 12h5" /></>,
    chase: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.5V12l3 1.8" /></>,
    anc_ref: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1" /></>,
    mine: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" /></>,
    advance_work: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12l2.5 2.5L16 9.5" /></>,
    advance_invoice: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8h5M9.5 11.5h5" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || null}
    </svg>
  )
}

// A single actionable job in the Needs-you view. Body opens the detail drawer;
// the inline button (when present) runs the one action this bucket is about.
function NeedCard({ job, bucket, index, busy, onOpen, onQuick, onReprint }) {
  const a = jobAging(job)
  // Only surface the age chip where it carries signal — the overdue bucket, or a
  // genuinely stale (amber/red) job. Green "idle 0d" everywhere was just noise.
  const showAge = a && (bucket.key === 'chase' || a.sev !== 'green')
  const type = JOB_TYPES.find(t => t.value === job.job_type)?.label
  const stop = (fn) => (e) => { e.stopPropagation(); fn() }
  let action = null
  if (bucket.key === 'approve_warranty')
    action = <button className="btn btn-sm btn-primary" disabled={busy} onClick={stop(() => onQuick('setSettlement', { jobId: job.id }, 'Warranty processed'))}>Mark warranty processed</button>
  else if (bucket.key === 'pay_vendor')
    action = <button className="btn btn-sm btn-primary" disabled={busy} onClick={stop(() => onQuick('markPaymentDone', { jobId: job.id }, 'Vendor marked paid'))}>Mark vendor paid</button>
  else if (bucket.key === 'settle_payment')
    action = <button className="btn btn-sm btn-primary" disabled={busy} onClick={stop(() => onQuick('setSettlement', { jobId: job.id }, 'Payment received'))}>Mark payment received</button>
  else if (bucket.key === 'advance_work')
    action = <button className="btn btn-sm btn-primary" disabled={busy} onClick={stop(() => onQuick('advanceStage', { jobId: job.id, toStage: 'work_completed' }, 'Marked work completed'))}>Mark work completed</button>
  else if (bucket.key === 'advance_invoice')
    action = <button className="btn btn-sm btn-primary" disabled={busy} onClick={stop(() => onQuick('advanceStage', { jobId: job.id, toStage: 'invoice_received' }, 'Marked invoice received'))}>Mark invoice received</button>
  else if (bucket.key === 'chase')
    action = <button className="btn btn-sm btn-secondary" disabled={busy} onClick={stop(onReprint)}>Re-print PO</button>

  return (
    <div className={`sj-need-card tone-${bucket.tone}`} role="button" tabIndex={0}
      style={{ animationDelay: `${Math.min(index, 9) * 50}ms` }}
      aria-label={`Open job ${job.po_number}`} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
      <span className={`sj-need-ico tone-${bucket.tone}`}><BIcon name={bucket.key} /></span>
      <div className="sj-need-main">
        <div className="sj-need-reg">
          <span className="reg">{job.vehicle_registration_no}</span>
          {showAge && <span className={`sj-age sj-age-${a.sev}`}>{a.label}</span>}
        </div>
        <div className="sj-need-sub">
          <span className="sj-need-po">{job.po_number}</span><span className="dot">·</span>
          <span>{type}</span><span className="dot">·</span>
          <span>{job.vendor_name_snapshot || 'No vendor'}</span>
          {job.customer_name ? <><span className="dot">·</span><span>{job.customer_name}</span></> : null}
        </div>
      </div>
      {action
        ? <div className="sj-need-act">{action}</div>
        : <span className="sj-need-go" aria-hidden="true">›</span>}
    </div>
  )
}

// Admin "Overview" lens — exposure dashboard (working-capital + flow), not a queue.
function OverviewDash({ overview, onOpen, onJumpParts, onJumpAccounts }) {
  const stats = [
    { key: 'parts', label: 'Parts out', value: overview.partsOut, tone: 'blue', onClick: onJumpParts },
    { key: 'overdue', label: 'Overdue', value: overview.overdue, tone: overview.overdue ? 'red' : 'gray', onClick: onJumpParts },
    { key: 'owe', label: 'We owe vendors', value: overview.weOwe, tone: 'amber', onClick: onJumpAccounts },
    { key: 'owed', label: 'Owed to us', value: overview.owedUs, tone: 'green', onClick: onJumpAccounts },
  ]
  return (
    <div className="sj-ov">
      <div className="sj-ov-stats">
        {stats.map((s, i) => (
          <button key={s.key} type="button" className={`sj-stat tone-${s.tone}`}
            style={{ animationDelay: `${i * 45}ms` }} onClick={s.onClick}>
            <span className="sj-stat-label">{s.label}</span>
            <span className="sj-stat-value">{s.value}</span>
          </button>
        ))}
      </div>
      <div className="sj-ov-row">
        <section className="sj-ov-card">
          <div className="sj-ov-card-head"><span className="sj-ov-card-title">⚠ Bottlenecks</span></div>
          {overview.top.length ? (
            <div className="sj-ov-list">
              {overview.top.map(({ j, a }) => (
                <button key={j.id} type="button" className="sj-ov-bottle" onClick={() => onOpen(j)}>
                  <span className="sj-ov-bottle-main">
                    <span className="reg">{j.vehicle_registration_no}</span>
                    <span className="sub">{a.kind === 'out' ? `at ${j.vendor_name_snapshot || 'vendor'}` : 'idle'} · {plural(a.days, 'day')}</span>
                  </span>
                  <span className={`sj-age sj-age-${a.sev}`}>{a.overdue ? 'overdue' : a.label}</span>
                </button>
              ))}
            </div>
          ) : <p className="sj-ov-empty">Nothing stuck — all parts moving.</p>}
        </section>
        <section className="sj-ov-card">
          <div className="sj-ov-card-head"><span className="sj-ov-card-title">This week</span></div>
          <div className="sj-ov-week">
            <div><strong>{overview.createdWk}</strong><span>created</span></div>
            <div><strong>{overview.closedWk}</strong><span>closed</span></div>
            <div><strong>{overview.avgTurn != null ? overview.avgTurn.toFixed(1) + 'd' : '—'}</strong><span>avg turnaround</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}

function statusBadges(job) {
  const aw = job.job_type === 'ancillary' && job.repair_type === 'warranty'
  const cancelled = job.final_outcome === 'cancelled'
  const closed = !!job.closed_at
  const curIdx = SPINE.indexOf(job.stage)
  const badges = [{
    text: cancelled ? 'Cancelled' : closed ? 'Completed' : STAGE_LABEL[job.stage],
    cls: cancelled ? 'badge-red' : closed ? 'badge-green' : curIdx >= 1 ? 'badge-blue' : 'badge-gray',
  }]
  if (!aw) badges.push({ text: `Vendor ${job.payment_done_at ? 'paid' : 'unpaid'}`, cls: job.payment_done_at ? 'badge-green' : 'badge-gray' })
  badges.push({ text: job.settlement_status ? job.settlement_status.replace('_', ' ') : 'Not settled', cls: job.settlement_status ? 'badge-green' : 'badge-gray' })
  return badges
}

function Modal({ title, subtitle, onClose, children, wide, headerExtra, error }) {
  const ref = useRef(null)
  const titleId = useRef('sj-modal-' + Math.random().toString(36).slice(2)).current
  // Keep the latest onClose in a ref so the focus-trap effect can run ONCE on
  // mount. (Depending on [onClose] re-ran the effect every render — onClose is an
  // inline arrow — which re-focused the dialog and stole focus from inputs after
  // a single keystroke.)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus-trap + Esc-to-close + restore focus to the trigger on unmount (a11y).
  useEffect(() => {
    const prev = document.activeElement
    const node = ref.current
    node?.focus()
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return }
      if (e.key !== 'Tab' || !node) return
      const els = Array.from(
        node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.disabled && el.offsetParent !== null)
      if (els.length === 0) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    node?.addEventListener('keydown', onKey)
    return () => { node?.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sj-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}
        style={wide ? { maxWidth: 660 } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-main">
            <div>
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--gray-500)' }}>{subtitle}</p>}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {headerExtra && <div className="modal-header-extra">{headerExtra}</div>}
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
          {children}
        </div>
      </div>
    </div>
  )
}

function NewJobForm({ form, setForm, vendors, canManage, onReloadVendors, onSubmit, busy, entityName }) {
  const [addingVendor, setAddingVendor] = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [vendorOem, setVendorOem] = useState('')
  const [vendorErr, setVendorErr] = useState('')
  const aw = form.job_type === 'ancillary' && form.repair_type === 'warranty'
  // Ancillary work goes to an authorized OEM dealer (has an OEM); outside work goes
  // to a general (non-authorized) vendor. The vendor list + add-form follow this.
  const isAncillary = form.job_type === 'ancillary'
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function addVendor() {
    if (!vendorName.trim()) return
    if (isAncillary && !vendorOem.trim()) { setVendorErr('OEM is required for an authorized dealer'); return }
    setVendorErr('')
    try {
      const res = await callEdge('service-jobs', 'createVendor', {
        name: vendorName.trim(),
        is_authorized: isAncillary,
        oem: isAncillary ? vendorOem.trim() : null,
      })
      await onReloadVendors()
      setForm(f => ({ ...f, vendor_id: res.vendor.id }))
      setAddingVendor(false); setVendorName(''); setVendorOem('')
    } catch (e) { setVendorErr(e.message || 'Failed to add vendor') }
  }

  const pick = (k, v) => setForm(f => ({ ...f, [k]: v }))
  // Switching job type swaps the eligible vendor pool (authorized vs general),
  // so any previously-picked vendor no longer applies — clear it.
  const setJobType = (v) => { setForm(f => ({ ...f, job_type: v, vendor_id: '' })); setAddingVendor(false); setVendorErr('') }
  const reqLetter = ['chassis_no', 'engine_no', 'check_item']
  const eligibleVendors = vendors.filter(v => v.is_active && !!v.is_authorized === isAncillary)

  return (
    <form onSubmit={onSubmit} className="sj-form">
      {/* 1 — Classification */}
      <div className="sj-section">
        <div className="sj-section-title">Job classification</div>
        <div className="sj-grid-2">
          <div className="form-group">
            <label className="form-label" id="sj-lbl-jobtype">Job type</label>
            <div className="seg" role="radiogroup" aria-labelledby="sj-lbl-jobtype">
              {JOB_TYPES.map(t => (
                <button type="button" key={t.value} role="radio" aria-checked={form.job_type === t.value}
                  className={`seg-btn${form.job_type === t.value ? ' active' : ''}`}
                  onClick={() => setJobType(t.value)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" id="sj-lbl-basis">Repair basis</label>
            <div className="seg" role="radiogroup" aria-labelledby="sj-lbl-basis">
              {REPAIR_TYPES.map(t => (
                <button type="button" key={t.value} role="radio" aria-checked={form.repair_type === t.value}
                  className={`seg-btn${form.repair_type === t.value ? ' active' : ''}`}
                  onClick={() => pick('repair_type', t.value)}>{t.label}</button>
              ))}
            </div>
          </div>
        </div>
        {aw && <p className="field-hint">Ancillary · Warranty generates a warranty-request letter to the Authorized Dealer (no vendor invoice / payment).</p>}
      </div>

      {/* 2 — Vehicle & customer */}
      <div className="sj-section">
        <div className="sj-section-title">Vehicle &amp; customer</div>
        <div className="sj-grid-2">
          <div className="form-group">
            <label className="form-label" htmlFor="sj-reg">Vehicle registration no <span className="req">*</span></label>
            <input id="sj-reg" className="form-input" required value={form.vehicle_registration_no} onChange={set('vehicle_registration_no')} placeholder="e.g. GJ01AB1234" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="sj-cust">Customer name <span className="req">*</span></label>
            <input id="sj-cust" className="form-input" required value={form.customer_name} onChange={set('customer_name')} placeholder="Vehicle owner" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="sj-vendor">{isAncillary ? 'Authorized dealer' : 'Vendor'} <span className="req">*</span></label>
          <div className="sj-vendor-row">
            <select id="sj-vendor" className="form-select" required value={form.vendor_id} onChange={set('vendor_id')}>
              <option value="">{isAncillary ? '— select authorized dealer —' : '— select vendor —'}</option>
              {eligibleVendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.oem ? ` (${v.oem})` : ''}</option>)}
            </select>
            {canManage && (
              <button type="button" className="btn btn-secondary" onClick={() => setAddingVendor(a => !a)}>
                {addingVendor ? 'Cancel' : '+ Add'}
              </button>
            )}
          </div>
          <p className="field-hint">
            {isAncillary
              ? 'Ancillary work goes to the OEM’s authorized dealer (e.g. Bosch Diesel Services).'
              : 'Outside work goes to a general repair vendor (not an authorized dealer).'}
          </p>
          {addingVendor && (
            <div className="sj-vendor-row" style={{ marginTop: 8 }}>
              <input className="form-input" aria-label="New vendor name"
                placeholder={isAncillary ? 'Authorized dealer name' : 'Vendor name'}
                value={vendorName} onChange={e => setVendorName(e.target.value)} />
              {isAncillary && (
                <input className="form-input" aria-label="OEM or brand" placeholder="OEM / brand (e.g. Bosch)"
                  value={vendorOem} onChange={e => setVendorOem(e.target.value)} />
              )}
              <button type="button" className="btn btn-primary" onClick={addVendor}>Save</button>
            </div>
          )}
          {vendorErr && <div className="form-error">{vendorErr}</div>}
        </div>
      </div>

      {/* 3 — Work details */}
      <div className="sj-section">
        <div className="sj-section-title">Work details</div>
        {!aw && (
          <div className="form-group">
            <label className="form-label" htmlFor="sj-desc">Job description</label>
            <textarea id="sj-desc" className="form-input" value={form.job_description} onChange={set('job_description')} rows={2} placeholder="What work is being sent out?" />
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="sj-mout">Material out date <span className="req">*</span></label>
          <input id="sj-mout" className="form-input" type="date" required value={form.material_out_date} onChange={set('material_out_date')} />
          <p className="field-hint">Defaults to today. Material-returned is recorded automatically when work is marked completed; the ancillary portal ref is added later, after the AL-portal upload.</p>
        </div>

        {aw && (
          <div className="sj-letter">
            <div className="sj-letter-legend">📝 Warranty request letter details</div>
            <div className="sj-grid-2">
              {LETTER_FIELDS.map(([key, label, type]) => (
                <div className="form-group" key={key}>
                  <label className="form-label" htmlFor={`sj-lf-${key}`}>{label}{reqLetter.includes(key) ? <span className="req"> *</span> : ''}</label>
                  <input id={`sj-lf-${key}`} className="form-input" type={type === 'date' ? 'date' : 'text'}
                    required={reqLetter.includes(key)} value={form[key]} onChange={set(key)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sj-modal-footer">
        <span className="field-hint" style={{ margin: 0 }}>{entityName || 'Your entity'} · PO number assigned on save</span>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Saving…' : 'Create & Generate PO'}
        </button>
      </div>
    </form>
  )
}

function JobDetail({ job, events, busy, caps, onAct, onReprint }) {
  const { isAdmin, canManage, canGm, isAccounts, canCapture } = caps
  const aw = job.job_type === 'ancillary' && job.repair_type === 'warranty'
  const closed = !!job.closed_at
  const [ancRef, setAncRef] = useState(job.ancillary_ref || '')
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const curIdx = SPINE.indexOf(job.stage)
  const maxIdx = aw ? 1 : 2 // ancillary-warranty caps at work_completed
  const nextStage = curIdx < maxIdx ? SPINE[curIdx + 1] : null
  // Advancing to work_completed is open to capture roles (incl. executives);
  // advancing to invoice_received stays manager+.
  const canAdvance = !closed && !!nextStage && (nextStage === 'work_completed' ? canCapture : canManage)

  const settleStage = job.repair_type === 'warranty' ? (aw ? 'work_completed' : 'invoice_received') : 'invoice_received'
  const canSettle = !closed && !job.settlement_status && job.stage === settleStage &&
    (job.repair_type === 'warranty' ? canManage : isAccounts)
  const canPay = !closed && !aw && isAccounts && job.stage === 'invoice_received' && !job.payment_done_at

  const workDone = curIdx >= 1 // work_completed or beyond
  const canEditAncRef = job.job_type === 'ancillary' && !closed && workDone
  const out = partIsOut(job) ? daysSince(job.material_out_date) : null
  const meta = [
    ['Reg No', job.vehicle_registration_no],
    ['Customer', job.customer_name || '—'],
    ['Type', `${JOB_TYPES.find(t => t.value === job.job_type)?.label} · ${REPAIR_TYPES.find(t => t.value === job.repair_type)?.label}`],
    ['Vendor', job.vendor_name_snapshot || '—'],
    ['Material out', job.material_out_date ? `${job.material_out_date}${out !== null ? ` · ${out}d out` : ''}` : '—'],
    ['Material returned', job.material_return_date || '—'],
  ]

  return (
    <div className="sj-detail">
      <div className="sj-meta">
        {meta.map(([k, v]) => (
          <div className="sj-meta-item" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
        ))}
      </div>

      {!aw && job.job_description && (
        <div className="sj-meta-item"><span className="k">Job description</span><span className="v">{job.job_description}</span></div>
      )}

      {/* Ancillary portal ref — only after work is completed */}
      {job.job_type === 'ancillary' && (
        canEditAncRef ? (
          <div className="form-group">
            <label className="form-label" htmlFor="sj-ancref">Ancillary portal ref</label>
            <div className="sj-attach">
              <input id="sj-ancref" className="form-input" value={ancRef} onChange={e => setAncRef(e.target.value)} placeholder="Reference from the AL ancillary portal" />
              <button className="btn btn-primary" disabled={busy}
                onClick={() => onAct('updateJob', { id: job.id, update: { ancillary_ref: ancRef.trim() || null } }, job.id, 'Ancillary ref saved')}>Save</button>
            </div>
          </div>
        ) : (job.ancillary_ref || closed) ? (
          <div className="sj-meta-item"><span className="k">Ancillary ref</span><span className="v">{job.ancillary_ref || '—'}</span></div>
        ) : (
          <p className="field-hint" style={{ margin: 0 }}>Ancillary portal ref can be added once work is completed.</p>
        )
      )}

      {aw && job.stage === 'work_completed' && !job.settlement_status && !closed && (
        <div className="sj-note">Awaiting warranty approval (manager action) — vendor settles via the AL ancillary portal.</div>
      )}

      <div className="sj-actions">
        <button className="btn btn-sm btn-secondary" onClick={onReprint}>🖨 Re-print PO</button>
        {canAdvance && (
          <button className="btn btn-sm btn-primary" disabled={busy}
            onClick={() => onAct('advanceStage', { jobId: job.id, toStage: nextStage }, job.id, `Advanced to ${STAGE_LABEL[nextStage]}`)}>Advance → {STAGE_LABEL[nextStage]}</button>
        )}
        {canPay && (
          <button className="btn btn-sm btn-primary" disabled={busy}
            onClick={() => onAct('markPaymentDone', { jobId: job.id }, job.id, 'Vendor marked paid')}>Mark vendor paid</button>
        )}
        {canSettle && (
          <button className="btn btn-sm btn-primary" disabled={busy}
            onClick={() => onAct('setSettlement', { jobId: job.id }, job.id, job.repair_type === 'warranty' ? 'Warranty processed' : 'Payment received')}>
            {job.repair_type === 'warranty' ? 'Mark warranty processed' : 'Mark payment received'}</button>
        )}
        {canManage && !closed && job.repair_type === 'warranty' && (
          <button className="btn btn-sm btn-secondary" disabled={busy}
            onClick={() => onAct('convertToPaid', { jobId: job.id }, job.id, 'Converted to paid')}>Convert to paid</button>
        )}
        {canManage && !closed && !cancelling && (
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => setCancelling(true)}>Cancel job</button>
        )}
        {canGm && (
          <button className="btn btn-sm btn-secondary" disabled={busy}
            onClick={() => onAct('undoLastStatus', { jobId: job.id }, job.id, 'Last status undone')}>↩ Undo last status</button>
        )}
      </div>

      {cancelling && (
        <div className="sj-cancel">
          <label className="form-label" htmlFor="sj-cancel-reason">Cancel this job?</label>
          <input id="sj-cancel-reason" className="form-input" value={cancelReason}
            onChange={e => setCancelReason(e.target.value)} placeholder="Reason (optional)" autoFocus />
          <div className="sj-cancel-actions">
            <button className="btn btn-sm btn-secondary" disabled={busy}
              onClick={() => { setCancelling(false); setCancelReason('') }}>Keep job</button>
            <button className="btn btn-sm btn-danger" disabled={busy}
              onClick={() => onAct('cancelJob', { jobId: job.id, reason: cancelReason.trim() }, job.id, 'Job cancelled')}>Confirm cancel</button>
          </div>
        </div>
      )}

      <div className="sj-section">
        <div className="sj-section-title">Track log</div>
        <ul className="sj-log">
          {events.map(ev => (
            <li key={ev.id}>
              <div className="sj-log-row">
                <span className="ev">{ev.event_type.replace(/_/g, ' ')}</span>
                {(ev.from_value || ev.to_value) ? <span className="chg">{ev.from_value ?? '∅'} → {ev.to_value ?? '∅'}</span> : null}
                {ev.note ? <span className="note">— {ev.note}</span> : null}
              </div>
              <span className="when">{ev.actor_name ? <><strong className="who">{ev.actor_name}</strong> · </> : ''}{new Date(ev.created_at).toLocaleString('en-IN')}</span>
            </li>
          ))}
          {events.length === 0 && <li style={{ color: 'var(--gray-400)' }}>No events yet.</li>}
        </ul>
      </div>
    </div>
  )
}
