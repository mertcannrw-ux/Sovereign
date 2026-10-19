/**
 * Sovereign design tokens - the single source of truth for colour, radius and
 * elevation. `tailwind.config.ts` turns these into utility classes and emits
 * every colour as a CSS variable on `:root` (`background.subtle` becomes
 * `--background-subtle`), so plain CSS, inline styles and utilities can never
 * drift apart. Components never write a raw hex or radius; add a token here.
 */

/* Cool-tinted neutral ramp. Three surface levels, never more. */
export const colors = {
  background: {
    DEFAULT: '#08090B', // base canvas
    subtle: '#111216', // raised: cards, sidebar, popovers
    muted: '#17181D', // hover / elevated
    inverse: '#F4F4F5',
  },
  foreground: {
    DEFAULT: '#FAFAFA', // titles, headings, values
    secondary: '#A1A1AA', // descriptions, supporting copy
    // Timestamps, metadata, labels. #80808A is the lightest touch on #71717A
    // that clears WCAG AA (4.5:1) on all three surfaces: 5.10 / 4.79 / 4.53.
    muted: '#80808A',
    inverse: '#111113',
  },
  border: {
    // Hairlines are translucent white so they read the same on every surface.
    // Do not put an opacity modifier on these (`border-border/50`): Tailwind
    // replaces the alpha instead of multiplying it.
    DEFAULT: 'rgba(255,255,255,0.06)',
    strong: 'rgba(255,255,255,0.10)', // hover / focus-within / control edges
    focus: '#B8FF5A',
  },
  primary: {
    DEFAULT: '#B8FF5A',
    hover: '#C7FF7C',
    light: 'rgba(184,255,90,0.10)',
    foreground: '#11140D',
  },
  success: {
    DEFAULT: '#73D86C',
    light: 'rgba(115,216,108,0.10)',
    foreground: '#0B140A',
  },
  warning: {
    DEFAULT: '#E6B85C',
    light: 'rgba(230,184,92,0.10)',
    foreground: '#171006',
  },
  error: {
    DEFAULT: '#F06A6A',
    light: 'rgba(240,106,106,0.10)',
    foreground: '#190909',
  },
  scrollbar: {
    DEFAULT: 'rgba(255,255,255,0.12)',
    hover: 'rgba(255,255,255,0.20)',
  },
  /*
   * Decorative accents. The lime brand colour is deliberately absent: it is
   * reserved for primary actions, active states and key highlights.
   */
  accent: {
    // Per-project accent line, picked by a hash of the project name.
    'project-1': '#8EA2FF',
    'project-2': '#8BC7FF',
    'project-3': '#D6A7FF',
    'project-4': '#FFBF7A',
    'project-5': '#FF8A8A',
    'project-6': '#8AFFB8',
    'project-7': '#FFD700',
    'project-8': '#FF8AD6',
    // Per-category template sketch colours.
    productivity: '#8EA2FF',
    commerce: '#FFB86B',
    saas: '#62C7F0',
    content: '#D39CF5',
    tools: '#E8D06A',
    health: '#FF8A9A',
    education: '#5ED1BF',
  },
} as const;

const CONTROL = 8;
const ITEM = 6;
const POPOVER_PADDING = 4; // p-1 on menus and segmented controls

/*
 * Radius scale. Nested shapes follow inner = outer - padding, so a popover is
 * its item radius plus its padding and a segmented control's pill is the
 * control radius minus its padding.
 */
export const radius = {
  card: '12px', // cards, modals, large panels
  control: `${CONTROL}px`, // inputs, buttons, search, toggles
  item: `${ITEM}px`, // nav items, menu items, small controls
  popover: `${ITEM + POPOVER_PADDING}px`, // menus wrapping `item`s
  'control-inner': `${CONTROL - POPOVER_PADDING}px`, // pill inside a `control`
  window: '16px', // marketing demo window
} as const;

export const shadows = {
  // Raised surfaces get a 1px top highlight instead of a drop shadow.
  card: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  'card-hover': 'inset 0 1px 0 rgba(255,255,255,0.06), 0 16px 40px rgba(8,9,11,0.5)',
  button: 'inset 0 1px 0 rgba(255,255,255,0.18)',
  popover: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 32px rgba(8,9,11,0.6)',
  dialog: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 32px 100px rgba(8,9,11,0.7)',
  window: '0 30px 80px rgba(8,9,11,0.45)',
} as const;

/** Flatten `colors` into `--name` / `--name-variant` custom properties. */
export function colorVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [group, shades] of Object.entries(colors)) {
    for (const [shade, value] of Object.entries(shades)) {
      vars[shade === 'DEFAULT' ? `--${group}` : `--${group}-${shade}`] = value;
    }
  }
  return vars;
}

export const projectAccents = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--accent-project-${n})`);
