# Listener and singleton audit (`sleep-utils.js`)

**Purpose:** Migration **gate** for [`sleep-utils.js`](../../sleep-utils.js): classify everything that must behave correctly when navigation becomes in-app (SPA) instead of full page loads.

**Owner todo:** `utils-audit` (parent plan [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md)).

See [conventions.md](./conventions.md) for how this doc relates to canonical feature specs.

---

## Scope

Audit **all** of the following together (not listeners alone):

- `addEventListener` / `removeEventListener` (or one-shot patterns that never remove)
- **Timers** (`setInterval`, `setTimeout`, `requestAnimationFrame` where it acts like a subscription)
- **Global or module-level state** that survives route changes (singletons, caches, “already initialized” flags)

Rough baseline from the parent plan: on the order of **~57** `addEventListener` registrations in `sleep-utils.js` (re-count during audit).

---

## Classification (use for every row)

| Class | Meaning |
|-------|---------|
| **Per-route** | Should tear down when leaving a screen; must move behind route `unmount` or equivalent |
| **App-singleton** | One registration for the app lifetime; safe if shell/nav persists |
| **Per-element / subtree** | Bound to DOM that is replaced with the route; teardown follows subtree removal |

*To be filled by `utils-audit`: table of registrations with file:line, handler purpose, class, and teardown notes.*

---

## Open questions

*To be filled by `utils-audit`: e.g. entanglement between nav singletons and page-specific listeners, modal wiring, dev-banner init order.*

---

## Canonical references

Shared nav and dev tooling live here; do not duplicate full specs:

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
