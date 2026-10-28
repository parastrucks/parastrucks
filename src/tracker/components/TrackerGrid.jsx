// Phase 10 — the tracker's spreadsheet: Univer 1.1 (Apache-2.0, free presets only, exact versions).
//
// This component owns the engine and reports what changed; it never talks to the server. The page
// (TrackerPage) decides what to save, and tells the grid to put a cell back or show a new value.
//
// ROW IDENTITY: sorting moves whole rows, so "sheet row 12" is not a truck. Every row carries its
// database id in a HIDDEN, LOCKED last column. The grid keeps its own row → id list (read at load
// and after every sort) and ties each change to it — so a paste that reaches the id column cannot
// detach a row from its truck; the id is simply written back.
//
// Rules learned in the spike (docs/backlog/phase10-execution-plan.md → "Rules learned"):
//   * read with getRawValues(), NEVER getValue(s) — those return formatted text ("2,462,200");
//   * undo/redo arrive as mutations with no command around them; Ctrl+Z / Ctrl+Y says which, from a
//     window capture-phase listener registered BEFORE createUniver (Univer takes the keys first);
//   * fill blanks each target before writing — savePlan judges each cell's LAST value.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createUniver, LocaleType, merge, CommandType } from '@univerjs/presets'
import { UniverSheetsCorePreset, TriggerCalculationController } from '@univerjs/preset-sheets-core'
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
import { STYLES, styleKey, styleWith, formatOf, lostNumberFormat, pastedFormat, baseStyle, paidRule, isPaid, PAID_GREEN } from '../lib/cellFormats'

// Column styles (lakh money, dd/mm/yy dates, locked grey), the "paid" green rule and the person's
// own formatting on top: lib/cellFormats.js.

// Empty rows kept below the book, as in Excel: a new truck is typed (or a block of them pasted)
// straight into them. The page asks for more before they run out (ensureSpare). At least the
// largest paste a save can take, so a full paste never runs off the end of the sheet.
// the workbook's id: every lookup names it (Univer's 'active workbook' can be another one)
const BOOK_ID = 'tracker'
const SPARE = 250

// an empty row that already carries each column's format, so a typed 05/07/25 is a date and a
// pasted 12,34,567 lands in a lakh-formatted cell
const blankLine = (columns) => Object.fromEntries(columns.map((c, ci) => [ci, { s: styleKey(c) }]))

// The "paid" rule reaches past the spare rows so rows added later (ensureSpare) are covered too.
const paidFor = (columns, rows) => paidRule(columns, rows.length + SPARE + 5000)

// formats: Map "unitId|column" → the person's saved formatting for that cell
function buildWorkbook(columns, rows, formats) {
  const idCol = columns.length
  const header = {}
  columns.forEach((c, ci) => { header[ci] = { v: c.label, s: 'hdr' } })
  header[idCol] = { v: 'id', s: 'hdr' }
  const cellData = { 0: header }
  rows.forEach((row, ri) => {
    const line = {}
    columns.forEach((c, ci) => {
      const v = toCell(c.spec, row[c.key])
      const s = styleWith(c, formats.get(`${row.id}|${c.key}`))
      line[ci] = v === null ? { s } : { v, s }
    })
    line[idCol] = { v: row.id }
    cellData[ri + 1] = line
  })
  for (let i = 0; i < SPARE; i++) cellData[rows.length + 1 + i] = blankLine(columns)
  const columnData = {}
  columns.forEach((c, ci) => { columnData[ci] = { w: c.width } })
  columnData[idCol] = { w: 40, hd: 1 }
  // The "paid" rule ships in the workbook's own data (as Univer saves rules), so it is part of the
  // book from the start — not a command the person could Ctrl+Z away.
  const paid = paidFor(columns, rows)
  return {
    id: BOOK_ID, name: 'Vehicle Tracker', sheetOrder: ['book'], styles: STYLES,
    resources: paid ? [{ name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data: JSON.stringify({ book: [paid] }) }] : [],
    sheets: {
      book: {
        id: 'book', name: 'Book', rowCount: rows.length + 1 + SPARE, columnCount: columns.length + 1,
        cellData, columnData, defaultRowHeight: 22,
        freeze: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 },
      },
    },
  }
}

