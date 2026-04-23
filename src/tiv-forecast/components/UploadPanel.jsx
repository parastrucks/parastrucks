// TIV Forecast — Upload Panel (admin-only)
import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { parseExcelFile } from '../lib/parseExcel'
import { retrainModel } from '../lib/retrainModel'
import {
  upsertTivActuals, upsertPtbActuals, upsertAlActuals,
  upsertJudgmentTiv, upsertJudgmentPtb, upsertRawData,
  insertModelParams, insertUploadHistory, fetchUploadHistory,
} from '../lib/dataQueries'

export default function UploadPanel({ onUploadComplete }) {
  const { profile, isAdmin } = useAuth()
  const [collapsed, setCollapsed]         = useState(true)
  const [file, setFile]                   = useState(null)
  const [preview, setPreview]             = useState(null)  // { monthsLoaded, lastDataMonth }
  const [uploading, setUploading]         = useState(false)
  const [progress, setProgress]           = useState(null)  // { pct: 0-100, step: 'label' }
  const [parseError, setParseError]       = useState('')
  const [successMsg, setSuccessMsg]       = useState('')
  const [history, setHistory]             = useState(null)  // null = not loaded yet
  const [showHistory, setShowHistory]     = useState(false)
  const [entities, setEntities]           = useState([])
  const [entityId, setEntityId]           = useState('')
  const [brandsForEntity, setBrandsForEntity] = useState([])
  const [brandId, setBrandId]             = useState('')

  useEffect(() => {
    if (collapsed) return
    supabase.from('entities').select('id, full_name, code').order('full_name')
      .then(({ data, error }) => {
        if (error) console.error('Failed to load entities:', error)
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
      .then(({ data }) => {
        const seen = {}
        const brands = []
        for (const row of data || []) {
          if (row.brands && !seen[row.brand_id]) {
            seen[row.brand_id] = true
            brands.push(row.brands)
          }
        }
        setBrandsForEntity(brands)
      })
  }, [entityId])

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
    setParseError('')
    setSuccessMsg('')
    setPreview(null)
    if (!f) { setFile(null); return }

    if (f.size > 5 * 1024 * 1024) {
      setParseError('File must be 5 MB or smaller')
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
        setParseError('File is not a valid .xlsx workbook')
        setFile(null)
        e.target.value = ''
        return
      }

      setFile(f)
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const parsed = parseExcelFile(evt.target.result)
          setPreview(parsed.summary)
        } catch (err) {
          setParseError(`Parse error: ${err.message}`)
          setFile(null)
        }
      }
      reader.readAsArrayBuffer(f)
    }
    headerReader.onerror = () => {
      setParseError('Could not read file')
      setFile(null)
    }
    headerReader.readAsArrayBuffer(f.slice(0, 4))
  }

  const handleUpload = useCallback(async () => {
    if (!file || !preview || !entityId || !brandId) return
    setUploading(true)
    setProgress({ pct: 0, label: 'Starting…' })
    setParseError('')
    setSuccessMsg('')

    const step = (s) => setProgress(UPLOAD_STEPS[s])

    try {
      step(0)  // 10% — parsing
      const buf = await file.arrayBuffer()
      const parsed = parseExcelFile(buf)

      step(1)  // 25% — TIV actuals
      await upsertTivActuals(parsed.tivActuals, entityId, brandId)

      step(2)  // 37% — PTB actuals
      await upsertPtbActuals(parsed.ptbActuals, entityId, brandId)

      step(3)  // 50% — AL actuals
      await upsertAlActuals(parsed.alActuals, entityId, brandId)

      step(4)  // 62% — judgment forecasts
      await upsertJudgmentTiv(parsed.judgmentTiv, entityId, brandId)
      await upsertJudgmentPtb(parsed.judgmentPtb, entityId, brandId)

      step(5)  // 75% — raw data
      await upsertRawData(parsed.rawRows, entityId, brandId)

      step(6)  // 88% — retrain
      const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
      await insertModelParams(params, entityId, brandId)

      step(7)  // 95% — upload record
      await insertUploadHistory({
        userId:         profile.id,
        uploaderName:   profile.full_name,
        fileName:       file.name,
        monthsLoaded:   parsed.summary.monthsLoaded,
        lastDataMonth:  parsed.summary.lastDataMonth,
      })

      step(8)  // 100% — done
      setSuccessMsg(`Upload complete — ${parsed.summary.monthsLoaded} months loaded. Last data: ${parsed.summary.lastDataMonth}`)
      setFile(null)
      setPreview(null)
      setCollapsed(true)  // auto-collapse after upload

      // Reload history if visible
      const hist = await fetchUploadHistory()
      setHistory(hist)
      if (showHistory) setShowHistory(true)  // keeps it open and shows refreshed data

      if (onUploadComplete) onUploadComplete(params)

    } catch (err) {
      setParseError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      setTimeout(() => setProgress(null), 1200)
    }
  }, [file, preview, entityId, brandId, profile, onUploadComplete, showHistory])

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
      <div
        className="flex-between"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Data Upload</div>
          <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 2 }}>
            Upload Market_Data_YY-YY.xlsx to update actuals and retrain the model
          </div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--gray-400)' }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 16 }}>
          {parseError && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <span>⚠</span><span>{parseError}</span>
            </div>
          )}
          {successMsg && (
            <div className="alert alert-success" style={{ marginBottom: 12 }}>
              <span>✓</span><span>{successMsg}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <select
              className="form-select"
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
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>
              {file ? file.name : 'No file selected'}
            </span>
          </div>

          {preview && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--gray-50)', borderRadius: 6, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>Preview: </span>
              {preview.monthsLoaded} months found · Last data month: <strong>{preview.lastDataMonth}</strong>
            </div>
          )}

          {file && preview && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
              onClick={handleUpload}
              disabled={uploading || !entityId || !brandId}
              title={!entityId || !brandId ? 'Select entity and brand first' : undefined}
            >
              {uploading ? 'Uploading…' : 'Upload & Retrain'}
            </button>
          )}

          {/* Progress bar */}
          {progress && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-500)', marginBottom: 5 }}>
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
                  <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Loading…</div>
                ) : history.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>No uploads yet.</div>
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
