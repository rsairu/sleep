# Architecture decisions

This is the permanent ADR summary for the current SPA-first architecture.

## ADR-001: SPA runtime with canonical path routes

- **Status:** accepted
- **Decision:** Use `index.html` + `src/spa-app.js` History API routing with canonical path routes.
- **Consequence:** Internal navigation stays on path URLs (`/dashboard`, `/settings#cloud-sync`) with no legacy `*.html` dependency.

## ADR-002: Centralized route metadata and semantic link helpers

- **Status:** accepted
- **Decision:** Keep route metadata and link helpers in `src/routes-data.mjs` and consume through `__restoreRoutesData`.
- **Consequence:** Route table changes happen in one place and are reused by nav rendering and router compatibility helpers.

## ADR-003: Fragment-based route markup source

- **Status:** accepted
- **Decision:** Source route markup from `src/spa-fragments/*.html` imported by `src/spa-app.js`.
- **Consequence:** No runtime fetch dependency on legacy shell HTML files.

## ADR-004: Lifecycle mount/unmount contract

- **Status:** accepted
- **Decision:** Each route module exposes `mount`/`unmount` and is responsible for route-scoped subscriptions/listeners/timers.
- **Consequence:** Route transitions are deterministic and avoid stale async writes/leaked handlers.

## ADR-005: Shared sleep-data store and revalidation policy

- **Status:** accepted
- **Decision:** Keep one runtime sleep-data store as shared state source across routes.
- **Consequence:** Reduced per-route fetch orchestration and consistent invalidation/refresh behavior.

## ADR-006: Hard cut of legacy MPA shells and boot pipeline

- **Status:** accepted
- **Decision:** Remove root per-page `*.html`, remove `*-boot.js`, remove shell/boot copy wiring from build/deploy config.
- **Consequence:** Production/runtime architecture is SPA-only with simpler build/deploy wiring.

## ADR-007: Group app source under src, tests, and local

- **Status:** accepted
- **Decision:** Keep runtime app code under `src/` (`src/lib`, `src/routes`, `src/styles`, `src/routes-data.mjs`), test harnesses in `tests/`, and local/dev environment helpers in `local/`.
- **Consequence:** Source layout is conventional and easier to navigate while runtime URLs stay unchanged through static-copy wiring (`dest: '.'`).
