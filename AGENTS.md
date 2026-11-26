# Agent instructions for Restore

Conventions for AI coding agents working in this repo. Each section names the files it applies to and the canonical spec in `docs/`. Specs live in `docs/`; this file only points to them and says when to update them.

## Semantic Keyword Palette (SKP) — always applies

When styling or naming anything tied to **bed**, **sleep/asleep**, **wake**, **alarm**, **nap**, etc., follow the Semantic Keyword Palette documented in [docs/semantic-keyword-palette.md](docs/semantic-keyword-palette.md).

- Use the CSS variables listed there (`--color-bed`, `--color-sleep`, `--color-up`, …), defined in `src/styles/styles.css`, instead of ad-hoc hex for those meanings.
- For new charts, timelines, or legends, match the same tokens the Nightly view uses.

## Restore copy and voice

**Applies to:** `src/spa-fragments/about.html`, `src/spa-fragments/settings.html`, `locales.json`
**Spec:** [docs/restore-copy-voice.md](docs/restore-copy-voice.md)

- User-facing prose should be calm, direct, plain language; no medical claims or guilt framing.
- **Settings** copy is short and scannable; **About** may be longer where behavior is explained.
- Align tone with the dark-first UI (precise where the product is precise).
- For strings tied to `data-i18n`, keep keys and markup intact and update `locales.json` (and Japanese entries where they exist) in the same change.
- For color/event semantics in copy that references the UI, see [docs/semantic-keyword-palette.md](docs/semantic-keyword-palette.md).
- Do not expand scope into drive-by rewrites of unrelated sections; match the requested surfaces only.

## Dev banner and app-time controls

**Applies to:** `src/lib/sleep-utils.js`, `src/styles/styles.css`, `local/stamp-dev-branch.js`
**Spec:** [docs/dev-banner.md](docs/dev-banner.md) (visibility, warnings, drawer behavior, app-time simulation, fixed-layout reserve logic)

When changing any of these, update the doc and its **Keys and constants** table if key names, precedence, or thresholds change:

`isDevBuildContext`, `readDevClockOverrideMs`, `getAppNowMs`, `renderNavBar`, `getSupabaseBannerBadgeModel`, `isDevBannerSupabaseEffectiveDev`, `initDevClockControl`, `initDevBannerCloudRefresh`, `initDevBannerDbSwitchFlip`, `initDevBannerSupabaseSync`, `readLocalGithubDispatchConfig`, `getDevSupabaseSyncButtonModel`, `startDevSupabaseSync`, `pollDevSupabaseSyncRun`, `initDevBannerDrawer`, `initDevBannerVercelDeployStatus`, `hydrateDevBannerVercelDeployStatus`, `vercelDeployBadgeToneFromShields`, `formatVercelDeployDisplayLabel`, Vercel deploy pass cache (`VERCEL_DEPLOY_SHIELDS_PASS_CACHE_*`, `readVercelDeployShieldsPassCache`, `writeVercelDeployShieldsPassCache`, `clearVercelDeployShieldsPassCache`, `applyVercelDeployBadgeUI`), `initDevBannerUserSettingsPanel`, `updateDevBannerUserSettingsPanel`, `applyDevBannerUserSettingsDefaults`, `measureDevBannerExpandedHeightPx`, `syncDevBannerFixedLayout`, `ensureDevSupabasePresetApplied`.

## Quick actions and time context

**Applies to:** `quick-actions.js`, `sleep-utils.js`
**Spec:** [docs/quick-actions.md](docs/quick-actions.md) (phase resolution, action visibility, save-row keys, related constants)

When changing `getQuickActionsPhaseFromSharedContext`, `getSharedAppTimeContext`, `inferSharedSleepContextPhase`, `shouldShowDynamicSleepNavPhase`, or `QUICK_ACTIONS_BY_PHASE`, update the doc and its **Phase and row constants** table if any numbers or order of checks change.

## Wake-day key (night row date)

**Applies to:** `sleep-utils.js`, `quick-actions.js`, `dashboard.js`, `entry-modal.js`, `nightly.js`
**Spec:** [docs/wake-day-key.md](docs/wake-day-key.md) (wake-date invariant, vocabulary: night key / saves / lookups / schedule timing, cutover rule, open night, callers)

