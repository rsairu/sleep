---
name: Postgres sleep_date migration (master plan)
overview: >
  Incrementally move sleep_days / sleep_day_drafts from a text `date_md` (M/D)
  key to a native `sleep_date date` column with composite uniqueness
  (user_id, sleep_date), wired to RESTORE_CLOUD_USER_ID. JS model uses
  ISO YYYY-MM-DD throughout. Ends with a final cutover that drops date_md and
  all legacy constraints.
phases_completed: [phase1-iso-js, phase2-ddl, phase3-rest, phase4-rpc]
next_phase: phase5-js-legacy
---

# Master Plan — Postgres `sleep_date` + Composite Unique Key

## Project context (read first)

### The problem being solved
`sleep_days` / `sleep_day_drafts` originally used `date_md text NOT NULL
UNIQUE` (format `M/D`, e.g. `"3/15"`). A global unique on `M/D` cannot
coexist with multi-year data — the same month/day repeats. Multi-year cloud
storage requires removing uniqueness on `M/D` and enforcing identity on
`(user_id, sleep_date)` instead.

### Key constants (never change without updating both DB and JS)
| Constant | Value | Where used |
|---|---|---|
| `RESTORE_CLOUD_USER_ID` | `00000000-0000-0000-0000-000000000001` | `sleep-utils.js`, DB column default, `user_settings` seed |
| `LEGACY_SLEEP_DATE_FALLBACK_YEAR` | `2026` | `sleep-utils.js`, DB backfill helper |

### File map
| File | Role |
|---|---|
| `sleep-utils.js` | All cloud I/O, date helpers, mapping functions |
| `supabase/schema.sql` | Canonical schema (updated after each phase) |
| `supabase/migrations/` | Incremental migration SQL files |
| `data/sleep-data.json` | Local fixture data |
| `math-tests.js` | Unit tests — run with `node math-tests.js` |
| `daily.js` | Daily view |
| `stats.js` | Stats, `groupDaysByMonth` |
| `graph.js` | Graph rendering |
| `quality.js` | Quality heatmap |
| `entry-modal.js` | Entry/edit modal |
| `quick-actions.js` | Quick action buttons |
| `docs/user-data-cloud.md` | Cloud architecture notes |

---

## Phase completion status

### ✅ Phase 1 — ISO date in the JS client (DONE)

All client code uses `YYYY-MM-DD` for `day.date`. Legacy `M/D` is supported
via a parser with explicit fallback year.

**What was implemented:**
- `normalizeSleepDateKey`, `parseIsoLocalDate`, `parseSleepDateToLocalDate`,
  updated `parseDateString` / `getDateFromString` in `sleep-utils.js`
  (~lines 1219–1327).
- `mapDayToSupabaseRow` sends ISO-normalized value in `date_md`
  (`sleep-utils.js` ~475–492).
- `stats.js` `groupDaysByMonth` keys by `YYYY-MM`.
- `graph.js` no longer uses `split('/')`.
- `daily.js` derives context from `getAppDate()` / `getDateFromString`; no
  pinned `YEAR` constant.
- `data/sleep-data.json` uses `YYYY-MM-DD`.
- `math-tests.js` sample rows use ISO.
- `sortDaysNewestFirst` sorts via `normalizeSleepDateKey`.

**Not yet done (intentional):** No two-year fixture slice for automated
regression; logic supports it but no checked-in test data.

---

### ✅ Phase 2 — Supabase DDL + RPC fix (DONE)

Migration file: `supabase/migrations/20260414120000_phase2_user_sleep_date.sql`

**What the migration does (already applied or ready to apply to Supabase):**

1. Adds helper function `restore_parse_sleep_date_md(text, integer)` — parses
   ISO or `M/D` / `M/D/YYYY`, default year 2026. `EXECUTE` revoked from
   `PUBLIC` (not a public RPC).
2. Adds `user_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'`
   to `sleep_days` and `sleep_day_drafts`.
3. Adds `sleep_date date` (nullable initially) to both tables.
4. Backfills `sleep_date` from `date_md` (branches on ISO vs legacy M/D).
5. Normalizes `date_md` to `YYYY-MM-DD` for debugging parity.
6. Sets `sleep_date NOT NULL`.
7. Checks for duplicates on `(user_id, sleep_date)` before creating unique
   index — fails with a clear error if any exist.
8. **Drops** `sleep_days_date_md_key` and `sleep_day_drafts_date_md_key`.
9. **Creates** `sleep_days_user_id_sleep_date_key` and
   `sleep_day_drafts_user_id_sleep_date_key`.
10. **Replaces** `promote_draft_if_complete(p_date_md text, p_patch jsonb)` —
    same external signature, now keys internally on `(user_id, sleep_date)`,
    uses `ON CONFLICT (user_id, sleep_date)`, returns ISO in `result_date_md`.

**`supabase/schema.sql`** updated to match post-Phase 2 shape.

