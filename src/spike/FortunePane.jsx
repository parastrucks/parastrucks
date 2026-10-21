// SPIKE ONLY — FortuneSheet 1.0.4 (MIT).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Workbook } from '@fortune-sheet/react'
import '@fortune-sheet/react/dist/index.css'
import { COLUMNS } from './trackerData'
import { LOCKED, diffAgainst, useCaptureLog, CaptureBar } from './engineShared'

const us = new Intl.NumberFormat('en-US') // matches the '#,##0' cell format; lakh grouping is a build detail

// Row 0 is the header; data row r is rows[r - 1]. Locked (computed) columns get a grey fill.
function buildSheet(rows) {
  const celldata = []
  COLUMNS.forEach((c, ci) => {
    const name = c.computed ? `${c.name} · locked` : c.name
    celldata.push({ r: 0, c: ci, v: { v: name, m: name, bl: 1, bg: '#ECECEC' } })
  })
  rows.forEach((r, ri) => COLUMNS.forEach((c, ci) => {
    const v = r[c.key]
    if (v === '' || v == null) return
    const grey = c.computed ? { bg: '#F6F6F6' } : {}
    celldata.push({
      r: ri + 1, c: ci,
      v: c.money
        ? { v: Number(v) || 0, m: us.format(Number(v) || 0), ct: { fa: '#,##0', t: 'n' }, ...grey }
        : { v: String(v), m: String(v), ct: { fa: 'General', t: 'g' }, ...grey },
    })
  }))
  const columnlen = {}
  COLUMNS.forEach((c, ci) => { columnlen[ci] = c.width })
  return [{
    name: 'Book', id: 'book', order: 0, row: rows.length + 1, column: COLUMNS.length,
    celldata, config: { columnlen },
    frozen: { type: 'rangeBoth', range: { row_focus: 0, column_focus: 2 } },
  }]
}

// An op that touched a cell's VALUE → { r, c, value }. Formatting-only ops (bold, colour…) are ignored.
function cellFromOp(op) {
  const p = op.path || []
  if (p[0] !== 'data' || typeof p[1] !== 'number' || typeof p[2] !== 'number') return null
  if (p.length === 3) return { r: p[1], c: p[2], value: op.op === 'remove' ? '' : (op.value?.v ?? '') }
  if (p.length === 4 && p[3] === 'v') return { r: p[1], c: p[2], value: op.op === 'remove' ? '' : op.value }
  return null
}

export default function FortunePane({ rows, syncValues, note }) {
  const ref = useRef(null)
  const host = useRef(null)
  const { log, record, blocked } = useCaptureLog()
  const [ready, setReady] = useState(null)
  const [hookHits, setHookHits] = useState(0) // afterUpdateCell: which actions does Fortune's own hook see?
  const t0 = useRef(performance.now())
  const shadow = useRef(null)
  if (!shadow.current) shadow.current = rows.map(r => ({ ...r })) // the "before" values (the DB, in the real build)
  const data = useMemo(() => buildSheet(rows), []) // deliberately mounted once (see comment above)
  const next = useRef(null)       // what the person just did, set by the paste hook / undo keys
  const reverting = useRef(false) // let our own put-back of a locked cell through our own lock

  useEffect(() => {
    window.__fortune = ref.current // spike only: lets the timings be taken from the console
    // Timed to the end of mount work, not the next frame (frames can be throttled — see UniverPane).
    setReady(Math.round(performance.now() - t0.current))
    return () => { delete window.__fortune }
  }, [])

  // Undo / redo keys tell us what the next batch of changes is. Fortune does its own undo.
  const onKeyDownCapture = e => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) next.current = 'undo'
    else if (k === 'y' || (k === 'z' && e.shiftKey)) next.current = 'redo'
  }

  const hooks = useMemo(() => ({
    // the lock: refuse edits to the header and the computed money columns
    beforeUpdateCell: (r, c) => {
      if (reverting.current) return true
      if (r === 0 || LOCKED.has(c)) { note('FortuneSheet: that column is locked (computed money)'); return false }
      return true
    },
    afterUpdateCell: () => setHookHits(h => h + 1),
    // refuse a paste whose block would land on a locked column (Fortune pastes rightward from the anchor)
    beforePaste: (selection, content) => {
      const s = selection?.[0]
      if (!s) return true
      const width = (content || '').replace(/\r/g, '').split('\n')[0].split('\t').length
      for (let c = s.column[0]; c < s.column[0] + Math.max(width, s.column[1] - s.column[0] + 1); c++) {
        if (LOCKED.has(c)) { note('FortuneSheet: paste refused — it would overwrite a locked column'); return false }
      }
      next.current = 'paste'
      return true
    },
  }), [note])

  // Capture: every op that changed a cell value, whatever caused it.
  const onOp = ops => {
    const cells = ops.map(cellFromOp).filter(Boolean)
    if (!cells.length) return
    const { changes, reverts } = diffAgainst(shadow.current, cells)
    // Fortune names no commands, so the source is inferred and labelled as such on screen:
    // paste hook / undo keys when set; otherwise one cell = typed, many = fill or delete.
    const source = next.current ?? (changes.length > 1 ? (changes.every(ch => ch.after === '') ? 'delete' : 'fill') : (changes[0]?.after === '' ? 'delete' : 'typed'))
    next.current = null
    if (changes.length) { record(changes, source); syncValues(changes); note(`FortuneSheet: ${changes.length} cell${changes.length > 1 ? 's' : ''} changed (${source})`) }
    if (reverts.length) { // a route past the lock (e.g. fill) — put the money back
      blocked(reverts.length)
      setTimeout(() => {
        reverting.current = true
        try { reverts.forEach(({ r, c, before }) => ref.current?.setCellValue(r, c, before ?? '')) } finally { reverting.current = false }
      }, 0)
    }
  }

  return (
    <>
      <div className="spk-bar">
        <span className="spk-ms">FortuneSheet ready in: <b>{ready === null ? '…' : ready + ' ms'}</b></span>
        <span className="spk-tag">canvas · MIT</span>
        <span className="spk-ok">its own undo, toolbar, formatting, filter, search, comments, dropdowns</span>
        <span className="spk-ms">Fortune&apos;s own edit hook fired: <b>{hookHits}</b>×</span>
      </div>
      <CaptureBar log={log} label="FortuneSheet" extra={<span className="cap-note">source inferred (Fortune names no commands)</span>} />
      <div className="fill-grid engine-host" ref={host} onKeyDownCapture={onKeyDownCapture}>
        <Workbook ref={ref} data={data} onOp={onOp} hooks={hooks} lang="en" showSheetTabs={false} />
      </div>
    </>
  )
}
