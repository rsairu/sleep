# Refactoring Assessment: sleep-utils.js

## Current State

[`src/lib/sleep-utils.js`](../src/lib/sleep-utils.js) is approximately **6,000 lines** containing 20+ distinct functional areas. The file serves as a shared utility layer consumed by route modules (`dashboard.js`, `log.js`, `settings.js`, etc.) and the existing smaller modules (`nightly.js`, `stats-aggregates.js`).

---

## Refactoring Candidates

### 1. Theme Module (Strong Candidate)
**Lines ~200 | Cohesion: High | Coupling: Low**

Day/night theme logic with auto-mode, palette selection, and DOM application.

Functions to extract:
- `getThemeFromTime`, `getThemeOverride`, `setThemeOverride`
- `getEffectiveTheme`, `applyDayNightTheme`
- Quality palette: `getQualityPaletteId`, `setQualityPaletteId`, `applyQualityPaletteToDocument`
- Theme toggle UI: `handleDayNightClick`, `updateDayNightIcon`

**Why**: Self-contained visual concern. The only dependency is `getAppDate()` (dev clock) and storage helpers.

---

### 2. Tonight Guidance Module (Strong Candidate)
**Lines ~400 | Cohesion: High | Coupling: Medium**

Target sleep/wake window, guidance pace, and scheduled-vs-average resolution.

Functions to extract:
- `getTonightTargetWindow`, `setTonightTargetWindow`, `mergeTonightTargetWindow`, `clearTonightTargetWindow`
- `getTonightGuidanceSleepEnabled`, `getTonightGuidanceWakeEnabled`, `setTonightGuidance*`
- `getTonightGuidancePaceId`, `setTonightGuidancePaceId`
- `resolveTonightScheduledWindow`, `computeTonightEffectiveTargetFromAverages`

**Why**: Well-defined domain (Tonight feature). Couples to cloud sync and remaining-wake, but those can be event-driven or injected.

---

### 3. Remaining Wake Module (Strong Candidate)
**Lines ~300 | Cohesion: High | Coupling: Medium**

Phase thresholds (open/winding/pre-sleep), phase computation, and nav display.

Functions to extract:
- `getRemainingWakeThresholds`, `setRemainingWakeThresholds`
- `getRemainingWakePhase`, `getRemainingWakeIcon`
- `getRemainingWakeDisplayFromBasis`, `updateRemainingWakeNav`
- `computeRemainingWakePhaseHeadsUp`

**Why**: Conceptually distinct feature. Currently documented in [`remaining-wake.md`](remaining-wake.md), making a dedicated module align with documentation structure.

---

### 4. Dev Banner Module (Moderate Candidate)
**Lines ~600 | Cohesion: High | Coupling: Medium**

Dev-build detection, simulated clock, drawer UI, user-settings panel, Vercel badge.

Functions to extract:
- `isDevBuildContext`, `readDevClockOverrideMs`, `getAppNowMs`, `getAppDate`
- `initDevClockControl`, `initDevBannerDrawer`, `syncDevBannerFixedLayout`
- `updateDevBannerUserSettingsPanel`, `hydrateDevBannerVercelDeployStatus`

**Why**: Dev-only concern that production users never see. Extracting would also allow tree-shaking in production builds.

---

### 5. i18n Module (Moderate Candidate)
**Lines ~100 | Cohesion: High | Coupling: Low**

Locale loading, `t()` translation, DOM application.

Functions to extract:
- `getLanguagePreference`, `setLanguagePreference`, `normalizeLanguage`
- `t`, `loadLocaleDictionary`, `applyTranslations`, `initI18n`

**Why**: Classic cross-cutting concern. Currently tiny but would grow with more translations.

---

### 6. Sleep Data Store Module (Moderate Candidate)
**Lines ~500 | Cohesion: High | Coupling: High**

Cache, store state, listeners, visibility re-fetch, cloud vs local loading.

Functions to extract:
- `loadSleepData`, `clearSleepDataCache`, `subscribeSleepDataStore`
- Store state management, localStorage cache read/write

**Why**: Central data layer. High coupling to Supabase config and user settings makes this harder to extract cleanly, but not impossible.

---

### 7. Time/Date Utilities (Moderate Candidate)
**Lines ~150 | Cohesion: High | Coupling: None**

Pure functions for parsing, formatting, normalization.

Functions to extract:
- `parseWallClockToMinutes`, `formatMinutesTo24hString`, `formatTime`, `formatDuration`
- `normalizeTimeForAveraging`, `denormalizeTimeForAveraging`, `normalizeWakeTimeForAveraging`
- `durationMinutes`, `modMinutes1440`, `shortestSignedClockDelta`

**Why**: Pure math with no side effects. Already relied upon by `stats-aggregates.js` and `nightly.js`.

---

### 8. Sleep Calculations (Weak Candidate)
**Lines ~200 | Cohesion: Medium | Coupling: Low**

Per-day metrics: total sleep, alarm-to-wake, natural wake detection.

Functions: `calculateTotalSleep`, `calculateLongestUninterrupted`, `calculateAlarmToWakeDelta`, `isNaturalWakeDay`, `calculateSleepDelay`

**Why**: Tightly coupled to time utilities and used everywhere. Could merge with time utilities into a larger "sleep-math" module, but splitting alone doesn't add much clarity.

---

