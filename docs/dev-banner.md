# Dev banner and app-time controls

Reference for the development banner in the shared nav, including when it appears, what it renders, and how simulated app time affects logic. Implementation lives primarily in `sleep-utils.js` with styling in `styles.css`.

---

## Architecture (flow)

The banner setup has four layers:

1. **Visibility gate**: `isDevBuildContext()` decides whether banner logic is active.
2. **Render layer**: `renderNavBar()` builds banner HTML (warnings, links, clock controls).
3. **Interaction layer**: init functions bind controls (`initDevClockControl`, `initDevBannerCloudRefresh`, `initDevBannerSupabasePresetToggle`, `initDevBannerDrawer`).
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

- **Branch row**: GitHub icon + branch label from `window.__DEV_GIT_BRANCH__`.
- **Cloud row**: Supabase dashboard link + optional **Dev** / **Prod** preset toggle (when `local-supabase-presets.js` defines valid `window.__RESTORE_SUPABASE_PRESETS__`) + hint text + "Refresh" button (`loadSleepData({ forceRefresh: true })` then reload).
- **Vercel row**: Production app link + project dashboard link.
- **Warnings**:
  - Supabase URL includes prod ref (`lsaguxfovamihwnicpkk`) -> red warning.
  - Branch is `master` -> branch warning.
- **App time controls**:
  - Real time mode (no override key)
  - Simulated mode (`datetime-local` + +/- minute/hour/day step buttons)
- **User / settings (dev)** (below the main row, inside the drawer):
  - Section title *User settings*; *Cloud tenant* label beside `RESTORE_CLOUD_USER_ID` (fixed MVP cloud tenant UUID; same value as `user_settings.user_id` and sleep row `user_id` in JS). Each preference is one full-width row (sentence-case label, then control); the panel spans the drawer width so there is no empty strip beside it.
  - Compact controls mirroring [config.html](config.html) / `user_settings`: language (`en` / `ja`), clock `12h` / `24h`, theme Auto / Day / Night, quality palette Meadow / Harbor / Auto, remaining-wake **Active ≥** and **Winding ≥** percent floors (numbers), phase heads-up minutes (`60` … `0`). Changes use the same preference setters and `syncUserSettingsRowToCloud()` as Settings when cloud sleep data is active.

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

- Choosing simulated mode or using step buttons persists override and reloads.
- Choosing real-time mode removes override and reloads.
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

### Supabase dev/prod presets (local file)

- Optional script `local-supabase-presets.js` (gitignored; copy from `local-supabase-presets.example.js`) sets `window.__RESTORE_SUPABASE_PRESETS__` with `dev` and `prod` objects, each `{ url, anonKey }` (all four strings required for the toggle to appear).
- Key: `sleep-app-active-supabase-preset` (`ACTIVE_SUPABASE_PRESET_KEY`) — `dev` or `prod` selects preset mode; empty means custom credentials from Settings only.
- **Dev** / **Prod** buttons set the key, call `setSupabaseConfig` with the chosen pair, and reload. While preset mode is active, `ensureDevSupabasePresetApplied()` keeps `restore_supabase_*` aligned on each page load.
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
| `ACTIVE_SUPABASE_PRESET_KEY` | `sleep-app-active-supabase-preset` | `dev` / `prod` preset mode for local `local-supabase-presets.js`; empty = custom |
| `SUPABASE_PROJECT_REF_PROD` | `lsaguxfovamihwnicpkk` | Marks production DB context |
| `SUPABASE_PROJECT_REF_DEV` | `pjpzxkyflmzzbfdkujan` | Default dev dashboard target |

---

## Source map

| Concept | Primary location |
|--------|-------------------|
| Visibility gate and override precedence | `isDevBuildContext` - `sleep-utils.js` |
| App time override read/accessors | `readDevClockOverrideMs`, `getAppNowMs`, `getAppDate` - `sleep-utils.js` |
| Banner markup and warnings | `renderNavBar` - `sleep-utils.js` |
| Clock mode + datetime/step controls | `initDevClockControl` - `sleep-utils.js` |
| Cloud refresh button | `initDevBannerCloudRefresh` - `sleep-utils.js` |
| Supabase dev/prod preset toggle | `initDevBannerSupabasePresetToggle`, `readLocalSupabasePresets`, `ensureDevSupabasePresetApplied` - `sleep-utils.js` |
| Drawer pointer/click behavior | `initDevBannerDrawer` - `sleep-utils.js` |
| Expanded reserve measurement/caching | `measureDevBannerExpandedHeightPx`, `syncDevBannerFixedLayout` - `sleep-utils.js` |
| Branch stamp source | `scripts/stamp-dev-branch.js` -> `dev-git-branch.js` |
| Banner visual system and responsive behavior | `.nav-dev-banner*` selectors in `styles.css` |

---

## Change checklist (keep doc in sync)

Update this doc when you change:

- dev-banner visibility conditions or override precedence,
- any of the localStorage keys in the table above (including preset mode),
- app-time simulation behavior (reload rules, controls, IDs),
- drawer drag thresholds or collapse persistence behavior,
- fixed layout reserve strategy (`syncDevBannerFixedLayout`),
- prod/dev warning conditions or banner background-class rules.
