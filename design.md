# Sovereign — Design System

> **Single source of truth for the visual language.**
> This document describes the palette that actually ships. It supersedes the earlier "Dark Premium" brief (which specified `#202020` surfaces and a `#22C55E → #E8D33E → #F59E0B` accent gradient — that direction was abandoned and its assets have been removed from the codebase).
>
> Canonical values live in `apps/web/tailwind.config.ts` (`theme.extend.colors`) and `apps/web/src/app/globals.css` (`:root`). If this document and the config disagree, **the config wins** — update this file.

---

## 1. Direction

- **Dark only.** There is no light theme. `next-themes` is configured with `enableSystem={false}` and `defaultTheme="dark"`.
- **Monochrome base, one accent.** Near-black surfaces and off-white text carry the interface; a single lime accent marks actions and status. Colour is never used decoratively.
- **Editorial, typography-first.** Large negative space, tight tracking on display sizes, flat surfaces, no glassmorphism or neumorphism.
- **Restraint in motion.** Short transitions (150–300ms) on colour, border and opacity. No looping background gradients.
- **8px spatial rhythm.** All spacing derives from the 8px step (see §4).

---

## 2. Colour

### 2.1 Roles

| Role            | Token                  | Value                  | Used for                                              |
| --------------- | ---------------------- | ---------------------- | ----------------------------------------------------- |
| Page background | `background`           | `#090909`              | app and marketing canvas                              |
| Subtle surface  | `background-subtle`    | `#101010`              | cards, popovers, inset panels                         |
| Muted surface   | `background-muted`     | `#171717`              | input fills, raised rows, hover fills                 |
| Inverse surface | `background-inverse`   | `#F4F4F0`              | light-on-dark inversions                              |
| Primary text    | `foreground`           | `#D6D6D2`              | headings, body, primary labels                        |
| Secondary text  | `foreground-secondary` | `#B8B8B2`              | supporting copy, secondary labels                     |
| Muted text      | `foreground-muted`     | `#80807C`              | placeholders, timestamps, captions                    |
| Inverse text    | `foreground-inverse`   | `#11110F`              | text on inverse surfaces                              |
| Hairline border | `border`               | `#242422`              | dividers, card edges, table rules                     |
| Strong border   | `border-strong`        | `#646460`              | control boundaries, emphasized edges                  |
| **Focus**       | `border-focus`         | `#B8FF5A`              | focus rings — always use this, never a bespoke colour |
| **Accent**      | `primary`              | `#B8FF5A`              | primary buttons, active states, key metrics           |
| Accent hover    | `primary-hover`        | `#C7FF7C`              | hover on accent surfaces                              |
| Accent tint     | `primary-light`        | `rgba(184,255,90,.10)` | selected rows, subtle accent fills                    |
| On-accent text  | `primary-foreground`   | `#11140D`              | text/icons on the accent                              |
| Success         | `success`              | `#73D86C`              | positive state, "generated", connected                |
| Warning         | `warning`              | `#E6B85C`              | caution, degraded, at-limit                           |
| Error           | `error`                | `#F06A6A`              | failures, destructive actions                         |
| On-error text   | `error-foreground`     | `#190909`              | text on `error` fills — **not** white (see §2.3)      |

Each of `success` / `warning` / `error` also has a `-light` variant (`rgba(…,0.10)`) for tinted backgrounds, and a `-foreground` for text placed on the solid colour.

### 2.2 Measured contrast (WCAG 2.2)

Ratios computed with sRGB alpha compositing against the actual surfaces:

| Pair                                   | Ratio   | AA (4.5:1)            |
| -------------------------------------- | ------- | --------------------- |
| `foreground` on `background`           | 13.66:1 | ✅                    |
| `foreground-secondary` on `background` | 9.99:1  | ✅                    |
| `foreground-muted` on `background`     | 5.02:1  | ✅                    |
| `primary` on `background`              | 16.58:1 | ✅                    |
| `primary-foreground` on `primary`      | 15.48:1 | ✅                    |
| `error-foreground` on `error`          | 6.43:1  | ✅                    |
| white on `error`                       | 3.01:1  | ❌ **do not do this** |

