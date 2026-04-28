# Dev banner and app-time controls

Reference for the development banner in the shared nav, including when it appears, what it renders, and how simulated app time affects logic. Implementation lives primarily in `sleep-utils.js` with styling in `styles.css`.

---

## Architecture (flow)

The banner setup has four layers:

1. **Visibility gate**: `isDevBuildContext()` decides whether banner logic is active.
2. **Render layer**: `renderNavBar()` builds banner HTML (warnings, links, clock controls).
3. **Interaction layer**: init functions bind controls (`initDevClockControl`, `initDevBannerCloudRefresh`, `initDevBannerDbSwitchFlip`, `initDevBannerDrawer`).
4. **Layout reserve**: `syncDevBannerFixedLayout()` keeps fixed banner from overlapping content.

---

## Layer 1 - visibility gate

`isDevBuildContext()` resolves in strict order:

1. URL query override:
   - `?devBanner=1` forces ON
   - `?devBanner=0` forces OFF
2. Local override key `sleep-app-force-dev-banner`:
   - `'1'` forces ON
   - `'0'` forces OFF
3. Host check (`isLocalDevHost(hostname)`) -> ON when local dev host.
4. Build-id mismatch check:
   - compares `<html data-build-id="...">` vs `<html data-prod-build-id="...">`
   - mismatch -> ON
5. Otherwise OFF.

This gate is reused by drawer/clock/refresh bindings and by app-time override reads.

---

## Layer 2 - rendered banner content

When visible, `renderNavBar()` calls `ensureDevSupabasePresetApplied()` first (dev context only: if `sleep-app-active-supabase-preset` is `dev` or `prod` and presets are valid, syncs `restore_supabase_*` from the preset without redundant writes), then prepends the fixed `.nav-dev-banner` above nav header/tabs.

Main content blocks:

