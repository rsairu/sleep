# Canonical route table

**Purpose:** Single place for **ids**, MPA paths (`*.html`), future SPA paths, and how each route relates to nav vs menu-only vs redirect behavior. Shared between today’s nav and a future router.

**Owner todo:** `route-table` — **complete** (Apr 2026). Canonical data: [`routes-data.mjs`](../../routes-data.mjs) (`__restoreRoutesData`, **`mpaHref(key)`** for internal deep links); [`sleep-utils.js`](../../sleep-utils.js) `renderNavBar` consumes it. Keep this doc aligned when adding tabs, menu hrefs, or new `mpaHref` keys.

See [conventions.md](./conventions.md).

---

## Sources of truth (extract from code)

1. **[`routes-data.mjs`](../../routes-data.mjs)** — `navTabs` (tab rows), `href` (about, settings, settings cloud hash, dashboard for app block), and **`mpaHref(key)`** for internal links built in JS. Loaded as **`type="module"`** with **`defer`**, in document order **before** `sleep-utils.js` (Phase 8 — see [decisions.md](./decisions.md)).
2. **`renderNavBar`** in [`sleep-utils.js`](../../sleep-utils.js) — maps `navTabs` + `mpaHref` to HTML (i18n keys unchanged).
3. **Root entry** — [`index.html`](../../index.html) meta-refresh to `dashboard.html`; SPA cutover must replace with intentional routing.

**Naming note:** Older migration drafts referred to `daily.html` / `graph.html` / `config.html`. The repo uses **`nightly.html`**, **`charts.html`**, and **`settings.html`** — treat those as canonical MPA paths.

---

## Tabs (`pages[]` in `renderNavBar`)

| nav `id` | `mpaPath` | `spaPath` (TBD) | `navKind` | `renderNavBar` arg | notes |
|----------|-----------|-----------------|-----------|-------------------|-------|
| `dashboard` | `dashboard.html` | `/dashboard` (TBD) | `tab` | `'dashboard'` | App “home”; includes `nightly.js`, `quick-actions.js`, `dashboard.js` |
| `log` | `log.html` | TBD | `tab` | `'log'` | Includes `nightly.js`, `entry-modal.js`, `log.js` |
| `quality` | `quality.html` | TBD | `tab` | `'quality'` | Lifecycle: [`lifecycle-contract.md`](./lifecycle-contract.md); includes `nightly.js`, `quality.js` |
| `timeline` | `nightly.html` | TBD | `tab` | `'timeline'` | **Nav id ≠ filename:** id is `timeline`, file is `nightly.html`, i18n tab is “Nightly” (`nav.tabs.daily` key). |
| `charts` | `charts.html` | TBD | `tab` | `'charts'` | Includes `charts.js` only (no `nightly.js`) |
| `stats` | `stats.html` | TBD | `tab` | `'stats'` | Includes `stats-aggregates.js`, `stats.js` |

---

## Menu-only routes (not in `pages[]`)

| logical id | `mpaPath` | `spaPath` (TBD) | `navKind` | notes |
|------------|-----------|-----------------|-----------|-------|
| `about` | `about.html` | TBD | `menu` | Hamburger first row; `about.js` lifecycle on `#about-page-root` |
| `settings` | `settings.html` | TBD | `menu` | Hamburger; cloud deep-link **`settings.html#cloud-sync`** on data-source row; `settings.js` lifecycle on `#settings-page-root` |

---

## Redirect / entry

| logical id | `mpaPath` | `spaPath` (TBD) | `navKind` | notes |
|------------|-----------|-----------------|-----------|-------|
| `index` | `index.html` | `/` (TBD) | `redirect` | Meta-refresh → `dashboard.html` |

---

## Script chains (MPA, for SPA bundle planning)

