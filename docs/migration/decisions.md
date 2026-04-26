# Migration decisions (ADR log)

**Purpose:** Short, dated decisions for the MPA → SPA path: rollout order, data fetching, internal links vs hash vs path, and pivots. Prefer **links** to canonical docs over duplicating behavior tables.

**Owner todos:** `rollout-lifecycles`, `link-helper`, and related items in [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md).

See [conventions.md](./conventions.md).

---

## Phase 4

**Status:** Complete (Apr 2026).

**Shipped:**

- Canonical routes in [`routes-data.js`](../../routes-data.js) (`window.__restoreRoutesData`), loaded before [`sleep-utils.js`](../../sleep-utils.js); `renderNavBar` reads `navTabs` and `href` from that object (throws if missing).
- This ADR: sleep-data store policy and refresh rules for the SPA target (implementation is **Phase 5+**, not Phase 4).

---

## Phase 5

**Status:** Complete (Apr 2026).

**Shipped:**

- Lifecycle rollout for tab routes is complete and documented in [`lifecycle-contract.md`](./lifecycle-contract.md): dashboard, charts, nightly timeline, log, stats (quality was first proof).
- Pattern-first order executed as planned (quality first, then dashboard → charts → nightly → log → stats), with settings/about intentionally deferred to extraction.

---

## Phase 6

**Status:** Complete (Apr 2026).

**Shipped:**

- Extracted inline init from [`about.html`](../../about.html) and [`settings.html`](../../settings.html) into dedicated modules: [`about.js`](../../about.js) and [`settings.js`](../../settings.js).
- Added `window.__restoreAboutLifecycle` and `window.__restoreSettingsLifecycle` plus dev harness logging (`?lifecycleHarness=1`).

---

## Phase 6.5

**Status:** Complete (Apr 2026).

**Shipped:**

- Added `window.__restoreSleepDataStore` in [`sleep-utils.js`](../../sleep-utils.js) as the single runtime source of truth for sleep data state (`getSnapshot`, `subscribe`, `ensureLoaded`, `refresh`, `invalidate`).
- Wired `loadSleepData(...)` as a compatibility wrapper over store loading, preserving existing caller behavior during migration.
- Added store-driven refresh/invalidation hooks for mutation completion paths and visibility revalidation (`visibilitychange`), with 12h staleness policy (`lastFetchedAt`) active in store state.
- Route lifecycle modules now subscribe/unsubscribe to store snapshots during mount/unmount.

---

## ADR template

Use for new entries:

- **Status:** proposed | accepted | superseded
- **Context:** what forced a choice
- **Decision:** what we chose
- **Consequences:** tradeoffs, follow-ups

---

## Accepted / proposed (fill as work lands)

### `utils-audit` gate (`sleep-utils.js`)

**Status:** accepted (Apr 2026).

**Context:** Inventory listeners, timers, and sticky state in `sleep-utils.js` for SPA navigation (see [listener-audit.md](./listener-audit.md)).

**Decision:** **Proceed incremental in-tree** — no fork mandated by audit alone. Address P0/P1 hotspots in listener-audit (remaining-wake `document` listeners; single `setInterval` / single nav-menu init) during `first-lifecycle` and dashboard second-proof.

**Consequences:** Vite fork remains optional for DX, not a hard gate from entanglement.

