# Changelog

All notable changes to the parastrucks.in website are recorded here.
Newest first. Dates are the commit dates on the `main` (live) branch.

## 2026-06-28

### Added
- `README.md` — project handover document (overview, structure, data
  provenance, deploy steps, runbook, caveats).
- `CHANGELOG.md` — this file, reconstructed from the full GitHub history.
- README/CHANGELOG pointer comment at the top of `index.html` source.

### Fixed
- **Footer column labels demoted from `<h4>` to `<div>` across all pages.**
  "Quick Links", "Our Brands", and "Contact" were `<h4>` headings, producing a
  broken heading outline (an `<h4>` with no `<h3>` above it) that hurts SEO and
  accessibility. Converted to `<div class="footer-heading">` on every page that
  has footer columns: `index`, `about`, `ashok-leyland`, `emi-calculator`,
  `bus-price-calculator`, `outlets`, `contact`, `careers`. Styling is unchanged
  (`.footer-heading` is paired with `.footer h4` in CSS). On `index.html` this
  also fixed 3 malformed `<div>…</h3>` tags and consolidated a duplicate
  `@media(max-width:640px)` block; `404.html` lost a trailing blank line.
  Commit `65077dc`.
- **`sitemap.xml` `lastmod` dates** set to each page's real last-commit date
  (were all a static `2026-03-22`). Commit `f43b14d`.
- **Careers page job postings — Search Console structured-data warnings.**
  Google Search Console flagged all 5 `JobPosting` entries on
  [`careers.html`](careers.html) for three missing recommended fields:
  `streetAddress`, `postalCode` (both under `jobLocation.address`), and
  `validThrough`. Added all three to every posting (Service Advisor,
  Technical Advisor, Floor Supervisor, DBM Operator, Spare Parts Executive)
  and refreshed `datePosted` to the repost date. After deploy, click
  **Validate Fix** on each report in Search Console so Google re-crawls.
  Commit `e44cab0`.

## 2026-04-08

### Changed
- **Ashok Leyland April 2026 price update.** Refreshed pricing to the
  Apr 2026 AL circular across the site:
  - Featured model prices on the homepage / model pages (`92ac68d`).
  - `alVehicles` price array used by the calculators (`df2c3d3`).
  - Bus chassis database expanded to 84 Apr-2026 entries and added the
    CCF family (`1e57778`).

## 2026-04-05

### Fixed
- Corrected malformed `<h4>` closing tags in the footer across all pages:
  `about.html`, `ashok-leyland.html`, `careers.html`, `contact.html`,
  `emi-calculator.html`, and `outlets.html`
  (`c11a710`, `536d1a2`, `57a5997`, `1f61304`, `a9e2b49`, `fb6dc31`).

## 2026-03-28

### Added
- **Bus price calculator** page (`bus-price-calculator.html`, `8349cd1`).
- **Price list PDFs** — Sep 2025 AL circulars (ICV trucks, long-haul,
  tipper, passenger PC154, etc.) under `pricelist/` (`3dfa0a0`).

### Changed
- Content/markup tweaks across the main pages and `404.html` (`0c67acc`).

## 2026-03-27

### Changed
- Cross-page footer / markup adjustments on the seven core pages (`f4646c7`).

## 2026-03-22

### Added
- **Initial site launch.** First publish of the core pages: `index.html`,
  `about.html`, `ashok-leyland.html`, `careers.html`, `contact.html`,
  `emi-calculator.html`, `hd-hyundai.html`, `outlets.html`,
  `switch-mobility.html`, plus `404.html` and the `CNAME`
  (`parastrucks.in`) for GitHub Pages (`d202e21` and same-day uploads).
- Image and asset library (logos, Ashok Leyland model photos, brand assets).

### Fixed
- Corrected double image extensions — `al-boss.jpg.jpg` → `al-boss.jpg` and
  the same for `al-ecomet`, `al-haulage`, `al-tipper`, `al-tractor`,
  `al-viking`.
