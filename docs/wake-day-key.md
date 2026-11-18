# Wake-day key (which date a night is saved under)

Reference for how a night is assigned its row date (`day.date` / Supabase `sleep_date`). This is the conceptual core of the sleep session model: bed, fell-asleep, bathroom, alarm, and wake events for one night must all land on the same row.

Implementation lives in `src/lib/sleep-utils.js` (section "Night key and open night"). Callers are in `src/routes/quick-actions.js`, `src/routes/dashboard.js`, `src/routes/entry-modal.js`, `src/lib/nightly.js`, and the remaining-wake / shared time context helpers in `sleep-utils.js`.

---

## Invariant

**A night is stored under its wake date — the morning the night ends.**

| Night | Stored as |
|-------|-----------|
| Bed 23:00 Nov 18 → wake 07:00 Nov 19 | `2026-11-19` |
| Bed 02:00 Nov 19 → wake 11:00 Nov 19 (starts after midnight) | `2026-11-19` |

Display helpers may render month/day (e.g. `11/19`), but stored keys are ISO `YYYY-MM-DD`.

---

## Vocabulary

| Term | Meaning | Uses |
|------|---------|------|
| **Night key** | The row date a night belongs to. | — |
| **Night saves** | Code that **writes** an event to a night row (quick actions, Log). | Natural wake |
| **Night lookups** | Code that **reads** "is the current night already logged?" to decide what to show (nav header, quick-action visibility, default Log date, Tonight live countdown). | Natural wake |
| **Schedule timing** | Phase, countdowns, bedtime cues — *when* things happen. | Scheduled wake (Tonight basis: average, saved target / guidance, session slider) |

**Natural wake** is the recent-average wake (`computeRecentAverages`; see [recent-average.md](recent-average.md)). **Scheduled wake** is the Tonight basis (`getTonightWakePhaseBasisFromDays`). Saves and lookups never use the scheduled wake, so a target or a slider drag cannot change which row a tap lands on.

---

## Cutover rule — new-night events

`getCurrentNightKey(now, days)` = `recordDateMdForSleepPeriod(now, getNightKeyWakeMinutes(days))`.

When an event is logged, the app only knows the wall clock, not when the night will end. It picks the row by **time of day of the tap**, relative to the natural wake:

- `now` ≤ natural wake + **120 min** → **today's** date (the night ending this morning).
- `now` > natural wake + 120 min → **tomorrow's** date (the night ending next morning).

The rule does not look at sleep length. With a 07:00 natural wake the cutover is 09:00 (inclusive):

| Tap | Row |
|-----|-----|
| 23:00 Nov 18 | Nov 19 |
| 02:00 Nov 19 | Nov 19 |
| 09:00 Nov 19 | Nov 19 |
| 09:01 Nov 19 | Nov 20 |

With no history, the natural wake falls back to 07:00 (`getFallbackWakeBasis`). The +120 band is the "early-morning band" in [quick-actions.md § Phase and row constants](quick-actions.md).

The cutover dates **new** nights (Get in bed, Go to sleep, Sleep in 10). Closing a night uses the open night instead.

---

## Open night — closing a night

**Open night** (`resolveOpenNight`, `getOpenNight`): the newest night with bed or fell-asleep logged and no wake yet. Resolved from the newest cloud drafts (`OPEN_NIGHT_DRAFT_LOOKBACK` = 5) and the newest loaded `sleep_days` date.

A candidate is **abandoned** — no longer open — when any of these holds:

- more than **`OPEN_NIGHT_MAX_AGE_HOURS` (24)** have passed since its fell-asleep time (bed time if fell-asleep is missing);
- a **newer night** has bed or fell-asleep logged (that newer night becomes the candidate);
- a completed `sleep_days` row exists for it or a later date;
- it already has a wake.

Nap-only drafts are not nights. Abandoned nights stay as drafts (visible and editable in Log); they just stop receiving wake / alarm saves.

Clock times map to instants by night key: bed / fell-asleep from 12:00 on fall on the evening **before** the wake date; earlier times on the wake date (`nightClockToInstantMs`).

### What uses the open night

| Event | Row |
|-------|-----|
| Wake up, Log alarm, No alarm was set | Open night; else cutover + wake correction (`resolveWakeNightKey`) |
| Bathroom break | Open night; else `getCurrentNightKey` |
| Get in bed / Go to sleep visibility | Tonight's open-night draft also counts as bed / sleep logged |

**Wake up** shows in **every phase** while a night is open. In wake phase it also shows with no open night while wake is not logged for the save row. When the clock is more than **`WAKE_LATE_NOTE_MINUTES` (180)** past the natural wake on the open night's wake date (`minutesPastNaturalWake`), the button carries a short note: *Woke earlier? You can fix the time in Log.*

## Wake correction (fallback) — `resolveRecordDateMdForWake`

Used for wake / alarm only when no night is open (e.g. cloud unavailable, or nothing logged). Starts from the cutover row, then inside the early-morning band, if **yesterday's** row is still awaiting wake (local QA flags / stub diff — `nightRowAwaitingWake`) and today's is not, targets yesterday's row.

---

## Callers

| Caller | Kind | Function | Night key from |
|--------|------|----------|----------------|
| Get in bed / Go to sleep / Sleep in 10 | Save | `getCurrentNightKey` (`quick-actions.js`) | Natural wake cutover |
| Wake up / Log alarm / No alarm was set | Save | `resolveWakeNightKey` (`quick-actions.js`) | Open night, else natural wake cutover + correction |
| Bathroom break | Save | `getOpenNight` → `getCurrentNightKey` (`quick-actions.js`) | Open night, else natural wake cutover |
| Quick-action visibility (`nightMd`, wake row) | Lookup | `getSharedAppTimeContext`, `renderQuickActions` | Natural wake cutover; open night for wake |
| Nav header (asleep / start sleep soon) | Lookup | `getRemainingWakeDisplayFromBasis` | Natural wake cutover |
| Default Log date | Lookup | `resolveDefaultQuickAddNightDateMd`, `quickAddPresetDateInputValue` (`entry-modal.js`) | Latest row / draft, else natural wake cutover |
| Dashboard pending night | Lookup | `getDashboardTonightNightKey` (`dashboard.js`) | Natural wake cutover |
| Tonight live sleep-remaining | Lookup | `getTonightDashboardLiveSleepRemaining` (`nightly.js`) | Natural wake cutover |

Tests: cutover, night key, and open-night blocks in `tests/math-tests.js`; render / save scenarios in `tests/quick-actions-scenarios.mjs` (`npm run test:qa`).

---

## Known edge cases

- **Daytime sleep (shift work).** A bedtime after the cutover (e.g. 10:00) goes to tomorrow's row even if wake is the same afternoon. Out of scope for now.
- **Wake up right after going to sleep.** Because Wake up follows the open night, it also appears next to Bathroom break once fell-asleep is logged.
- **Forgotten wake.** If last night's wake is never logged, the evening lookups (`isNightBedOrSleepLogged`, `isNightBedLogged`, `isNightSleepOrIntentLoggedNav`) read only tonight's key, so tonight isn't shown as already in bed. The old evening alignment to today's open row was removed for this reason.

## Related docs

- [quick-actions.md](quick-actions.md) — Layer 3 (Wake up visibility), Layer 4 (save target row), phase and row constants.
- [remaining-wake.md](remaining-wake.md) — evening wake-day alignment, default log date.
- [user-data-cloud.md](user-data-cloud.md) — `sleep_days` / `sleep_day_drafts` keyed by `(user_id, sleep_date)`.
