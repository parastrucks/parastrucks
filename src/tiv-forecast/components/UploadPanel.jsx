// TIV Forecast — Upload Panel (admin-only)
import { useState, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { parseExcelFile } from '../lib/parseExcel'
import { retrainModel } from '../lib/retrainModel'
import {
  upsertTivActuals, upsertPtbActuals, upsertAlActuals,
  upsertJudgmentTiv, upsertJudgmentPtb, upsertRawData,
  insertModelParams, insertUploadHistory, fetchUploadHistory,
} from '../lib/dataQueries'

export default function UploadPanel({ onUploadComplete }) {
  const { profile, isAdmin } = useAuth()
  const [collapsed, setCollapsed]   = useState(false)
  const [file, setFile]             = useState(null)
  const [preview, setPreview]       = useState(null)  // { monthsLoaded, lastDataMonth }
  const [uploading, setUploading]   = useState(false)
  const [parseError, setParseError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [history, setHistory]       = useState(null)  // null = not loaded yet

  if (!isAdmin) return null

  function handleFileChange(e) {
    const f = e.target.files[0]
    setFile(f)
    setParseError('')
    setSuccessMsg('')
    setPreview(null)
    if (!f) return

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

  const handleUpload = useCallback(async () => {
    if (!file || !preview) return
    setUploading(true)
    setParseError('')
    setSuccessMsg('')

    try {
      // Re-parse (file reader is async; we store result in state but re-parse for reliability)
      const buf = await file.arrayBuffer()
      const parsed = parseExcelFile(buf)

      // Upsert all six data tables
      await Promise.all([
        upsertTivActuals(parsed.tivActuals),
        upsertPtbActuals(parsed.ptbActuals),
        upsertJudgmentTiv(parsed.judgmentTiv),
        upsertJudgmentPtb(parsed.judgmentPtb),
        upsertAlActuals(parsed.alActuals),
        upsertRawData(parsed.rawRows),
      ])

      // Retrain model on updated data
      const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
      await insertModelParams(params)

      // Record upload history
      await insertUploadHistory({
        userId:         profile.id,
        uploaderName:   profile.full_name,
        fileName:       file.name,
        monthsLoaded:   parsed.summary.monthsLoaded,
        lastDataMonth:  parsed.summary.lastDataMonth,
      })

      setSuccessMsg(`Upload complete — ${parsed.summary.monthsLoaded} months loaded. Last data: ${parsed.summary.lastDataMonth}`)
      setFile(null)
      setPreview(null)

      // Reload history
      const hist = await fetchUploadHistory()
      setHistory(hist)

      // Notify parent to refresh forecast
      if (onUploadComplete) onUploadComplete(params)

    } catch (err) {
      setParseError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }, [file, preview, profile, onUploadComplete])

  async function loadHistory() {
    if (history !== null) return
    try {
      const hist = await fetchUploadHistory()
      setHistory(hist)
    } catch { /* silent */ }
  }

  return (
    <div className="card mb-24">
      <div
        className="flex-between"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => { setCollapsed(c => !c); loadHistory() }}
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
              disabled={uploading}
            >
              {uploading ? <><span className="spinner spinner-sm" /> Uploading…</> : 'Upload & Retrain'}
            </button>
          )}

          {/* Upload history */}
          {history !== null && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--gray-600)' }}>
                Upload History
              </div>
              {history.length === 0 ? (
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
      )}
    </div>
  )
}
