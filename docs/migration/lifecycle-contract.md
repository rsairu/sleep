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

**Behavior:** After the initial successful `mount`, the inline init runs **`unmount()`** then **`mount(qualityRoot, {})`** again. Console: **`[lifecycleHarness] quality: mount → unmount → mount`**.

**Production / non-dev:** Parameter is ignored; no extra churn.

---

## Relationship to other migration docs

- [listener-audit.md](./listener-audit.md) — classifies `sleep-utils` surface; future routes with listeners extend `unmount` accordingly.
- [decisions.md](./decisions.md) — data refetch on mount vs cache (per-route policy still TBD).

---

## Canonical references

- [Dev banner and app-time](../dev-banner.md) — `isDevBuildContext` semantics for the harness gate
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