- **Badges row** (`nav-dev-banner-badges-row`): one flex line in order **GitHub**, **Supabase**, **Vercel + deployment**, **app time**. **GitHub** (`nav-dev-banner-github-badge`): GitHub mark + **github**; value = git-branch icon + branch from `window.__DEV_GIT_BRANCH__` (**passing** green when branch set and not `master`, **failing** red on `master`, **unknown** gray otherwise). **Supabase** (`nav-dev-banner-supabase-badge`): mark + **supabase**; value **dev** / **prod** / **n/a** / **unknown** with the same green/red/gray rules as before. **Vercel** (`nav-dev-banner-vercel-badge`): single flat badge; whole control links to **`DEV_VERCEL_PROJECT_URL`**. Left: Vercel triangle SVG + **vercel**. Right: `#nav-dev-banner-vercel-deploy-status` shows GitHub **Production** deployment **message** (e.g. success) from live [Shields JSON](https://img.shields.io/github/deployments/rsairu/sleep/Production.json) (same data as the shields image; not nested `<img>`). `#nav-dev-banner-vercel-deploy-value` gets `--passing` / `--failing` / `--unknown` from `vercelDeployBadgeToneFromShields()` (maps Shields `color` / `message` / `isError`). **App time** (`nav-dev-banner-apptime-badge`, not a link): clock SVG + **app time**; value **real** / **sim** as before. `#nav-dev-banner-apptime-badge-value` carries `role="status"` and `aria-live="polite"`.
- **Cloud row** (`nav-dev-banner-cloud-row`): when `local-supabase-presets.js` is valid, **Switch DB** (`#nav-dev-banner-db-switch-toggle`) flips dev ↔ prod; **Sync with cloud** (`#nav-dev-banner-cloud-refresh-btn`) runs `loadSleepData({ forceRefresh: true })` then reloads; disabled when Supabase is not configured.
- **Warnings**:
  - Supabase URL includes prod ref (`lsaguxfovamihwnicpkk`) -> red warning; copy uses 🛑 and class `nav-dev-banner-prod-warning--prod-data` (uppercase, inset strip) at the same `0.7rem` as other warning lines.
  - Branch is `master` -> branch warning (⚠️, base `nav-dev-banner-prod-warning` only).
- **App time (right column)**: `#nav-dev-banner-clock` holds the time panel (`#nav-dev-banner-clock-sim-panel`): `datetime-local` (`#nav-dev-banner-dev-clock-input`), then one toolbar row (`nav-dev-banner-clock-step-toolbar`) with **seven** controls in order: previous day, minus hour, minus minute, **clock reset** (`#nav-dev-banner-clock-reset-real-btn`, wider button with clock SVG, between back and forward steps), plus minute, plus hour, next day; reset clears `sleep-app-dev-clock-override-ms` and reloads when an override exists. Editing the datetime or using steps persists override (reload) so the badge value becomes **sim**.
- **User / settings (dev)** (below the main row, inside the drawer):
  - Header: one inline line (`nav-dev-banner-user-panel-title-line`, `flex-wrap: wrap`, `align-items: center`) reading **UUID** (`<span class="nav-dev-banner-user-panel-title">`), then `RESTORE_CLOUD_USER_ID` in `<code class="nav-dev-banner-user-id nav-dev-banner-user-id--inline">` (`title` explains user_settings primary key / cloud tenant; same value as `user_settings.user_id` and sleep row `user_id` in JS), then **Use all default settings** (`#nav-dev-banner-user-use-default`, class `nav-dev-banner-user-defaults-btn`, verbose `aria-label` describing the full reset). The button calls `applyDevBannerUserSettingsDefaults()` to reset language (`en`), clock (`24h`), theme (auto), palette (auto), remaining-wake thresholds (35% / 15%), heads-up (`30` min), **Tonight target** (clears `sleep-app-tonight-target-window` via `clearTonightTargetWindow()`), **Tonight guidance** (removes per-pole `sleep-app-tonight-guidance-sleep-enabled`, `sleep-app-tonight-guidance-wake-enabled`, legacy `sleep-app-tonight-guidance-enabled` if present, and `sleep-app-tonight-guidance-pace`), then refreshes i18n, theme, palette, config remaining-wake UI if present, nav remaining-wake, and the dev-banner panel.
  - The panel body (`nav-dev-banner-user-settings`, `gap: 8px`) starts with one **prefs + tips** row (`nav-dev-banner-user-settings-row--prefs-grid`): four selects only (no column text labels)—**Language** (`#nav-dev-banner-user-lang`), **Clock** (`#nav-dev-banner-user-clock`), **Theme** (`#nav-dev-banner-user-theme`; auto option reads **Auto (theme)**), **Palette** (`#nav-dev-banner-user-palette`; auto option reads **Auto (palette)**)—then inline **In-app tips** (`nav-dev-banner-in-app-tips`): plain label **Tips** (`nav-dev-banner-tips-label`), checkboxes **All** / **Quick** / **Tonight** (`#nav-dev-banner-hint-all`, `#nav-dev-banner-hint-quick`, `#nav-dev-banner-hint-tonight`) wired like Settings (`getHintQuickActionsAbout` / `getHintTonightAbout`; **All** checked only when both are on). Pref columns use `aria-label` on each control. The row uses `flex-wrap: nowrap` and `overflow-x: auto` when narrow. Then **`nav-dev-banner-user-chunks-row`** places **Tonight** and **Remaining time** side by side when width allows.
  - On **Settings** / **About**, the phase-change heads-up slider’s **30 min** tick shows a read-only **Default** pill (not a button); choose 30 on the slider to match the default (the dev banner labels that duration **30m**).
  - **Tonight** chunk (Dashboard wording): `nav-dev-banner-user-chunk nav-dev-banner-user-chunk--tonight` with section heading `#nav-dev-banner-tonight-heading` (`nav-dev-banner-user-chunk-heading`, copy **Tonight**). Inner row `nav-dev-banner-user-settings-row--prefs-grid nav-dev-banner-user-settings-row--night-grid` holds **Sleep** / **Wake** (`input[type=time]`, `#nav-dev-banner-tonight-sleep`, `#nav-dev-banner-tonight-wake`, class `nav-dev-banner-user-input-time`), **Sleep G** (`#nav-dev-banner-tonight-guidance-sleep-enabled`, Off/On), **Wake G** (`#nav-dev-banner-tonight-guidance-wake-enabled`, Off/On), and **Pace** (`#nav-dev-banner-tonight-guidance-pace`). The inner row uses `flex-wrap: wrap` and `overflow-x: visible` so fields wrap instead of widening the drawer. **Sleep / wake semantics**: an empty time field means there is **no explicit target** for that pole—the app follows **recent averages** for that side. A filled value is a **stored tonight target** for that pole. Either pole may be set alone or together; clearing both removes the saved window (`sleep-app-tonight-target-window`). If a saved target exists and one field is left incomplete on blur, those inputs re-sync from storage. Pace options display **6m**, **10m**, **15m** (stored values `gentle`, `normal`, `steady`).
  - **Remaining time** chunk: `nav-dev-banner-user-chunk--remaining` (sibling under `nav-dev-banner-user-chunks-row`) wraps `nav-dev-banner-user-remaining-time` (`role="group"`, `aria-labelledby="nav-dev-banner-remaining-time-heading"`). Heading **Remaining time** (`nav-dev-banner-user-remaining-time-heading`, `#nav-dev-banner-remaining-time-heading`) with `border-bottom`; under it, **Winding** / **Pre-sleep** / **Heads-up** in `nav-dev-banner-user-remaining-time-controls` (plain labels, no emoji). Winding and pre-sleep mirror `remaining_wake_open_min` and `remaining_wake_winding_min`. **Heads-up** is `remaining_wake_phase_heads_up_mins`; the select shows **60m**, **45m**, **30m**, **15m**, **Off**. Each control uses `nav-dev-banner-user-field--col`. Panel copy uses the same inherited font size as the branch row (`0.75rem` on `nav-dev-banner-user-panel`). Pref `<select>` and time inputs stay content-sized (`width: max-content`, `min-width: 0` on pref rows).
  - Tonight and remaining-time controls use the same preference setters and `syncUserSettingsRowToCloud()` as Settings when cloud sleep data is active. **Tonight guidance** mirrors `getTonightGuidanceSleepEnabled` / `setTonightGuidanceSleepEnabled`, `getTonightGuidanceWakeEnabled` / `setTonightGuidanceWakeEnabled`, and `getTonightGuidancePaceId` / `setTonightGuidancePaceId` (`sleep-app-tonight-guidance-sleep-enabled`, `sleep-app-tonight-guidance-wake-enabled`, `sleep-app-tonight-guidance-pace`); updates sync to `user_settings`, dispatch `tonight-guidance-changed`, and refresh the dev-banner panel.

Banner background class:

- `nav-dev-banner--db-dev` default
- `nav-dev-banner--db-prod` when prod Supabase or `master` warning state is active

---

## Layer 3 - interactivity and persistence

### Simulated app clock

- Key: `sleep-app-dev-clock-override-ms` (`DEV_CLOCK_OVERRIDE_MS_KEY`).
- `readDevClockOverrideMs()` returns epoch ms only in dev context; otherwise `null`.
- `getAppNowMs()` returns override ms if present, else `Date.now()`.
- `getAppDate()` is the canonical "app now" `Date`.

Behavior:

- Changing `datetime-local` or using step buttons persists override and reloads.
- **Clock reset** (`#nav-dev-banner-clock-reset-real-btn`, in the step toolbar) removes override and reloads when override is set.
- `initDevClockControl()` updates the app-time badge text and `--passing` / `--failing` classes via `setModeUi()` when the user edits the datetime input before commit (live preview).
- `input[type=datetime-local]` is seeded from `getAppDate()`.

Important: app logic should use `getAppNowMs()` / `getAppDate()` when it must honor simulation.

### Drawer state

- Key: `sleep-app-dev-banner-drawer-collapsed` (`'1'` means collapsed).
- Pointer drag and click/tap are both supported.
- Swipe thresholds:
  - drag start threshold: 10px
  - collapse/expand commit threshold: 40px

### Layout reserve cache

- Key: `sleep-app-dev-banner-expanded-reserve-px` stores the last measured **expanded** drawer height (used while the drawer is opening so `padding-top` does not lag behind the animating banner).
- `syncDevBannerFixedLayout()` sets `.nav-wrapper` `padding-top` to the current banner height (collapsed strip when the drawer is closed, full height when open) plus banner margin.

### User settings panel (dev)

- Root: `#nav-dev-banner-user-panel` inside `#nav-dev-banner-drawer`.
- `updateDevBannerUserSettingsPanel()` syncs control state from `localStorage` / getters (also called from `refreshUiAfterUserSettingsHydrate()` after cloud preference hydrate).
- `initDevBannerUserSettingsPanel()` binds once per page (`window.__devBannerUserSettingsBound`); registered from `initDayNightTheme()` with other dev-banner inits.
- `applyDevBannerUserSettingsDefaults()` resets the mirrored preferences to the same defaults as a fresh install / Settings reset path; invoked from **Use all default settings** in the panel header (`#nav-dev-banner-user-use-default`).

### Supabase dev/prod presets (local file)

- Optional script `local-supabase-presets.js` (gitignored; copy from `local-supabase-presets.example.js`) sets `window.__RESTORE_SUPABASE_PRESETS__` with `dev` and `prod` objects, each `{ url, anonKey }` (all four strings required for **Switch DB** to appear).
- Key: `sleep-app-active-supabase-preset` (`ACTIVE_SUPABASE_PRESET_KEY`) — `dev` or `prod` selects preset mode; empty means custom credentials from Settings only.
- **Switch DB** sets the key to the flipped target, calls `setSupabaseConfig` with that pair, and reloads. While preset mode is active, `ensureDevSupabasePresetApplied()` keeps `restore_supabase_*` aligned on each page load.
- `initDevBannerDbSwitchFlip()` binds `#nav-dev-banner-db-switch-toggle` only. Flip uses `isDevBannerSupabaseEffectiveDev()` (same resolution as the badge: storage id, else URL match to dev/prod; unresolved counts as non-dev so the next flip chooses **dev**).
- `getSupabaseBannerBadgeModel()` drives the Supabase shields badge: **n/a** when presets are missing; else resolves active id from storage or by matching current `getSupabaseConfig().url` to the dev/prod pair.
- `initDevBannerVercelDeployStatus()` → `hydrateDevBannerVercelDeployStatus()` fetches `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON` after nav render (from `initDayNightTheme`) and fills `#nav-dev-banner-vercel-deploy-status` plus value strip tone classes.
- Saving or clearing Supabase credentials in **Settings** clears `sleep-app-active-supabase-preset` so manual config is not overwritten on the next navigation.

---

## Layer 4 - fixed layout and motion

The banner is `position: fixed` in `styles.css`, so `syncDevBannerFixedLayout()` is required after:

- initial render (including double-RAF in dev),
- drawer toggles,
- resize.

During transitions:

- `data-dev-banner-drawer-toggled-at` marks a short window (~380ms) after a toggle; while the drawer is **opening**, padding can follow the cached expanded height until live layout catches up. While **closing**, padding follows the live shrinking banner height.
- `measureDevBannerExpandedHeightPx()` temporarily measures expanded state with drawer transitions disabled (seeds the expanded cache when missing).

---

## Keys and constants

| Identifier | Value | Meaning |
|------------|-------|---------|
| `DEV_BANNER_OVERRIDE_KEY` | `sleep-app-force-dev-banner` | Force banner on/off (`'1'`/`'0'`) unless URL override provided |
| `DEV_CLOCK_OVERRIDE_MS_KEY` | `sleep-app-dev-clock-override-ms` | Simulated app wall-clock epoch ms |
| `DEV_BANNER_DRAWER_COLLAPSED_KEY` | `sleep-app-dev-banner-drawer-collapsed` | Persist collapsed drawer state |
| `DEV_BANNER_EXPANDED_RESERVE_KEY` | `sleep-app-dev-banner-expanded-reserve-px` | Cached expanded drawer height (expand animation + remeasure when open) |
| `TONIGHT_TARGET_WINDOW_KEY` | `sleep-app-tonight-target-window` | Saved tonight sleep and/or wake targets (JSON); same as dashboard Tonight save actions |
| `TONIGHT_GUIDANCE_SLEEP_ENABLED_KEY` | `sleep-app-tonight-guidance-sleep-enabled` | `'1'` when sleep-target guidance is on (`user_settings.tonight_guidance_sleep_enabled`) |
| `TONIGHT_GUIDANCE_WAKE_ENABLED_KEY` | `sleep-app-tonight-guidance-wake-enabled` | `'1'` when wake-target guidance is on (`user_settings.tonight_guidance_wake_enabled`) |
| `TONIGHT_GUIDANCE_PACE_KEY` | `sleep-app-tonight-guidance-pace` | `gentle` / `normal` / `steady` (mirror of `user_settings.tonight_guidance_pace`; dev banner options read **6m** / **10m** / **15m**) |
| `ACTIVE_SUPABASE_PRESET_KEY` | `sleep-app-active-supabase-preset` | `dev` / `prod` preset mode for local `local-supabase-presets.js`; empty = custom |
| `SUPABASE_PROJECT_REF_PROD` | `lsaguxfovamihwnicpkk` | Marks production DB context |
| `SUPABASE_PROJECT_REF_DEV` | `pjpzxkyflmzzbfdkujan` | Default dev dashboard target |
| `DEV_VERCEL_PROJECT_URL` | `https://vercel.com/rsairu-5429s-projects/sleep` | Vercel + deployment composite badge link target |
| `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_BASE` | `https://img.shields.io/github/deployments/rsairu/sleep/Production` | Shields URL base; append `.json` for API |
| `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON` | base + `.json` | Fetched after nav render for Vercel badge value + tone |

---

## Source map

| Concept | Primary location |
|--------|-------------------|
| Visibility gate and override precedence | `isDevBuildContext` - `sleep-utils.js` |
| App time override read/accessors | `readDevClockOverrideMs`, `getAppNowMs`, `getAppDate` - `sleep-utils.js` |
| Banner markup and warnings | `renderNavBar` - `sleep-utils.js` |
| Clock mode + datetime/step controls | `initDevClockControl` - `sleep-utils.js` |
| Cloud sync button | `initDevBannerCloudRefresh` - `sleep-utils.js` |
| Supabase badge + Switch DB flip | `getSupabaseBannerBadgeModel`, `isDevBannerSupabaseEffectiveDev`, `initDevBannerDbSwitchFlip`, `readLocalSupabasePresets`, `ensureDevSupabasePresetApplied` - `sleep-utils.js` |
| Vercel deployment badge (JSON hydrate) | `DEV_VERCEL_PROJECT_URL`, `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON`, `hydrateDevBannerVercelDeployStatus`, `initDevBannerVercelDeployStatus`, `renderNavBar` - `sleep-utils.js` |
| Drawer pointer/click behavior | `initDevBannerDrawer` - `sleep-utils.js` |
| Expanded reserve measurement/caching | `measureDevBannerExpandedHeightPx`, `syncDevBannerFixedLayout` - `sleep-utils.js` |
| User settings defaults (dev panel) | `applyDevBannerUserSettingsDefaults`, `initDevBannerUserSettingsPanel` - `sleep-utils.js` |
| Branch stamp source | `scripts/stamp-dev-branch.js` -> `dev-git-branch.js` |
| Banner visual system and responsive behavior | `.nav-dev-banner*` selectors in `styles.css` |

---

## Change checklist (keep doc in sync)

Update this doc when you change:

- dev-banner visibility conditions or override precedence,
- any of the localStorage keys in the table above (including preset mode),
- app-time simulation behavior (reload rules, controls, IDs, real vs simulated status copy),
- drawer drag thresholds or collapse persistence behavior,
- fixed layout reserve strategy (`syncDevBannerFixedLayout`),
- prod/dev warning conditions or banner background-class rules,
- badges row (GitHub / Supabase / Vercel JSON deployment status / app time), cloud row actions, or right-column clock panel IDs and copy,
- dev user panel chunk layout, Tonight / Remaining time row, header reset button copy, or compact **m** minute labels on pace / heads-up selects.
