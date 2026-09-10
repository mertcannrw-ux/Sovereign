import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#090909',
          subtle: '#101010',
          muted: '#171717',
          inverse: '#F4F4F0',
        },
        foreground: {
          DEFAULT: '#F7F7F5',
          secondary: '#B8B8B2',
          muted: '#74746E',
          inverse: '#11110F',
        },
        border: {
          DEFAULT: '#242422',
          strong: '#383835',
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
        accent: {
          bronze: '#9C8060',
          copper: '#B28B62',
          gold: '#D4B66E',
          parchment: '#F4F4F0',
        },
      },
      fontFamily: {
        sans: [
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
        '8': '8px',
        '16': '16px',
        '24': '24px',
        '32': '32px',
        '48': '48px',
        '64': '64px',
        '96': '96px',
        '120': '120px',
        '160': '160px',
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
        card: '20px',
        window: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.08)',
        DEFAULT: '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)',
        md: '0 4px 6px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.4)',
        lg: '0 10px 15px rgba(0,0,0,0.5), 0 4px 6px rgba(0,0,0,0.4)',
        button: '0 1px 2px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.12)',
        card: '0 30px 80px rgba(0,0,0,.45)',
        'card-hover': '0 40px 100px rgba(0,0,0,.55), 0 0 40px rgba(255,255,255,.03)',
      },
      animation: {
        'gradient-shift': 'gradientShift 8s ease infinite',
        float: 'float 6s ease-in-out infinite',
        glow: 'glow 3s ease-in-out infinite alternate',
        typing: 'typing 3.5s steps(40, end)',
        'cursor-blink': 'cursorBlink 1s step-end infinite',
      },
      keyframes: {
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(16,163,127,0.15)' },
          '100%': { boxShadow: '0 0 40px rgba(16,163,127,0.3)' },
        },
        typing: {
          from: { width: '0' },
          to: { width: '100%' },
        },
        cursorBlink: {
          'from, to': { borderColor: 'transparent' },
          '50%': { borderColor: '#10A37F' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
