# Listener and singleton audit (`sleep-utils.js`)

**Purpose:** Migration **gate** for [`sleep-utils.js`](../../sleep-utils.js): classify everything that must behave correctly when navigation becomes in-app (SPA) instead of full page loads.

**Owner todo:** `utils-audit` (parent plan [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md)).

See [conventions.md](./conventions.md) for how this doc relates to canonical feature specs.

---

## Scope

Audited together:

- `addEventListener` / `removeEventListener` (including `{ once: true }` and dynamic loops)
- Timers: `setInterval`, `setTimeout`, `requestAnimationFrame` / clears
- Module-level and `window` singleton flags and caches that survive route changes

**Counts (tree as audited):**

| Metric | Value |
|--------|--------|
| `.addEventListener(` occurrences (ripgrep) | **73** |
| Distinct static registration *lines* in source | **62** (see tables; some lines are multi-line calls) |
| Extra registrations from **loops** | Dev clock step buttons up to **7** (`3916`); nav menu `a.nav-menu-item` **N** (`4595`) |

Parent plan’s “~57” was an approximate order-of-magnitude; the live file is slightly higher plus loop expansion.

---

## Classification key

| Class | Meaning |
|-------|---------|
| **Per-route** | Must tear down (or avoid double-binding) when leaving a screen or when route outlet is remounted |
| **App-singleton** | Intended once per app lifetime; safe if shell + shared nav persist |
| **Per-element / subtree** | Nodes are replaced with route/subtree; listeners go away with DOM (MPA); re-init must not duplicate on same nodes |

---

## 1. Config / Supabase / settings UI

| Lines | Init / context | Target | Event(s) | Class | Teardown / notes |
|-------|----------------|--------|------------|-------|------------------|
| 1318–1324 | `initSupabaseConfigForm` | cloud/local toggle buttons | `click` | Per-element | Mount replaces `innerHTML` then binds; OK on full replace. SPA: re-run only when `#supabase-config-mount` rebuilt. |
| 1337–1408 | `initSupabaseConfigForm` | save / test / refresh / clear | `click` | Per-element | Same |
| 2098 | `initQualityPaletteSelector` | `#config-quality-palette` | `click` | Per-route | **No `dataset` guard** — double `init` duplicates handler. |
| 2150 ×2 | `initTonightGuidanceConfigControls` → `bindPoleWrap` | sleep/wake pole wraps | `click` | Per-element | Root `dataset.bound === '1'` prevents rebind. |
| 2169–2170 | `initTonightGuidanceConfigControls` | pace range | `input`, `change` | Per-element | `paceRange.dataset.bound` |
| 2191 | `wireAboutHintDismissRow` | hint dismiss checkbox | `change` | Per-element | `wrap.dataset.hintDismissBound` |
| 2239–2255 | `initDashboardHintsSettingsControls` | in-app tips eye buttons | `click` | Per-element | `root.dataset.bound` |
| 2392 | `initClockFormatSelector` | `#config-clock` | `click` | Per-route | **No guard** — duplicate `init` risk. |
| 2415 | `initLanguageSelector` | `#config-language-select` | `change` | Per-route | **No guard** |
| 2437–2451 | `initConfigThemeSelector` | light/dark row, `#config-theme` | `click`, `keydown` | Per-route | **No guard** on wrap listeners |
| 3698–3753 | `initRemainingWakeThresholdsConfig` | range inputs, overlay, **document** | `input`, pointer pipeline | **Per-route + leak** | **No init guard.** `document` listeners (`3749–3753`) for drag: survive after leaving config in SPA unless explicitly removed. |
| 3770 | `initRemainingWakeThresholdsConfig` | defaults button | `click` | Per-element | |
| 3801–3802 | `initRemainingWakeThresholdsConfig` | heads-up range | `input`, `change` | Per-element | |

---

## 2. Dev banner (dev build only)

Guard pattern: `window.__…Bound` booleans — second call is a no-op.

| Lines | Init | Target | Event(s) | Class | Notes |
|-------|------|--------|------------|-------|-------|
| 3863–3916 | `initDevClockControl` → `bindWhenReady` | datetime input, real/sim, step buttons | `input`, `change`, `click` | App-singleton | Up to **7** step `click` handlers. Often ends in `location.reload()`. |
| 3935 | `initDevBannerCloudRefresh` | cloud refresh btn | `click` | App-singleton | |
| 3964–3969 | `initDevBannerSupabasePresetToggle` | dev/prod preset | `click` | App-singleton | |
| 4034–4095 | `initDevBannerDrawer` | drawer handle | `pointerdown/move/up/cancel`, `click` | App-singleton | |
| 4320–4510 | `initDevBannerUserSettingsPanel` → `bindWhenReady` | lang, clock, theme, palette, RW inputs, tonight targets, guidance, hint checkboxes, defaults | `change`, `blur`, `click` | App-singleton | `tipsRow.dataset.hintBound` for hint row only. |

Supporting **rAF** in these inits: schedules layout (`syncDevBannerFixedLayout`); one-shot, not a subscription.

---

## 3. Global nav / menu / theme

| Lines | Init | Target | Event(s) | Class | Notes |
|-------|------|--------|------------|-------|-------|
| 4527 | `initDayNightTheme` | `#nav-daynight` | `click` | App-singleton | **No guard** — if `initDayNightTheme` ran twice, duplicate `click` on same node. |
| 4549 | `initDayNightTheme` (once via `__devBannerLayoutResizeBound`) | `window` | `resize` | App-singleton | Correct idempotent pattern for resize. |
| 4578–4598 | `initNavMenu` | trigger, theme row, each `a.nav-menu-item`, **document** | `click` | App-singleton / leak | **No guard.** Document listener closes menu on outside click — must exist **once** for app. Re-running `initNavMenu` would stack handlers. |
| 5375–5388 | `playNavSlumbyBounce` | `#nav-slumby-gif` | `load`, `error` | Per-element | `{ once: true }` + `removeEventListener` in handler body. |