### 2.3 Rules

1. **Never write a raw hex in a component.** Always use a token (`bg-background-muted`, `text-foreground-secondary`, `border-border-strong`). If you need a colour that has no token, add a token. The only sanctioned literals are the illustration/editor exceptions listed in §6.
2. **Never use `text-white` on `error`.** `error-foreground` (`#190909`) is the correct pairing at 6.43:1; white is 3.01:1 and fails AA.
3. **`foreground-muted` passes AA at small sizes.** It measures 5.02:1 on `background`, 4.80:1 on `background-subtle` and 4.52:1 on `background-muted`, so it may be used for small text and placeholders anywhere.
4. **`border` is decorative.** At 1.28:1 against `background` it is a divider, not a control outline. Interactive controls must be identifiable without relying on their hairline alone.
5. **Focus is always `border-focus`, at soft strength.** Focus indicators use the `border-focus` colour: inputs take a `border-focus` border plus a `ring-border-focus/30`–`/40` halo (≈3.3:1, above the 3:1 focus-visible minimum); buttons and other controls use `ring-border-focus/40`. Full-strength lime rings are not used — they measure 16.6:1 and read as glare on the dark surface. A focus indicator not based on `border-focus` is a bug.
6. **Alpha steps on the marketing surface.** The floor for body-sized white text is `/48`; lower steps (`/20`–`/45`) are reserved for display type and the sanctioned illustration mock. All landing-page body copy now sits at or above `/48`.
7. **Status colours carry meaning only with a label or icon.** Never signal success/warning/error by hue alone.

---

## 3. Typography

**Family:** `Inter`, falling back to `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Monospace: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`.

| Token             | Size / line-height                  | Weight | Tracking | Use                   |
| ----------------- | ----------------------------------- | ------ | -------- | --------------------- |
| `text-hero`       | `clamp(3rem, 8vw, 7.5rem)` / 0.92   | 900    | −0.04em  | marketing hero        |
| `text-heading`    | `clamp(2.25rem, 5vw, 4rem)` / 1.05  | 800    | −0.03em  | section headings      |
| `text-subheading` | `clamp(1.5rem, 3vw, 2.25rem)` / 1.2 | 700    | −0.02em  | sub-sections          |
| `text-4xl`        | 2.25rem / 2.5rem                    | —      | —        | page titles           |
| `text-3xl`        | 1.875rem / 2.25rem                  | —      | —        | card titles           |
| `text-2xl`        | 1.5rem / 2rem                       | —      | —        | panel titles          |
| `text-xl`         | 1.25rem / 1.75rem                   | —      | —        | lead paragraphs       |
| `text-lg`         | 1.125rem / 1.75rem                  | —      | —        | emphasis              |
| `text-base`       | 1rem / 1.5rem                       | —      | —        | body                  |
| `text-sm`         | 0.875rem / 1.25rem                  | —      | —        | UI labels, dense copy |
| `text-xs`         | 0.75rem / 1rem                      | —      | —        | metadata, badges      |

**Rules:** display sizes tighten tracking (`−0.03em` to `−0.045em`); body text stays at 0. `text-xs` (12px) is the floor for informational text — nothing that must be read should go below it.

---

## 4. Space, layout, radius, elevation

**Spacing.** An 8px system: `8 / 16 / 24 / 32 / 48 / 64 / 96 / 120 / 160`. Layout tokens: `sidebar` 280px, `topbar` 56px, `panel` 320px.

