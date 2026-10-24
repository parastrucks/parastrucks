// supabase/functions/admin-vehicle-units/authority.ts
// Phase 10 — who may do what in the Vehicle Tracker. Pure module (no Deno APIs): index.ts asks
// ROLE_GATES once, before reading any payload, and keeps no role check of its own — the pattern
// that caught the payments gate admitting every manager (2026-09-20).
//
// The rules (owner, 2026-08-11; plan §2.2):
//   * Nobody opens the tracker without the per-person switch, except admin. The switch is
//     app_metadata.tracker_access, which only the service role can write (admin-users
//     setTrackerAccess, admin-only). Department and rank do NOT grant it — not even HR or a GM.
//   * Staff-incentive figures: admin and HR only (and HR still needs the switch to get in).
//   * Downloading the whole book: admin, or tracker_export. "Copy for mail" is open to every
//     tracker user but logged.
//   * Shared layouts are published by admin; personal layouts belong to their owner.

export type Caller = {
  id: string
  permission_level: string | null
  department_code: string | null
  is_active: boolean
  tracker_access: boolean
  tracker_export: boolean
}

export const isAdmin = (c: Caller) => c.permission_level === "admin"
export const hasTrackerAccess = (c: Caller) => c.is_active && (isAdmin(c) || c.tracker_access === true)
export const canSeeIncentives = (c: Caller) => isAdmin(c) || c.department_code === "hr"
export const canExport = (c: Caller) => isAdmin(c) || c.tracker_export === true
export const canManageSharedViews = (c: Caller) => isAdmin(c)

// Every action, and the gate it passes BEFORE its payload is read. Anything not listed is
// unknown and refused. Per-row ownership (a personal layout) is checked in the action itself.
export const ACTIONS = [
  "list", "book", "find", "history", "listNotes", "listFormats", "listViews",
  "applyChanges", "createUnit", "createUnits", "supersedeUnit", "addNote", "setFormats",
  "saveView", "deleteView", "logExport",
] as const
export type Action = typeof ACTIONS[number]

export const ROLE_GATES: Record<Action, (c: Caller) => boolean> = {
  list:          hasTrackerAccess,
  book:          hasTrackerAccess,   // the working set / a year / all, with notes + colours, in one call
  find:          hasTrackerAccess,   // a truck in any year
  history:       hasTrackerAccess,
  listNotes:     hasTrackerAccess,
  listFormats:   hasTrackerAccess,
  listViews:     hasTrackerAccess,
  applyChanges:  hasTrackerAccess,
  createUnit:    hasTrackerAccess,
  createUnits:   hasTrackerAccess,
  supersedeUnit: hasTrackerAccess,
  addNote:       hasTrackerAccess,
  setFormats:    hasTrackerAccess,
  saveView:      hasTrackerAccess,   // shared → canManageSharedViews, checked with the payload
  deleteView:    hasTrackerAccess,   // owner, or admin for a shared one
  logExport:     hasTrackerAccess,   // kind 'export' → canExport, checked with the payload
}

export function gate(action: string, c: Caller): { ok: true } | { ok: false; status: number; error: string } {
  if (!(ACTIONS as readonly string[]).includes(action)) return { ok: false, status: 400, error: `Unknown action: ${action}` }
  if (!c.is_active) return { ok: false, status: 403, error: "Account inactive" }
  if (!ROLE_GATES[action as Action](c)) return { ok: false, status: 403, error: "No access to the vehicle tracker" }
  return { ok: true }
}

// May this caller change (or delete) this saved layout?
export function canEditView(c: Caller, view: { owner_id: string | null }): boolean {
  if (view.owner_id === null) return canManageSharedViews(c)
  return view.owner_id === c.id
}