Shared prefix (all substantive shells, **`defer`** on each tag): `dev-git-branch.js` → `local-supabase-presets.js` → **`routes-data.mjs`** (`<script type="module" … defer>`) → **`sleep-utils.js`**. Then route-specific classics (each `defer`), then a deferred **`*-boot.js`** page initializer (Phase 8).

| Route | Additional scripts (after `sleep-utils.js`) | Boot file |
|-------|-----------------------------------------------|-----------|
| `dashboard` | `nightly.js`, `quick-actions.js`, `dashboard.js` | `dashboard-boot.js` |
| `log` | `nightly.js`, `entry-modal.js`, `log.js` | `log-boot.js` |
| `quality` | `nightly.js`, `quality.js` | `quality-boot.js` |
| `timeline` (`nightly.html`) | `nightly.js` | `nightly-boot.js` |
| `charts` | `charts.js` | `charts-boot.js` |
| `stats` | `stats-aggregates.js`, `stats.js` | `stats-boot.js` |
| `about` | `about.js` | `about-boot.js` |
| `settings` | `settings.js` | `settings-boot.js` |

**Shared `nightly.js` cluster:** dashboard, log, quality, nightly page. See [decisions.md](./decisions.md) (accepted ADR **Data fetching / cache / SWR** — single sleep-data store, subscribe/unmount, refresh rules).

---

## `mpaHref` semantic keys (JS)

Defined in [`routes-data.mjs`](../../routes-data.mjs) (internal link map; see `mpaHref`). Use these keys from [`sleep-utils.js`](../../sleep-utils.js) / [`nightly.js`](../../nightly.js) instead of new string literals.

| Key | Typical resolved href (default `href` / `navTabs`) |
|-----|---------------------------------------------------|
| `about.page` | `about.html` |
| `about.dailyFlags` | `about.html#daily-flags` |
| `about.quickActions` | `about.html#quick-actions` |
| `about.tonightBarSymbols` | `about.html#tonight-bar-symbols` |
| `about.remainingWakeTime` | `about.html#remaining-wake-time` |
| `about.sleepStatistics` | `about.html#sleep-statistics` |
| `about.tonightGuidance` | `about.html#tonight-guidance` |
| `settings.page` | `settings.html` |
| `settings.inAppTips` | `settings.html#in-app-tips` |
| `settings.remainingWake` | `settings.html#remaining-wake` |
| `settings.cloudSync` | `settings.html#cloud-sync` |
| `dashboard.page` | `dashboard.html` |
| `tab.quality` | `quality.html` |
| `tab.timeline` | `nightly.html` |
| `tab.charts` | `charts.html` |
| `tab.stats` | `stats.html` |
| `charts.bedAsleepWake` | `charts.html#chart-bed-asleep-wake` |
| `charts.sleepDuration` | `charts.html#chart-sleep-duration` |

---

## Static HTML internal links (parity)

These `<a href>` values are **not** emitted by `mpaHref` (no extra script on shells). When you change a URL or hash, update the HTML and add or adjust the matching **`mpaHref` key** above if a JS caller shares the same destination.

| File | href (must match resolver semantics) | `mpaHref` key for parity |
|------|----------------------------------------|---------------------------|
| [`about.html`](../../about.html) | `settings.html#in-app-tips` | `settings.inAppTips` |
| [`about.html`](../../about.html) | `settings.html#remaining-wake` | `settings.remainingWake` |
| [`about.html`](../../about.html) | `stats.html` | `tab.stats` |
| [`settings.html`](../../settings.html) | `about.html#tonight-guidance` | `about.tonightGuidance` |
| [`settings.html`](../../settings.html) | `about.html#remaining-wake-time` | `about.remainingWakeTime` |
| [`stats.html`](../../stats.html) | `about.html#sleep-statistics` | `about.sleepStatistics` |
| [`index.html`](../../index.html) | `dashboard.html` (fallback link only) | `dashboard.page` (optional until pivot) |

---

## Canonical references

Nav and dev behavior overlap this table; feature specs remain in:

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