**`sleep-utils.js` changes in Phase 2:**
- `mapDayToSupabaseRow` sends `user_id` + `sleep_date`.
- `mapSupabaseRowToDay` prefers `sleep_date` when present.
- `fetchSupabaseSleepData` selects `user_id,sleep_date,...` and filters
  `user_id=eq.<RESTORE_CLOUD_USER_ID>`.
- `upsertSleepDay` uses `on_conflict=user_id,sleep_date`.
- `getSleepDraftByDate` filters on `user_id` + `sleep_date`.
- `saveDraftAndMaybePromote` normalizes the key before `p_date_md`.
- Connection test uses `sleep_date` + `user_id` filter.

`node math-tests.js` passes.

---

### ✅ Phase 3 — Full cloud I/O audit: read/write `user_id` + `sleep_date` (DONE)

**Goal (met in repo):** All PostgREST paths for `sleep_days` / `sleep_day_drafts`
live in `sleep-utils.js` only. Static audit: every `select=` for those tables
includes `user_id` and `sleep_date`; list reads filter `user_id`; row-specific
draft reads filter `user_id` + `sleep_date`; upserts use
`on_conflict=user_id,sleep_date` with `Prefer: resolution=merge-duplicates`;
`mapDayToSupabaseRow` always sets `RESTORE_CLOUD_USER_ID` and ISO `sleep_date` /
`date_md`. **Phase 4** renamed the RPC to `p_user_id`, `p_sleep_date`, `p_patch`
(see below).

**Code changes in Phase 3:**
- `mapSupabaseRowToDay`: one-time `console.warn` if a row has `date_md` but no
  usable `sleep_date` (should not happen post–Phase 2); avoids log spam on
  bulk fetch.
- Settings connection test: `select=user_id,sleep_date` (was `sleep_date` only).

**Your verification (run on your dev-preset Supabase):** Phase 2 migration must
already be applied. Use SQL Editor or `psql` as you prefer.

1. **No null `sleep_date` on real data**

```sql
select 'sleep_days' as tbl, count(*) as missing
from public.sleep_days
where sleep_date is null
union all
select 'sleep_day_drafts', count(*)
from public.sleep_day_drafts
where sleep_date is null;
```

Expect `0` / `0`. If not, backfill or re-run migration logic before relying on
the app.

2. **`date_md` normalized to ISO** (spot check)

```sql
select sleep_date, date_md
from public.sleep_days
where date_md !~ '^\d{4}-\d{2}-\d{2}$'
limit 20;
```

Expect **no rows**. (Empty result = all `date_md` look like `YYYY-MM-DD`.)

3. **Two-year coexistence** (optional; use dates you do not care about, then
   delete)

```sql
-- Insert two canonical nights for the restore user (adjust times if NOT NULL requires more)
insert into public.sleep_days (user_id, sleep_date, date_md, bed, sleep_start, sleep_end)
values
  ('00000000-0000-0000-0000-000000000001', '2025-03-15', '2025-03-15', '22:00', '22:30', '06:00'),
  ('00000000-0000-0000-0000-000000000001', '2026-03-15', '2026-03-15', '22:00', '22:30', '06:00')
on conflict on constraint sleep_days_user_id_sleep_date_key do nothing;

select sleep_date, date_md from public.sleep_days
where user_id = '00000000-0000-0000-0000-000000000001'
  and sleep_date in ('2025-03-15', '2026-03-15');
```

Expect **two rows**. Cleanup:

```sql
delete from public.sleep_days
where user_id = '00000000-0000-0000-0000-000000000001'
  and sleep_date in ('2025-03-15', '2026-03-15');
```

4. **Duplicate key** (expect one row inserted, second statement errors)

```sql
insert into public.sleep_days (user_id, sleep_date, date_md, bed, sleep_start, sleep_end)
values ('00000000-0000-0000-0000-000000000001', '2099-01-01', '2099-01-01', '22:00', '22:30', '06:00');

insert into public.sleep_days (user_id, sleep_date, date_md, bed, sleep_start, sleep_end)
values ('00000000-0000-0000-0000-000000000001', '2099-01-01', '2099-01-01', '23:00', '23:30', '07:00');
```

Second insert should fail on `sleep_days_user_id_sleep_date_key`. Then:

```sql
delete from public.sleep_days
where user_id = '00000000-0000-0000-0000-000000000001' and sleep_date = '2099-01-01';
```

5. **App / draft lifecycle (no SQL):** With cloud data source on, in the UI:
   start a new night for a disposable date → partial save → reload or navigate
   → complete required fields so it promotes → confirm one row in `sleep_days`
   and no draft for that `sleep_date` → edit the night and confirm merge.

`docs/user-data-cloud.md` already documents composite key and gate; no
behavior change required for Phase 3.

**Validation gate:** `node math-tests.js` passes after changes; your checks
above pass on the DB you use with the dev preset.

