# Sovereign - Design System

> **Single source of truth for the visual language.**
> This document describes the palette that actually ships. It supersedes the earlier "Dark Premium" brief (which specified `#202020` surfaces and a `#22C55E → #E8D33E → #F59E0B` accent gradient - that direction was abandoned and its assets have been removed from the codebase).
>
> Canonical values live in `apps/web/src/styles/tokens.ts`. `apps/web/tailwind.config.ts` turns them into utilities and emits every colour as a CSS variable on `:root` (`--background-subtle`, `--accent-saas`, ...). If this document and the tokens disagree, **the tokens win** - update this file.

---

## 1. Direction

- **Dark only.** There is no light theme. `next-themes` is configured with `enableSystem={false}` and `defaultTheme="dark"`.
- **Monochrome base, one accent.** Near-black surfaces and off-white text carry the interface; a single lime accent marks actions and status. Colour is never used decoratively.
- **Editorial, typography-first.** Large negative space, tight tracking on display sizes, flat surfaces, no glassmorphism or neumorphism.
- **Restraint in motion.** Short transitions (150–300ms) on colour, border and opacity. No looping
  background gradients anywhere, the marketing page included (§7). The one sanctioned character
  motion is the Sovereign mascot, and only when a real state drives it (§9.2).
- **8px spatial rhythm.** All spacing derives from the 8px step (see §4).

---

## 2. Colour

### 2.1 Roles

| Role            | Token                  | Value                   | Used for                                              |
| --------------- | ---------------------- | ----------------------- | ----------------------------------------------------- |
| Page background | `background`           | `#08090B`               | app and marketing canvas                              |
| Raised surface  | `background-subtle`    | `#111216`               | cards, sidebar, popovers, dialogs                     |
| Hover surface   | `background-muted`     | `#17181D`               | input fills, hover and active fills                   |
| Inverse surface | `background-inverse`   | `#F4F4F5`               | light-on-dark inversions                              |
| Primary text    | `foreground`           | `#FAFAFA`               | titles, headings, values                              |
| Secondary text  | `foreground-secondary` | `#A1A1AA`               | descriptions, supporting copy                         |
| Tertiary text   | `foreground-muted`     | `#80808A`               | timestamps, metadata, labels, placeholders            |
| Inverse text    | `foreground-inverse`   | `#111113`               | text on inverse surfaces                              |
| Hairline border | `border`               | `rgba(255,255,255,.06)` | dividers, card edges, table rules                     |
| Strong border   | `border-strong`        | `rgba(255,255,255,.10)` | hover / focus-within, control edges                   |
| **Focus**       | `border-focus`         | `#B8FF5A`               | focus rings - always use this, never a bespoke colour |
| **Accent**      | `primary`              | `#B8FF5A`               | primary buttons, active states, key metrics           |
| Accent hover    | `primary-hover`        | `#C7FF7C`               | hover on accent surfaces                              |
| Accent tint     | `primary-light`        | `rgba(184,255,90,.10)`  | selected rows, subtle accent fills                    |
| On-accent text  | `primary-foreground`   | `#11140D`               | text/icons on the accent                              |
| Success         | `success`              | `#73D86C`               | positive state, "generated", connected                |
| Warning         | `warning`              | `#E6B85C`               | caution, degraded, at-limit                           |
| Error           | `error`                | `#F06A6A`               | failures, destructive actions                         |
| On-error text   | `error-foreground`     | `#190909`               | text on `error` fills - **not** white (see §2.3)      |

Each of `success` / `warning` / `error` also has a `-light` variant (`rgba(…,0.10)`) for tinted backgrounds, and a `-foreground` for text placed on the solid colour.

### 2.2 Measured contrast (WCAG 2.2)

Ratios computed with sRGB alpha compositing against the actual surfaces:

| Pair                                     | Ratio   | AA (4.5:1)           |
| ---------------------------------------- | ------- | -------------------- |
| `foreground` on `background`             | 19.08:1 | Pass                 |
| `foreground-secondary` on `background`   | 7.77:1  | Pass                 |
| `foreground-muted` on `background`       | 5.10:1  | Pass                 |
| `foreground-muted` on `background-muted` | 4.53:1  | Pass                 |
| `primary` on `background`                | 16.58:1 | Pass                 |
| `primary-foreground` on `primary`        | 15.48:1 | Pass                 |
| `error-foreground` on `error`            | 6.43:1  | Pass                 |
| white on `error`                         | 3.01:1  | **Fail, do not use** |

