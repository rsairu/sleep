# SPA Hard-Cut Baseline Checklist (Phase 0)

This checklist is the Phase 0 guardrail for post-migration cleanup. It captures the route/runtime baseline before hard-cut changes and defines the acceptance gate for deleting legacy HTML shells and `*-boot.js` artifacts.

Status: Temporary verification checklist. Keep until Phase 2 completes and rollout is stable.

## Route-by-route baseline (must hold through cleanup)

| Route | Current content source in SPA | Expected lifecycle mount root | Route script preload chain |
|------|-------------------------------|-------------------------------|----------------------------|
| `/dashboard` | `dashboard.html` fragment (`#dashboard-container`) | `#dashboard-container` via `__restoreDashboardLifecycle` | `nightly.js`, `quick-actions.js`, `dashboard.js` |
| `/log` | `log.html` fragment (`#log-page-root`) | `#log-page-root` via `__restoreLogLifecycle` | `nightly.js`, `entry-modal.js`, `log.js` |
| `/quality` | `quality.html` fragment (`#quality-container`) | `#quality-container` via `__restoreQualityLifecycle` | `nightly.js`, `quality.js` |
| `/timeline` | `nightly.html` fragment (`#timeline-section`) | `#timeline-section` via `__restoreNightlyTimelineLifecycle` | `nightly.js` |
| `/charts` | `charts.html` fragment (`#charts-page-root`) | `#charts-page-root` via `__restoreChartsLifecycle` | `charts.js` |
| `/stats` | `stats.html` fragment (`#stats-page-root`) | `#stats-page-root` via `__restoreStatsLifecycle` | `stats-aggregates.js`, `stats.js` |
| `/about` | `about.html` fragment (`#about-page-root`) | `#about-page-root` via `__restoreAboutLifecycle` | `about.js` |
| `/settings` | `settings.html` fragment (`#settings-page-root`) | `#settings-page-root` via `__restoreSettingsLifecycle` | `settings.js` |

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

- [ ] Replace route content loading in `src/spa-app.js` so route activation no longer depends on legacy shell HTML files.
- [ ] Keep route mapping canonical (single route table source) and remove duplicated route/path maps where possible.
- [ ] Re-run runtime baseline checks and record any regressions before hard cut.

### Phase 2 (hard cut legacy)

- [ ] Remove legacy root route shells and `*-boot.js` files only after Phase 1 parity is confirmed.
- [ ] Remove static copy/deploy compatibility wiring in `vite.config.js` and `vercel.json` for removed artifacts.
- [ ] Run build + preview smoke pass to confirm no missing runtime assets.

## Notes for the next agent (Phase 1)

- Keep this file as the authoritative Phase 0 gate while implementing Phase 1.
- During Phase 1, update this document with a short "parity check results" note after refactoring route content sources.
- Do not delete this checklist until after Phase 2 has shipped and verification is complete.
