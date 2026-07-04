# docs/ — documentation index

| Path | What it is |
|---|---|
| [`RECONSTRUCTION.md`](RECONSTRUCTION.md) | **Rebuild the whole system from scratch** — DB, Edge Functions, frontend, config. Backed by `db/`. |
| [`db/`](db/) | Canonical DB artifacts: `schema-current.sql` (full schema — tables, RLS, functions, triggers), `seed-reference.sql` (config/reference data, no PII), plus legacy Phase-1 base + old vehicle seed. |
| [`history/PORTAL_HISTORY.md`](history/PORTAL_HISTORY.md) | **Master archive** — every phase, the Phase 9 VAPT programme, session logs. Read on demand only. |
| [`history/phase9-verification-report.md`](history/phase9-verification-report.md) | Plain-English Phase 9 VAPT re-test findings (2026-05-18). |
| [`history/tiv-forecast-migration-spec.md`](history/tiv-forecast-migration-spec.md) | Build spec for the (delivered) TIV Forecast module. |
| [`backlog/service-jobs-future-ideas.md`](backlog/service-jobs-future-ideas.md) | Tabled Vendor-Jobs UX ideas. |
| [`backlog/phase10-vehicle-tracker.md`](backlog/phase10-vehicle-tracker.md) | Phase 10 (planned) pointer. |

Operational "how to work here" + current state live in the repo-root [`CLAUDE.md`](../CLAUDE.md).
