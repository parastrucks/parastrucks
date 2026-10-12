# Pre-mortem 1 — scripts

Record and findings: `docs/backlog/service-payments-premortem-1.md`.

Nothing here touches a live system. The database is an embedded PostgreSQL (PGlite, WASM)
built from the prod schema snapshot + seed + the migrations after the snapshot.

## One-time setup (dependencies live OUTSIDE the repo)

    S=<a scratch dir>; mkdir -p $S && cd $S && npm init -y
    npm i @electric-sql/pglite@0.3.9 xlsx@0.18.5 esbuild@0.24.2
    cd <repo>
    ln -s $S/node_modules scripts/payments/premortem/node_modules   # gitignored
    ln -s $S/node_modules node_modules                               # gitignored; lets make-demo-files.mjs import xlsx

(The repo's own `npm ci` cannot run in the cloud container: its `xlsx` is a cdn.sheetjs.com
tarball the proxy refuses. On the PC, the repo's `node_modules` works and only the first
symlink is needed.)

## Track A — rehearse the prod migration

    node scripts/payments/premortem/rehearse-db.mjs            # snapshot + seed + migrations, prints every gap
    node scripts/payments/premortem/run-probes.mjs             # post-migration checks + the 4 self-aborting probes

`rehearse-db.mjs --through 20260926` stops after that prefix. Every failing statement is
printed with its first 110 characters; the snapshot's 9 benign failures are listed in the doc.

## Track B — live the first month

    node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs --days 30 --seed 7 --json /tmp/month.json

`matchQueue.js` imports the Edge Function's `authority.ts`, hence `--experimental-strip-types`
(Node 22.6+). Prints the scored month as JSON; the modelled knobs are in `MODEL` at the top of
the script, each marked `[plan]` (measured in the plan) or `[assumed]`.

## Files

- `rehearse-db.mjs` — loader (statement by statement, psql-style), `openRehearsalDb()`,
  `postMigrationChecks()`
- `sql-split.mjs` — splits SQL on `;` outside quotes, dollar-quoted bodies and comments
- `seed-load.mjs` — `COPY … FROM stdin` → INSERT; the 7 synthetic users; `actAs()` (JWT GUC)
- `run-probes.mjs` — runs `probe-allocation`, `probe-import-parity`, `probe-awaiting-invoice`,
  `probe-read-gates` and parses their "PROBE COMPLETE" exceptions
- `simulate-month.mjs` — Track B
