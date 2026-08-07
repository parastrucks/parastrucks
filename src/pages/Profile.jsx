import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { MIN_PASSWORD_LENGTH } from '../lib/passwordPolicy'
import useAsyncAction from '../hooks/useAsyncAction'

// Phase 6c.1: permission tiers from the new column. `admin` only appears
// here because an admin viewing their own profile should see it correctly.
const PERM_LABEL = { admin: 'Admin', gm: 'GM', manager: 'Manager', executive: 'Executive' }

export default function Profile() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { run, loading: pwLoading, error: pwError, setError: setPwError, clearError } = useAsyncAction()
  const [pwErrorField, setPwErrorField] = useState(null) // which password field to flag red
  const [changingPw, setChangingPw] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  // Resolve UUID references to human labels via ref-table lookups.
  // One batched query; profile changes rarely, so effect runs on id only.
  const [deets, setDeets] = useState({
    entity_code: null, dept_name: null, designation_name: null,
    brand_names: [], vertical_names: [], outlet_label: null, subdept_name: null,
  })
  useEffect(() => {
    let cancelled = false
    if (!profile) return
    ;(async () => {
      const [entRes, depRes, desRes, outRes, subRes, ubRes, uvRes] = await Promise.all([
        profile.entity_id      ? supabase.from('entities')    .select('code')            .eq('id', profile.entity_id)      .maybeSingle() : Promise.resolve({ data: null }),
        profile.department_id  ? supabase.from('departments') .select('name')            .eq('id', profile.department_id)  .maybeSingle() : Promise.resolve({ data: null }),
        profile.designation_id ? supabase.from('designations').select('name')            .eq('id', profile.designation_id) .maybeSingle() : Promise.resolve({ data: null }),
        profile.primary_outlet_id ? supabase.from('outlets')   .select('city,facility_type').eq('id', profile.primary_outlet_id).maybeSingle() : Promise.resolve({ data: null }),
        profile.subdept_id        ? supabase.from('back_office_subdepts').select('name') .eq('id', profile.subdept_id)      .maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('user_brands')         .select('brands(name)').eq('user_id', profile.id),
        supabase.from('user_sales_verticals').select('sales_verticals(name)').eq('user_id', profile.id),
      ])
      if (cancelled) return
      setDeets({
        entity_code:      entRes.data?.code ?? null,
        dept_name:        depRes.data?.name ?? null,
        designation_name: desRes.data?.name ?? null,
        outlet_label:     outRes.data ? `${outRes.data.city} (${outRes.data.facility_type})` : null,
        subdept_name:     subRes.data?.name ?? null,
        brand_names:      (ubRes.data || []).map(r => r.brands?.name).filter(Boolean),
        vertical_names:   (uvRes.data || []).map(r => r.sales_verticals?.name).filter(Boolean),
      })
    })()
    return () => { cancelled = true }
  }, [profile?.id, profile?.entity_id, profile?.department_id, profile?.designation_id, profile?.primary_outlet_id, profile?.subdept_id])

  async function handleChangePw(e) {
    e.preventDefault()
    setPwError('')
    setPwErrorField(null)

    const focusEl = (id) => {
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }) } catch { el.focus() } }
    }

    if (!currentPw) {
      setPwError('Enter your current password.')
      setPwErrorField('current')
      focusEl('profile-current-pw')
      return
    }
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      setPwError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      setPwErrorField('new')
      focusEl('profile-new-pw')
      return
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.')
      setPwErrorField('confirm')
      focusEl('profile-confirm-pw')
      return
    }
    await run(async () => {
      // Routed through admin-users rather than supabase.auth.updateUser() so
      // there is ONE password-change path in the app. That buys three things a
      // direct client call cannot: the change is written to the audit log, the
      // current password must be proved (previously a borrowed session could
      // change it without knowing the old one), and the same call clears
      // must_change_password — which lives in app_metadata and is deliberately
      // not writable from the browser.
      // callEdge throws on any non-2xx or body.error; useAsyncAction's onError
      // surfaces the message as a toast.
      try {
        await callEdge('admin-users', 'changeOwnPassword', {
          currentPassword: currentPw,
          newPassword: newPw,
        })
      } catch (err) {
        if (/current password/i.test(err?.message || '')) setPwErrorField('current')
        throw err
      }
      toast.success('Password updated successfully.')
      setCurrentPw(''); setNewPw(''); setConfirmPw(''); setChangingPw(false)
    }, {
      // Server failures surface as a toast — no banner.
      onError: err => toast.error(err?.message || 'Failed to update password.'),
    }).catch(() => {})
  }

  if (!profile) return null

  // Phase 6c.3: reads only the new 4-axis columns — legacy fallback removed.
  const fields = [
    { label: 'Full Name',        value: profile.full_name },
    { label: 'Email',            value: profile.email },
    { label: 'Permission Level', value: PERM_LABEL[profile.permission_level] || profile.permission_level },
    { label: 'Entity',           value: deets.entity_code },
    { label: 'Department',       value: deets.dept_name },
    { label: 'Designation',      value: deets.designation_name },
    { label: 'Primary Outlet',   value: deets.outlet_label },
    { label: 'Sub-department',   value: deets.subdept_name },
    { label: 'Brands',           value: deets.brand_names.length ? deets.brand_names.join(', ') : null },
    { label: 'Sales verticals',  value: deets.vertical_names.length ? deets.vertical_names.join(', ') : null },
    { label: 'Location',         value: profile.location },
  ].filter(f => f.value)

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Account</div>
          <h1 className="page-head-title">My Profile<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Your account details. To update attributes, contact HR.</div>
        </div>
      </div>

      <div className="card mb-24">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--blue-light)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: 'var(--blue)'
          }}>
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--gray-900)' }}>{profile.full_name}</div>
            <span className="badge badge-blue" style={{ marginTop: 4 }}>{PERM_LABEL[profile.permission_level] || '—'}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
          {fields.map(f => (
            <div key={f.label}>
              <div className="form-label" style={{ marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 14, color: 'var(--gray-800)', fontWeight: 500 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <div className="flex-between mb-16">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Password</div>
            <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 2 }}>Update your login password</div>
          </div>
          {!changingPw && (
            <button className="btn btn-secondary btn-sm" onClick={() => setChangingPw(true)}>Change</button>
          )}
        </div>

        {changingPw && (
          <form onSubmit={handleChangePw}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-current-pw">Current Password</label>
              <input
                id="profile-current-pw"
                type="password"
                autoComplete="current-password"
                className={`form-input ${pwErrorField === 'current' ? 'error' : ''}`}
                placeholder="Your current password"
                value={currentPw}
                onChange={e => { setCurrentPw(e.target.value); setPwErrorField(f => f === 'current' ? null : f) }}
                autoFocus
              />
              {pwErrorField === 'current' && <div className="form-error">{pwError}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-new-pw">New Password</label>
              <input
                id="profile-new-pw"
                type="password"
                autoComplete="new-password"
                className={`form-input ${pwErrorField === 'new' ? 'error' : ''}`}
                placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                value={newPw}
                onChange={e => { setNewPw(e.target.value); setPwErrorField(f => f === 'new' ? null : f) }}
              />
              {pwErrorField === 'new' && <div className="form-error">{pwError}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-confirm-pw">Confirm Password</label>
              <input
                id="profile-confirm-pw"
                type="password"
                className={`form-input ${pwErrorField === 'confirm' ? 'error' : ''}`}
                placeholder="Re-enter new password"
                value={confirmPw}
                onChange={e => { setConfirmPw(e.target.value); setPwErrorField(f => f === 'confirm' ? null : f) }}
              />
              {pwErrorField === 'confirm' && <div className="form-error">{pwError}</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                {pwLoading ? <span className="spinner spinner-sm" /> : 'Update Password'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setChangingPw(false); clearError(); setPwErrorField(null); setCurrentPw(""); setNewPw(""); setConfirmPw("") }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <button className="btn btn-danger btn-full" style={{ marginTop: 24 }} onClick={signOut}>
        Sign Out
      </button>
    </div>
  )
}
