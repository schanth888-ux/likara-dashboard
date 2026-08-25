# Brand Theme — Likara AI

**These are proposed defaults, not approved brand guidelines.** No color palette,
logo, or type spec was supplied in the original brief — the tokens below are a
reasonable placeholder tying back to the brand story ("Lika" = light, "Ara" = to
bring to light: a warm gold "light" accent against a deep, trustworthy base).
**Replace every value here the moment real brand guidelines exist** — shipping a
placeholder as if it were final is exactly the kind of thing that undermines the
"feels like a real product, not an internal tool" goal this file exists to serve.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--likara-gold` | `#D4A017` | Primary accent — buttons, links, active states, the "light" motif |
| `--likara-gold-hover` | `#B8890F` | Hover/active state of the above |
| `--likara-navy` | `#1B2430` | Primary text, headers, nav background |
| `--likara-charcoal` | `#2E3844` | Secondary surfaces, cards |
| `--likara-off-white` | `#FAF9F6` | Page background (light mode) |
| `--likara-green` | `#2E7D32` | Success / high-performance district cards / "paid" status |
| `--likara-amber` | `#ED6C02` | Warning / medium-performance / "upcoming" status |
| `--likara-red` | `#C62828` | Danger / low-performance / "late" status |
| Font (Latin) | `"Inter", -apple-system, sans-serif` | Clean, neutral, reads well at small sizes on mobile |
| Font (Chinese, both scripts) | `"Noto Sans SC", "Noto Sans HK", sans-serif` | Consistent weight/x-height alongside Inter — avoids the mismatched look of relying on the OS default CJK font |

## Applying this in Retool (current plan — see `docs/08-frontend-options.md`)

Retool supports custom CSS at the app level (Settings → Theme → Custom CSS in most
current versions — check your installed version's exact path, this menu shifts
between releases). Paste:

```css
:root {
  --likara-gold: #D4A017;
  --likara-gold-hover: #B8890F;
  --likara-navy: #1B2430;
  --likara-charcoal: #2E3844;
  --likara-off-white: #FAF9F6;
  --likara-green: #2E7D32;
  --likara-amber: #ED6C02;
  --likara-red: #C62828;
}

body {
  font-family: "Inter", "Noto Sans SC", "Noto Sans HK", -apple-system, sans-serif;
}

/* Primary buttons */
button[data-variant="primary"], .button.primary {
  background-color: var(--likara-gold) !important;
  border-color: var(--likara-gold) !important;
}
button[data-variant="primary"]:hover, .button.primary:hover {
  background-color: var(--likara-gold-hover) !important;
}

/* Top nav */
.app-header, [data-testid="app-header"] {
  background-color: var(--likara-navy) !important;
}
```

Retool's exact CSS class/data-attribute names shift between releases and aren't
officially documented as a stable API — inspect the rendered DOM in your actual
installed version and adjust the selectors above rather than trusting them verbatim.
The CSS custom properties (`:root` block) are the stable part, safe to rely on as-is,
and are exactly what carries over unchanged when you apply this same file to Appsmith
at stage 2 (only the component selectors below the `:root` block need re-targeting —
Appsmith's are typically class names like `.bp3-button.bp3-intent-primary` or
`.ads-v2-button`, again version-dependent, so re-inspect rather than reuse blindly).

## Where this matters most

Every list page's status badges (paid/late/upcoming, high/medium/low priority,
red/yellow/green lease expiry, district performance cards) should use these
tokens consistently — a client evaluating the product against a competitor
notices color inconsistency between pages faster than almost anything else.
