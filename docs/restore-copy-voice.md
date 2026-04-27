# Restore — copy, voice, and editorial workflow

Canonical reference for **tone, constraints, and process** when writing or revising user-facing text for Restore (About, Settings, nav hints, tooltips, `data-i18n` strings). Implementation is scattered across HTML, `locales.json`, and related UI; this doc does not duplicate existing screen copy.

---

## Goals

- One voice across **explainer** (About), **controls** (Settings), and **short labels** (nav, buttons).
- Copy matches **actual behavior**; avoid invented features or medical claims.
- Text feels at home next to the UI: **dark-first**, calm, direct, precise where the product is precise (schedules, averages, guidance).

---

## Voice


| Dimension   | Guidance                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience    | Adults tracking sleep for insight and habit change; no shame, no hustle framing.                                                                        |
| Tone        | Calm, warm enough to feel human, confident without preaching.                                                                                           |
| Register    | **Settings**: short, scannable; labels and help text stay compact. **About**: can go longer for one conceptual section at a time; still plain language. |
| Person      | Second person **you** for instructions and “what you’ll see”; avoid heavy **we** unless it clearly helps.                                               |
| Clarity     | Define domain terms once (e.g. session vs calendar day, guidance vs target). Prefer concrete behavior over vague wellness language.                     |
| Playfulness | Light emoji is acceptable where the UI already uses it for wayfinding; do not let emoji carry essential meaning alone (accessibility).                  |


---

## Non-goals and guardrails

- No **medical** or diagnostic claims; sleep quality and stats are **informational**.
- No **false precision** (avoid implying exact biology or guaranteed timelines unless the product literally implements them).
- Avoid guilt, moralizing, or “you should” piles; prefer neutral descriptions of what the app does and what toggles change.

---

## Surfaces and files

- **About** (`about.html`): narrative + feature orientation; deep dives allowed in sections that explain model behavior.
- **Settings** (`settings.html`): headings, intros, toggle labels, links to About; bias toward **fewer words**.
- **i18n** (`locales.json`): user-visible strings keyed by paths; any copy change that has a `data-i18n` key must stay **in sync** with the English entries (and consider JP if the key exists there).

When adding or changing strings, preserve **HTML entities**, **attributes**, and **anchor ids** unless a routing or spec change explicitly requires updates elsewhere.

---

## Design-aligned wording (not literal CSS)

Use `**styles.css`** `:root` and component naming as **tone cues** only: night surfaces, sleep-related accents, quality ramps, optional playful controls (e.g. pace metaphors). Copy should sound like that system: **unhurried, clear, instrument-panel accurate** — not startup hype and not clinical cold.

For color semantics tied to sleep events and quality, see `docs/semantic-keyword-palette.md` (SKP) where relevant.

---

## Maintenance

When **behavior** of a documented feature changes, update **technical docs** or comments as you already do for other subsystems; update this doc only when **voice rules** or **editorial workflow** change — not for every wording tweak on a page.