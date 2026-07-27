import { describe, expect, it } from 'vitest';
import { slugify, resolveSlug, MAX_SLUG_LENGTH } from '../../src/lib/slug.js';
import { buildTree, findCycle } from '../../src/lib/tree.js';

// Pure helpers, no database — cheap to assert exhaustively here so the module
// tests can stay focused on endpoint behaviour.

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Fresh Meat & Poultry')).toBe('fresh-meat-poultry');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it("keeps possessives readable", () => {
    expect(slugify("Chef's Choice")).toBe('chefs-choice');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  it('falls back when nothing latin survives', () => {
    expect(slugify('لحم بقري')).toBe('item');
    expect(slugify('日本語')).toBe('item');
    expect(slugify('!!!', { fallback: 'cat' })).toBe('cat');
  });

  it('caps length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(MAX_SLUG_LENGTH - 1)} b`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(slugify(null)).toBe('item');
    expect(slugify(undefined)).toBe('item');
  });
});

describe('resolveSlug', () => {
  it('returns the base when it is free', () => {
    expect(resolveSlug('beef', ['chicken'])).toBe('beef');
  });

  it('numbers from 2 upwards, skipping taken suffixes', () => {
    expect(resolveSlug('beef', ['beef'])).toBe('beef-2');
    expect(resolveSlug('beef', ['beef', 'beef-2'])).toBe('beef-3');
    expect(resolveSlug('beef', ['beef', 'beef-3'])).toBe('beef-2');
  });

  it('compares case-insensitively', () => {
    expect(resolveSlug('beef', ['BEEF'])).toBe('beef-2');
  });

  it('keeps the suffixed slug within the length cap', () => {
    const base = 'a'.repeat(MAX_SLUG_LENGTH);
    expect(resolveSlug(base, [base]).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });
});

describe('buildTree', () => {
  const rows = [
    { id: 1, parentId: null, name: 'Beef', position: 1 },
    { id: 2, parentId: null, name: 'Aged', position: 0 },
    { id: 3, parentId: 1, name: 'Ribs', position: 1 },
    { id: 4, parentId: 1, name: 'Steaks', position: 0 },
  ];

  it('nests children under parents', () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id).sort()).toEqual([1, 2]);
    expect(tree.find((n) => n.id === 1).children.map((n) => n.id).sort()).toEqual([3, 4]);
  });

  it('sorts every level when given a comparator', () => {
    const tree = buildTree(rows, { sortBy: (a, b) => a.position - b.position });
    expect(tree.map((n) => n.id)).toEqual([2, 1]);
    expect(tree[1].children.map((n) => n.id)).toEqual([4, 3]);
  });

  it('treats a row whose parent is missing from the set as a root', () => {
    const tree = buildTree([{ id: 9, parentId: 404, name: 'Orphan' }]);
    expect(tree.map((n) => n.id)).toEqual([9]);
  });

  it('does not mutate the input rows', () => {
    const input = [{ id: 1, parentId: null }];
    buildTree(input);
    expect(input[0].children).toBeUndefined();
  });

  it('returns an empty array for no rows', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('findCycle', () => {
  it('returns null for a forest', () => {
    expect(findCycle(new Map([[1, null], [2, 1], [3, 1], [4, null]]))).toBeNull();
  });

  it('finds a self-parent', () => {
    expect(findCycle(new Map([[1, 1]]))).toBe(1);
  });

  it('finds a two-node loop', () => {
    expect(findCycle(new Map([[1, 2], [2, 1]]))).not.toBeNull();
  });

  it('finds a longer loop', () => {
    expect(findCycle(new Map([[1, 3], [2, 1], [3, 2]]))).not.toBeNull();
  });

  it('tolerates a parent that is not a key', () => {
    expect(findCycle(new Map([[1, 99]]))).toBeNull();
  });
});
