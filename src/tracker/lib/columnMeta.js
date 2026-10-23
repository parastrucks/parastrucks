// Phase 10 — what the grid shows for each column: its header, group, width and whether people may
// type into it. Types, the editable list and value checks are NOT repeated here: they come from the
// Edge Function's own catalogue (columns.ts), so the screen can never offer an edit the server refuses.
// Headers are the workbooks' own wording (docs/backlog/phase10-column-map.md), so the team
// recognises every column.
import { COLUMNS, INCENTIVE_COLUMNS, INCENTIVE_SPEC } from '../../../supabase/functions/admin-vehicle-units/columns.ts'

export const GROUPS = {
  A: 'Vehicle',
  B: 'Purchase from AL',
  C: 'Sale, finance, delivery',
  D: 'Retention',
  E: 'Dealer, rebill',
  F: 'Notes',
}

// key → [header, group, width]. Order here is the order on screen.
const SHOWN = [
  ['chassis_no', 'Chassis No', 'A', 170], ['engine_no', 'Engine No', 'A', 130], ['model', 'Model', 'A', 170],
  ['vpart_no', 'V Part No', 'A', 130], ['hsn_code', 'HSN Code', 'A', 90], ['make_year', 'Make', 'A', 60],
  ['mfrs_year', 'Mfrs Year', 'A', 85], ['segment', 'Segment', 'A', 100], ['customer_name', 'Customer Name', 'A', 200],
  ['qty', 'Qty', 'A', 50],

  ['purchase_source', 'Bought From', 'B', 100], ['oem_gatepass_no', 'OEM Gatepass No', 'B', 140],
  ['oem_gatepass_date', 'OEM Gatepass Date', 'B', 100], ['odn_no', 'ODN No', 'B', 120],
  ['ctc', 'CTC', 'B', 110], ['ctd', 'CTD', 'B', 110], ['ctc_basis', 'CTC Basis', 'B', 90],
  ['amc_to_al', 'AMC/Service', 'B', 100], ['dsa', 'DSA', 'B', 90], ['ad_blue', 'AD Blue', 'B', 90],
  ['retention_dealer', 'Retention', 'B', 100], ['payment_amount', 'Payment Amount', 'B', 120],
  ['tds', 'TDS', 'B', 80], ['total_payment_to_al', 'Total Payment to AL', 'B', 130],
  ['al_payment_status', 'AL Payment Status', 'B', 120], ['al_payment_date', 'AL Payment Date', 'B', 100],
  ['ptb_invoice_date', 'PTB Invoice Date', 'B', 100], ['ageing_days', 'Ageing', 'B', 70],
  ['interest_on_ageing', 'Interest', 'B', 90], ['gst_rate', 'GST %', 'B', 60], ['gst_rate_override', 'GST % Override', 'B', 90],
  ['supplier_invoice_no', 'Supplier Invoice No', 'B', 130], ['supplier_invoice_date', 'Supplier Invoice Date', 'B', 110],
  ['supplier_invoice_amount', 'Supplier Invoice Amount', 'B', 140], ['diff_amount', 'Difference - Amount', 'B', 120],
  ['diff_base', 'Difference - Base Value', 'B', 130], ['diff_gst', 'Difference - GST', 'B', 110],
  ['diff_tds', 'Difference - TDS', 'B', 100], ['total_difference', 'Total Difference', 'B', 110],
  ['parts_pkg', 'Parts Pkg', 'B', 100],

  ['dse', 'DSE', 'C', 110], ['delivery_location', 'Delivery Location', 'C', 130], ['finance_bank', 'Finance', 'C', 130],
  ['do_date', 'DO Date', 'C', 90], ['do_amount', 'DO Amount', 'C', 110], ['mrp', 'MRP', 'C', 110],
  ['tally_bill', 'Tally Bill', 'C', 110], ['amc_charged_to_customer', 'AMC', 'C', 90], ['tcs', 'TCS', 'C', 90],
  ['total', 'Total', 'C', 110], ['margin_money', 'Margin Money', 'C', 110], ['finance_recd', 'Finance Recd', 'C', 110],
  ['finance_paymt_recd_date', 'Finance Paymt Recd Date', 'C', 110], ['subvention', 'Subvention', 'C', 100],
  ['total_recd', 'Total Recd', 'C', 110], ['insurance', 'Insurance', 'C', 100], ['cretem', 'CRETEM', 'C', 90],
  ['road_tax_pct', 'Road Tax %', 'C', 80], ['full_tax', 'Full Tax', 'C', 100], ['full_tax_override', 'Full Tax Override', 'C', 110],
  ['total_receivable', 'Total Receivable', 'C', 120], ['net_refund', 'Net Refund', 'C', 110],
  ['refund_status', 'Refund Status', 'C', 110], ['delivery_status', 'Delivery Status', 'C', 110],
  ['payment_status', 'Payment Status', 'C', 110], ['ad_blu_given', 'AD-BLU', 'C', 90], ['endhan', 'Endhan', 'C', 90],
  ['endhan_date', 'Endhan Date', 'C', 100],

  ['dsm', 'DSM', 'D', 110], ['date_of_retail', 'Date of Retail', 'D', 100], ['date_of_delivery', 'Date of Delivery', 'D', 100],
  ['other_deductions', 'Other Deductions', 'D', 110], ['retention_internal', 'Retention (internal)', 'D', 120],
  ['retention_al_claim', 'Retention (AL claim)', 'D', 120], ['app_amt', 'App Amt', 'D', 100],
  ['retention_remarks', 'Remarks', 'D', 160], ['sale_category', 'Sale Category', 'D', 110],
  ['al_invoice_no', 'AL Invoice No', 'D', 120], ['dealer_invoice_no', 'Dealer Invoice No', 'D', 120],
  ['al_claim_age', 'Age', 'D', 60], ['al_claim_interest', 'Claim Interest', 'D', 100],
  ['dse_incentive', 'DSE Incentive', 'D', 100], ['dse_incentive_override', 'DSE Incentive Override', 'D', 120],
  ['dsm_incentive', 'DSM Incentive', 'D', 100], ['gm_incentive', 'GM Incentive', 'D', 100],

  ['sold_to_dealer', 'Name of Dealer', 'E', 160], ['dealer_basic_value', 'Basic Value', 'E', 110],
  ['dealer_tds', 'TDS (0.1%)', 'E', 90], ['dealer_net_payable', 'Net Payable', 'E', 110],
  ['vehicle_location', 'Vehicle Location', 'E', 130], ['actual_delivery', 'Actual Delivery', 'E', 120],
  ['rebill_delivery_date', 'Rebill Dely Date', 'E', 100],

  ['notes', 'Notes', 'F', 200], ['user_field_1', 'Field 1', 'F', 100], ['user_field_2', 'Field 2', 'F', 100],
  ['user_field_3', 'Field 3', 'F', 100], ['user_field_4', 'Field 4', 'F', 100], ['user_field_5', 'Field 5', 'F', 100],
]

