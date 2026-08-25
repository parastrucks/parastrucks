// TIV Forecast — Trigger Controls Tab
import { useState } from 'react'
import { TRIGGER_DEFS } from '../lib/triggerDefs'

export default function TriggerControlsTab({ triggerState, onTriggerChange, onResetTriggers }) {
  const [draggingId, setDraggingId] = useState(null)

  function handleToggle(id) {
    const current = triggerState[id] || {}
    onTriggerChange(id, { ...current, on: !current.on })
  }

  function handleSeverity(id, val) {
    const current = triggerState[id] || {}
    onTriggerChange(id, { ...current, severity: Number(val) })
  }

  function handleDirection(id, dir) {
    const current = triggerState[id] || {}
    onTriggerChange(id, { ...current, direction: dir })
  }

  const activeCount = TRIGGER_DEFS.filter(d => triggerState[d.id]?.on).length

  return (
    <div>
      {/* Trigger state is stored per user (tiv_forecast_trigger_state is keyed
          on user_id with matching RLS), so these are a private what-if — but
          nothing said so, and the owner could reasonably believe he had pushed
          a scenario to everyone. Say it, and offer a way back to the baseline. */}
      <div className="tiv-note tiv-note-top" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <strong style={{ color: 'var(--gray-700)' }}>These are your own what-if adjustments.</strong>
            {' '}They change only what you see — everyone else keeps the base forecast — and they
            stay switched on for you until you turn them off. The v3.0 forecast is judgment-free
            with every trigger OFF.
          </div>
          {activeCount > 0 && onResetTriggers && (
            <button className="btn btn-secondary btn-sm" onClick={onResetTriggers}>
              Reset all to base ({activeCount} on)
            </button>
          )}
        </div>
      </div>

      {/* Weekly booking pattern info box */}
      <div style={{
        background: 'var(--blue-light)',
        border: '1px solid var(--blue)',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 13,
        color: 'var(--gray-700)',
      }}>
        <strong>PTB weekly booking pattern (10/20/30/40):</strong> Week 1 = 10% (deliveries + lost-order analysis),
        Week 2 = 20% (lead gathering), Week 3 = 30% (prospect filtering), Week 4 = 40% (order closure).
        Festival impact is calibrated to this pattern — e.g. Diwali in Week 2 with a 5-day vacation wipes
        Week 2 entirely and halves Week 3, equal to ~35% of monthly bookings.
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {TRIGGER_DEFS.map(def => {
          const state = triggerState[def.id] || { on: false, severity: def.defaultSev, direction: 'dampen' }
          const isOn  = !!state.on
          const sev   = state.severity ?? def.defaultSev
          const isDragging = draggingId === def.id

          return (
            <div
              key={def.id}
              className="card"
              style={{
                padding: '14px 16px',
                borderLeft: `3px solid ${isOn ? 'var(--blue)' : 'var(--gray-200)'}`,
                opacity: isOn ? 1 : 0.7,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Toggle */}
                {/* The label wrapping this checkbox contains no text, so a
                    screen reader announced "checkbox, not checked" with no clue
                    which of the several triggers it belonged to. */}
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0, marginTop: 2 }}>
                  <input
                    type="checkbox"
                    checked={isOn}
                    aria-label={`${def.name} — on or off`}
                    onChange={() => handleToggle(def.id)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                </label>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{def.name}</span>
                    <span className={`badge ${isOn ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                      {isOn ? 'ON' : 'OFF'}
                    </span>
                    {isOn && (
                      <span
                        className="badge badge-amber"
                        style={{
                          fontSize: isDragging ? 13 : 11,
                          fontWeight: isDragging ? 800 : 600,
                          background: isDragging ? 'var(--amber)' : undefined,
                          color: isDragging ? '#fff' : undefined,
                          transition: 'all 0.1s',
                          padding: isDragging ? '3px 9px' : undefined,
                        }}
                      >
                        {sev}%{def.type === 'both' ? ` · ${state.direction}` : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 3 }}>{def.desc}</div>

                  {isOn && (
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      {/* Severity slider */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180,
                        background: isDragging ? 'var(--blue-light)' : 'transparent',
                        borderRadius: 6,
                        padding: isDragging ? '6px 10px' : '0',
                        transition: 'all 0.15s',
                      }}>
                        <span style={{
                          fontSize: 12,
                          color: isDragging ? 'var(--blue)' : 'var(--gray-500)',
                          whiteSpace: 'nowrap',
                          fontWeight: isDragging ? 700 : 400,
                          transition: 'all 0.1s',
                        }}>
                          Severity: {sev}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={def.max}
                          step={1}
                          value={sev}
                          aria-label={`Severity for ${def.name}`}
                          aria-valuetext={`${sev}%`}
                          onChange={e => handleSeverity(def.id, e.target.value)}
                          onMouseDown={() => setDraggingId(def.id)}
                          onMouseUp={() => setDraggingId(null)}
                          onTouchStart={() => setDraggingId(def.id)}
                          onTouchEnd={() => setDraggingId(null)}
                          className="tiv-slider"
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>max {def.max}%</span>
                      </div>

                      {/* Direction toggle for "both" type triggers */}
                      {def.type === 'both' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className={`btn btn-sm ${state.direction === 'boost' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => handleDirection(def.id, 'boost')}
                          >
                            ↑ Boost
                          </button>
                          <button
                            className={`btn btn-sm ${state.direction !== 'boost' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => handleDirection(def.id, 'dampen')}
                          >
                            ↓ Dampen
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
