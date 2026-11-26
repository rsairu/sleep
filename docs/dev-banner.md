# Dev banner and app-time controls

Reference for the development banner in the shared nav, including when it appears, what it renders, and how simulated app time affects logic. Implementation lives primarily in `src/lib/sleep-utils.js` with styling in `src/styles/styles.css`.

---

## Architecture (flow)

The banner setup has four layers:

1. **Visibility gate**: `isDevBuildContext()` decides whether banner logic is active.
2. **Render layer**: `renderNavBar()` builds banner HTML (badges, links, clock controls, user panel).
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

- **Badges row** (`nav-dev-banner-badges-row`): one flex line in order **GitHub**, **Vercel + deployment**, **app time**. **GitHub** (`nav-dev-banner-github-badge`): GitHub mark + **github**; value = git-branch icon + branch from `window.__DEV_GIT_BRANCH__` (**passing** green when branch set and not `master`, **failing** red on `master`, **unknown** gray otherwise). **Vercel** (`nav-dev-banner-vercel-badge`): single flat badge; whole control links to **`DEV_VERCEL_PROJECT_URL`**. Left: Vercel triangle SVG + **vercel**. Right: `#nav-dev-banner-vercel-deploy-status` shows **pass** or **fail** (display via `formatVercelDeployDisplayLabel()` from Shields JSON tone; Shields `message` e.g. success maps to **pass**). Data from live [Shields JSON](https://img.shields.io/github/deployments/rsairu/sleep/Production.json). When the resolved tone is **passing**, `writeVercelDeployShieldsPassCache()` stores an expiry (`VERCEL_DEPLOY_SHIELDS_PASS_CACHE_MS`, 30 minutes); while valid, `readVercelDeployShieldsPassCache()` skips the network fetch and keeps showing **pass**. Non-passing or fetch errors clear the cache (`clearVercelDeployShieldsPassCache()`). **App time** (`nav-dev-banner-apptime-badge`, not a link): clock SVG + **app time**; value **real** (green, `--passing`) or **sim** (red, `--failing`). `#nav-dev-banner-apptime-badge-value` carries `role="status"` and `aria-live="polite"`.
- **Cloud row** (`nav-dev-banner-cloud-row`): one flex line in order **Supabase** (`nav-dev-banner-supabase-badge`), **Switch DB** (`#nav-dev-banner-db-switch-toggle`, emoji-only control with full `aria-label` / title), **Sync with cloud** (`#nav-dev-banner-cloud-refresh-btn`, emoji-only), **Copy prod → dev** (`#nav-dev-banner-supabase-sync-btn`, emoji-only; see *Prod → dev sync button* below). **Supabase**: mark + **supabase**; value **dev** (green), **prod** (red), or **n/a** / **unknown** (gray); links to the Supabase dashboard. **Switch DB** always renders. When `local/local-supabase-presets.js` is valid it flips dev ↔ prod; when presets are missing/invalid it is disabled (grayed) and shows tooltip text **"Please see local-supabase-presets.example.js"**. **Sync with cloud** runs `loadSleepData({ forceRefresh: true })` then reloads; disabled when Supabase is not configured. **Copy prod → dev** dispatches the *Sync Supabase dev from prod* GitHub Action; disabled with tooltip **"Please see local-github-dispatch.example.js"** when no local token is present.
- **Alert background (no inline warning copy)**: when Supabase is treated as production (`getDevBannerSupabaseDbClass()` → `nav-dev-banner--db-prod` because the configured URL matches prod ref `lsaguxfovamihwnicpkk`) **or** the git branch is `master` (`isDevGitBranchMaster()`), the banner uses **`nav-dev-banner--db-prod`** (muted red) — same rule set as the **failing** GitHub / Supabase shields. There are no separate “prod data” / “master branch” text rows under **DEV BUILD** (no dashed rule row).
- **App time (right column)**: `#nav-dev-banner-clock` holds the time panel (`#nav-dev-banner-clock-sim-panel`): `datetime-local` (`#nav-dev-banner-dev-clock-input`), then one toolbar row (`nav-dev-banner-clock-step-toolbar`, same width as the input row via flex-filling buttons) with **nine** controls in order: previous day, minus one hour (triple chevron), minus five minutes (double chevron), minus one minute, **clock reset** (`#nav-dev-banner-clock-reset-real-btn`, slightly wider than step buttons, clock SVG), plus one minute, plus five minutes, plus one hour (triple chevron), next day; reset clears `sleep-app-dev-clock-override-ms` and reloads when an override exists. Editing the datetime or using steps persists override (reload) so the badge value becomes **sim**.
- **User / settings (dev)** (below the main row, inside the drawer):
  - Header: one inline line (`nav-dev-banner-user-panel-title-line`): **UUID**, `RESTORE_CLOUD_USER_ID` in `<code class="nav-dev-banner-user-id nav-dev-banner-user-id--inline">`, **Use all default settings** (`#nav-dev-banner-user-use-default`), and **Tips** (`nav-dev-banner-in-app-tips--header`: label **Tips** + checkboxes **All** / **Quick** / **Tonight**). The button calls `applyDevBannerUserSettingsDefaults()`, which resets language (`en`), clock (`24h`), theme (Auto), palette (Auto), remaining-wake thresholds (35 / 15) and heads-up (30m); clears the Tonight target, both guidance toggles and the pace; shows both dashboard tips again; and sets Phase colors back to banner. It then re-applies i18n, palette, phase colors and the remaining-wake nav, refreshes the panel, and syncs `user_settings`.
  - **Row 1 — prefs** (`nav-dev-banner-user-settings-row--prefs-grid`): **Language**, **Clock**, **Theme** (`#nav-dev-banner-user-theme`; first option **Auto theme**), **Palette** (`#nav-dev-banner-user-palette`; **Auto palette** first, then Meadow, Harbor), **Phase colors** (`#nav-dev-banner-user-phase-colors`; **Banner (default)** / **Wallpaper (full page)**; see *Phase colors* below). No column labels; `aria-label` on each control. `flex-wrap: nowrap` + horizontal scroll when narrow.
  - **Row 2 — secondary** (`nav-dev-banner-user-settings-row--night-grid nav-dev-banner-user-settings-row--secondary`): **Sleep target** / **Wake target** times, **Sleep G** / **Wake G** / **Pace**, then **Winding %** (`#nav-dev-banner-rw-open`), **Pre-sleep %** (`#nav-dev-banner-rw-winding`), **Heads-up** (`#nav-dev-banner-rw-heads-up`). Wraps when narrow; winding/pre-sleep labels carry **%**; no extra **%** glyph beside inputs. Semantics unchanged for tonight targets and `remaining_wake_*` / heads-up.
  - On **Settings** / **About**, the phase-change heads-up slider’s **30 min** tick shows a read-only **Default** pill (not a button); choose 30 on the slider to match the default (the dev banner labels that duration **30m**).
  - Tonight + remaining-wake controls use the same preference setters and `syncUserSettingsRowToCloud()` as Settings when cloud sleep data is active. **Tonight guidance** mirrors `getTonightGuidanceSleepEnabled` / `setTonightGuidanceSleepEnabled`, `getTonightGuidanceWakeEnabled` / `setTonightGuidanceWakeEnabled`, and `getTonightGuidancePaceId` / `setTonightGuidancePaceId` (`sleep-app-tonight-guidance-sleep-enabled`, `sleep-app-tonight-guidance-wake-enabled`, `sleep-app-tonight-guidance-pace`); updates sync to `user_settings`, dispatch `tonight-guidance-changed`, and refresh the dev-banner panel.

Banner background class:

- `nav-dev-banner--db-dev` default
- `nav-dev-banner--db-prod` when Supabase URL matches prod ref **or** current git branch is **master** (aligned with “failing” shields; no extra warning paragraphs)

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
- `applyDevBannerUserSettingsDefaults()` resets the preferences listed under *User / settings (dev)* above to fresh-install defaults; invoked from **Use all default settings** in the panel header (`#nav-dev-banner-user-use-default`).

### Phase colors (banner / wallpaper)

The **Phase colors** dropdown (`#nav-dev-banner-user-phase-colors`: **Banner (default)** / **Wallpaper (full page)**) mirrors the Settings control through `getPhaseWallpaperEnabled()` / `setPhaseWallpaperEnabled()`, so it syncs to `user_settings` like the other mirrored prefs. **Use all default settings** resets it to banner. How the wallpaper renders: [remaining-wake.md § Phase colors](remaining-wake.md#phase-colors-top-banner-vs-wallpaper).

### Supabase dev/prod presets (local file)

- Optional script `local/local-supabase-presets.js` (gitignored; copy from `local/local-supabase-presets.example.js`; Vite serves it as `/local-supabase-presets.js`) sets `window.__RESTORE_SUPABASE_PRESETS__` with `dev` and `prod` objects, each `{ url, anonKey }` (all four strings required for **Switch DB** to be enabled).
- Key: `sleep-app-active-supabase-preset` (`ACTIVE_SUPABASE_PRESET_KEY`) — `dev` or `prod` selects preset mode; empty means custom credentials from Settings only.
- **Switch DB** sets the key to the flipped target, calls `setSupabaseConfig` with that pair, and reloads. While preset mode is active, `ensureDevSupabasePresetApplied()` keeps `restore_supabase_*` aligned on each page load.
- `initDevBannerDbSwitchFlip()` checks `#nav-dev-banner-db-switch-toggle` on bind. If presets are missing, the control stays disabled and exposes the same tooltip/help text; if presets are valid, flip uses `isDevBannerSupabaseEffectiveDev()` (same resolution as the badge: storage id, else URL match to dev/prod; unresolved counts as non-dev so the next flip chooses **dev**).
- `getSupabaseBannerBadgeModel()` drives the Supabase shields badge: **n/a** when presets are missing; else resolves active id from storage or by matching current `getSupabaseConfig().url` to the dev/prod pair.
- `initDevBannerVercelDeployStatus()` → `hydrateDevBannerVercelDeployStatus()` loads the Vercel badge: if `readVercelDeployShieldsPassCache()` (30 min after last **passing** Shields response) is valid, applies **pass** without `fetch`; otherwise fetches `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON`, applies **pass** / **fail** / **n/a** via `applyVercelDeployBadgeUI()`, and on **passing** calls `writeVercelDeployShieldsPassCache()`; on non-pass or error clears pass cache / shows **n/a**.
- Saving or clearing Supabase credentials in **Settings** clears `sleep-app-active-supabase-preset` so manual config is not overwritten on the next navigation.

### Prod → dev sync button (GitHub Action)

- Optional script `local/local-github-dispatch.js` (gitignored; copy from `local/local-github-dispatch.example.js`; served as `/local-github-dispatch.js`) sets `window.__RESTORE_GITHUB_DISPATCH__ = { token, ref? }`. `readLocalGithubDispatchConfig()` returns `null` when the token is empty; `ref` defaults to `SUPABASE_SYNC_WORKFLOW_DEFAULT_REF` (`master`). Token: fine-grained PAT, this repo only, **Actions: Read and write**.
- Click (idle / success / failure) → `window.confirm` (dev data will be replaced) → `startDevSupabaseSync()`: reads the latest `workflow_dispatch` run id (`prevTopId`), then `POST /repos/rsairu/sleep/actions/workflows/sync-supabase-dev-from-prod-v2.yml/dispatches` with `{ ref }`.
- `pollDevSupabaseSyncRun()` runs every `SUPABASE_SYNC_POLL_MS` (5 s): first finds our run (latest run whose id ≠ `prevTopId`; gives up after `SUPABASE_SYNC_FIND_TIMEOUT_MS`), then follows `GET /actions/runs/{id}` until `status === 'completed'`. Stops tracking after `SUPABASE_SYNC_RUN_TIMEOUT_MS` (15 min). HTTP errors end tracking with a short reason (401 / 403 / 404 / 422); network errors retry.
- The in-flight run is persisted in `SUPABASE_SYNC_RUN_KEY` so a full reload (e.g. **Sync with cloud**) resumes tracking; UI state lives in module scope (`devSupabaseSyncUi`) so SPA nav re-renders keep it. `spa-app.js` resets `window.__devBannerSupabaseSyncBound` with the other bind flags.
- Icon / state (`getDevSupabaseSyncButtonModel()`, used by `renderNavBar` and `applyDevSupabaseSyncButtonUi()`): 📥 idle, ⏳ running (`nav-dev-banner-supabase-sync--running`, pulsing icon; click opens the run on GitHub once known), ✅ success (title says to press **Sync with cloud** to load fresh dev data), ❌ failure (reason in title). Success / failure last until the next full page load or the next click.
- The button does not reload data itself; it only triggers and tracks the workflow. Workflow behavior: `docs/supabase-dev-sync.md`.

---

## Layer 4 - fixed layout and motion

The banner is `position: fixed` in `src/styles/styles.css`, so `syncDevBannerFixedLayout()` is required after:

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
| `PHASE_WALLPAPER_KEY` | `sleep-app-phase-wallpaper` | `'1'` = phase wallpaper on; mirrors `user_settings.phase_wallpaper` (dev Phase colors dropdown and Settings → Phase colors) |
| `TONIGHT_TARGET_WINDOW_KEY` | `sleep-app-tonight-target-window` | Saved tonight sleep and/or wake targets (JSON); same as dashboard Tonight save actions |
| `TONIGHT_GUIDANCE_SLEEP_ENABLED_KEY` | `sleep-app-tonight-guidance-sleep-enabled` | `'1'` when sleep-target guidance is on (`user_settings.tonight_guidance_sleep_enabled`) |
| `TONIGHT_GUIDANCE_WAKE_ENABLED_KEY` | `sleep-app-tonight-guidance-wake-enabled` | `'1'` when wake-target guidance is on (`user_settings.tonight_guidance_wake_enabled`) |
| `TONIGHT_GUIDANCE_PACE_KEY` | `sleep-app-tonight-guidance-pace` | `gentle` / `normal` / `steady` (mirror of `user_settings.tonight_guidance_pace`; dev banner options read **6m** / **10m** / **15m**) |
| `ACTIVE_SUPABASE_PRESET_KEY` | `sleep-app-active-supabase-preset` | `dev` / `prod` preset mode for `local/local-supabase-presets.js`; empty = custom |
| `SUPABASE_PROJECT_REF_PROD` | `lsaguxfovamihwnicpkk` | Marks production DB context |
| `SUPABASE_PROJECT_REF_DEV` | `pjpzxkyflmzzbfdkujan` | Default dev dashboard target |
| `DEV_VERCEL_PROJECT_URL` | `https://vercel.com/rsairu-5429s-projects/sleep` | Vercel + deployment composite badge link target |
| `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_BASE` | `https://img.shields.io/github/deployments/rsairu/sleep/Production` | Shields URL base; append `.json` for API |
| `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON` | base + `.json` | Fetched after nav render for Vercel badge value + tone (skipped when pass cache valid) |
| `VERCEL_DEPLOY_SHIELDS_PASS_CACHE_KEY` | `sleep-app-vercel-deploy-shields-pass-cache` | `localStorage` JSON `{ expiresAt }` after a **passing** Shields check |
| `VERCEL_DEPLOY_SHIELDS_PASS_CACHE_MS` | `1800000` (30 min) | Do not re-fetch Shields JSON while pass cache is valid |
| `GITHUB_REPO_SLUG` | `rsairu/sleep` | Repo for the GitHub Actions API calls |
| `SUPABASE_SYNC_WORKFLOW_FILE` | `sync-supabase-dev-from-prod-v2.yml` | Workflow dispatched by **Copy prod → dev** |
| `SUPABASE_SYNC_WORKFLOW_DEFAULT_REF` | `master` | Dispatch ref when `local/local-github-dispatch.js` sets none |
| `SUPABASE_SYNC_RUN_KEY` | `sleep-app-dev-supabase-sync-run` | `localStorage` JSON `{ startedAt, prevTopId, runId, htmlUrl }` for the in-flight run |
| `SUPABASE_SYNC_POLL_MS` | `5000` | Poll interval while a run is tracked |
| `SUPABASE_SYNC_FIND_TIMEOUT_MS` | `120000` (2 min) | Give up if the dispatched run never appears |
| `SUPABASE_SYNC_RUN_TIMEOUT_MS` | `900000` (15 min) | Stop tracking a run after this long |

---

## Source map

| Concept | Primary location |
|--------|-------------------|
| Visibility gate and override precedence | `isDevBuildContext` - `src/lib/sleep-utils.js` |
| App time override read/accessors | `readDevClockOverrideMs`, `getAppNowMs`, `getAppDate` - `src/lib/sleep-utils.js` |
| Banner markup | `renderNavBar` - `src/lib/sleep-utils.js` |
| Clock mode + datetime/step controls | `initDevClockControl` - `src/lib/sleep-utils.js` |
| Cloud sync button | `initDevBannerCloudRefresh` - `src/lib/sleep-utils.js` |
| Supabase badge + Switch DB flip | `getSupabaseBannerBadgeModel`, `isDevBannerSupabaseEffectiveDev`, `initDevBannerDbSwitchFlip`, `readLocalSupabasePresets`, `ensureDevSupabasePresetApplied` - `src/lib/sleep-utils.js` |
| Vercel deployment badge (JSON + pass cache) | `DEV_VERCEL_PROJECT_URL`, `SHIELDS_GITHUB_DEPLOYMENTS_PRODUCTION_JSON`, `VERCEL_DEPLOY_SHIELDS_PASS_CACHE_*`, `hydrateDevBannerVercelDeployStatus`, `initDevBannerVercelDeployStatus`, `renderNavBar` - `src/lib/sleep-utils.js` |
| Prod → dev sync button | `readLocalGithubDispatchConfig`, `getDevSupabaseSyncButtonModel`, `applyDevSupabaseSyncButtonUi`, `startDevSupabaseSync`, `pollDevSupabaseSyncRun`, `initDevBannerSupabaseSync` - `src/lib/sleep-utils.js`; token file `local/local-github-dispatch.js` |
| Drawer pointer/click behavior | `initDevBannerDrawer` - `src/lib/sleep-utils.js` |
| Expanded reserve measurement/caching | `measureDevBannerExpandedHeightPx`, `syncDevBannerFixedLayout` - `src/lib/sleep-utils.js` |
| Phase colors dropdown | `initDevBannerUserSettingsPanel`, `updateDevBannerUserSettingsPanel` - `src/lib/sleep-utils.js`; rendering in [remaining-wake.md](remaining-wake.md) |
| User settings defaults (dev panel) | `applyDevBannerUserSettingsDefaults`, `initDevBannerUserSettingsPanel` - `src/lib/sleep-utils.js` |
| Branch stamp source | `local/stamp-dev-branch.js` -> `local/dev-git-branch.js` |
| Banner visual system and responsive behavior | `.nav-dev-banner*` selectors in `src/styles/styles.css` |

---

## Change checklist (keep doc in sync)

Update this doc when you change:

- dev-banner visibility conditions or override precedence,
- any of the localStorage keys in the table above (including preset mode),
- app-time simulation behavior (reload rules, controls, IDs, real vs simulated status copy),
- drawer drag thresholds or collapse persistence behavior,
- fixed layout reserve strategy (`syncDevBannerFixedLayout`),
- prod/dev banner background-class rules (no separate warning copy rows),
- badges row (GitHub / Vercel JSON deployment status / app time), cloud row (Supabase shield + Switch DB + Sync + Copy prod → dev), or right-column clock panel IDs and copy,
- dev user panel layout (header + Tips, prefs row, secondary row with Winding % / Pre-sleep %), header reset button copy, or compact **m** minute labels on pace / heads-up selects.
