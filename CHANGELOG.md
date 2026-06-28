# Changelog

All notable changes to the parastrucks.in website are recorded here.
Newest first.

## 2026-06-28

### Fixed
- **Careers page job postings — Search Console structured-data warnings.**
  Google Search Console flagged all 5 `JobPosting` entries on
  [`careers.html`](careers.html) for three missing recommended fields:
  `streetAddress`, `postalCode` (both under `jobLocation.address`), and
  `validThrough`. Added all three to every posting (Service Advisor,
  Technical Advisor, Floor Supervisor, DBM Operator, Spare Parts Executive)
  and refreshed `datePosted` to the repost date. After deploy, click
  **Validate Fix** on each report in Search Console so Google re-crawls.
  Commit: `e44cab0`.