### 2.3 Rules

1. **Never write a raw hex in a component.** Always use a token (`bg-background-muted`, `text-foreground-secondary`, `border-border-strong`). If you need a colour that has no token, add a token. The only sanctioned literals are the illustration/editor exceptions listed in §6.
2. **Never use `text-white` on `error`.** `error-foreground` (`#190909`) is the correct pairing at 6.43:1; white is 3.01:1 and fails AA.
3. **`foreground-muted` passes AA at small sizes.** It measures 5.10:1 on `background`, 4.79:1 on `background-subtle` and 4.53:1 on `background-muted`, so it may be used for small text and placeholders anywhere. (`#71717A` was considered and fails AA on every surface.)
4. **Three surface levels, no more.** `background` → `background-subtle` → `background-muted`. Do not stack a fourth (no `subtle` box inside a `subtle` card).
5. **No opacity modifiers on rgba tokens.** `border-border/50` replaces the alpha (it renders 50% white), it does not soften the hairline.
6. **Lime is for action, not decoration.** `primary` marks primary buttons, active states, focus and key highlights only. Eyebrows, badges like "Featured", icon tiles and illustration accents use the neutral ramp or the `accent-*` tokens. The one exception is the brand mark, which is always lime on dark (§9.1).
7. **`border` is decorative.** At ~1.2:1 against `background` it is a divider, not a control outline. Interactive controls must be identifiable without relying on their hairline alone.
8. **Focus is always `border-focus`, at soft strength.** Focus indicators use the `border-focus` colour: inputs take a `border-focus` border plus a `ring-border-focus/30`–`/40` halo (≈3.3:1, above the 3:1 focus-visible minimum); buttons and other controls use `ring-border-focus/40`. Full-strength lime rings are not used - they measure 16.6:1 and read as glare on the dark surface. A focus indicator not based on `border-focus` is a bug.
9. **Alpha steps on the marketing surface.** The floor for body-sized white text is `/48`; lower steps (`/20`–`/45`) are reserved for display type and the sanctioned illustration mock. All landing-page body copy now sits at or above `/48`.
10. **Status colours carry meaning only with a label or icon.** Never signal success/warning/error by hue alone.

---

## 3. Typography

**Family:** `Inter`, falling back to `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Monospace: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`.

| Token             | Size / line-height                  | Weight | Tracking | Use                   |
| ----------------- | ----------------------------------- | ------ | -------- | --------------------- |
| `text-hero`       | `clamp(3rem, 8vw, 7.5rem)` / 0.92   | 900    | −0.04em  | marketing hero        |
| `text-heading`    | `clamp(2.25rem, 5vw, 4rem)` / 1.05  | 800    | −0.03em  | section headings      |
| `text-subheading` | `clamp(1.5rem, 3vw, 2.25rem)` / 1.2 | 700    | −0.02em  | sub-sections          |
| `text-4xl`        | 2.25rem / 2.5rem                    | -      | -        | page titles           |
| `text-3xl`        | 1.875rem / 2.25rem                  | -      | -        | card titles           |
| `text-2xl`        | 1.5rem / 2rem                       | -      | -        | panel titles          |
| `text-xl`         | 1.25rem / 1.75rem                   | -      | -        | lead paragraphs       |
| `text-lg`         | 1.125rem / 1.75rem                  | -      | -        | emphasis              |
| `text-base`       | 1rem / 1.5rem                       | -      | -        | body                  |
| `text-sm`         | 0.875rem / 1.25rem                  | -      | -        | UI labels, dense copy |
| `text-xs`         | 0.75rem / 1rem                      | -      | -        | metadata, badges      |

**Rules:** display sizes tighten tracking (`−0.03em` to `−0.045em`); body text stays at 0. `text-xs` (12px) is the floor for informational text - nothing that must be read should go below it.

---

## 4. Space, layout, radius, elevation

**Spacing.** An 8px system: `8 / 16 / 24 / 32 / 48 / 64 / 96 / 120 / 160`. Layout tokens: `sidebar` 280px, `topbar` 56px, `panel` 320px.

