# Paras Trucks Website (`parastrucks.in`)

Marketing website for **Paras Trucks and Buses** — an authorized multi-brand
commercial-vehicle dealership group (Ashok Leyland, Switch Mobility EVs,
HD Hyundai construction equipment) operating 11 facilities across Haryana and
Gujarat.

This README is the handover document: it explains **what the site is, how it's
built, where the content came from, how to change it, and how it goes live.**
For a dated record of changes, see [`CHANGELOG.md`](CHANGELOG.md).

> This document covers the **`main`** branch only — the public website.

---

## 1. At a glance

| | |
|---|---|
| **Live URL** | https://parastrucks.in |
| **Hosting** | GitHub Pages |
| **Repo** | `parastrucks/parastrucks` (branch **`main`**, served from root `/`) |
| **Custom domain** | `parastrucks.in` (set via the [`CNAME`](CNAME) file) |
| **Tech stack** | Plain static HTML5 + CSS + vanilla JS. **No framework, no build step, no backend.** |
| **External fonts** | Google Fonts (Inter), loaded per page |
| **Analytics** | None installed |
| **Deploy** | `git push` to `main` → Pages rebuilds (~1 min) |

Because there is no build step, **what you see in the `.html` files is exactly
what ships.** Each page is self-contained: its CSS lives in an inline `<style>`
block and its JS in an inline `<script>` block. There are no shared
CSS/JS files to compile or bundle.

---

## 2. Repository structure

```
parastrucks/                 (branch: main)
├── index.html               Homepage
├── about.html               Company / group story
├── ashok-leyland.html       Brand page — AL trucks, buses, tippers
├── switch-mobility.html     Brand page — Switch electric vehicles
├── hd-hyundai.html          Brand page — HD Hyundai construction equipment
├── emi-calculator.html      EMI calculator (hardcoded AL prices)
├── bus-price-calculator.html  INTERNAL pricing tool (not in sitemap, no SEO)
├── outlets.html             11 outlet locations (data in inline JS)
├── contact.html             Contact / enquiry page
├── careers.html             Careers + 5 job postings (JobPosting structured data)
├── 404.html                 Custom not-found page
│
├── CNAME                    Custom domain for GitHub Pages (parastrucks.in)
├── robots.txt               Allows all crawlers; points to sitemap
├── sitemap.xml              9 public URLs for search engines
├── CHANGELOG.md             Dated history of site changes
├── README.md                This file
│
├── images/                  All site imagery
│   ├── paras-logo.png, *-logo.svg        Brand logos
│   ├── al-*.jpg                           Ashok Leyland model photos
│   ├── *-showroom.jpg, showroom-aerial.jpg  Facility photos
│   ├── <name>.jpg / .png                  Team / leadership photos
│   └── favicon*, apple-touch-icon.png     Site icons
│
├── jds/                     Job-description PDFs linked from careers.html
│   └── JD_*_Paras_Trucks.pdf  (Service Advisor, Technical Advisor,
│                               Floor Supervisor, DBM Operator, Spare Parts Exec)
│
└── pricelist/               Source Ashok Leyland price-circular PDFs (reference)
    └── *.pdf                 (ICV, Long Haul, Tipper, Passenger PC154, etc.)
```

---

## 3. Page guide

| Page | Purpose | Notable content / data |
|------|---------|------------------------|
| `index.html` | Homepage / group overview | Hero, brand cards, stats (11 facilities, 410+ staff, since 2019), Organization structured data |
| `about.html` | Company story, leadership, footprint | Team photos, Organization structured data |
| `ashok-leyland.html` | AL product range | LCV/MCV/HCV trucks, buses, tippers; model photos; structured data |
| `switch-mobility.html` | Switch EV range | Electric buses/trucks (5 outlets) |
| `hd-hyundai.html` | HD Hyundai CE range | Excavators, wheel loaders (4 outlets, Hisar 3S flagship) |
| `emi-calculator.html` | Customer EMI tool | **`alVehicles`** + **`models`** JS arrays hold AL prices |
| `bus-price-calculator.html` | **Internal** bus pricing tool | Bus chassis database in inline JS. Deliberately excluded from `sitemap.xml` and has no canonical/OG/structured-data tags. |
| `outlets.html` | All 11 locations | **`outlets`** JS array (name, address, phone, brands) |
| `contact.html` | Enquiry + contact channels | Phone, WhatsApp, email; mailto-based enquiry |
| `careers.html` | Job listings | 5 postings, each with a `JobPosting` JSON-LD block and a JD-PDF link; apply via prefilled `mailto:` |
| `404.html` | Not-found fallback | Served by GitHub Pages on unknown paths |

