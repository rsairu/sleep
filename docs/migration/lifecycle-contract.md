# Lifecycle contract (`mount` / `unmount`)

**Purpose:** Freeze the **route module API** before broad rollout: how a screen attaches to a DOM outlet and releases listeners, timers, and subscriptions.

**Owner todo:** `first-lifecycle` (parent plan [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md)).

See [conventions.md](./conventions.md). **Blocking:** contract text here should match the first implementation PR.

---

## Intended API (draft)

*To be filled by `first-lifecycle` after implementation; names may be adjusted but shape should stabilize.*

- **`mount(root, ctx)`** — `root` is the route outlet element; `ctx` carries shared app context (exact fields TBD).
- **`unmount()`** — idempotent teardown for that route’s registrations, timers, and modal wiring.

**First proof route:** **quality *or* stats only** (a page that already has a dedicated script and a single clear outlet). **Do not** use config/about as the first conversion (inline init + lifecycle = too many variables).

---

## Dev harness (MPA)

MPA never calls `unmount` naturally. A **dev-only** harness (e.g. query param or key) should run **mount → unmount → mount** on the same outlet to prove teardown and re-entry.

*To be filled by `first-lifecycle`: how to invoke harness, expected console checks, and any fixtures.*

---

## Relationship to other migration docs

- [listener-audit.md](./listener-audit.md) — classifies `sleep-utils` surface; informs what `unmount` must cover for routes that still depend on shared lib.
- [decisions.md](./decisions.md) — data refetch on mount vs cache (record after contract exists).

---

## Canonical references

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