// Commands that would add, remove or move rows/columns, or merge cells. Each row is one truck and
// is tied to it by the id column, so the book's shape is the database's, not the sheet's.
const BLOCKED = ['insert-row', 'insert-col', 'remove-row', 'remove-col', 'delete-range-move', 'insert-range-move',
  'move-rows', 'move-cols', 'move-range', 'add-worksheet-merge', 'insert-sheet', 'remove-sheet', 'copy-sheet']
const isBlocked = (id) => BLOCKED.some((b) => id.includes(b))

// NOTES. Univer keeps a note at a sheet POSITION: sorting moves the truck and leaves its note behind
// (measured 2026-10-22 — a note stayed on row 2055 while its truck went to row 3). So the grid keeps
// its own "unitId|column" → text map and draws every note at its truck's current row, after the
// load and after every sort. A person's edit updates the map and is reported to the page.
// formats / notes: Maps "unitId|column" → saved formatting / note text (read once, at mount)
const TrackerGrid = forwardRef(function TrackerGrid({ columns, rows, formats, notes, onChanges, onFormats, onNote, onRefused }, ref) {
  const box = useRef(null)
  const api = useRef(null)
  const writeRef = useRef(null)
  const engine = useRef(null) // { sheet, firstSpare, ensureSpare, drawNotes } while mounted
  const rowIds = useRef([]) // sheet row → unit id (index 0 = header)
  const noteText = useRef(new Map()) // "unitId|column" → the note shown
  const handlers = useRef({ onChanges, onFormats, onNote, onRefused })
  handlers.current = { onChanges, onFormats, onNote, onRefused }

  // The page puts values in: a refused cell back to what it was, a converted value, the recomputed
  // figures after a save. Written as a MUTATION, so it never lands on the person's undo stack —
  // otherwise Ctrl+Z would undo our put-back and replay what was refused.
  useImperativeHandle(ref, () => ({
    // cells: [{ id, key, value }] — value as the database holds it
    setValues(cells) {
      const rowOf = new Map(rowIds.current.map((id, i) => [id, i]))
      const colOf = new Map(columns.map((c, i) => [c.key, i]))
      const out = []
      for (const { id, key, value } of cells) {
        const r = rowOf.get(id), c = colOf.get(key)
        if (r === undefined || r < 1 || c === undefined) continue
        // the value only: a cell's style stays as it is (a value-only write keeps it — measured), so
        // a put-back never wipes someone's yellow
        out.push({ r, c, v: toCell(columns[c].spec, value) })
      }
      writeRef.current?.(out)
    },
    // NEW ROWS. A spare row gets a temporary id ("new:…") the moment its chassis is accepted, so the
    // edits that follow are tied to it while the server creates it; retag swaps in the real id.
    tagRows(tags) { // [{ r, id }]
      const idCol = columns.length
      for (const { r, id } of tags) rowIds.current[r] = id
      writeRef.current?.(tags.map(({ r, id }) => ({ r, c: idCol, v: id })))
      // a new row's look (a pasted yellow row) was not reported while it had no truck: report it now
      const styleAt = engine.current?.styleAt
      if (!styleAt) return
      const looked = []
      for (const { r, id } of tags) columns.forEach((col, c) => {
        const format = formatOf(col, styleAt(r, c))
        if (Object.keys(format).length) looked.push({ id, key: col.key, format })
      })
      if (looked.length) handlers.current.onFormats?.(looked)
    },
    retag(oldId, newId) {
      const r = rowIds.current.indexOf(oldId)
      if (r < 1) return
      rowIds.current[r] = newId
      writeRef.current?.([{ r, c: columns.length, v: newId }])
      for (const [k, text] of [...noteText.current]) {
        if (k.startsWith(`${oldId}|`)) { noteText.current.delete(k); noteText.current.set(`${newId}|${k.slice(oldId.length + 1)}`, text) }
      }
    },
    // cells in spare rows, by sheet row: [{ r, key }] → emptied, the column's format kept
    clearAt(cells) {
      const colOf = new Map(columns.map((c, i) => [c.key, i]))
      writeRef.current?.(cells.filter((x) => colOf.has(x.key))
        .map(({ r, key }) => ({ r, c: colOf.get(key), v: null, s: styleKey(columns[colOf.get(key)]) })))
    },
    // a new row the server did not create: emptied and made spare again
    clearRow(id) {
      const r = rowIds.current.indexOf(id)
      if (r < 1) return
      rowIds.current[r] = null
      const out = columns.map((c, ci) => ({ r, c: ci, v: null, s: styleKey(c) }))
      out.push({ r, c: columns.length, v: null })
      writeRef.current?.(out)
      for (const k of [...noteText.current.keys()]) if (k.startsWith(`${id}|`)) noteText.current.delete(k)
      engine.current?.drawNotes()
    },
    // "New vehicle": the chassis cell of the first empty row, scrolled into view and selected
    newVehicle() {
      const e = engine.current
      if (!e) return
      const r = e.firstSpare()
      if (r < 1) return
      e.sheet().getRange(r, 0).activate()
      e.sheet().scrollToCell(Math.max(1, r - 5), 0)
      // open the cell's editor: it takes the keyboard from the button, so typing goes straight in
      // (measured: without it, the keys stayed on the button and nothing reached the grid)
      setTimeout(() => api.current?.getWorkbook(BOOK_ID)?.startEditing(), 0)
    },
    // keep at least SPARE empty rows below the book (after creates have used some)
    ensureSpare() { engine.current?.ensureSpare() },
    // more trucks after the grid has drawn — rows [{ id, …columns }], formats / notes Maps "unitId|column" → …
    appendRows(list, fmts, nts) { return list.length ? engine.current?.appendRows(list, fmts, nts) ?? -1 : -1 },

    // ── LAYOUTS: a layout is the columns left showing. People hide columns as in Excel (right-click →
    // Hide); a layout saves what is showing and brings it back. Shown/hidden as MUTATIONS, so choosing a
    // layout is not something Ctrl+Z undoes. The chassis column always shows (it is frozen, and it is
    // how a row is recognised).
    shownKeys() {
      const s = engine.current?.sheet()?.getSheet()
      return s ? columns.filter((c, i) => s.getColVisible(i)).map((c) => c.key) : []
    },
    showOnly(keys) { // keys: the columns to show; null = every column
      const e = engine.current
      if (!e) return
      const want = keys ? new Set([...keys, 'chassis_no']) : null
      const show = [], hide = []
      columns.forEach((c, i) => (want === null || want.has(c.key) ? show : hide).push(i))
      e.setColumnsShown(show, true)
      e.setColumnsShown(hide, false)
    },

    // ── FIND: select a truck's cell and bring it into view. 'hidden' when the person's own filter hides
    // the row (it is not taken off their filter for them).
    goTo(id, key) {
      const e = engine.current
      if (!e) return 'gone'
      const r = rowIds.current.indexOf(id)
      if (r < 1) return 'gone'
      if (!e.sheet().getSheet().getRowVisible(r)) return 'hidden'
      let c = columns.findIndex((col) => col.key === key)
      if (c < 0 || !e.sheet().getSheet().getColVisible(c)) c = 0
      e.sheet().getRange(r, c).activate()
      // Just after a year is loaded the engine has drawn but its scrolling is not set up yet: scrollToCell
      // threw "SheetsScrollRenderController not found" (seen 2026-10-25, Find / AL sheet → another year).
      // The cell is already selected; the scroll is tried again for up to ~3 s.
      const scroll = (left) => {
        if (engine.current !== e) return // the grid was rebuilt meanwhile
        try { e.sheet().scrollToCell(Math.max(1, r - 3), c) } catch { if (left > 0) setTimeout(() => scroll(left - 1), 300) }
      }
      scroll(10)
      return 'ok'
    },

    // ── HISTORY: the truck and column of the selected cell (null on the header or an empty row)
    activeCell() {
      const range = api.current?.getWorkbook(BOOK_ID)?.getActiveRange()
      if (!range) return null
      const r = range.getRow(), c = range.getColumn()
      const id = rowIds.current[r]
      if (r < 1 || !id || String(id).startsWith('new:') || c >= columns.length) return null
      return { id, key: columns[c].key }
    },

    // ── COPY FOR MAIL: what is on screen — the rows the filter leaves (trucks only, not the spare rows)
    // × the columns not hidden, with each cell's own fill (the person's colour, or the paid green).
    onScreen() {
      const e = engine.current
      if (!e) return null
      const s = e.sheet().getSheet()
      const cols = columns.map((c, i) => i).filter((i) => s.getColVisible(i))
      const raw = e.sheet().getRange(0, 0, rowIds.current.length, columns.length).getRawValues()
      const lines = []
      for (let r = 1; r < rowIds.current.length; r++) {
        if (!rowIds.current[r] || !s.getRowVisible(r)) continue
        lines.push({
          values: cols.map((i) => raw[r][i]),
          bgs: cols.map((i) => {
            const col = columns[i]
            if (col.key === 'al_payment_status' && isPaid(raw[r][i])) return PAID_GREEN
            return formatOf(col, e.styleAt(r, i)).bg?.rgb ?? null
          }),
        })
      }
      return { columns: cols.map((i) => columns[i]), lines }
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
    const workbook = univerAPI.createWorkbook(buildWorkbook(columns, rows, formats))
    // Univer's events are the whole engine's, not one workbook's: answer only our own (a second workbook in
    // the same engine fired this sheet's save path with its own cells — seen in a test, 2026-10-24)
    const ourId = workbook.getId()
    // (a sheet event names its workbook; a command names it in params; SheetValueChanged in payload.params)
    const mine = (p) => (p?.workbook?.getId?.() ?? p?.payload?.params?.unitId ?? p?.params?.unitId ?? ourId) === ourId
    const ourRanges = (p) => (p.effectedRanges || []).filter((range) => (range.getUnitId?.() ?? ourId) === ourId)
    if (import.meta.env.DEV) window.__trackerUniver = univerAPI // dev only: lets checks be run from the console

    const idCol = columns.length
    const sheet = () => univerAPI.getWorkbook(ourId).getActiveSheet()   // our own book, not "the active one"
    const readIds = () => {
      if (!univerAPI.getWorkbook(ourId)) return // a timer that outlived the grid
      rowIds.current = sheet().getRange(0, idCol, sheet().getMaxRows(), 1).getRawValues().map((r) => r[0])
    }
    readIds()

    let reverting = false
    // cells: [{ r, c, v?, s? }] — straight into the sheet, not through the undo stack. A cell given
    // only `s` keeps its value (restyle); one given `v` gets that value.
    const write = (cells) => {
      if (!cells.length) return
      const cellValue = {}
      for (const cell of cells) {
        const out = {}
        if ('v' in cell) out.v = cell.v ?? null
        if (cell.s) out.s = cell.s
        ;(cellValue[cell.r] ??= {})[cell.c] = out
      }
      reverting = true
      try {
        univerAPI.syncExecuteCommand('sheet.mutation.set-range-values', {
          unitId: workbook.getId(), subUnitId: sheet().getSheetId(), cellValue,
        })
      } finally { reverting = false }
    }
    writeRef.current = write

    // Notes are drawn as silent MUTATIONS (off the undo stack, no note events), at each truck's
    // current row. Called at load and after every sort — see "NOTES" above the component.
    let drawingNotes = false
    const noteMutation = (id, args) => univerAPI.syncExecuteCommand(id, { unitId: workbook.getId(), sheetId: sheet().getSheetId(), silent: true, ...args })
    const drawNotes = () => {
      if (!univerAPI.getWorkbook(ourId)) return
      drawingNotes = true
      try {
        for (const n of sheet().getNotes()) noteMutation('sheet.mutation.remove-note', { row: n.row, col: n.col })
        const rowOf = new Map(rowIds.current.map((id, i) => [id, i]))
        const colOf = new Map(columns.map((c, i) => [c.key, i]))
        for (const [k, text] of noteText.current) {
          const bar = k.indexOf('|')
          const r = rowOf.get(k.slice(0, bar)), c = colOf.get(k.slice(bar + 1))
          if (r === undefined || r < 1 || c === undefined) continue
          noteMutation('sheet.mutation.update-note', {
            row: r, col: c, note: { id: `n-${r}-${c}`, row: r, col: c, width: 220, height: 90, note: text },
          })
        }
      } finally { drawingNotes = false }
    }
    noteText.current = new Map(notes)
    drawNotes()

    // A SORT, made fast (measured 2026-10-25, 3,688 trucks × 98 columns): Univer moves every rule range and
    // every note row by row through the sort's order — the paid rule alone cost 6–19 s (its column range is
    // cut against each sorted row), 3,000 notes another ~18 s. Neither needs moving: the rule covers the
    // whole column whatever the order, and the notes are redrawn on their trucks after every sort anyway.
    // So both are taken off, silently (off the undo stack), just before the sort and put back after it.
    // Undo/redo replay the reorder mutation only, so they never take the slow path. The restore also runs
    // on a timer, in case the sort is refused and never reports done.
    const paid = paidFor(columns, rows)
    const cfIds = () => ({ unitId: workbook.getId(), subUnitId: sheet().getSheetId() })
    let sortPrepared = false
    const finishSort = () => {
      if (!sortPrepared || !univerAPI.getWorkbook(ourId)) return
      sortPrepared = false
      if (paid) univerAPI.syncExecuteCommand('sheet.mutation.add-conditional-rule', { ...cfIds(), rule: paid })
      readIds()
      drawNotes()
    }
    const prepareSort = () => {
      sortPrepared = true
      drawingNotes = true
      try { for (const n of sheet().getNotes()) noteMutation('sheet.mutation.remove-note', { row: n.row, col: n.col }) }
      finally { drawingNotes = false }
      if (paid) univerAPI.syncExecuteCommand('sheet.mutation.delete-conditional-rule', { ...cfIds(), cfId: paid.cfId })
      setTimeout(finishSort, 0)
    }

    // A cell's STORED style. ⚠️ Never getCellStyleData()/getCellData() for this: conditional formatting
    // hooks into those reads, so a paid truck's AL Payment Status reads green as if someone had painted
    // it — and would be saved as their colour (measured 2026-10-23). The raw cell has only what is stored.
    const styleAt = (r, c) => workbook.getWorkbook().getStyles().getStyleByCell(sheet().getSheet().getCellRaw(r, c)) ?? {}

    const isSpare = (r) => !rowIds.current[r]
    // columns shown or hidden as one mutation each way (contiguous runs → ranges)
    const setColumnsShown = (cols, shown) => {
      if (!cols.length) return
      const ranges = []
      for (const c of [...cols].sort((a, b) => a - b)) {
        const last = ranges[ranges.length - 1]
        if (last && last.endColumn === c - 1) last.endColumn = c
        else ranges.push({ startRow: 0, endRow: sheet().getMaxRows() - 1, startColumn: c, endColumn: c })
      }
      univerAPI.syncExecuteCommand(shown ? 'sheet.mutation.set-col-visible' : 'sheet.mutation.set-col-hidden',
        { unitId: workbook.getId(), subUnitId: sheet().getSheetId(), ranges })
    }

    engine.current = {
      sheet,
      styleAt,
      drawNotes,
      setColumnsShown,
      firstSpare: () => {
        for (let r = 1; r < rowIds.current.length; r++) if (isSpare(r)) return r
        return -1
      },
      ensureSpare: () => {
        let spare = 0
        for (let r = 1; r < rowIds.current.length; r++) if (isSpare(r)) spare++
        if (spare >= SPARE) return
        const from = sheet().getMaxRows()
        const more = SPARE - spare
        // a mutation, like every write of ours: growing the sheet is not something Ctrl+Z undoes
        univerAPI.syncExecuteCommand('sheet.mutation.set-worksheet-row-count', {
          unitId: workbook.getId(), subUnitId: sheet().getSheetId(), rowCount: from + more,
        })
        const line = blankLine(columns)
        const cells = []
        for (let r = from; r < from + more; r++) for (const c of Object.keys(line)) cells.push({ r, c: Number(c), s: line[c].s })
        write(cells)
        readIds()
      },
      // MORE TRUCKS after the grid has drawn (owner, 2026-10-28: "load this year first, rest in background").
      // Written below the last truck AND below anything typed under it (a row still being typed is never
      // written over), as mutations — off the undo stack, like every write of ours. Their notes are drawn
      // the same way; spare rows are topped up after. Returns the sheet row of the first one.
      appendRows: (list, fmts, nts) => {
        readIds()
        const cols = columns.length
        let used = 0
        for (let r = 1; r < rowIds.current.length; r++) if (rowIds.current[r]) used = r
        const max = sheet().getMaxRows()
        if (max > used + 1) {
          const raw = sheet().getRange(used + 1, 0, max - used - 1, cols).getRawValues()
          // an empty cell that only carries its column's look reads back undefined, not null (measured 2026-10-28:
          // the first version took the 250 spare rows for typed ones and put the trucks below them)
          for (let i = raw.length - 1; i >= 0; i--) if (raw[i].some((v) => v != null && v !== '')) { used += i + 1; break }
        }
        const start = used + 1
        if (start + list.length > max) {
          univerAPI.syncExecuteCommand('sheet.mutation.set-worksheet-row-count', {
            unitId: workbook.getId(), subUnitId: sheet().getSheetId(), rowCount: start + list.length,
          })
        }
        const cells = []
        list.forEach((row, i) => {
          const r = start + i
          columns.forEach((c, ci) => {
            const v = toCell(c.spec, row[c.key])
            const s = styleWith(c, fmts.get(`${row.id}|${c.key}`))
            cells.push(v === null ? { r, c: ci, v: null, s } : { r, c: ci, v, s })
          })
          cells.push({ r, c: cols, v: row.id })
        })
        write(cells)
        readIds()
        drawingNotes = true
        try {
          const colOf = new Map(columns.map((c, i) => [c.key, i]))
          const rowOf = new Map(list.map((row, i) => [row.id, start + i]))
          for (const [k, text] of nts) {
            const bar = k.indexOf('|')
            const r = rowOf.get(k.slice(0, bar)), c = colOf.get(k.slice(bar + 1))
            if (r === undefined || c === undefined) continue
            noteText.current.set(k, text)
            noteMutation('sheet.mutation.update-note', {
              row: r, col: c, note: { id: `n-${r}-${c}`, row: r, col: c, width: 220, height: 90, note: text },
            })
          }
        } finally { drawingNotes = false }
        engine.current?.ensureSpare()
        return start
      },
    }

    let lastCmd = ''
    const subs = [
      univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (p) => {
        if (!mine(p)) return
        if (isBlocked(p.id)) {
          p.cancel = true
          handlers.current.onRefused?.('Rows and columns cannot be added, removed, moved or merged here — each row is one vehicle.')
          return
        }
        if (p?.type === CommandType.COMMAND) lastCmd = p.id
        if (p.id === 'sheet.command.reorder-range') prepareSort()
      }),
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, (p) => {
        if (!mine(p)) return
        if (p?.type === CommandType.COMMAND) lastCmd = ''
        // sorting moves whole rows (the id column with them): read the new order — and put the notes
        // back on their trucks, since Univer leaves them where they were (a sort's rule and notes: finishSort)
        // — once: the reorder MUTATION inside a sort waits for finishSort; on its own it is an undo/redo
        if (p.id === 'sheet.command.reorder-range') finishSort()
        else if (p.id === 'sheet.mutation.reorder-range' && !sortPrepared) { readIds(); drawNotes() }
      }),
      // ── Notes: one per cell, as in Excel. Each saved version is kept on the server (add-only). ──
      univerAPI.addEvent(univerAPI.Event.BeforeSheetNoteAdd, (p) => {
        if (!mine(p)) return
        if (drawingNotes) return
        if (p.row === 0 || p.col >= idCol) { p.cancel = true; return }
        const id = rowIds.current[p.row]
        if (!id) {
          p.cancel = true
          handlers.current.onRefused?.('A note needs a vehicle — type the chassis number in this row first.')
        }
      }),
      univerAPI.addEvent(univerAPI.Event.BeforeSheetNoteDelete, (p) => {
        if (!mine(p)) return
        if (drawingNotes) return
        const id = rowIds.current[p.row]
        const k = `${id}|${columns[p.col]?.key}`
        // an empty note never saved may go; a saved one stays (removing notes is not built yet)
        if (id && noteText.current.has(k)) {
          p.cancel = true
          handlers.current.onRefused?.('A saved note cannot be removed yet — change its text instead.')
        }
      }),
      ...['SheetNoteAdd', 'SheetNoteUpdate'].map((name) => univerAPI.addEvent(univerAPI.Event[name], (p) => {
        if (!mine(p)) return
        if (drawingNotes) return
        const id = rowIds.current[p.row]
        const key = columns[p.col]?.key
        const text = (p.note?.note ?? '').trim()
        if (!id || !key || !text) return // the editor opens empty; an emptied note is not saved
        const k = `${id}|${key}`
        if (noteText.current.get(k) === text) return
        noteText.current.set(k, text)
        handlers.current.onNote?.(id, key, text)
      })),
      // Duty 4, first half: refuse to open the editor on the header, the id column or a worked-out column.
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, (p) => {
        if (!mine(p)) return
        if (p.row === 0 || p.column >= idCol || !columns[p.column]?.editable) {
          p.cancel = true
          handlers.current.onRefused?.(p.row === 0 ? 'The header row is fixed.'
            : `“${columns[p.column]?.label ?? 'This column'}” is worked out by the tracker — it cannot be typed into.`)
        }
      }),
      univerAPI.addEvent(univerAPI.Event.SheetValueChanged, (p) => {
        if (!mine(p)) return
        if (reverting) return // our own put-back or refresh is not an edit
        // A sort moves whole rows (the id column with them): no truck's value or look changed, so nothing is
        // checked here — the new order is read when the command ends (CommandExecuted). Checking every
        // cell of the book as an edit took 31 s for 3,688 trucks (measured 2026-10-24).
        // An undo/redo of a sort replays the reorder mutation with no command around it — the same rule.
        if (/sort|reorder/i.test(lastCmd) || p?.payload?.id === 'sheet.mutation.reorder-range') return
        const cells = [], fresh = [], repair = []
        for (const range of ourRanges(p)) {
          const r0 = range.getRow(), c0 = range.getColumn()
          const values = range.getRawValues() // ⚠️ raw, never getValues (formatted text)
          const formulas = range.getFormulas()
          values.forEach((line, i) => line.forEach((value, j) => {
            const r = r0 + i, c = c0 + j
            // the grid's own cells are repaired here: the header and the id column
            if (r === 0) { repair.push({ r, c, v: c < idCol ? columns[c].label : 'id', s: 'hdr' }); return }
            if (c >= idCol) { if ((value ?? null) !== (rowIds.current[r] ?? null)) repair.push({ r, c, v: rowIds.current[r] ?? null }); return }
            const id = rowIds.current[r]
            const cell = { key: columns[c].key, value, formula: formulas?.[i]?.[j] || null }
            // a spare row (no truck yet) is reported by its sheet row — the page decides if it is a new vehicle
            if (!id) fresh.push({ r, ...cell })
            else cells.push({ id, ...cell })
          }))
        }
        const hint = performance.now() - keyHint.at < 1000 ? keyHint.what : null
        const source = sourceOf(lastCmd) ?? hint ?? 'undo'
        // Every book cell this touched — its look is checked below (a style change arrives as this
        // same event, and so do its undo and redo — measured).
        const looks = []
        for (const range of ourRanges(p)) {
          const r0 = range.getRow(), c0 = range.getColumn()
          for (let i = 0; i < range.getHeight(); i++) for (let j = 0; j < range.getWidth(); j++) {
            if (r0 + i >= 1 && c0 + j < idCol) looks.push({ r: r0 + i, c: c0 + j })
          }
        }
        // A paste brings the source's own look: Excel's font, size and borders on every cell and no
        // number format (seen: lakh money shown as 2200000). Each pasted cell gets its column's style
        // back, keeping only the source's fill — a yellow flag copied across stays yellow.
        if (source === 'paste') {
          for (const { r, c } of looks) {
            repair.push({ r, c, s: styleWith(columns[c], pastedFormat(columns[c], styleAt(r, c))) })
          }
        }
        queueMicrotask(() => {
          if (repair.length) write(repair)
          // duty 7: what each touched cell now looks like. A cell that lost its column's number format
          // ("clear format") gets it back; the person's part is reported, to be saved.
          const fix = [], looked = []
          for (const { r, c } of looks) {
            const col = columns[c]
            const style = styleAt(r, c)
            if (lostNumberFormat(col, style)) fix.push({ r, c, s: { ...style, n: baseStyle(col).n } })
            if (rowIds.current[r]) looked.push({ id: rowIds.current[r], key: col.key, format: formatOf(col, style) })
          }
          if (fix.length) write(fix)
          if (looked.length) handlers.current.onFormats?.(looked)
        })
        if (cells.length || fresh.length) handlers.current.onChanges?.(cells, source, fresh)
      }),
    ]

    return () => {
      window.removeEventListener('keydown', onKey, true)
      subs.forEach((s) => s?.dispose?.())
      writeRef.current = null
      engine.current = null
      // Disposed a tick LATER (seen switching the year, 2026-10-25): this cleanup runs while React is
      // unmounting the page, and dispose() unmounts the engine's own React root — synchronously, that
      // warned "synchronously unmount a root while React was already rendering" and a render then missed
      // SheetsScrollRenderController. And every formula calculation (the paid rule's, on each redraw)
      // starts a 1 s progress timer that dispose() never clears; firing into the disposed engine it threw
      // "Locale not initialized". Waiting does not help (a new one starts on each redraw), so the dying
      // engine's progress callback is switched off first (internal API — guarded; the bar is only a
      // progress display). Our listeners are already off; the element goes last.
      setTimeout(() => {
        try { univer.__getInjector().get(TriggerCalculationController)._startProgress = () => {} } catch { /* Univer changed */ }
        univer.dispose()
        host.remove()
      }, 0)
      api.current = null
      if (import.meta.env.DEV) delete window.__trackerUniver
    }
    // Mounted once per data load: after this the engine owns the sheet, and changes come FROM it.
  }, [columns, rows, formats, notes])

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
