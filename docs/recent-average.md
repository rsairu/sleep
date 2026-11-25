# Recent average (Natural sleep / wake)

Reference for "your recent average" — the **Natural** times on the Tonight matrix, the basis for the Tonight bar, remaining-wake nav, quick-action phase, and the natural wake that anchors the night key ([wake-day-key.md](wake-day-key.md)).

Implementation: `src/lib/sleep-utils.js`, section "Recent averages". Every caller uses `computeRecentAverages` (or `averageSleepNights` for a fixed list); nothing re-derives it.

---

## Rule

- **Window:** the newest **`RECENT_AVERAGE_WINDOW` (14)** logged entries — entries, not calendar days. After a gap, the window reaches back to older entries.
- **Weights:** half-life **5** entries (`0.5 ^ (i / 5)`), newest first; the newest 7 entries carry ≈72% of the weight.
- **All fields** (bed, fell-asleep, wake, duration, longest uninterrupted, sleep lag, wake lag) use the same weights. Wake lag averages only entries with an alarm; see [wake-and-lags.md](wake-and-lags.md).

Formulas, the weight table, the catch-up curve, and the clock-axis rules are in [math.md](math.md) § Recent average and § Clock axis.

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

`averageSleepNights(nights)` with no weights is an **equal-weight** mean. Week summaries (timeline), lifetime stats, and the dashboard **Recent stats** section (this week vs the week before) use it this way; only `computeRecentAverages` applies recency weights. Which average each surface uses: [math.md](math.md) § Which average applies where.

## Per-night baselines

`computeRecentAverages(days, { endBeforeIndex: i })` averages the entries **before** `days[i]` (that night excluded). Deviation flags use it through `getDeviationBaseline` (`nightly.js`), which reads the unrounded `exact` means (fell-asleep / wake on the extended axis) and reports learning below `DEVIATION_MIN_PRIOR_NIGHTS` (7) earlier entries. So a flag's "recent average" is the same window and weighting as Natural, anchored one night back.

The dashboard 7-day charts draw the same baseline as dashed "usual" lines: `getUsualBaselineForNight` (`dashboard.js`) reads `avgSleepDuration`, `avgFellAsleepTime` and `avgWakeTime` from `getDeviationBaseline` for each of the last 7 nights, with gaps where a night is still learning. **Total sleep time** gets a duration line; the time charts get fell-asleep and wake lines (bed gets no usual line). So the gap between a night's dot and its line is the deviation its flag judges.

Excluding the night avoids self-inclusion: a night inside its own baseline pulls the baseline toward itself and understates its own deviation — more so with recency weighting, where the newest entry carries ~15%.

## Tests

Recent-average block in `tests/math-tests.js`: weights, window, partial windows, `endBeforeIndex`, catch-up curve, `avgBed` / `exact`. Expected clock values were computed independently from the rule in [math.md](math.md).
