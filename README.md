# Sleep Tracking Web App

Restore is a lightweight sleep tracking web app for logging and visualizing sleep (bed time, sleep start/end, naps, interruptions). The UI is vanilla HTML/CSS/JS with a **Vite-built SPA** at the site root.

**Run:** `npm install` then `npm run dev` and open the printed local URL (path routes such as `/dashboard`). Production: `npm run build` and deploy the `dist/` folder (see [`vercel.json`](vercel.json)).

## Cloud Sync + Direct Entry (MVP)

- Add sleep data directly in the app from the Dashboard via Quick Actions.
- Configure Supabase in `Settings` (`/settings#cloud-sync`) under **Cloud sync**.
- The top nav shows a source badge (`☁️ Cloud` or `💾 Local`) so you can see at a glance where data is coming from.
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

`index.html` loads `/local-supabase-presets.js` before `/sleep-utils.js` so the dev banner can offer a **Dev** / **Prod** toggle. `renderNavBar` reads the route table from `src/routes-data.mjs`, which `src/spa-app.js` imports. The file is **gitignored**; copy `local/local-supabase-presets.example.js` to `local/local-supabase-presets.js` and fill in both project URLs and anon keys. If the file is absent (e.g. production deploy), the script request fails harmlessly and the toggle is hidden. See `docs/dev-banner.md`.

## Local GitHub token for prod → dev sync (optional)

The dev banner's **📥** button runs the *Sync Supabase dev from prod* GitHub Action (`docs/supabase-dev-sync.md`). Copy `local/local-github-dispatch.example.js` to `local/local-github-dispatch.js` (gitignored), paste a fine-grained token scoped to this repo with **Actions: Read and write**, and restart `npm run dev`. Without the file the button stays disabled.

## Documentation

Specs live in `docs/`. [`AGENTS.md`](AGENTS.md) says which doc to update when you change a given file or function.

| Doc | Covers |
|-----|--------|
| [`docs/architecture-decisions.md`](docs/architecture-decisions.md) | ADR summary for the SPA architecture |
| [`docs/routing.md`](docs/routing.md) | Route table, link helpers, link policy |
| [`docs/lifecycle-contract.md`](docs/lifecycle-contract.md) | Route `mount` / `unmount` contract |
| [`docs/math.md`](docs/math.md) | All formulas: clock axis, averages and weights, blended %, flag severity, Recent stats, guidance pace |
| [`docs/recent-average.md`](docs/recent-average.md) | "Your recent average": learning stages, per-night baselines |
| [`docs/wake-and-lags.md`](docs/wake-and-lags.md) | Natural vs alarm wake, sleep lag, wake lag (snooze), social lag |
| [`docs/wake-day-key.md`](docs/wake-day-key.md) | Which date a night is saved under; open night |
| [`docs/quick-actions.md`](docs/quick-actions.md) | Dashboard quick actions: phase, button eligibility, save rows |
| [`docs/remaining-wake.md`](docs/remaining-wake.md) | Nav remaining-time chip, display phases, phase colors, backlog |
| [`docs/user-data-cloud.md`](docs/user-data-cloud.md) | Sleep vs preference storage, `user_settings` sync, RLS |
| [`docs/supabase-dev-sync.md`](docs/supabase-dev-sync.md) | Daily prod → dev Supabase sync (09:17 JST) and migration order |
| [`docs/dev-banner.md`](docs/dev-banner.md) | Dev banner, simulated app time, local presets |
| [`docs/semantic-keyword-palette.md`](docs/semantic-keyword-palette.md) | SKP: bed / sleep / wake / nap color tokens |
| [`docs/restore-copy-voice.md`](docs/restore-copy-voice.md) | Voice and tone for user-facing copy |
| [`docs/localization.md`](docs/localization.md) | i18n implementation and known gaps |

## npm scripts

- `npm run dev` — Vite dev server (SPA shell + path routes).
- `npm run build` — production build to `dist/` (SPA shell + route fragments + runtime scripts/assets).
- `npm run preview` — local preview of the `dist/` output.
- `npm run test:math` — deterministic math and dataset invariant checks (`tests/math-tests.js`).
- `npm run test:qa` — quick-action render / save scenarios (`tests/quick-actions-scenarios.mjs`).

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
| **Styling** | `src/styles/styles.css` with CSS variables (light and dark themes) |

- **Data source:** Supabase `public.sleep_days` (and related tables) when configured; otherwise `data/sleep-data.json` (object with a `days` array). Holiday calendar is in `src/lib/sleep-utils.js` as `HOLIDAYS_BY_YEAR` (year → month → list of holiday days).
- **Shared logic:** `src/lib/sleep-utils.js` holds time math, date helpers, and `renderNavBar()`. `src/lib/nightly.js` holds dashboard sections, timeline, heatmaps, and Tonight UI. Page-specific scripts: `src/routes/dashboard.js`, `src/routes/entry-modal.js`, `src/routes/quality.js`, `src/routes/charts.js`, `src/routes/stats.js`, etc.

