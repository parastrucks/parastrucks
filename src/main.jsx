import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './index.css'

// Global error reporting — defer to src/lib/errorLog.js (owned by Phase 5 U5).
// The dynamic import is intentionally built from a variable so bundlers don't
// resolve it at build time. It silently no-ops until U5 merges and the module
// exists at runtime.
const errorLogPath = /* @vite-ignore */ './lib/errorLog'
const reportError = (error, context) => {
  import(/* @vite-ignore */ errorLogPath)
    .then(m => m.logError?.(error, context))
    .catch(() => {})
}
window.addEventListener('error', (e) => reportError(
  e.error ?? new Error(e.message),
  { kind: 'window.error', url: location.href, file: e.filename, line: e.lineno, col: e.colno },
))
window.addEventListener('unhandledrejection', (e) => reportError(
  e.reason instanceof Error ? e.reason : new Error(String(e.reason)),
  { kind: 'unhandledrejection', url: location.href },
))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
