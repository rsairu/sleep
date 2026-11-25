# Math

The one place for Restore's formulas: how nights are measured, how averages are weighted, how flags and the Recent stats deltas are scored, and why. Feature docs own **behavior and callers**. This doc owns the **numbers**. When a feature doc needs a formula, it links here rather than restating it.

| Topic | Formula lives in | Behavior / callers live in |
|---|---|---|
| Clock axis, per-night quantities | here | — |
| Recent average (weights, window, catch-up) | here § Recent average | [recent-average.md](recent-average.md) (learning stages, per-night baselines, callers) |
| Wake classification, sleep / wake lag | [wake-and-lags.md](wake-and-lags.md) (the offset rule *is* the classification) | same |
| Blended %, flag severity | here | `nightly.js` flag chips, calendar heatmap |
| Recent stats (dashboard) | here | — |
| Social lag | here | [wake-and-lags.md](wake-and-lags.md) § Metrics |
| Tonight guidance pace, matrix phase | here | — |
| Remaining-wake phase % | here (summary) | [remaining-wake.md](remaining-wake.md) |

All times are **minutes**. Clock times are minutes from midnight, 0–1439. Durations are plain minutes.

---

## Clock axis

Clock times wrap at midnight, so you can't average them directly: averaging 23:30 and 00:30 as 1410 and 30 gives 12:00. Restore averages on an **extended axis** where the night is continuous, then wraps the result back.

| Function (`time-utils.js`) | Rule | Used for |
|---|---|---|
| `normalizeTimeForAveraging(m)` | `m < 720 ? m + 1440 : m`: times before noon move to "tomorrow" | fell-asleep |
| `normalizeWakeTimeForAveraging(ss, w)` | `w < ss` → `w + 1440`. Sleep before 06:00 and wake at 10:00 or later → `w + 1440`. Otherwise like fell-asleep. | wake, always relative to that night's fell-asleep |
| `denormalizeTimeForAveraging(n)` | `n % 1440` | back to a clock time |
| `durationMinutes(a, b)` | `b ≥ a ? b − a : b + 1440 − a` | every span (sleep, nap, lags, wake window) |
| `shortestSignedClockDelta(from, to)` | `to − from` wrapped into [−720, 720] | guidance steps, Recent stats display |
| `shortestClockGapMinutes(a, b)` | `|shortestSignedClockDelta|` | guidance gaps |

**Bed** isn't normalized on its own. In `averageSleepNights` it's placed at **fell-asleep − sleep lag**. So the average bed is always the average fell-asleep minus the average sleep lag, and it can never land after the average fell-asleep, even when bed and fell-asleep fall on opposite sides of noon.

> Known divergence: the Stats page `calculateMonthlyAverages` (`stats.js`) still sums its own equal-weight means and normalizes bed independently with `normalizeTimeForAveraging(bed)`. It only gives a different result when a bed is before 12:00 and its fell-asleep after, or the other way round. Moving it onto `averageSleepNights` would close the gap.

---

## Per-night quantities

| Quantity | Formula | Function |
|---|---|---|
| **Total sleep** | `durationMinutes(sleepStart, sleepEnd)` + nap `durationMinutes(nap.start, nap.end)` if logged | `calculateTotalSleep` |
| **Longest uninterrupted** | Longest gap between sleep start, each alarm that falls inside the sleep span, and sleep end. Bathroom trips don't split it; alarms do. | `calculateLongestUninterrupted` |
| **Sleep lag** | `durationMinutes(bed, sleepStart)`: bed → asleep, wraps midnight | `sleepLagMin` |
| **Wake lag (snooze)** | Signed: earliest alarm → wake, measured as minutes after sleep start. `null` with no alarm. Natural wake ⇔ no alarm or lag < 0. | `wakeLagMin` / `classifyWake`. See [wake-and-lags.md](wake-and-lags.md) |
| **WASO level** | episodes: 1 → mild, 2 → moderate, 3+ → severe, 0 / missing → none | `normalizeFragmentationLevel` |
| **Mid-sleep** | `(sleepStart + sleepEnd′) / 2 mod 1440`, where `sleepEnd′ = sleepEnd + 1440` if it's before sleep start | `perNightMidSleepClockMinutes` |

