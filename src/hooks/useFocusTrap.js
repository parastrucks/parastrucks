import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Traps Tab focus inside a container element while `active` is true.
 * Returns a ref to attach to the modal/dialog root element.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen, closeModal)
 *   <div ref={trapRef} className="modal"> ... </div>
 *
 * Also handles Escape key → calls `onEscape` if provided.
 *
 * NOTE on `onEscape`: we intentionally do NOT include it in the effect deps.
 * Callers routinely pass an inline function (e.g. `() => setConfirming(null)`)
 * or an unstable component-scoped function (e.g. `closeModal`), which changes
 * reference on every render. If we put it in the deps, the effect re-runs
 * every render → cleanup restores focus → body runs focusFirst → focus jumps
 * to the modal's first focusable element (usually the × close button) on
 * every keystroke inside a field. Classic data-loss + UX-break combo.
 *
 * Instead we keep `onEscape` in a ref and read from that inside the keydown
 * handler. Effect deps stay `[active]` — runs once per open/close, nothing
 * more.
 */
export default function useFocusTrap(active, onEscape) {
  const ref = useRef(null)

  // Latest-ref pattern — keeps the handler fresh without re-subscribing.
  const onEscapeRef = useRef(onEscape)
  useEffect(() => { onEscapeRef.current = onEscape }, [onEscape])

  useEffect(() => {
    if (!active || !ref.current) return

    const container = ref.current
    const previouslyFocused = document.activeElement

    // Focus the first focusable element (or the container itself)
    const focusFirst = () => {
      const first = container.querySelector(FOCUSABLE)
      if (first) first.focus()
      else container.focus()
    }
    // Small delay so the modal DOM is painted before we move focus
    requestAnimationFrame(focusFirst)

    function handleKeyDown(e) {
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.stopPropagation()
        onEscapeRef.current()
        return
      }

      if (e.key !== 'Tab') return

      const focusable = [...container.querySelectorAll(FOCUSABLE)]
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last  = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      // Restore focus to whatever was focused before the modal opened
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return ref
}
