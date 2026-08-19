import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
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

// ---------------------------------------------------------------------------
// SPIKE ONLY (Phase 10 grid decision). Mounted BEFORE AuthProvider on purpose:
// the staging Supabase project is hibernated, so auth can never resolve and the
// normal app sits on its loading gate forever. The spike needs no backend at
// all — its data is generated in the browser.
//
// `import.meta.env.DEV` is statically replaced at build time, so this whole
// branch is stripped from any production bundle and the route cannot exist on
// prod. Delete this block together with src/spike/ once the grid is chosen.
// ---------------------------------------------------------------------------
if (import.meta.env.DEV && window.location.pathname === '/grid-spike') {
  import('./spike/GridSpike').then(({ default: GridSpike }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <GridSpike />
      </React.StrictMode>
    )
  })
} else {
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
}