---

## Averages

### Weighted mean

`averageSleepNights(nights, weights?)` (`sleep-utils.js`) is the only averaging function. Every field is a weighted mean:

```
avg = Σ wᵢ · valueᵢ / Σ wᵢ
```

- Clock times are averaged on the extended axis (above), then wrapped.
- **Wake lag** averages only nights with an alarm (`Σ` over alarm nights, divided by their weights). It's `null` when there are none.
- Rounded fields (`avgBed`, `avgSleepStart`, …) are for display. `exact` holds the unrounded means (`bedNorm`, `sleepStartNorm`, `sleepEndNorm` on the extended axis; `sleepDuration`, `sleepLag`, `wakeLag`). Comparisons must use `exact` so a 0.4-minute difference doesn't become a 1-minute jump.
- With no `weights`, every night counts 1: a plain **equal-weight** mean.

### Recent average (Natural)

`computeRecentAverages(days, { endBeforeIndex? })`:

- **Window:** the newest `RECENT_AVERAGE_WINDOW` = **14 logged entries**. These are entries, not calendar days: after a gap, the window reaches further back.
- **Weights:** entry *i* back (0 = newest) has `wᵢ = 0.5 ^ (i / RECENT_AVERAGE_HALF_LIFE)`, half-life **5** entries. With fewer than 14 entries, the same weights apply to what exists.
- **`endBeforeIndex: k`** averages the entries *before* `days[k]`, leaving that night out. That's the per-night flag baseline.

| Entries back | 0 | 1 | 2 | 5 | 10 | 13 |
|---|---|---|---|---|---|---|
| Weight | 1 | 0.87 | 0.76 | 0.5 | 0.25 | 0.16 |
| Share of 14 (Σw ≈ 6.62) | 15.1% | 13.2% | 11.5% | 7.6% | 3.8% | 2.5% |

The newest 7 entries carry ≈72% of the weight.

**Catch-up.** If you shift your schedule by a full hour and keep it, the average follows gradually:

| Entries since the shift | 1 | 3 | 5 | 7 | 10 | 14 |
|---|---|---|---|---|---|---|
| Average moved | 9 min | 24 min | 35 min | 44 min | 53 min | 60 min |

Why weighted: last night's influence (~15%) matches a flat 7-night mean (1/7 ≈ 14%), but the tail settles over two weeks instead of dropping out at night 8. One unusual night fades out instead of disappearing all at once.

### Which average applies where

| Surface | Average | Window |
|---|---|---|
| Tonight Natural, Tonight bar, remaining-wake nav, quick-action phase, night key cutover | recent (weighted) | newest 14 entries |
| Nightly flags, calendar heatmap, dashboard "usual" lines | recent (weighted), night excluded (`getDeviationBaseline`) | 14 entries before the night |
| Dashboard **Recent stats** | equal weight | 7 calendar days vs the 7 before |
| Timeline week summaries | equal weight | the calendar week |
| Stats page | equal weight (own implementation, see Clock axis) | the selected period |

Learning stages (🌱 1–6 entries, 🌿 7–13, established 14+) gate guidance and flags. See [recent-average.md](recent-average.md) § Learning stages.

---

## Blended variation %

One number expresses "how far off" a minute difference is. Flags and Recent stats both use it.

```
pct = 0.75 · (diff / avgSleep) · 100 + 0.25 · (diff / 1440) · 100
```

- `diff`: minutes of difference (absolute)
- `avgSleep`: the comparison baseline's average total sleep (min 1)
- `BLEND_ALPHA` = 0.75

So it's **mostly a share of your average sleep, with a quarter of the full day mixed in**. The sleep share makes it personal: 30 minutes matters more to someone who sleeps 6h than to someone who sleeps 9h. The day share keeps the scale from blowing up for very short sleepers. In practice the result is a little under "percent of your sleep."

