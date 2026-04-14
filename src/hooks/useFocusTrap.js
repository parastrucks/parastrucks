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
 *   const trapRef = useFocusTrap(isOpen)
 *   <div ref={trapRef} className="modal"> ... </div>
 *
 * Also handles Escape key → calls `onEscape` if provided.
 */
export default function useFocusTrap(active, onEscape) {
  const ref = useRef(null)

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
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation()
        onEscape()
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
  }, [active, onEscape])

  return ref
}
