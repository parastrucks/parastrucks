import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import App from './App'
import './index.css'

// Global error reporting via src/lib/errorLog.js, loaded lazily as its own chunk.
// The specifier MUST stay a literal so Vite bundles it. It used to be a variable
// under @vite-ignore, which in production fetched /lib/errorLog, received the
// SPA's index.html, and failed silently — no client error was ever recorded
// (error_log was empty on 2026-09-19, while a crash was live in Employees).
const reportError = (error, context) => {
  import('./lib/errorLog')
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
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
