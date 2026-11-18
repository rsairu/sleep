# Wake-day key (which date a night is saved under)

Reference for how a night is assigned its row date (`day.date` / Supabase `sleep_date`). This is the conceptual core of the sleep session model: bed, fell-asleep, bathroom, alarm, and wake events for one night must all land on the same row.

Implementation lives in `src/lib/sleep-utils.js` (`recordDateMdForSleepPeriod`, `resolveRecordDateMdForWake`, `nightRowAwaitingWake`). Callers are in `src/routes/quick-actions.js`, `src/routes/dashboard.js`, `src/lib/nightly.js`, and the remaining-wake / shared time context helpers in `sleep-utils.js`.

---

## Invariant

**A night is stored under its wake date — the morning the night ends.**

| Night | Stored as |
|-------|-----------|
| Bed 23:00 Nov 18 → wake 07:00 Nov 19 | `2026-11-19` |
| Bed 02:00 Nov 19 → wake 11:00 Nov 19 (starts after midnight) | `2026-11-19` |

Display helpers may render month/day (e.g. `11/19`), but stored keys are ISO `YYYY-MM-DD`.

---

## Cutover rule — `recordDateMdForSleepPeriod(now, avgWakeMins)`

When an event is logged, the app only knows the wall clock, not when the night will end. It picks the row by **time of day of the tap**, relative to a wake time:

- `now` ≤ wake + **120 min** → **today's** date (the night ending this morning).
- `now` > wake + 120 min → **tomorrow's** date (the night ending next morning).

The rule does not look at sleep length. With a 07:00 wake the cutover is 09:00 (inclusive):

| Tap | Row |
|-----|-----|
| 23:00 Nov 18 | Nov 19 |
| 02:00 Nov 19 | Nov 19 |
| 09:00 Nov 19 | Nov 19 |
| 09:01 Nov 19 | Nov 20 |

The +120 band is the "early-morning band" in [quick-actions.md § Phase and row constants](quick-actions.md). Tests: `tests/math-tests.js` (wake-day cutover block).

## Wake correction — `resolveRecordDateMdForWake(now, avgWakeMins, liveDays)`

Wake and alarm saves start from the cutover row, then correct one case: inside the early-morning band, if **yesterday's** row is still awaiting wake (bed/sleep logged, wake still a stub — `nightRowAwaitingWake`) and today's row is not, the wake finalizes yesterday's row. This covers late logging / simulated time so bed and wake do not split across rows.

Outside the band no correction runs.

---

## Which wake time feeds the cutover (current state)

Callers currently pass two different wake times:

- **Natural wake** — plain recent average (`computeRecentAverages` in `sleep-utils.js`, via `getAveragesFromDays` in quick actions; window = `RECENT_AVERAGE_WINDOW` most recent logged entries).
- **Scheduled wake** — the Tonight basis after saved target, guidance, and session slider adjustment (`getTonightWakePhaseBasisFromDays` / `getEffectiveRemainingWakeBasis`).

| Caller | Function | Wake used |
|--------|----------|-----------|
| Bed / Go to sleep / Sleep in 10 / Bathroom saves | `recordDateMdForSleepPeriod` (`quick-actions.js`) | Natural |
| Wake up / Log alarm / No alarm was set | `resolveRecordDateMdForWake` (`quick-actions.js`) | Natural |
| Dashboard pending-night key | `getDashboardTonightNightKey` (`dashboard.js`) | Natural |
| Quick-action visibility `nightMd` | `getSharedAppTimeContext` | Scheduled |
| Remaining-wake nav | `getRemainingWakeDisplayFromBasis` | Scheduled |
| Default Log date | `resolveDefaultQuickAddNightDateMd` | Scheduled |
| Tonight live sleep-remaining | `getTonightDashboardLiveSleepRemaining` (`nightly.js`) | Committed (scheduled) |

The two only disagree between their cutovers (e.g. natural 07:30 → 09:30, target 06:00 → 08:00: from 08:00 to 09:30 visibility points at tomorrow's row while saves still go to today's).

---

## Known edge cases

- **Waking past the cutover.** A 09:30 wake with a 07:00 natural wake resolves to tomorrow's row by the cutover alone. Today this is masked: the **Wake up** quick action only shows within `PHASE_WAKE_PROXIMITY_MINS` (105) of the wake time, and the Log page defaults to the open draft.
- **Daytime sleep (shift work).** A bedtime after the cutover (e.g. 10:00) goes to tomorrow's row even if wake is the same afternoon. Out of scope for now.

## Related docs

- [quick-actions.md](quick-actions.md) — Layer 4 (save target row), phase and row constants.
- [remaining-wake.md](remaining-wake.md) — evening wake-day alignment, default log date.
- [user-data-cloud.md](user-data-cloud.md) — `sleep_days` / `sleep_day_drafts` keyed by `(user_id, sleep_date)`.