### 9. Navigation Rendering (Weak Candidate)
**Lines ~400 | Cohesion: Medium | Coupling: High**

`renderNavBar` (large inline HTML), Slumby animation, nav menu.

**Why**: Contains a lot of inline HTML and DOM manipulation. High coupling to remaining-wake, theme, dev-banner. Extracting would require careful interface design. Lower ROI.

---

## Candidates NOT Recommended for Extraction

- **Supabase Config + User Settings Cloud Sync**: Deeply intertwined with data loading, theme, i18n, and tonight guidance. Breaking apart would create a fragile web of cross-module imports.
- **Constants/Storage Keys**: Too small and too widely referenced. Better left in a shared location.
- **Day Panel Popup**: ~50 lines, trivial.

---

## Suggested Phased Approach

| Phase | Module | Effort | Impact |
|-------|--------|--------|--------|
| 1 | Time/Date Utilities | Low | Foundation for others |
| 2 | Theme | Low | Self-contained, quick win |
| 3 | i18n | Low | Clean cross-cutting concern |
| 4 | Tonight Guidance | Medium | Aligns with feature docs |
| 5 | Remaining Wake | Medium | Aligns with feature docs |
| 6 | Dev Banner | Medium | Dev-only, tree-shakeable |
| 7 | Sleep Data Store | High | Core layer, careful design needed |

---

## Summary

**Realistic assessment**: 4-5 strong extraction candidates, 2-3 moderate candidates that depend on taste and project direction. The remaining ~2,500 lines (Supabase config, user settings sync, navigation rendering) are intertwined enough that they may reasonably stay together or require a more significant architectural refactor.

Extracting the strong candidates would reduce `sleep-utils.js` to roughly **3,000 lines** and create modules with clearer ownership, which would benefit features like Tonight and Remaining Wake that already have dedicated documentation.

---

## Phase 1: Time/Date Utilities

### Goal
Extract pure time and date functions into `src/lib/time-utils.js`. These have zero side effects, no DOM or localStorage access, and form the foundation that other modules depend on.

### Functions to Extract

**Time Parsing/Formatting**
- `parseWallClockToMinutes(timeStr)` — parse "HH:MM" or "h:mm AM/PM" to minutes
- `formatMinutesTo24hString(minutes)` — minutes to "HH:MM"
- `formatTime(minutes, shortMidnight?)` — respects clock format preference
- `formatDuration(minutes)` — "Xh Ym" display

**Time Math (Pure)**
- `timeToMinutes(time)` — alias for parseWallClockToMinutes
- `durationMinutes(startMinutes, endMinutes)` — handles midnight crossover
- `modMinutes1440(m)` — normalize to 0-1439 range
- `isValidClockMinute(m)` — validation helper

**Averaging Normalization**
- `normalizeTimeForAveraging(minutes)` — pre-noon times +1440
- `denormalizeTimeForAveraging(normalizedMinutes)` — mod back to 0-1440
- `normalizeWakeTimeForAveraging(sleepStartMinutes, wakeMinutes)` — overnight adjustment
- `normalizeTimeForComparison(minutes)` — for bed-time comparisons
- `normalizeTimeForYAxis(minutes)` — chart positioning (start at 17:00)

**Clock Circle Math**
- `shortestSignedClockDelta(fromMin, toMin)` — signed delta in [-720, 720]
- `shortestClockGapMinutes(a, b)` — unsigned distance [0, 720]

**Date Utilities**
- `isIsoSleepDateString(s)` — validate YYYY-MM-DD format
- `parseIsoLocalDate(iso)` — parse to Date object
- `formatIsoDateFromLocalDate(d)` — Date to YYYY-MM-DD
- `normalizeSleepDateKey(input)` — canonical sleep row key
- `parseSleepDateToLocalDate(dateString)` — sleep key to Date
- `formatSleepDateMonthDay(isoOrKey)` — "M/D" display
- `addCalendarDaysToSleepDateKey(isoKey, deltaDays)` — date arithmetic

### Implementation To-Dos

- [ ] Create `src/lib/time-utils.js` with all functions listed above
- [ ] Use IIFE pattern matching existing modules (`nightly.js`, `stats-aggregates.js`)
- [ ] Expose on `window` for browser compatibility (no ES modules yet)
- [ ] Keep `getClockFormatPreference` call in `formatTime` — import from sleep-utils or accept as param
- [ ] Update `sleep-utils.js` to delegate to `time-utils.js` (thin wrappers or re-export on window)
- [ ] Update `stats-aggregates.js` to use `time-utils.js` directly instead of relying on window globals from sleep-utils
- [ ] Update `nightly.js` similarly

### Manual Checks Post-Implementation

- [ ] **Dashboard**: Remaining wake countdown displays correctly; phase transitions at expected times
- [ ] **Log page**: Time inputs parse correctly; duration column shows "Xh Ym" format
- [ ] **Charts page**: Y-axis labels render; tooltip times are correct
- [ ] **Stats page**: Averages compute correctly; social lag minutes match prior behavior
- [ ] **Settings page**: Clock format toggle (12h/24h) immediately updates displayed times
- [ ] **Dev banner**: Simulated clock still advances app time correctly
- [ ] **Console**: No errors referencing undefined time/date functions
- [ ] **Unit tests**: Run `npm test` (if applicable) — all time-related tests pass
