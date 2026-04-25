# Lifecycle contract (`mount` / `unmount`)

**Purpose:** Freeze the **route module API** before broad rollout: how a screen attaches to a DOM outlet and releases listeners, timers, and subscriptions.

**Owner todo:** `first-lifecycle` (parent plan [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md)).

See [conventions.md](./conventions.md).

---

## First proof route: **Quality**

**Decision:** The first lifecycle implementation is **[`quality.js`](../../quality.js)** targeting **[`#quality-container`](../../quality.html)** on [`quality.html`](../../quality.html).

**Rationale:** Single outlet, small script, async `loadSleepData` + `innerHTML` only (no route-local `addEventListener` today). **[`stats.js`](../../stats.js)** remains the sibling rollout target next (period controls + listeners).

**Not used first:** config/about (inline inits + extra variables per parent plan).

---

## Shipped API (Quality)

Global namespace (classic scripts, no bundler): **`window.__restoreQualityLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` must be the outlet element (typically `document.getElementById('quality-container')`). Bumps an internal **generation** counter, sets `root` as active, clears `root.innerHTML`, then calls `loadSleepData()`. When the promise resolves, applies heatmap HTML **only if** generation and `root` still match the active mount (stale async writes are dropped). |
| **`unmount()`** | **Idempotent.** Bumps generation (invalidates in-flight `loadSleepData`), clears `innerHTML` of the last mounted root, clears the active root reference. Safe to call multiple times. |

**`ctx`:** Optional object for future fields (e.g. `AbortSignal`). Currently unused; callers may pass `{}`.

**Async / race rule:** Every `mount` and `unmount` bumps the same generation counter so any **older** `loadSleepData` completion is ignored after `unmount` or a newer `mount`.

---

## Rollout: **Dashboard** (second proof)

Global namespace: **`window.__restoreDashboardLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` is [`#dashboard-container`](../../dashboard.html). Bumps generation, clears outlet, registers **`tonight-guidance-changed`** on `window`, then loads data and renders (stale completions dropped). |
| **`unmount()`** | Idempotent. Tears down **tonight adjuster** document listeners via **`window.__dashboardTonightAdjusterTeardown`** (set by `initDashboardTonightAdjuster` in [`nightly.js`](../../nightly.js)), **`destroyDashboardQuickActions`** ([`quick-actions.js`](../../quick-actions.js)), tracked **day-panel** `document` `click` closers, **`resize`** rerender listener, **`tonight-guidance-changed`**, then clears outlet HTML. |

**MPA:** [`dashboard.html`](../../dashboard.html) calls `mount` after nav/theme init. **`#tooltip`** / **`#day-panel`** stay in the shell outside the outlet (unchanged from MPA).

**Harness:** `dashboard.html?lifecycleHarness=1` (dev-gated). Console lines prefixed **`[lifecycleHarness] dashboard:`** (start, after unmount, second mount complete).

**Deviation flags:** `initDeviationFlagChips` remains an **app singleton** (see nightly rollout notes); dashboard still invokes it on render.

---

## Rollout: **Charts**

Global namespace: **`window.__restoreChartsLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` is **[`#charts-page-root`](../../charts.html)** — wraps the static page chrome (container, tooltips, day panel) for a **single route outlet** (Option 2). Does **not** wipe static HTML; loads data then binds range buttons, **`resize`**, master toggles, and chart-mode rockers with an **`AbortSignal`** tied to the mount session. |
| **`unmount()`** | Idempotent. Aborts the session **`AbortController`** (drops all signal-bound listeners), resets toggle/rocker flags and hash-scroll bookkeeping, clears **`graphPageAllPoints`**, runs **`clearGraphSvgsAndErrors`**. |

**Harness:** `charts.html?lifecycleHarness=1` (dev-gated). Console: **`[lifecycleHarness] charts:`** …

---

## Rollout: **Nightly timeline**