> The numeric spacing keys (`'8': '8px'`, `'16': '16px'`, …) that previously overrode Tailwind's defaults and made the scale non-monotonic (`p-8` resolving to 8px; `max-h-96` collapsing to 96px) have been removed. The config now relies on Tailwind's native steps, which already _are_ this scale (`2 / 4 / 6 / 8 / 12 / 16` = 8/16/24/32/48/64px). Only the named layout tokens (`sidebar`, `topbar`, `panel`) are defined.

**Radius.** `sm` 6px · `md` 8px · `lg` 12px · `xl` 16px · `2xl` 20px · `card` 20px · `window` 16px. Pills (`rounded-full`) are reserved for primary CTAs and status chips.

**Elevation.** Dark UI signals depth with surface steps before shadow, but shadows are available: `shadow-sm`, `shadow` (default), `shadow-md`, `shadow-lg`, `shadow-button`, `shadow-card`, `shadow-card-hover`. Radii and shadows must not be mixed arbitrarily — cards use `card` + `shadow-card`; windows use `window`.

---

## 5. Component conventions

- **Buttons.** Primary = `bg-primary text-primary-foreground`. Destructive = `bg-error text-error-foreground`. Secondary = `bg-background-muted text-foreground-secondary`. Ghost and link are boundary-less by design; all others must remain identifiable when unfocused.
- **Focus visible.** Every interactive element needs a visible `border-focus` ring. Never `outline-none` without an equally visible replacement.
- **Targets.** Minimum 24×24px hit area; 44×44px preferred. Icon-only buttons must carry an `aria-label`.
- **Overlays.** Dialog, dropdown, select, tooltip and toast share a single documented z-index scale, and tooltips must be portalled so they are not clipped by scrolling ancestors.
- **Motion.** Respect `prefers-reduced-motion` in **both** CSS and JS (`MotionConfig reducedMotion="user"`). Never apply `animation-duration: 0.01ms !important` to `*` — it freezes spinners and canvas loops. This is the same rule the code generator enforces on generated apps (`docs/agent-runtime.md`).

---

## 6. Open issues

Historically tracked in `docs/design-accessibility-review.md` (removed from the repo); the resolved state of each item:

1. ~~The spacing-key defect above (§4).~~ **Fixed** — the numeric overrides are removed; Tailwind's native steps ship.
2. ~~`foreground-muted` and `border-strong` do not meet WCAG AA.~~ **Fixed** — `foreground-muted` is now `#80807C` (5.02:1 / 4.80:1 / 4.52:1 on the three surfaces; AA at all sizes) and `border-strong` is now `#646460` (3.35:1 / 3.20:1 / 3.02:1 — above the 3:1 non-text minimum on every surface, tuned to the minimum rather than overshooting to keep the dark surface calm). `border` remains a decorative hairline by design; `background-muted` is a fill, not text, and keeps its value.
3. **Sanctioned literal colours.** Everything else now resolves to a token. These keep literal values on purpose, and a reviewer should not "fix" them:
   - the landing page's light "generated site" mock (`app/page.tsx`) — it depicts a _different_ website inside the dark chrome;
   - the code-sample syntax colours on `app/page.tsx` and `apps/web/src/components/code-editor/code-editor.tsx`;
   - the `.code-block` surface in `globals.css` and the code viewer in `components/project/code-pane.tsx` (`#1e1e1e` / `#d4d4d4`) — an editor surface, not app chrome;
   - the Tailwind colour-swatch list in `components/visual-editor/properties-panel.tsx` — those are the colours a _user's generated app_ may pick;
   - the CSS injected into the sandboxed `apps/web/src/lib/visual-editor.ts` overlay — it renders inside the generated app's document, not this one;
   - per-project accent colours (`app/dashboard/page.tsx`) and per-category template palettes (`app/dashboard/templates/page.tsx`) — intentional art.
4. ~~Orphan brand art in the abandoned palette.~~ **Removed** — `apps/web/public/logo.svg`, `logo.png` and `logo-transparent.png` (bronze "SOVEREIGN" dragon crest) are deleted; the live mark is the inline `Logo()` in `app/page.tsx`.
