# Paras Portal — UI Handoff Report (for Visual Redesign)

> Read-only inventory of the current portal for a designer. No app behaviour is being
> changed — this is a factual map of every page, its sections, real labels, table columns,
> sample data, navigation, and assets. All labels are quoted verbatim from source.
> Sample rows in **tables** are real where drawn from seed data (Catalog), and clearly
> marked *representative* where they stand in for live customer/employee/job data (which is
> PII and deliberately not exported here).

---

## 1. Overview

**What it is.** An internal team portal for **Paras Trucks & Buses** — a commercial-vehicle
dealership (Ashok Leyland, Switch Mobility, HD Hyundai CE) operating across Gujarat and
Haryana. It centralises customer quoting (quotations, proforma invoices, financier's
copies), employee/access administration, a vehicle price catalog, a bus price configurator,
an industry-volume forecasting tool, and an outside-workshop repair-job tracker. Live at
**team.parastrucks.in**. React 18 + Vite SPA, Supabase backend, custom CSS (no UI framework).

**Who uses it & access model.** Every user has a fixed profile with four access axes:
- **Permission Level** — `Admin` / `GM` / `Manager` / `Executive` (system access tier).
- **Entity** — `PTB` (Gujarat: Ahmedabad, Anand) or `PT` (Haryana: Hisar, Rohtak, Sirsa,
  Jind, Charkhi Dadri, Karnal). Shown as a read-only badge; not user-switchable.
- **Department** — Sales / Service / Spares / Back Office / Accounts / HR / PDI.
- **Designation** + **Brand(s)** (al / hdh / switch) + **Sales vertical(s)** + **Primary outlet**.

Access is decided **per route**: the route path *is* the permission key. `Admin` bypasses all
rules; everyone else must match a rule row on permission-level × entity × department (+
optional designation). The sidebar filters links by `canAccess(route)`; the mobile bottom
nav shows a hardcoded tab set per department. `/access-rules` is admin-only, hard-coded.

### Route / page list

| Route | Page | Purpose |
|---|---|---|
| `/login` | Login | Email/password sign-in (lockout + optional CAPTCHA). |
| `/` | Dashboard | Home — greeting + grid of tool cards, gated by access. |
| `/profile` | Profile | Read-only account details, change password, sign out. |
| `/quotation` | New Quotation | Create a truck price quotation → PDF. |
| `/my-quotations` | My Quotations | Current user's quotation history (re-download PDF). |
| `/quotation-log` | Quotation Log | All users' quotations (search + pagination). |
| `/proforma-invoice` | Proforma Invoice | Create proforma invoices for physical vehicles (batch). |
| `/my-proformas` | My Proforma Invoices | Current user's proformas. |
| `/proforma-log` | Proforma Invoice Log | All users' proformas (search + pagination). |
| `/financier-copy` | Financier's Copy | Create Tax Invoice (financier's copy) for bank/NBFC. |
| `/my-financier-copies` | My Financier's Copies | Current user's financier's copies. |
| `/financier-copy-log` | Financier's Copy Log | All users' financier's copies (search + pagination). |
| `/employees` | Employees | Team account management (create/edit/deactivate). |
| `/access-rules` | Access Rules | Route access rules, entity GMs, reference data, error log (admin only). |
| `/catalog` | Vehicle Catalog | Price catalog — admin table view or sales card view. |
| `/bus-calculator` | Bus Price Calculator | Step-by-step bus (chassis+body) price estimate. |
| `/tiv-forecast` | TIV Forecast | Industry volume forecasting + segment analysis. |
| `/vendor-jobs` | Vendor Jobs | Track outside-workshop & ancillary repair jobs. |
| `*` | — | Any unknown path redirects to `/`. |

**Shared conventions (apply everywhere):**
- **Currency:** `₹` + non-breaking space + Indian digit grouping (e.g. `₹ 24,85,000`); null → `—` (em dash).
- **Dates:** `en-IN`, `DD Mon YYYY` (e.g. `04 Jul 2026`); null → `—`.
- **Loading:** skeleton rows/cards (`Skeleton` component) for tables/grids; inline spinners on buttons.
- **Errors:** `.alert.alert-error` banner with a `⚠` glyph (inline); Dashboard ERP uses native `alert()` popups (an inconsistency worth unifying).
- **Icons:** no icon library — a mix of one inline-SVG set (`BIcon` in Vendor Jobs) and scattered emoji/Unicode glyphs. A candidate for a unified icon set.

---

## 2. Navigation & Shell

**Shell:** a single flex layout = **Sidebar** (desktop) + **main content** + **BottomNav** (mobile).
There is **no top bar / header** — no global search, notifications, breadcrumbs, or org switcher.
The user affordances that would normally sit in a header live in the sidebar user menu.

