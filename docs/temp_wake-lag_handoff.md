# Handoff — Wake classification, lags, and Stats layout

**Branch:** `alarm` · **Status:** decisions locked, ready to implement · **Date:** 2026-11-20

## Why

11/20 was a natural wake (09:33, alarm 09:42) but the chart showed it as an alarm wake. Root cause: three surfaces each had their own "natural wake" rule.

| Surface | Old rule | 11/20 |
|---|---|---|
| Nightly (`nightly.js`) | no alarm, or wake < earliest alarm | natural |
| Stats (`isNaturalWakeDay`) | no alarm, or exactly one alarm and wake < it | natural |
| Charts (`isNoAlarmWakeDay`) | no alarm logged | alarm |

Production impact: 19 nights show as alarm wakes on Charts that are natural everywhere else (134 natural vs 115 on chart). Stats and Nightly agree on all 323 rows. Separately, alarm-to-wake math has no consistent midnight handling (`calculateWakeDelay` guesses "alarm ≥ 18:00 = previous evening"; the natural-wake check has no wrap handling at all), and the chart tooltip uses `alarm[0]` while the delay uses the earliest alarm.

## Locked decisions

1. **Natural wake** = no alarm, or woke **strictly before** the earliest alarm. 1–2 min early counts. Exactly at the alarm = alarm wake. No separate "woke before alarm" chart marker.
2. **All alarm math is anchored to sleep start**: `offset(t) = (t − sleepStart + 1440) % 1440`. No clock-hour heuristics.
3. **Wake lag (snooze)** = signed `offset(wake) − offset(earliest alarm)` over **every night with an alarm**. Negative when you woke before it (those nights are also natural). Nights with no alarm are excluded. Σ is a net total.
4. **Sleep lag** = bed → asleep (unchanged math).
5. **Social lag** stays MCTQ mid-sleep `|MSF − MSW|` (existing `socialLagMinutes`). Tooltip says so.
6. **"Lag" everywhere** replaces "delay" in UI and JS identifiers. CSS class names and element ids stay (avoid churn, keep anchors).
7. **Legacy wake lag** (natural-avg wake − alarm-avg wake) is removed.
8. **Alarms are stored sorted** by sleep-start offset; classifier still takes the minimum (doesn't trust order).
9. **Nap color** moves to pink-lavender, clear of alarm/warning.
10. **Sleep lag keyword color = bed** (matches SKP "SOL → `--color-bed`", the SOL chart, and Nightly's 🛌 suffix). Wake lag = `--color-up`.

---

## 1. Primitives (`src/lib/sleep-utils.js`)

Add, near the current alarm helpers (~L1715):

```js
/** Minutes after sleep start, 0..1439. NaN if either time is missing. */
function minutesFromSleepStart(clockMinutes, sleepStartMinutes)

/** Copy of alarm strings, stable-sorted by sleep-start offset; clock order if sleepStart missing. */
function sortAlarmsForNight(alarms, sleepStart)

/**
 * Single source of truth for wake type and alarm→wake.
 * @returns {{ natural: boolean, firstAlarm: string|null, wakeLagMin: number|null }}
 *  - no alarms → { natural: true, firstAlarm: null, wakeLagMin: null }
 *  - else first = alarm with smallest sleep-start offset;
 *    wakeLagMin = offset(wake) − offset(first)   (signed)
 *    natural = wakeLagMin < 0
 *  - sleepStart missing (fixtures only; prod sleep_start is NOT NULL):
 *    first = min clock alarm; wakeLagMin = shortest signed clock delta in [−720, 720)
 */
function classifyWake(day)

/** Bed → asleep, minutes (current calculateSleepDelay math). */
function sleepLagMin(day)

/** classifyWake(day).wakeLagMin — signed, null when no alarm. */
function wakeLagMin(day)
```

**Delete** (update every caller listed in §2 first):
`isNaturalWakeDay`, `isNoAlarmWakeDay`, `calculateWakeDelay`, `calculateAlarmToWakeDelta`, `calculateFirstAlarmToWake`, `calculateBedToSleepDelay`, `calculateSleepDelay` (→ `sleepLagMin`), `getFirstAlarmMinutes` (if no other caller remains).

**`averageSleepNights`** (~L3631): rename fields
- `avgBedToSleepDelay` → `avgSleepLag` (via `sleepLagMin`)
- `avgFirstAlarmToWake` → `avgWakeLag` (via `wakeLagMin`; alarm nights only, signed — same semantics as today)
Update the JSDoc return shape.

Known edge (not in data): an alarm logged before sleep start is treated as next-day (large offset). Leave as is; cover with a test so the behavior is explicit.

`calculateLongestUninterrupted` (~L1680) has its own alarm normalization — **out of scope**, don't touch.

## 2. Callers

| File | Line(s) today | Change |
|---|---|---|
| `src/routes/charts.js` | 2040–2044 | `sleepLagMinutes: sleepLagMin(day)`, `wakeLagMinutes: wakeLagMin(day)`, `firstAlarm: classifyWake(day).firstAlarm`, `naturalWake: classifyWake(day).natural` (call `classifyWake` once per day). Rename `wakeDelayMinutes`/`sleepDelayMinutes` uses (~1418, 1570, 1650, 1671, 1675). |
| `src/routes/charts.js` | 1534, 1562 | Y-axis title `Delay` → `Lag` |
| `src/routes/charts.js` | 1397, 1408 | error strings "wake delay" → "wake lag" |
| `src/spa-fragments/charts.html` | 8–9, 126–131, 140 | Headings/TOC: "Wake lag (first alarm to get up)", "Sleep lag (bed to asleep)". aria-labels "Wake delay…" → "Wake lag…". **Keep ids** `chart-wake-delay`, `chart-sol`, `delay-chart-*`. |
| `src/spa-fragments/charts.html` | 100–104 | Legend `(no alarm)` → `(natural)`; aria-label "No-alarm wake markers" → "Natural wake markers" |
| `src/lib/nightly.js` | 474–512 | Badge uses `classifyWake(day)`; keep the 🌄 / "(⏰−9m)" / ⏰ +delay rendering. Variable `firstAlarmToWake` → `wakeLag`. |
| `src/lib/nightly.js` | 515, 595, 600, 1349 | `sleepLagMin`, `avgSleepLag`, label "Wake lag (avg):", `avgWakeLag`, default `avgWakeLag: null` |
| `src/routes/quick-actions.js` | 28, 588 | `avgFirstAlarmToWake` → `avgWakeLag` (gate semantics unchanged: non-null when any alarm night in window) |
| `src/routes/stats.js` | 15–116 (`calculateMonthlyAverages`) | Use `sleepLagMin` / `wakeLagMin`; fields `avgSleepLag`, `avgWakeLag` |
| `src/routes/stats.js` | 156–181 (`columnExtras`) | Natural count via `classifyWake(d).natural`; add `sumSleepLag` (all nights) and `sumWakeLag` (alarm nights, signed; `null` if none) |
| `src/lib/stats-aggregates.js` | 114–139 | Delete `wakeLagMinutes` + export; header comment deps → `classifyWake` |

Grep after: zero hits for `Delay`/`delay` in JS identifiers tied to these metrics, `isNaturalWakeDay`, `isNoAlarmWakeDay`, `FirstAlarmToWake`.

## 3. Write path — sort on save

`mapDayToSupabaseRow` (~L382): `alarm = sortAlarmsForNight(day.alarm, day.sleepStart).map(normalizeTimeStringForSupabase)`.
`mapPartialDayToDraftPatch` (~L412): same, using `partial.sleepStart` when present (falls back to clock order).

## 4. Stats page (`src/routes/stats.js` `renderStatsMatrix`)

Replace the Sleep Duration / Uninterrupted / Natural Wake / Timing / Delays / Lags sections with two sections. **Ultimates unchanged.**

- `section()` accepts HTML so the header can carry a keyword span.
- `metricRow(labelHtml, a, w, f, tooltip)` — wrap the label in a span with `title` (reuse `.stats-matrix-lag-label` styling or a generic `.stats-matrix-label`).
- Symbols: `<span class="stats-matrix-sym" aria-label="average">x̄</span>` / `aria-label="total">Σ</span>` / `aria-label="percent">%</span>`. Add `.stats-matrix-sym` CSS: muted text color, fixed inline width so labels line up.

**Section: `<span class="keyword sleep">Sleep</span>`**

| # | Label | Keyword span | Value | Tooltip |
|---|---|---|---|---|
| 1 | Σ Sleep (duration) | sleep | `formatTotalSleepCell(ex)` | All sleep in this period, naps included. |
| 2 | x̄ Sleep (duration) | sleep | `av.avgSleepDuration` | Average sleep per night. |
| 3 | x̄ Nap | nap | `formatNapCell(av)` | Average nap length and how often you nap. |
| 4 | Longest sleep (one night) | sleep | `ex.longestNightly` | Your longest single night in this period. |
| 5 | Shortest sleep (one night) | sleep | `ex.shortestNightly` | Your shortest single night in this period. |
| 6 | x̄ Uninterrupted sleep | sleep | `av.avgLongestUninterrupted` | Your longest unbroken stretch each night, averaged. |
| 7 | x̄ Bed (time) | bed | `av.avgBedTime` | When you went to bed, on average. |
| 8 | x̄ Sleep (time) | sleep | `av.avgSleepStart` | When you fell asleep, on average. |
| 9 | x̄ Sleep lag | **bed** (span over "Sleep lag") | `av.avgSleepLag` | Time in bed before falling asleep, on average. |
| 10 | Σ Sleep lag | **bed** | `ex.sumSleepLag` | All time in bed before falling asleep, added up for this period. |
| 11 | x̄ Mid-sleep | sleep | `ex.avgMidSleep` | Halfway between falling asleep and waking, on average. |
| 12 | Social lag | — | `socialLagMinutes` (colspan 3, as today) | How far the middle of your sleep shifts between work days and free days (weekends and holidays). This is the MCTQ social jetlag measure. A bigger gap means your weekday and day-off rhythms are pulling apart. |

**Section: `<span class="keyword wake">Wake</span>`**

| # | Label | Keyword span | Value | Tooltip |
|---|---|---|---|---|
| 1 | x̄ Wake (time) | wake | `av.avgSleepEnd` | When you woke up, on average. |
| 2 | % Natural wake | wake | `ex.naturalWakePct` | Mornings you woke on your own: no alarm, or before the first one. |
| 3 | x̄ Wake lag (snooze) | wake | `formatSignedDurationStats(av.avgWakeLag)` | Time from your first alarm to waking, on mornings with an alarm. Negative when you woke before it. |
| 4 | Σ Wake lag (snooze) | wake | `formatSignedDurationStats(ex.sumWakeLag)` | Wake lag added up for this period. Early wakes subtract. |

Remove `TOOLTIP_WAKE`, the `wakeLag` variable, and the legacy Wake lag row. Update `TOOLTIP_SOCIAL` to row 12's copy. Section header CSS (`.stats-matrix-section th`, ~L6862) needs `.keyword.*` color rules for `th` in section rows if the existing `.stats-matrix-table th .keyword.*` selectors don't already match (they should — verify in both themes).

## 5. Colors (`src/styles/styles.css`)

| Token | Night (`:root`, L17) | Day (`[data-theme="day"]`, L147) |
|---|---|---|
| `--color-nap` | `#c4b5fd` → **`#f0abfc`** | `#6d28d9` → **`#a21caf`** |

Checked: hue ~291° vs sleep ~255° / alarm+warning ~17° / fragmentation stripes ~338°. Contrast `#f0abfc` on `--bg` 10.9:1, on `--panel` 10.1:1; `#a21caf` on white 6.3:1. Eyeball timeline nap spans and chart nap bars in both themes.

## 6. Copy (`src/spa-fragments/about.html`, ~L244–249)

Follow `docs/restore-copy-voice.md`. Replace the Statistics intro, Social lag, and Wake lag paragraphs with:

> The **Statistics** page summarizes your logged nights for a range you pick (past week through this year), side by side for **all days**, **work days**, and **free days** (weekends and holidays). Rows are grouped into **Sleep** and **Wake**. x̄ marks an average, Σ a total for the period, and % a share of mornings.
>
> **Sleep lag** is the time in bed before you fall asleep. **Wake lag (snooze)** is the time from your first alarm to waking. It's negative when you wake before the alarm, and mornings with no alarm aren't counted. A **natural wake** is a morning with no alarm, or one where you woke before the first alarm. Waking right as the alarm goes off counts as an alarm wake.
>
> **Social lag** shows whether your sleep timing shifts between workdays and days off. It compares the *middle* of your sleep on work days with the middle on free days, the same way the MCTQ (Munich ChronoType Questionnaire) measures social jetlag. A larger gap usually means your weekday routine and your weekend rhythm aren't lining up—useful for noticing schedule strain, not a grade on how you sleep.

No `data-i18n` keys exist for these strings today; if any are added, update `locales.json` EN + JA together.

## 7. Docs

- **New `docs/wake-and-lags.md`**: natural-wake rule; sleep-start anchoring with worked examples (11/20, 8/24 daytime sleep, alarm before midnight); sleep lag / wake lag / social lag definitions and symbols; stored alarm order; caller table (§2); known edge (alarm before sleep start).
- **`AGENTS.md`** — add, matching existing sections:
  > ## Wake classification and lags
  > **Applies to:** `sleep-utils.js`, `stats.js`, `stats-aggregates.js`, `charts.js`, `nightly.js`, `quick-actions.js`
  > **Spec:** [docs/wake-and-lags.md](docs/wake-and-lags.md)
  > Use `classifyWake`, `sleepLagMin`, `wakeLagMin` — never classify natural wake or compute alarm→wake inline. When changing `classifyWake`, `minutesFromSleepStart`, `sortAlarmsForNight`, `sleepLagMin`, `wakeLagMin`, the `averageSleepNights` lag fields, or `socialLagMinutes`, update the doc's rules and caller table and the wake/lag block in `tests/math-tests.js`.
- `docs/recent-average.md` L15: "bed-to-sleep delay, first-alarm-to-wake" → "sleep lag, wake lag".
- `docs/quick-actions.md` L103, L171: `avgFirstAlarmToWake` → `avgWakeLag`.
- `docs/semantic-keyword-palette.md`: Wake row "wake delay" → "wake lag"; Bed row "SOL" → "sleep lag (SOL)"; note the new nap hue.
- `README.md` L130–131: update function names.

## 8. Tests (`tests/math-tests.js`)

Update: L106–142 (alarm/natural block), L518–519, L571, L729–735 (dataset invariants → `wakeLagMin`, `classifyWake`). Delete L681–685 (legacy wake lag). **Note:** L116–117 and L139 currently assert the wrap bug (evening alarm 23:50, wake 00:20 → "natural"); replace with sleep-anchored cases.

New cases (all with `sleepStart`):

| Case | Day | Expect |
|---|---|---|
| 11/20 | ss 00:39, wake 09:33, alarm [09:42] | natural, lag −9 |
| 1 min early | ss 23:00, wake 07:04, alarm [07:05] | natural, lag −1 |
| at alarm | ss 23:00, wake 07:00, alarm [07:00] | alarm, lag 0 |
| multi, all beaten | ss 23:00, wake 06:50, alarm [07:00, 07:10] | natural, lag −10 |
| out of order | ss 23:35, wake 10:25, alarm [09:50, 08:30, 07:30] | first 07:30, lag +175 |
| daytime sleep (8/24) | ss 06:01, wake 15:05, alarm [09:30, 11:30, 13:30] | first 09:30, lag +335 |
| evening alarm, post-midnight wake | ss 22:00, wake 00:20, alarm [23:50] | alarm, lag +30 |
| alarm before sleep start (edge) | ss 00:30, wake 08:00, alarm [00:10] | natural, lag −1410 (documented edge) |
| no alarm | alarm [] | natural, lag null |
| sort | `sortAlarmsForNight(['01:30','23:30'], '23:00')` | `['23:30','01:30']` |
| Σ | `columnExtras` fixture | `sumSleepLag`, `sumWakeLag` net of negatives |

`npm run test:math` and `npm run test:qa` must pass.

## 9. Data backfill — **not for the coding agent**

Run separately against production via Supabase (dev picks it up on the next prod→dev sync). Fixes the 8/24 typo and re-sorts 11 rows (4/8, 5/18, 5/25, 5/27, 6/4, 6/19, 6/24, 7/10, 7/17, 8/27, 11/12). Dry-run verified: no classification changes; `sleep_day_drafts` unaffected.

```sql
update sleep_days set alarm = array_replace(alarm, '01:30', '13:30')
where sleep_date = '2026-08-24';

update sleep_days s set alarm = sorted.a
from (
  select id, array(
    select x from unnest(alarm) with ordinality u(x, i)
    order by ((split_part(x,':',1)::int*60 + split_part(x,':',2)::int)
            - (split_part(sleep_start,':',1)::int*60 + split_part(sleep_start,':',2)::int) + 1440) % 1440, i
  ) a
  from sleep_days
) sorted
where s.id = sorted.id and s.alarm is distinct from sorted.a;
```

## 10. Acceptance (production data)

- 11/20: chart bullseye, Nightly 🌄 "(⏰−9m)", counted in % Natural wake.
- Natural wake count identical on all three surfaces: **134 / 323** all-time.
- 8/24 on the Wake lag chart: **+5h35m** (was 13h35m).
- 11/12 chart tooltip: "alarm 07:30 → get up 10:25", lag 2h55m.
- All-time x̄ Wake lag (snooze) ≈ **31m** (unchanged semantics).
- Stats page matches §4 row order, symbols, keyword colors and tooltips in both themes.
- Nap color reads distinct from sleep on timeline, charts and Stats, in both themes.

## Out of scope / follow-ups

- `calculateLongestUninterrupted` alarm normalization.
- `stats.js` `calculateMonthlyAverages` duplicates much of `averageSleepNights` — candidate for a later consolidation.
- MSFsc (sleep-debt-corrected) social jetlag.
- CSS class / element id renames from "delay" to "lag".
