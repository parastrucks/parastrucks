// Phase 10 — the tracker's spreadsheet: Univer 1.1 (Apache-2.0, free presets only, exact versions).
//
// This component owns the engine and reports what changed; it never talks to the server. The page
// (TrackerPage) decides what to save, and tells the grid to put a cell back or show a new value.
//
// ROW IDENTITY: sorting moves whole rows, so "sheet row 12" is not a truck. Every row carries its
// database id in a HIDDEN, LOCKED last column; a change is tied to the id read from that row.
//
// Rules learned in the spike (docs/backlog/phase10-execution-plan.md → "Rules learned"):
//   * read with getRawValues(), NEVER getValue(s) — those return formatted text ("2,462,200");
//   * undo/redo arrive as mutations with no command around them; Ctrl+Z / Ctrl+Y says which, from a
//     window capture-phase listener registered BEFORE createUniver (Univer takes the keys first);
//   * fill blanks each target before writing — the page collapses each command (cellValues.collapse).
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createUniver, LocaleType, merge, CommandType } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import coreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import filterEnUS from '@univerjs/preset-sheets-filter/locales/en-US'
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort'
import sortEnUS from '@univerjs/preset-sheets-sort/locales/en-US'
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting'
import cfEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US'
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation'
import dvEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US'
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import frEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US'
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note'
import noteEnUS from '@univerjs/preset-sheets-note/locales/en-US'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import '@univerjs/preset-sheets-note/lib/index.css'
import { toCell } from '../lib/cellValues'

// Indian grouping (18,67,000), measured in Univer 2026-10-22. Formats allow two conditions only, so
// a figure of a crore or more shows as 150,00,000 — chosen over grouping negatives the Western way,
// since net refunds are routinely negative lakhs.
const MONEY = '[<=-100000]-##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0'
// Shown and typed day first. Typing 05/07/25 into a cell with this format gives 5 July (measured).
const DATE = 'dd/mm/yy'

function styleKey(col) {
  const kind = col.spec.type === 'date' ? 'date' : col.money ? 'money' : col.spec.type === 'text' ? 'text' : 'num'
  return col.editable ? kind : `${kind}L`
}

const STYLES = {
  hdr: { bl: 1, bg: { rgb: '#E5E7EB' }, tb: 3 },
  money: { n: { pattern: MONEY } }, moneyL: { n: { pattern: MONEY }, bg: { rgb: '#F3F4F6' } },
  date: { n: { pattern: DATE } }, dateL: { n: { pattern: DATE }, bg: { rgb: '#F3F4F6' } },
  text: { n: { pattern: '@' } }, textL: { n: { pattern: '@' }, bg: { rgb: '#F3F4F6' } },
  num: {}, numL: { bg: { rgb: '#F3F4F6' } },
}

function buildWorkbook(columns, rows) {
  const idCol = columns.length
  const header = {}
  columns.forEach((c, ci) => { header[ci] = { v: c.label, s: 'hdr' } })
  header[idCol] = { v: 'id', s: 'hdr' }
  const cellData = { 0: header }
  rows.forEach((row, ri) => {
    const line = {}
    columns.forEach((c, ci) => {
      const v = toCell(c.spec, row[c.key])
      line[ci] = v === null ? { s: styleKey(c) } : { v, s: styleKey(c) }
    })
    line[idCol] = { v: row.id }
    cellData[ri + 1] = line
  })
  const columnData = {}
  columns.forEach((c, ci) => { columnData[ci] = { w: c.width } })
  columnData[idCol] = { w: 40, hd: 1 }
  return {
    id: 'tracker', name: 'Vehicle Tracker', sheetOrder: ['book'], styles: STYLES,
    sheets: {
      book: {
        id: 'book', name: 'Book', rowCount: rows.length + 1, columnCount: columns.length + 1,
        cellData, columnData, defaultRowHeight: 22,
        freeze: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 },
      },
    },
  }
}

