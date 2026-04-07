# Sleep Tracking Web App

Restore is a lightweight sleep tracking web app for logging and visualizing sleep (bed time, sleep start/end, naps, interruptions). The UI is still static vanilla HTML/CSS/JS, and data is now intended to live in Supabase (with local JSON fallback).

**Run:** Open `index.html` or `dashboard.html` in a browser (or use a local static server if you hit CORS with `fetch()`).

## Cloud Sync + Direct Entry (MVP)

- Add nights directly in the app from the Dashboard via the `+ Night` button.
- Configure Supabase in `Settings` (`config.html`) under **Cloud sync**.
- The top nav now shows a source badge (`☁️ Cloud` or `💾 Local`) so you can see at a glance where data is coming from.
- If Supabase is not configured (or unreachable), pages read from local `data/sleep-data.json` as fallback.
- One-time import from JSON to Supabase: create the table with `supabase/schema.sql`, then load rows with your own tool or the Supabase dashboard (no npm script in this repo).

## Git hooks (optional)

Pages load `dev-git-branch.js` (gitignored) so the UI can reflect the current branch. Regenerate it with:

```bash
node scripts/stamp-dev-branch.js
```

To run the repo’s hooks on **checkout** and **merge** (so the file updates automatically), point Git at the tracked `hooks/` directory once per clone:

```bash
git config core.hooksPath hooks
```

That uses `hooks/post-checkout` and `hooks/post-merge`, which invoke `scripts/stamp-dev-branch.js`.

## npm scripts

- `npm run test:math` — deterministic math and dataset invariant checks (`math-tests.js`).

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
| **Styling** | Single `styles.css` with CSS variables (dark theme) |

- **Data source:** Supabase table `sleep_days` when configured; otherwise `data/sleep-data.json` (object with a `days` array of daily records). Holiday calendar is in `sleep-utils.js` as `HOLIDAYS_BY_YEAR` (year → month → list of holiday days).
- **Shared logic:** `sleep-utils.js` holds time math, date helpers, and `renderNavBar()`. `daily.js` holds dashboard/timeline/heatmap logic and is the main "core" script. Page-specific scripts: `dashboard.js`, `entry-modal.js` (dashboard night entry), `quality.js`, `graph.js`, `stats.js`.

---

## Data Model

Each day record (in Supabase `sleep_days` or local JSON `days`) has:

- **`date`** – `"M/D"` (e.g. `"3/9"`).
- **`bed`**, **`sleepStart`**, **`sleepEnd`** – `"HH:MM"` (24h).
- **`bathroom`**, **`alarm`** – arrays of time strings.
- **`nap`** – `null` or `{ start, end }` in `"HH:MM"`.
- **`WASO`** – integer wake-after-sleep-onset count.

Time is normalized as **minutes from midnight** (0–1440) everywhere, with explicit handling for **midnight-crossing** (e.g. sleep 22:00 → 07:00) in `sleep-utils.js` and `daily.js`.

---

## Pages & Responsibilities

### 1. Dashboard (`dashboard.html` + `dashboard.js` + `entry-modal.js` + `daily.js`)
- Loads shared sleep data (Supabase when configured, local JSON fallback).
- Renders recent/lifetime averages, last few nights as timeline rows, and the **current month** of the sleep-quality calendar heatmap.
- Uses `renderDashboardContent()`, `renderCalendarHeatmapCurrentMonthOnly()` from `daily.js`; `entry-modal.js` powers **+ Night** and related quick entry.

### 2. Sleep Quality (`quality.html` + `quality.js` + `daily.js`)
- Loads shared sleep data (Supabase when configured, local JSON fallback).
- Renders the **full** sleep quality history: all months in a calendar heatmap of "flag" days (deviations vs 7-day avg).
- Uses `renderCalendarHeatmapFullHistory()`, `buildFlagCountMap()`, `getLatestDataDate()` from `daily.js`.

### 3. Daily Timeline (`daily.html` + `daily.js`)
- Timeline from **22:00 previous day** to **24:00 current day** (config in `daily.js`: `TIMELINE_START_MINUTES`, `TIME_TICKS`).
- Renders **weeks** (expandable), each day as a horizontal bar: bed, sleep, nap, bathroom, alarm, sick, get-up.
- Week grouping is **Monday–Sunday** (ISO-style); current/previous week start expanded.

### 4. Graphs (`graph.html` + `graph.js`)
- Loads shared sleep data; no `daily.js`, only `sleep-utils.js`.
- **Line chart:** bed time, fell-asleep time, get-up time over days (Y = time 17:00→17:00 next day); **quadratic regression** (polynomial regression + Gaussian elimination in `graph.js`) for trend lines; toggles to show/hide series.
- **Bar charts:** sleep duration and "delay" (e.g. bed-to-sleep) per day.
- All charts are **SVG** drawn in code.

