// src/lib/errorLog.js
// Fire-and-forget client-side error reporter.
//
// Wraps the `log-error` Edge Function (from Phase 5 PR 1) so any caller can
// report a caught exception without worrying about failure cascades — a
// logging failure here must never break the calling flow.
//
// Other units (e.g. the ErrorBoundary in U4) import this dynamically:
//   import('../lib/errorLog').then(m => m.logError?.(err, { component: 'X' }))
import { callEdge } from './api'
import { extensionOrigin, firstTodayFor } from './errorSource'

/**
 * Report an error to the server-side error_log table.
 * Always resolves — errors inside the logger are swallowed.
 *
 * @param {unknown} error   The thrown value (Error instance preferred).
 * @param {object}  context Arbitrary JSON-serialisable metadata.
 */
export async function logError(error, context = {}) {
  try {
    // A browser extension's own crash: once a day per extension, labelled,
    // and BEFORE callEdge so the flood never touches the session lock.
    const ext = extensionOrigin(error?.stack, context.file)
    if (ext) {
      if (!firstTodayFor(ext)) return
      context = { ...context, source: 'extension', extension: ext }
    }
    await callEdge('log-error', 'write', {
      message: error?.message ?? String(error),
      stack:   error?.stack,
      url:     context.url ?? (typeof location !== 'undefined' ? location.href : ''),
      context,
    })
  } catch {
    // Never let a logging failure cascade.
  }
}
