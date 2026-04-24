# Restore — copy, voice, and editorial workflow

Canonical reference for **tone, constraints, and process** when writing or revising user-facing text for Restore (About, Settings, nav hints, tooltips, `data-i18n` strings). Implementation is scattered across HTML, `locales.json`, and related UI; this doc does not duplicate existing screen copy.

---

## Goals

- One voice across **explainer** (About), **controls** (Settings), and **short labels** (nav, buttons).
- Copy matches **actual behavior**; avoid invented features or medical claims.
- Text feels at home next to the UI: **dark-first**, calm, direct, precise where the product is precise (schedules, averages, guidance).

---

## Voice

| Dimension | Guidance |
|-----------|----------|
| Audience | Adults tracking sleep for insight and habit change; no shame, no hustle framing. |
| Tone | Calm, warm enough to feel human, confident without preaching. |
| Register | **Settings**: short, scannable; labels and help text stay compact. **About**: can go longer for one conceptual section at a time; still plain language. |
| Person | Second person **you** for instructions and “what you’ll see”; avoid heavy **we** unless it clearly helps. |
| Clarity | Define domain terms once (e.g. session vs calendar day, guidance vs target). Prefer concrete behavior over vague wellness language. |
| Playfulness | Light emoji is acceptable where the UI already uses it for wayfinding; do not let emoji carry essential meaning alone (accessibility). |

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

Use **`styles.css`** `:root` and component naming as **tone cues** only: night surfaces, sleep-related accents, quality ramps, optional playful controls (e.g. pace metaphors). Copy should sound like that system: **unhurried, clear, instrument-panel accurate** — not startup hype and not clinical cold.

For color semantics tied to sleep events and quality, see `docs/semantic-keyword-palette.md` where relevant.

---

## Editorial / AI assistant workflow

Use an external model as a **tightening** partner, not a rewrite-from-scratch author.

1. **Anchor with facts**: Brief bullet list of what the feature does (inputs, outputs, edge cases). Instruct the model not to contradict this list.
2. **Paste only the chunk** under revision (paragraph or section), plus this doc’s **Voice** and **Non-goals** bullets.
3. **Ask for staged output**: e.g. (1) tighten + unify voice without changing meaning; (2) optional shorter variant for Settings-style space.
4. **i18n**: If the source uses `data-i18n`, ask for **English prose** plus a note like “proposed `locales.json` path: `config.*`” without breaking key structure.

### Session prompt template (copy into the AI)

```markdown
You are my editorial assistant for Restore, a sleep tracking web app. Follow the project voice doc at `docs/restore-copy-voice.md` (calm, direct, plain language; no medical claims; no guilt; Settings terse, About can be longer where explained).

Product facts I assert (do not contradict):
- [Paste 3–10 bullets: behavior, limits, naming like “Tonight”, session vs calendar day, etc.]

Task:
- Revise ONLY the draft below. First pass: tighten and unify voice without changing meaning or adding features. Second (optional): offer a shorter variant if this is Settings-style UI copy.

Constraints:
- Preserve any `data-i18n` keys / HTML structure if I pasted markup; propose locale string changes separately.
- Flag strings that may need aria-label or localization review.

Draft:
[PASTE DRAFT HERE]
```

---

## Maintenance

When **behavior** of a documented feature changes, update **technical docs** or comments as you already do for other subsystems; update this doc only when **voice rules** or **editorial workflow** change — not for every wording tweak on a page.
