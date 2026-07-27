/**
 * Self-referencing rows (`cats` now, `menu_items` in Task 8) nested and guarded
 * in one place. Kept as pure functions over plain arrays/maps so they are
 * testable without a database, and so the SQL stays a flat SELECT — no CONNECT BY.
 */

/**
 * Nests a flat list of rows by their parent pointer.
 *
 * Rows whose parent is absent from `rows` become roots rather than disappearing.
 * That matters when the caller passes a filtered subset (say, active categories
 * only): a visible row is never silently dropped because its parent was excluded.
 * Callers that need "hide the whole branch when an ancestor is hidden" must
 * filter by ancestry before calling this.
 *
 * @template T
 * @param {T[]} rows
 * @param {{ idKey?: string, parentKey?: string, childrenKey?: string, sortBy?: (a: T, b: T) => number }} [options]
 * @returns {T[]} root rows, each with a children array
 */
export function buildTree(rows, options = {}) {
  const { idKey = 'id', parentKey = 'parentId', childrenKey = 'children', sortBy } = options;

  const nodes = new Map(rows.map((row) => [row[idKey], { ...row, [childrenKey]: [] }]));
  const roots = [];

  for (const node of nodes.values()) {
    const parent = node[parentKey] == null ? undefined : nodes.get(node[parentKey]);
    if (parent) {
      parent[childrenKey].push(node);
    } else {
      roots.push(node);
    }
  }

  if (sortBy) {
    const sortRecursive = (list) => {
      list.sort(sortBy);
      for (const node of list) sortRecursive(node[childrenKey]);
    };
    sortRecursive(roots);
  }

  return roots;
}

/**
 * Finds a node that sits inside its own subtree, if any. Returns the offending
 * id, or null when the parent map is a forest.
 *
 * Termination is structural rather than budgeted: each iteration either returns,
 * stops at an already-settled node, or adds a node not yet in `path`, and `path`
 * cannot outgrow the map. A parent id that is not itself a key (a row outside the
 * set being validated) simply ends the walk — it is a missing parent, which is a
 * different error, not a cycle.
 *
 * @param {Map<number, number|null>} parentById
 * @returns {number|null}
 */
export function findCycle(parentById) {
  const settled = new Set();

  for (const start of parentById.keys()) {
    if (settled.has(start)) continue;

    const path = new Set();
    let current = start;

    while (current != null) {
      if (path.has(current)) return current;
      if (settled.has(current)) break;
      path.add(current);
      current = parentById.get(current) ?? null;
    }

    for (const id of path) settled.add(id);
  }

  return null;
}
