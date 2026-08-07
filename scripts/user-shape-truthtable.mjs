// ============================================================================
// user-shape-truthtable — exhaustive check of the user-shape rules.
//   node scripts/user-shape-truthtable.mjs
//
// Exercises every department x tier combination (8 x 3 = 24), not a sample.
// Exits non-zero on any hole, so it can gate a change to src/lib/userShape.js.
//
// What it proves:
//   1. primary_outlet and >=1 brand are required for EVERY combination — the
//      omission that let accounts/hr/pdi users be created incomplete.
//   2. An empty form is rejected in all 24 — no department is a free pass.
//   3. A complete form is accepted in all 24 — no false rejections.
//   4. Back Office GM without a sub-department PASSES (they head all three, so
//      naming one would invent data) while a BO manager FAILS.
//   5. Stale values in inapplicable slots are DROPPED from the payload. This is
//      the promoted-GM bug fixed structurally: the old form hid the
//      sub-department control for GMs but kept submitting its stale value.
// ============================================================================
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { SLOT, requirementFor, validateSlots, buildSlotPayload } =
  await import(pathToFileURL(join(here, '..', 'src', 'lib', 'userShape.js')).href)

const DEPTS = ['sales', 'service', 'spares', 'accounts', 'hr', 'back_office', 'pdi', 'admin']
const TIERS = ['gm', 'manager', 'executive']
const EMPTY    = { primary_outlet_id: '', subdept_id: '', brand_ids: [], sales_vertical_ids: [] }
const COMPLETE = { primary_outlet_id: 'o1', subdept_id: 's1', brand_ids: ['b1'], sales_vertical_ids: ['v1'] }

let failures = 0
const fail = (msg) => { console.error('  FAIL:', msg); failures++ }

console.log('requirements per department x tier — outlet | brands | verticals | subdept')
for (const d of DEPTS) {
  for (const t of TIERS) {
    const r = (s) => requirementFor(s, d, t).requirement === 'required' ? 'REQ' : ' - '
    console.log(`  ${d.padEnd(12)} ${t.padEnd(10)} ${r(SLOT.PRIMARY_OUTLET)} | ${r(SLOT.BRANDS)} | ${r(SLOT.VERTICALS)} | ${r(SLOT.SUBDEPT)}`)
    // (1) the two universals, asserted rather than eyeballed
    if (requirementFor(SLOT.PRIMARY_OUTLET, d, t).requirement !== 'required') fail(`${d}/${t}: outlet not required`)
    if (requirementFor(SLOT.BRANDS, d, t).requirement !== 'required') fail(`${d}/${t}: brands not required`)
    // (2) + (3)
    if (!validateSlots({ ...EMPTY, permission_level: t }, d)) fail(`${d}/${t}: an EMPTY form was accepted`)
    const e = validateSlots({ ...COMPLETE, permission_level: t }, d)
    if (e) fail(`${d}/${t}: a COMPLETE form was rejected (${e.message})`)
    // every not-applicable slot must state a reason the user can read
    for (const s of [SLOT.VERTICALS, SLOT.SUBDEPT]) {
      const req = requirementFor(s, d, t)
      if (req.requirement === 'not_applicable' && !req.reason) fail(`${d}/${t}: ${s} is N/A with no reason given`)
    }
  }
}

// (4) the Back Office GM exemption, both directions
const bo = (t) => validateSlots({ ...COMPLETE, subdept_id: '', permission_level: t }, 'back_office')
if (bo('gm')) fail('back_office GM without a sub-department should PASS')
if (!bo('manager')) fail('back_office manager without a sub-department should FAIL')

// (5) stale values in inapplicable slots must not survive into the payload
const staleForm = { primary_outlet_id: 'o1', subdept_id: 'STALE', brand_ids: ['b1'], sales_vertical_ids: ['STALE'] }
const gmPayload = buildSlotPayload({ ...staleForm, permission_level: 'gm' }, 'back_office')
if (gmPayload.subdept_id !== null) fail('a promoted BO GM still submits their stale sub-department')
if (gmPayload.sales_vertical_ids.length !== 0) fail('back_office still submits sales verticals')
const acctPayload = buildSlotPayload({ ...staleForm, permission_level: 'executive' }, 'accounts')
if (acctPayload.sales_vertical_ids.length !== 0) fail('accounts still submits sales verticals')
if (acctPayload.brand_ids.length !== 1) fail('accounts dropped its brands — they are required')

console.log(failures === 0
  ? `\nOK — ${DEPTS.length * TIERS.length} combinations, no holes.`
  : `\n${failures} FAILURE(S).`)
process.exit(failures === 0 ? 0 : 1)
