# Canonical route table

**Purpose:** Single place for **ids**, MPA paths (`*.html`), future SPA paths, and how each route relates to nav vs menu-only vs redirect behavior. Shared between today’s nav and a future router.

**Owner todo:** `route-table` (parent plan [`.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md`](../../.cursor/plans/mpa_to_spa_path_9cf9cebf.plan.md)).

See [conventions.md](./conventions.md).

---

## Sources of truth (extract from code)

1. **`renderNavBar`** — embedded `pages[]` (ids, i18n keys, `*.html` URLs).
2. **Hamburger / menu-only links** — e.g. `about.html`, `config.html`, `config.html#cloud-sync` (same area of `sleep-utils.js`).
3. **Root entry** — [`index.html`](../../index.html) meta-refresh (or redirect) to dashboard; SPA cutover must replace with intentional routing.

**Important:** Nav id **`timeline`** maps to **`daily.html`** — keep this id ↔ file mismatch explicit in the table below.

---

## Table template

*To be filled by `route-table`: one row per route.*

| id | mpaPath | spaPath (TBD) | navKind (`tab` / `menu` / `redirect`) | notes |
|----|---------|---------------|----------------------------------------|-------|
| … | … | … | … | … |

Optional later columns: `pageScriptChain` / `entryModule`, `daily.js` inclusion (per parent plan split across pages).

---

## Canonical references

Nav and dev behavior overlap this table; feature specs remain in:

- [Dev banner and app-time](../dev-banner.md)
- [Quick actions](../quick-actions.md)
- [User data and cloud](../user-data-cloud.md)
