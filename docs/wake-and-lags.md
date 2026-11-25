# Wake classification and lags

Reference for how a morning is classified as a **natural** or **alarm** wake, and how **sleep lag**, **wake lag (snooze)**, and **social lag** are computed. One rule, used by every surface (Charts, Stats, Nightly, Dashboard, quick actions).

Implementation lives in `src/lib/sleep-utils.js` (section "Wake classification and lags"). Do not classify natural wake or compute alarm → wake inline anywhere else. How these per-night values are averaged, compared and colored: [math.md](math.md).

---

## Natural wake

A morning is a **natural wake** when:

- no alarm was logged, **or**
- you woke **strictly before** the earliest alarm.

Waking 1–2 minutes early counts as natural. Waking exactly at the alarm minute is an **alarm wake**. There is no separate "woke before alarm" marker on charts: those mornings are natural wakes.

## Anchoring to sleep start

All alarm math uses minutes after sleep start, never clock-hour heuristics:

```
offset(t) = (t − sleepStart + 1440) % 1440        // 0..1439
```

- **Earliest alarm** = the alarm with the smallest offset (the classifier takes the minimum; it does not trust stored order).
- **Wake lag** = `offset(wake) − offset(earliest alarm)`, signed.
- **Natural** ⇔ no alarm, or wake lag < 0.

### Worked examples

| Night | Sleep start | Alarms | Wake | Offsets (alarm → wake) | Wake lag | Type |
|---|---|---|---|---|---|---|
| 11/20 | 00:39 | 09:42 | 09:33 | 543 → 534 | −9m | natural |
| 8/24 daytime sleep | 06:01 | 09:30, 11:30, 13:30 | 15:05 | 209 → 544 | +5h35m | alarm |
| Alarm before midnight | 22:00 | 23:50 | 00:20 | 110 → 140 | +30m | alarm |
| Out of order (11/12) | 23:35 | 09:50, 08:30, 07:30 | 10:25 | 475 → 650 (first = 07:30) | +2h55m | alarm |
| At the alarm | 23:00 | 07:00 | 07:00 | 480 → 480 | 0 | alarm |

### Missing sleep start (fixtures only)

Production `sleep_start` is `NOT NULL`. For test fixtures without it: first alarm = minimum clock alarm; wake lag = shortest signed clock delta, in `[−720, 720)`.

### Known edge: alarm before sleep start

An alarm logged *before* sleep start (e.g. sleep 00:30, alarm 00:10) gets a large offset (1420) and is treated as next-day. With wake 08:00 (offset 450) the lag is −970 and the morning is natural. Not present in data; left as is and covered by a test so the behavior is explicit.

---

## Metrics

| Metric | Symbol on Stats | Definition | Nights counted | Function |
|---|---|---|---|---|
| **Sleep lag** | x̄, Σ | Bed → asleep, minutes (wraps midnight). | All nights | `sleepLagMin(day)` |
| **Wake lag (snooze)** | x̄, Σ | Signed first alarm → wake (above). Negative when you woke before it. Σ is a net total. | Nights with an alarm | `wakeLagMin(day)` / `classifyWake(day).wakeLagMin` |
| **Natural wake** | % | Share of mornings that are natural wakes. | All nights | `classifyWake(day).natural` |
| **Social lag** | — | MCTQ social jetlag: `|MSF − MSW|`, mid-sleep on free days vs work days, shortest arc ([math.md](math.md) § Social lag). | Work vs free days | `StatsAggregates.socialLagMinutes` |

Stats symbols: **x̄** average, **Σ** total for the period, **%** share of mornings.

Averages: `averageSleepNights` / `computeRecentAverages` return `avgSleepLag` (all nights) and `avgWakeLag` (alarm nights only, signed; `null` when the window has no alarm night). The quick-action alarm gate uses `avgWakeLag != null`.

The legacy "wake lag" (natural-average wake − alarm-average wake) is removed.

## Stored alarm order

Alarms are written **sorted by sleep-start offset** (`sortAlarmsForNight`, stable) in `mapDayToSupabaseRow` and `mapPartialDayToDraftPatch`. A draft patch without `sleepStart` falls back to clock order. Readers must still not rely on order: `classifyWake` always takes the minimum offset.

---

## API (`sleep-utils.js`)

| Function | Returns |
|---|---|
| `minutesFromSleepStart(clockMinutes, sleepStartMinutes)` | 0..1439, `NaN` if either is missing |
| `sortAlarmsForNight(alarms, sleepStart)` | Copy of alarm strings sorted by offset; clock order if `sleepStart` missing |
| `classifyWake(day)` | `{ natural, firstAlarm, wakeLagMin }` — no alarm → `{ true, null, null }` |
| `sleepLagMin(day)` | Bed → asleep minutes |
| `wakeLagMin(day)` | `classifyWake(day).wakeLagMin` |

Removed: `isNaturalWakeDay`, `isNoAlarmWakeDay`, `calculateWakeDelay`, `calculateAlarmToWakeDelta`, `calculateFirstAlarmToWake`, `calculateBedToSleepDelay`, `calculateSleepDelay`, `getFirstAlarmMinutes`, `StatsAggregates.wakeLagMinutes`.

Out of scope: `calculateLongestUninterrupted` keeps its own alarm normalization.

## Callers

| File | Uses |
|---|---|
| `src/routes/charts.js` | `buildGraphPagePointsFromDays`: one `classifyWake` per day → `wakeLagMinutes`, `firstAlarm`, `naturalWake`; `sleepLagMin` → `sleepLagMinutes`. Wake lag chart, sleep lag chart, natural-wake bullseye markers. |
| `src/routes/dashboard.js` | Dashboard chart points: `classifyWake(day).natural` → `naturalWake`. |
| `src/lib/nightly.js` | Day badge (🌄 / `(⏰-9m)` / ⏰ `+lag`) from `classifyWake`; 🛌 suffix from `sleepLagMin`; averages panel `avgSleepLag`, "Wake lag (avg)" from `avgWakeLag`; dashboard Recent stats Sleep lag / Snooze tiles from `exact.sleepLag` / `exact.wakeLag` (`computeRecentStatsComparison`). |
| `src/routes/quick-actions.js` | Alarm quick action gate: `averages.avgWakeLag != null`. |
| `src/routes/stats.js` | `calculateMonthlyAverages` → `avgSleepLag`, `avgWakeLag`; `columnExtras` → natural %, `sumSleepLag`, `sumWakeLag`. |
| `src/lib/stats-aggregates.js` | `socialLagMinutes` only. |
| `sleep-utils.js` write path | `mapDayToSupabaseRow`, `mapPartialDayToDraftPatch` → `sortAlarmsForNight`. |

Tests: the wake/lag block in `tests/math-tests.js` ("Wake classification and lags").
