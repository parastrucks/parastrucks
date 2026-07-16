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

/* Quick-create actions for the mobile Create (+) sheet. */
export const CREATE_ACTIONS = [
  { to: '/quotation',        icon: 'file',     label: 'New Quotation',   desc: 'Customer price quotation PDF' },
  { to: '/proforma-invoice', icon: 'files',    label: 'New Proforma',    desc: 'Proforma invoice for physical vehicles' },
  { to: '/financier-copy',   icon: 'landmark', label: 'New Copy',        desc: "Financier's copy (Tax Invoice)" },
  { to: '/vendor-jobs',      icon: 'wrench',   label: 'New Vendor Job',  desc: 'Outside-workshop / ancillary repair job', openNew: true },
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
