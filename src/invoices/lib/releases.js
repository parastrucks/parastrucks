// Shared bits for credit releases (step 2): what state a release is in, and the caller's
// department code (the profile carries only department_id). Rules on WHO may do what come
// from the Edge Function's own authority.ts, so the screen can never offer a button the
// server would refuse.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
export { isApprover, mayDecideFor, mayUse, RELEASE_HOURS } from '../../../supabase/functions/gate-invoices/authority.ts'

export function useDeptCode(profile) {
  const [code, setCode] = useState(undefined)   // undefined = still loading
  useEffect(() => {
    let off = false
    if (!profile?.department_id) { setCode(null); return }
    supabase.from('departments').select('code').eq('id', profile.department_id).maybeSingle()
      .then(({ data }) => { if (!off) setCode(data?.code ?? null) })
    return () => { off = true }
  }, [profile?.department_id])
  return code
}

/** The authority.ts "Who" for the signed-in user. */
export const whoFrom = (profile, deptCode) => ({
  id: profile?.id ?? null,
  permission_level: profile?.permission_level ?? null,
  department_code: deptCode ?? null,
  entity_id: profile?.entity_id ?? null,
})

/** 'waiting' | 'released' | 'expired' | 'held' | 'withdrawn' */
export function releaseState(rel, now = Date.now()) {
  if (!rel) return null
  if (rel.status === 'asked') return 'waiting'
  if (rel.status === 'approved') return new Date(rel.valid_until).getTime() > now ? 'released' : 'expired'
  return rel.status
}

/** The release that matters for an invoice row: the newest one. */
// A ref for an inline form that opens under a row: bring it into view once, when it appears.
// On a phone the last row's form otherwise opens under the bottom bar (seen 2026-10-27);
// the CSS scroll-margin keeps it above the bar. Module-level, so React calls it only on attach.
export const revealForm = (el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

export const latestRelease =(rels) => [...(rels ?? [])].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0] ?? null

export const istTime = (iso) => new Date(iso).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
})
