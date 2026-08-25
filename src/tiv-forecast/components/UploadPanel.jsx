// TIV Forecast — Upload Panel (admin-only)
import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import Icon from '../../components/Icon'
import { parseExcelFile, downloadMarketDataTemplate } from '../lib/parseExcel'
import { retrainModel } from '../lib/retrainModel'
import { uploadAllTiv, fetchUploadHistory } from '../lib/dataQueries'
import { buildUploadDiff, buildForecastDelta } from '../lib/uploadDiff'
import { runForecast } from '../lib/forecastEngine'
import { buildDefaultTriggerState } from '../lib/triggerDefs'

// `current` carries what the page already holds, so the panel can show what
// this file would CHANGE rather than only what it contains.
export default function UploadPanel({ onUploadComplete, current = {} }) {
  const { profile, isAdmin } = useAuth()
  const toast = useToast()   // file / parse / upload failures
  const [collapsed, setCollapsed]         = useState(true)
  const [file, setFile]                   = useState(null)
  const [preview, setPreview]             = useState(null)  // { monthsLoaded, lastDataMonth }
  const [uploading, setUploading]         = useState(false)
  const [progress, setProgress]           = useState(null)  // { pct: 0-100, step: 'label' }
  const [successMsg, setSuccessMsg]       = useState('')
  const [history, setHistory]             = useState(null)  // null = not loaded yet
  const [showHistory, setShowHistory]     = useState(false)
  const [entities, setEntities]           = useState([])
  const [entityId, setEntityId]           = useState('')
  const [brandsForEntity, setBrandsForEntity] = useState([])
  const [brandId, setBrandId]             = useState('')
  // Parsed + retrained result, held from file-select until the confirm click so
  // the upload writes exactly what was reviewed.
  const [parsedFile, setParsedFile]       = useState(null)
  // Required tick when the diff looks like a wholesale replacement rather than
  // an incremental update.
  const [acknowledged, setAcknowledged]   = useState(false)

  // Both lookups used to fail silently — the entities error went to the
  // console and the brands query never even destructured `error` — leaving the
  // admin staring at empty dropdowns and a disabled button with no stated
  // reason.
  const [lookupError, setLookupError] = useState('')

  useEffect(() => {
    if (collapsed) return
    supabase.from('entities').select('id, full_name, code').order('full_name')
      .then(({ data, error }) => {
        if (error) setLookupError(`Could not load entities: ${error.message}`)
        else if (!data?.length) setLookupError('No entities were returned — the upload form cannot be filled in.')
        else setLookupError('')
        setEntities(data || [])
      })
  }, [collapsed])

  useEffect(() => {
    setBrandId('')
    setBrandsForEntity([])
    if (!entityId) return
    supabase
      .from('outlet_brands')
      .select('brand_id, brands(id, name, code), outlets!inner(entity_id)')
      .eq('outlets.entity_id', entityId)
      .then(({ data, error }) => {
        if (error) { setLookupError(`Could not load brands: ${error.message}`); return }
        const seen = {}
        const brands = []
        for (const row of data || []) {
          if (row.brands && !seen[row.brand_id]) {
            seen[row.brand_id] = true
            brands.push(row.brands)
          }
        }
        if (!brands.length) setLookupError('This entity has no brands assigned to any of its outlets.')
        else setLookupError('')
        setBrandsForEntity(brands)
      })
  }, [entityId])

  // Closing the tab mid-upload used to leave a partial write with no trace,
  // because the history row was the last thing written. Declared above the
  // isAdmin early-return so hook order stays stable.
  useEffect(() => {
    if (!uploading) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  const UPLOAD_STEPS = [
    { pct: 10, label: 'Parsing file…' },
    { pct: 25, label: 'Uploading TIV actuals…' },
    { pct: 37, label: 'Uploading PTB actuals…' },
    { pct: 50, label: 'Uploading AL actuals…' },
    { pct: 62, label: 'Uploading judgment forecasts…' },
    { pct: 75, label: 'Uploading raw data…' },
    { pct: 88, label: 'Retraining model…' },
    { pct: 95, label: 'Saving upload record…' },
    { pct: 100, label: 'Done!' },
  ]

  if (!isAdmin) return null

  function handleFileChange(e) {
    const f = e.target.files[0]
    setSuccessMsg('')
    setPreview(null)
    if (!f) { setFile(null); return }

    if (f.size > 5 * 1024 * 1024) {
      toast.error('File must be 5 MB or smaller')
      setFile(null)
      e.target.value = ''
      return
    }

    // .xlsx is a ZIP container, so the first 4 bytes must be PK\x03\x04
    const headerReader = new FileReader()
    headerReader.onload = () => {
      const bytes = new Uint8Array(headerReader.result)
      const isZip = bytes.length >= 4
        && bytes[0] === 0x50 && bytes[1] === 0x4B
        && bytes[2] === 0x03 && bytes[3] === 0x04
      if (!isZip) {
        toast.error('File is not a valid .xlsx workbook')
        setFile(null)
        e.target.value = ''
        return
      }

      setFile(f)
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          // Parse AND retrain here, before anything is written. Both are pure
          // client-side functions, so the full consequence of this upload --
          // rows changed, and the forecast it would produce -- is knowable now.
          const parsed = parseExcelFile(evt.target.result)
          const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
          const diff = buildUploadDiff(parsed, current)
          const triggers = buildDefaultTriggerState()
          const delta = buildForecastDelta(
            current.modelParams ? runForecast(current.modelParams, triggers) : null,
            runForecast(params, triggers),
          )
          setParsedFile({ parsed, params })
          setPreview({ ...parsed.summary, diff, delta })
          setAcknowledged(false)
        } catch (err) {
          toast.error(`Parse error: ${err.message}`)
          setFile(null)
          setParsedFile(null)
        }
      }
      reader.readAsArrayBuffer(f)
    }
    headerReader.onerror = () => {
      toast.error('Could not read file')
      setFile(null)
    }
    headerReader.readAsArrayBuffer(f.slice(0, 4))
  }

  // An upload that rewrites nearly every month it touches, or that carries less
  // history than the database already holds, is not a routine monthly update.
  // Make the admin say so out loud before it is allowed through.
  const diff = preview?.diff
  const needsAck = !!diff && (diff.wholesaleRewrite || !!diff.coverageShortfall)

  const handleUpload = useCallback(async () => {
    if (!file || !preview || !parsedFile || !entityId || !brandId) return
    if (needsAck && !acknowledged) return
    setUploading(true)
    setProgress({ pct: 0, label: 'Starting…' })
    setSuccessMsg('')

    try {
      setProgress({ pct: 35, label: 'Uploading…' })
      // ONE call. This used to be eight independent requests from the browser,
      // so a failure at step four left production half-overwritten and the
      // message named no step; a failure of the LAST one (history) reported
      // "Upload failed" for an upload that had fully committed. The edge
      // function now forwards a single transaction that also snapshots the
      // previous state first, so this is revertible.
      const res = await uploadAllTiv(
        parsedFile.parsed, parsedFile.params, entityId, brandId,
        file.name, profile.full_name,
      )

      setProgress({ pct: 100, label: 'Done!' })
      const brandName = brandsForEntity.find(b => b.id === brandId)?.name || 'brand'
      const entityName = entities.find(e => e.id === entityId)?.code
        || entities.find(e => e.id === entityId)?.full_name || 'entity'
      setSuccessMsg(
        `Uploaded ${parsedFile.parsed.summary.monthsLoaded} months for ${entityName} / ${brandName}. ` +
        `Data now runs to ${parsedFile.parsed.summary.lastDataMonth}, and the model has been retrained.` +
        (res?.snapshot_id ? ` The previous data was saved as snapshot #${res.snapshot_id}, so this can be undone.` : '')
      )
      setFile(null)
      setPreview(null)
      setParsedFile(null)
      setAcknowledged(false)
      // The panel deliberately stays OPEN. It used to collapse in the same
      // React commit that set the success message, and the message renders
      // inside the expanded body -- so a successful upload ended in silence.

      const hist = await fetchUploadHistory().catch(() => null)
      if (hist) setHistory(hist)
      if (onUploadComplete) await onUploadComplete(parsedFile.params)

    } catch (err) {
      const msg = String(err.message || '')
      if (msg.includes('cross_scope_conflict')) {
        toast.error(
          'Upload refused: these months already belong to a different entity/brand. ' +
          'Uploading here would have overwritten that dataset. Nothing was changed.'
        )
      } else if (/invalid token|not signed in|jwt/i.test(msg)) {
        toast.error('Your session is stale. Sign out, sign back in, and try again — nothing was changed.')
      } else {
        toast.error(`Upload failed: ${msg}. Nothing was changed — the whole upload is one transaction.`)
      }
    } finally {
      setUploading(false)
      setTimeout(() => setProgress(null), 1200)
    }
  }, [file, preview, parsedFile, needsAck, acknowledged, entityId, brandId, entities, brandsForEntity, profile, onUploadComplete, toast])

  async function toggleHistory() {
    const next = !showHistory
    setShowHistory(next)
    if (next && history === null) {
      try {
        const hist = await fetchUploadHistory()
        setHistory(hist)
      } catch { /* silent */ }
    }
  }

  return (
    <div className="card mb-24">
      {/* Was a bare <div onClick>: no tabIndex, no role, no key handler — so a
          keyboard user could not open the upload panel at all. */}
      <div
        className="flex-between"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(c => !c) }
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Data Upload</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>
            Upload Market_Data_YY-YY.xlsx to update actuals and retrain the model
          </div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--gray-500)' }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 16 }}>
          {/* File / parse / upload failures surface as a global toast (no banner). */}
          {successMsg && (
            <div className="alert alert-success" style={{ marginBottom: 12 }}>
              <span><Icon name="check" size={15} /></span><span>{successMsg}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <select
              className="form-select"
              aria-label="Entity"
              style={{ flex: '1 1 160px', maxWidth: 220 }}
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
            >
              <option value="">— Select Entity —</option>
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
              ))}
            </select>
            <select
              className="form-select"
              aria-label="Brand"
              style={{ flex: '1 1 160px', maxWidth: 220 }}
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              disabled={!entityId || brandsForEntity.length === 0}
            >
              <option value="">— Select Brand —</option>
              {brandsForEntity.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              Choose File
              {/* display:none removes the input from the tab order AND the
                  accessibility tree, so there was no keyboard or screen-reader
                  path to choosing a file. The clip pattern keeps it focusable
                  while staying invisible. */}
              <input
                type="file"
                accept=".xlsx,.xls"
                aria-label="Choose a Market Data workbook"
                style={{
                  position: 'absolute', width: 1, height: 1,
                  padding: 0, margin: -1, overflow: 'hidden',
                  clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0,
                }}
                onChange={handleFileChange}
              />
            </label>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>
              {file ? file.name : 'No file selected'}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
              onClick={downloadMarketDataTemplate}>
              <Icon name="download" size={14} /> Download template
            </button>
          </div>

          {lookupError && (
            <div className="tiv-banner tiv-banner-danger" role="alert" style={{ marginTop: 8 }}>
              {lookupError}
            </div>
          )}

          {/* Pre-commit review. Parsing and retraining have already run in the
              browser, so this shows what the upload would CHANGE and what
              forecast it would produce — before anything is written. */}
          {preview && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--gray-50)', borderRadius: 6, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>This file contains</div>
              <div style={{ marginBottom: 8 }}>
                {preview.monthsLoaded} months of TIV data, ending <strong>{preview.lastDataMonth}</strong>
                {preview.lastAlMonth && preview.lastAlMonth !== preview.lastDataMonth && (
                  <> · AL data only to <strong>{preview.lastAlMonth}</strong></>
                )}
              </div>

              {/* Per-sheet counts. The old preview reported only TIV, so a
                  sheet that parsed to nothing was invisible — which is how the
                  AL layer could freeze on a "successful" upload. */}
              {preview.counts && (
                <div style={{ marginBottom: 8, color: 'var(--gray-600)' }}>
                  TIV {preview.counts.tiv} · PTB {preview.counts.ptb} ·{' '}
                  <span className={preview.counts.al === 0 ? 'tiv-warn' : undefined}>AL {preview.counts.al}</span> ·
                  {' '}Judgment {preview.counts.judgTiv}/{preview.counts.judgPtb} · Raw {preview.counts.raw}
                </div>
              )}

              {diff && (
                <>
                  <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>What would change</div>
                  {diff.isFirstUpload ? (
                    <div>Nothing is stored yet — all {preview.monthsLoaded} months would be created.</div>
                  ) : (
                    <div>
                      <strong>{diff.added.length}</strong> new month{diff.added.length === 1 ? '' : 's'}
                      {diff.added.length > 0 && <> ({diff.added.slice(0, 4).join(', ')}{diff.added.length > 4 ? `, +${diff.added.length - 4} more` : ''})</>}
                      {' · '}<strong>{diff.changed.length}</strong> month{diff.changed.length === 1 ? '' : 's'} amended
                      {diff.changedCells > 0 && <> ({diff.changedCells} cell{diff.changedCells === 1 ? '' : 's'})</>}
                      {' · '}<strong>{diff.unchanged}</strong> unchanged
                      {diff.missingWithData.length > 0 && <> · {diff.missingWithData.length} month{diff.missingWithData.length === 1 ? '' : 's'} of data in the database are not in this file and would be left as they are</>}
                    </div>
                  )}

                  {/* Empty months already stored are residue from an older
                      upload that read pre-typed future rows as zeros. Named
                      plainly, because otherwise they look like the file's fault. */}
                  {diff.emptyMonths.length > 0 && (
                    <div className="tiv-warn" style={{ marginTop: 6 }}>
                      ⚠ The database also holds {diff.emptyMonths.length} empty month
                      {diff.emptyMonths.length === 1 ? '' : 's'} ({diff.emptyMonths.slice(0, 4).join(', ')}
                      {diff.emptyMonths.length > 4 ? `, +${diff.emptyMonths.length - 4} more` : ''}) that
                      this file correctly does not contain. They were written by an older upload that read
                      pre-typed future rows as zeros. Uploading will not remove them — they need clearing
                      separately.
                    </div>
                  )}

                  {diff.changed.slice(0, 6).map(m => (
                    <div key={m.month} style={{ color: 'var(--gray-600)', marginTop: 2 }}>
                      {m.month}: {m.cells.slice(0, 4).map(c => `${c.segment} ${c.from}→${c.to}`).join(' · ')}
                      {m.cells.length > 4 ? ` · +${m.cells.length - 4} more` : ''}
                    </div>
                  ))}
                  {diff.changed.length > 6 && (
                    <div style={{ color: 'var(--gray-600)', marginTop: 2 }}>…and {diff.changed.length - 6} more amended months</div>
                  )}

                  {diff.added.length === 0 && diff.changed.length === 0 && !diff.isFirstUpload && (
                    <div style={{ marginTop: 6 }}>
                      This file matches what is already stored — uploading it would change nothing.
                    </div>
                  )}
                </>
              )}

              {/* The effect in the units the business talks in. */}
              {preview.delta?.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, margin: '10px 0 4px' }}>Forecast after this upload</div>
                  <div>
                    {preview.delta.map(d => (
                      <span key={d.month} style={{ marginRight: 14 }}>
                        {d.month}: <strong>{d.after ?? '—'}</strong>
                        {d.before !== null && d.delta !== null && d.delta !== 0 && (
                          <span style={{ color: 'var(--gray-600)' }}> (was {d.before}, {d.delta > 0 ? '+' : ''}{d.delta})</span>
                        )}
                        {d.before === null && <span style={{ color: 'var(--gray-600)' }}> (new month)</span>}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {preview.warnings?.length > 0 && (
                <div className="tiv-warn" style={{ marginTop: 10 }}>
                  {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}

              {needsAck && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>This does not look like a routine update</div>
                  {diff.wholesaleRewrite && (
                    <div>Nearly every month in this file differs from what is stored. That is what a
                    different dataset — another entity or brand — looks like, and it would replace the
                    current one.</div>
                  )}
                  {diff.coverageShortfall && (
                    <div>
                      {diff.coverageShortfall.months.length} month
                      {diff.coverageShortfall.months.length === 1 ? '' : 's'} of real data in the
                      database {diff.coverageShortfall.months.length === 1 ? 'is' : 'are'} missing from
                      this file ({diff.coverageShortfall.months.slice(0, 5).join(', ')}
                      {diff.coverageShortfall.months.length > 5 ? ', …' : ''}). The model is retrained on
                      the FILE, so it would be trained on less history than the page still displays.
                    </div>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                    <span>I have checked this and want to continue</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {file && preview && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
              onClick={handleUpload}
              disabled={uploading || !entityId || !brandId || (needsAck && !acknowledged)}
            >
              {uploading
                ? 'Uploading…'
                : !entityId || !brandId
                  ? 'Choose an entity and brand first'
                  /* The button says exactly what it will do, to whom. The old
                     label ("Upload & Retrain") never named the target, so a
                     mis-picked dropdown was invisible before AND after. */
                  : `Upload ${preview.monthsLoaded} months to ${entities.find(e => e.id === entityId)?.code || 'entity'} / ${brandsForEntity.find(b => b.id === brandId)?.name || 'brand'}`}
            </button>
          )}

          {/* Progress bar. Was nested plain divs with no role and no live
              region, so an upload that rewrites six production tables gave a
              screen-reader user no feedback at all. */}
          {progress && (
            <div
              style={{ marginTop: 14 }}
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={progress.label}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-600)', marginBottom: 5 }}>
                <span>{progress.label}</span>
                <span style={{ fontWeight: 700 }}>{progress.pct}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${progress.pct}%`,
                  background: progress.pct === 100 ? 'var(--green)' : 'var(--blue)',
                  borderRadius: 99,
                  transition: 'width 0.35s ease',
                }} />
              </div>
            </div>
          )}

          {/* Upload history toggle */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--gray-100)', paddingTop: 12 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={toggleHistory}
            >
              {showHistory ? '▴ Hide Upload History' : '▾ Upload History'}
            </button>

            {showHistory && (
              <div style={{ marginTop: 12 }}>
                {history === null ? (
                  <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>Loading…</div>
                ) : history.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>No uploads yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Uploaded By</th>
                          <th>File</th>
                          <th>Months</th>
                          <th>Last Month</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {new Date(h.uploaded_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td>{h.uploader_name || '—'}</td>
                            <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--gray-500)' }}>{h.file_name}</td>
                            <td style={{ textAlign: 'center' }}>{h.months_loaded ?? '—'}</td>
                            <td>{h.last_data_month || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