### 5. Stats (`stats.html` + `stats.js`)
- **Monthly** stats: total sleep, averages, longest uninterrupted stretch, alarm-to-wake, bed-to-sleep delay, nap stats.
- Uses `groupDaysByMonth()`, `calculateLongestUninterrupted()`, `calculateFirstAlarmToWake()`, `calculateBedToSleepDelay()`, `calculateNapDuration()` in `stats.js`.
- Renders comparison vs other months (e.g. "higher/lower than average").

---

## Important Technical Details

### Time handling
- `timeToMinutes()`, `formatTime()`, `formatDuration()` in `sleep-utils.js`.
- Midnight crossing: duration = `sleepEnd - sleepStart` or `sleepEnd + 1440 - sleepStart`.
- Averages for "evening" times use **normalization** (`normalizeTimeForAveraging`, `normalizeTimeForComparison`) so e.g. 01:00 and 23:00 are combined correctly.

### Deviations / "flags"
- In `daily.js`: `calculateRecentAverages()` (e.g. 7-day lookback), `checkDeviations()`, `getFlagTypes()`.
- Flags when bed time, fell-asleep time, or total sleep deviates from recent average by ≥ `DEVIATION_FLAG_THRESHOLD` (20 minutes).
- Dashboard shows these and the heatmap uses them.

### Weekends & holidays
- `isWeekend()`, `isHoliday()` in `sleep-utils.js`; holiday data is `HOLIDAYS_BY_YEAR` in the same file (`{ year: { month: [day, ...] } }`). Optional second arg to `isHoliday()`; defaults to `HOLIDAYS_BY_YEAR`.
- Used for styling (e.g. weekend background) and possibly filtering in the UI.

### UI
- Shared **nav bar** via `renderNavBar(currentPage)` (Dashboard, Quality, Daily, Graphs, Stats).
- Dark theme in `styles.css` (e.g. `--bg`, `--panel`, `--color-sleep`, `--color-alarm`).
- Tooltips and day panels for graph hover.

---

## File Map

| Path | Role |
|------|------|
| `index.html` | Redirects to `dashboard.html` (entry point) |
| `dashboard.html`, `quality.html`, `daily.html`, `graph.html`, `stats.html` | Main app pages (see **Pages & Responsibilities**) |
| `config.html` | Settings (themes, Supabase cloud sync) |
| `about.html` | About / project meta |
| `data/sleep-data.json` | Local fallback dataset (`{ days: [...] }`); gitignored |
| `data/backup/` | Manual restore exports (e.g. CSV); gitignored |
| `data/.gitkeep` | Keeps `data/` in version control without committing datasets |
| `assets/` | Favicons and `icon_512.png` (nav bar icon) |
| `supabase/schema.sql` | SQL schema for the Supabase `sleep_days` table |
| `hooks/post-checkout`, `hooks/post-merge` | Run `scripts/stamp-dev-branch.js` after checkout/merge when `core.hooksPath` is `hooks` |
| `dev-git-branch.js` | Generated current git branch for UI (gitignored); see **Git hooks** |
| `scripts/stamp-dev-branch.js` | Writes `dev-git-branch.js` |
| `sleep-utils.js` | Time/date helpers, `calculateTotalSleep()`, `renderNavBar()`, Supabase helpers, `HOLIDAYS_BY_YEAR` |
| `daily.js` | Timeline rendering, week grouping, dashboard content, deviation logic, heatmap |
| `dashboard.js` | Fetches data and calls `renderDashboardContent()` |
| `entry-modal.js` | Dashboard **+ Night** modal and quick-add flows |
| `quality.js` | Fetches data and calls `renderCalendarHeatmapFullHistory()` for full history |
| `graph.js` | Fetches data, regression, SVG line/bar charts |
| `stats.js` | Monthly aggregation and stat rendering |
| `math-tests.js` | Math and dataset invariant harness (see **Math Regression Checks**) |
| `styles.css` | Global styles and CSS variables |
| `package.json` | npm script: `test:math` |

---

## Math Regression Checks

Use the deterministic math harness to validate rollover/conversion logic after changes:

- Run: `npm run test:math` (or `node math-tests.js`).
- Coverage includes:
  - midnight rollover (`durationMinutes`, projection wrap, modulo minutes)
  - signed vs positive-only alarm metrics
  - nap-crossing calculations
  - averaging normalization around midnight
  - remaining-wake basis conversions
  - dataset invariants against `data/sleep-data.json`

