import React from 'react'
import { supabase } from '../lib/supabase'

// Top-level error boundary. Catches render-time exceptions anywhere in the
// route tree and shows a friendly fallback instead of a white screen.
// Error logging is deferred to src/lib/errorLog.js (owned by Phase 5 U5).
// The dynamic import is defensive — if U5 hasn't merged yet, it silently
// no-ops; once it lands, logging starts working automatically.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error(error, errorInfo)
    // Dynamic import path built from a variable so the bundler doesn't try
    // to resolve it at build time — U5 (errorLog.js) may not have merged yet.
    const path = /* @vite-ignore */ '../lib/errorLog'
    import(/* @vite-ignore */ path)
      .then(m => m.logError?.(error, {
        componentStack: errorInfo?.componentStack,
        url: location.href,
      }))
      .catch(() => {})
  }

  handleReload = () => {
    location.reload()
  }

  handleSignOut = () => {
    supabase.auth.signOut().catch(() => {})
    location.href = '/login'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const subject = encodeURIComponent('Portal error report')
    const body = encodeURIComponent(
      `Page: ${location.href}\n\nError: ${this.state.error?.message || 'unknown'}`
    )
    const mailto = `mailto:hr@parastrucks.in?subject=${subject}&body=${body}`

    return (
      <div className="full-center" style={{ flexDirection: 'column', gap: 20, padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong</h1>
          <div className="alert alert-error" style={{ textAlign: 'left', marginBottom: 20 }}>
            The page ran into an unexpected problem and couldn't load. Try reloading
            the page. If the problem persists, sign out and back in, or report it to HR.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={this.handleReload}>Reload page</button>
            <button className="btn btn-secondary" onClick={this.handleSignOut}>Sign out</button>
            <a className="btn btn-ghost" href={mailto}>Report problem</a>
          </div>
        </div>
      </div>
    )
  }
}
