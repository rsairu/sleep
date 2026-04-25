# Canonical route table

**Purpose:** Single place for **ids**, MPA paths (`*.html`), future SPA paths, and how each route relates to nav vs menu-only vs redirect behavior. Shared between today’s nav and a future router.

**Owner todo:** `route-table` — **complete** (Apr 2026). Canonical data: [`routes-data.js`](../../routes-data.js) (`__restoreRoutesData`); [`sleep-utils.js`](../../sleep-utils.js) `renderNavBar` consumes it. Keep this doc aligned when adding tabs or menu hrefs.

See [conventions.md](./conventions.md).

---

## Sources of truth (extract from code)

1. **[`routes-data.js`](../../routes-data.js)** — `navTabs` (tab rows) and `href` (about, settings, settings cloud hash, dashboard for app block). Loaded on every page **before** `sleep-utils.js`.
2. **`renderNavBar`** in [`sleep-utils.js`](../../sleep-utils.js) — maps `navTabs` + `href` to HTML (i18n keys unchanged).
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
| `about` | `about.html` | TBD | `menu` | Hamburger first row; inline scripts only |
| `settings` | `settings.html` | TBD | `menu` | Hamburger; cloud deep-link **`settings.html#cloud-sync`** on data-source row; inline scripts only |

---

## Redirect / entry

| logical id | `mpaPath` | `spaPath` (TBD) | `navKind` | notes |
|------------|-----------|-----------------|-----------|-------|
| `index` | `index.html` | `/` (TBD) | `redirect` | Meta-refresh → `dashboard.html` |

---

## Script chains (MPA, for SPA bundle planning)

Order matches `<script>` tags in each HTML shell (after shared `dev-git-branch.js` → `local-supabase-presets.js` → **`routes-data.js`** → `sleep-utils.js`):

| Route | Additional scripts |
|-------|---------------------|
| `dashboard` | `nightly.js`, `quick-actions.js`, `dashboard.js` |
| `log` | `nightly.js`, `entry-modal.js`, `log.js` |
| `quality` | `nightly.js`, `quality.js` |
| `timeline` (`nightly.html`) | `nightly.js` |
| `charts` | `charts.js` |
| `stats` | `stats-aggregates.js`, `stats.js` |
| `about` | *(none — inline only)* |
| `settings` | *(none — inline only)* |

**Shared `nightly.js` cluster:** dashboard, log, quality, nightly page. See [decisions.md](./decisions.md) (accepted ADR **Data fetching / cache / SWR** — single sleep-data store, subscribe/unmount, refresh rules).

---

## Canonical references

Nav and dev behavior overlap this table; feature specs remain in:

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