> The numeric spacing keys (`'8': '8px'`, `'16': '16px'`, …) that previously overrode Tailwind's defaults and made the scale non-monotonic (`p-8` resolving to 8px; `max-h-96` collapsing to 96px) have been removed. The config now relies on Tailwind's native steps, which already _are_ this scale (`2 / 4 / 6 / 8 / 12 / 16` = 8/16/24/32/48/64px). Only the named layout tokens (`sidebar`, `topbar`, `panel`) are defined.

**Radius.** App chrome uses the semantic scale: `card` 12px (cards, modals, large panels) · `control` 8px (inputs, buttons, search, toggles) · `item` 6px (nav items, menu items, small controls) · `rounded-full` for badges, pills and avatars. Nested shapes follow _inner = outer − padding_: `popover` 10px wraps `item`s with `p-1`, and `control-inner` 4px is the pill inside a `p-1` segmented `control`. Never the same radius inside and outside. The numeric steps (`sm` 6px · `md` 8px · `lg` 12px · `xl` 16px · `2xl` 20px) and `window` 16px remain for the marketing page.

**Elevation.** Dark UI signals depth with surface steps before shadow, but shadows are available: `shadow-sm`, `shadow` (default), `shadow-md`, `shadow-lg`, `shadow-button`, `shadow-card`, `shadow-card-hover`. Raised surfaces (cards, inputs, outline buttons) use `shadow-card`, a 1px inset top highlight; hovered cards use `shadow-card-hover`; popovers and dialogs use `shadow-popover` / `shadow-dialog`; the marketing demo window uses `rounded-window` + `shadow-window`.

---

## 5. Component conventions

- **Buttons.** Primary = `bg-primary text-primary-foreground`. Destructive = `bg-error text-error-foreground`. Secondary = `bg-background-muted text-foreground-secondary`. Ghost and link are boundary-less by design; all others must remain identifiable when unfocused.
- **Focus visible.** Every interactive element needs a visible `border-focus` ring. Never `outline-none` without an equally visible replacement.
- **Targets.** Minimum 24×24px hit area; 44×44px preferred. Icon-only buttons must carry an `aria-label`.
- **Overlays.** Dialog, dropdown, select, tooltip and toast share a single documented z-index scale, and tooltips must be portalled so they are not clipped by scrolling ancestors.
- **Motion.** Respect `prefers-reduced-motion` in **both** CSS and JS (`MotionConfig reducedMotion="user"`). Never apply `animation-duration: 0.01ms !important` to `*` - it freezes spinners and canvas loops. This is the same rule the code generator enforces on generated apps (`docs/agent-runtime.md`).

---

## 6. Open issues

Historically tracked in `docs/design-accessibility-review.md` (removed from the repo); the resolved state of each item:

1. ~~The spacing-key defect above (§4).~~ **Fixed** - the numeric overrides are removed; Tailwind's native steps ship.
2. ~~`foreground-muted` and `border-strong` do not meet WCAG AA.~~ **Fixed** - `foreground-muted` is now `#80807C` (5.02:1 / 4.80:1 / 4.52:1 on the three surfaces; AA at all sizes) and `border-strong` is now `#646460` (3.35:1 / 3.20:1 / 3.02:1 - above the 3:1 non-text minimum on every surface, tuned to the minimum rather than overshooting to keep the dark surface calm). `border` remains a decorative hairline by design; `background-muted` is a fill, not text, and keeps its value.
3. **Sanctioned literal colours.** Everything else now resolves to a token. These keep literal values on purpose, and a reviewer should not "fix" them:
   - the landing page's light "generated site" mock (`components/landing/demo/generated-app.tsx`) - it
     depicts a _different_ website inside the dark chrome, and the visual-editor clip recolours it in
     place to show what an element edit does;
   - the code-sample syntax colours in `components/landing/demo/workspace-panes.tsx` and `apps/web/src/components/code-editor/code-editor.tsx`;
   - the `.code-block` surface in `globals.css` and the code viewer in `components/project/code-pane.tsx` (`#1e1e1e` / `#d4d4d4`) - an editor surface, not app chrome;
   - the Tailwind colour-swatch list in `components/visual-editor/properties-panel.tsx` - those are the colours a _user's generated app_ may pick;
   - the CSS injected into the sandboxed `apps/web/src/lib/visual-editor.ts` overlay - it renders inside the generated app's document, not this one;
   - per-project accent colours and per-category template colours are now tokens (`accent-project-1`…`8`, `accent-productivity`, `accent-commerce`, ...). Template sketches sit on `background-subtle` with a 6% wash of their category accent.
