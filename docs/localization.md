# localization

Reference for current localization/i18n implementation details in Restore. This doc is implementation-focused and is intended to support future i18n edits.

Voice and editorial guidance remains canonical in `docs/restore-copy-voice.md`.

---

## Scope and source of truth

- Translation dictionary source is `locales.json` (top-level locale buckets like `en` and `ja`).
- Markup source is `data-i18n`, `data-i18n-aria-label`, and `data-i18n-title` attributes in HTML/fragments/templates.
- Runtime source is `src/lib/i18n.js` (`t`, `loadLocaleDictionary`, `applyTranslations`, `initI18n`, language preference helpers).
- Any change to keyed user-visible copy should keep dictionary entries and keyed markup behavior in sync in the same change.

---

## Locale model and persistence

Implemented in `src/lib/i18n.js`:

- `LANGUAGE_KEY = "sleep-app-language"` in `localStorage`.
- `DEFAULT_LANGUAGE = "en"`.
- `SUPPORTED_LANGUAGES = ["en", "ja"]`.
- `normalizeLanguage(value)` maps `ja`/`ja-*` to `ja`, and everything else to `en`.
- `getLanguagePreference()` order:
  1) stored value, 2) `navigator.language`, 3) default `en`.
- `setLanguagePreference(language)` normalizes and persists, then triggers settings/cloud-related sync hooks.

Implication:

- Browser locales other than Japanese currently collapse to English unless explicitly supported by code changes.

---

## Translation lookup behavior

Implemented in `src/lib/i18n.js`:

- `loadLocaleDictionary()` fetches `locales.json` with `cache: "no-store"`.
- Dictionary fetch/parse failures fall back to `{}` (no hard error UX path).
- `getLocalizedValue(dict, language, key)` resolves dot-path keys and only returns string leaves.
- `t(key, fallback)` fallback order:
  1) preferred language,
  2) English,
  3) provided fallback string (or empty string).

Current constraints:

- No built-in pluralization/gender framework.
- Placeholder replacement is call-site driven (for example simple `.replace(...)` usage where needed).

---

## DOM application contract

Implemented in `src/lib/i18n.js`:

- `applyTranslations(root)` updates:
  - text content for `[data-i18n]`
  - `aria-label` for `[data-i18n-aria-label]`
  - `title` for `[data-i18n-title]`
- Existing text/attribute values are used as runtime fallbacks.
- `initI18n(root)` ensures dictionary load, sets `<html lang>`, then applies translations to `root` (or `document`).

Important behavior:

- `applyTranslations` only applies when computed value is truthy; empty-string dictionary values will not overwrite existing content.

---

## SPA lifecycle integration

Primary integration in `src/spa-app.js`:

- After each route fragment mount and preload, `initI18n(document)` runs before navbar render.
- This ensures newly injected fragment markup gets translated each route activation.

Additional integration points:

- Route files that inject markup with i18n keys (for example `src/routes/log.js`) call translation initialization for their root surfaces.
- Settings language controls route through language preference setters and trigger re-application.

---

## Formatting and locale-sensitive behavior

Current state across runtime utilities:

- `src/lib/time-utils.js` uses clock-format preference (`12h`/`24h`), but `12h` markers are literal `AM`/`PM`.
- Duration formatting remains fixed string style (for example `h`/`m` suffix pattern), not locale-aware grammar.
- Date formatting is mixed:
  - some paths use `toLocaleDateString(lang, ...)`,
  - some paths use fixed `'en-US'` or fixed numeric `M/D` style (`src/lib/nightly.js`).

Implication:

- Copy localization is partially decoupled from date/time/number localization and should be treated as separate implementation work.

---

## Known gaps to account for in future i18n passes

- Inline English remains in runtime UI paths and notifications (for example `src/routes/quick-actions.js` toast text and string comparisons against nav labels).
- Remaining-wake/nav runtime strings are not fully localized yet; backlog is tracked in `docs/remaining-wake.md` under i18n completion notes.
- Locale support is code-gated to `en` and `ja` even if additional dictionaries are added.
- There is no centralized locale-aware formatting layer for durations/labels/relative strings.

---

## Change checklist for thorough i18n edits

- Add/update keys in `locales.json` for affected surfaces.
- Keep keyed markup attributes (`data-i18n*`) aligned with dictionary changes.
- Verify fallback behavior in both preferred locale and English.
- Verify `<html lang>` and language selector flows after route transitions.
- Verify ARIA and visible text both localize.
- Audit runtime-generated strings (toasts, nav states, labels) for hard-coded English.
- Audit date/time/duration formatting consistency for the target locale scope.