### Desktop sidebar (top → bottom)
1. **Logo** — `paras-logo.png` (`alt="Paras Trucks"`).
2. **User menu** (directly under the logo, *not* at the bottom): avatar initials, `{full_name}`,
   an **entity badge** (`PTB`/`PT`), and a caret. Dropdown items:
   - `👤 Profile` → `/profile`
   - `↩ Sign Out` → signs out, routes to `/login`
3. **`⊞ Dashboard`** → `/` (always visible)
4. **Collapsible groups** (auto-open when a child route is active; whole group hidden if no child is accessible):
   - **`📄 Quotations`**: `✏️ New Quotation` `/quotation` · `🗂 My Quotations` `/my-quotations` · `📊 Quotation Log` `/quotation-log`
   - **`📃 Proforma Invoices`**: `✏️ New Proforma` `/proforma-invoice` · `🗃 My Proformas` `/my-proformas` · `📋 Proforma Log` `/proforma-log`
   - **`🏦 Financier's Copies`**: `✏️ New Copy` `/financier-copy` · `🗃 My Copies` `/my-financier-copies` · `📋 Copy Log` `/financier-copy-log`
5. **Ungrouped links** (each filtered by access):
   - `👥 Employees` `/employees` · `🔐 Access Rules` `/access-rules` · `🚛 Vehicle Catalog` `/catalog` · `🚌 Bus Calculator` `/bus-calculator` · `📈 TIV Forecast` `/tiv-forecast` · `🔧 Vendor Jobs` `/vendor-jobs`

### Mobile bottom nav (per-department tab sets, icon-over-label)
- **Admin:** `⊞ Home` `/` · `📄 Quote` `/quotation` · `📈 TIV` `/tiv-forecast` · `👥 Team` `/employees` · `👤 Profile` `/profile`
- **Sales:** `⊞ Home` · `📄 Quote` · `🗂 History` `/my-quotations` · `👤 Profile`
- **Back office:** `⊞ Home` · `📄 Quote` · `📈 TIV` · `👤 Profile`
- **HR:** `⊞ Home` · `👥 Employees` · `👤 Profile`
- **Service / Accounts:** `⊞ Home` · `🔧 Jobs` `/vendor-jobs` · `👤 Profile`
- **Fallback (no dept):** `⊞ Home` · `👤 Profile`

> Design note: the two nav systems are maintained independently — sidebar is access-filtered
> per link; bottom nav is a curated per-department list. Keep them in sync in any redesign.

---

## 3. Per-page breakdown

### 3.1 Login — `/login`
Single centred auth card.
- **Logo** `paras-logo.png`, **H1** `Team Portal`, subtitle `Sign in to continue`.
- **Error alert** (conditional): lockout → `Too many failed attempts. Try again in {m}:{ss}.`; else raw error.
- **Form:**
  - `Email` — email input, placeholder `e.g. ramesh@parastrucks.in`, autofocus.
  - `Password` — password input, placeholder `Enter your password`, with a show/hide toggle (`👁`/`🙈`).
  - `Remember me on this device` — checkbox.
  - Cloudflare **Turnstile** CAPTCHA — only when a site key is configured.
  - Submit button: `Sign In` (idle) / spinner (loading) / `Locked` (locked out).
- **Footer:** `Need access?` → link `Contact HR` (`mailto:hr.guj@parastrucks.in`).
- Validation strings: `Please enter your email and password.`, `Login failed.`

### 3.2 Dashboard — `/`
- **Header:** H1 greeting `Good morning/afternoon/evening, {firstName} 👋` (fallback name `there`);
  subtitle = permission tier (`Admin`/`GM`/`Manager`/`Executive`) optionally ` · {location}`.
