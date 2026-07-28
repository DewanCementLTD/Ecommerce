/**
 * Colours, radii and fonts are exposed as Tailwind tokens that resolve to the
 * CSS variables set from the database, so `bg-primary` in a component means
 * "whatever this store's primary is" rather than a fixed hex. There is no
 * literal colour anywhere in the storefront's markup.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        ink: 'var(--c-text)',
        muted: 'var(--c-muted)',
        line: 'var(--c-border)',
        primary: 'var(--c-primary)',
        'primary-ink': 'var(--c-primary-text)',
        accent: 'var(--c-accent)',
        sale: 'var(--c-sale)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-md)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
      },
      maxWidth: { prose: '68ch' },
    },
  },
  plugins: [],
};
