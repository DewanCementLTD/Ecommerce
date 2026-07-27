export const MAX_SLUG_LENGTH = 200;

/** Matches what `slugify` produces, and what a manually supplied slug must look like. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turns a display name into a URL-safe slug.
 *
 * Non-Latin scripts reduce to nothing here (an Arabic-only product name has no
 * ASCII left after stripping), so `fallback` is what the slug becomes in that
 * case — `resolveSlug` then numbers it. Slugs are deliberately not translated:
 * one row has one slug, and `trans` covers the visible fields instead.
 *
 * @param {string} input
 * @param {{ fallback?: string }} [options]
 * @returns {string}
 */
export function slugify(input, { fallback = 'item' } = {}) {
  const slug = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining accents left behind by NFKD
    .toLowerCase()
    .replace(/['’]/g, '') // don't turn "chef's" into "chef-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug || fallback;
}

/**
 * Given a desired slug and the slugs already taken in this company, returns the
 * first free one — the desired slug itself, or `-2`, `-3`, ... appended.
 *
 * @param {string} base
 * @param {string[]} takenSlugs
 * @returns {string}
 */
export function resolveSlug(base, takenSlugs) {
  const taken = new Set(takenSlugs.map((slug) => String(slug).toLowerCase()));
  if (!taken.has(base)) return base;

  for (let n = 2; n <= 10_000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error(`Could not find a free slug for "${base}" after 10000 attempts`);
}