---

## 4. Timers and animation scheduling

| Lines | API | Context | Class | Clear path |
|-------|-----|---------|-------|------------|
| 2202–2208 | `setTimeout` | `wireAboutHintDismissRow` fade | Per-element | `clearTimeout` before reschedule |
| 2227–2230 | `setTimeout` | `initDashboardHintsSettingsControls` feedback | Per-element | cleared on next show |
| 3859, 3924, 3950, 3976, 4004–4014, 4107, 4130–4132, 4304, 4326, 4421, 4437, 4468, 4477, 4486, 4518, 4540–4544 | `requestAnimationFrame` / nested rAF | dev banner bind + layout | App-singleton | one-shot frames |
| 4008–4014 | `setTimeout` | dev drawer post-toggle layout | App-singleton | `clearTimeout` before reset |
| 4535–4538 | **`setInterval` (60s)** | `initDayNightTheme` theme tick | App-singleton | **No `clearInterval` in file** — MPA relies on page unload. SPA shell: **single interval for app lifetime** or replace with centralized clock. |
| 5327–5340 | `setTimeout` | `scheduleNextNavSlumbyBounce` | App-singleton | cleared before reschedule |
| 5360–5365 | `setTimeout` | Slumby bounce end | App-singleton | `clearTimeout` in `initNavSlumbyBounce` / `playNavSlumbyBounce` |
| 5413–5426 | **`setInterval` (60s)** | `initRemainingWakeNav` | App-singleton | **Cleared** at next `initRemainingWakeNav` via `window[timerKey]` — good pattern for SPA refresh |

---

## 5. Module-level and `window` state (sticky)

| Symbol / key | Role | SPA note |
|--------------|------|----------|
| `sleepDataCache*`, `sleepDataPendingPromise` | Sleep payload cache | App-singleton — correct |
| `userSettingsCloudHydrateSucceeded`, `userSettingsCloudHydratePromise` | Cloud prefs hydrate | App-singleton |
| `configRemainingWakeBasis` | Basis for config RW sliders | Set by `initRemainingWakeThresholdsConfig`; stale if days change without re-init |
| `window.__devClockControlBound`, `__devBannerCloudRefreshBound`, `__devBannerPresetToggleBound`, `__devBannerDrawerBound`, `__devBannerUserSettingsBound`, `__devBannerLayoutResizeBound` | Dev-banner single bind | App-singleton |
| `window.__sleepAppRemainingWakeNavTimer`, `__sleepAppNavSlumbyScheduleTimer`, `__sleepAppNavSlumbyEndTimer` | Nav timers | Cleared / rescheduled by design |

---

## Open questions

1. **`initRemainingWakeThresholdsConfig`** — Who calls it from each page (config vs about embed)? If SPA mounts **only** an outlet for “settings” without full document unload, **must** pair `document.removeEventListener` for the five document-level handlers (or never attach until drag starts / use `AbortController`).
2. **`initDayNightTheme` / `initNavMenu`** — Assume **once per shell** after `renderNavBar`; document explicitly that double init is unsupported, or add guards mirroring dev-banner pattern.
3. **Config selectors without `dataset.bound`** (`initQualityPaletteSelector`, `initClockFormatSelector`, `initLanguageSelector`, `initConfigThemeSelector`) — SPA route re-enter may need guards or idempotent “replace + bind” pattern.
4. **`setInterval` in `initDayNightTheme`** — Accept one global theme clock in shell, or tie to `visibilitychange` later; either way record in lifecycle doc when nav becomes persistent.

---

## Planned product change: remaining-wake settings only on Settings

**Future intent:** Call `initRemainingWakeThresholdsConfig` **only from the Settings page** (`config.html`), **not** from About (`about.html`). Today the remaining-wake thresholds control (bar, sliders, and `document`-level drag listeners) can be initialized on both pages. Consolidating to Settings-only reduces duplicate SPA mount surfaces, makes a single route own teardown of those `document` listeners, and matches “settings live in Settings.”

---

## Gate verdict

**Recommendation: proceed with incremental in-tree SPA** (no Vite fork required solely on this audit).

**Rationale:** Most high-churn UI is either (a) behind **`window.__*Bound`** dev-banner guards, (b) on **config/about DOM** that MPA currently replaces or re-inits on navigation, or (c) **nav singletons** with clear “call once after `renderNavBar`” semantics. The **`sleep-utils` surface does not show unfixable mixing** of singleton vs per-route logic beyond what a persistent shell + explicit `unmount` for config routes and documented single-init for nav can address.

**Concrete hotspots before `first-lifecycle` / broader mount rollout:**

| Priority | Item |
|----------|------|
| P0 | `initRemainingWakeThresholdsConfig`: **document**-level listeners (`3749–3753`) — require teardown or refactor when config is not a full page navigation. |
| P1 | `initDayNightTheme` **60s `setInterval`**: ensure exactly one instance under SPA shell. |
| P1 | `initNavMenu` + `initDayNightTheme`: add **init-once** contract or guards to prevent duplicate `document` / pill handlers. |
| P2 | Unguarded config inits (quality palette, clock, language, theme): add **`dataset` guards** or split “render markup” vs “bind once”. |

If a future spike shows **repeated** `initDayNightTheme` / `initNavMenu` without full reload and duplicate handlers ship to production, revisit this verdict — the failure mode is behavioral bugs (double toggles), not architectural deadlock.

---

## Canonical references

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
