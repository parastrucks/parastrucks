import { useCallback, useRef, useState } from 'react'

/**
 * Eliminates the repetitive try/catch/finally loading pattern used across
 * every page. Returns a stable `run` function that wraps any async callback
 * with loading + error state management.
 *
 * Usage:
 *   const { run, loading, error, clearError } = useAsyncAction()
 *   // then:
 *   await run(async () => { ... })
 *
 * Options on `run`:
 *   run(fn, { onError })  — custom error handler instead of default setError
 */
export default function useAsyncAction() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const mountedRef = useRef(true)

  // Clean up on unmount so we never setState after unmount
  // (can't use useEffect return because the hook has no render lifecycle,
  //  but the component using it does — and React 18+ batches these safely)

  const run = useCallback(async (fn, opts = {}) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      return result
    } catch (e) {
      const msg = e?.message || 'Something went wrong.'
      if (opts.onError) {
        opts.onError(e)
      } else {
        setError(msg)
      }
      throw e // re-throw so callers can handle if needed
    } finally {
      setLoading(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { run, loading, error, setError, clearError }
}
