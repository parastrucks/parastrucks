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
const fmt = v => typeof v === 'number' ? inr.format(v) : (v ?? '')

function Stopwatch({ label }) {
  const t = useRef(performance.now())
  const [ms, setMs] = useState(null)
  useEffect(() => {
    // two frames: the first is React's commit, the second is the browser's paint
    requestAnimationFrame(() => requestAnimationFrame(() => setMs(Math.round(performance.now() - t.current))))
  }, [])
  return <span className="spk-ms">{label} first paint: <b>{ms === null ? '…' : ms + ' ms'}</b></span>
}

/* ---------------- Glide (canvas) — carries every fix found in August ---------------- */
function GlidePane({ rows, setRows, note }) {
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
      displayData: c.money ? fmt(raw) : String(raw ?? ''),
      allowOverlay: !c.computed,
      readonly: !!c.computed,
      contentAlign: c.money ? 'right' : undefined,
    }
  }, [rows])

  const onCellsEdited = useCallback(edits => {
    note(`Glide: ${edits.length} cell${edits.length > 1 ? 's' : ''} changed`)
    setRows(prev => {
      const next = [...prev]
      for (const e of edits) {
        const [col, row] = e.location
        next[row] = { ...next[row], [COLUMNS[col].key]: e.value.data }
      }
      return next
    })
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
  }, [setRows, note])

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="Glide" />
        <span className="spk-tag">canvas</span>
        <span className="spk-warn">Ctrl+F cannot find anything here</span>
        <span className="spk-ms">no right-click menu (would be built by us)</span>
      </div>
      <div className="fill-grid">
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
const RG_COLUMNS = COLUMNS.map(c => ({ columnId: c.key, width: c.width, resizable: true }))
const RG_HEADER = { rowId: 'header', height: 34, cells: COLUMNS.map(c => ({ type: 'header', text: c.name })) }

function ReactGridPane({ rows, setRows, note }) {
  // A row object keeps its identity until it is edited (setRows spreads only changed rows),
  // so caching the conversion per row keeps an edit from rebuilding all 180,400 cells.
  // That is what a real build would do — anything less would handicap the DOM option unfairly.
  const cache = useRef(new WeakMap())
  const toRg = useCallback(r => {
    let v = cache.current.get(r)
    if (!v) {
      v = {
        rowId: r.id, height: 30,
        cells: COLUMNS.map(c => c.money
          ? { type: 'number', value: Number(r[c.key]) || 0, format: inr, nonEditable: !!c.computed }
          : { type: 'text', text: r[c.key] == null ? '' : String(r[c.key]), nonEditable: !!c.computed }),
      }
      cache.current.set(r, v)
    }
    return v
  }, [])
  const rgRows = useMemo(() => [RG_HEADER, ...rows.map(toRg)], [rows, toRg])

  const onCellsChanged = useCallback(changes => {
    note(`ReactGrid: ${changes.length} cell${changes.length > 1 ? 's' : ''} changed`)
    setRows(prev => {
      const at = new Map(prev.map((r, i) => [r.id, i]))
      const next = [...prev]
      for (const ch of changes) {
        const i = at.get(ch.rowId)
        if (i == null) continue
        const v = ch.type === 'number' ? ch.newCell.value : ch.newCell.text
        next[i] = { ...next[i], [ch.columnId]: v }
      }
      return next
    })
  }, [setRows, note])

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="ReactGrid" />
        <span className="spk-tag">DOM</span>
        <span className="spk-ok">Ctrl+F works · right-click menu built in</span>
      </div>
      {/* ReactGrid only virtualises inside a scroll container of fixed height */}
      <div className="fill-grid rg-scroll">
        <ReactGrid
          rows={rgRows} columns={RG_COLUMNS}
          onCellsChanged={onCellsChanged}
          enableRangeSelection enableFillHandle
          stickyLeftColumns={3} stickyTopRows={1}
          onContextMenu={(_r, _c, _mode, menuOptions) => menuOptions}
        />
      </div>
    </>
  )
}

export default function GridSpike() {
  const [which, setWhich] = useState('glide')
  const [rows, setRows] = useState(() => makeRows(2050))
  const [log, setLog] = useState('no edits yet')

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
        .spk-body{flex:1;min-height:0;display:flex;flex-direction:column}
        .fill-grid{flex:1;min-height:0}
        .rg-scroll{overflow:auto}
        .spk-try{font-size:12px;color:#565656;padding:6px 14px;border-top:1px solid #ececec;background:#fffdf5;line-height:1.5}
      `}</style>
      <div className="spk-head">
        <h1>Phase 10 grid comparison</h1>
        <span style={{ fontSize: 12, color: '#767676' }}>
          {rows.length.toLocaleString('en-IN')} rows × {COLUMNS.length} columns · same data on both tabs
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#565656' }}>last: <b>{log}</b></span>
        <button className="spk-tab" data-on={which === 'glide'} onClick={() => setWhich('glide')}>Glide</button>
        <button className="spk-tab" data-on={which === 'rg'} onClick={() => setWhich('rg')}>ReactGrid</button>
      </div>
      <div className="spk-body">
        {which === 'glide'
          ? <ErrorBox label="Glide" key="glide"><GlidePane rows={rows} setRows={setRows} note={setLog} /></ErrorBox>
          : <ErrorBox label="ReactGrid" key="rg"><ReactGridPane rows={rows} setRows={setRows} note={setLog} /></ErrorBox>}
      </div>
      <div className="spk-try">
        <b>Try the same things on each tab:</b> scroll fast up/down and right · drag-select a block → Ctrl+C → paste into Excel ·
        copy a block in Excel → click a cell → Ctrl+V · drag the small square at a selection's corner to fill down ·
        double-click or F2 to edit, Enter to save · <b>right-click</b> a cell · <b>Ctrl+F</b> for a chassis number, e.g. 00042
      </div>
    </div>
  )
}
