import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import useAsyncAction from '../hooks/useAsyncAction'

const ROLE_LABEL = { admin: 'Admin', hr: 'HR', back_office: 'Back Office', sales: 'Sales' }

export default function Profile() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { run, loading: pwLoading, error: pwError, setError: setPwError, clearError } = useAsyncAction()
  const [changingPw, setChangingPw] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  async function handleChangePw(e) {
    e.preventDefault()
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    await run(async () => {
      const { error } = await supabase.auth.updateUser({ password: newPw })
      if (error) throw error
      toast.success('Password updated successfully.')
      setNewPw(''); setConfirmPw(''); setChangingPw(false)
    }).catch(() => {})
  }

  if (!profile) return null

  const fields = [
    { label: 'Full Name',    value: profile.full_name },
    { label: 'Email',        value: profile.email },
    // Per memory/terminology.md: UI "Permission Level" binds DB users.role;
    // UI "Role" binds DB users.vertical. The labels below use product-owner terms.
    { label: 'Permission Level', value: ROLE_LABEL[profile.role] || profile.role },
    { label: 'Entity',       value: profile.entity },
    { label: 'Location',     value: profile.location },
    { label: 'Department',   value: profile.department },
    { label: 'Role',         value: profile.vertical },
    { label: 'Designation',  value: profile.designation },
  ].filter(f => f.value)

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Your account details. To update attributes, contact HR.</p>
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
            <span className="badge badge-blue" style={{ marginTop: 4 }}>{ROLE_LABEL[profile.role]}</span>
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

        {pwError && <div className="alert alert-error"><span>⚠</span><span>{pwError}</span></div>}

        {changingPw && (
          <form onSubmit={handleChangePw}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-new-pw">New Password</label>
              <input
                id="profile-new-pw"
                type="password"
                className="form-input"
                placeholder="Minimum 8 characters"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-confirm-pw">Confirm Password</label>
              <input
                id="profile-confirm-pw"
                type="password"
                className="form-input"
                placeholder="Re-enter new password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={pwLoading}>
                {pwLoading ? <span className="spinner spinner-sm" /> : 'Update Password'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setChangingPw(false); clearError(); }}>
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
