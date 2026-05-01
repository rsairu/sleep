# SPA Hard-Cut Baseline Checklist (Phase 0)

This checklist is the Phase 0 guardrail for post-migration cleanup. It captures the route/runtime baseline before hard-cut changes and defines the acceptance gate for deleting legacy HTML shells and `*-boot.js` artifacts.

Status: Temporary verification checklist. Keep until Phase 2 completes and rollout is stable.

## Route-by-route baseline (must hold through cleanup)

| Route | Current content source in SPA | Expected lifecycle mount root | Route script preload chain |
|------|-------------------------------|-------------------------------|----------------------------|
| `/dashboard` | `src/spa-fragments/dashboard.html` (`#dashboard-container`) | `#dashboard-container` via `__restoreDashboardLifecycle` | `nightly.js`, `quick-actions.js`, `dashboard.js` |
| `/log` | `src/spa-fragments/log.html` (`#log-page-root`) | `#log-page-root` via `__restoreLogLifecycle` | `nightly.js`, `entry-modal.js`, `log.js` |
| `/quality` | `src/spa-fragments/quality.html` (`#quality-container`) | `#quality-container` via `__restoreQualityLifecycle` | `nightly.js`, `quality.js` |
| `/timeline` | `src/spa-fragments/timeline.html` (`#timeline-section`) | `#timeline-section` via `__restoreNightlyTimelineLifecycle` | `nightly.js` |
| `/charts` | `src/spa-fragments/charts.html` (`#charts-page-root`) | `#charts-page-root` via `__restoreChartsLifecycle` | `charts.js` |
| `/stats` | `src/spa-fragments/stats.html` (`#stats-page-root`) | `#stats-page-root` via `__restoreStatsLifecycle` | `stats-aggregates.js`, `stats.js` |
| `/about` | `src/spa-fragments/about.html` (`#about-page-root`) | `#about-page-root` via `__restoreAboutLifecycle` | `about.js` |
| `/settings` | `src/spa-fragments/settings.html` (`#settings-page-root`) | `#settings-page-root` via `__restoreSettingsLifecycle` | `settings.js` |

## Runtime baseline checks (manual smoke pass)

- Load SPA at `/dashboard` and verify nav tabs render and route highlighting updates correctly.
- Navigate through all SPA routes (`/dashboard`, `/log`, `/quality`, `/timeline`, `/charts`, `/stats`, `/about`, `/settings`) and confirm route content appears in `#spa-outlet`.
- Verify each route mount root exists after navigation and no console errors appear for missing lifecycle globals (`__restore*Lifecycle`).
- Verify hash navigation still works for same-route anchor links (for example charts anchors and settings hash sections).
- Verify browser back/forward (`popstate`) keeps content and URL in sync.

## Hard-cut acceptance criteria (gate before Phase 2 delete)

- All route content renders from canonical non-shell sources (no runtime `fetch` of root legacy `*.html` route shells).
- SPA runtime has no dependency on `*-boot.js` artifacts.
- Build output and deploy config contain no legacy static-copy wiring for deleted shells/boot files.
- Route parity is preserved for all canonical SPA paths and key deep links.
- Build succeeds (`npm run build`) and smoke pass succeeds in both `npm run dev` and `npm run preview`.

## Execution checklist by phase

### Phase 1 (replace fragment source)

- [x] Replace route content loading in `src/spa-app.js` so route activation no longer depends on legacy shell HTML files.
- [x] Keep route mapping canonical (single route table source) and remove duplicated route/path maps where possible.
- [x] Re-run runtime baseline checks and record any regressions before hard cut.

### Phase 2 (hard cut legacy)

- [x] Remove legacy root route shells and `*-boot.js` files only after Phase 1 parity is confirmed.
- [x] Remove static copy/deploy compatibility wiring in `vite.config.js` and `vercel.json` for removed artifacts.
- [x] Run build + preview smoke pass to confirm no missing runtime assets.

## Phase completion notes

- Phase 1 parity validated by manual click-through across tab routes and hamburger routes, including hash deep-links.
- Phase 2 hard cut completed: root legacy route shells and `*-boot.js` artifacts removed.
- Build/deploy wiring updated so no legacy shell/boot copy or `*.html` redirect compatibility remains.

## Notes for the next agent (Phase 3)

- Begin documentation consolidation from `docs/migration/*` into permanent docs (`docs/routing.md`, `docs/lifecycle-contract.md`, `docs/architecture-decisions.md`), then retire `docs/migration`.
- Update README wording to remove stale migration-progress framing and legacy MPA references.
- Keep exactly one historical ADR only if a meaningful decision cannot be cleanly merged into permanent docs.
