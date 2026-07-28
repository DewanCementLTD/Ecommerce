/**
 * Shared outliner math for the two nested drag-reorder lists (categories, menu
 * items): a flat, depth-indented array in display order is the only state kept
 * client-side; parent/position are always re-derived from it before saving, so
 * drag + indent/outdent can never disagree with what gets persisted.
 */

/** Depth can only ever increase by one step at a time, and the first row is always depth 0. */
export function clampDepths(nodes) {
  let prevDepth = -1;
  return nodes.map((n) => {
    const depth = Math.min(n.depth, prevDepth + 1);
    prevDepth = depth;
    return { ...n, depth };
  });
}

/** A node's parent is the nearest preceding node exactly one level shallower. */
export function deriveParentsAndPositions(nodes) {
  const stack = [];
  const siblingCount = new Map();
  return nodes.map((node) => {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    const key = parent ? parent.id : 'root';
    const position = siblingCount.get(key) ?? 0;
    siblingCount.set(key, position + 1);
    stack.push({ depth: node.depth, id: node.id });
    return { ...node, parentId: parent ? parent.id : null, position };
  });
}

export function flattenTree(nodes, depth = 0) {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenTree(node.children ?? [], depth + 1)]);
}
