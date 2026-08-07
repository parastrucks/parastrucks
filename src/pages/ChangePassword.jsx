import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { callEdge } from '../lib/api'
import { MIN_PASSWORD_LENGTH } from '../lib/passwordPolicy'

/**
 * Forced password change.
 *
 * Reached when app_metadata.must_change_password is set — i.e. HR or an admin
 * just set this person's password, so it is known to at least two people.
 *
 * Deliberately rendered OUTSIDE AppLayout. Inside it the sidebar and bottom nav
 * would render and every link would bounce straight back here, which reads as a
 * broken app rather than an instruction. There is exactly one way forward (set a
 * password) and one way out (sign out).
 */
export default function ChangePassword() {
  const { signOut, session, loading, mustChangePassword } = useAuth()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setErrorField(null)

    if (!currentPw) {
      setError('Enter the password you just signed in with.'); setErrorField('current'); return
    }
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); setErrorField('new'); return
    }
    if (newPw === currentPw) {
      setError('Your new password must be different from the temporary one.'); setErrorField('new'); return
    }
    if (newPw !== confirmPw) {
      setError('Passwords do not match.'); setErrorField('confirm'); return
    }

    setBusy(true)
    // Goes through the Edge Function, not supabase.auth.updateUser(): the flag
    // lives in app_metadata, which the browser is not allowed to write. That
    // restriction is exactly what makes the flag trustworthy — a user cannot
    // clear their own. The EF sets the password and clears the flag in ONE call,
    // so there is no state where one succeeded and the other did not.
    // callEdge throws on any non-2xx or body.error.
    try {
      await callEdge('admin-users', 'changeOwnPassword', {
        currentPassword: currentPw,
        newPassword: newPw,
      })
    } catch (e) {
      setBusy(false)
      const msg = e?.message || 'Could not change your password. Please try again.'
      setError(msg)
      if (/current password/i.test(msg)) setErrorField('current')
      return
    }

    // The flag rides inside the JWT, so it is stale until the token is
    // replaced. Without this refresh the guard keeps firing and the user is
    // trapped on this page with a password that has, in fact, already changed.
    const { error: refreshErr } = await supabase.auth.refreshSession()
    if (refreshErr) {
      // Never strand someone here holding a changed password. Signing out is a
      // clean, recoverable end state: their new password works on the way back.
      setDone(true)
      setTimeout(() => signOut(), 1800)
      return
    }
    // Success: the refreshed token drops the flag, the guard stops matching and
    // the router releases them into the app.
    setBusy(false)
  }

  // This route sits outside ProtectedRoute (deliberately — see App.jsx), so it
  // does its own gating. `done` is checked first: once the password is changed
  // the flag is gone, and without this the success message would be replaced by
  // an instant redirect and the user would never see that it worked.
  if (loading) return <Shell><div className="full-center"><div className="spinner" /></div></Shell>
  if (!session) return <Navigate to="/login" replace />
  if (!done && !mustChangePassword) return <Navigate to="/profile" replace />

  if (done) {
    return (
      <Shell>
        <h1 className="page-head-title" style={{ marginBottom: 8 }}>Password updated<span className="period-accent">.</span></h1>
        <p style={{ color: 'var(--gray-600)', fontSize: 14 }}>
          Please sign in again with your new password.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="page-head-crumb">Security</div>
      <h1 className="page-head-title" style={{ marginBottom: 6 }}>
        Choose your password<span className="period-accent">.</span>
      </h1>
      <p style={{ color: 'var(--gray-600)', fontSize: 14, marginBottom: 20 }}>
        The password you signed in with was set for you, so more than one person knows it.
        Please pick your own before continuing.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="cp-current">Current password</label>
          <input
            id="cp-current" type="password" autoComplete="current-password" autoFocus
            className={`form-input ${errorField === 'current' ? 'error' : ''}`}
            placeholder="The one you just used"
            value={currentPw}
            onChange={e => { setCurrentPw(e.target.value); setErrorField(f => f === 'current' ? null : f) }}
          />
          {errorField === 'current' && <div className="form-error">{error}</div>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cp-new">New password</label>
          <input
            id="cp-new" type="password" autoComplete="new-password"
            className={`form-input ${errorField === 'new' ? 'error' : ''}`}
            placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
            value={newPw}
            onChange={e => { setNewPw(e.target.value); setErrorField(f => f === 'new' ? null : f) }}
          />
          {errorField === 'new' && <div className="form-error">{error}</div>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm" type="password" autoComplete="new-password"
            className={`form-input ${errorField === 'confirm' ? 'error' : ''}`}
            placeholder="Re-enter it"
            value={confirmPw}
            onChange={e => { setConfirmPw(e.target.value); setErrorField(f => f === 'confirm' ? null : f) }}
          />
          {errorField === 'confirm' && <div className="form-error">{error}</div>}
        </div>

        {error && !errorField && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

        <button type="submit" className="btn btn-primary btn-full" disabled={busy}>
          {busy ? <span className="spinner spinner-sm" /> : 'Set password and continue'}
        </button>
      </form>

      <button
        className="btn btn-secondary btn-full"
        style={{ marginTop: 12 }}
        onClick={signOut}
        disabled={busy}
      >
        Sign out
      </button>
    </Shell>
  )
}

/* Standalone centred card — no sidebar, no nav, nothing to click past. */
function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--gray-50, #F8F8F8)', padding: 24,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </div>
  )
}
