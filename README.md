# Sleep Tracking Web App

Restore is a lightweight sleep tracking web app for logging and visualizing sleep (bed time, sleep start/end, naps, interruptions). The UI is vanilla HTML/CSS/JS with a **Vite-built SPA** at the site root.

**Run:** `npm install` then `npm run dev` and open the printed local URL (path routes such as `/dashboard`). Production: `npm run build` and deploy the `dist/` folder (see [`vercel.json`](vercel.json)).

## Cloud Sync + Direct Entry (MVP)

- Add sleep data directly in the app from the Dashboard via Quick Actions.
- Configure Supabase in `Settings` (`/settings#cloud-sync`) under **Cloud sync**.
- The top nav now shows a source badge (`☁️ Cloud` or `💾 Local`) so you can see at a glance where data is coming from.
- If Supabase is not configured (or unreachable), pages read from local `data/sleep-data.json` as fallback.
- One-time import from JSON to Supabase: create the table with `supabase/schema.sql`, then load rows with your own tool or the Supabase dashboard (no npm script in this repo).

## Git hooks (optional)

Pages load `dev-git-branch.js` (gitignored) so the UI can reflect the current branch. Regenerate it with:

```bash
node local/stamp-dev-branch.js
```

To run the repo’s hooks on **checkout** and **merge** (so the file updates automatically), point Git at the tracked `hooks/` directory once per clone:

```bash
git config core.hooksPath hooks
```

That uses `hooks/post-checkout` and `hooks/post-merge`, which invoke `local/stamp-dev-branch.js`.

## Local Supabase presets (optional)

Pages load `local-supabase-presets.js`, then `src/routes-data.mjs` (canonical nav routes, ES module + `defer`), then `/sleep-utils.js` so the dev banner can offer a **Dev** / **Prod** toggle and `renderNavBar` stays aligned with the SPA migration route table. The file is **gitignored**; copy `local/local-supabase-presets.example.js` to `local/local-supabase-presets.js` and fill in both project URLs and anon keys. If the file is absent (e.g. production deploy), the script request fails harmlessly and the toggle is hidden. See `docs/dev-banner.md`.

## Documentation

- Routing, lifecycle, and architecture: [`docs/routing.md`](docs/routing.md), [`docs/lifecycle-contract.md`](docs/lifecycle-contract.md), [`docs/architecture-decisions.md`](docs/architecture-decisions.md).
- Historical verification notes from the post-migration cleanup (phases 0–3): [`docs/spa-hard-cut-checklist.md`](docs/spa-hard-cut-checklist.md).

## npm scripts

- `npm run dev` — Vite dev server (SPA shell + path routes).
- `npm run build` — production build to `dist/` (SPA shell + route fragments + runtime scripts/assets).
- `npm run preview` — local preview of the `dist/` output.
- `npm run test:math` — deterministic math and dataset invariant checks (`tests/math-tests.js`).

## Data on disk

- `data/sleep-data.json` — local JSON fallback (`{ days: [...] }`). **Gitignored**; create it locally or copy from backup.
- `data/backup/` — optional CSV or other exports for disaster restore (e.g. periodic dumps). **Gitignored.**

The repo commits `data/.gitkeep` so the `data/` folder exists in fresh clones.

---

## Architecture & Stack

| Layer | Tech |
|--------|------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (no frameworks) |
| **Data** | Supabase REST (if configured) with `data/sleep-data.json` fallback |
| **Charts** | SVG drawn in JS (no chart library) |
| **Styling** | Single `src/styles/styles.css` with CSS variables (dark theme) |

- **Data source:** Supabase `public.sleep_days` (and related tables) when configured; otherwise `data/sleep-data.json` (object with a `days` array). Holiday calendar is in `src/lib/sleep-utils.js` as `HOLIDAYS_BY_YEAR` (year → month → list of holiday days).
- **Shared logic:** `src/lib/sleep-utils.js` holds time math, date helpers, and `renderNavBar()`. `src/lib/nightly.js` holds dashboard sections, timeline, heatmaps, and Tonight UI. Page-specific scripts: `src/routes/dashboard.js`, `src/routes/entry-modal.js`, `src/routes/quality.js`, `src/routes/charts.js`, `src/routes/stats.js`, etc.

---

## Data Model