---

## 4. Content & data provenance

Most content is hand-authored HTML. The data-driven parts and where their
numbers come from:

- **Vehicle prices** originate from **Ashok Leyland price circulars** (the
  source PDFs are kept in [`pricelist/`](pricelist/)). They are **manually
  transcribed** into the site — there is no live feed. Prices appear in:
  - `emi-calculator.html` → `alVehicles` and `models` JS arrays.
  - `bus-price-calculator.html` → inline bus-chassis database.
  - Featured prices on `index.html` / brand pages (inline HTML).
  - The latest transcription was the **April 2026 AL circular** (see CHANGELOG).
- **Outlet data** (`outlets.html` → `outlets` array): names, addresses, phones,
  and which brands each facility carries.
- **Job descriptions**: the 5 PDFs in [`jds/`](jds/), linked from `careers.html`.
  The on-page postings and their `JobPosting` structured data mirror these PDFs.
- **Imagery**: all in [`images/`](images/) — brand logos (SVG), AL model photos,
  showroom photos, team photos, and favicons.

---

## 5. Contact & integration points

All interactions are **client-side links** — there is no server or form handler.
If these need to change, search-and-replace across the `.html` files:

| Channel | Value | Used on |
|---------|-------|---------|
| Phone | `tel:7496970303` (+91 74969 70303) | All pages (top bar / footer) |
| WhatsApp | `wa.me/917496970303` | Contact / CTAs |
| General email | `mailto:hi@parastrucks.in` | Top bar / contact |
| Job applications | `mailto:hr.guj@parastrucks.in` with a pre-filled subject & body per role | `careers.html` |

---

## 6. SEO setup

- **`sitemap.xml`** — lists the 9 public pages (the internal bus calculator is
  intentionally excluded). _Note: `lastmod` dates are static (`2026-03-22`) and
  are not auto-updated; refresh them when a page changes materially._
- **`robots.txt`** — allows all crawlers and points to the sitemap.
- **Per-page tags** — every public page has a `<title>`, meta description,
  canonical URL, and OpenGraph tags.
- **Structured data (JSON-LD)** — `index.html` / `about.html` /
  `ashok-leyland.html` carry Organization-type data; `careers.html` carries one
  `JobPosting` block per open role. Validate changes with
  [Google Rich Results Test](https://search.google.com/test/rich-results) and
  monitor **Google Search Console → Enhancements** for warnings.

---

## 7. How to deploy

The repo is the deploy mechanism — pushing to `main` publishes the site.

```bash
# 1. edit the relevant .html file
# 2. stage ONLY the file(s) you changed (see caveat below)
git add careers.html
git commit -m "..."
git push origin main
# GitHub Pages rebuilds in ~1 minute; hard-refresh to bypass cache
```

There is nothing to build or run locally — to preview, just open the `.html`
file in a browser (or run any static server, e.g. `python -m http.server`).

---

## 8. Common tasks (runbook)

- **Update vehicle prices** (new AL circular): drop the new circular PDF into
  `pricelist/`, then update the numbers in `emi-calculator.html`
  (`alVehicles` / `models`), `bus-price-calculator.html` (chassis DB), and any
  featured prices on `index.html` / brand pages. Add a CHANGELOG entry.
- **Add / change a job posting**: update the job card HTML **and** the matching
  `JobPosting` JSON-LD block in `careers.html`; add/replace the JD PDF in `jds/`.
  Required JSON-LD fields to keep valid: `title`, `description`, `datePosted`,
  `validThrough`, `employmentType`, `hiringOrganization`, and a full
  `jobLocation.address` (incl. `streetAddress` and `postalCode`).
- **Add / edit an outlet**: edit the `outlets` array in `outlets.html`.
- **Edit page text / styling**: edit the page's inline HTML / `<style>` directly.
- **Add a new page to SEO**: add its `<url>` entry to `sitemap.xml`.

---

## 9. Known caveats / gotchas

- **No shared assets** — each page duplicates its own CSS/JS. A global style
  change must be repeated per page (or scripted).
- **Prices are manual** — there is no automatic sync from AL circulars; stale
  prices are a content risk, not a code bug.
- **`sitemap.xml` `lastmod` is not automated** — update by hand when relevant.
- **The local working folder may diverge from `main`** — it can be missing some
  tracked images or contain untracked working files. **Always `git add` the
  specific file(s) you changed; never `git add -A`/`git add .`,** or you may
  delete repo assets or push unrelated changes.
- **`bus-price-calculator.html` is internal** — keep it out of the sitemap and
  out of public navigation.
