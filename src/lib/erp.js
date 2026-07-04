import { useState } from 'react'
import { callEdge } from './api'

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