// Worked out on screen from other columns and today's date (screenColumns.js); never stored.
const SCREEN_SPEC = {
  ageing_days: { type: 'integer' },
  interest_on_ageing: { type: 'numeric' },
  dse_incentive: { type: 'numeric' },
}

// Percent or count columns: shown as plain numbers, not money.
const PLAIN_NUMBERS = new Set(['gst_rate', 'gst_rate_override', 'road_tax_pct', 'qty', 'make_year', 'mfrs_year',
  'al_claim_age', 'ageing_days'])

const isIncentiveKey = (k) => INCENTIVE_COLUMNS.includes(k)

export const ALL_COLUMNS = SHOWN.map(([key, label, group, width]) => {
  const spec = COLUMNS[key] ?? (isIncentiveKey(key) ? INCENTIVE_SPEC : SCREEN_SPEC[key])
  if (!spec) throw new Error(`columnMeta: ${key} is in no catalogue`)
  const screen = key in SCREEN_SPEC
  return {
    key, label, group, width, spec,
    incentive: isIncentiveKey(key),
    screen,
    // editable on screen = editable on the server; incentives are read-only until they get their own audited path
    editable: !screen && !isIncentiveKey(key) && spec.editable === true,
    money: (spec.type === 'numeric') && !PLAIN_NUMBERS.has(key),
  }
})

export const COLUMN_BY_KEY = Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c]))

// The columns a person may see: incentives only for admin + HR (the server enforces it; this only
// stops the screen asking for them).
export function visibleColumns({ seeIncentives }) {
  return ALL_COLUMNS.filter((c) => seeIncentives || (!c.incentive && c.key !== 'dse_incentive'))
}

// Frozen on the left, as the workbooks do it.
export const FROZEN_KEYS = ['chassis_no']