---

### ✅ Phase 4 — RPC parameter rename: `p_sleep_date` / `p_user_id` (DONE)

**Goal:** Typed RPC args aligned with table identity; return `result_sleep_date`.

**Implemented:**
- Migration: `supabase/migrations/20260415120000_phase4_promote_rpc_params.sql`
  — `drop function promote_draft_if_complete(text, jsonb)`; new signature
  `promote_draft_if_complete(p_user_id uuid, p_sleep_date date, p_patch jsonb)`
  returns `(promoted boolean, result_sleep_date date)`.
- SQL `coalesce(p_user_id, …)` on the restore UUID if null; client always sends
  `RESTORE_CLOUD_USER_ID` from `sleep-utils.js`.
- `saveDraftAndMaybePromote` POST body: `p_user_id`, `p_sleep_date` (ISO
  `YYYY-MM-DD`), `p_patch`. `normalizePromoteDraftRpcResult` maps the response
  and still accepts legacy `result_date_md` if an old server responds during
  rollout.
- `supabase/schema.sql` and `.github/workflows/sync-supabase-dev-from-prod-v2.yml`
  grant updated to `(uuid, date, jsonb)`.

**Apply:** Run the new migration on each Supabase project **before** or with
deploying the updated `sleep-utils.js` (old RPC signature is removed).

**Validation:** Partial draft → complete → promote; duplicate-night merge;
`node math-tests.js` passes.

---

## Phase 5 — Remove all `M/D` / `date_md` / legacy `YEAR` from JS

**Goal:** No JS code path depends on `M/D` strings or global year constants.

**Tasks:**
1. Grep for: `date_md`, `split('/')`, `YEAR`, `parseDateString`, `M/D`,
   `getDateFromString` with hardcoded year — remove dead branches now that
   ISO is the only format.
2. Remove `LEGACY_SLEEP_DATE_FALLBACK_YEAR` references once no legacy data
   can exist in the DB (after Phase 2 backfill + normalization confirmed).
3. `sortDaysNewestFirst` — confirm it sorts lexicographically on ISO strings
   (or via `Date` objects); no M/D special-casing.
4. Regression pass on: log view, daily, stats, graph, quality, quick actions,
   config cloud test.

**Validation:** Full UI regression. `node math-tests.js` passes. No `date_md`
or `M/D` string manipulation in JS.

---

## Phase 6 — Final cutover (coordinated, short window)

**Goal:** Drop `date_md` column entirely. One schema shape.

**Tasks (must be done in order within a single deploy window):**
1. **Deploy** the app build from Phase 5 (never reads/writes `date_md`).
2. **DDL:**
```sql
   ALTER TABLE sleep_days DROP COLUMN date_md;
   ALTER TABLE sleep_day_drafts DROP COLUMN date_md;
   DROP FUNCTION IF EXISTS restore_parse_sleep_date_md(text, integer);
```
3. **`supabase/schema.sql`:** Final definition — `user_id`, `sleep_date`,
   composite unique, updated RPC, no `date_md`, no helper function.
4. **Cache invalidation:** Clear or bump `SLEEP_DATA_LOCAL_CACHE_KEY` in
   `sleep-utils.js` so stale local cache (which may contain old-format rows)
   is evicted on first load.
5. **Connection test:** Run from Settings UI against production Supabase.
6. **Smoke test:** Create / edit a night across a year boundary; confirm
   PostgREST errors gone; confirm stats/graph render correctly.

**Validation:** Production Supabase smoke test passes. No schema references
to `date_md` anywhere.

---

## Architecture notes for the next agent

### Constraint names (stable, used in PostgREST `on_conflict=`)
| Table | Constraint name |
|---|---|
| `sleep_days` | `sleep_days_user_id_sleep_date_key` |
| `sleep_day_drafts` | `sleep_day_drafts_user_id_sleep_date_key` |

PostgREST `on_conflict` value: `user_id,sleep_date` (column names, not
constraint name — PostgREST resolves via the unique index).

### Auth trajectory
Currently all sleep rows use `RESTORE_CLOUD_USER_ID` as a single-tenant
placeholder. When real auth ships:
- Substitute the signed-in user's UUID for `RESTORE_CLOUD_USER_ID`.
- Enforce `auth.uid() = user_id` via RLS.
- See `docs/user-data-cloud.md` and `.cursor/rules/user-data-cloud.mdc`.
- No schema change needed — the `user_id` column and composite unique are
  already the correct shape for multi-user.

### Running tests
```bash
node math-tests.js
```
Must pass after every phase. No other test runner currently configured.

### Migration files
```
supabase/
  schema.sql                          ← canonical current-head schema
  migrations/
    20260414120000_phase2_user_sleep_date.sql   ← Phase 2 (applied)
    20260415120000_phase4_promote_rpc_params.sql  ← Phase 4 RPC (apply with app)
```