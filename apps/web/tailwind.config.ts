import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { colorVariables, colors, radius, shadows } from './src/styles/tokens';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
        serif: ['Georgia', '"Times New Roman"', 'serif'],
        mono: ['"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      fontSize: {
        hero: [
          'clamp(3rem, 8vw, 7.5rem)',
          { lineHeight: '0.92', letterSpacing: '-0.04em', fontWeight: '900' },
        ],
        heading: [
          'clamp(2.25rem, 5vw, 4rem)',
          { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '800' },
        ],
        subheading: [
          'clamp(1.5rem, 3vw, 2.25rem)',
          { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' },
        ],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        sidebar: '280px',
        topbar: '56px',
        panel: '320px',
      },
      borderRadius: {
        // Numeric steps stay for the marketing page; app chrome uses the
        // semantic `card` / `control` / `item` scale from tokens.ts.
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
        ...radius,
      },
      boxShadow: {
        sm: '0 1px 2px rgba(8,9,11,0.08)',
        DEFAULT: '0 1px 3px rgba(8,9,11,0.5), 0 1px 2px rgba(8,9,11,0.4)',
        md: '0 4px 6px rgba(8,9,11,0.5), 0 2px 4px rgba(8,9,11,0.4)',
        lg: '0 10px 15px rgba(8,9,11,0.5), 0 4px 6px rgba(8,9,11,0.4)',
        ...shadows,
      },
    },
  },
  plugins: [
    // Every colour token is also a CSS variable, so globals.css and inline
    // styles read the same values as the utilities.
    plugin(({ addBase }) => {
      addBase({ ':root': colorVariables() });
    }),
  ],
};

export default config;
