# Recent average (Natural sleep / wake)

Reference for "your recent average" — the **Natural** times on the Tonight matrix, the basis for the Tonight bar, remaining-wake nav, quick-action phase, and the natural wake that anchors the night key ([wake-day-key.md](wake-day-key.md)).

Implementation: `src/lib/sleep-utils.js`, section "Recent averages". Every caller uses `computeRecentAverages` (or `averageSleepNights` for a fixed list); nothing re-derives it.

---

## Rule

- **Window:** the newest **`RECENT_AVERAGE_WINDOW` (14)** logged entries — entries, not calendar days. After a gap, the window reaches back to older entries.
- **Weights:** entry *i* back (0 = newest) has weight **0.5 ^ (i / `RECENT_AVERAGE_HALF_LIFE`)**, half-life **5** entries. Every 5 entries back, an entry counts half as much.
- **Average:** Σ weight × value / Σ weight. With fewer than 14 entries, the same weights apply to what exists.
- **Clock times** (fell-asleep, wake) are averaged on the extended axis (`normalizeTimeForAveraging` / `normalizeWakeTimeForAveraging`) so midnight crossings average correctly.
- **All fields** (fell-asleep, wake, duration, longest uninterrupted, bed-to-sleep delay, first-alarm-to-wake) use the same weights. First-alarm-to-wake averages only entries with an alarm.

| Entries back | 0 | 1 | 2 | 5 | 10 | 13 |
|---|---|---|---|---|---|---|
| Weight | 1 | 0.87 | 0.76 | 0.5 | 0.25 | 0.16 |
| Share (14 entries) | 15.1% | 13.2% | 11.5% | 7.6% | 3.8% | 2.5% |

The newest 7 entries carry ≈72% of the weight.

### Catch-up

A lasting one-hour shift reaches the average gradually:

| Entries since the shift | 1 | 3 | 5 | 7 | 10 | 14 |
|---|---|---|---|---|---|---|
| Average moved | 9 min | 24 min | 35 min | 44 min | 53 min | 60 min |

Last night's influence (~15%) is about the same as the former flat 7-entry mean (1/7 ≈ 14%); the difference is the tail, which settles over about two weeks instead of one.

---

## Fixed lists

`averageSleepNights(nights)` with no weights is an **equal-weight** mean. Week summaries (timeline) and lifetime stats use it this way; only `computeRecentAverages` applies recency weights.

## Per-night baselines

`computeRecentAverages(days, { endBeforeIndex: i })` averages the entries **before** `days[i]` (that night excluded) — the shape a deviation-flag baseline needs. Excluding the night avoids self-inclusion: a night inside its own baseline pulls the baseline toward itself and understates its own deviation.

## Tests

Recent-average block in `tests/math-tests.js`: weights, window, partial windows, `endBeforeIndex`, catch-up curve. Expected clock values were computed independently from the rule above.
