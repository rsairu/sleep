# Quick actions — phase and visibility logic

Reference for dashboard quick actions (wake / nap / sleep), remaining-wake alignment, and which sleep-period row each action writes to. Implementation lives in `sleep-utils.js` and `quick-actions.js`.

The quick-action system is best thought of as **four independent layers**. Resolving one layer does not imply the next; each step builds on the outputs of the previous ones.

---

## Architecture (data flow)

Shared app time context is computed once; the nav remaining-wake widget and quick-action phase both consume it. Quick-action **buttons** are then filtered by phase-specific rules.

```mermaid
flowchart TD
  ctx[getSharedAppTimeContext]
  nav[getRemainingWakeDisplayFromBasis]
  qaPhase[getQuickActionsPhaseFromSharedContext]
  infer[inferSharedSleepContextPhase]
  buttons[QUICK_ACTIONS_BY_PHASE filters]
  ctx --> nav
  ctx --> qaPhase
  qaPhase --> infer
  qaPhase --> buttons
```

---

## Layer 2 — Clock context (phase) order

When `getSharedAppTimeContext` succeeds, quick-action phase is resolved in this **strict order** (see `getQuickActionsPhaseFromSharedContext` in `quick-actions.js`):

```mermaid
flowchart TD
  d[isDynamicSleepPhase]
  w3[wakeInLast3Hours]
  wp[wakeProximity]
  fb[inferPhase on sharedContext.basis]
  d -->|true| sleepPh[phase sleep]
  d -->|false| w3
  w3 -->|true| wakePh[phase wake]
  w3 -->|false| wp
  wp -->|true| wakePh
  wp -->|false| fb
  fb --> out[inferSharedSleepContextPhase]
```

If there is no shared context (or no `navDisplay`), phase falls back to `inferSharedSleepContextPhase` using **recent averages** from `getAveragesFromDays` → `computeRecentAverages` (`RECENT_AVERAGE_WINDOW` most recent logged entries).
**Canonical clock basis for phase** when shared context exists: `sharedContext.basis` from `getEffectiveRemainingWakeBasis` / `getTonightWakePhaseBasisFromDays` (recent averages, optional saved Tonight target from `user_settings`, then optional session slider adjustment). That can differ from the separate `averages` object used for alarm eligibility, which does not apply those overlays.

---

## Layer 1 — Session state (Dynamic Sleep precondition)

**Dynamic Sleep** (open sleep session in the nav / quick actions sense) is **not** the same as “phase = sleep” from `inferSharedSleepContextPhase` alone.

Dynamic Sleep is active when `shouldShowDynamicSleepNavPhase` is true:

- Wake is **not** finalized for the current sleep-period row (`nightMd`): no QA wake flag and `sleepEnd` still matches stub where applicable (`isNightWakeLogged` false).
- **Bed or fell-asleep** is considered logged for that row: QA flags and/or row differs from stub, on this row only (`isNightBedOrSleepLogged`).
- Clock is in **overnight limbo** or the **evening sleep window** (see Layer 2 details below).
`getSharedAppTimeContext` exposes this as **`isDynamicSleepPhase`**. Dashboard quick actions use that flag (not string-matching on `navDisplay.phase`) as the first branch for forcing phase **`sleep`**.

---

## Layer 2 — Clock context (details)

### Dynamic Sleep

Active only when Layer 1’s session precondition holds **and** at least one of:

1. **Overnight limbo** — `shouldShowGoToBedSoonWakeNav`: clock is after average fell-asleep or before average get-up on a typical wake-before-sleep schedule (skipped when average wake ≥ average sleep on the clock).
2. **Evening sleep window** — `inferNavSleepWindowPhase` / `inferSharedSleepContextPhase`: clock within **120** minutes before through **240** minutes after average fell-asleep, using an offset normalized around the sleep average (`remainWakeOffsetFromSleepAvg`).

**Wake proximity:** Before the sleep window is evaluated, `inferSharedSleepContextPhase` checks **circular** distance to average get-up (`remainWakeCircDistMinutes`). If within **105** minutes, phase is **`wake`** instead of **`sleep`**.

**Important nuance:** That 105-minute rule applies **inside** the evening-window path. **Overnight limbo** does **not** re-check wake proximity. So Dynamic Sleep can still be active shortly before average wake if the session is open and limbo is true—even when `inferSharedSleepContextPhase` alone would return `wake`. Do not read “wake proximity overrides sleep” as canceling **limbo-based** Dynamic Sleep.

### After Dynamic Sleep is ruled out

- **Recent wake** — `wakeInLast3Hours`: a wake was logged in the last **3** hours (QA `wakeAtMs` and/or non-stub `sleepEnd` on today / yesterday / tomorrow wake-day candidates). Phase = **`wake`**.
- **Wake proximity** — `wakeProximity`: within **105** minutes of average get-up (circular). Phase = **`wake`**.
- **Fallback** — `inferSharedSleepContextPhase(now, basis.avgSleepStart, basis.avgSleepEnd)` → **`wake`**, **`sleep`**, or **`mid`** (105 min / 120 before / 240 after rules).

