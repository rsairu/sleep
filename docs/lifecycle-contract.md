# Lifecycle contract

Route modules use a shared lifecycle surface to support SPA navigation safely.

## Contract

Each route lifecycle is exposed as `window.__restore<Route>Lifecycle` with:

- `mount(root, ctx?)`
- `unmount()`

Rules:

- `mount` must initialize only the route-owned subtree.
- `unmount` must be idempotent and safe to call repeatedly.
- Async work started by `mount` must guard against stale completion.
- Route-scoped listeners, timers, and subscriptions must be removed on `unmount`.

## Active route lifecycles

- `__restoreDashboardLifecycle` on `#dashboard-container`
- `__restoreLogLifecycle` on `#log-page-root`
- `__restoreQualityLifecycle` on `#quality-container`
- `__restoreNightlyTimelineLifecycle` on `#timeline-section`
- `__restoreChartsLifecycle` on `#charts-page-root`
- `__restoreStatsLifecycle` on `#stats-page-root`
- `__restoreAboutLifecycle` on `#about-page-root`
- `__restoreSettingsLifecycle` on `#settings-page-root`

## Runtime integration

- `src/spa-app.js` calls `mount` after fragment insertion and script preload.
- On route change, `src/spa-app.js` calls `unmount` for the current lifecycle before activating the next route.

## Ownership notes

- App-level singletons in shared scripts (for example nav menu/global theme timers) should remain guarded against duplicate init.
- Route-specific logic belongs in route lifecycle modules, not persistent shell globals.