**Canonical definitions:** [`supabase/schema.sql`](supabase/schema.sql). The local JSON file is a legacy offline fallback; treat the SQL schema as source of truth for types and column names.

### `public.sleep_days`

One logged night per user per calendar date.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `bigint` | Surrogate primary key (identity). |
| `user_id` | `uuid` | Tenant scope (MVP default single-user id in schema). |
| `sleep_date` | **`date`** | Calendar night (not a free-form string). |
| `bed`, `sleep_start`, `sleep_end` | `text` | Wall-clock times (app normalizes to 24h `HH:MM` for Supabase). |
| `bathroom`, `alarm` | `text[]` | Ordered time-of-night strings. |
| `nap_start`, `nap_end` | `text` | Nullable; nap interval split across two columns. |
| `waso` | `integer` | Wake-after-sleep-onset count; `>= 0`. |
| `labels` | `text[]` | Optional tags. |
| `created_at`, `updated_at` | `timestamptz` | Row metadata; `updated_at` maintained by trigger. |

**Uniqueness:** `unique (user_id, sleep_date)` — the natural key for sync/upsert is **UUID + date** (plus surrogate `id`). PostgREST `on_conflict=user_id,sleep_date` matches this constraint.

### Related tables (same file)

- **`sleep_day_drafts`** — In-progress row per `(user_id, sleep_date)`; optional fields until the night is complete; promoted into `sleep_days` via `promote_draft_if_complete(...)`.
- **`user_settings`** — One row per `user_id` (primary key); app preferences and Tonight guidance fields.

### In-memory / JSON shape (UI + local file)

`src/lib/sleep-utils.js` maps DB rows ↔ day objects used by routes: e.g. `sleep_date` → `date` (**ISO `YYYY-MM-DD`** after normalization), `sleep_start` → `sleepStart`, `nap_start`/`nap_end` → `nap: { start, end }`, `waso` → `WASO`. Display helpers may render month/day (e.g. `4/8`), but stored keys and Supabase both use **ISO dates** and snake_case columns as above.

Time is normalized as **minutes from midnight** (0–1440) in logic, with explicit handling for **midnight-crossing** (e.g. sleep 22:00 → 07:00) in `src/lib/sleep-utils.js` and `src/lib/nightly.js`.

---

## Pages & Responsibilities

### 1. Dashboard (`/dashboard`)
- Loads shared sleep data (Supabase when configured, local JSON fallback).
- Renders recent/lifetime averages, last few nights as timeline rows, and the **current month** of the sleep-quality calendar heatmap.
- Uses `renderDashboardContent()`, `renderCalendarHeatmapCurrentMonthOnly()` from `daily.js`; `entry-modal.js` powers **+ Night** and related quick entry.

### 2. Sleep Quality (`/quality`)
- Loads shared sleep data (Supabase when configured, local JSON fallback).
- Renders the **full** sleep quality history: all months in a calendar heatmap of "flag" days (deviations vs 7-day avg).
- Uses `renderCalendarHeatmapFullHistory()`, `buildFlagCountMap()`, `getLatestDataDate()` from `daily.js`.

### 3. Daily Timeline (`/timeline`)
- Timeline from **22:00 previous day** to **24:00 current day** (config in `daily.js`: `TIMELINE_START_MINUTES`, `TIME_TICKS`).
- Renders **weeks** (expandable), each day as a horizontal bar: bed, sleep, nap, bathroom, alarm, sick, get-up.
- Week grouping is **Monday–Sunday** (ISO-style); current/previous week start expanded.

### 4. Graphs (`/charts`)
- Loads shared sleep data; no `daily.js`, only `src/lib/sleep-utils.js`.
- **Line chart:** bed time, fell-asleep time, get-up time over days (Y = time 17:00→17:00 next day); **quadratic regression** (polynomial regression + Gaussian elimination in `graph.js`) for trend lines; toggles to show/hide series.
- **Bar charts:** sleep duration and "delay" (e.g. bed-to-sleep) per day.
- All charts are **SVG** drawn in code.

### 5. Stats (`/stats`)
- **Monthly** stats: total sleep, averages, longest uninterrupted stretch, alarm-to-wake, bed-to-sleep delay, nap stats.
- Uses `groupDaysByMonth()`, `calculateLongestUninterrupted()`, `calculateFirstAlarmToWake()`, `calculateBedToSleepDelay()`, `calculateNapDuration()` in `stats.js`.
- Renders comparison vs other months (e.g. "higher/lower than average").

