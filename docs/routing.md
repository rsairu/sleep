# Routing model

This document is the canonical routing reference for Restore's SPA runtime.

## Source of truth

- `routes-data.mjs` defines canonical route metadata and link helpers:
  - `navTabs`
  - `spaPathByTabId`
  - `spaPathByMpaFile`
  - `mpaHref(key)`, `spaHref(key)`, `internalNavHref(key)`
- `src/spa-app.js` is the History API router and route activation runtime.
- `sleep-utils.js` `renderNavBar()` reads route metadata from `__restoreRoutesData`.

## Canonical route table

| Route id | Path | Nav kind | Mount root | Scripts |
|---|---|---|---|---|
| `dashboard` | `/dashboard` | tab | `#dashboard-container` | `nightly.js`, `quick-actions.js`, `dashboard.js` |
| `log` | `/log` | tab | `#log-page-root` | `nightly.js`, `entry-modal.js`, `log.js` |
| `quality` | `/quality` | tab | `#quality-container` | `nightly.js`, `quality.js` |
| `timeline` | `/timeline` | tab | `#timeline-section` | `nightly.js` |
| `charts` | `/charts` | tab | `#charts-page-root` | `charts.js` |
| `stats` | `/stats` | tab | `#stats-page-root` | `stats-aggregates.js`, `stats.js` |
| `about` | `/about` | menu | `#about-page-root` | `about.js` |
| `settings` | `/settings` | menu | `#settings-page-root` | `settings.js` |
| `index` | `/` -> `/dashboard` | redirect | SPA shell | `src/spa-app.js` |

## Link policy

- Use semantic link keys via `internalNavHref(key)` in shared/app code.
- Keep hash fragments for deep links (example: `/settings#cloud-sync`).
- Do not introduce raw `*.html` links for internal navigation.

## Route content source

- Route markup is loaded from `src/spa-fragments/*.html` imports in `src/spa-app.js`.
- Runtime no longer depends on root legacy route shells or `dist/mpa`.

