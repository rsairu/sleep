# Semantic Keyword Palette (SKP)

**SKP** is the app’s shared mapping from sleep-domain **keywords** (bed, sleep, wake, alarm, nap, …) to **CSS custom properties**. Use this name when discussing theme, chart colors, or timeline styling so everyone means the same token set.

## Source of truth

All SKP variables are defined on `:root` and overridden for light UI on `[data-theme="day"]` in [`styles.css`](../styles.css). Do not copy hex values into other files as a second source; reference the variables.

## Canonical variables

| Token | Typical meaning | CSS variable |
|--------|-----------------|--------------|
| Bed | Bed time, SOL / bed-adjacent metrics | `--color-bed` |
| Sleep | Main sleep span, asleep, duration series | `--color-sleep` |
| Nap | Nap segment | `--color-nap` |
| Wake / get up | Wake time, wake delay | `--color-up` |
| Alarm | Alarm events | `--color-alarm` |
| Bath | Bathroom events | `--color-bath` |
| Sunrise / sun | Sunrise-related accents | `--color-sunrise` |
| Warning | Errors, destructive emphasis | `--color-warning` |

Related non-keyword UI tokens (`--panel`, `--text`, `--grid`, etc.) live in the same file but are not “keyword-colored” series.

## Usage rules

1. **New UI** that colors bed / sleep / wake (or other keywords above) should use SKP variables in CSS, or `currentColor` / inherited color from a parent that sets `color: var(--color-…)`.
2. **Avoid hardcoded hex** for those semantics so day/night theme and future palette tweaks stay consistent.
3. **Charts and timelines** should match the daily view: e.g. timeline `.event.bed` and graph `.data-line.bedtime` both lean on `--color-bed`; sleep bars use `--color-sleep` / `--color-nap` as appropriate.

## In this repo

- **Daily timeline**: classes such as `.event.bed`, `.span.sleep`, `.event.up`.
- **Graph page**: `.data-line.*`, `.data-point.*`, `.sleep-bar`, wake marker rings, dashed trend lines tied to the same variables.

When adding a feature, if the copy says “bed”, “asleep”, or “wake”, default to the matching SKP variable unless there is a deliberate exception.
