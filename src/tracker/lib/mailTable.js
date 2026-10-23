// Phase 10 — "Copy for mail": what is on screen (the rows the filter leaves × the columns not hidden) as a
// table that pastes into Outlook, Gmail or WhatsApp — HTML for mail, tab-separated text for everything
// else. Replaces Excel's filter → hide → copy → paste habit. Pure, tested by selftest-tracker-cells.mjs.
import { showValue } from './showValue.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isNumber = (col) => ['numeric', 'integer'].includes(col?.spec?.type)

// columns: grid columns in screen order; lines: [{ values: [raw per column], bgs: [hex or null per column] }]
export function mailTable(columns, lines) {
  const cell = 'border:1px solid #BFBFBF;padding:3px 6px;white-space:nowrap'
  const head = columns.map((c) => `<th style="${cell};background:#E5E7EB;font-weight:bold;text-align:left">${esc(c.label)}</th>`).join('')
  const body = lines.map(({ values, bgs }) => '<tr>' + columns.map((c, i) => {
    const bg = bgs?.[i] ? `;background:${bgs[i]}` : ''
    const align = isNumber(c) ? ';text-align:right' : ''
    return `<td style="${cell}${bg}${align}">${esc(showValue(c, values[i]))}</td>`
  }).join('') + '</tr>').join('')
  const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  // a tab or line break inside a value would split the cell when pasted
  const flat = (s) => String(s).replace(/[\t\r\n]+/g, ' ')
  const text = [columns.map((c) => flat(c.label)).join('\t'),
    ...lines.map(({ values }) => columns.map((c, i) => flat(showValue(c, values[i]))).join('\t'))].join('\r\n')
  return { html, text }
}

// Above this many cells, ask first: a mail with the whole book in it is rarely what was meant.
export const BIG_COPY = 20000