**Related (product / UX):** Plan to offer remaining-wake threshold editing **on Settings only**, not on About (see [listener-audit.md — Planned product change](./listener-audit.md#planned-product-change-remaining-wake-settings-only-on-settings)).

---

### Rollout order (pattern-first default)

**Status:** accepted (from parent plan).

**Context:** Risk-first (charts/nightly early) vs pattern-first (small proof → dashboard → harder routes).

**Decision:** **Pattern-first:** first lifecycle proof on **quality or stats** → second proof **dashboard** → **charts** → **nightly** → **log** → sibling stats/quality route → **settings/about** only after inline-init extraction.

**Consequences:** Rollout executed in the documented order through tab routes (Phase 5), then settings/about extraction + lifecycle in Phase 6.

---

### Data fetching / cache / SWR (sleep-data store — SPA target)

**Status:** accepted (Apr 2026).

**Context:** Sleep data is the canonical example of state that **multiple routes need overlapping slices of**, that **mutates from several sources**, and that is **small enough to hold in memory in full**. Today, MPA uses full page loads and `loadSleepData` in [`sleep-utils.js`](../../sleep-utils.js) with in-memory + optional localStorage caching (`SLEEP_DATA_CACHE_TTL_MS`, currently **5 minutes** for TTL-style paths) and `forceRefresh` for some call sites. That behavior is adequate for MPA; the SPA target below **intentionally** moves to a longer staleness window on passive reads so we do not coordinate per-route refetches (and to unblock future UX such as scrollable dashboard ranges).

**Decision:**

1. **Single sleep-data store** — One in-memory canonical copy of the loaded dataset (same conceptual shape as today’s `{ days: [...] }` pipeline). Populate on **app boot** or on **first read** (lazy init is allowed if boot order prefers it).
2. **`loadSleepData({ forceRefresh: true })`** — Reserved for **explicit user refresh**, **post-mutation invalidation** (after writes that change persisted sleep rows), and any other **deliberate** invalidation paths—not for every route transition.
3. **Subscriptions** — Routes **subscribe** to the store on `mount` and **unsubscribe** on `unmount`. They receive updates when the store refreshes; they do not each call `loadSleepData` on every navigation.
4. **When the store refreshes from source** (network / static JSON), in addition to `forceRefresh`:
   - **(a)** App boot / first read (initial fill).
   - **(b)** User mutations **within the app** that change persisted sleep data (invalidate then refresh or apply optimistic update per route—product choice at implementation time, but the store must end consistent with source of truth).
   - **(c)** **Cloud sync completion** (e.g. after pull/push finishes—tie to events already described in [User data and cloud](../user-data-cloud.md)).
   - **(d)** **Tab visibility:** when the document becomes **visible** again after having been **hidden** (`visibilitychange`), revalidate so returning users see fresh data.
   - **(e)** **Stale read threshold:** any read path may trigger a background refresh when **`lastFetchedAt` is older than 12 hours** (policy constant; today’s 5-minute TTL in `sleep-utils` is **not** the SPA end state—implementation will introduce `lastFetchedAt` and the 12h rule on the store).

5. **“Today” and local midnight** — Derived views that depend on **calendar “today”** must **re-derive at local midnight**. That is a **render concern**, not a data-layer fetch: each route that cares schedules its own **midnight boundary timer** (or `requestAnimationFrame` + date check pattern) **on mount** and **clears it on `unmount`**. The store does not emit a special “midnight” fetch unless (a)–(e) already warranted a refresh.

**Consequences:**

- Unblocks **scrollable dashboard ranges** and other multi-slice UIs without per-route `loadSleepData` orchestration.
- Implemented in **Phase 6.5** with a compatibility period: legacy `loadSleepData(...)` callers route through the store while migration to direct store APIs completes.

**Reference:** [User data and cloud](../user-data-cloud.md) — `loadSleepData`, Supabase gate, hydration; do not duplicate storage tables here.

**Related:** [route-table.md](./route-table.md) — `nightly.js` cluster vs charts/stats for which routes share code paths today; subscriptions still go through the one store.

---

### Internal links: MPA hrefs vs future router (hash policy)

**Status:** proposed (placeholder).

**Context:** Today’s `*.html` hrefs, `settings.html#cloud-sync`, `about.html#…`, cross-links such as stats → about anchors. Tab/menu hrefs for nav are centralized in [`routes-data.js`](../../routes-data.js).

**Decision:** *To be filled alongside `link-helper` / router work.*

**Consequences:** *TBD.*

---

## Canonical references

- [User data and cloud](../user-data-cloud.md) — `loadSleepData`, Supabase gate, hydration
- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
