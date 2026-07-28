/**
 * Theme tokens -> CSS custom properties.
 *
 * Every colour, font, radius and shadow in the storefront reads from a variable
 * set here, so changing a company's theme is a database write and a page load —
 * never a rebuild, and never a code branch. A component that hardcodes a colour
 * is a bug: it would make one store's look impossible to change from the admin.
 *
 * Fonts and header/footer variants are tokens too. "The two themes differ only
 * in tokens and header/footer variant" only holds if the variant *selection* is
 * itself data; an `if (company.slug === ...)` anywhere would be the architecture
 * failing, per HOW-TO-USE.md.
 */

/** Self-hosted faces the platform ships. A theme names one of these keys. */
export const FONT_STACKS = {
  bricolage: "'Bricolage Grotesque', 'Cairo', system-ui, sans-serif",
  publicsans: "'Public Sans', 'Cairo', system-ui, sans-serif",
  manrope: "'Manrope', 'Cairo', system-ui, sans-serif",
};

/**
 * Used when a company has no theme row yet, and as the floor under a partial
 * one — a theme missing a key must never render an unstyled page.
 */
export const DEFAULT_TOKENS = {
  color: {
    bg: '#ffffff',
    surface: '#f7f7f5',
    text: '#16181d',
    muted: '#5c6270',
    border: '#e3e4e8',
    primary: '#16181d',
    primaryText: '#ffffff',
    accent: '#3d5afe',
    sale: '#c0392b',
  },
  font: { display: 'manrope', body: 'manrope' },
  radius: { sm: '6px', md: '10px', lg: '18px', pill: '999px' },
  layout: { header: 'classic', footer: 'columns' },
};

function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = merge(base[key] ?? {}, value);
    } else if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Accepts both the Phase 0 flat token shape (primaryColor, backgroundColor...)
 * and the nested Phase 1 shape, so the demo stores seeded before this existed
 * still render correctly.
 */
export function normalizeTokens(raw) {
  const tokens = raw ?? {};

  const legacy = {
    color: {
      primary: tokens.primaryColor,
      accent: tokens.secondaryColor,
      bg: tokens.backgroundColor,
      text: tokens.textColor,
    },
  };

  return merge(merge(DEFAULT_TOKENS, legacy), tokens);
}

/** The inline style object applied to <html>. */
export function tokensToCssVars(tokens) {
  const vars = {};
  for (const [key, value] of Object.entries(tokens.color)) {
    vars[`--c-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  for (const [key, value] of Object.entries(tokens.radius)) {
    vars[`--r-${key}`] = value;
  }
  vars['--font-display'] = FONT_STACKS[tokens.font.display] ?? FONT_STACKS.manrope;
  vars['--font-body'] = FONT_STACKS[tokens.font.body] ?? FONT_STACKS.manrope;
  return vars;
}

/** RTL is a property of the language, not of the store. */
export const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

export function dirFor(lang) {
  return RTL_LANGS.has((lang ?? '').split('-')[0]) ? 'rtl' : 'ltr';
}
