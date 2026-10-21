// SPIKE ONLY — Univer 1.1 (Apache-2.0, free presets only; nothing from @univerjs-pro).
import { useEffect, useRef, useState } from 'react'
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
import { COLUMNS } from './trackerData'
import { LOCKED, sourceOf, diffAgainst, useCaptureLog, CaptureBar } from './engineShared'

// One workbook, one sheet. Row 0 is the header; data row r is rows[r - 1].
function buildWorkbook(rows) {
  const cellData = { 0: {} }
  COLUMNS.forEach((c, ci) => { cellData[0][ci] = { v: c.computed ? `${c.name} · locked` : c.name, s: 'hdr' } })
  rows.forEach((r, ri) => {
    const line = {}
    COLUMNS.forEach((c, ci) => {
      const v = r[c.key]
      if (v === '' || v == null) return
      line[ci] = c.money
        ? { v: Number(v) || 0, s: c.computed ? 'lockedMoney' : 'money' }
        : { v: String(v), ...(c.computed ? { s: 'locked' } : {}) }
    })
    cellData[ri + 1] = line
  })
  const columnData = {}
  COLUMNS.forEach((c, ci) => { columnData[ci] = { w: c.width } })
  return {
    id: 'tracker', name: 'Tracker', sheetOrder: ['book'],
    styles: {
      hdr: { bl: 1, bg: { rgb: '#ECECEC' } },
      money: { n: { pattern: '#,##0' } },
      lockedMoney: { n: { pattern: '#,##0' }, bg: { rgb: '#F6F6F6' } },
      locked: { bg: { rgb: '#F6F6F6' } },
    },
    sheets: {
      book: {
        id: 'book', name: 'Book', rowCount: rows.length + 1, columnCount: COLUMNS.length,
        cellData, columnData,
        freeze: { xSplit: 3, ySplit: 1, startRow: 1, startColumn: 3 },
      },
    },
  }
}

export default function UniverPane({ rows, syncValues, note }) {
  const box = useRef(null)
  const { log, record, blocked } = useCaptureLog()
  const [ready, setReady] = useState(null)
  const keyHint = useRef(null) // Ctrl+Z / Ctrl+Y tells undo from redo; Univer's events cannot

  useEffect(() => {
    const t0 = performance.now()
    // Ctrl+Z / Ctrl+Y says which of undo or redo the next no-command change is. Listened for on the
    // WINDOW in the capture phase, and registered BEFORE Univer is created: Univer takes these keys
    // before they reach the grid's element, and undoes inside its own window listener — registered
    // later, ours would label each change with the PREVIOUS key (measured). A hint lasts one second,
    // so a Ctrl+Z with nothing to undo cannot mislabel a later change.
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) keyHint.current = { what: 'undo', at: performance.now() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) keyHint.current = { what: 'redo', at: performance.now() }
    }
    window.addEventListener('keydown', onKey, true)
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: merge({}, coreEnUS, filterEnUS, sortEnUS, cfEnUS, dvEnUS, frEnUS, noteEnUS) },
      presets: [
        UniverSheetsCorePreset({ container: box.current }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset(),
        UniverSheetsFindReplacePreset(),
        UniverSheetsNotePreset(),
      ],
    })
    const shadow = rows.map(r => ({ ...r })) // our copy = the "before" values (the DB, in the real build)
    univerAPI.createWorkbook(buildWorkbook(rows))
    window.__univerAPI = univerAPI // spike only: lets the timings be taken from the console

    // Labelling: a user-level command (type COMMAND) brackets the changes it causes. Undo and redo
    // are different — they replay mutations with NO command around them (measured), so a change
    // that arrives with no command running is an undo or redo; the keys pressed say which.
    let lastCmd = ''
    let reverting = false
    const subs = [
      univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, p => {
        if (p?.type === CommandType.COMMAND) lastCmd = p.id
      }),
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, p => {
        if (p?.type === CommandType.COMMAND) lastCmd = ''
      }),
      // the lock: refuse to open the editor on the header or a computed money column
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, p => {
        if (p.row === 0 || LOCKED.has(p.column)) { p.cancel = true; note('Univer: that column is locked (computed money)') }
      }),
      // capture: every value change, whatever caused it
      univerAPI.addEvent(univerAPI.Event.SheetValueChanged, p => {
        if (reverting) return // our own put-back of a locked cell is not an edit
        const cells = []
        for (const range of p.effectedRanges || []) {
          const r0 = range.getRow(), c0 = range.getColumn()
          // ⚠️ getRawValues, NEVER getValues: getValues returns the FORMATTED text ("2,462,200") for a
          // number-formatted cell. Read that and the database gets commas in its money fields — and
          // every put-back looks like a new change, which looped forever here (measured, 2026-10-21).
          range.getRawValues().forEach((line, i) => line.forEach((value, j) => cells.push({ r: r0 + i, c: c0 + j, value })))
        }
        const { changes, reverts } = diffAgainst(shadow, cells)
        const hint = keyHint.current && performance.now() - keyHint.current.at < 1000 ? keyHint.current.what : null
        const source = lastCmd ? sourceOf(lastCmd) : (hint || 'undo/redo')
        if (changes.length) { record(changes, source); syncValues(changes); note(`Univer: ${changes.length} cell${changes.length > 1 ? 's' : ''} changed (${source})`) }
        if (reverts.length) { // a route past the lock (e.g. paste or fill) — put the money back
          blocked(reverts.length)
          setTimeout(() => {
            const sheet = univerAPI.getActiveWorkbook().getActiveSheet()
            reverting = true
            try { reverts.forEach(({ r, c, before }) => sheet.getRange(r, c).setValue(before ?? '')) } finally { reverting = false }
          }, 0)
        }
      }),
    ]
    // Timed to the end of the work, not the next frame: this window paces frames at ~1/s
    // (a do-nothing double-frame wait measured ~2,000 ms), which would swamp the number.
    setReady(Math.round(performance.now() - t0))
    return () => { window.removeEventListener('keydown', onKey, true); subs.forEach(s => s?.dispose?.()); univer.dispose(); delete window.__univerAPI }
    // Mount once: the engine owns the sheet after this; later `rows` changes come FROM it.
  }, []) // deliberately mounted once (see comment above)

  return (
    <>
      <div className="spk-bar">
        <span className="spk-ms">Univer ready in: <b>{ready === null ? '…' : ready + ' ms'}</b></span>
        <span className="spk-tag">canvas · Apache-2.0 · free presets only</span>
        <span className="spk-ok">its own undo, toolbar, formatting, filter, find, comments, dropdowns</span>
      </div>
      <CaptureBar log={log} label="Univer" />
      <div className="fill-grid engine-host" ref={box} />
    </>
  )
}