### Nav “get in bed soon” vs quick-action phase

The header can show the soft **get in bed soon** state (`getRemainingWakeDisplayFromBasis`) in overnight limbo **without** Dynamic Sleep—for example when bed/sleep are not logged yet. Quick-action phase still respects **recent wake** and **wake proximity** first; when those do not apply, the chain below can map nav bedtime cues to **`sleep`**.

**Remaining-wake alignment:** After Dynamic Sleep, recent-wake, and wake proximity, if the nav display is normal **presleep** (`phase === 'presleep'`), **`sleepSoon`**, or the soft labels **get in bed soon** / **start sleep soon**, quick actions use phase **`sleep`** so bedtime actions stay available even when the clock is still outside the ±120/240 minute average-sleep window (see `getQuickActionsPhaseFromSharedContext`). Otherwise inference falls through to **`mid`** or **`wake`** (e.g. open/winding nav with **Start a nap** when allowed).

---

## Layer 3 — Action eligibility

Once phase is **`wake`**, **`sleep`**, or **`mid`**, each button has its own predicate (`QUICK_ACTIONS_BY_PHASE` in `quick-actions.js`).

| Action        | Phase | Shown when |
|---------------|-------|------------|
| Wake up       | all   | **Any phase** while a night is open (`getOpenNight`: bed or fell-asleep on the newest draft, no wake, not abandoned — see [wake-day-key.md § Open night](wake-day-key.md)). In **wake** phase also shown with no open night while wake is not yet logged for the save target row (`wakeLoggedForWakeDayMd`). When more than `WAKE_LATE_NOTE_MINUTES` past the natural wake on the open night's wake date, the button carries a short note: *Woke earlier? You can fix the time in Log.* Save target: the open night, else `resolveRecordDateMdForWake` on the natural wake (`resolveWakeNightKey`). |
| Log alarm     | wake  | Same `avgFirstAlarmToWake` gate, **and** the wake-day row (plus cloud draft for that key) has no alarm times and has not been dismissed with the in-memory **No alarm was set** action for the current wake-day key. **Does not** persist from the dashboard: stores `restore_log_prefill_v1` in `sessionStorage`, navigates to Log (`internalNavHref('tab.log')`); Log loads that wake-day row and **appends** an alarm row set to **app now** so the form is dirty until the user saves. |
| No alarm was set | wake  | Same gates as Log alarm. Dismisses both alarm quick actions in memory for the current `resolveRecordDateMdForWake` key only; no sleep row, draft, or night note is written, so the prompt can reappear after the wake-day key changes or the module is reloaded. |
| Get in bed    | sleep | Bed not already logged for the sleep-period row (QA flag, non-stub `bed` within last **12** h wall-clock window, or `bed` on tonight's open-night draft) |
| Go to sleep   | sleep | Fell-asleep not already logged (same 12 h / stub / QA rules, or `sleepStart` on tonight's open-night draft) |
| Sleep in 10 min | sleep | Neither fell-asleep logged nor **both** bed and fell-asleep complete for the row |
| Bathroom break | sleep | Both bed and fell-asleep recorded for the row (flags or stub-diff + 12 h) |
| Start a nap   | mid   | `navDisplay.percentRemaining >= openMin` (remaining-wake thresholds), **not** `wakeInLast3Hours`, **not** implicit post-wake quiet window, and **not** `napActive` |
| End your nap  | mid, wake, sleep | Calendar-day row for “today” (`date` = month/day of app now, e.g. afternoon 4/10 → `4/10`) has an open nap on loaded cloud data **or** in `sleep_day_drafts` for that night’s ISO `sleep_date`, or matching offline nap session. Shown in wake/sleep too whenever `napActive` so a phase change does not hide it. |

**Nap vs cloud drafts:** Quick saves use `promote_draft_if_complete`. Until bed, sleep start, and wake are all present on the draft, promotion does **not** copy the whole row into `sleep_days`, but nap patches still update the draft. The dashboard list is built from `sleep_days` only, so quick actions also consult `sleep_day_drafts` for the same ISO night key (`sleep_date` / row `date`) when deciding `napActive`. When a `sleep_days` row **already exists** for that night, the RPC copies `nap_start` / `nap_end` from the draft into `sleep_days` on each nap patch (see `supabase/schema.sql` and `supabase/migrations/20260410180000_sync_nap_from_draft_to_sleep_days.sql` — apply the migration on your Supabase project).

**Implicit post-wake quiet:** `implicitPostWakeQuiet` — wall clock within **180** minutes after average get-up on a typical schedule (`isImplicitPostWakeQuietWindow`). Suppresses **Start a nap** even in **`mid`** phase.

---

## Layer 4 — Save target row

Each action persists to the **sleep-period row keyed by wake day** (`date` on the row is the morning you wake into). Full rules: [wake-day-key.md](wake-day-key.md).
- **Bed** and **fell-asleep** start or continue a night: **`getCurrentNightKey`** — the cutover (`recordDateMdForSleepPeriod`) on the **natural** recent-average wake.
- **Wake** and **alarm** (Log alarm, No alarm was set) close a night: **`resolveWakeNightKey`** — the **open night** when there is one, so a late wake never splits the night; otherwise `resolveRecordDateMdForWake` (cutover + early-morning correction) on the natural wake.
- **Bathroom** is an in-night event: the open night when there is one, else `getCurrentNightKey`.
- **Nap start / end** use the **calendar day** of app `now` (same `date` as “today’s” row, e.g. a 4/10 afternoon nap → `4/10`), not the evening forward shift used for tonight’s bed row.

---

## Phase and row constants

Values match `sleep-utils.js` (and inline `120` where noted). Update this table when code changes.

| Identifier | Value | Meaning |
|------------|------:|---------|
| `PHASE_WAKE_PROXIMITY_MINS` | 105 | Circular minutes to average get-up; inside `inferSharedSleepContextPhase`, maps to **wake** before the sleep window is considered |
| `PHASE_SLEEP_WINDOW_BEFORE` | 120 | Minutes before average fell-asleep included in **sleep** phase window |
| `PHASE_SLEEP_WINDOW_AFTER` | 240 | Minutes after average fell-asleep included in **sleep** phase window |
| `IMPLICIT_POST_WAKE_QUIET_MINUTES` | 180 | After average get-up, suppress nap start (typical wake-before-sleep schedule only) |
| Early-morning band (inline) | 120 | Minutes after the **natural** wake on the clock: still map to **today’s** wake-day row in `recordDateMdForSleepPeriod`; also defines “early morning” for `resolveRecordDateMdForWake` |
| `OPEN_NIGHT_MAX_AGE_HOURS` | 24 | Hours after an open night's fell-asleep (bed if missing) before it is abandoned |
| `WAKE_LATE_NOTE_MINUTES` | 180 | Minutes past the natural wake (on the open night's wake date) before Wake up shows its "woke earlier?" note |
| `OPEN_NIGHT_DRAFT_LOOKBACK` | 5 | Newest drafts fetched to resolve the open night |
| Recent wall-clock window (QA / logged fields) | 12 | Hours back (plus small forward tolerance) for treating stub-differing `bed` / `sleepStart` / `sleepEnd` as “recently logged” |
| Recent wake window | 3 | Hours for `isRecentWakeInHours` / `wakeInLast3Hours` |

---

## Source map

| Concept | Primary location |
|--------|-------------------|
| Shared context, dynamic sleep, wake flags, quiet window | `getSharedAppTimeContext`, `shouldShowDynamicSleepNavPhase`, `isRecentWakeInHours`, `isImplicitPostWakeQuietWindow` — `sleep-utils.js` |
| Phase inference (105 / 120 / 240) | `inferSharedSleepContextPhase`, `isWithinWakeProximity` — `sleep-utils.js` |
| Nav display (including dynamic sleep UI) | `getRemainingWakeDisplayFromBasis` — `sleep-utils.js` |
| Quick-action phase order | `getQuickActionsPhaseFromSharedContext` — `quick-actions.js` |
| Button definitions | `QUICK_ACTIONS_BY_PHASE`, `renderQuickActions` — `quick-actions.js` |
| Night key / wake correction | `getNightKeyWakeMinutes`, `getCurrentNightKey`, `recordDateMdForSleepPeriod`, `resolveRecordDateMdForWake`, `nightRowAwaitingWake` — `sleep-utils.js` |
| Open night | `resolveOpenNight` (pure), `getOpenNight`, `fetchRecentNightDrafts`, `resolveWakeNightKey`, `minutesPastNaturalWake` — `sleep-utils.js` |
| Scenario tests | `tests/quick-actions-scenarios.mjs` (`npm run test:qa`) |
| QA flags (bed / sleep / wake) | `readNightQaSleepFlagMap`, `markNightQaSleepFlag` — `sleep-utils.js` |
| Recent-average basis vs plain recent averages | `getTonightWakePhaseBasisFromDays`, `computeRecentWakeBasis` vs `getAveragesFromDays` — all read `computeRecentAverages` in `sleep-utils.js` |
| Wake logged (quick actions) | `wakeLoggedForWakeDayMd` — `sleep-utils.js` |
| Log alarm prefill | `restore_log_prefill_v1`, `tryConsumeLogAlarmPrefill`, `appendListTimeNow('quick-add-alarm-list')` — `quick-actions.js` / `entry-modal.js` |

---

## Natural vs scheduled times (red flag to remember)

- **Schedule timing** — phase, nav, countdowns, nap threshold: `sharedContext.basis` ← `getEffectiveRemainingWakeBasis` (recent averages + optional saved Tonight target / guidance + optional session slider adjustment).
- **Night key** — which row a save or lookup targets: always the **natural** wake (`getNightKeyWakeMinutes` / `getCurrentNightKey`), never `basis`, so dragging a slider or setting a target cannot change which night a tap lands on.
- **Alarm quick action gate:** `averages.avgFirstAlarmToWake` from `getAveragesFromDays` → `computeRecentAverages`.
