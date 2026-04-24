# Migration decisions (ADR log)

**Purpose:** Short, dated decisions for the MPA → SPA path: rollout order, data fetching, internal links vs hash vs path, and pivots. Prefer **links** to canonical docs over duplicating behavior tables.

**Owner todos:** `data-fetching-policy`, `rollout-lifecycles`, `link-helper`, and related items in [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md).

See [conventions.md](./conventions.md).

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

**Decision:** **Proceed incremental in-tree** — no fork mandated by audit alone. Address P0/P1 hotspots in listener-audit (config remaining-wake `document` listeners; single `setInterval` / single nav-menu init) during `first-lifecycle` and dashboard second-proof.

**Consequences:** Vite fork remains optional for DX, not a hard gate from entanglement.

**Related (product / UX):** Plan to offer remaining-wake threshold editing **on Settings only**, not on About (see [listener-audit.md — Planned product change](./listener-audit.md#planned-product-change-remaining-wake-settings-only-on-settings)).

---

### Rollout order (pattern-first default)

**Status:** accepted (from parent plan).

**Context:** Risk-first (graph/daily early) vs pattern-first (small proof → dashboard → harder routes).

**Decision:** **Pattern-first:** first lifecycle proof on **quality or stats** → second proof **dashboard** → **graph** → **daily** → **log** → sibling stats/quality route → **config/about** only after inline-init extraction.

**Consequences:** *To be updated by `rollout-lifecycles` if order changes mid-flight; note rejected alternative and rationale.*

---

### Data fetching / cache / SWR

**Status:** proposed (placeholder).

**Context:** Per-route expectations for `loadSleepData`, refetch on mount, session cache, “fresh after edit”.

**Decision:** *To be filled by `data-fetching-policy`.*

**Consequences:** *TBD.*

**Reference:** [User data and cloud](../user-data-cloud.md) — do not duplicate storage/cache tables here.

---

### Internal links: MPA hrefs vs future router (hash policy)

**Status:** proposed (placeholder).

**Context:** Today’s `*.html` hrefs, `config.html#cloud-sync`, `about.html#…`, cross-links such as stats → about anchors.

**Decision:** *To be filled alongside `link-helper` / router work.*

**Consequences:** *TBD.*

---

## Canonical references

- [User data and cloud](../user-data-cloud.md) — `loadSleepData`, Supabase gate, hydration
- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
