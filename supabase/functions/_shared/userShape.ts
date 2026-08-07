// ============================================================================
// userShape — server-side mirror of src/lib/userShape.js.
//
// ⚠️ TWO COPIES BY NECESSITY: Deno cannot import from src/, and there is no
// shared build step. Change both together.
//
// They are kept honest by scripts/user-shape-audit.sql, which encodes the same
// matrix a third time and is the acceptance test — if any copy drifts, the grid
// reports either a `missing` on a required slot or a `set_but_na` on an
// inapplicable one. Drift is therefore detectable, not silent.
//
// This file is the CONTRACT. The form is UX: it can be bypassed with a direct
// call to the Edge Function, so every rule here is enforced again server-side.
// ============================================================================

export const DEPT_SALES       = "sales"
export const DEPT_BACK_OFFICE = "back_office"

export const SLOT_PRIMARY_OUTLET = "primary_outlet_id"
export const SLOT_BRANDS         = "brand_ids"
export const SLOT_VERTICALS      = "sales_vertical_ids"
export const SLOT_SUBDEPT        = "subdept_id"

/** Is this slot required for this department + tier? */
export function isRequired(slot: string, deptCode: string | null, permissionLevel: string | null): boolean {
  switch (slot) {
    // Everyone works somewhere; everyone belongs to at least one brand.
    // user_brands is an authorization input (vehicle_catalog_select,
    // quotations_select, proforma/financier/tiv_forecast_* and ERP scope), so
    // "no brand" is not an empty field — it is an invisible denial.
    case SLOT_PRIMARY_OUTLET:
    case SLOT_BRANDS:
      return true
    case SLOT_VERTICALS:
      return deptCode === DEPT_SALES
    case SLOT_SUBDEPT:
      return deptCode === DEPT_BACK_OFFICE && permissionLevel !== "gm"
    default:
      return true // fail closed
  }
}

export type ShapeInput = {
  department_code: string | null
  permission_level: string | null
  primary_outlet_id?: string | null
  subdept_id?: string | null
  brand_ids?: string[]
  sales_vertical_ids?: string[]
}

/**
 * Validate the four conditional slots. Returns an error string, or null when
 * the resulting user is complete.
 *
 * Arrays may be `undefined`, meaning "not supplied by this request" — on an
 * update that means "leave the existing rows alone", so the caller must resolve
 * them against current DB state BEFORE calling this. An empty array is a real
 * value meaning "clear it", and is rejected for a required slot.
 */
export function validateShape(u: ShapeInput): string | null {
  const dept = u.department_code
  const tier = u.permission_level

  if (isRequired(SLOT_PRIMARY_OUTLET, dept, tier) && !u.primary_outlet_id) {
    return "Primary outlet is required for every user."
  }
  if (isRequired(SLOT_BRANDS, dept, tier) && (u.brand_ids ?? []).length === 0) {
    return "At least one brand is required for every user."
  }
  if (isRequired(SLOT_VERTICALS, dept, tier) && (u.sales_vertical_ids ?? []).length === 0) {
    return "At least one sales vertical is required for Sales users."
  }
  if (isRequired(SLOT_SUBDEPT, dept, tier) && !u.subdept_id) {
    return "A sub-department is required for Back Office users below GM."
  }
  return null
}
