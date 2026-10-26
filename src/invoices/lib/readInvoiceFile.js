// Read an invoice PDF the user picked, in the browser, before anything is uploaded.
//
// pdfjs is heavy, so it loads only when someone opens a file (same single-flight worker
// setup as lib/coverGen.js — pdfjs-dist is excluded from optimizeDeps so the worker and
// the main import stay one version).
import { pdfToLines } from './pdfLines'
import { readSapInvoice } from './sapInvoice'

export const MAX_PDF_BYTES = 5 * 1024 * 1024

let _pdfjsPromise = null
function getPdfjs() {
  _pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
    return pdfjs
  })().catch((e) => { _pdfjsPromise = null; throw e })
  return _pdfjsPromise
}

/** → { reading } (reading.ok false carries the reason) and the bytes to upload. */
export async function readInvoiceFile(file) {
  if (file.size > MAX_PDF_BYTES) return { reading: { ok: false, reason: 'The file is larger than 5 MB.' } }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    return { reading: { ok: false, reason: 'This file is not a PDF. Upload the invoice PDF exported from SAP.' } }
  }
  const pdfjs = await getPdfjs()
  // pdfjs takes ownership of the buffer it is given — hand it a copy, keep ours to upload.
  const lines = await pdfToLines(pdfjs, bytes.slice())
  if (lines.tooLong) return { reading: { ok: false, reason: `This PDF has ${lines.tooLong} pages — too many for one invoice.` } }
  return { reading: readSapInvoice(lines), bytes }
}

export function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