---

## Data Model

**Canonical definitions:** [`supabase/schema.sql`](supabase/schema.sql). The local JSON file is a legacy offline fallback; treat the SQL schema as source of truth for types and column names.

### `public.sleep_days`

One logged night per user per wake date.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `bigint` | Surrogate primary key (identity). |
| `user_id` | `uuid` | Tenant scope (MVP default single-user id in schema). |
| `sleep_date` | **`date`** | **Wake date** — the morning the night ends. A night from 23:00 Nov 18 to 07:00 Nov 19 is `2026-11-19`; a night that starts after midnight (02:00 Nov 19 → 11:00 Nov 19) is also `2026-11-19`. See [docs/wake-day-key.md](docs/wake-day-key.md). |
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

Nav tabs: **Dashboard**, **Log**, **Quality**, **Timeline**, **Charts**, **Stats**. **About** and **Settings** are in the menu. Route table: [docs/routing.md](docs/routing.md).

### 1. Dashboard (`/dashboard`)
- **Quick actions** (Get in bed, Go to sleep, Wake up, naps, alarms), **Tonight** (Natural / Guided / Pace / Target matrix), **Recent stats** (last 7 days vs the 7 before), the current month of the **Sleep quality** calendar, recent nights as timeline rows, and 7-day charts with "usual" lines.
- `src/routes/dashboard.js` calls `renderDashboardContent()` in `nightly.js`; `quick-actions.js` runs the buttons ([docs/quick-actions.md](docs/quick-actions.md)); `entry-modal.js` powers **+ Night**.

### 2. Log (`/log`)
- Add or edit one night: bed, sleep, wake, bathroom, alarms, nap, WASO, and emoji notes. Form and quick-add flows live in `src/routes/entry-modal.js`; `src/routes/log.js` mounts the page.