When changing `nightKeyForSleepPeriod`, `resolveFallbackWakeNightKey`, `nightRowAwaitingWake`, `getNightKeyWakeMinutes`, `getCurrentNightKey`, `resolveOpenNight`, `getOpenNight`, `resolveWakeNightKey`, `getDashboardTonightNightKey`, the open-night constants, or any caller's night key, update the doc's caller table and examples, the night-key / open-night tests in `tests/math-tests.js`, and `tests/quick-actions-scenarios.mjs`. Night saves and night lookups use the natural wake only; schedule timing uses the Tonight basis.

## Math (averages, flags, percentages)

**Applies to:** any change to a formula, threshold, weight, or window in `sleep-utils.js`, `nightly.js`, `stats-aggregates.js`, `stats.js`
**Spec:** [docs/math.md](docs/math.md) (clock axis, per-night quantities, weighted vs equal averages and where each applies, blended %, flag severity, Recent stats, social lag, guidance pace, constants table)

math.md owns the numbers; feature docs link to it instead of restating formulas. If you change a constant or formula, update its section and **Constants** table, and the matching block in `tests/math-tests.js`. Dashboard Recent stats (`computeRecentStatsComparison`, `RECENT_STATS_*`) is specified only there.

## Recent averages (Natural sleep / wake)

**Applies to:** any file that needs "your recent average"
**Spec:** [docs/recent-average.md](docs/recent-average.md) (learning stages, per-night baselines, fixed lists vs recent); weights and formulas in [docs/math.md](docs/math.md) § Averages

Use `computeRecentAverages(days, { endBeforeIndex? })` (or `averageSleepNights(nights)` for an equal-weight fixed list such as a week) from `sleep-utils.js`; deviation flags go through `getDeviationBaseline` (`nightly.js`), which wraps it. Do not slice `days` and re-average by hand — window size and weighting live only in that section (`RECENT_AVERAGE_WINDOW`, `RECENT_AVERAGE_HALF_LIFE`, `recentAverageWeights`). If you change them, update [docs/math.md](docs/math.md) § Recent average and the recent-average block in `tests/math-tests.js`.

## Wake classification and lags

**Applies to:** `sleep-utils.js`, `stats.js`, `stats-aggregates.js`, `charts.js`, `nightly.js`, `quick-actions.js`
**Spec:** [docs/wake-and-lags.md](docs/wake-and-lags.md)

Use `classifyWake`, `sleepLagMin`, `wakeLagMin` — never classify natural wake or compute alarm→wake inline. When changing `classifyWake`, `minutesFromSleepStart`, `sortAlarmsForNight`, `sleepLagMin`, `wakeLagMin`, the `averageSleepNights` lag fields, or `socialLagMinutes`, update the doc's rules and caller table and the wake/lag block in `tests/math-tests.js`.

## User data and cloud preferences

**Applies to:** `sleep-utils.js`, `supabase/schema.sql`
**Spec:** [docs/user-data-cloud.md](docs/user-data-cloud.md) (user vs sleep storage, cloud gate, `user_settings` REST sync, one-time migration, localStorage policy, MVP `user_id` until auth)

When changing any of these, update the doc and its mapping / policy sections if behavior or keys change:

`loadSleepDataUsesSupabase`, `ensureUserSettingsFromCloud`, `chainSleepDataWithUserSettingsHydrate`, `fetchUserSettings`, `upsertUserSettings`, `localUserSettingsToRow`, `userSettingsRowToLocalStorage`, `syncUserSettingsRowToCloud`, `refreshUiAfterUserSettingsHydrate`, `resetUserSettingsCloudHydration`, `setSupabaseConfig`, `clearSupabaseConfig`, `ACTIVE_SUPABASE_PRESET_KEY`, `RESTORE_CLOUD_USER_ID`, `USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY`, `getTonightTargetWindow`, `setTonightTargetWindow`, `mergeTonightTargetWindow`, `clearTonightTargetWindow`, `clearTonightTargetPole`, `getTonightGuidanceSleepEnabled`, `setTonightGuidanceSleepEnabled`, `getTonightGuidanceWakeEnabled`, `setTonightGuidanceWakeEnabled`, `getTonightGuidancePaceId`, `setTonightGuidancePaceId`, `getHintQuickActionsAbout`, `getHintTonightAbout`, `setHintQuickActionsAboutVisible`, `setHintTonightAboutVisible`, `initDashboardHintsSettingsControls`, `initAboutDashboardHintDismissButtons`, `getPhaseWallpaperEnabled`, `setPhaseWallpaperEnabled`, `resolveTonightScheduledWindow`, `getTonightWakePhaseBasisFromDays`, `getEffectiveRemainingWakeBasis`, and `user_settings` grants/columns in SQL.
