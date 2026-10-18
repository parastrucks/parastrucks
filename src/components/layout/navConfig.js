/* Shared navigation model (Phase 9.6 redesign).
   Single source of truth for the desktop Sidebar and the mobile Drawer, so the
   two nav surfaces can never diverge. Icons are semantic names resolved by
   <Icon> (lucide-react). Access is applied at render time via canAccess(). */

export const NAV_SECTIONS = [
  {
    label: 'Sales Tools',
    items: [
      {
        type: 'group', key: 'quotations', icon: 'file', label: 'Quotations',
        items: [
          { to: '/quotation',     label: 'New Quotation' },
          { to: '/my-quotations', label: 'My Quotations' },
          { to: '/quotation-log', label: 'Quotation Log' },
        ],
      },
      { type: 'link', to: '/catalog',        icon: 'truck', label: 'Vehicle Catalog' },
      { type: 'link', to: '/bus-calculator', icon: 'bus',   label: 'Bus Calculator' },
    ],
  },
  {
    label: 'Service Tools',
    items: [
      { type: 'link', to: '/vendor-jobs', icon: 'wrench',   label: 'Vendor Jobs' },
      { type: 'link', to: '/payments',    icon: 'rupee',    label: 'Match Payments' },
      { type: 'erp',                      icon: 'landmark', label: 'HD Hyundai ERP', external: true },
    ],
  },
  {
    label: 'Back Office Tools',
    items: [
      {
        type: 'group', key: 'proformas', icon: 'files', label: 'Proforma Invoices',
        items: [
          { to: '/proforma-invoice', label: 'New Proforma' },
          { to: '/my-proformas',     label: 'My Proformas' },
          { to: '/proforma-log',     label: 'Proforma Log' },
        ],
      },
      {
        type: 'group', key: 'financier', icon: 'landmark', label: "Financier's Copies",
        items: [
          { to: '/financier-copy',      label: 'New Copy' },
          { to: '/my-financier-copies', label: 'My Copies' },
          { to: '/financier-copy-log',  label: 'Copy Log' },
        ],
      },
      { type: 'link', to: '/tiv-forecast', icon: 'trending', label: 'TIV Forecast' },
    ],
  },
  {
    label: 'Operations Tools',
    items: [
      { type: 'link', to: '/employees',    icon: 'users',  label: 'Employees' },
      { type: 'link', to: '/access-rules', icon: 'shield', label: 'Access Rules' },
    ],
  },
]

/* Mobile bottom bar: department-code-keyed tab sets (icons are Lucide names).
   Admin gets the broad set; everyone else their department's; unknown codes
   fall back to home + profile. A tab marked `gated` shows only when
   canAccess(to) — the access rules decide, as they do for the drawer. */
export const DEPT_TABS = {
  sales: [
    { to: '/',              icon: 'dashboard', label: 'Home' },
    { to: '/quotation',     icon: 'file',      label: 'Quote' },
    { to: '/my-quotations', icon: 'clipboard', label: 'History' },
    { to: '/profile',       icon: 'user',      label: 'Profile' },
  ],
  back_office: [
    { to: '/',             icon: 'dashboard', label: 'Home' },
    { to: '/quotation',    icon: 'file',      label: 'Quote' },
    { to: '/tiv-forecast', icon: 'trending',  label: 'TIV' },
    { to: '/profile',      icon: 'user',      label: 'Profile' },
  ],
  hr: [
    { to: '/',          icon: 'dashboard', label: 'Home' },
    { to: '/employees', icon: 'users',     label: 'Employees' },
    { to: '/profile',   icon: 'user',      label: 'Profile' },
  ],
  // Payments is where service and accounts staff work every morning, on their
  // phones. It was only in the drawer and in the + sheet under "Create new",
  // where a first-day user asked "does tapping it create a new payment?"
  // (red team 4, R4-14). With it the bar has four tabs, so Profile is back too.
  service: [
    { to: '/',            icon: 'dashboard', label: 'Home' },
    { to: '/payments',    icon: 'rupee',     label: 'Payments', gated: true },
    { to: '/vendor-jobs', icon: 'wrench',    label: 'Jobs' },
    { to: '/profile',     icon: 'user',      label: 'Profile' },
  ],
  accounts: [
    { to: '/',            icon: 'dashboard', label: 'Home' },
    { to: '/payments',    icon: 'rupee',     label: 'Payments', gated: true },
    { to: '/vendor-jobs', icon: 'wrench',    label: 'Jobs' },
    { to: '/profile',     icon: 'user',      label: 'Profile' },
  ],
}

// 4 icons + the raised center (+) = 5 slots. "Quote" is omitted here
// because New Quotation is already the first action in the + sheet.
export const ADMIN_TABS = [
  { to: '/',             icon: 'dashboard', label: 'Home' },
  { to: '/tiv-forecast', icon: 'trending',  label: 'TIV' },
  { to: '/employees',    icon: 'users',     label: 'Team' },
  { to: '/profile',      icon: 'user',      label: 'Profile' },
]

export const FALLBACK_TABS = [
  { to: '/',        icon: 'dashboard', label: 'Home' },
  { to: '/profile', icon: 'user',      label: 'Profile' },
]

/**
 * Which tabs sit left and right of the raised (+).
 *
 * Gated tabs the person cannot open are left out. The (+) is kept visually
 * centred by splitting an EVEN number of tabs around it; if the count is odd
 * the last tab (Profile — also on the top-bar avatar and in the drawer) goes.
 */
export function bottomNavLayout({ isAdmin, deptCode, canAccess, hasCreate }) {
  let tabs = (isAdmin ? ADMIN_TABS : (DEPT_TABS[deptCode] || FALLBACK_TABS))
    .filter((t) => !t.gated || canAccess?.(t.to))
  if (hasCreate && tabs.length % 2 === 1) tabs = tabs.slice(0, -1)
  const mid = tabs.length / 2
  return {
    left: hasCreate ? tabs.slice(0, mid) : tabs,
    right: hasCreate ? tabs.slice(mid) : [],
  }
}

/* Quick actions for the mobile (+) sheet. */
export const CREATE_ACTIONS = [
  { to: '/quotation',        icon: 'file',     label: 'New Quotation',   desc: 'Customer price quotation PDF' },
  { to: '/proforma-invoice', icon: 'files',    label: 'New Proforma',    desc: 'Proforma invoice for physical vehicles' },
  { to: '/financier-copy',   icon: 'landmark', label: 'New Copy',        desc: "Financier's copy (Tax Invoice)" },
  { to: '/vendor-jobs',      icon: 'wrench',   label: 'New Vendor Job',  desc: 'Outside-workshop / ancillary repair job', openNew: true },
  // Matching is done on staff phones (owner: the cornerstone), so it must be
  // one tap from the mobile Create sheet, not three menus deep.
  { to: '/payments',         icon: 'rupee',    label: 'Match Payments',  desc: 'Which bill is this payment for?' },
]

/* Is a nav item reachable for this user? Groups need ≥1 accessible child.
   ERP is NOT decided here — callers gate it with useErpVisible() (hdh brand /
   admin). We return false for erp so that if a future refactor ever routes an
   ERP item through this helper, it fails closed instead of leaking to all. */
export function itemVisible(item, canAccess) {
  if (item.type === 'erp') return false
  if (item.type === 'group') return item.items.some(c => canAccess(c.to))
  return canAccess(item.to)
}
