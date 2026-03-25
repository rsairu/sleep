# Sleep Tracking Web App

Restore is a lightweight sleep tracking web app for logging and visualizing sleep (bed time, sleep start/end, naps, interruptions). The UI is still static vanilla HTML/CSS/JS, and data is now intended to live in Supabase (with local JSON fallback).

**Run:** Open `index.html` or `dashboard.html` in a browser (or use a local static server if you hit CORS with `fetch()`).

## Cloud Sync + Direct Entry (MVP)

- Add nights directly in the app from the Dashboard via the `+ Night` button.
- Configure Supabase in `Settings` (`config.html`) under **Cloud sync**.
- The top nav now shows a source badge (`☁️ Cloud` or `💾 Local`) so you can see at a glance where data is coming from.
- If Supabase is not configured (or unreachable), pages read from local `sleep-data.json` as fallback.
- One-time import from JSON to Supabase:
  - Create table with `supabase-schema.sql`
  - Run `npm run migrate-supabase` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars set.

---

## Architecture & Stack

| Layer | Tech |
|--------|------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (no frameworks) |
| **Data** | Supabase REST (if configured) with `sleep-data.json` fallback |
| **Charts** | SVG drawn in JS (no chart library) |
| **Styling** | Single `styles.css` with CSS variables (dark theme) |

- **Data source:** Supabase table `sleep_days` when configured; otherwise `sleep-data.json` (object with a `days` array of daily records). Holiday calendar is in `sleep-utils.js` as `HOLIDAYS_BY_YEAR` (year → month → list of holiday days).
- **Shared logic:** `sleep-utils.js` holds time math, date helpers, and `renderNavBar()`. `daily.js` holds dashboard/timeline/heatmap logic and is the main "core" script. Page-specific scripts: `dashboard.js`, `quality.js`, `graph.js`, `stats.js`.

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

### 1. Dashboard (`dashboard.html` + `dashboard.js` + `daily.js`)
- Loads shared sleep data (Supabase when configured, local JSON fallback).
- Renders recent/lifetime averages, last few nights as timeline rows, and the **current month** of the sleep-quality calendar heatmap.
- Uses `renderDashboardContent()`, `renderCalendarHeatmapCurrentMonthOnly()` from `daily.js`.

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

| File | Role |
|------|------|
| `index.html` | Redirects to `dashboard.html` (entry point) |
| `sleep-data.json` | Local fallback dataset (`{ days: [...] }`) and migration source |
| `supabase-schema.sql` | SQL schema for the Supabase `sleep_days` table |
| `sleep-utils.js` | Time/date helpers, `calculateTotalSleep()`, `renderNavBar()`, `HOLIDAYS_BY_YEAR` |
| `daily.js` | Timeline rendering, week grouping, dashboard content, deviation logic, heatmap |
| `dashboard.js` | Fetches data and calls `renderDashboardContent()` |
| `quality.js` | Fetches data and calls `renderCalendarHeatmapFullHistory()` for full history |
| `graph.js` | Fetches data, regression, SVG line/bar charts |
| `stats.js` | Monthly aggregation and stat rendering |
| `scripts/migrate-json-to-supabase.js` | One-time import tool from local JSON to Supabase |
| `styles.css` | Global styles and CSS variables |

---

## Math Regression Checks

Use the deterministic math harness to validate rollover/conversion logic after changes:

- Run: `node math-tests.js`
- Coverage includes:
  - midnight rollover (`durationMinutes`, projection wrap, modulo minutes)
  - signed vs positive-only alarm metrics
  - nap-crossing calculations
  - averaging normalization around midnight
  - remaining-wake basis conversions
  - dataset invariants against `sleep-data.json`

