# Migration decisions (ADR log)

**Purpose:** Short, dated decisions for the MPA → SPA path: rollout order, data fetching, internal links vs hash vs path, and pivots. Prefer **links** to canonical docs over duplicating behavior tables.

**Owner todos:** `rollout-lifecycles`, `link-helper`, and related items in [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md).

See [conventions.md](./conventions.md).

---

## Phase 4

**Status:** Complete (Apr 2026).

**Shipped:**

- Canonical routes (`window.__restoreRoutesData`); implementation lives in [`routes-data.mjs`](../../routes-data.mjs) (Phase 8 ES module + `installRoutesData` for Node tests; was `routes-data.js` through Phase 7), loaded before [`sleep-utils.js`](../../sleep-utils.js); `renderNavBar` reads `navTabs` and `href` from that object (throws if missing).
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

## Phase 7 (`link-helper`)

**Status:** Complete (Apr 2026).

**Shipped:**

- `window.__restoreRoutesData.mpaHref(key)` in [`routes-data.mjs`](../../routes-data.mjs) with a semantic registry for tab/menu URLs and deep-link fragments; [`sleep-utils.js`](../../sleep-utils.js) nav/menu/app block and remaining-wake link use it; [`nightly.js`](../../nightly.js) dashboard and quality heatmap links use `restoreMpaHref(key)`.
- **Internal links** ADR accepted below; static `<a href>` in HTML shells remain literals with a parity checklist in [route-table.md](./route-table.md#static-html-internal-links-parity).

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

**Status:** accepted (Apr 2026).

**Context:** The app used scattered `*.html` and `#fragment` strings in JS templates and static HTML. Tab/menu base URLs already lived on `__restoreRoutesData` (`navTabs`, `href`). SPA navigation will need one place to swap MPA paths for path-based routes and optional `pushState`.

**Decision:**

1. **MPA (now):** All **JavaScript-generated** internal navigation targets go through **`__restoreRoutesData.mpaHref(key)`** (see [`routes-data.mjs`](../../routes-data.mjs)). Keys compose from the same `navTabs` / `href` data so overrides stay centralized.
2. **SPA (later):** Prefer **path-based routes** (e.g. `/charts`) and **preserve today’s fragment strings** for deep links (e.g. `/charts#chart-bed-asleep-wake`). Anchor IDs used for scroll targets (e.g. on [`charts.js`](../../charts.js)) stay stable; scrolling remains a **route module concern**. Moving anchors exclusively into URL path segments would be a **separate** ADR.
3. **Router (future):** Intercept **primary** left-clicks on **internal** links for in-app navigation; **do not** break modified clicks (e.g. Ctrl/Cmd/meta, shift) or **middle-click** — those should perform a normal full navigation (new tab / window) per platform conventions.
4. **[`index.html`](../../index.html)** is now the **Vite SPA shell** (Phase 9); `routes-data` is imported from [`src/spa-app.js`](../../src/spa-app.js) so it initializes before `sleep-utils.js`. Legacy `*.html` bookmarks are unchanged until Phase 9b redirects.

**Consequences:**

- Pivot work can add `spaHref(key)` (or a mode on the resolver) without touching every call site.
- Static HTML links are documented in [route-table.md — Static HTML parity](./route-table.md#static-html-internal-links-parity); when changing a URL or hash, update **both** the registry row and the literal `href`, or grep will drift.

---

### ES modules and script orchestration (MPA shells)

**Status:** accepted (Apr 2026).

**Context:** `type="module"` scripts are deferred by default; a classic script placed after a module tag can still run before the module, breaking `routes-data` before `sleep-utils` unless the whole shell uses a consistent defer strategy.

**Decision:**

1. **Shell script list:** Use **`defer` on every** tail `<script src>` in each HTML shell, including the first `dev-git-branch.js`. Load [`routes-data.mjs`](../../routes-data.mjs) as **`<script type="module" src="routes-data.mjs" defer></script>`** in the same ordered list so deferred modules and deferred classics execute in **document order** after the document is parsed.
2. **Page init:** Inline `init*Page` blocks are moved to deferred **`*-boot.js`** files that appear **after** route lifecycle scripts so globals from `sleep-utils` / route modules exist before boot runs.
3. **No new `window.*` globals** in this phase beyond what already existed; `installRoutesData` is the supported way to attach `__restoreRoutesData` on non-browser globals (e.g. vm sandboxes).
4. **Relative URLs:** Keep same-origin relative paths for static `src`/`import` until hosting/pivot defines a base URL policy.

**Consequences:** Optional follow-up: convert leaf route scripts (`stats.js`, `about.js`, …) to ESM one at a time; keep [`sleep-utils.js`](../../sleep-utils.js) classic until a bundler phase unless a dedicated refactor is scheduled. Vite/pivot can replace the shell list with a single entry import graph.

---

## Phase 8 (`module-migration`)

**Status:** Complete (Apr 2026).

**Shipped:**

- [`routes-data.mjs`](../../routes-data.mjs): native ES module with `export` of `navTabs`, `href`, `mpaHref`, and `installRoutesData(globalObj)` for vm/Node consumers; browser installs on `globalThis` when `document` is defined; **`globalThis.__restoreRoutesData`** unchanged for [`sleep-utils.js`](../../sleep-utils.js) / [`nightly.js`](../../nightly.js).
- All substantive HTML shells use **`defer`** on the shared script chain, **`type="module"`** + `defer` for `routes-data.mjs`, and deferred **`*-boot.js`** replacing inline page init (ordering: deferred classics + module run in document order after parse).
- [`math-tests.js`](../../math-tests.js) loads routes via `import()` + `installRoutesData(context)` before `sleep-utils` in the vm sandbox.

---

## Phase 9 (Vite + SPA shell + Vercel)

**Status:** Complete (Apr 2026).

**Shipped:**

- **Vite** — [`vite.config.js`](../../vite.config.js), [`package.json`](../../package.json) scripts `dev` / `build` / `preview`; production output in `dist/`.
- **SPA shell** — root [`index.html`](../../index.html) with `#nav-container`, `#spa-outlet`, shared `#tooltip` / `#day-panel`; [`src/spa-app.js`](../../src/spa-app.js) imports [`routes-data.mjs`](../../routes-data.mjs) first, sets `globalThis.__restoreUseSpaNav`, implements History navigation, modifier-safe link interception, and fetches MPA shell HTML to hydrate outlet markup before `mount` (dev: root `*.html`; production: `/mpa/*.html` — see Phase 9b).
- **Path routes + hashes** — `spaHref(key)`, `spaPathForTabId`, `internalNavHref(key)` on `__restoreRoutesData`; [`sleep-utils.js`](../../sleep-utils.js) nav/menu uses them when `__restoreUseSpaNav` is set; [`nightly.js`](../../nightly.js) dashboard links use `internalNavHref`.
- **Vercel** — [`vercel.json`](../../vercel.json) SPA fallback **rewrites** to `index.html`; Phase **9b** adds root `*.html` **redirects** and `/mpa/` shell copies so static assets and the fragment fetch path keep working.

---

## Phase 9b (legacy `*.html` redirects + fragment fetch)

**Status:** Complete (Apr 2026).

**Context:** Bookmarks and external links still pointed at root `*.html` (MPA filenames). A naive host redirect would break the SPA, which **`fetch()`es** those same filenames to hydrate [`src/spa-app.js`](../../src/spa-app.js) outlet markup.

**Decision:**

1. **Vercel [`redirects`](../../vercel.json)** — Permanent redirects (308) from root `/dashboard.html`, `/log.html`, … `/settings.html`, and `/index.html` → canonical path URLs (`/timeline` for `nightly.html`). Listed **before** the SPA catch-all `rewrites` entry.
2. **Fragment HTML under `/mpa/`** — [`vite.config.js`](../../vite.config.js) copies MPA shells into `dist/mpa/*.html` only (not at site root). [`src/spa-app.js`](../../src/spa-app.js) uses `import.meta.env.PROD` to fetch `mpa/<file>` in production and the root `<file>` in dev (`npm run dev`) so local development does not require a duplicate tree.
3. **URL fragments (hashes)** — HTTP redirects are decided on the path **without** the fragment (the browser does not send `#…` to the server). A request to `GET /settings.html` redirects to `/settings`; the client may re-apply `location.hash` only if the user had a full-URL bookmark (browser-dependent). Deep links after redirect are best expressed as **`/settings#cloud-sync`** in new content; SPA in-app navigation already preserves hash.

**Consequences:**

- **`npm run preview` / plain static servers** without Vercel-style redirects do not rewrite `*.html` URLs; production behavior is defined for Vercel. For other hosts, mirror the same redirect + `/mpa/` static layout or accept legacy URLs until configured.
- Root `*.html` is **not** present in `dist/` after build; only [`dist/mpa/`](../../dist/mpa/) holds the fetched shells.

---

## Canonical references

- [User data and cloud](../user-data-cloud.md) — `loadSleepData`, Supabase gate, hydration
- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
