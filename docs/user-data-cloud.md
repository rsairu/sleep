# User data, cloud sync, and preferences

Reference for how Restore stores **sleep nights** vs **user preferences**, when the app talks to Supabase, and how localStorage relates to the `user_settings` table. Implementation lives primarily in `sleep-utils.js`; table definitions in `supabase/schema.sql`.

This document is the base for future work: **authentication**, per-user `user_id`, RLS policies, and foreign keys from other tables to `auth.users` or a profiles table.

---

## Scope (MVP)

- **Single cloud user**: one row in `public.user_settings` keyed by a fixed UUID (`RESTORE_CLOUD_USER_ID` in `sleep-utils.js`), matching the seed insert in `supabase/schema.sql`, until real sign-in exists.
- **Client access**: PostgREST with the project **anon** key (same as `sleep_days` / drafts / RPC in this repo).

---

## Cloud gate (when Supabase is used for preferences)

Preferences sync to `user_settings` only when **sleep data** would load from Supabase:

- `getSupabaseConfig().enabled` (URL + anon key present), and
- `restore_force_local_sleep_data` is not `'1'` (the Cloud vs Local toggle under Settings when Supabase is configured).

This matches `loadSleepDataUsesSupabase(config)` in `sleep-utils.js`. If the user forces **local** sleep JSON, preference writes stay **localStorage only** (no `user_settings` reads or upserts).

---

## What lives where

| Area | Storage | Notes |
|------|---------|--------|
| Sleep nights (completed rows) | `public.sleep_days` | Upsert via REST with `on_conflict=user_id,sleep_date`; rows scoped by `RESTORE_CLOUD_USER_ID` and native `sleep_date` (see `supabase/migrations/` phase 2). Client mapping prefers `sleep_date`, then ISO `date_md` (`mapSupabaseRowToDay` in `sleep-utils.js`). |
| Incomplete night drafts | `public.sleep_day_drafts` + RPC `promote_draft_if_complete` | Same composite key; draft fetch filters `user_id` + `sleep_date`. RPC args: `p_date_md` (ISO), `p_patch`. Optional SQL and UI checks: **Phase 3** in `docs/tmp-year-schema-plan.md`. |
| User preferences (tracked columns) | `public.user_settings` + **localStorage mirror** | See mapping table below. |
| Supabase URL / anon key | localStorage | Never sent as table data; `restore_supabase_*` keys. |
| Dev/prod preset mode | localStorage `sleep-app-active-supabase-preset` | Optional: when `dev` or `prod`, credentials are driven by gitignored `local-supabase-presets.js` (see `docs/dev-banner.md`). Cleared when saving or clearing Supabase in Settings. |
| Preset definitions | `window.__RESTORE_SUPABASE_PRESETS__` (from optional `local-supabase-presets.js`) | Not persisted; loaded before `sleep-utils.js`. If missing or incomplete, Settings-only config applies. |
| Sleep data cache | localStorage `restore_sleep_data_cache_v1` | Snapshot of last loaded sleep payload + cache key. |
| Tonight projection tweak | localStorage only | Not in `user_settings`. |
| Dev banner, app-time simulation, QA flags | localStorage only | Not cloud-synced. |

---

## Column mapping (`user_settings` ↔ localStorage)

| DB column | App keys / getters |
|-----------|---------------------|
| `user_id` | `RESTORE_CLOUD_USER_ID` (fixed UUID in JS; must match seed). |
| `language` | `sleep-app-language`; `getLanguagePreference` / `setLanguagePreference`. |
| `theme_override` | `sleep-app-theme-override`; `null` in DB = auto (remove key); `'day'` / `'night'` = manual. |
| `clock_format` | `sleep-app-clock-format`; `12h` / `24h`. |
| `quality_palette` | `sleep-app-quality-palette`; `meadow` / `harbor` / `auto`. |
| `remaining_wake_open_min` / `remaining_wake_winding_min` | JSON in `sleep-app-remaining-wake-thresholds`; must satisfy `openMin > windingMin` (matches DB check). |
| `remaining_wake_phase_heads_up_mins` | `sleep-app-remaining-wake-phase-heads-up-mins`; allowed 0, 15, 30, 45, 60. |