Global namespace: **`window.__restoreNightlyTimelineLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` is **[`#timeline-section`](../../nightly.html)** (contains `#timeline-legend-controls` and `#days-container`). Clears legend and days, loads data, renders weeks, binds week headers and legend checkboxes with an **`AbortSignal`**. |
| **`unmount()`** | Idempotent. Aborts the timeline **`AbortController`**, clears legend and days `innerHTML`. |

**Deviation flags (`initDeviationFlagChips`):** Remains an **app singleton** at the end of [`nightly.js`](../../nightly.js) — `document` listeners for chip expand/collapse are **not** tied to timeline mount; every page that loads `nightly.js` still initializes them once (guarded by `deviationFlagChipListenersBound`).

**Harness:** `nightly.html?lifecycleHarness=1` (dev-gated). Console: **`[lifecycleHarness] nightly:`** …

---

## Rollout: **Log**

Global namespace: **`window.__restoreLogLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` is **[`#log-page-root`](../../log.html)**. Bumps generation, clears outlet, loads data, renders quick-add HTML, starts remaining-wake **`setInterval`**, calls **`initQuickAddEntryModal`**. |
| **`unmount()`** | Idempotent. Bumps generation, clears the **60s interval**, clears outlet `innerHTML`. |

**Note:** [`entry-modal.js`](../../entry-modal.js) **`bindQuickAddHostOnce`** registers **`document`** listeners once per app lifetime; they are **not** removed on log `unmount` (same pattern as other singleton inits). Form nodes under `#log-page-root` are destroyed so delegated handlers no-op until the next mount rebuilds `#quick-add-form`.

**Harness:** `log.html?lifecycleHarness=1` (dev-gated). Console: **`[lifecycleHarness] log:`** …

---

## Rollout: **Stats**

Global namespace: **`window.__restoreStatsLifecycle`**

| Method | Behavior |
|--------|----------|
| **`mount(root, ctx?)`** | `root` is **[`#stats-page-root`](../../stats.html)** (`stats-page-shell`). Clears **`#stats-period-scope`** and **`#stats-container`**, loads data, renders period bar + matrix, binds **`#stats-period-select`** `change` with an **`AbortSignal`**. |
| **`unmount()`** | Idempotent. Aborts the session controller, clears period scope and matrix outlets. |

**Harness:** `stats.html?lifecycleHarness=1` (dev-gated). Console: **`[lifecycleHarness] stats:`** …

---

## MPA wiring

[`quality.html`](../../quality.html) inline `initQualityPage` (after `initI18n`, `renderNavBar('quality')`, `initDayNightTheme`, `initRemainingWakeNav`):

1. Resolve `#quality-container`.
2. Call **`__restoreQualityLifecycle.mount(qualityRoot, {})`**.

Shared nav / `sleep-utils` are unchanged; only the quality outlet is owned by this lifecycle.

---

## Dev harness (MPA)

MPA navigation does not call `unmount`. To exercise **mount → unmount → mount** on localhost / dev-banner context:

1. Open **`quality.html?lifecycleHarness=1`**
2. Require **`isDevBuildContext()`** from [`sleep-utils.js`](../../sleep-utils.js) to be **true** (same rules as the dev banner: local host, query/build-id overrides, etc.).

**Behavior:** After the initial successful `mount`, the inline init runs **`unmount()`** then **`mount(qualityRoot, {})`** again. Console lines prefixed **`[lifecycleHarness] quality:`** (start, after unmount, second mount complete).

**Production / non-dev:** Parameter is ignored; no extra churn.

---

## Relationship to other migration docs

- [listener-audit.md](./listener-audit.md) — classifies `sleep-utils` surface; future routes with listeners extend `unmount` accordingly.
- [decisions.md](./decisions.md) — sleep-data store and refresh policy (**accepted**; [Phase 4](./decisions.md#phase-4)).

---

## Canonical references

- [Dev banner and app-time](../dev-banner.md) — `isDevBuildContext` semantics for the harness gate
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