### 3. Quality (`/quality`)
- Full history calendar heatmap of flag days (deviations vs each night's recent baseline).
- Uses `renderCalendarHeatmapFullHistory()`, `buildFlagCountMap()`, `getLatestDataDate()` from `nightly.js`.

### 4. Timeline (`/timeline`)
- Each night as a horizontal bar from **21:00** to **21:00** the next day (`TIMELINE_START_MINUTES`, `TIME_TICKS` in `nightly.js`): bed, sleep, nap, bathroom, alarm, wake.
- Grouped into expandable **Monday–Sunday** weeks with equal-weight week summaries.

### 5. Charts (`/charts`)
- **Bed, asleep, and wake times** over days, with polynomial trend lines (up to quadratic, `polynomialRegression()` in `src/routes/charts.js`) and toggles per series.
- **Sleep duration**, **wake lag** (first alarm → get up) and **sleep lag** (bed → asleep) per night.
- All charts are SVG drawn in code; the page loads `charts.js` only (no `nightly.js`).

### 6. Stats (`/stats`)
- A matrix for a chosen period (past 7 / 30 / 90 days or this year), with **All**, **Work** and **Free** day columns.
- Sections: **Sleep** (duration, naps, longest / shortest night, uninterrupted, bed and sleep times, sleep lag, mid-sleep, social lag), **Wake** (wake time, natural wake %, wake lag), and **Ultimates** (earliest and latest times).
- `src/routes/stats.js` with helpers in `src/lib/stats-aggregates.js`; wake and lag rules in [docs/wake-and-lags.md](docs/wake-and-lags.md).

### 7. About (`/about`) and Settings (`/settings`)
- **About** explains the model: quick actions, Tonight guidance and learning stages, remaining time, flags, night notes, stats.
- **Settings**: language, clock format, theme, phase colors, palette, Tonight guidance, remaining-time thresholds, in-app tips, and **Cloud sync** (`/settings#cloud-sync`).

---

## Important Technical Details

### Time handling
- `timeToMinutes()`, `formatTime()`, `formatDuration()` in `src/lib/time-utils.js`.
- Midnight crossing: duration = `sleepEnd - sleepStart` or `sleepEnd + 1440 - sleepStart`.
- Averages for "evening" times use **normalization** (`normalizeTimeForAveraging`, `normalizeTimeForComparison`) so e.g. 01:00 and 23:00 are combined correctly.

### Deviations / "flags"
- In `src/lib/nightly.js`: `getDeviationBaseline()`, `analyzeTimingDeviations()`, `checkDeviations()`, `getFlagTypes()`, `buildFlagCountMap()`.
- Each night is compared with its **baseline**: the recent average of the logged entries *before* it (up to 14, weighted toward the newest; the night itself excluded). See [docs/recent-average.md](docs/recent-average.md).
- 😴 fell asleep later than baseline · ⌛ shorter than baseline or under 6 / 5 / 4 h · 🌅 wake shifted either way · 👁️ wakeful night (WASO, baseline-independent). Severity tiers come from a blended sleep- / day-relative percentage.
- Fewer than 7 earlier nights → 🌱 learning (no flags). Dashboard, Nightly, and the Quality heatmap all use these.
- Formulas, thresholds, and the dashboard **Recent stats** comparison (this week vs the week before): [docs/math.md](docs/math.md).

### Weekends & holidays
- `isWeekend()`, `isHoliday()` in `src/lib/sleep-utils.js`; holiday data is `HOLIDAYS_BY_YEAR` in the same file (`{ year: { month: [day, ...] } }`). Optional second arg to `isHoliday()`; defaults to `HOLIDAYS_BY_YEAR`.
- Used for styling (e.g. weekend background) and possibly filtering in the UI.

### UI
- Shared **nav bar** via `renderNavBar(currentPage)`: the tabs above, the remaining-time chip ([docs/remaining-wake.md](docs/remaining-wake.md)), and the menu.
- Light and dark themes in `src/styles/styles.css` (e.g. `--bg`, `--panel`, `--color-sleep`, `--color-alarm`); sleep-domain colors follow the SKP ([docs/semantic-keyword-palette.md](docs/semantic-keyword-palette.md)).
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
| `public/assets/` | Favicons and `icon_512.png` (nav bar icon) |
| `supabase/schema.sql` | SQL schema: `sleep_days`, `sleep_day_drafts`, `user_settings`, `promote_draft_if_complete`, RLS |
| `hooks/post-checkout`, `hooks/post-merge` | Run `local/stamp-dev-branch.js` after checkout/merge when `core.hooksPath` is `hooks` |
| `local/dev-git-branch.js` | Generated current git branch for UI (gitignored); copied to `/dev-git-branch.js` at runtime |
| `local/stamp-dev-branch.js` | Writes `local/dev-git-branch.js` |
| `src/lib/sleep-utils.js` | Time/date helpers, `calculateTotalSleep()`, `renderNavBar()`, Supabase helpers, `HOLIDAYS_BY_YEAR` |
| `src/lib/nightly.js` | Timeline rendering, week grouping, dashboard content, deviation logic, heatmap |
| `src/lib/time-utils.js` | Clock math: `durationMinutes()`, averaging normalization |
| `src/lib/i18n.js` | `t()`, locale loading, `data-i18n` application |
| `src/lib/stats-aggregates.js` | Work / free day split, social lag |
| `src/routes-data.mjs` | Route metadata and semantic link helpers |
| `src/routes/dashboard.js` | Fetches data and calls `renderDashboardContent()` |
| `src/routes/quick-actions.js` | Dashboard quick actions |
| `src/routes/entry-modal.js` | **+ Night** modal, Log form, and quick-add flows |
| `src/routes/log.js` | Log page lifecycle |
| `src/routes/quality.js` | Fetches data and calls `renderCalendarHeatmapFullHistory()` for full history |
| `src/routes/charts.js` | Fetches data, regression, SVG line/bar charts |
| `src/routes/stats.js` | Period stats matrix |
| `src/routes/about.js`, `src/routes/settings.js` | About and Settings lifecycles |
| `locales.json` | English and Japanese strings |
| `tests/math-tests.js` | Math and dataset invariant harness (see **Math Regression Checks**) |
| `tests/quick-actions-scenarios.mjs` | Quick-action scenarios (`npm run test:qa`) |
| `src/styles/styles.css` | Global styles and CSS variables |
| `supabase/migrations/` | Migrations to apply to dev and prod ([docs/supabase-dev-sync.md](docs/supabase-dev-sync.md)) |
| `.github/workflows/sync-supabase-dev-from-prod-v2.yml` | Daily prod → dev database sync |
| `package.json` | npm scripts (see above) |

---

## Math Regression Checks

Use the deterministic math harness to validate rollover/conversion logic after changes:

- Run: `npm run test:math` (or `node tests/math-tests.js`).
- Coverage includes:
  - midnight rollover (`durationMinutes`, projection wrap, modulo minutes)
  - sleep totals, naps, sleep lag, uninterrupted sleep
  - wake classification and wake lag (anchored to sleep start)
  - averaging normalization around midnight, recent-average weights and catch-up
  - deviation baselines, flags, and Recent stats
  - remaining-wake basis, overnight limbo, Tonight guidance and matrix phases
  - night key cutover and open night
  - Stats column extras and social lag
  - dataset invariants against `data/sleep-data.json`
- Quick-action rendering and save rows: `npm run test:qa`.

