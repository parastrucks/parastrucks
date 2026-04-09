// TIV Forecast — trigger definitions (direct port from migration spec Section 6)
import { SEGMENTS } from '../constants'

const ALL_SEGMENTS = [...SEGMENTS]

export const TRIGGER_DEFS = [
  {
    id: 'fyPush',
    name: 'FY End Push / Hangover',
    desc: 'March billing push amplification, April hangover, slight May drag',
    affected: ALL_SEGMENTS,
    // effect multiplier per month: +sev% in Mar, -sev% in Apr, -40% of sev in May
    monthEffect: { 3: 1, 4: -1, 5: -0.4 },
    type: 'custom',
    defaultSev: 12,
    max: 30,
  },
  {
    id: 'ais153',
    name: 'AIS 153 Bus Recovery',
    desc: 'Body builder licence approvals boost MDV Bus through Q1-Q2 FY27, 30% spillover to ICV Trucks',
    affected: ['Bus PVT', 'ICV Trucks'],
    segWeight: { 'Bus PVT': 1.0, 'ICV Trucks': 0.3 },
    months: [4, 5, 6, 7, 8, 9],
    type: 'boost',
    defaultSev: 20,
    max: 50,
  },
  {
    id: 'monsoon',
    name: 'Monsoon Dampening',
    desc: 'Jul–Sep construction slowdown affecting Tippers',
    affected: ['Tipper'],
    months: [7, 8, 9],
    type: 'dampen',
    defaultSev: 5,
    max: 20,
  },
  {
    id: 'navratri',
    name: 'Navratri 2026 (Oct 11–19)',
    desc: 'Week 2–3 of October. Tipper gets auspicious boost, other segments see mild disruption',
    affected: ALL_SEGMENTS,
    segEffect: {
      'Bus PVT': -0.5, 'Haulage': -0.5, 'MAV': -0.5,
      'Tractor': -0.5, 'Tipper': 1.0, 'ICV Trucks': -0.5,
    },
    months: [10],
    type: 'segcustom',
    defaultSev: 10,
    max: 25,
  },
  {
    id: 'diwali',
    name: 'Diwali 2026 (Nov 8) + Vacation',
    desc: 'Week 2 of November plus 5-day Ahmedabad vacation kills ~35% of November capacity',
    affected: ALL_SEGMENTS,
    months: [11],
    type: 'dampen',
    defaultSev: 30,
    max: 50,
  },
  {
    id: 'credit',
    name: 'Credit Environment',
    desc: 'Interest rate / bank lending ease affecting all segments',
    affected: ALL_SEGMENTS,
    months: [1,2,3,4,5,6,7,8,9,10,11,12],
    type: 'both',
    defaultSev: 0,
    max: 15,
  },
  {
    id: 'fuelCrisis',
    name: 'Iran War + Input Cost',
    desc: 'Strait of Hormuz disruption. Fuel-cost-sensitive segments defer purchases. 2% OEM cost pass-through expected.',
    affected: ['Haulage', 'MAV', 'Tractor'],
    months: [1,2,3,4,5,6,7,8,9,10,11,12],
    type: 'dampen',
    defaultSev: 12,
    max: 30,
  },
]

// Triggers that should be ON by default when no saved state exists
export const DEFAULT_ON_TRIGGERS = ['fyPush', 'ais153', 'fuelCrisis']

// Build initial trigger state from defaults
export function buildDefaultTriggerState() {
  const state = {}
  for (const def of TRIGGER_DEFS) {
    state[def.id] = {
      on:        DEFAULT_ON_TRIGGERS.includes(def.id),
      severity:  def.defaultSev,
      direction: def.type === 'both' ? 'dampen' : undefined,
    }
  }
  return state
}
