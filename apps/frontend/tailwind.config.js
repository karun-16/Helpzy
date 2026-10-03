/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        /*
         * Semantic surfaces and text, driven by the CSS variables in
         * `global.css`. Because these read a variable rather than a fixed hex,
         * a `bg-surface` card is correct in both themes with no `dark:`
         * counterpart, which is what stops white cards holding near-invisible
         * text.
         */
        canvas: 'rgb(var(--hz-canvas) / <alpha-value>)',
        surface: 'rgb(var(--hz-surface) / <alpha-value>)',
        'surface-muted': 'rgb(var(--hz-surface-muted) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--hz-surface-sunken) / <alpha-value>)',

        primary: 'rgb(var(--hz-text-primary) / <alpha-value>)',
        secondary: 'rgb(var(--hz-text-secondary) / <alpha-value>)',
        muted: 'rgb(var(--hz-text-muted) / <alpha-value>)',

        hairline: 'rgb(var(--hz-border) / <alpha-value>)',
        'hairline-strong': 'rgb(var(--hz-border-strong) / <alpha-value>)',

        /*
         * Surfaces that sit on a dark brand panel and therefore must NOT follow
         * the theme. The hero is brand-800 in both themes, so a chip inside it
         * stays white in both; `surface` would have flipped to slate-900 and left
         * dark-on-dark text. Deliberately literal rather than a variable.
         */
        inverse: '#ffffff',
        'inverse-text': '#1743b2',
        'inverse-muted': '#d9ebff',
        'inverse-border': '#8ec6ff',

        /*
         * `brand` stays the raw HELPZY blue scale so existing
         * `bg-brand-800` / `text-brand-300` call sites keep their meaning.
         * `action*` is the theme-aware pair new shared components use.
         */
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#2f85fb',
          600: '#1b65f0',
          700: '#1550dc',
          800: '#1743b2',
          900: '#193d8c',
          950: '#102a5c',
        },
        action: 'rgb(var(--hz-brand) / <alpha-value>)',
        'action-hover': 'rgb(var(--hz-brand-hover) / <alpha-value>)',
        /*
         * Separate pair for a *filled* primary button. `--hz-brand` lightens in
         * dark mode so it stays readable as accent text on a dark canvas, which
         * makes it far too pale to sit behind white button text. These stay dark
         * in both themes so white-on-fill always clears 4.5:1.
         */
        'action-fill': 'rgb(var(--hz-brand-fill) / <alpha-value>)',
        'action-fill-hover': 'rgb(var(--hz-brand-fill-hover) / <alpha-value>)',
        'action-soft': 'rgb(var(--hz-brand-soft) / <alpha-value>)',
        'action-text': 'rgb(var(--hz-brand-text) / <alpha-value>)',

        success: 'rgb(var(--hz-success) / <alpha-value>)',
        'success-soft': 'rgb(var(--hz-success-soft) / <alpha-value>)',
        warning: 'rgb(var(--hz-warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--hz-warning-soft) / <alpha-value>)',
        danger: 'rgb(var(--hz-danger) / <alpha-value>)',
        'danger-soft': 'rgb(var(--hz-danger-soft) / <alpha-value>)',
      },
      borderRadius: {
        card: '10px',
        control: '8px',
      },
      fontFamily: {
        sans: ['Aptos', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
