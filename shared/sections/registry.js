/**
 * The section registry — one definition of what a page section is, read by the
 * API (to validate `sections.settings` on write), the admin (to render the
 * settings form) and the storefront (to render the section itself).
 *
 * Adding a section type is one entry here plus one React component in the
 * storefront. Nothing else changes: no migration, no API change, no admin form
 * written by hand. `sections.type` deliberately has no CHECK constraint in the
 * database for that reason.
 *
 * Field types the admin knows how to render:
 *   text | textarea | html | number | boolean | select | media | media_list
 *   banner_list | cat_list | coll_ref | cat_ref | prod_list | items
 *
 * `items` is a repeater: a list of objects described by its own `fields`.
 */

/** @typedef {{ key: string, label: string, type: string, help?: string, default?: any, options?: Array<{value: string, label: string}>, min?: number, max?: number, fields?: any[] }} SectionField */

export const SECTIONS = {
  hero: {
    label: 'Hero slider',
    help: 'Full-width banner carousel. Uses each banner’s mobile crop on small screens.',
    fields: [
      { key: 'bannerIds', label: 'Banners', type: 'banner_list', default: [] },
      { key: 'autoplay', label: 'Play automatically', type: 'boolean', default: true },
      { key: 'interval', label: 'Seconds per slide', type: 'number', default: 6, min: 2, max: 30 },
      {
        key: 'height',
        label: 'Height',
        type: 'select',
        default: 'medium',
        options: [
          { value: 'short', label: 'Short' },
          { value: 'medium', label: 'Medium' },
          { value: 'tall', label: 'Tall' },
        ],
      },
    ],
  },

  cat_tiles: {
    label: 'Category tiles',
    help: 'A grid of categories, each with its image.',
    fields: [
      { key: 'title', label: 'Heading', type: 'text', default: '' },
      { key: 'catIds', label: 'Categories', type: 'cat_list', default: [] },
      { key: 'columnsMobile', label: 'Columns on mobile', type: 'number', default: 2, min: 1, max: 3 },
      { key: 'columnsDesktop', label: 'Columns on desktop', type: 'number', default: 4, min: 2, max: 6 },
    ],
  },

  prod_row: {
    label: 'Product row',
    help: 'A row of products from a collection, a category, or your newest and featured items.',
    fields: [
      { key: 'title', label: 'Heading', type: 'text', default: '' },
      {
        key: 'source',
        label: 'Products from',
        type: 'select',
        default: 'newest',
        options: [
          { value: 'collection', label: 'A collection' },
          { value: 'category', label: 'A category' },
          { value: 'manual', label: 'Products I choose' },
          { value: 'newest', label: 'Newest products' },
          { value: 'featured', label: 'Featured products' },
        ],
      },
      { key: 'collId', label: 'Collection', type: 'coll_ref', default: null, showWhen: { source: 'collection' } },
      { key: 'catId', label: 'Category', type: 'cat_ref', default: null, showWhen: { source: 'category' } },
      { key: 'productIds', label: 'Products', type: 'prod_list', default: [], showWhen: { source: 'manual' } },
      { key: 'limit', label: 'How many', type: 'number', default: 8, min: 2, max: 24 },
      {
        key: 'layout',
        label: 'Layout',
        type: 'select',
        default: 'grid',
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'carousel', label: 'Swipeable row' },
        ],
      },
    ],
  },

  promo: {
    label: 'Promo banner',
    help: 'One image with a headline and a button.',
    fields: [
      { key: 'mediaId', label: 'Image', type: 'media', default: null },
      { key: 'mediaMobileId', label: 'Mobile image', type: 'media', default: null, help: 'Optional. A separate crop for phones.' },
      { key: 'heading', label: 'Heading', type: 'text', default: '' },
      { key: 'subheading', label: 'Subheading', type: 'textarea', default: '' },
      { key: 'buttonLabel', label: 'Button label', type: 'text', default: '' },
      { key: 'link', label: 'Button link', type: 'text', default: '' },
    ],
  },

  best: {
    label: 'Best sellers',
    help: 'Until orders exist (Phase 2) this shows your featured products.',
    fields: [
      { key: 'title', label: 'Heading', type: 'text', default: 'Best sellers' },
      { key: 'limit', label: 'How many', type: 'number', default: 8, min: 2, max: 24 },
      {
        key: 'period',
        label: 'Period',
        type: 'select',
        default: 'month',
        options: [
          { value: 'week', label: 'Last 7 days' },
          { value: 'month', label: 'Last 30 days' },
          { value: 'all', label: 'All time' },
        ],
      },
    ],
  },

  features: {
    label: 'Feature icons',
    help: 'Short reassurances — delivery, quality, opening hours.',
    fields: [
      {
        key: 'items',
        label: 'Features',
        type: 'items',
        default: [],
        max: 6,
        fields: [
          { key: 'mediaId', label: 'Icon', type: 'media', default: null },
          { key: 'title', label: 'Title', type: 'text', default: '' },
          { key: 'text', label: 'Text', type: 'textarea', default: '' },
        ],
      },
    ],
  },

  blog: {
    label: 'Blog strip',
    help: 'Hidden until a blog exists — there is no blog in this phase.',
    fields: [
      { key: 'title', label: 'Heading', type: 'text', default: '' },
      { key: 'limit', label: 'How many', type: 'number', default: 3, min: 1, max: 12 },
    ],
  },

  news: {
    label: 'Newsletter',
    fields: [
      { key: 'heading', label: 'Heading', type: 'text', default: '' },
      { key: 'subheading', label: 'Subheading', type: 'textarea', default: '' },
      { key: 'buttonLabel', label: 'Button label', type: 'text', default: 'Subscribe' },
      { key: 'backgroundMediaId', label: 'Background image', type: 'media', default: null },
    ],
  },

  rich: {
    label: 'Rich text',
    fields: [{ key: 'html', label: 'Content', type: 'html', default: '' }],
  },
};

