// Phase 9.7c c2 — render a brochure's page 1 to a small webp cover.
//
// Everything here is behind a dynamic import(): pdfjs-dist is heavy (~350 KB)
// and ONLY admins ever generate covers, so it must never land in the employee
// bundle. Import this module lazily too (`await import('../lib/coverGen')`) so
// Rollup keeps it and pdfjs in a separate admin-only chunk.
//
// Two setup requirements, both learned the hard way:
//   1. pdfjs-dist is EXCLUDED from Vite optimizeDeps (vite.config.js) so the
//      main import and the ?worker build stay the same instance/version —
//      otherwise their API-version constants mismatch and render deadlocks.
//   2. pdfjs steps its canvas draw with requestAnimationFrame, which the
//      browser PAUSES in a hidden/backgrounded tab. A long backfill where the
//      admin switches tabs would stall forever. renderWithRafShim routes rAF
//      through setTimeout for the duration of the draw so it completes
//      regardless of tab visibility.

let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  _pdfjs = pdfjs
  return pdfjs
}

// Run a render task with rAF that fires even when the tab is hidden.
async function renderVisibilitySafe(page, canvasContext, viewport) {
  const orig = window.requestAnimationFrame
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0)
  try {
    await page.render({ canvasContext, viewport }).promise
  } finally {
    window.requestAnimationFrame = orig
  }
}

/**
 * @param arrayBuffer - the brochure PDF's bytes.
 * @returns a webp Blob of page 1 (~20–50 KB), or throws on a broken PDF.
 */
export async function generateCoverWebp(arrayBuffer, { maxWidth = 420, quality = 0.82 } = {}) {
  const pdfjs = await getPdfjs()
  // A copy: pdfjs transfers/detaches the buffer, and the caller may still need
  // the original (the upload flow uploads the same file).
  const pdf = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // Cap the long edge at maxWidth; never upscale past 2x (tiny source PDFs).
    const scale = Math.min(2, maxWidth / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    // White base — brochures assume paper; a transparent canvas would show the
    // page's own transparent regions as black in webp.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await renderVisibilitySafe(page, ctx, viewport)
    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('canvas.toBlob returned null'))), 'image/webp', quality))
    return blob
  } finally {
    pdf.destroy?.()
  }
}
