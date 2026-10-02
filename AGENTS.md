# Agent instructions for Restore

Conventions for AI coding agents working in this repo. Each section names the files it applies to and the canonical spec in `docs/`. Specs live in `docs/`; this file only points to them and says when to update them.

## Semantic Keyword Palette (SKP) — always applies

When styling or naming anything tied to **bed**, **sleep/asleep**, **wake**, **alarm**, **nap**, etc., follow the Semantic Keyword Palette documented in [docs/semantic-keyword-palette.md](docs/semantic-keyword-palette.md).

- Use the CSS variables listed there (`--color-bed`, `--color-sleep`, `--color-up`, …), defined in `styles.css`, instead of ad-hoc hex for those meanings.
- For new charts, timelines, or legends, match the same tokens the daily view uses.

## Restore copy and voice

**Applies to:** `about.html`, `settings.html`, `locales.json`
**Spec:** [docs/restore-copy-voice.md](docs/restore-copy-voice.md)

- User-facing prose should be calm, direct, plain language; no medical claims or guilt framing.
- **Settings** copy is short and scannable; **About** may be longer where behavior is explained.
- Align tone with the dark-first UI (precise where the product is precise).
- For strings tied to `data-i18n`, keep keys and markup intact and update `locales.json` (and Japanese entries where they exist) in the same change.
- For color/event semantics in copy that references the UI, see [docs/semantic-keyword-palette.md](docs/semantic-keyword-palette.md).
- Do not expand scope into drive-by rewrites of unrelated sections; match the requested surfaces only.

## Dev banner and app-time controls

**Applies to:** `sleep-utils.js`, `styles.css`, `local/stamp-dev-branch.js`
**Spec:** [docs/dev-banner.md](docs/dev-banner.md) (visibility, warnings, drawer behavior, app-time simulation, fixed-layout reserve logic)

When changing any of these, update the doc and its **Keys and constants** table if key names, precedence, or thresholds change:

`isDevBuildContext`, `readDevClockOverrideMs`, `getAppNowMs`, `renderNavBar`, `getSupabaseBannerBadgeModel`, `isDevBannerSupabaseEffectiveDev`, `initDevClockControl`, `initDevBannerCloudRefresh`, `initDevBannerDbSwitchFlip`, `initDevBannerDrawer`, `initDevBannerVercelDeployStatus`, `hydrateDevBannerVercelDeployStatus`, `vercelDeployBadgeToneFromShields`, `formatVercelDeployDisplayLabel`, Vercel deploy pass cache (`VERCEL_DEPLOY_SHIELDS_PASS_CACHE_*`, `readVercelDeployShieldsPassCache`, `writeVercelDeployShieldsPassCache`, `clearVercelDeployShieldsPassCache`, `applyVercelDeployBadgeUI`), `initDevBannerUserSettingsPanel`, `updateDevBannerUserSettingsPanel`, `applyDevBannerUserSettingsDefaults`, `measureDevBannerExpandedHeightPx`, `syncDevBannerFixedLayout`, `ensureDevSupabasePresetApplied`.

## Quick actions and time context

**Applies to:** `quick-actions.js`, `sleep-utils.js`
**Spec:** [docs/quick-actions.md](docs/quick-actions.md) (phase resolution, action visibility, save-row keys, related constants)

When changing `getQuickActionsPhaseFromSharedContext`, `getSharedAppTimeContext`, `inferSharedSleepContextPhase`, `shouldShowDynamicSleepNavPhase`, or `QUICK_ACTIONS_BY_PHASE`, update the doc and its **Phase and row constants** table if any numbers or order of checks change.

## User data and cloud preferences

**Applies to:** `sleep-utils.js`, `supabase/schema.sql`
**Spec:** [docs/user-data-cloud.md](docs/user-data-cloud.md) (user vs sleep storage, cloud gate, `user_settings` REST sync, one-time migration, localStorage policy, MVP `user_id` until auth)

When changing any of these, update the doc and its mapping / policy sections if behavior or keys change:

`loadSleepDataUsesSupabase`, `ensureUserSettingsFromCloud`, `chainSleepDataWithUserSettingsHydrate`, `fetchUserSettings`, `upsertUserSettings`, `localUserSettingsToRow`, `userSettingsRowToLocalStorage`, `syncUserSettingsRowToCloud`, `refreshUiAfterUserSettingsHydrate`, `resetUserSettingsCloudHydration`, `setSupabaseConfig`, `clearSupabaseConfig`, `ACTIVE_SUPABASE_PRESET_KEY`, `RESTORE_CLOUD_USER_ID`, `USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY`, `getTonightTargetWindow`, `setTonightTargetWindow`, `mergeTonightTargetWindow`, `clearTonightTargetWindow`, `clearTonightTargetPole`, `getTonightGuidanceSleepEnabled`, `setTonightGuidanceSleepEnabled`, `getTonightGuidanceWakeEnabled`, `setTonightGuidanceWakeEnabled`, `getTonightGuidancePaceId`, `setTonightGuidancePaceId`, `getHintQuickActionsAbout`, `getHintTonightAbout`, `setHintQuickActionsAboutVisible`, `setHintTonightAboutVisible`, `initDashboardHintsSettingsControls`, `initAboutDashboardHintDismissButtons`, `resolveTonightScheduledWindow`, `getTonightWakePhaseBasisFromDays`, `getEffectiveRemainingWakeBasis`, and `user_settings` grants/columns in SQL.
