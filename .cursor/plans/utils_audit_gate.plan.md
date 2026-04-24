---
name: sleep-utils listener audit (gate)
overview: Systematically inventory `sleep-utils.js` listeners, timers, and sticky global state; classify each row for SPA navigation; write results into [docs/migration/listener-audit.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/listener-audit.md) and a short gate verdict (incremental in-tree vs Vite fork risk).
todos:
  - id: inventory-listeners
    content: Extract every addEventListener (and removeEventListener if paired) in sleep-utils.js with line + owning function/init path
    status: completed
  - id: inventory-timers-raf
    content: List setInterval/setTimeout/requestAnimationFrame + clears; note IDs stored on window/module scope
    status: completed
  - id: inventory-global-state
    content: Note module-level or window-attached singletons that imply one-time init (flags, caches, modal stacks)
    status: completed
  - id: classify-table
    content: Fill listener-audit.md table (per-route vs app-singleton vs per-element) + teardown notes per row
    status: completed
  - id: gate-verdict
    content: Summarize open questions and migration risk; add ADR stub or paragraph in decisions.md if audit forces a pivot (optional)
    status: completed
isProject: false
---

# Next todo: `utils-audit` — `sleep-utils.js` gate

**Parent:** [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](c:/Users/UriasRey/Desktop/sleep_proj/.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md) (workstream 2).

**Output doc:** [docs/migration/listener-audit.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/listener-audit.md) (replace stub sections with the audit table and filled open questions).

## Goal

Classify everything in [`sleep-utils.js`](c:/Users/UriasRey/Desktop/sleep_proj/sleep-utils.js) that must behave correctly when navigation becomes in-app: **listeners**, **timers**, and **global state** that outlives a single MPA page load. Outcome is a **migration gate**: either incremental SPA is tractable, or entanglement warrants a **Vite fork** (per parent plan criterion).

**Out of scope for this todo:** Auditing `graph.js`, `daily.js`, or other page scripts (note cross-deps in open questions only). Those follow lifecycle rollout.

## Method

1. **Listeners** — Use ripgrep with line numbers on `sleep-utils.js` for `addEventListener`. Deduplicate string literals in comments or docs. For each hit, record approximate **init path** (e.g. `renderNavBar`, `initDevBannerDrawer`, `initRemainingWakeNav`) and **target** (`document`, `window`, specific element).
2. **Timers / rAF** — Same file: `setInterval`, `setTimeout`, `requestAnimationFrame`; trace whether a `clearInterval` / `clearTimeout` / `cancelAnimationFrame` exists and whether teardown is reachable on hypothetical route leave.
3. **Global state** — Skim top-level `let`/`var` caches, “already bound” flags, modal or overlay singletons referenced by multiple inits.
4. **Classification** — For each row use the three classes already defined in `listener-audit.md`: **per-route**, **app-singleton**, **per-element / subtree**. When unsure, mark **TBD** with a one-line reason.
5. **Gate verdict** — Short summary at bottom of `listener-audit.md`: count of risky per-route leaks, singleton assumptions that conflict with remounting outlet-only routes, and recommendation.

## Baseline counts (re-verify during audit)

Ripgrep on current tree is a starting point only; line counts can include comments or non-code matches:

- `addEventListener` in `sleep-utils.js`: re-count in editor after filtering.
- Timer / rAF patterns: enumerate explicitly (do not rely on count alone).

## Acceptance criteria

- [listener-audit.md](c:/Users/UriasRey/Desktop/sleep_proj/docs/migration/listener-audit.md) contains a **filled table** (or grouped sub-tables by subsystem: nav, dev banner, modals, i18n, cloud, etc.) with classifications and teardown notes.
- **Open questions** section lists unresolved singleton vs route coupling (if any).
- **Gate verdict** paragraph states **proceed incremental** vs **flag Vite fork** with concrete triggers tied to table rows.

## After this todo

Unblock **`first-lifecycle`** (mount/unmount on quality or stats) with confidence about what shared `sleep-utils` assumes across route changes.
