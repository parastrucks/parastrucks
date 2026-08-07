// ============================================================================
// userShape — the ONE definition of "every user carries the same attributes".
//
// The defect this exists to prevent: the employee form used to capture a
// different shape per department. Accounts/HR/PDI users got no brand and no
// outlet, so they were structurally incomplete compared to a Service user —
// and nothing reported it. That silently blanked their vehicle catalog (RLS
// gates on has_user_brand) and dropped them out of the portal→ERP sync, whose
// `!inner` brand join excludes a user with no user_brands row BEFORE the query
// returns, so they never even appeared in its `skipped` list.
//
// Rule: every user carries every slot. Where a slot genuinely does not apply to
// a department it is still SHOWN, marked "not applicable" with the reason — it
// is never silently omitted, because a blank that means "doesn't apply" is
// indistinguishable from a blank that means "nobody filled it in", and that
// ambiguity is what hid the bug for months.
//
// ⚠️ MIRRORED at supabase/functions/_shared/userShape.ts — Deno cannot import
// from src/. Change both together. They are kept honest by the completeness
// audit (scripts/user-shape-audit.sql), which encodes the same matrix a third
// time and is the acceptance test: if any copy drifts, the grid reports either
// a `missing` on a required slot or a `set_but_na` on an inapplicable one.
// ============================================================================

/* Department codes. ALL of them — the old file-local constant list omitted
   accounts/hr/pdi, which is literally where the bug lived. */
export const DEPT = {
  SALES:       'sales',
  SERVICE:     'service',
  SPARES:      'spares',
  ACCOUNTS:    'accounts',
  HR:          'hr',
  BACK_OFFICE: 'back_office',
  PDI:         'pdi',
  ADMIN:       'admin',   // inactive department; never selectable in the form
}

/* The four slots that used to be department-conditional. The other six
   (full_name, email, entity, department, designation, permission_level) are
   unconditionally required and validated separately. */
export const SLOT = {
  PRIMARY_OUTLET: 'primary_outlet_id',
  BRANDS:         'brand_ids',
  VERTICALS:      'sales_vertical_ids',
  SUBDEPT:        'subdept_id',
}

export const REQUIRED       = 'required'
export const NOT_APPLICABLE = 'not_applicable'

/**
 * What does this slot mean for this department + tier?
 *
 * Returns { requirement, reason }. `reason` is non-null only when the slot is
 * not applicable, and is rendered to the user so the exemption is visible
 * rather than inferred from an absent control.
 */
export function requirementFor(slot, deptCode, permissionLevel) {
  switch (slot) {
    // Everyone works somewhere, and everyone belongs to at least one brand.
    // Brand membership is not metadata: it drives vehicle_catalog_select,
    // quotations_select, proforma_invoices_select, financier_copies_select and
    // all seven tiv_forecast_*_select policies, plus ERP entitlement.
    case SLOT.PRIMARY_OUTLET:
    case SLOT.BRANDS:
      return { requirement: REQUIRED, reason: null }

    // Verticals are brand-scoped product lines (Tipper, Buses, Excavators…).
    // Asking a mechanic or an accountant to name one would be manufacturing
    // data, and those values feed catalog visibility.
    case SLOT.VERTICALS:
      return deptCode === DEPT.SALES
        ? { requirement: REQUIRED, reason: null }
        : { requirement: NOT_APPLICABLE, reason: 'Sales verticals belong to the Sales department.' }

    // EDP / RTO / CRM exist only inside Back Office. The GM heads all three, so
    // naming one would be inventing data.
    //
    // This exemption is NOT the old bug. The old bug was that the control was
    // hidden while its stale value kept being submitted, so promoting a Back
    // Office manager to GM silently persisted a now-invisible sub-department.
    // Here the slot is rendered, the exemption is stated, and the payload
    // builder derives from this same function — so what you see is what is sent.
    case SLOT.SUBDEPT:
      if (deptCode !== DEPT.BACK_OFFICE) {
        return { requirement: NOT_APPLICABLE, reason: 'Sub-departments exist only in Back Office.' }
      }
      return permissionLevel === 'gm'
        ? { requirement: NOT_APPLICABLE, reason: 'Back Office GMs head all sub-departments.' }
        : { requirement: REQUIRED, reason: null }

    default:
      // Fail CLOSED: an unrecognised slot is treated as required rather than
      // silently skipped.
      return { requirement: REQUIRED, reason: null }
  }
}

export const isRequired = (slot, deptCode, permissionLevel) =>
  requirementFor(slot, deptCode, permissionLevel).requirement === REQUIRED

/**
 * Validate the four conditional slots against the shape.
 * Returns { message, field } on the first failure, or null when complete.
 * The shared { message, field } contract is what the form already renders
 * inline and flags red, so callers do not change.
 */
export function validateSlots(form, deptCode) {
  const tier = form.permission_level

  if (isRequired(SLOT.PRIMARY_OUTLET, deptCode, tier) && !form.primary_outlet_id) {
    return { message: 'Primary outlet is required.', field: 'primary_outlet_id' }
  }
  if (isRequired(SLOT.BRANDS, deptCode, tier) && (form.brand_ids || []).length === 0) {
    return { message: 'Select at least one brand.', field: 'brand_ids' }
  }
  // Checked AFTER brands on purpose: the vertical picker is populated from the
  // selected brands, so with no brand chosen it is empty and pointing the error
  // at it would flag a control with nothing to click.
  if (isRequired(SLOT.VERTICALS, deptCode, tier) && (form.sales_vertical_ids || []).length === 0) {
    return { message: 'Select at least one sales vertical.', field: 'sales_vertical_ids' }
  }
  if (isRequired(SLOT.SUBDEPT, deptCode, tier) && !form.subdept_id) {
    return { message: 'Sub-department is required for Back Office users.', field: 'subdept_id' }
  }
  return null
}

/**
 * Build the join-table + conditional-scalar half of the EF payload.
 *
 * Derives from the SAME requirementFor() the renderer uses, so applicability is
 * never reconstructed twice — two independent copies of a conditional always
 * drift, and that drift is exactly how `[]` got sent for departments whose
 * control was never shown.
 *
 * Join arrays: an inapplicable slot sends [] (a deliberate, rule-backed clear);
 * a required slot sends the chosen values. `outlet_ids` is never sent at all —
 * this form has no control for user_outlets and must not express an opinion.
 */
export function buildSlotPayload(form, deptCode) {
  const tier = form.permission_level
  return {
    primary_outlet_id: form.primary_outlet_id || null,
    subdept_id: isRequired(SLOT.SUBDEPT, deptCode, tier) ? (form.subdept_id || null) : null,
    brand_ids: isRequired(SLOT.BRANDS, deptCode, tier) ? form.brand_ids : [],
    sales_vertical_ids: isRequired(SLOT.VERTICALS, deptCode, tier) ? form.sales_vertical_ids : [],
  }
}
