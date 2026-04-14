---
name: Postgres sleep_date migration (master plan)
overview: >
  Incrementally move sleep_days / sleep_day_drafts from a text `date_md` (M/D)
  key to a native `sleep_date date` column with composite uniqueness
  (user_id, sleep_date), wired to RESTORE_CLOUD_USER_ID. JS model uses
  ISO YYYY-MM-DD throughout. Ends with a final cutover that drops date_md and
  all legacy constraints.
phases_completed: [phase1-iso-js, phase2-ddl]
next_phase: phase3-rest
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
10. **Replaces** `promote_draft_if_complete(p_date_md text, p_data jsonb)` —
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

## 🔜 Phase 3 — Full cloud I/O audit: read/write `user_id` + `sleep_date` (NEXT)

**Goal:** Every cloud path in `sleep-utils.js` is fully audited and tested
against the Phase 2 schema. No path should be relying on `date_md` for
identity (only for legacy compatibility if still written). No path should
fetch or upsert without a `user_id` filter.

**Starting state (what Phase 2 already did to `sleep-utils.js`):**
The following were updated in Phase 2 but need integration/regression testing
in a staging environment:
- `mapDayToSupabaseRow` → sends `user_id`, `sleep_date`
- `mapSupabaseRowToDay` → reads `sleep_date` preferentially
- `fetchSupabaseSleepData` → selects + filters by `user_id`
- `upsertSleepDay` → `on_conflict=user_id,sleep_date`
- `getSleepDraftByDate` → filters `user_id` + `sleep_date`
- `upsertSleepDraftPartial` → `on_conflict=user_id,sleep_date`
- `saveDraftAndMaybePromote` → passes normalized key as `p_date_md`
- Connection test → uses `sleep_date` + `user_id` filter

**Tasks for Phase 3:**

1. **Staging environment:** Point the app at a Supabase staging project with
   the Phase 2 migration applied. Confirm all rows have `sleep_date` populated
   and `date_md` is now ISO.

2. **Audit `select=` strings:** Grep `sleep-utils.js` for all PostgREST
   `select=` strings. Confirm each one includes `user_id,sleep_date` and does
   not rely on `date_md` as a key (it can still appear for compatibility, but
   must not be the row identity).

3. **Audit all `upsert` calls:** Confirm every upsert to `sleep_days` and
   `sleep_day_drafts` sends both `user_id` and `sleep_date`, and specifies
   `on_conflict=user_id,sleep_date`. The `Prefer: resolution=merge-duplicates`
   header should be present.

4. **Audit all `filter` / `eq` clauses:** Every query that fetches a specific
   row should filter on `user_id=eq.<RESTORE_CLOUD_USER_ID>` AND
   `sleep_date=eq.YYYY-MM-DD`. No query should filter on `date_md` alone.

5. **`mapSupabaseRowToDay` fallback:** Confirm the fallback chain is:
   `sleep_date` (preferred) → `date_md` (legacy parse) → error. Log a warning
   if `sleep_date` is absent but `date_md` is present (should not happen after
   Phase 2 migration).

6. **`mapDayToSupabaseRow` writes:** Confirm `user_id` is always
   `RESTORE_CLOUD_USER_ID` (not undefined, not null). Keep writing `date_md`
   as ISO for now (Phase 6 drops it).

7. **Draft lifecycle test:** In staging, run the full cycle:
   - Create a new night (upsert to `sleep_day_drafts`)
   - Partially fill fields → confirm draft persists via `getSleepDraftByDate`
   - Complete all required fields → `saveDraftAndMaybePromote` → row appears
     in `sleep_days`, draft removed
   - Edit the promoted row → upsert merges correctly

8. **Two-year boundary test:** Insert two rows with the same `M/D` but
   different years (e.g. `2025-03-15` and `2026-03-15`). Both should coexist.
   Inserting a duplicate `(user_id, sleep_date)` should fail with a PostgREST
   409/conflict error.

9. **`docs/user-data-cloud.md`:** Confirm the composite key and
   `RESTORE_CLOUD_USER_ID` pattern are documented. Update if any behavior
   changed during testing.

**Validation gate:** Full save/load/draft cycle passes in staging for a
two-year dataset. No PostgREST errors. `node math-tests.js` still passes.

---

## Phase 4 — RPC parameter rename: `p_sleep_date` / `p_user_id` (cleanup)

**Goal:** Clean up the RPC signature. Currently `promote_draft_if_complete`
still accepts `p_date_md text` (Phase 2 kept backward-compatible signature).
This phase renames to explicit typed params.

**Tasks:**
1. New SQL: replace `promote_draft_if_complete(p_date_md text, p_data jsonb)`
   with `promote_draft_if_complete(p_user_id uuid, p_sleep_date date, p_data jsonb)`.
   - Default `p_user_id` to `'00000000-0000-0000-0000-000000000001'` in SQL
     OR require the client to pass `RESTORE_CLOUD_USER_ID` — pick one and
     document it.
   - Return shape: `promoted boolean, result_sleep_date date`
     (drop `result_date_md` or keep as ISO alias).
   - Grant `EXECUTE` to `anon, authenticated`.
2. `saveDraftAndMaybePromote` in `sleep-utils.js`: POST body uses
   `p_user_id` + `p_sleep_date`; handle updated response shape.
3. Add migration file: `supabase/migrations/YYYYMMDDHHMM_phase4_rpc_rename.sql`.
4. Update `supabase/schema.sql` to new RPC signature.

**Validation:** Partial draft → complete fields → promoted correctly. Duplicate
night upserts merge without error.

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
    (future phases add files here)
```