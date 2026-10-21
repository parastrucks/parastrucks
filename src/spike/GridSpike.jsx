// SPIKE ONLY — throwaway comparison page for the Phase 10 grid decision.
// Glide (canvas) vs ReactGrid (DOM), on the same 2,050 × 88 synthetic book.
// Mounted dev-only from main.jsx, never in a production build. Delete once a grid is chosen.
// react-data-grid is gone: it cannot run on React 18 (React 19 context shorthand, see
// docs/backlog/phase10-execution-plan.md, PARKED section).
import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { DataEditor, GridCellKind, CompactSelection } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { ReactGrid } from '@silevis/reactgrid'
import '@silevis/reactgrid/styles.css'
import { COLUMNS, makeRows } from './trackerData'
import ErrorBox from './ErrorBox'

const inr = new Intl.NumberFormat('en-IN')
const fmtNum = v => typeof v === 'number' ? inr.format(v) : (v ?? '')
const HISTORY_LIMIT = 200

// The three fills actually used in the six workbooks (formatting census, Aug 2026).
const FILLS = [
  { label: 'Yellow', value: '#FFFF00' },
  { label: 'Red', value: '#FF0000' },
  { label: 'Green', value: '#C6EFCE' },
]
const INKS = [
  { label: 'Black', value: '#000000' },
  { label: 'Red', value: '#C00000' },
  { label: 'Blue', value: '#0B57D0' },
]
const LINE = { color: '#262626', style: 'solid', width: '1px' }

function Stopwatch({ label }) {
  const t = useRef(performance.now())
  const [ms, setMs] = useState(null)
  useEffect(() => {
    // two frames: the first is React's commit, the second is the browser's paint
    requestAnimationFrame(() => requestAnimationFrame(() => setMs(Math.round(performance.now() - t.current))))
  }, [])
  return <span className="spk-ms">{label} first paint: <b>{ms === null ? '…' : ms + ' ms'}</b></span>
}

// Ctrl+Z / Ctrl+Y belong to the cell editor while one is open — it undoes your typing first.
const typingInEditor = e => {
  const t = e.target
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/* ---------------- Glide (canvas) — carries every fix found in August ---------------- */
function GlidePane({ rows, commitValues, undo, redo, note }) {
  const cols = useMemo(() => COLUMNS.map(c => ({ title: c.name, id: c.key, width: c.width })), [])
  const [sel, setSel] = useState({ columns: CompactSelection.empty(), rows: CompactSelection.empty() })

  // Glide renders its editor into #portal and returns NULL without it: double-click selects,
  // activation fires, and then nothing opens. The real build puts this in index.html.
  useEffect(() => {
    if (document.getElementById('portal')) return
    const d = document.createElement('div')
    d.id = 'portal'
    d.style.cssText = 'position:fixed;left:0;top:0;z-index:9999'
    document.body.appendChild(d)
  }, [])

  // Must depend on `rows`: Glide repaints only when this function's identity changes.
  const getCellContent = useCallback(([col, row]) => {
    const c = COLUMNS[col], raw = rows[row]?.[c.key]
    return {
      kind: GridCellKind.Text,
      data: raw == null ? '' : String(raw),
      displayData: c.money ? fmtNum(raw) : String(raw ?? ''),
      allowOverlay: !c.computed,
      readonly: !!c.computed,
      contentAlign: c.money ? 'right' : undefined,
    }
  }, [rows])

  const onCellsEdited = useCallback(edits => {
    note(`Glide: ${edits.length} cell${edits.length > 1 ? 's' : ''} changed`)
    commitValues(edits.map(e => ({ rowId: rows[e.location[1]].id, colId: COLUMNS[e.location[0]].key, value: e.value.data })))
    if (edits.length > 1) { // Excel leaves a pasted / filled block selected
      let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity
      for (const e of edits) {
        const [c, r] = e.location
        minC = Math.min(minC, c); maxC = Math.max(maxC, c)
        minR = Math.min(minR, r); maxR = Math.max(maxR, r)
      }
      setSel({
        current: { cell: [minC, minR], range: { x: minC, y: minR, width: maxC - minC + 1, height: maxR - minR + 1 }, rangeStack: [] },
        columns: CompactSelection.empty(), rows: CompactSelection.empty(),
      })
    }
    return true
  }, [rows, commitValues, note])

  const onKeyDownCapture = e => {
    if (typingInEditor(e) || !(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo() }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); redo() }
  }

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="Glide" />
        <span className="spk-tag">canvas</span>
        <span className="spk-warn">Ctrl+F cannot find anything here</span>
        <span className="spk-ms">undo works · no formatting or right-click menu on this tab</span>
      </div>
      <div className="fill-grid" onKeyDownCapture={onKeyDownCapture}>
        <DataEditor
          columns={cols} rows={rows.length} getCellContent={getCellContent}
          onCellsEdited={onCellsEdited}
          gridSelection={sel} onGridSelectionChange={setSel}
          rangeSelect="multi-rect" fillHandle rowMarkers="number"
          keybindings={{ activateCell: ' |Enter|shift+Enter|F2' }}
          freezeColumns={3} rowHeight={30} headerHeight={34}
          getCellsForSelection={true} onPaste={true}
          width="100%" height="100%" smoothScrollX smoothScrollY
        />
      </div>
    </>
  )
}

