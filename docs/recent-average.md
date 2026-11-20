# Recent average (Natural sleep / wake)

Reference for "your recent average" — the **Natural** times on the Tonight matrix, the basis for the Tonight bar, remaining-wake nav, quick-action phase, and the natural wake that anchors the night key ([wake-day-key.md](wake-day-key.md)).

Implementation: `src/lib/sleep-utils.js`, section "Recent averages". Every caller uses `computeRecentAverages` (or `averageSleepNights` for a fixed list); nothing re-derives it.

---

## Rule

- **Window:** the newest **`RECENT_AVERAGE_WINDOW` (14)** logged entries — entries, not calendar days. After a gap, the window reaches back to older entries.
- **Weights:** entry *i* back (0 = newest) has weight **0.5 ^ (i / `RECENT_AVERAGE_HALF_LIFE`)**, half-life **5** entries. Every 5 entries back, an entry counts half as much.
- **Average:** Σ weight × value / Σ weight. With fewer than 14 entries, the same weights apply to what exists.
- **Clock times** (fell-asleep, wake) are averaged on the extended axis (`normalizeTimeForAveraging` / `normalizeWakeTimeForAveraging`) so midnight crossings average correctly.
- **All fields** (fell-asleep, wake, duration, longest uninterrupted, sleep lag, wake lag) use the same weights (`avgSleepLag`, `avgWakeLag`). Wake lag averages only entries with an alarm; see [wake-and-lags.md](wake-and-lags.md).

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

## Learning stages

`getRecentAverageStage(sampleSize)` (`sleep-utils.js`), by logged entries in the window:

| Entries | Stage | What changes |
|---|---|---|
| 0 | `empty` | Dashboard shows *🌱 Learning: log your first night*; nav shows 🌱 *learning your rhythm* instead of a countdown. No times are derived from the 22:30 / 07:00 defaults on screen (the night key still uses them internally — [wake-day-key.md](wake-day-key.md)). |
| 1–6 | `learning` 🌱 | Natural shows the early average with 🌱 and a note *Learning · n of 14 nights*. Guidance is **held** (`isTonightGuidanceHeld`): a saved target applies directly (`resolveTonightScheduledWindow(..., { holdGuidance })`), the Guided cell reads *🌱 Starts at 7 nights*, and a note says the target is used directly. Flags: 🌱 (fewer than 7 earlier nights). |
| 7–13 | `forming` 🌿 | Guidance and flags on. Natural and the note show 🌿 *Taking shape · n of 14 nights*; quality-calendar squares for nights with 7–13 earlier nights get a 🌿 corner mark. |
| 14+ | `established` | No marker. |

`RECENT_AVERAGE_FORMING_MIN` (7) is the unlock point for guidance (`isTonightGuidanceHeld`) and flags (`DEVIATION_MIN_PRIOR_NIGHTS` in `nightly.js`). Guidance preferences are kept while held: Tonight's base state carries `guidanceSleepEnabled` / `guidanceWakeEnabled` (saved toggles, shown in the target editor) and `guidanceSleepActive` / `guidanceWakeActive` (applied tonight: knobs, matrix, pace dialog).

User-facing copy: About → *While Restore learns your rhythm* (`about.tonightLearning.*` in `locales.json`).

## Fixed lists

`averageSleepNights(nights)` with no weights is an **equal-weight** mean. Week summaries (timeline) and lifetime stats use it this way; only `computeRecentAverages` applies recency weights.

## Per-night baselines

`computeRecentAverages(days, { endBeforeIndex: i })` averages the entries **before** `days[i]` (that night excluded). Deviation flags use it through `getDeviationBaseline` (`nightly.js`), which reads the unrounded `exact` means (fell-asleep / wake on the extended axis) and reports learning below `DEVIATION_MIN_PRIOR_NIGHTS` (7) earlier entries. So a flag's "recent average" is the same window and weighting as Natural, anchored one night back.

Excluding the night avoids self-inclusion: a night inside its own baseline pulls the baseline toward itself and understates its own deviation — more so with recency weighting, where the newest entry carries ~15%.

## Tests

Recent-average block in `tests/math-tests.js`: weights, window, partial windows, `endBeforeIndex`, catch-up curve. Expected clock values were computed independently from the rule above.
