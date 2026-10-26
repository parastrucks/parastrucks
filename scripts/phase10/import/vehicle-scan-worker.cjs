// Phase 10 — one worker of vehicle-scan.cjs: reads ONE file's text and returns every chassis-shaped token in it.
// Spreadsheets: every cell (not only a "Chassis" column); PDFs: the text layer (a scanned page with no text layer
// yields nothing — reported as such); Word .docx: the document text; .doc/.txt/.csv/.eml/.msg/.rtf: the raw bytes
// as text. Read-only. Run as a child of vehicle-scan.cjs (one message in, one out).
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

let pdfjs = null
async function pdfText(p) {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(p)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    // one text piece per line, so a spaced-out "M B 1 …" is joined up within its own piece only
    parts.push((await page.getTextContent()).items.map((it) => it.str).join('\n'))
    page.cleanup()
  }
  await doc.destroy()
  return parts.join('\n')
}

function sheetText(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellFormula: false, cellHTML: false })
  const parts = []
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n]
    for (const k in ws) if (k[0] !== '!' && ws[k].v != null && ws[k].t !== 'e') parts.push(String(ws[k].v))
  }
  return parts.join('\n')
}

function docxText(p) {
  const cfb = XLSX.CFB.read(fs.readFileSync(p), { type: 'buffer' })
  const parts = []
  cfb.FileIndex.forEach((e, i) => {
    if (/word\/(document|header\d*|footer\d*)\.xml$/i.test(cfb.FullPaths[i]) && e.content) parts.push(Buffer.from(e.content).toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
  })
  return parts.join('\n')
}

const SHEET = /\.(xlsx|xlsm|xlsb|xls|ods)$/i, RAW = /\.(csv|txt|doc|rtf|eml|msg|htm|html|xml)$/i
async function textOf(p) {
  if (SHEET.test(p)) return { how: 'spreadsheet', text: sheetText(p) }
  if (/\.pdf$/i.test(p)) return { how: 'pdf', text: await pdfText(p) }
  if (/\.docx$/i.test(p)) return { how: 'docx', text: docxText(p) }
  if (RAW.test(p)) { const b = fs.readFileSync(p); return { how: 'raw', text: b.toString('latin1') + '\n' + b.toString('utf16le') } }
  return { how: 'not read', text: '' }
}

// tokens: runs of letters/digits; a chassis is matched on its own and, for PDFs that space letters out, with the
// spaces inside a line removed
function chassisIn(text, re) {
  const found = new Set()
  const up = text.toUpperCase()
  for (const m of up.matchAll(re)) found.add(m[0])
  for (const line of up.split('\n')) if (line.length < 4000) for (const m of line.replace(/[ \t]+/g, '').matchAll(re)) found.add(m[0])
  return found
}

module.exports = { textOf, chassisIn }

if (require.main === module) {
  // the PDF reader can throw after a file is done (a font or worker clean-up); that must not end this worker
  process.on('uncaughtException', () => {})
  process.on('unhandledRejection', () => {})
  process.on('message', async ({ p, re }) => {
    try {
      const { how, text } = await textOf(p)
      process.send({ how, hasText: text.trim().length > 0, chassis: [...chassisIn(text, new RegExp(re, 'g'))] })
    } catch (e) { process.send({ how: 'error', error: String(e.message).slice(0, 120) }) }
  })
}
