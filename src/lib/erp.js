import { useState, useEffect } from 'react'
import { callEdge } from './api'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'

/* Whether to surface the HD Hyundai ERP entry (Sidebar item + Drawer + Dashboard
   card). HD Hyundai is a PT-entity-only brand, so eligibility follows the `hdh`
   brand assignment: a PTB user (no hdh brand) never sees it. Admins keep it (the
   owner is a manually-provisioned ERP admin without a portal brand row). The
   erp-sso function still gates access server-side for anyone who does click. */
export function useErpVisible() {
  const { profile, isAdmin } = useAuth()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) { setVisible(false); return }
    if (isAdmin) { setVisible(true); return }
    setVisible(false)
    supabase
      .from('user_brands')
      .select('brands(code)')
      .eq('user_id', profile.id)
      .then(({ data, error }) => {
        if (cancelled) return
        // Fail OPEN on a *transient* read error: pre-redesign the ERP entry was
        // always shown (erp-sso gates the actual click), so a blip must not
        // strip a legitimately-entitled user of every ERP entry point with no
        // recovery. A successful empty read still hides it.
        //
        // But NOT on an auth/key rejection (red-team 2026-07-21, H3). During the
        // new-API-key cutover a 401 here would have shown the HD Hyundai card to
        // EVERY user — including PTB staff with no entitlement — who would then
        // hit the `no_erp_access` alert on click. Mass confusion on a path
        // nobody would think to test. Server-side gating in erp-sso still holds
        // either way; this is about not lying in the UI.
        if (error) {
          const status = error.status ?? error.code
          const authFailure = status === 401 || status === 403 ||
            /jwt|api ?key|unauthorized|not authorized/i.test(error.message || '')
          console.error(
            'useErpVisible: user_brands read failed:', error.message,
            authFailure ? '— treating as NOT entitled' : '— failing open',
          )
          setVisible(!authFailure)
          return
        }
        const codes = (data || []).map(r => r.brands?.code).filter(Boolean)
        setVisible(codes.includes('hdh'))
      })
    return () => { cancelled = true }
  }, [profile?.id, isAdmin])

  return visible
}

/* Shared HD Hyundai Service ERP one-click SSO (Phase 9.6).
   Used by both the Dashboard ERP card and the Sidebar ERP item so the flow +
   error UX stay identical. erp-sso validates this portal session, mints an ERP
   magic-link, and returns the ERP /sso URL (first click provisions JIT). */
export function useErp() {
  const [erpBusy, setErpBusy] = useState(false)

  async function openErp() {
    if (erpBusy) return
    setErpBusy(true)
    try {
      const res = await callEdge('erp-sso', 'open', {})
      if (res?.url) { window.location.href = res.url; return }
      setErpBusy(false)
      alert('Could not open the ERP. Please try again.')
    } catch (e) {
      setErpBusy(false)
      alert(e?.message === 'no_erp_access'
        ? 'You do not have HD Hyundai Service ERP access yet. Contact an admin if you need it.'
        : 'Could not open the ERP. Please try again.')
    }
  }

  return { openErp, erpBusy }
}
