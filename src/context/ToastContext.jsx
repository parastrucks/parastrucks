import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

let nextId = 0

/**
 * Lightweight toast notification system. Renders a fixed stack in the
 * bottom-right corner. Toasts auto-dismiss after `duration` ms (default 4 s).
 *
 * Types: 'success' (green), 'error' (red), 'info' (blue)
 *
 * Usage:
 *   const toast = useToast()
 *   toast.success('Saved!')
 *   toast.error('Something went wrong')
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const remove = useCallback((id) => {
    clearTimeout(timersRef.current[id])
    delete timersRef.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((type, message, duration = 4000) => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, type, message }])
    timersRef.current[id] = setTimeout(() => remove(id), duration)
    return id
  }, [remove])

  const api = useRef(null)
  // Build the api object once (stable ref)
  if (!api.current) {
    api.current = {
      success: (msg, dur) => add('success', msg, dur),
      error:   (msg, dur) => add('error',   msg, dur ?? 6000),
      info:    (msg, dur) => add('info',     msg, dur),
    }
  }
  // Keep the add function current inside the stable api object
  api.current._add = add

  // Reassign on each render so closures stay fresh
  api.current.success = (msg, dur) => add('success', msg, dur)
  api.current.error   = (msg, dur) => add('error',   msg, dur ?? 6000)
  api.current.info    = (msg, dur) => add('info',     msg, dur)

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container" role="status" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <span className="toast__icon">
                {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
              </span>
              <span className="toast__message">{t.message}</span>
              <button
                className="toast__close"
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