/** @type {string[]} */
export const SECTION_TYPES = Object.keys(SECTIONS);

/** @param {string} type */
export function isSectionType(type) {
  return Object.prototype.hasOwnProperty.call(SECTIONS, type);
}

/** @param {string} type */
export function getSection(type) {
  return SECTIONS[type] ?? null;
}

/**
 * A settings object with every field present, so neither UI has to guard for
 * missing keys on a section saved before a field was added.
 * @param {string} type
 */
export function defaultSettings(type) {
  const section = SECTIONS[type];
  if (!section) return {};
  const settings = {};
  for (const field of section.fields) {
    settings[field.key] = structuredClone(field.default ?? null);
  }
  return settings;
}

/**
 * Fills in anything the stored settings are missing and drops keys the registry
 * no longer declares. Used on both read and write, so a section row can never
 * present a shape the components have not been written against.
 * @param {string} type
 * @param {Record<string, any>|null|undefined} settings
 */
export function normalizeSettings(type, settings) {
  const section = SECTIONS[type];
  if (!section) return {};

  const source = settings ?? {};
  const normalized = {};

  for (const field of section.fields) {
    const value = source[field.key];
    if (value === undefined || value === null) {
      normalized[field.key] = structuredClone(field.default ?? null);
      continue;
    }
    if (field.type === 'items' && Array.isArray(value)) {
      normalized[field.key] = value.slice(0, field.max ?? 20).map((item) => {
        const row = {};
        for (const sub of field.fields ?? []) {
          row[sub.key] = item?.[sub.key] ?? structuredClone(sub.default ?? null);
        }
        return row;
      });
      continue;
    }
    normalized[field.key] = value;
  }

  return normalized;
}

/**
 * The five sections a newly provisioned store's home page starts with, in order
 * (00-SYSTEM-DESIGN.md §6 step 7). A brand-new store is a real page from the
 * first request, not an empty one.
 */
export const DEFAULT_HOME_SECTIONS = ['hero', 'cat_tiles', 'prod_row', 'features', 'news'];