const TrackerGrid = forwardRef(function TrackerGrid({ columns, rows, onChanges, onRefused }, ref) {
  const box = useRef(null)
  const api = useRef(null)
  const reverting = useRef(false)
  const handlers = useRef({ onChanges, onRefused })
  handlers.current = { onChanges, onRefused }

  // The page puts values in (a refused cell back to what it was, recomputed figures after a save).
  useImperativeHandle(ref, () => ({
    // cells: [{ id, key, value }] — value as the database holds it
    setValues(cells) {
      const sheet = api.current?.getActiveWorkbook()?.getActiveSheet()
      if (!sheet) return
      const idCol = columns.length
      const n = sheet.getMaxRows()
      const ids = sheet.getRange(0, idCol, n, 1).getRawValues().map((r) => r[0])
      const rowOf = new Map(ids.map((id, i) => [id, i]))
      reverting.current = true
      try {
        for (const { id, key, value } of cells) {
          const r = rowOf.get(id)
          const c = columns.findIndex((col) => col.key === key)
          if (r === undefined || r < 1 || c < 0) continue
          sheet.getRange(r, c).setValue(toCell(columns[c].spec, value) ?? '')
        }
      } finally { reverting.current = false }
    },
    univerAPI: () => api.current,
  }), [columns])

  useEffect(() => {
    const keyHint = { what: null, at: 0 }
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) Object.assign(keyHint, { what: 'undo', at: performance.now() })
      else if (k === 'y' || (k === 'z' && e.shiftKey)) Object.assign(keyHint, { what: 'redo', at: performance.now() })
    }
    window.addEventListener('keydown', onKey, true) // BEFORE createUniver — see the header

    // Each mount gets its OWN element. React's development double-mount disposes the first engine
    // while the second is created; sharing one element left the second drawn at 0 × 0 (seen
    // 2026-10-22 — the spike only avoided it with ?strict=0).
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0'
    box.current.appendChild(host)

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: merge({}, coreEnUS, filterEnUS, sortEnUS, cfEnUS, dvEnUS, frEnUS, noteEnUS) },
      presets: [
        UniverSheetsCorePreset({ container: host }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset(),
        UniverSheetsFindReplacePreset(),
        UniverSheetsNotePreset(),
      ],
    })
    api.current = univerAPI
    univerAPI.createWorkbook(buildWorkbook(columns, rows))
    if (import.meta.env.DEV) window.__trackerUniver = univerAPI // dev only: lets checks be run from the console

    const idCol = columns.length
    let lastCmd = ''
    const subs = [
      univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (p) => {
        if (p?.type === CommandType.COMMAND) lastCmd = p.id
      }),
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, (p) => {
        if (p?.type === CommandType.COMMAND) lastCmd = ''
      }),
      // Duty 4, first half: refuse to open the editor on the header, the id column or a computed column.
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, (p) => {
        if (p.row === 0 || p.column >= idCol || !columns[p.column]?.editable) {
          p.cancel = true
          handlers.current.onRefused?.(p.row === 0 ? 'The header row is fixed.'
            : `“${columns[p.column]?.label ?? 'This column'}” is worked out by the tracker — it cannot be typed into.`)
        }
      }),
      univerAPI.addEvent(univerAPI.Event.SheetValueChanged, (p) => {
        if (reverting.current) return // our own put-back or refresh is not an edit
        const sheet = univerAPI.getActiveWorkbook().getActiveSheet()
        const cells = []
        for (const range of p.effectedRanges || []) {
          const r0 = range.getRow(), c0 = range.getColumn()
          const values = range.getRawValues() // ⚠️ raw, never getValues (formatted text)
          const formulas = typeof range.getFormulas === 'function' ? range.getFormulas() : null
          const ids = sheet.getRange(r0, idCol, values.length, 1).getRawValues()
          values.forEach((line, i) => line.forEach((value, j) => {
            cells.push({ row: r0 + i, col: c0 + j, id: ids[i]?.[0] ?? null, value,
              formula: formulas?.[i]?.[j] || null })
          }))
        }
        const hint = performance.now() - keyHint.at < 1000 ? keyHint.what : null
        const source = sourceOf(lastCmd) ?? hint ?? 'undo'
        handlers.current.onChanges?.(cells, source)
      }),
    ]

    return () => {
      window.removeEventListener('keydown', onKey, true)
      subs.forEach((s) => s?.dispose?.())
      univer.dispose()
      // removed after the engine's own React root has finished unmounting
      setTimeout(() => host.remove(), 0)
      api.current = null
      if (import.meta.env.DEV) delete window.__trackerUniver
    }
    // Mounted once per data load: after this the engine owns the sheet, and changes come FROM it.
  }, [columns, rows])

  return <div className="trk-grid" ref={box} />
})

// A user-level command names what the person did; no command = undo or redo (see the header).
function sourceOf(cmd) {
  if (!cmd) return null
  const c = cmd.toLowerCase()
  if (c.includes('undo')) return 'undo'
  if (c.includes('redo')) return 'redo'
  if (c.includes('paste')) return 'paste'
  if (c.includes('fill')) return 'fill'
  if (c.includes('clear') || c.includes('delete') || c.includes('remove')) return 'delete'
  return 'typed'
}

export default TrackerGrid
