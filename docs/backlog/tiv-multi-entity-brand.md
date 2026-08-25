# TIV Forecast — multi-entity / multi-brand is unsupported, and failing silently

**Status:** OPEN · found 2026-08-24 · **latent today, destructive the moment a second dataset is uploaded**
**Needs:** explicit owner approval before any constraint change (`memory/feedback_no_schema_deletion`)

---

## How it surfaced

Owner, 2026-08-24:

> "we can upload multiple identities and multiple brand data, but there is no change in the
> viewing option available."

The missing viewing selector is real. It is also the **smaller half** of the problem.

## What is actually wrong

### 1. The schema can only hold ONE dataset

All six data tables carry a **global** uniqueness constraint on the month label:

```
tiv_forecast_tiv_actuals      UNIQUE (month_label)
tiv_forecast_ptb_actuals      UNIQUE (month_label)
tiv_forecast_al_actuals       UNIQUE (month_label)
tiv_forecast_judgment_tiv     UNIQUE (month_label)
tiv_forecast_judgment_ptb     UNIQUE (month_label)
tiv_forecast_raw_data         UNIQUE (month_label)
```

It is `UNIQUE (month_label)` — **not** `UNIQUE (entity_id, brand_id, month_label)`.

And `admin-tiv` upserts against exactly that key (`supabase/functions/admin-tiv/index.ts:93-100`):

```ts
// HISTORICAL (deleted 2026-08-25) - admin-tiv, before uploads moved to tiv_upload_all()
const TABLE_CONFIG: Record<string, { onConflict: string }> = {
  tiv_forecast_tiv_actuals:  { onConflict: "month_label" },
  ...
}
```

**Consequence:** uploading a second entity/brand does not create a parallel dataset. The upsert
finds the existing `Apr-22` row — belonging to the *first* entity/brand — and **overwrites it in
place**, re-stamping its `entity_id` and `brand_id`. There is no error. The upload reports
success. The first dataset is gone.

This is silent data loss, and the entity+brand selector added in PR #46 is a promise the schema
cannot keep.

### 2. `model_params` accumulates, but the reader ignores scope

`tiv_forecast_model_params` has **no** unique constraint, so rows for different entity/brand pairs
can coexist. But the read is:

```js
// src/tiv-forecast/lib/dataQueries.js
.from('tiv_forecast_model_params').select('*')
.order('trained_at', { ascending: false }).limit(1).maybeSingle()
```

No entity/brand filter. **Whichever pair was trained most recently wins for everybody.**

### 3. Every read is unscoped

Not one read in `dataQueries.js` filters by entity or brand — there is no `.eq('entity_id', ...)`
anywhere in the file. The only filtered read is `fetchTriggerState`, and that filters `user_id`.

Writes all take `(rows, entityId, brandId)`. Reads take nothing. That asymmetry *is* the bug.

### 4. RLS does not save it

```
admin OR (entity_id = <caller's entity> AND has_user_brand(brand_id))
```

- **Admin** matches the first branch and therefore sees **every entity and brand merged**.
- A **multi-brand user** (SUNIL and Siya hold `al+hdh+switch`) sees several brands' rows
  concatenated. Both then collide in `actualMap[r.month_label]`, where the last row silently wins.

## Blast radius today

**Latent — measured on prod 2026-08-24, not assumed:**

| table | rows | distinct (entity, brand) |
|---|---|---|
| `tiv_forecast_tiv_actuals` | 60 | **1** |
| `tiv_forecast_ptb_actuals` | 60 | **1** |
| `tiv_forecast_al_actuals` | 52 | **1** |
| `tiv_forecast_model_params` | 18 | **1** |

Only PTB/AL data exists, so nothing has been lost. The defect activates on the **first** upload
under a different entity or brand.

## Fix, in dependency order

A viewing dropdown must come **last**. Shipping it first would make the destructive path easier
to reach, not safer.

1. **Constraint swap** (needs owner approval — this is the destructive step)
   - `UNIQUE (month_label)` → `UNIQUE (entity_id, brand_id, month_label)` on all six tables.
   - Update the conflict target to `(entity_id, brand_id, month_label)` **inside**
     `tiv_upload_all()` (migration `20260825_tiv_atomic_upload.sql`), which is where the six
     upserts now live.
   - ⚠️ **`TABLE_CONFIG` in `admin-tiv` no longer exists** — it was deleted 2026-08-25 along with
     the superseded `upsertRows` / `insertModelParams` / `insertUploadHistory` actions, because
     uploads go through the RPC. Do not go looking for it; the conflict target is SQL now.
   - Deploy the EF and the constraint **together**; a mismatch between them silently reverts to
     overwrite-on-conflict behaviour.
2. **Scope every read.** Thread `(entityId, brandId)` through all of `dataQueries.js` and filter
   server-side. Do not filter in the client after fetching — that leaks other brands' rows over
   the wire and still breaks the 1000-row PostgREST cap.
3. **Add the selector**, defaulting to the viewer's own entity plus their first brand. Persist the
   choice the way trigger state is persisted.
4. **Label the active scope** wherever numbers appear, so a PT/Switch view can never be mistaken
   for PTB/AL.

## Interim guard (cheap, non-destructive, ~10 lines)

If the full fix is not scheduled soon, make `admin-tiv` **refuse** an upsert whose `month_label`
already exists under a *different* `(entity_id, brand_id)`. That converts silent data loss into a
clear error, and it needs no schema change:

```sql
-- inside upsertRows, before the upsert
select 1 from <table>
where month_label = any($labels)
  and (entity_id, brand_id) is distinct from ($entity_id, $brand_id)
limit 1;
-- if a row comes back -> 409, do not write
```

## Notes for whoever picks this up

- `retrainModel` is **not** affected: it runs client-side on the parsed workbook, not on DB reads,
  so training never mixes brands. Only storage and display are affected.
- `tiv_forecast_upload_history` is readable by any authenticated user
  (`auth.uid() IS NOT NULL`) and carries no entity/brand column — worth reviewing at the same time.
- Do not "fix" this by having the reader pick `max(last_data_month)`: that column is **text**, and
  `'May-26' > 'Jul-26'` alphabetically. Sort by `month_index`, or by `trained_at` for params.