4. ~~Orphan brand art in the abandoned palette.~~ **Removed** - `apps/web/public/logo.svg`, `logo.png` and `logo-transparent.png` (bronze "SOVEREIGN" dragon crest) are deleted; the live mark is the Prompt Shield in `components/Logo.tsx` (`Logo` for the bare mark, `LogoLockup` for mark + wordmark), rendered by the marketing header, auth screens, sidebar and mobile header. `components/brand/logo.tsx` (the ⌘ tile) is deleted. See §9.

---

5. **Mascot spec ahead of the code (§9).** What ships today is a subset of the motion spec; until each item below lands, §9 is the target and the code is behind it:
   - `Logo` states are `idle` / `working` / `done` / `error`. `working` has the mouth mumble but no bob or tilt; `done` is the squint without the hop. `Mascot` adds the random eye blink (idle and working) and is what the editor uses; the dashboard's build marks use the bare `Logo`, so they don't blink.
   - One instance per screen: the editor holds to it (the chat empty state, then only the status row above the prompt box). The sidebar logo is treated as the brand mark, not a mascot instance. The dashboard still shows one mark per building card.
   - `public/favicon.svg` uses the 3.2 caret stroke, not the thicker ~3.6.
   - `public/apple-touch-icon.png` (the reversed mark) uses `#BEF264` / `#0A0A0B` literals instead of `primary` / `primary-foreground`.

---

## 7. Marketing page

`/` is a server component (`app/page.tsx`) that owns only metadata; everything visual lives under `components/landing/`. The composition is server-rendered too: only the header, the FAQ accordion and the three demo films hydrate.

**Visual rules.** The marketing page follows the same rules as the app, with no exception:

- **Flat and monochrome.** No gradients, glows, blurs-as-decoration, grain or ambient animation. The accent fills primary buttons, marks the small square in section labels and colours the brand mark (§9); everything else is the neutral ramp. The mascot may animate here, but only per its motion spec (§9.2).
- **Structure from hairlines.** The page column (`COLUMN`, 1240px) is framed by vertical rails on `xl` screens. Every `Section` opens on a full-bleed `border` rule, with registration crosshairs where it crosses the rails. Grids of cells share borders (`gap-px` over `bg-border`) instead of floating as separate cards.
- **Type.** Display sizes are semibold (600) with `-0.035em` to `-0.045em` tracking. Labels, indices and metadata are mono uppercase at 11px, `0.08em` tracking. Sections are numbered `01`–`08`.
- **Controls.** `primaryButton` and `secondaryButton` in `primitives.tsx` are the only two button styles: 8px radius, 44px tall.
- **No em dashes** in visible copy.
- **Nothing is hidden until JS runs.** There are no scroll reveals; the hero headline is the largest paint and renders visible from the server.

```
components/landing/
├── landing-page.tsx        # server composition: frame rails, header, sections, footer
├── primitives.tsx         # COLUMN / GUTTER, Section, RuleMarks, FrameRails, Eyebrow, SectionHeading, buttons
├── chrome.tsx             # header (client: mobile menu)
├── footer.tsx             # footer
├── hero.tsx               # hero and provider row
├── sections/              # product, visual, trust, convert, faq-item (client)
└── demo/                  # the three scripted product films
    ├── films.tsx          # client wrappers binding each scene script to the player
    ├── demo-player.tsx    # the rAF timeline engine + transport
    ├── build-walkthrough.tsx  # hero film: brief → plan → build → preview → visual → code → history
    ├── closeup-videos.tsx      # element-editor close-up and the BYOK provider panel
    └── app-sidebar / app-header / chat-column / workspace-panes / generated-app / settings-window
```

**Every pixel of UI in `demo/` is a transcription of shipped components**, not an illustration: the sidebar, the 68px editor header, the version timeline, the chat transcript and tool-step list, the prompt composer, the Preview/Code tabs, the code pane, the settings provider roster and the injected visual-editor overlay all copy their labels, metrics and colours from the files in `apps/web/src/{app,components,lib}/`. When the real UI changes, the demo has to change with it.

`demo-player.tsx` autoplays when the player scrolls into view, pauses when it leaves, loops, and - when `prefers-reduced-motion` is set - holds a poster frame until the viewer presses Play.

---

## 8. Auth screens