/* ---------------- ReactGrid (DOM) ---------------- */
// Built from the active VIEW, not all 88 columns — the plan always intended views (~25 columns).

// A stored format → what ReactGrid can draw. Colour, fill and borders are real cell styles;
// bold / italic / underline are not in ReactGrid's style object, so they ride on CSS classes.
function decorate(cell, f) {
  if (!f) return cell
  const cls = [f.b && 'fmt-b', f.i && 'fmt-i', f.u && 'fmt-u'].filter(Boolean).join(' ')
  const style = {}
  if (f.fill) style.background = f.fill
  if (f.color) style.color = f.color
  if (f.border) style.border = { left: LINE, top: LINE, right: LINE, bottom: LINE }
  return { ...cell, ...(cls ? { className: cls } : {}), ...(Object.keys(style).length ? { style } : {}) }
}

function ReactGridPane({ rows, cols, fmt, commitValues, commitFormat, undo, redo, canUndo, canRedo, note }) {
  const rgColumns = useMemo(() => cols.map(c => ({ columnId: c.key, width: c.width, resizable: true })), [cols])
  const rgHeader = useMemo(() => ({ rowId: 'header', height: 34, cells: cols.map(c => ({ type: 'header', text: c.name })) }), [cols])
  // Cache each row's conversion. It is rebuilt only when that row's DATA object changes
  // (setRows replaces only edited rows) or its FORMAT object changes (formatting replaces only
  // the touched rows) — so neither an edit nor a format touches all 180,488 cells.
  const cache = useRef(new WeakMap())
  const toRg = useCallback(r => {
    const f = fmt.get(r.id)
    const hit = cache.current.get(r)
    if (hit && hit.f === f && hit.cols === cols) return hit.v
    const v = {
      rowId: r.id, height: 30,
      cells: cols.map(c => decorate(
        c.money
          ? { type: 'number', value: Number(r[c.key]) || 0, format: inr, nonEditable: !!c.computed }
          : { type: 'text', text: r[c.key] == null ? '' : String(r[c.key]), nonEditable: !!c.computed },
        f?.[c.key],
      )),
    }
    cache.current.set(r, { f, cols, v })
    return v
  }, [fmt, cols])
  const rgRows = useMemo(() => [rgHeader, ...rows.map(toRg)], [rows, toRg, rgHeader])

  // Which cells a toolbar button or Ctrl+B acts on: the selected ranges, else the focused cell.
  const target = useRef({ ranges: [], focus: null })
  const [focusFmt, setFocusFmt] = useState(null)
  const onSelectionChanged = useCallback(ranges => { target.current.ranges = ranges }, [])
  const onFocusLocationChanged = useCallback(loc => {
    target.current.focus = loc
    setFocusFmt(fmt.get(loc.rowId)?.[loc.columnId] ?? null)
  }, [fmt])
  useEffect(() => { // keep the B / I / U buttons truthful after an undo or a format
    const loc = target.current.focus
    if (loc) setFocusFmt(fmt.get(loc.rowId)?.[loc.columnId] ?? null)
  }, [fmt])

  const targetCells = () => {
    const out = [], seen = new Set()
    for (const rg of target.current.ranges) {
      for (const row of rg.rows) {
        if (row.rowId === 'header') continue
        for (const col of rg.columns) {
          const k = row.rowId + '|' + col.columnId
          if (!seen.has(k)) { seen.add(k); out.push({ rowId: row.rowId, colId: col.columnId }) }
        }
      }
    }
    const f = target.current.focus
    if (!out.length && f && f.rowId !== 'header') out.push({ rowId: f.rowId, colId: f.columnId })
    return out
  }

  // Excel's toggle rule: if the active cell already has it, the whole selection loses it.
  const toggle = key => {
    const cells = targetCells()
    if (!cells.length) return
    const anchor = target.current.focus
    const on = !(anchor && fmt.get(anchor.rowId)?.[anchor.columnId]?.[key])
    commitFormat(cells, cur => ({ ...cur, [key]: on || undefined }), `${on ? '' : 'un-'}${{ b: 'bold', i: 'italic', u: 'underline' }[key]}`)
  }
  const setProp = (key, value, label) => {
    const cells = targetCells()
    if (cells.length) commitFormat(cells, cur => ({ ...cur, [key]: value || undefined }), label)
  }
  const clearFormat = () => {
    const cells = targetCells()
    if (cells.length) commitFormat(cells, () => null, 'clear formatting')
  }

  const onCellsChanged = useCallback(changes => {
    note(`ReactGrid: ${changes.length} cell${changes.length > 1 ? 's' : ''} changed`)
    commitValues(changes.map(ch => ({
      rowId: ch.rowId, colId: ch.columnId,
      value: ch.type === 'number' ? ch.newCell.value : ch.newCell.text,
    })))
  }, [commitValues, note])

  const onKeyDownCapture = e => {
    if (typingInEditor(e) || !(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (k === 'z' && !e.shiftKey) { stop(); undo() }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { stop(); redo() }
    else if (k === 'b' || k === 'i' || k === 'u') { stop(); toggle(k) }
  }

  // onMouseDown + preventDefault keeps keyboard focus (and the selection) in the grid,
  // the way clicking Excel's ribbon never takes the cursor out of the sheet.
  const Btn = ({ onClick, on, disabled, title, children, style }) => (
    <button
      type="button" className="tb-btn" data-on={!!on} disabled={disabled} title={title} style={style}
      onMouseDown={e => { e.preventDefault(); if (!disabled) onClick() }}
    >{children}</button>
  )

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="ReactGrid" />
        <span className="spk-tag">DOM</span>
        <span className="spk-ok">Ctrl+F works · right-click menu built in</span>
      </div>
      <div className="toolbar">
        <Btn onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶ Undo</Btn>
        <Btn onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷ Redo</Btn>
        <span className="tb-sep" />
        <Btn onClick={() => toggle('b')} on={focusFmt?.b} title="Bold (Ctrl+B)" style={{ fontWeight: 700 }}>B</Btn>
        <Btn onClick={() => toggle('i')} on={focusFmt?.i} title="Italic (Ctrl+I)" style={{ fontStyle: 'italic' }}>I</Btn>
        <Btn onClick={() => toggle('u')} on={focusFmt?.u} title="Underline (Ctrl+U)" style={{ textDecoration: 'underline' }}>U</Btn>
        <span className="tb-sep" />
        <span className="tb-label">Fill</span>
        {FILLS.map(f => (
          <Btn key={f.value} onClick={() => setProp('fill', f.value, `fill ${f.label.toLowerCase()}`)}
            on={focusFmt?.fill === f.value} title={`Fill ${f.label}`}>
            <span className="sw" style={{ background: f.value }} />
          </Btn>
        ))}
        <Btn onClick={() => setProp('fill', null, 'no fill')} title="No fill">∅</Btn>
        <span className="tb-sep" />
        <span className="tb-label">Text</span>
        {INKS.map(c => (
          <Btn key={c.value} onClick={() => setProp('color', c.value === '#000000' ? null : c.value, `text ${c.label.toLowerCase()}`)}
            on={(focusFmt?.color ?? '#000000') === c.value} title={`Text ${c.label}`}>
            <span style={{ color: c.value, fontWeight: 700 }}>A</span>
          </Btn>
        ))}
        <span className="tb-sep" />
        <Btn onClick={() => setProp('border', !focusFmt?.border, focusFmt?.border ? 'no border' : 'border')}
          on={focusFmt?.border} title="Box border">▢ Border</Btn>
        <Btn onClick={clearFormat} title="Clear formatting">Clear</Btn>
      </div>
      {/* ReactGrid only virtualises inside a scroll container of fixed height */}
      <div className="fill-grid rg-scroll" onKeyDownCapture={onKeyDownCapture}>
        <ReactGrid
          rows={rgRows} columns={rgColumns}
          onCellsChanged={onCellsChanged}
          onSelectionChanged={onSelectionChanged}
          onFocusLocationChanged={onFocusLocationChanged}
          enableRangeSelection enableFillHandle
          stickyLeftColumns={3} stickyTopRows={1}
          onContextMenu={(_r, _c, _mode, menuOptions) => menuOptions}
        />
      </div>
    </>
  )
}

export default function GridSpike() {
  const [which, setWhich] = useState('rg')
  const [rows, setRows] = useState(() => makeRows(2050))
  const [fmt, setFmt] = useState(() => new Map()) // rowId → { [columnKey]: { b, i, u, fill, color, border } }
  const [log, setLog] = useState('no edits yet')
  const [viewRows, setViewRows] = useState(2050)   // 2050 = whole year · 270 ≈ one month (March sheets: 265–268)
  const [viewCols, setViewCols] = useState(88)     // 88 = every column · 25 ≈ a working view (plan, E7)
  const shownRows = useMemo(() => rows.slice(0, viewRows), [rows, viewRows])
  const shownCols = useMemo(() => COLUMNS.slice(0, viewCols), [viewCols])

  // Mirrors so a handler can read the current state synchronously (the "before" of a change).
  const rowsRef = useRef(rows); rowsRef.current = rows
  const fmtRef = useRef(fmt); fmtRef.current = fmt

  // ONE undo stack for values AND formatting, as in Excel. Each entry holds every cell it
  // touched as { rowId, colId, before, after } — the same field-level shape the real build
  // keeps in tracker_audit, so Ctrl+Z there is this, replayed from the audit table.
  const hist = useRef({ stack: [], at: 0 })
  const [, setTick] = useState(0)
  const bump = () => setTick(t => t + 1)

  const applyValues = (list, dir) => setRows(prev => {
    const at = new Map(prev.map((r, i) => [r.id, i]))
    const next = [...prev]
    for (const c of list) {
      const i = at.get(c.rowId)
      if (i != null) next[i] = { ...next[i], [c.colId]: dir === 'undo' ? c.before : c.after }
    }
    return next
  })
  const applyFormat = (list, dir) => setFmt(prev => {
    const next = new Map(prev)
    for (const c of list) {
      const row = { ...(next.get(c.rowId) || {}) } // a new object per touched row → its cache misses
      const v = dir === 'undo' ? c.before : c.after
      if (v == null) delete row[c.colId]; else row[c.colId] = v
      next.set(c.rowId, row)
    }
    return next
  })
  const record = entry => {
    const h = hist.current
    h.stack = h.stack.slice(0, h.at) // a new action after an undo discards the redo tail
    h.stack.push(entry)
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift()
    h.at = h.stack.length
    bump()
  }

  const commitValues = useCallback(changes => {
    const idx = new Map(rowsRef.current.map((r, i) => [r.id, i]))
    const list = []
    for (const c of changes) {
      const row = rowsRef.current[idx.get(c.rowId)]
      if (!row) continue
      const before = row[c.colId]
      if (String(before ?? '') === String(c.value ?? '')) continue // no-op edits are not undo steps
      list.push({ rowId: c.rowId, colId: c.colId, before, after: c.value })
    }
    if (!list.length) return
    record({ kind: 'values', label: `${list.length} cell${list.length > 1 ? 's' : ''} edited`, list })
    applyValues(list, 'redo')
  }, [])

  const commitFormat = useCallback((cells, make, label) => {
    const list = []
    for (const { rowId, colId } of cells) {
      const before = fmtRef.current.get(rowId)?.[colId] ?? null
      let after = make(before || {})
      if (after) { // drop empty keys so "no formatting" is stored as nothing at all
        after = Object.fromEntries(Object.entries(after).filter(([, v]) => v !== undefined && v !== false))
        if (!Object.keys(after).length) after = null
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) list.push({ rowId, colId, before, after })
    }
    if (!list.length) return
    record({ kind: 'format', label: `${label} on ${list.length} cell${list.length > 1 ? 's' : ''}`, list })
    applyFormat(list, 'redo')
    setLog(`${label} · ${list.length} cell${list.length > 1 ? 's' : ''}`)
  }, [])

  const undo = useCallback(() => {
    const h = hist.current
    if (!h.at) return
    const e = h.stack[--h.at]
    e.kind === 'values' ? applyValues(e.list, 'undo') : applyFormat(e.list, 'undo')
    setLog(`undid: ${e.label}`)
    bump()
  }, [])
  const redo = useCallback(() => {
    const h = hist.current
    if (h.at >= h.stack.length) return
    const e = h.stack[h.at++]
    e.kind === 'values' ? applyValues(e.list, 'redo') : applyFormat(e.list, 'redo')
    setLog(`redid: ${e.label}`)
    bump()
  }, [])

  const h = hist.current
  return (
    <div className="spk-wrap">
      <style>{`
        .spk-wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#fff;font-family:Carlito,Calibri,Segoe UI,sans-serif}
        .spk-head{padding:8px 14px;border-bottom:1px solid #d4d4d4;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .spk-head h1{font-size:15px;font-weight:700;margin:0}
        .spk-tab{padding:5px 16px;border:1px solid #bfbfbf;background:#fff;cursor:pointer;font:inherit;font-size:13px}
        .spk-tab[data-on=true]{background:#000;color:#fff;border-color:#000}
        .spk-bar{padding:5px 14px;background:#f4f4f4;border-bottom:1px solid #ececec;display:flex;gap:14px;align-items:center;font-size:12px;flex-wrap:wrap}
        .spk-ms{color:#565656}
        .spk-tag{background:#e6e6e6;padding:1px 7px;border-radius:2px;font-size:11px;color:#262626}
        .spk-warn{color:#b42318;font-weight:700}
        .spk-ok{color:#15803d;font-weight:700}
        .toolbar{display:flex;align-items:center;gap:4px;padding:5px 14px;border-bottom:1px solid #d4d4d4;background:#fafafa;flex-wrap:wrap}
        .tb-btn{min-width:30px;height:28px;padding:0 8px;border:1px solid #d4d4d4;background:#fff;border-radius:2px;cursor:pointer;font:inherit;font-size:13px;color:#262626;display:inline-flex;align-items:center;justify-content:center;gap:4px}
        .tb-btn:hover:not(:disabled){border-color:#767676}
        .tb-btn[data-on=true]{background:#dbe7ff;border-color:#2563eb}
        .tb-btn:disabled{color:#bfbfbf;cursor:default}
        .tb-sep{width:1px;height:20px;background:#d4d4d4;margin:0 6px}
        .tb-label{font-size:12px;color:#767676;margin-right:2px}
        .sw{display:inline-block;width:14px;height:14px;border:1px solid #767676}
        .rg-cell.fmt-b{font-weight:700 !important}
        .rg-cell.fmt-i{font-style:italic !important}
        .rg-cell.fmt-u{text-decoration:underline !important}
        .spk-body{flex:1;min-height:0;display:flex;flex-direction:column}
        .fill-grid{flex:1;min-height:0}
        .rg-scroll{overflow:auto}
        .view-pick{font-size:12px;color:#565656;display:inline-flex;gap:6px;align-items:center}
        .view-pick select{font:inherit;font-size:12px;padding:3px 4px}
        .spk-try{font-size:12px;color:#565656;padding:6px 14px;border-top:1px solid #ececec;background:#fffdf5;line-height:1.5}
      `}</style>
      <div className="spk-head">
        <h1>Phase 10 grid comparison</h1>
        <span style={{ fontSize: 12, color: '#767676' }}>
          {rows.length.toLocaleString('en-IN')} rows × {COLUMNS.length} columns · same data on both tabs
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#565656' }}>
          last: <b>{log}</b> · undo steps: <b>{h.at}</b>{h.stack.length > h.at ? <> · redo: <b>{h.stack.length - h.at}</b></> : null}
        </span>
        <span className="view-pick">View:
          <select value={viewRows} onChange={e => setViewRows(+e.target.value)}>
            <option value={2050}>Whole year · 2,050 rows</option>
            <option value={270}>One month · 270 rows</option>
          </select>
          <select value={viewCols} onChange={e => setViewCols(+e.target.value)}>
            <option value={88}>All 88 columns</option>
            <option value={25}>Working view · 25 columns</option>
          </select>
        </span>
        <button className="spk-tab" data-on={which === 'rg'} onClick={() => setWhich('rg')}>ReactGrid</button>
        <button className="spk-tab" data-on={which === 'glide'} onClick={() => setWhich('glide')}>Glide</button>
      </div>
      <div className="spk-body">
        {which === 'rg'
          ? <ErrorBox label="ReactGrid" key="rg">
              <ReactGridPane rows={shownRows} cols={shownCols} fmt={fmt} commitValues={commitValues} commitFormat={commitFormat}
                undo={undo} redo={redo} canUndo={h.at > 0} canRedo={h.at < h.stack.length} note={setLog} />
            </ErrorBox>
          : <ErrorBox label="Glide" key="glide">
              <GlidePane rows={rows} commitValues={commitValues} undo={undo} redo={redo} note={setLog} />
            </ErrorBox>}
      </div>
      <div className="spk-try">
        <b>Try:</b> edit a cell, then <b>Ctrl+Z</b> / <b>Ctrl+Y</b> · paste a block from Excel, then one Ctrl+Z undoes all of it ·
        select cells → <b>B / I / U</b> (or Ctrl+B/I/U), fill colour, text colour, border · undo a formatting change ·
        right-click a cell · <b>Ctrl+F</b> for 00042
      </div>
    </div>
  )
}