Helpers: `localUserSettingsToRow`, `userSettingsRowToLocalStorage`, `fetchUserSettings`, `upsertUserSettings`.

---

## Theme model (auto vs override)

- **UI** exposes Auto / Light / Dark via `setThemeChoice` (`sleep-utils.js`).
- **Stored**: Auto → no override (`theme_override` `NULL`, local key removed); Light/Dark → `'day'` / `'night'`.
- **Effective theme**: `getEffectiveTheme()` — override if set, else `getThemeFromTime()` (local sunrise/sunset windows), not `prefers-color-scheme`.

---

## Sync behavior

### Read path (hydrate)

On `loadSleepData` when the cloud gate is on, `ensureUserSettingsFromCloud` runs (deduped per session until reset):

1. `GET` `user_settings` for `RESTORE_CLOUD_USER_ID`.
2. If **no row**: `upsert` from `localUserSettingsToRow()` so a row exists; set migration flag (see below).
3. If row exists and matches **seed defaults** (`isSeedDefaultUserSettingsRow`) and **local** differs from those defaults and the one-time migration has **not** run: **upsert local → cloud** once, then set migration flag.
4. Otherwise: **apply cloud row to localStorage** (`userSettingsRowToLocalStorage`); set migration flag.

After hydrate, `refreshUiAfterUserSettingsHydrate` reapplies theme, i18n, and config controls where present.

Hydration state resets when Supabase config is saved/cleared or when **local sleep** is forced via `setSleepDataForcedLocal` (`resetUserSettingsCloudHydration`).

### Write path (setters)

`setLanguagePreference`, `setThemeOverride`, `setClockFormatPreference`, `setQualityPaletteId`, `setRemainingWakeThresholds`, and `setRemainingWakePhaseHeadsUpMinutes` write **localStorage first**, then `syncUserSettingsRowToCloud()` → full-row `upsert` to `user_settings` when the cloud gate is on. Failures are logged; local values remain authoritative on the device.

### One-time migration flag

- Key: `restore_user_settings_cloud_migration_v1` (`USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY`).
- Meaning: the “cloud was still seed defaults, push local once” step has completed (or hydrate finished without needing it).

---

## Failure and offline behavior

- If `fetchUserSettings` or `upsertUserSettings` fails during hydrate, hydration does not mark success; the next `loadSleepData` can retry.
- Setter-time upsert failures warn to the console; the user keeps local changes.

---

## Supabase grants

`supabase/schema.sql` includes `grant select, insert, update on public.user_settings to anon, authenticated` for MVP REST access. Replace with **RLS** + policies when moving to authenticated users.

---

## Evolution (auth and multi-user)

1. Replace fixed `RESTORE_CLOUD_USER_ID` with the signed-in user’s id (e.g. `auth.uid()` in policies; client sends row only for self).
2. Enable **RLS** on `user_settings`; remove broad anon writes.
3. Optionally add `profiles` or use `auth.users` metadata; link `sleep_days` to `user_id` when moving beyond single-tenant anon.
4. Revisit migration flag: may become per-user or unnecessary once each user has their own row.

---

## Related symbols (quick index)

- Gate: `loadSleepDataUsesSupabase`, `isSleepDataForcedLocal`, `getSleepDataCacheKey`.
- Hydrate: `ensureUserSettingsFromCloud`, `chainSleepDataWithUserSettingsHydrate`, `refreshUiAfterUserSettingsHydrate`, `resetUserSettingsCloudHydration`.
- Cloud row: `RESTORE_CLOUD_USER_ID`, `USER_SETTINGS_CLOUD_MIGRATION_DONE_KEY`, `isSeedDefaultUserSettingsRow`, `localUserSettingsDiffersFromSeedDefaults`.
