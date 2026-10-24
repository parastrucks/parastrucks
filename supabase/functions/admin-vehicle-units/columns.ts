// supabase/functions/admin-vehicle-units/columns.ts
// Phase 10 — the column catalogue of public.vehicle_units, and how a value for each is checked.
//
// Pure module (no Deno APIs) so scripts/phase10/selftest-vehicle-units.mjs imports exactly what
// the deployed function runs. That self-test also reads the migration and fails if this list and
// the table (or the SQL editable allowlist in tracker_apply_changes) ever drift apart.

export type ColType = "text" | "numeric" | "integer" | "date" | "uuid" | "timestamptz" | "boolean"

export type ColSpec = {
  type: ColType
  editable?: boolean          // in tracker_apply_changes' allowlist
  computed?: boolean          // written by vehicle_units_compute(); never by a client
  notNull?: boolean
  oneOf?: (string | number)[] // CHECK (… in (…))
  min?: number                // CHECK (… >= min)
  max?: number
}

const E = { editable: true } as const
const C = { computed: true } as const

export const COLUMNS: Record<string, ColSpec> = {
  id:                       { type: "uuid" },
  // A · identity
  chassis_no:               { type: "text", ...E, notNull: true },
  engine_no:                { type: "text", ...E },
  model:                    { type: "text", ...E },
  vpart_no:                 { type: "text", ...E },
  hsn_code:                 { type: "text", ...E },
  make_year:                { type: "integer", ...C },
  mfrs_year:                { type: "integer", ...E },
  segment:                  { type: "text", ...E },
  customer_name:            { type: "text", ...E },
  qty:                      { type: "integer", ...E, notNull: true, min: 0 },
  // B · purchase from Ashok Leyland
  purchase_source:          { type: "text", ...E, notNull: true, oneOf: ["al", "other_dealer"] },
  oem_gatepass_no:          { type: "text", ...E },
  oem_gatepass_date:        { type: "date", ...E },
  odn_no:                   { type: "text", ...E },
  ctc:                      { type: "numeric", ...E },
  ctd:                      { type: "numeric", ...E },
  ctc_basis:                { type: "text", ...E, oneOf: ["inclusive", "exclusive"] },
  amc_to_al:                { type: "numeric", ...E },
  dsa:                      { type: "numeric", ...E },
  ad_blue:                  { type: "numeric", ...E },
  retention_dealer:         { type: "numeric", ...C },
  payment_amount:           { type: "numeric", ...C },
  tds:                      { type: "numeric", ...C },
  total_payment_to_al:      { type: "numeric", ...C },
  al_payment_status:        { type: "text", ...E },
  mto_advance:              { type: "text", ...E, oneOf: ["Yes", "No"] },  // make-to-order 5% advance paid (owner, 2026-10-23)
  al_payment_date:          { type: "date", ...E },
  ptb_invoice_date:         { type: "date", ...E },
  gst_rate:                 { type: "numeric", ...C },
  gst_rate_override:        { type: "numeric", ...E, oneOf: [5, 12, 18, 28] },
  supplier_invoice_no:      { type: "text", ...E },
  supplier_invoice_date:    { type: "date", ...E },
  supplier_invoice_amount:  { type: "numeric", ...E },
  diff_amount:              { type: "numeric", ...C },
  diff_base:                { type: "numeric", ...C },
  diff_gst:                 { type: "numeric", ...C },
  diff_tds:                 { type: "numeric", ...C },
  total_difference:         { type: "numeric", ...C },
  parts_pkg:                { type: "text", ...E },
  // C · retail sale, finance, delivery, refund
  dse:                      { type: "text", ...E },
  delivery_location:        { type: "text", ...E },
  finance_bank:             { type: "text", ...E },
  do_date:                  { type: "date", ...E },
  do_amount:                { type: "numeric", ...E },
  mrp:                      { type: "numeric", ...E },
  tally_bill:               { type: "numeric", ...E },
  amc_charged_to_customer:  { type: "text", ...E },
  tcs:                      { type: "numeric", ...C },
  total:                    { type: "numeric", ...C },
  margin_money:             { type: "numeric", ...E },
  finance_recd:             { type: "numeric", ...E },
  finance_paymt_recd_date:  { type: "date", ...E },
  subvention:               { type: "numeric", ...E },
  total_recd:               { type: "numeric", ...C },
  insurance:                { type: "numeric", ...E },
  cretem:                   { type: "numeric", ...E },
  road_tax_pct:             { type: "numeric", ...E, notNull: true, min: 0, max: 20 },
  full_tax:                 { type: "numeric", ...C },
  full_tax_override:        { type: "numeric", ...E },
  total_receivable:         { type: "numeric", ...C },
  net_refund:               { type: "numeric", ...C },
  refund_status:            { type: "text", ...E },
  delivery_status:          { type: "text", ...E },
  payment_status:           { type: "text", ...C },
  ad_blu_given:             { type: "text", ...E },
  endhan:                   { type: "text", ...E },
  endhan_date:              { type: "date", ...E },  // the day the Endhan was given (owner, 2026-10-23)
  // D · retention
  dsm:                      { type: "text", ...E },
  date_of_retail:           { type: "date", ...E },
  al_retail_date:           { type: "date", ...E },  // the retail date on the AL claim (owner, 2026-10-24)
  date_of_delivery:         { type: "date", ...E },
  other_deductions:         { type: "numeric", ...E },
  retention_internal:       { type: "numeric", ...C },
  retention_al_claim:       { type: "numeric", ...E },
  app_amt:                  { type: "numeric", ...C },
  retention_remarks:        { type: "text", ...E },
  sale_category:            { type: "text", ...E },
  al_invoice_no:            { type: "text", ...E },
  dealer_invoice_no:        { type: "text", ...E },
  al_claim_age:             { type: "integer", ...E },
  al_claim_interest:        { type: "numeric", ...E },
  // E · inter-dealer, cancel/rebill
  sold_to_dealer:           { type: "text", ...E },
  dealer_basic_value:       { type: "numeric", ...C },
  dealer_tds:               { type: "numeric", ...C },
  dealer_net_payable:       { type: "numeric", ...C },
  vehicle_location:         { type: "text", ...E },
  actual_delivery:          { type: "text", ...E },
  rebill_delivery_date:     { type: "date", ...E },
  // F · system
  superseded_at:            { type: "timestamptz" },
  superseded_by_id:         { type: "uuid" },
  notes:                    { type: "text", ...E },
  user_field_1:             { type: "text", ...E },
  user_field_2:             { type: "text", ...E },
  user_field_3:             { type: "text", ...E },
  user_field_4:             { type: "text", ...E },
  user_field_5:             { type: "text", ...E },
  source_file:              { type: "text" },
  source_row:               { type: "integer" },
  import_batch_id:          { type: "uuid" },
  recompute:                { type: "boolean" },
  created_at:               { type: "timestamptz" },
  created_by:               { type: "uuid" },
  updated_at:               { type: "timestamptz" },
  updated_by:               { type: "uuid" },
}