- **Tool grid** (each card shown only if accessible):
  - **Group cards** (large primary link + chevron dropdown of extras):
    - `📄 Quotations` — “Generate a customer quotation PDF” — primary `New Quotation`; extras `🗂 My Quotations`, `📊 Quotation Log`.
    - `📃 Proforma Invoices` — “Generate proforma invoices for physical vehicles” — primary `New Proforma Invoice`; extras `🗃 My Proforma Invoices`, `📋 Proforma Invoice Log`.
    - `🏦 Financier's Copies` — “Generate Tax Invoice (Financier's copy) for bank/NBFC disbursement” — primary `New Financier's Copy`; extras `🗃 My Financier's Copies`, `📋 Financier's Copy Log`.
  - **Plain link cards:**
    | Icon | Title | Description | Route |
    |---|---|---|---|
    | 👥 | Employee Management | Create, edit, and manage team accounts | `/employees` |
    | 🔐 | Access Rules | Configure roles, brands, and tool access | `/access-rules` |
    | 🚛 | Vehicle Catalog | Manage the vehicle price catalog | `/catalog` |
    | 🚌 | Bus Calculator | Build a bus price estimate step by step | `/bus-calculator` |
    | 📈 | TIV Forecast | Industry volume forecasting and segment analysis | `/tiv-forecast` |
    | 🔧 | Vendor Jobs | Track outside-workshop & ancillary repair jobs | `/vendor-jobs` |
  - **ERP card (always last):** `🏗️ HD Hyundai Service ERP` — “Service ops — job cards, spares, stock & billing”. Acts as a button (SSO), shows `Opening…` while busy.
- **Empty state:** whole page renders nothing if no profile; inaccessible cards simply don't appear.

### 3.3 Profile — `/profile` (narrow, ~560px)
- **Header:** H1 `My Profile`, subtitle `Your account details. To update attributes, contact HR.`
- **Account card:** avatar initial, name, permission badge (`.badge-blue`). Read-only 2-col field grid
  (empty fields hidden): `Full Name`, `Email`, `Permission Level`, `Entity`, `Department`, `Designation`,
  `Primary Outlet` (`{city} ({facility_type})`), `Sub-department`, `Brands`, `Sales verticals`, `Location`.
- **Password card:** `Password` / “Update your login password” + `Change` button → expands to
  `New Password` (placeholder `Minimum 8 characters`) + `Confirm Password` (`Re-enter new password`),
  buttons `Update Password` / `Cancel`. Validation: `Password must be at least 8 characters.`,
  `Passwords do not match.`; success toast `Password updated successfully.`
- **Sign Out** — full-width danger button `Sign Out`.
- *No active-sessions/devices section exists (roadmap item, not built).*

### 3.4 New Quotation — `/quotation`
Two-column form (left = entry, right = summary). H1 `New Quotation`, subtitle `Create a truck price quotation for a customer`.
- **Customer Details** (grid): `Customer Name *` (`Full name or company name`), `Mobile` (`10-digit number`),
  `GSTIN` (`22AAAAA0000A1Z5`, auto-uppercased, 15 chars), `Address` (`City, State`),
  `Hypothecation` (`Bank / NBFC name`), `Valid Until` (date, defaults to end-of-month).
- **Vehicles:** segment dropdown (`All Segments`, `ICV Trucks`, `Long Haul Trucks`, `Tippers`, `Buses`, `RMC / Boom Pump`)
  + search input `Search by model name or CBN…` → results dropdown (name · `{CBN} · {tyres}` · `₹` price).
  Selected vehicles become **line-item cards**: editable description (Admin/Back-Office only; else locked
  with `edited` amber badge + `Reset to catalog`), `MRP (incl. GST)`, `Qty` (1–99), computed `Basic Amt` /
  `GST 18%` / `Total`, and a `×` remove. Empty: `Search and add vehicles above`. Locked-price note:
  `Prices are locked to catalog MRP. Contact back office to adjust pricing.`
- **Additional Charges:** `RTO Tax (₹)`, `Insurance (₹)`; helper `TCS @ 1% on vehicle subtotal is applied automatically.`
- **Price Summary** (right): `Vehicle Subtotal`, `TCS @ 1%`, `RTO Tax`, `Insurance`, `Grand Total`.
- **Submit:** `💾 Save & Download PDF` (→ `Saving…`). Success toast `Quotation {number} saved and PDF downloaded.`
- Validation: `Customer name is required.`, `GSTIN must be exactly 15 characters.`, `Add at least one vehicle.`, etc.

### 3.5 My Quotations — `/my-quotations`
Single table (own quotations). Empty: `📄 No quotations yet` / “Quotations you create will appear here.”
- **Columns:** `Quotation No.` · `Date` · `Customer` (name + mobile sub-line) · `Vehicles` (blue badge `{n} unit(s)`)
  · `Grand Total` (right) · `Valid Until` · *(action)*. Row action: `↓ PDF` (→ `Generating…`).
- **Representative rows:**
  | Quotation No. | Date | Customer | Vehicles | Grand Total | Valid Until |
  |---|---|---|---|---|---|
  | PTB/25-26/0042 | 04 Jul 2026 | Rajesh Transport Co. — 9876543210 | 2 units | ₹ 48,20,000 | 31 Jul 2026 |
  | PTB/25-26/0041 | 02 Jul 2026 | Sunil Logistics | 1 unit | ₹ 21,50,000 | 31 Jul 2026 |
  | PT/25-26/0007 | 28 Jun 2026 | Meena Roadways — 9123456780 | 3 units | ₹ 72,90,000 | 30 Jun 2026 |

  *(Representative. Real quotation number format is `{entity}/{FY}/{NNNN}`, e.g. `PTB/25-26/0042`, from an RPC.)*

### 3.6 Quotation Log — `/quotation-log`
Team-wide table + header search + result count + pagination (25/page).
- **Search:** `Search quotation no. or customer…`. Count line: `{n} quotation(s)` (+ ` matching "{term}"`).
- **Columns:** `Quotation No.` · `Date` · `Prepared By` (name + designation sub-line, or `—`) · `Customer` · `Vehicles` · `Grand Total` · `Valid Until` · *(action `↓ PDF`)*.
- **Pagination:** `← Previous` · `Page {n} of {m}` · `Next →`.
- Empty (search): `📋 No results found` / “Try a different search term.” Empty (none): `No quotations yet`.

### 3.7 Proforma Invoice (create) — `/proforma-invoice`
Two-column, **batch** create. H1 `Proforma Invoice`, subtitle `Generate proforma invoices for physical vehicles`.
- **Customer Details** — same fields as Quotation.
- **Vehicle Selection** — segment dropdown + search `Search model or sub-segment…` (loading: `Loading catalog…`).
- **Model cards (line items):** header (model + `{cbn} · catalog {price}`), `✕` remove; subtitle `Chassis & Engine ({count})`.
  Each **chassis row** (`#n`): `Chassis No.`, `Engine No.`, `✕`, a `Particulars / model description` textarea,
  and price sub-grid `MRP (₹) *` / `RTO Tax (₹)` / `Insurance (₹)`. Per-card `+ Add chassis for this model`.
- **Batch Summary** (right): `Total MRP`, `Total TCS 1%`, `Total RTO`, `Total Insurance`, `Grand Total`,
  footnote `{n} rows across {m} models`. Empty: `Search and select a vehicle to begin`.
  Submit: `Generate {n} Proforma Invoice(s)` (→ `Generating…`, progress `{x} of {y} generated…`).
- Entity (PTB/PT) is **server-derived** from the user; GST computed at 18% implicitly; TCS fixed 1%.
- **Representative list rows** (`/my-proformas`, `/proforma-log`): columns `PI Number` · `Date` · [`Prepared By`] · `Customer` · `Chassis / Engine` (mono, stacked) · `Grand Total` · *(↓ PDF)*.
  | PI Number | Date | Customer | Chassis / Engine | Grand Total |
  |---|---|---|---|---|
  | PTB/PI/25-26/0042 | 04 Jul 2026 | Shreeji Logistics — 9876543210 | MB1PBLKA…4521 / E4L92…9987 | ₹ 25,74,500 |
  | PT/PI/25-26/0117 | 03 Jul 2026 | Rajesh Transport Co. — 9812000111 | MC2XYZ…4488 / H6R44…9971 | ₹ 41,20,000 |

  *(Representative. `PI Number` format is server-generated, entity-prefixed.)*
  - `/my-proformas`: no search/pagination. `/proforma-log`: search `Search PI no., customer, chassis, engine…` + pagination (25/page).

### 3.8 Financier's Copy (create) — `/financier-copy`
Two-column create. H1 `Financier's Copy`, subtitle `Generate a Tax Invoice (Financier's copy) for bank/NBFC disbursement`.
- **Customer Details** — same core fields, **plus** a `Ship to a different address` checkbox revealing
  `Ship-to Name`, `Ship-to Address`, `Ship-to GSTIN`, `Ship-to State`.
- **Vehicle Selection** — same pattern as Proforma.
- **Model cards** add an `HSN Code` field (`e.g. 87060019`, “printed on the tax invoice; not stored on the catalog”)
  above the same chassis rows + price sub-grid (`MRP (₹) *` / `RTO Tax (₹)` / `Insurance (₹)`).
- **Batch Summary** (right): `Total MRP`, `Total TCS 1%`, `Total RTO`, `Total Insurance`, `Grand Total`,
  footnote `{n} row(s) across {m} model(s)`. Submit: `Generate {n} Financier's Cop{y/ies}`.
- There is **no financier/bank dropdown** — `Hypothecation` (`Bank / NBFC name`) is free text.
- **List pages** (`/my-financier-copies`, `/financier-copy-log`): columns `FC Number` · `Date` · [`Prepared By`] · `Customer` · `Chassis No.` / `Chassis / Engine` · `Grand Total` · *(↓ PDF)*.
  | FC Number | Date | Customer | Chassis / Engine | Grand Total | Valid Until |
  |---|---|---|---|---|---|
  | FC/PTB/0042 | 30 Jun 2026 | Sharma Logistics · 9876543210 | MB1XKZ…4521 / D028…9987 | ₹ 24,85,000 | 31 Jul 2026 |
  | FC/PT/0007 | 25 Jun 2026 | Verma Transport · 9812345678 | MB1XKZ…4390 / D028…9950 | ₹ 32,10,000 | 30 Jun 2026 |

  *(Representative.)* Log search: `Search FC no., customer, chassis, engine…` + pagination (25/page).

> **Note across all three document modules:** there are **no lifecycle status tags** (no Draft/Sent/
> Approved/Expired). The only pill-style tokens are the blue `unit(s)` count and the amber `edited`
> marker. There are **no CSV/Excel export buttons** on the list pages. If the redesign wants status
> chips or exports, those are net-new.

### 3.9 Employees — `/employees`
H1 `Employees`, subtitle `Manage team accounts, departments, designations, and access.` Button `+ Add Employee`.
- **Stat cards (4):** `Total`, `Active` (green), `PTB · Gujarat`, `PT · Haryana`.
- **Filters:** search `Search name or email…`; dropdowns `All Entities`, `All Departments`,
  `All Levels` (+ Admin/GM/Manager/Executive), status `Active only` / `Inactive only` / `All`.
- **Table columns:** `Name` · `Email` (mono) · `Entity` (blue badge) · `Department · Designation` (2-line)
  · `Permission` (tier badge) · `Status` (`Active` green / `Inactive` gray) · `Actions` (`Edit`, `Reset PW`, `Deactivate`/`Activate`).
  Empty: `👥 No employees found` / “Try adjusting the filters or add a new employee.”
  - **Representative rows:**
    | Name | Email | Entity | Department · Designation | Permission | Status |
    |---|---|---|---|---|---|
    | Ramesh Kumar | ramesh@parastrucks.in | PTB | Sales · Sales Executive | Executive | Active |
    | Priya Sharma | priya@parastrucks.in | PT | Service · Service Manager | Manager | Active |
    | Anil Verma | anil@parastrucks.in | PT | Back Office · GM Back Office | GM | Inactive |

    *(Representative — realistic names for layout only.)*
- **Add/Edit modal (cascading, conditional):** `Add Employee` / `Edit — {name}`.
  - Identity: `Full Name *` (`Ramesh Kumar`), `Email *` (disabled in edit), `Temporary Password *` (add only, `Min. 8 characters`).
  - Org axes: `Entity *`, `Department *`, `Designation *` (gated by department), `Permission Level *` (GM/Manager/Executive only — Admin never offered).
  - **Department-specific section swaps in:** *Sales* → `Brands *` (checkbox chips) + `Sales verticals *`; *Service/Spares* → `Primary outlet *` + `Brands *`; *Back Office* → `Sub-department *` (hidden for GM) + `Brands (for quotation log scope)`.
  - `Location (informational)` dropdown. Buttons `Create Employee`/`Save Changes`, `Cancel`, and (admin, edit, not self) `Delete Permanently`.
- **Reset Password modal** and **Confirm (Deactivate/Activate/Delete)** modal with tailored copy per action.
- **Permission badge colors:** Admin `red`, GM `purple`, Manager `blue`, Executive `green`.

### 3.10 Access Rules — `/access-rules` (admin only)
H1 `Access Rules`, subtitle `Define route-level access, assign entity GMs, manage reference data.`
Four tabs: **Access Rules · Entities · Configuration · Errors**.
- **Access Rules tab:** `+ Add Rule` → form (`Route *` shown as `{label} ({route})`, `Permission Level *`,
  `Entity *`, `Department *`, `Designation` optional = `Any (within department)`). Table columns:
  `Route` (mono) · `Permission Level` (badge) · `Entity` · `Department` · `Designation` (`any` when null) · *(Delete)*. Empty: `No rules defined.`
- **Entities tab:** per-entity **GM pointers** — table `Entity` · `GM Service` · `GM Spares` · `GM Back Office`,
  each an inline dropdown (`— None —` + eligible GMs), save-on-change (`Saving…` micro-label).
- **Configuration tab:** sub-tabs `Brands` · `Locations` · `Departments` · `Operating Units`.
  - Ref tables show `Code`/`Name` (+ optional `Label`, extra fields) · `Status` (`Active`/`Inactive`) · toggle. Add-row form beneath (`Add Brand`, etc.).
  - **Operating Units:** `+ Add Operating Unit`; table `Brand` (chip) · `Location` · `Entity Code` · `Company Name` · `GSTIN` (mono) · `Bank` · `Status` · *(Edit / toggle)*. Modal fields include `Entity Code` (`PTB — Gujarat` / `PT — Haryana`), `Company Full Name` (`PARAS TRUCKS AND BUSES`), `Address`, `GSTIN` (`24ABCDE1234F1Z5`), `Bank Account No.`, `Bank Name` (`Punjab National Bank`), `IFSC Code` (`PUNB0123456`).
- **Errors tab:** table `When` · `User` · `URL` (mono) · `Message`; row opens an `Error Detail` modal (`Message`/`Stack`/`Context`). Empty: `No errors logged.`

### 3.11 Vehicle Catalog — `/catalog`
Same route renders **two different UIs**. Both share H1 `Vehicle Catalog`. Segments constant:
`ICV Truck`, `Long Haul Trucks`, `Tipper`, `Bus – ICV`, `Bus – MCV`, `RMC / Boom Pump`. Brand is a
dropdown (`al` → Ashok Leyland, `switch` → Switch Mobility, `hdh` → HD Hyundai) — no brand tabs.

**Admin / Back-Office view** — tabs `Vehicles · Sub-Segments · Import`.
- **Vehicles tab:** search `Search CBN, description, sub-segment or MRP…`, segment filter, status filter
  (`All Status`/`Active`/`Inactive`), `+ Add Vehicle`. Table columns: `CBN` (mono) · `Description` · `Sub-Segment`
  · `Segment` (blue badge) · `MRP (incl. GST)` (right) · `Status` · *(Edit / Deactivate|Activate)*. Pagination 50/page.
  Empty: `🚛 No vehicles found`.
  - **REAL sample rows** (from `seed_vehicles.sql`):
    | CBN | Description | Sub-Segment | Segment | MRP (incl. GST) | Status |
    |---|---|---|---|---|---|
    | CDB111505C0004_YW | Ashok Leyland 1115 TB, 11.10T GVW, 150 HP - H4 BS6 Engine, 2990 WB, Day AC Cabin CBC, 105 L fuel tank, 6-speed OD GB | Boss 11T | ICV Truck | ₹21,47,202 | Active |
    | CDB121517C0003 | Ashok Leyland 1215 HB, 11.99T GVW, 150 HP - H4 BS6 Engine, 3900 WB, Day AC Cabin CBC, 208L fuel tank, 6-speed OD GB | Boss 12T | ICV Truck | ₹22,64,032 | Active |
    | CDB141514C0002 | Ashok Leyland 1415 HB, 14T GVW, 150 HP - H4 BS6 Engine, 3400 WB, Day AC Cabin CBC, 105 L fuel tank, 6-speed OD GB | Boss 14T | ICV Truck | ₹23,08,222 | Active |
  - **Add/Edit Vehicle modal:** `CBN *` (disabled in edit), `MRP incl. GST (₹) *`, `Description *`, `Brand *`,
    `Segment *`, `Sub-Segment`, `Tyres` (`e.g. 11R22.5 (16+2)`), `GST Rate (%)` (18), `Price Circular` (`e.g. Sep2025`),
    `Effective Date`, `Active` checkbox.
- **Sub-Segments tab:** table `Sub-Segment` · `Segment` · `Brand` (badge) · `Brochure` (`📎 {file}` / `Not uploaded`) · `Status` · *(Edit)*. Modal supports brochure PDF upload + CBN assignment.
- **Import tab:** upload wizard — brand select, Excel drop zone (`Drag & drop Excel file here`), preview stats
  (`{n} to update`, `{n} new`, `{n} skipped`), preview table (`New`/`Update` badges), `Import {n} vehicles`.

**Sales view** — filterable **card grid grouped by segment** (read-only). Search `Search models…`, segment filter.
Sub-segment cards show `{count} variant(s)` + `View Variants` (→ modal table `CBN` · `Description` · `Tyres` · `MRP (incl. GST)`)
and a brochure download. Empty: `🚛 No vehicles available`.

### 3.12 Bus Price Calculator — `/bus-calculator`
Two-column live configurator (all steps visible; steps 2–5 appear after a chassis is chosen). No Next/Back/Reset/Download.
H1 `Bus Price Calculator`, subtitle `Build a chassis + body estimate step by step — all prices incl. GST`.
- **STEP 1 — Chassis Selection:** search `Search CBN, model (Viking, Lynx), or length (11.4m, CNG)…` → type-ahead
  (CBN, `{model} · {oll}m · Diesel/CNG · TM-43/DDAC/Non-AC`, snippet, `₹L MRP incl. GST`). Selected card shows tags
  + a **Deal Price** input & slider with a discount chip (`↓ {₹L} below MRP ({x}% discount)` / `↑ … above MRP` / `= At MRP`).
- **STEP 2 — Body Type:** radio `🏫 School` / `💼 Staff`; `Body Price` input; a formula readout.
- **STEP 3 — Air Conditioning:** context note (TM-43 green / DDAC blue / Non-AC amber); radio `❄ With AC` / `— Non-AC`; `AC Cost` + formula when AC.
- **STEP 4 — Seating:** `Configuration` (`3×3`/`3×2`/`2×2`/`2×1`), width note, `Seat Type` (`Bench` ₹1,200 / `Highback (HHR)` ₹2,800 / `Pushback (SR)` ₹4,300), `Rows & Seat Count` select (`{seats}+D seats — {r} rows`), `3-Point Seatbelt` toggle (+₹1,000/seat, Highback & Pushback only).
- **STEP 5 — Add-ons** (toggle list): `Sunken Gallery` ₹25,000 · `Curtains` ₹15,000 · `Driver Partition` ₹15,000 · `LED Route Board` ₹15,000 · `Side Dickey` ₹10,000 · `Back Dickey` ₹20,000 · `Simple CCTV` ₹15,000 · `Live CCTV` ₹30,000 · `TV` ₹15,000.
- **Estimate panel (right, sticky):** `Total Estimated Price` big value (placeholder `🚌 Select a chassis`); line items
  `Chassis`, `Body`/`Body + AC`, `Seats`/`Seats + Add-ons`, `Total Fully Built` (`All prices incl. GST`); a collapsible
  `Detailed Breakdown` grouped by Chassis / Body / Seating / Add-ons. Footer note: “Estimate only. Final price subject to body builder quote, RTO, insurance, and dealer terms.”

### 3.13 TIV Forecast — `/tiv-forecast`
H1 `TIV Forecast`, subtitle `Industry volume forecasting and AL submission preparation · Ahmedabad territory`.
Admin-only **UploadPanel** (`Data Upload` — upload `Market_Data_YY-YY.xlsx`, retrain, upload history) above a model-info banner. Tabs: **Forecast · Triggers · Segments · Accuracy**.
- **Forecast:** active-trigger banner; layer sub-tabs `Layer 1 — TIV`, `Layer 2 — AL`, `Layer 3 — PTB`. Each is a
  `ForecastTable` with a `Segment` column + one column per forecast month (3-month horizon, e.g. `Jul-26`). Segment rows:
  `Bus PVT`, `Haulage`, `MAV`, `Tractor`, `Tipper`, `ICV Trucks`, + `Total`.
  - **Representative (Layer 1 — TIV):**
    | Segment | Jul-26 | Aug-26 | Sep-26 |
    |---|---|---|---|
    | Bus PVT | 412 | 398 | 405 |
    | Haulage | 1,240 | 1,190 | 1,215 |
    | MAV | 880 | 905 | 890 |
    | Tractor | 320 | 335 | 328 |
    | Tipper | 560 | 540 | 575 |
    | ICV Trucks | 710 | 695 | 720 |
    | **Total** | **4,122** | **4,063** | **4,133** |

    *(Representative volumes.)*
- **Triggers:** one card per trigger (checkbox, name, ON/OFF badge, severity badge/slider, description). 7 triggers
  (e.g. `FY End Push / Hangover`, `AIS 153 Bus Recovery`, `Monsoon Dampening`, `Navratri 2026 (Oct 11–19)`,
  `Diwali 2026 (Nov 8) + Vacation`, `Credit Environment`, `Iran War + Input Cost`).
- **Segments:** segment selector pills; three **recharts** charts — a historical line chart (TIV/PTB actual + forecast),
  an AL market-share line chart, and a stacked-bar TIV forecast by segment. Segment colors defined (Bus PVT `#0080C9`, etc.).
- **Accuracy:** MAPE bar chart (`Model MAPE %` blue, `Judgment MAPE %` amber, `15% AL tolerance` reference line) + a
  colour-coded pivot table by month/segment (`≤15%` green / `≤25%` amber / `>25%` red).

### 3.14 Vendor Jobs — `/vendor-jobs`
H1 `Vendor Jobs`, subtitle `Track outside-workshop & ancillary repair jobs end to end`. Button `+ New Job`.
- **Mode switch (segmented):** `Needs you` (with count pill) · `All jobs` · `Overview` (manager/gm/admin only).
  Admin-only lens dropdown (`Everything`/`GM`/`Manager`/`Accounts`/`Executive`).
- **Needs you:** role-specific action buckets, each a card with a title/hint and inline action buttons
  (`Mark work completed`, `Mark invoice received`, `Warranty to approve`, `Vendor payments due`,
  `Customer payments to record`, `Parts overdue`, `Add ancillary portal ref`, `My open jobs`).
  All-caught-up empty state: `✓ You're all caught up` + `Browse all jobs →`. GM/admin also see a `Recent changes` feed with `↩ Undo`.
- **Overview:** four stat tiles (`Parts out`, `Overdue`, `We owe vendors`, `Owed to us`) + `⚠ Bottlenecks` and `This week` cards.
- **All jobs:** sub-tabs `Active` · `Parts Out (N)` · `Past Record`; a parts-out clock banner; toolbar with
  search `Search reg no / PO no` and `⚙ Filters` popover (`Job type`: All/`Outside Job`/`Ancillary Work`;
  `Warranty / Paid`: All/`Warranty`/`Paid`; `Stage`: All/`PO Generated`/`Work Completed`/`Invoice Received`).
  - **Table columns:** `Age` (colored dot + chip like `out 3d`) · `PO No` · `Reg No` · `Type` · `Warranty / Paid` · `Stage` · `Vendor` · `Settlement`.
    | Age | PO No | Reg No | Type | Warranty / Paid | Stage | Vendor | Settlement |
    |---|---|---|---|---|---|---|---|
    | 🔴 out 4d | PO-2607-014 | GJ01AB1234 | Outside Job | Paid | PO Generated | Sharma Auto Electricals | — |
    | 🟢 idle 1d | PO-2607-011 | GJ27C7788 | Ancillary Work | Warranty | Work Completed | Bosch Diesel Services (Bosch) | not settled |
    | 🟠 idle 2d | PO-2606-098 | GJ01CD5678 | Outside Job | Paid | Invoice Received | Gujarat Radiator Works | vendor paid |

    *(Representative — for layout only.)*
- **Status badges:** stage (`Cancelled` red / `Completed` green / `PO Generated`·`Work Completed`·`Invoice Received`),
  vendor payment (`Vendor paid`/`Vendor unpaid`), settlement (`Not settled`).
- **New Service Job modal:** sections *Job classification* (Job type / Repair basis segmented radios),
  *Vehicle & customer* (`Vehicle registration no *` `e.g. GJ01AB1234`, `Customer name *`, `Vendor`/`Authorized dealer *`
  dropdown + `+ Add`), *Work details* (`Job description`, `Material out date *`, and — for Ancillary+Warranty — a
  `📝 Warranty request letter details` field grid). Submit `Create & Generate PO`.
- **Job detail modal:** meta grid, editable `Ancillary portal ref`, role-gated action buttons (`🖨 Re-print PO`,
  `Advance → {stage}`, `Mark vendor paid`, `Mark warranty processed`/`Mark payment received`, `Convert to paid`,
  `Cancel job`, `↩ Undo last status`), and a `Track log`.

---

## 4. Assets

**In `public/`:**
| Path | Type | Use |
|---|---|---|
| `public/paras-logo.png` | PNG | Paras Trucks logo — sidebar, login, PDFs |
| `public/ashok-leyland-logo.svg` | SVG | Ashok Leyland logo — PDF header |
| `public/al-stamp.png` | PNG | AL (PTB) rubber stamp — PDFs |
| `public/pt-stamp.png` | PNG | PT-entity rubber stamp — PDFs |
| `public/.well-known/security.txt` | text | Security contact policy |

**Typography:** Inter (Google Fonts, weights 400–800). Page `<title>`: `Paras Trucks — Team Portal`.

**Design tokens (current, `src/index.css`):** brand blue `#006FAD` (dark `#005A8E`, light `#E8F4FC`),
an 11-step gray ramp, semantic green `#16A34A` / amber `#D97706` / red `#DC2626`; radii 12/8/6px;
three shadow levels; sidebar 228px; canonical breakpoints 560 / 768 / 960px (legacy 900px shell flip).

**Gaps to flag to the designer:**
1. **Broken favicon** — `index.html` references `/favicon-32x32.png`, which does **not** exist in the repo.
2. **No unified icon system** — one inline-SVG set (`BIcon`, Vendor Jobs) + many emoji/Unicode glyphs used as icons.
3. **Missing brand logos** — only Ashok Leyland + Paras assets exist; **HD Hyundai** and **Switch Mobility** logos are absent and must be sourced.
4. **No header/topbar** — if the redesign wants global search, notifications, or breadcrumbs, they are net-new.
5. **No status lifecycle chips** on quotation/proforma/financier documents, and **no CSV/Excel export** on any list — net-new if desired.
6. **No dark mode** — the app is light-only today.