Worked example: 31 minutes against a 7h30m (450m) average:
`0.75 × 31/450 × 100 + 0.25 × 31/1440 × 100 = 5.17 + 0.54 = 5.7%`

### Severity thresholds

`severityFromBlendedPercent(p)`:

| pct | Severity | Color |
|---|---|---|
| < 5 | none | — |
| 5 – < 10 | slight | `--quality-slight` |
| 10 – < 19 | moderate | `--quality-moderate` |
| ≥ 19 | severe | `--quality-severe` |

Those thresholds in minutes, by average sleep:

| Avg sleep | slight from | moderate from | severe from |
|---|---|---|---|
| 6h | 22m | 44m | 1h 24m |
| 7h | 26m | 51m | 1h 37m |
| 7h 30m | 27m | 54m | 1h 43m |
| 8h | 29m | 58m | 1h 49m |
| 9h | 32m | 1h 4m | 2h 2m |

Colors come from the six-step quality ramp (`QUALITY_PALETTES`, Meadow or Harbor). Steps 4–6 are slight / moderate / severe. Steps 1–3 (excellent / great / good) are set aside and not used for scoring yet.

---

## Nightly flags

Each night is compared with `getDeviationBaseline(days, i)`: the recent average of the entries before it, unrounded. Flags need at least `DEVIATION_MIN_PRIOR_NIGHTS` = 7 earlier entries (🌱 below that).

| Flag | diff | Counts when | Severity |
|---|---|---|---|
| 😴 Sleep (fell asleep) | night − baseline, extended axis | **later** only | blended % |
| ⌛ Duration | baseline − night total sleep | **shorter** only | worst of blended % and absolute floor |
| 🌅 Wake | |night − baseline|, extended axis | **either way** | blended % |
| 👁️ WASO | — | any episodes | mild → slight, moderate → moderate, 3+ → severe |

**Absolute duration floor** (`severityFromAbsoluteTotalSleepMinutes`). This applies whatever your average is:

| Total sleep | Severity |
|---|---|
| < 6h (360) | slight |
| < 5h (300) | moderate |
| < 4h (240) | severe |

Relative and absolute severities combine with `maxSeverity`, the **worse of the two**. They don't stack.

**Direction choices.** Following the non-punitive rule, the flags only fire in the direction that usually costs sleep: falling asleep earlier and sleeping longer never flag. Wake flags both ways because an unusually early wake also breaks the rhythm.

**Calendar heatmap** cell color = the worst severity among 😴, ⌛ and 👁️ (`computeWorstQualitySeverity`). 🌅 appears in the tooltip only.

---

## Recent stats

The dashboard section comparing this week with the week before (`computeRecentStatsComparison`, `nightly.js`).

**Windows.** The anchor is the newest logged night key (the wake date). The current window is that key and the 6 calendar days before it. The previous window is the 7 calendar days before that. Missing nights just shrink a window. The caption shows the counts.

**Minimum.** A window needs `RECENT_STATS_MIN_NIGHTS` = 4 logged nights. If either window has fewer, the tiles show this week's values (when this week has enough) with a neutral "not enough nights yet".

**Averages.** Each window gets an equal-weight `averageSleepNights` mean (not the recent weights). That's why these numbers can differ slightly from Natural and the "usual" lines.

**Delta and %.** `delta = current.exact − previous.exact`, with clock times on the extended axis. `pct = blended(|delta|, previous.exact.sleepDuration)`, the same formula and baseline type as a flag. Here the baseline is last week's average sleep.

| Tile | Colored when | Notes |
|---|---|---|
| Bed | later | earlier → neutral |
| Asleep | later | earlier → neutral |
| Wake | either way | |
| Total sleep | less | Plus the absolute floor on **this week's** average (< 6h / 5h / 4h), which applies even with no change. The tile then says "average under Nh". |
| Sleep lag | longer | |
| Snooze (wake lag) | longer | Alarm nights only. A week with only natural wakes shows "—" / "all natural wakes". |

