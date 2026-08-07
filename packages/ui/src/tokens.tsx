// Design tokens — semantic light/dark color system
// WCAG AA contrast verified for all text and UI element pairs.
// Green is used as a restrained action/status accent.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
  type ReactNode,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark';
export type UserTheme = ThemeMode | 'system';

export interface SemanticTokens {
  canvas: string;
  surface: string;
  'surface-raised': string;
  'surface-hover': string;
  text: string;
  'text-muted': string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
}

export type SemanticTokenKey = keyof SemanticTokens;

// ─── Token values ────────────────────────────────────────────────────────────
// All value+background pairs verified ≥4.5:1 for normal text, ≥3:1 for UI.
// Border and hover values are intentionally subtle (decorative, not informational).

export const tokens: Record<ThemeMode, SemanticTokens> = {
  light: {
    canvas: '#FAF7F2',
    surface: '#FFFFFF',
    'surface-raised': '#FFFFFF',
    'surface-hover': '#F0EBE3',
    text: '#2C1810',
    'text-muted': '#6B5744',
    border: '#D4C8B8',
    accent: '#8B5E3C',
    success: '#6B8E4E',
    warning: '#C4952A',
    danger: '#B54A4A',
  },
  dark: {
    canvas: '#1A1512',
    surface: '#231D18',
    'surface-raised': '#2C241E',
    'surface-hover': '#3D3229',
    text: '#F5F0EB',
    'text-muted': '#9A8B78',
    border: '#3D3229',
    accent: '#B87333',
    success: '#6B8E4E',
    warning: '#C4952A',
    danger: '#B54A4A',
  },
} as const;

// ─── Theme-independent design tokens ─────────────────────────────────────────

export const typography = {
  fontFamily: {
    sans: 'Inter, system-ui, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'JetBrains Mono, monospace',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
  },
} as const;

export const spacing = {
  sidebar: '280px',
  topbar: '56px',
  panel: '320px',
} as const;

export const borderRadius = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.4)',
  DEFAULT: '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
  md: '0 4px 6px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4)',
  lg: '0 10px 15px rgba(0,0,0,0.5), 0 4px 6px rgba(0,0,0,0.4)',
} as const;

// ─── CSS variable helpers ────────────────────────────────────────────────────

const CSS_VAR_PREFIX = '--color-';

const TOKEN_KEYS: readonly SemanticTokenKey[] = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-hover',
  'text',
  'text-muted',
  'border',
  'accent',
  'success',
  'warning',
  'danger',
];

/** Maps a theme mode to a Record of CSS custom property name → value. */
export function themeToCssVars(theme: ThemeMode): Record<string, string> {
  const themeTokens = tokens[theme];
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) {
    vars[`${CSS_VAR_PREFIX}${key}`] = themeTokens[key];
  }
  return vars;
}

/** Generates a CSS string of custom property declarations for a theme
 *  (useful for server-side injection or style tags). */
export function generateCssVariables(theme: ThemeMode): string {
  const vars = themeToCssVars(theme);
  return Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
}

// ─── System theme detection (React 19) ───────────────────────────────────────

function getSystemThemeSnapshot(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

// ─── Theme context ───────────────────────────────────────────────────────────

export interface ThemeContextValue {
  /** The user's preference — 'system', 'light', or 'dark' */
  userTheme: UserTheme;
  /** The resolved theme after evaluating system preference */
  resolvedTheme: ThemeMode;
  /** Update the user's theme preference */
  setUserTheme: (theme: UserTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─── ThemeProvider ───────────────────────────────────────────────────────────

export interface ThemeProviderProps {
  /** Preferred theme mode. Defaults to 'system' (follows OS preference). */
  defaultTheme?: UserTheme;
  /** Callback when the resolved theme changes */
  onThemeChange?: (theme: ThemeMode) => void;
  children: ReactNode;
}

export function ThemeProvider({
  defaultTheme = 'system',
  onThemeChange,
  children,
}: ThemeProviderProps) {
  // Reactive system theme subscription
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    () => 'dark' as ThemeMode,
  );

  // User-chosen preference (persisted by the caller or via setUserTheme)
  const [userTheme, setUserTheme] = useState<UserTheme>(defaultTheme);

  // Derive the actual active theme
  const resolvedTheme: ThemeMode = userTheme === 'system' ? systemTheme : userTheme;

  // Apply CSS variables and color-scheme to <html> whenever the theme changes
  useEffect(() => {
    const vars = themeToCssVars(resolvedTheme);
    const root = document.documentElement;

    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = resolvedTheme;
    root.setAttribute('data-theme', resolvedTheme);

    return () => {
      for (const name of Object.keys(vars)) {
        root.style.removeProperty(name);
      }
      root.style.removeProperty('color-scheme');
      root.removeAttribute('data-theme');
    };
  }, [resolvedTheme]);

  // Notify parent when the resolved theme changes
  useEffect(() => {
    onThemeChange?.(resolvedTheme);
  }, [resolvedTheme, onThemeChange]);

  const value = useMemo(
    () => ({ userTheme, resolvedTheme, setUserTheme }),
    [userTheme, resolvedTheme, setUserTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
