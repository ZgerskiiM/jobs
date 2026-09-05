# Design rules — jobs.dev

> **Purpose.** This is the visual source of truth for all future interface changes. Match the existing jobs.dev interface; do not introduce a parallel visual language. When this document and a new design idea conflict, this document wins unless the product owner explicitly approves a redesign.

## 1. Design character

**Developer terminal, not generic SaaS.** The interface is calm, technical and data-first: a near-black canvas, very restrained green signal, monospaced metadata, thin luminous borders and a subtle grid texture. It should feel like a precise tool for tech hiring, not a gaming dashboard or a glossy cyberpunk poster.

- Keep the canvas dark. Do not add white surfaces, visible colour-band gradients, glass cards, large shadows or rounded “pill” UI.
- Green communicates an active, positive or primary action; pink is an exceptional highlight/warning; cyan is for external/open actions. Neither colour is decoration.
- Let data and hierarchy create visual interest. Ambient glow, grid and scanlines are background details only.
- Prefer compact, plain spoken Russian copy. Technical labels may use lowercase and `//` prefixes.

## 2. Canonical tokens

Use the values already defined in [`frontend/src/index.css`](frontend/src/index.css). Do not create one-off colours, arbitrary opacity values, font families or radii in feature components.

| Role | Token / value | Use |
| --- | --- | --- |
| Page canvas | `--color-bg` / `#07080e` | App background and recessed control interior |
| Primary surface | `--color-surface` / `#0e1018` | Cards, panels and search container |
| Hover surface | `--color-surface-2` / `#141620` | Hovered interactive cards only |
| Main text | `--color-text` / `#e8eaf0` | Readable body copy and data |
| Secondary text | `--color-muted` / `#5a6070` | Descriptions and quiet actions |
| Tertiary text | `--color-muted-2` / `#3a404f` | Labels, indexes and helper text |
| Primary signal | `--color-neon` / `#33ff77` | Selected state, primary CTA, positive data |
| Exceptional signal | `--color-pink` / `#ff3e78` | One notable spike, error or warning |
| External signal | `--color-cyan` / `#00d4ff` | External link/action badges |
| Default border | `--color-border` | Panel/card separation |
| Interactive border | `--color-border-bright` | Hover or selected emphasis |

Use existing helpers rather than cloning their CSS: `card-surface`, `neon-badge`, `pink-badge`, `cyan-badge`, `tag`, `grid-bg`, `scanline`, `neon-glow`, `pink-glow`.

## 3. Typography and copy

| Content | Face | Existing scale / treatment |
| --- | --- | --- |
| Page title | DM Mono, 500 | `text-4xl md:text-6xl`, tight tracking, line-height ~1.1 |
| Section title | DM Mono, 500 | `text-2xl md:text-3xl` |
| Section label, navigation, counts, filter labels | DM Mono | `text-xs`, uppercase where it is a system label, `tracking-widest` |
| Buttons and tags | DM Mono | `text-xs` or `text-sm`; sentence case in Russian |
| Body, names and descriptions | Outfit | `text-sm` or `text-base`; descriptions use muted colour and relaxed leading |

- Use `// название раздела` for low-emphasis system labels; keep them uppercase through styling, not manually mixed casing.
- Highlight at most one meaningful phrase in a heading with neon green. The rest stays white.
- Do not use a third typeface, heavy display weights, all-caps body text or emoji as interface icons.
- Use inline SVG icons with the existing thin-stroke visual weight. Pair an icon-only control with an accessible name.

## 4. Layout and rhythm

- Each main section uses the same frame: `max-w-7xl mx-auto px-6`. Do not introduce a competing content width.
- Work mobile first: one column by default; enhance at `md` and `lg`. Current reference: hero becomes `1fr / 420px` at `lg`; company cards become 2 columns at `sm`, 4 at `lg`.
- Use small radii only: the visual default is `rounded-sm` (4px) and tags use 2px. Never use large rounded cards or fully pill-shaped controls unless it is an on/off switch.
- Preserve the dense rhythm: `gap-2` between list/card rows, `gap-3–4` within compact controls, `p-4–5` for cards, and larger section gaps (`py-12–16`, `mb-16–20`) only between semantic regions.
- Rows are for repeated dense data (vacancies, trends); cards are for standalone summaries (company, CTA, search panel). Do not put every datum in a card.
- On small screens, preserve reading order and wrap filters/actions; never create horizontal page scrolling.

