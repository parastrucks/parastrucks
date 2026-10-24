// Credit release step 1 — turn a PDF's text layer into lines for sapInvoice.js.
//
// Takes the pdfjs module as an argument so the same code runs in the browser (the lazy
// worker build, as coverGen.js loads it) and in node for the self-test (the legacy build).
// A "line" is every text item whose baseline sits within 2 pt of another, left to right;
// lines run top to bottom. Measured on the real SAP invoices: labels and their values
// share a baseline exactly, and separate rows are ≥ 6 pt apart.

const Y_TOLERANCE = 2

export async function pdfToLines(pdfjs, data, { maxPages = 40 } = {}) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 })
  const doc = await task.promise
  try {
    const meta = await doc.getMetadata().catch(() => null)
    if (doc.numPages > maxPages) return { creator: meta?.info?.Creator ?? '', producer: meta?.info?.Producer ?? '', pages: [], tooLong: doc.numPages }
    const pages = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      pages.push(groupLines(tc.items))
      page.cleanup()
    }
    return { creator: meta?.info?.Creator ?? '', producer: meta?.info?.Producer ?? '', pages }
  } finally {
    await task.destroy()
  }
}

export function groupLines(items) {
  const rows = []
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    const y = it.transform[5], x = it.transform[4]
    let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE)
    if (!row) rows.push(row = { y, cells: [] })
    row.cells.push({ x, s: it.str })
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => ({ y: Math.round(r.y), items: r.cells.sort((a, b) => a.x - b.x).map((c) => c.s) }))
}