---

## Important Technical Details

### Time handling
- `timeToMinutes()`, `formatTime()`, `formatDuration()` in `src/lib/sleep-utils.js`.
- Midnight crossing: duration = `sleepEnd - sleepStart` or `sleepEnd + 1440 - sleepStart`.
- Averages for "evening" times use **normalization** (`normalizeTimeForAveraging`, `normalizeTimeForComparison`) so e.g. 01:00 and 23:00 are combined correctly.

### Deviations / "flags"
- In `daily.js`: `calculateRecentAverages()` (e.g. 7-day lookback), `checkDeviations()`, `getFlagTypes()`.
- Flags when bed time, fell-asleep time, or total sleep deviates from recent average by ≥ `DEVIATION_FLAG_THRESHOLD` (20 minutes).
- Dashboard shows these and the heatmap uses them.

### Weekends & holidays
- `isWeekend()`, `isHoliday()` in `src/lib/sleep-utils.js`; holiday data is `HOLIDAYS_BY_YEAR` in the same file (`{ year: { month: [day, ...] } }`). Optional second arg to `isHoliday()`; defaults to `HOLIDAYS_BY_YEAR`.
- Used for styling (e.g. weekend background) and possibly filtering in the UI.

### UI
- Shared **nav bar** via `renderNavBar(currentPage)` (Dashboard, Quality, Daily, Graphs, Stats).
- Dark theme in `src/styles/styles.css` (e.g. `--bg`, `--panel`, `--color-sleep`, `--color-alarm`).
- Tooltips and day panels for graph hover.

---

## File Map

| Path | Role |
|------|------|
| `index.html` | SPA shell entry point |
| `src/spa-app.js` | SPA History router and route activation |
| `src/spa-fragments/` | Canonical route markup fragments |
| `data/sleep-data.json` | Local fallback dataset (`{ days: [...] }`); gitignored |
| `data/backup/` | Manual restore exports (e.g. CSV); gitignored |
| `data/.gitkeep` | Keeps `data/` in version control without committing datasets |
| `assets/` | Favicons and `icon_512.png` (nav bar icon) |
| `supabase/schema.sql` | SQL schema for the Supabase `sleep_days` table |
| `hooks/post-checkout`, `hooks/post-merge` | Run `local/stamp-dev-branch.js` after checkout/merge when `core.hooksPath` is `hooks` |
| `local/dev-git-branch.js` | Generated current git branch for UI (gitignored); copied to `/dev-git-branch.js` at runtime |
| `local/stamp-dev-branch.js` | Writes `local/dev-git-branch.js` |
| `src/lib/sleep-utils.js` | Time/date helpers, `calculateTotalSleep()`, `renderNavBar()`, Supabase helpers, `HOLIDAYS_BY_YEAR` |
| `daily.js` | Timeline rendering, week grouping, dashboard content, deviation logic, heatmap |
| `src/routes/dashboard.js` | Fetches data and calls `renderDashboardContent()` |
| `src/routes/entry-modal.js` | Dashboard **+ Night** modal and quick-add flows |
| `src/routes/quality.js` | Fetches data and calls `renderCalendarHeatmapFullHistory()` for full history |
| `src/routes/charts.js` | Fetches data, regression, SVG line/bar charts |
| `src/routes/stats.js` | Monthly aggregation and stat rendering |
| `tests/math-tests.js` | Math and dataset invariant harness (see **Math Regression Checks**) |
| `src/styles/styles.css` | Global styles and CSS variables |
| `package.json` | npm script: `test:math` |
| `docs/routing.md` | Canonical route mapping and link policy |
| `docs/lifecycle-contract.md` | Route mount/unmount lifecycle contract |
| `docs/architecture-decisions.md` | Permanent ADR summary |

---

## Math Regression Checks

Use the deterministic math harness to validate rollover/conversion logic after changes:

- Run: `npm run test:math` (or `node tests/math-tests.js`).
- Coverage includes:
  - midnight rollover (`durationMinutes`, projection wrap, modulo minutes)
  - signed vs positive-only alarm metrics
  - nap-crossing calculations
  - averaging normalization around midnight
  - remaining-wake basis conversions
  - dataset invariants against `data/sleep-data.json`