// The incentive figures live in their own table and are shown to admin + HR only.
export const INCENTIVE_COLUMNS = ["dse_incentive_override", "dsm_incentive", "gm_incentive"] as const
export const INCENTIVE_SPEC: ColSpec = { type: "numeric" }

// Worked out on screen from other columns and today's date; never stored.
export const SCREEN_COLUMNS = ["ageing_days", "interest_on_ageing", "dse_incentive"] as const

// Always returned by `list`, whatever the layout asks for: the row's identity, the before-value
// clock, and whether it has been rebilled.
export const ALWAYS_READ = ["id", "updated_at", "superseded_at", "superseded_by_id"] as const

export const EDITABLE = Object.keys(COLUMNS).filter((k) => COLUMNS[k].editable)
export const isEditable = (k: string) => COLUMNS[k]?.editable === true
export const isStoredColumn = (k: string) => Object.prototype.hasOwnProperty.call(COLUMNS, k)
export const isIncentive = (k: string) => (INCENTIVE_COLUMNS as readonly string[]).includes(k)
export const isScreenColumn = (k: string) => (SCREEN_COLUMNS as readonly string[]).includes(k)

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

export type Checked = { ok: true; value: string | number | null } | { ok: false; reason: string }

// Check one value for one column, the way the database would — but saying WHICH cell and why,
// where Postgres would abort the batch with a bare "invalid input syntax".
// Deliberately strict: "12,34,567" is refused, never guessed at. Converting what Excel pastes is
// the save adapter's job (duty 2); the server only accepts a value it does not have to interpret.
export function checkValue(spec: ColSpec, raw: unknown): Checked {
  let v: unknown = raw
  if (typeof v === "string") {
    v = v.trim()
    if (v === "") v = null
  }
  if (v === undefined || v === null) {
    return spec.notNull ? { ok: false, reason: "cannot be blank" } : { ok: true, value: null }
  }

  switch (spec.type) {
    case "text": {
      if (typeof v === "number" && Number.isFinite(v)) v = String(v)
      if (typeof v !== "string") return { ok: false, reason: "not text" }
      if (v.length > 2000) return { ok: false, reason: "longer than 2000 characters" }
      if (v.startsWith("=")) return { ok: false, reason: "formulas are not allowed in data cells" }
      if (spec.oneOf && !spec.oneOf.includes(v)) return { ok: false, reason: `must be one of ${spec.oneOf.join(", ")}` }
      return { ok: true, value: v }
    }
    case "numeric":
    case "integer": {
      let n: number
      if (typeof v === "number") n = v
      else if (typeof v === "string" && PLAIN_NUMBER.test(v)) n = Number(v)
      else return { ok: false, reason: typeof v === "string" && v.startsWith("=") ? "formulas are not allowed in data cells" : "not a number" }
      if (!Number.isFinite(n)) return { ok: false, reason: "not a number" }
      if (spec.type === "integer" && !Number.isInteger(n)) return { ok: false, reason: "must be a whole number" }
      if (spec.type === "integer" && Math.abs(n) > 2147483647) return { ok: false, reason: "too large" }
      if (spec.min !== undefined && n < spec.min) return { ok: false, reason: `must be at least ${spec.min}` }
      if (spec.max !== undefined && n > spec.max) return { ok: false, reason: `must be at most ${spec.max}` }
      if (spec.oneOf && !spec.oneOf.includes(n)) return { ok: false, reason: `must be one of ${spec.oneOf.join(", ")}` }
      return { ok: true, value: n }
    }
    case "date": {
      if (typeof v !== "string") return { ok: false, reason: "not a date (expected YYYY-MM-DD)" }
      const m = ISO_DATE.exec(v)
      if (!m) return { ok: false, reason: "not a date (expected YYYY-MM-DD)" }
      const y = +m[1], mo = +m[2], d = +m[3]
      const dt = new Date(Date.UTC(y, mo - 1, d))
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
        return { ok: false, reason: "no such date" }
      }
      if (y < 2000 || y > 2100) return { ok: false, reason: "year out of range" }
      return { ok: true, value: v }
    }
    default:
      return { ok: false, reason: "not an editable column" }
  }
}
