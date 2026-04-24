---
name: First lifecycle contract (quality or stats)
overview: Introduce `mount(root, ctx)` / `unmount()` on one low-risk route with a single main outlet, add a dev-only mount→unmount→mount harness, and freeze the API in [docs/migration/lifecycle-contract.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/lifecycle-contract.md). Does **not** convert config/about or the SPA shell.
todos:
  - id: pick-route
    content: Confirm **quality** vs **stats** as first proof (default quality); document choice in lifecycle-contract.md
    status: completed
  - id: implement-mount-api
    content: Refactor chosen page script to export mount(root, ctx?)/unmount(); clear outlet and cancel/ignore in-flight async on unmount
    status: completed
  - id: wire-mpa-init
    content: Update the matching *.html inline init to call mount on the route outlet after existing initI18n/renderNavBar/theme/remaining-wake chain
    status: completed
  - id: dev-harness
    content: Add dev-only harness (e.g. URL query gated like dev-banner patterns) that runs mount→unmount→mount on same root; no-op in non-dev contexts
    status: completed
  - id: doc-contract
    content: Replace stubs in lifecycle-contract.md with final function signatures, ctx fields, harness how-to, and known limits
    status: completed
isProject: false
---

# Next step only: `first-lifecycle`

**Parent:** [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](c:/Users/UriasRey/Desktop/sleep_proj/.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md) (workstream 3).

**Doc target:** [docs/migration/lifecycle-contract.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/lifecycle-contract.md).

## Goal

Freeze a **repeatable route lifecycle** for a future SPA: a page-specific module exposes **`mount(root, ctx)`** and **`unmount()`**, proves teardown and re-entry, and records the contract. Shared `sleep-utils` / nav stay as today (full page); this step only **patterns** one screen.

## Default route choice (recommend **quality**)

| Route | Outlet | Why |
|-------|--------|-----|
| **Quality** (recommended) | [`#quality-container`](c:/Users/UriasRey/Desktop/sleep_proj/quality.html) | [`quality.js`](c:/Users/UriasRey/Desktop/sleep_proj/quality.js) is small (~18 lines), async `loadSleepData` + innerHTML only; no `addEventListener` in the page script today — fastest contract signal. |
| **Stats** (alternative) | `#stats-container` + [`#stats-period-scope`](c:/Users/UriasRey/Desktop/sleep_proj/stats.html) | [`stats.js`](c:/Users/UriasRey/Desktop/sleep_proj/stats.js) has period UI + at least one listener; still viable but more moving parts. |

Pick one; the other remains the first **rollout** sibling after the contract is written (per parent plan).

## API shape (draft — finalize in code + doc)

- **`mount(root, ctx)`** — `root` is the DOM element for route content (e.g. `#quality-container`). `ctx` optional: reserved for `{ abortSignal?, locale? }` later; keep minimal for first proof.
- **`unmount()`** — Idempotent: clear `root` content (or restore placeholder), drop references, and **ignore or abort** in-flight `loadSleepData` so a resolved promise cannot write after unmount (pattern: local generation counter, `AbortController` if you add fetch later, or guard before `innerHTML` assign).

Expose from the page script in a way MPA can call without a bundler today (e.g. **`window`** namespaced functions with stable names, or a single `window.__restoreQualityLifecycle` object) — **shrink-only** rule: no new globals beyond what’s needed for this proof; parent `module-migration` todo can later move to ES modules.

## Dev harness

MPA never calls `unmount` on navigation. Add a **dev-only** path (mirror spirit of `?devBanner=1` / local dev host checks in [`sleep-utils.js`](c:/Users/UriasRey/Desktop/sleep_proj/sleep-utils.js)):

- Example: `?lifecycleHarness=1` on **quality.html** (or chosen page) **and** dev/local gate, **or** a documented `localStorage` key for testers.
- Sequence: **`mount` → `unmount` → `mount`** on the **same** `root` element; log a single line or use `console.assert` on outlet state if useful.

Document exact invocation in `lifecycle-contract.md`.

## Files likely touched

- Chosen script: [`quality.js`](c:/Users/UriasRey/Desktop/sleep_proj/quality.js) or [`stats.js`](c:/Users/UriasRey/Desktop/sleep_proj/stats.js).
- Matching shell: [`quality.html`](c:/Users/UriasRey/Desktop/sleep_proj/quality.html) or [`stats.html`](c:/Users/UriasRey/Desktop/sleep_proj/stats.html) inline `<script>` after `initRemainingWakeNav()`.
- [docs/migration/lifecycle-contract.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/lifecycle-contract.md).

## Acceptance criteria

- Default **MPA** load for the chosen page is unchanged for end users (same visual result, no harness unless query present).
- **`unmount`** leaves the outlet empty (or agreed placeholder) and does not throw when called twice.
- Harness demonstrates **double mount** without duplicate listeners or stale DOM writes from the first `loadSleepData` chain.
- `lifecycle-contract.md` matches shipped signatures and describes harness + **out of scope** (config/about, SPA router).

## Out of scope for this step

- `data-fetching-policy`, `route-table`, dashboard second proof, **config/about** extraction, link helper, bundler, SPA pivot.
- Refactoring `sleep-utils.js` nav singletons (already audited; do not expand scope here).

## After this todo

Mark `first-lifecycle` **completed** in the parent plan YAML; proceed to **`data-fetching-policy`** or parallel **`route-table`** per team preference (parent plan order suggests documenting fetch policy before broad mount rollout).
