// SPIKE ONLY — throwaway comparison page for the Phase 10 grid decision.
// Not linked from navConfig; reachable at /grid-spike. Delete once the winner is chosen.
import { useMemo, useState, useCallback, useRef } from 'react'
import { DataGrid } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { COLUMNS, makeRows } from './trackerData'

const fmt = v => typeof v === 'number' ? v.toLocaleString('en-IN') : (v ?? '')

function Stopwatch({ label }) {
  const t = useRef(performance.now())
  const [ms, setMs] = useState(null)
  if (ms === null) requestAnimationFrame(() => setMs(Math.round(performance.now() - t.current)))
  return <span className="spk-ms">{label} first paint: <b>{ms === null ? '…' : ms + ' ms'}</b></span>
}

/* ---------------- react-data-grid ---------------- */
function RdgPane({ rows, setRows }) {
  const columns = useMemo(() => COLUMNS.map(c => ({
    key: c.key, name: c.name, width: c.width, frozen: c.frozen, resizable: true, sortable: true,
    renderEditCell: c.computed ? undefined : ({ row, onRowChange, onClose }) => (
      <input className="rdg-text-editor" autoFocus defaultValue={row[c.key] ?? ''}
        onBlur={e => { onRowChange({ ...row, [c.key]: e.target.value }, true); onClose(true) }}
        onKeyDown={e => { if (e.key === 'Enter') { onRowChange({ ...row, [c.key]: e.target.value }, true); onClose(true) } }} />
    ),
    renderCell: c.money ? ({ row }) => <div style={{ textAlign: 'right' }}>{fmt(row[c.key])}</div> : undefined,
  })), [])

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="RDG" />
        <span className="spk-warn">No range selection · copy/paste/fill are single-cell only</span>
      </div>
      <DataGrid
        columns={columns} rows={rows} rowKeyGetter={r => r.id}
        onRowsChange={setRows} rowHeight={30} headerRowHeight={34}
        className="fill-grid rdg-light"
        onFill={({ columnKey, sourceRow, targetRow }) => ({ ...targetRow, [columnKey]: sourceRow[columnKey] })}
        onCopy={({ sourceRow, sourceColumnKey }) => navigator.clipboard?.writeText(String(sourceRow[sourceColumnKey] ?? ''))}
        onPaste={({ sourceRow, sourceColumnKey, targetRow, targetColumnKey }) => ({ ...targetRow, [targetColumnKey]: sourceRow[sourceColumnKey] })}
      />
    </>
  )
}

/* ---------------- glide-data-grid ---------------- */
function GlidePane({ rows, setRows }) {
  const cols = useMemo(() => COLUMNS.map(c => ({ title: c.name, id: c.key, width: c.width })), [])
  const rowsRef = useRef(rows); rowsRef.current = rows

  const getCellContent = useCallback(([col, row]) => {
    const c = COLUMNS[col], r = rowsRef.current[row]
    const raw = r?.[c.key]
    return {
      kind: GridCellKind.Text,
      data: raw == null ? '' : String(raw),
      displayData: c.money ? fmt(raw) : String(raw ?? ''),
      allowOverlay: !c.computed,
      readonly: !!c.computed,
      contentAlign: c.money ? 'right' : undefined,
    }
  }, [])

  const onCellsEdited = useCallback(edits => {
    setRows(prev => {
      const next = [...prev]
      for (const e of edits) {
        const [col, row] = e.location
        next[row] = { ...next[row], [COLUMNS[col].key]: e.value.data }
      }
      return next
    })
    return true
  }, [setRows])

  return (
    <>
      <div className="spk-bar">
        <Stopwatch label="Glide" />
        <span className="spk-ok">Range select · fill handle · block copy/paste — native</span>
      </div>
      <div className="fill-grid">
        <DataEditor
          columns={cols} rows={rows.length} getCellContent={getCellContent}
          onCellsEdited={onCellsEdited}
          rangeSelect="multi-rect" fillHandle rowMarkers="number"
          freezeColumns={3} rowHeight={30} headerHeight={34}
          getCellsForSelection={true}
          onPaste={true}
          width="100%" height="100%"
          smoothScrollX smoothScrollY
        />
      </div>
    </>
  )
}

export default function GridSpike() {
  const [which, setWhich] = useState('glide')
  const [rows, setRows] = useState(() => makeRows(2050))

  return (
    <div className="spk-wrap">
      <style>{`
        .spk-wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#fff;font-family:Carlito,Calibri,Segoe UI,sans-serif}
        .spk-head{padding:8px 14px;border-bottom:1px solid #d4d4d4;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .spk-head h1{font-size:15px;font-weight:700;margin:0}
        .spk-tab{padding:4px 14px;border:1px solid #bfbfbf;background:#fff;cursor:pointer;font:inherit;font-size:13px}
        .spk-tab[data-on=true]{background:#000;color:#fff;border-color:#000}
        .spk-bar{padding:5px 14px;background:#f4f4f4;border-bottom:1px solid #ececec;display:flex;gap:14px;align-items:center;font-size:12px;flex-wrap:wrap}
        .spk-ms{color:#565656}
        .spk-warn{color:#b42318;font-weight:700}
        .spk-ok{color:#15803d;font-weight:700}
        .spk-body{flex:1;min-height:0;display:flex;flex-direction:column}
        .fill-grid{flex:1;min-height:0;block-size:100%}
        .spk-try{font-size:12px;color:#565656;padding:6px 14px;border-top:1px solid #ececec;background:#fffdf5}
      `}</style>
      <div className="spk-head">
        <h1>Phase 10 grid spike</h1>
        <span style={{ fontSize: 12, color: '#767676' }}>{rows.length.toLocaleString('en-IN')} rows × {COLUMNS.length} columns</span>
        <span style={{ flex: 1 }} />
        <button className="spk-tab" data-on={which === 'glide'} onClick={() => setWhich('glide')}>Glide data grid</button>
        <button className="spk-tab" data-on={which === 'rdg'} onClick={() => setWhich('rdg')}>react-data-grid</button>
      </div>
      <div className="spk-body">
        {which === 'rdg' ? <RdgPane rows={rows} setRows={setRows} /> : <GlidePane rows={rows} setRows={setRows} />}
      </div>
      <div className="spk-try">
        <b>Try on each:</b> drag-select a block of cells → Ctrl+C → paste into Excel · copy a block from Excel → Ctrl+V here ·
        drag the little square at the corner of a selection to fill down · arrow keys / Tab / Enter / F2 / Esc ·
        scroll right past the frozen columns · double-click a cell to edit.
      </div>
    </div>
  )
}