## 5. Component recipes

### Section header

Use a muted mono label (`// ...`), then a mono heading; place a single quiet text action on the right only where it helps navigation. A count can sit beside the label in a small neon badge.

### Surface card

Use `card-surface rounded-sm`. It has a quiet green border, surface background, and only changes border/background on hover. No drop shadow. Use `group` only when a child needs the same hover response.

### Data row

Keep the sequence predictable: low-emphasis index/icon → primary name → supporting value → compact status/change. Values are right-aligned where comparison matters. A row should remain scannable without opening it.

### Buttons and links

- **Primary CTA:** neon fill, dark text, mono, medium weight. Reserve it for the main next step in its region.
- **Secondary CTA:** transparent surface, green border/text, subtle green hover fill.
- **Quiet link:** muted mono text; on hover it may become neon. Use `→` consistently for forward/external navigation.
- **Filters:** compact outlined mono buttons; selected = translucent neon fill + brighter green border; unselected = muted outline.
- Avoid more than one filled primary CTA in one visual region.

### Tags and status

Use the `tag` helper plus a semantic badge helper. Tags are compact mono labels, not rounded chips. Colour must encode a named meaning (positive/primary = green, notable exception = pink, external/open = cyan); never rely on colour alone for status.

### Forms

Inputs sit on `--color-bg` inside a `--color-surface` panel, with a thin default border. Use mono input text and muted placeholder. Preserve a visible keyboard focus treatment when changing `input:focus`; do not remove it without replacement.

### Logo/initial badge

Keep it a small square (not a circle), mono initial(s), translucent company colour fill and matching thin border. It may be colourful because it represents the company, not the UI system.

### Callout / CTA

Use one bordered, low-opacity green surface with optional `scanline` and a single restrained ambient glow. Centre only true CTA content; do not centre ordinary data panels.

## 6. Interaction, motion and accessibility

- Existing interactive transitions are short and purposeful (`~200ms` for surface/colour, up to `300ms` for a small underline). Keep new motion in that range and respect `prefers-reduced-motion` when adding non-essential animation.
- Hover should change colour, border or a small underline—not shift layout or animate large glow/shadow effects.
- Every interactive element needs keyboard reachability, a visible focus state, and at least a 44px touch target when it is a standalone control. Small inline links/tags need sufficient surrounding spacing.
- Maintain readable contrast: primary text on dark backgrounds, muted text only for secondary information, never muted-on-muted.
- Labels must stay visible for controls. Toggle state must also be expressed with `aria-pressed`/native semantics and text, not only colour or position.

## 7. Required review before merging UI work

1. Does the new element use the canonical frame, token palette and two fonts?
2. Is its surface a row, a standalone card, or an existing component recipe—rather than a new visual pattern?
3. Is green limited to selection/action/positive signal and pink/cyan used semantically?
4. Are radius, borders and hover states as restrained as neighbouring elements?
5. Does the layout work in one column first and enhance at `md`/`lg` without horizontal scroll?
6. Can keyboard and screen-reader users operate it, with visible focus and non-colour state cues?
7. Has a screenshot or local preview been compared with the existing home page at desktop and mobile widths?

## 8. Explicit anti-patterns

- White/light cards, high-gloss glassmorphism, large shadows, prominent gradients, 3D illustrations or decorative emoji.
- Large rounded/pill controls, oversized floating action buttons, or multiple neon-filled CTAs competing in one section.
- New arbitrary hex colours, bespoke border opacities, or per-component font/radius rules when a token/helper exists.
- Dense data rendered as a grid of marketing cards; tables or list rows are the established pattern.
- A visual overhaul hidden inside a feature change. Propose it separately and get approval first.

## 9. When the rules need to change

Change this document and the relevant tokens/helpers in the same pull request. Explain why the new pattern is needed, show it in context, and update an existing component to prove it is reusable. Do not solve a local exception with an unrecorded visual rule.
