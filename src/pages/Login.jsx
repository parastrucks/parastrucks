import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { setError('Please enter your username and password.'); return }
    setLoading(true)
    setError('')
    try {
      await signIn(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo-wrap">
          <img src="/paras-logo.png" alt="Paras Trucks" className="login-logo" />
        </div>

        <h1 className="login-title">Team Portal</h1>
        <p className="login-subtitle">Sign in to continue</p>

        {error && (
          <div className="alert alert-error">
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Username / Email</label>
            <input
              id="email"
              type="text"
              className={`form-input ${error ? 'error' : ''}`}
              placeholder="e.g. ramesh.ahm@parastrucks.in"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                className={`form-input ${error ? 'error' : ''}`}
                placeholder="Enter your password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                style={{ paddingRight: '44px' }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: '12px', top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--gray-400)',
                  fontSize: '16px', lineHeight: 1
                }}
                tabIndex={-1}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            style={{ marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? <span className="spinner spinner-sm" /> : 'Sign In'}
          </button>
        </form>

        <p className="login-footer">
          Need access? <a href="mailto:hr.guj@parastrucks.in">Contact HR</a>
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #0A1628 0%, #0D2844 50%, #0B4F7A 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
        }
        .login-card {
          background: var(--white);
          border-radius: var(--radius);
          padding: 36px 32px;
          width: 100%;
          max-width: 400px;
          box-shadow: var(--shadow-lg);
          animation: slideUp .25s ease;
        }
        .login-logo-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }
        .login-logo {
          height: 44px;
          width: auto;
        }
        .login-title {
          text-align: center;
          font-size: 22px;
          font-weight: 800;
          color: var(--gray-900);
          letter-spacing: -.5px;
          margin-bottom: 4px;
        }
        .login-subtitle {
          text-align: center;
          font-size: 14px;
          color: var(--gray-500);
          margin-bottom: 24px;
        }
        .login-footer {
          text-align: center;
          font-size: 13px;
          color: var(--gray-400);
          margin-top: 20px;
        }
        .login-footer a {
          color: var(--blue);
          font-weight: 600;
        }
        .login-footer a:hover { text-decoration: underline; }
      `}</style>
    </div>
  )
}
