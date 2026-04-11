import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Cloudflare Turnstile is loaded dynamically only when VITE_TURNSTILE_SITE_KEY
// is present. No site key → no script tag, no widget, no token — the whole
// CAPTCHA layer is inert. The verify-login EF mirrors this on the server via
// TURNSTILE_SECRET so the inert path is consistent end-to-end.
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY)

function useTurnstile(enabled, onToken) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    let script = document.querySelector(`script[src^="${SCRIPT_SRC}"]`)
    const ensureScript = () => new Promise((resolve) => {
      if (window.turnstile) return resolve()
      if (!script) {
        script = document.createElement('script')
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      const iv = setInterval(() => {
        if (window.turnstile) { clearInterval(iv); resolve() }
      }, 50)
      setTimeout(() => { clearInterval(iv); resolve() }, 10000)
    })

    ensureScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => onToken(token),
        'error-callback': () => onToken(''),
        'expired-callback': () => onToken(''),
        theme: 'light',
      })
    })

    return () => {
      cancelled = true
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* noop */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const reset = () => {
    if (widgetIdRef.current != null && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* noop */ }
    }
  }

  return { containerRef, reset }
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [failsRemaining, setFailsRemaining] = useState(null)
  const [lockedUntil, setLockedUntil] = useState(0) // epoch seconds
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [turnstileToken, setTurnstileToken] = useState('')

  const { containerRef: turnstileContainer, reset: resetTurnstile } =
    useTurnstile(TURNSTILE_ENABLED, setTurnstileToken)

  // Tick the clock once a second while a lockout countdown is active.
  useEffect(() => {
    if (lockedUntil <= 0) return
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  const locked = lockedUntil > now
  const remaining = Math.max(0, lockedUntil - now)
  const remainingMin = Math.floor(remaining / 60)
  const remainingSec = remaining % 60

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { setError('Please enter your email and password.'); return }
    if (locked) return
    setLoading(true)
    setError('')
    try {
      await signIn(email, password, { rememberMe, turnstileToken: turnstileToken || undefined })
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed.')
      if (err.code === 'locked') {
        setLockedUntil(Math.floor(Date.now() / 1000) + (err.retryAfter || 0))
        setFailsRemaining(0)
      } else if (err.code === 'invalid_credentials' && typeof err.failsRemaining === 'number') {
        setFailsRemaining(err.failsRemaining)
      }
      // Reset CAPTCHA token after any failure so the user has a fresh
      // challenge on the next attempt (Turnstile tokens are single-use).
      setTurnstileToken('')
      resetTurnstile()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo-wrap">
          <img src="/paras-logo.png" alt="Paras Trucks" className="login-logo" />
        </div>

        <h1 className="login-title">Team Portal</h1>
        <p className="login-subtitle">Sign in to continue</p>

        {error && (
          <div className="alert alert-error">
            <span>⚠</span>
            <span>
              {locked
                ? `Too many failed attempts. Try again in ${remainingMin}:${String(remainingSec).padStart(2,'0')}.`
                : error}
            </span>
          </div>
        )}

        {!locked && failsRemaining != null && failsRemaining > 0 && failsRemaining <= 2 && (
          <div className="alert alert-warn">
            <span>⚠</span>
            <span>{failsRemaining} attempt{failsRemaining === 1 ? '' : 's'} remaining before lockout.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className={`form-input ${error && !locked ? 'error' : ''}`}
              placeholder="e.g. ramesh@parastrucks.in"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              autoComplete="email"
              autoFocus
              disabled={locked || loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                className={`form-input ${error && !locked ? 'error' : ''}`}
                placeholder="Enter your password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoComplete="current-password"
                style={{ paddingRight: '44px' }}
                disabled={locked || loading}
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

          <div className="form-group remember-row">
            <label className="remember-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                disabled={locked || loading}
              />
              <span>Remember me on this device</span>
            </label>
          </div>

          {TURNSTILE_ENABLED && (
            <div className="form-group turnstile-wrap">
              <div ref={turnstileContainer} />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            style={{ marginTop: '8px' }}
            disabled={loading || locked}
          >
            {loading ? <span className="spinner spinner-sm" /> : (locked ? 'Locked' : 'Sign In')}
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
        .remember-row {
          margin-top: -4px;
        }
        .remember-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--gray-700, #374151);
          cursor: pointer;
          user-select: none;
        }
        .remember-label input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: var(--blue, #0B4F7A);
          cursor: pointer;
        }
        .turnstile-wrap {
          display: flex;
          justify-content: center;
          min-height: 65px;
        }
        .alert-warn {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          background: #FFF7E6;
          border: 1px solid #F5C16C;
          color: #7A4F00;
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 12px;
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
