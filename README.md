# Sleep Tracking Web App

Static, client-side web app for logging and visualizing sleep (bed time, sleep start/end, naps, interruptions). No backend or build step; it runs in the browser with HTML, CSS, and vanilla JavaScript.

---

## Architecture & Stack

| Layer | Tech |
|--------|------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (no frameworks) |
| **Data** | JSON files loaded via `fetch()` |
| **Charts** | SVG drawn in JS (no chart library) |
| **Styling** | Single `sleep.css` with CSS variables (dark theme) |

- **Data source:** `sleep-data.json` (array of daily records) and `holidays.json` (year → month → list of holiday days).
- **Shared logic:** `sleep-utils.js` holds time math, date helpers, and `renderNavBar()`. `sleep.js` holds dashboard/timeline logic and is the main "core" script. Page-specific scripts: `dashboard.js`, `graph.js`, `stats.js`.

---

## Data Model

Each day in `sleep-data.json` has:

- **`date`** – `"M/D"` (e.g. `"3/9"`).
- **`bed`**, **`sleepStart`**, **`sleepEnd`** – `"HH:MM"` (24h).
- **`bathroom`**, **`alarm`**, **`sick`** – arrays of time strings (interruptions/events).
- **`nap`** – `null` or `{ start, end }` in `"HH:MM"`.

Time is normalized as **minutes from midnight** (0–1440) everywhere, with explicit handling for **midnight-crossing** (e.g. sleep 22:00 → 07:00) in `sleep-utils.js` and `sleep.js`.

---

## Pages & Responsibilities

### 1. Dashboard (`dashboard.html` + `dashboard.js` + `sleep.js`)
- Loads `sleep-data.json` and `holidays.json`.
- Renders recent/lifetime averages, last few nights as timeline rows, sleep-quality history, and a **calendar heatmap** of "flag" days (deviations).
- Uses `renderDashboardContent()`, `renderWeek()`, `renderDay()`, `renderCalendarHeatmap()` from `sleep.js`.

### 2. Daily Timeline (`sleep.html` + `sleep.js`)
- Timeline from **22:00 previous day** to **24:00 current day** (config in `sleep.js`: `TIMELINE_START_MINUTES`, `TIME_TICKS`).
- Renders **weeks** (expandable), each day as a horizontal bar: bed, sleep, nap, bathroom, alarm, sick, get-up.
- Week grouping is **Monday–Sunday** (ISO-style); current/previous week start expanded.

### 3. Graphs (`graph.html` + `graph.js`)
- Loads same JSON; no `sleep.js`, only `sleep-utils.js`.
- **Line chart:** bed time, fell-asleep time, get-up time over days (Y = time 17:00→17:00 next day); **quadratic regression** (polynomial regression + Gaussian elimination in `graph.js`) for trend lines; toggles to show/hide series.
- **Bar charts:** sleep duration and "delay" (e.g. bed-to-sleep) per day.
- All charts are **SVG** drawn in code.

### 4. Stats (`stats.html` + `stats.js`)
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
- In `sleep.js`: `calculateRecentAverages()` (e.g. 7-day lookback), `checkDeviations()`, `getFlagTypes()`.
- Flags when bed time, fell-asleep time, or total sleep deviates from recent average by ≥ `DEVIATION_FLAG_THRESHOLD` (20 minutes).
- Dashboard shows these and the heatmap uses them.

### Weekends & holidays
- `isWeekend()`, `isHoliday()` in `sleep-utils.js`; `holidays` structure is `{ year: { month: [day, ...] } }`.
- Used for styling (e.g. weekend background) and possibly filtering in the UI.

### UI
- Shared **nav bar** via `renderNavBar(currentPage)` (Dashboard, Daily Timeline, Graphs, Stats).
- Dark theme in `sleep.css` (e.g. `--bg`, `--panel`, `--color-sleep`, `--color-alarm`).
- Tooltips and day panels for graph hover.

---

## File Map

| File | Role |
|------|------|
| `sleep-data.json` | Source of truth for daily sleep records |
| `holidays.json` | Holiday calendar by year/month/day |
| `sleep-utils.js` | Time/date helpers, `calculateTotalSleep()`, `renderNavBar()` |
| `sleep.js` | Timeline rendering, week grouping, dashboard content, deviation logic, heatmap |
| `dashboard.js` | Fetches data and calls `renderDashboardContent()` |
| `graph.js` | Fetches data, regression, SVG line/bar charts |
| `stats.js` | Monthly aggregation and stat rendering |
| `sleep.css` | Global styles and CSS variables |

---

## Summary

The project is a **static, data-in-JSON sleep tracker**: one shared data model and time/date utilities, four pages (dashboard, timeline, graphs, stats), and custom SVG visualizations with in-code regression for trends. No server, no database, and no npm/build step—suitable for opening the HTML (or a simple static server) and editing `sleep-data.json` to add or change days.