`/auth/signin`, `/auth/signup`, `/auth/forgot-password` and `/auth/reset-password` share `components/auth/auth-shell.tsx`, which reuses the marketing primitives so the flow reads as a continuation of `/`:

- Same frame: hairline header with the `LogoLockup`, `FrameRails` on `xl`, a footer rule with `RuleMarks`. No background grid, gradient or glow.
- A two-cell `COLUMN` split by a hairline on `lg`: a fixed context panel (mono `Eyebrow`, display line and one line of copy) and the form. Below `lg` only the form shows.
- Submit is `primaryButton`, OAuth is `secondaryButton` with monochrome provider marks. Inputs and alerts take the 8px control radius.

---

## 9. Brand mark & mascot

**Concept.** A shield (ownership, sovereignty, your own keys) containing a terminal prompt `>_` (you build by typing). The same mark is both the logo and the character: the caret `>` is its eye, the cursor `_` is its mouth. The brand name and the character name are the same: **Sovereign**.

**Personality.** Calm, capable, a little cheeky. A serious tool with a small spark of character. Never goofy, never in the way.

### 9.1 The mark

- **Geometry.** `apps/web/src/components/Logo.tsx` is the single source of truth: 32×32 viewBox, flat-top shield with a tight corner radius, caret stroke 3.2 with round caps, the prompt cut out of the shield via a mask (so the mark is transparent on any background). **Never redraw the mark** - always use the component or the exported SVG (`apps/web/public/favicon.svg`).
- **Colour.** The mark is lime (`primary`) on dark backgrounds; `Logo` takes `currentColor` and the `.logo` rule in `globals.css` defaults it to `var(--primary)`. The reversed version is a dark shield on a lime tile, with the prompt cut through to the lime (the app icon). Single colour only: no gradients, no outlines, no shadows.
- **Minimum size.** 16px. The favicon may use a thicker caret stroke (~3.6) for legibility.

### 9.2 Motion spec

Every animation maps to a real state. No decorative motion.

| State   | Behavior                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| idle    | Still. Random blink every 4–8s: caret `scaleY` → 0.1 for ~120ms                                                                                          |
| working | Bob `translateY` 0 → −1.5px, 1.2s loop; mouth mumbles (cursor stretches and shifts irregularly, 1.6s loop); eye keeps random blinks; occasional ±4° tilt |
| done    | One hop (−4px, 300ms) + happy squint (caret `scaleY` 0.4, 400ms), then idle                                                                              |
| error   | One head shake (`translateX` ±2px, 400ms), then idle                                                                                                     |

- Blink timing is always randomized, never a fixed loop.
- The cursor's hard on/off blink is reserved for the trailer opening and the favicon; inside the app, the mouth mumbles instead.
- `prefers-reduced-motion`: eye blink only; no mumble, the mouth stays still.
- **In-product status row:** mascot (20px) + "Sovereign is building…" above the prompt bar while working.

### 9.3 Sound

- One signature sound: a short soft synth blip (~80ms sine pitch-up), synced to the blink.
- Used in trailers, videos and launch content only.
- Never on by default in the app.

### 9.4 Trailer ident

- **Opening:** black screen, lime `_` blinking alone (≈2s), then cut to the product.
- **Closing ident (<3s):** `_` blinks → `>` slides in → shield snaps closed → 0.5s stillness → blink + blip → small hop → "Sovereign" wordmark fades in → cut.
- Identical timing and sound every time. Export as a standalone reusable clip.

### 9.5 Usage rules

**Do:**

- Use the mascot for status (working / done / error), empty states, error pages, onboarding and marketing.
- Keep it small and quiet inside the product.

**Don't:**

- Add arms, legs, extra facial features, speech bubbles or emoji.
- Stretch, rotate permanently, recolour outside the palette, or add effects.
- Animate it without a real state behind the motion.
- Use more than one mascot instance on a screen.

### 9.6 Character family (future: super agents)

Future characters are variants of Sovereign, never new designs.

- **Fixed for all characters:** the shield silhouette, the `>_` face, the motion spec (§9.2), the sound family (§9.3).
- **Each variant changes exactly one trait:** its colour, **or** its eye glyph (the caret), **or** a single small accessory.
- Each variant is named after its role, and its one distinct trait should hint at what it does.
- Add each new variant to this section with its trait and purpose before it ships.

| Variant | Changed trait | Purpose |
| ------- | ------------- | ------- |
| -       | -             | -       |