Severity = `maxSeverity(blended severity if the direction counts, absolute floor)`. Thresholds are the same 5 / 10 / 19 as flags.

**Display.**
- The pill's minutes are the difference between the two **displayed** (rounded) values, so "was 23:03" plus "10m later" reads 23:13.
- The % is the blended % **rounded down** (`recentStatsDisplayPercent`), so the shown number and the color always agree: "5%" is always at least slight, and "4%" is never colored.
- Color and severity always come from the unrounded delta.

---

## Social lag

MCTQ social jetlag: `|MSF − MSW|` on the 24h circle (shortest arc). MSW is the average mid-sleep on work days, MSF on free days (weekends and holidays). Mid-sleep is averaged on the extended axis (`averageMidSleepClockMinutes`). Function: `StatsAggregates.socialLagMinutes`.

---

## Tonight guidance

**Pace.** With a saved target and guidance on, each night's guided time moves from the recent average toward the target by at most a daily cap:

```
guided = avg + clamp(shortestSignedClockDelta(avg, target), −cap, +cap)
```

| Pace | Cap per night |
|---|---|
| Gentle | 6 min |
| Even (`normal`) | 10 min |
| Steady | 15 min |

The step is measured from the recent average, so progress follows what you actually do: if you don't move, guidance doesn't run ahead of you. While the recent average is learning (fewer than 7 entries), guidance is held and a saved target applies directly.

**Matrix phase** (`buildTonightMatrixViewModel`):

- `initialGap = gap(natural, target)`
- `currentGap = gap(guided, target)`
- `ratio = currentGap / initialGap`

| Condition | Phase |
|---|---|
| currentGap = 0 | on target |
| ratio ≤ 0.15 | locking in |
| ratio ≥ 0.7 | initiating |
| otherwise | transitioning |

---

## Remaining-wake phase

`percentRemaining = min(100, remainingMins / totalWakeMins × 100)`. Here `totalWakeMins` = `durationMinutes(avgWake, avgSleep)` from the Tonight basis. The phase is **open** at ≥ 35%, **winding** at ≥ 15%, otherwise **pre-sleep**. The thresholds are adjustable in the dev banner. Overrides (waking soon, overnight, learning) are in [remaining-wake.md](remaining-wake.md).

---

## Constants

| Constant | Value | File |
|---|---|---|
| `RECENT_AVERAGE_WINDOW` | 14 entries | `sleep-utils.js` |
| `RECENT_AVERAGE_HALF_LIFE` | 5 entries | `sleep-utils.js` |
| `RECENT_AVERAGE_FORMING_MIN` / `DEVIATION_MIN_PRIOR_NIGHTS` | 7 entries | `sleep-utils.js` / `nightly.js` |
| `BLEND_ALPHA` | 0.75 | `nightly.js` |
| Severity cut-offs | 5 / 10 / 19 % | `nightly.js` `severityFromBlendedPercent` |
| `ABS_DURATION_{SLIGHT,MODERATE,SEVERE}_LT_MIN` | 360 / 300 / 240 | `nightly.js` |
| `RECENT_STATS_SPAN_DAYS` | 7 days | `nightly.js` |
| `RECENT_STATS_MIN_NIGHTS` | 4 nights | `nightly.js` |
| `TONIGHT_GUIDANCE_PACE_MAX_MINUTES` | 6 / 10 / 15 | `sleep-utils.js` |
| Remaining-wake `openMin` / `windingMin` | 35 / 15 % | `sleep-utils.js` |

If you change one, update this doc and the matching block in `tests/math-tests.js`.

## Tests

`tests/math-tests.js` (`npm run test:math`) has blocks for the clock axis, averages (fixed and recent, `avgBed`, `exact`), deviation baselines and flags, Recent stats (windows, directions, floor, display rounding, insufficient and all-natural states), wake and lags, and social lag. Expected values come from the formulas above, worked out independently of the code.
