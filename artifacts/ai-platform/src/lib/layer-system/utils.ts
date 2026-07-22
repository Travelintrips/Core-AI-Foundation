/**
 * Universal Design Layer System — Pure Utilities
 *
 * All functions are deterministic and pure (no side-effects, no I/O).
 * No domain-specific logic lives here.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import type {
  FlatLayerNode,
  LayerCapability,
  LayerMutation,
  LayerNode,
  LayerSelection,
  LayerTree,
  LayerTreeValidationResult,
} from "./types";

// ── Internal helpers ──────────────────────────────────────────────────────────

function sortByOrder(nodes: LayerNode[]): LayerNode[] {
  return [...nodes].sort((a, b) => a.order - b.order);
}

// ── Tree construction ─────────────────────────────────────────────────────────

/**
 * Build a hierarchical LayerTree from a flat list of nodes.
 * Orphans (parentId points to a non-existent node) are silently promoted to roots
 * so the UI never crashes — callers should run `validateLayerTree` first if they
 * need strict enforcement.
 */
export function buildLayerTree(
  flat: FlatLayerNode[],
  artifactId: string,
  version = 0,
): LayerTree {
  const idSet = new Set(flat.map((n) => n.id));
  const nodeMap = new Map<string, LayerNode>();

  // Initialise all nodes with empty children arrays
  for (const f of flat) {
    nodeMap.set(f.id, { ...f, children: [] });
  }

  const roots: LayerNode[] = [];

  for (const f of flat) {
    const node = nodeMap.get(f.id)!;
    if (f.parentId === null || !idSet.has(f.parentId)) {
      roots.push(node);
    } else {
      nodeMap.get(f.parentId)!.children.push(node);
    }
  }

  // Sort children by order at every level
  function sortChildren(node: LayerNode): LayerNode {
    return { ...node, children: sortByOrder(node.children).map(sortChildren) };
  }

  return {
    artifactId,
    roots: sortByOrder(roots).map(sortChildren),
    version,
  };
}

/**
 * Flatten a LayerTree into a depth-first ordered array of all nodes.
 * Children are visited before siblings (pre-order DFS).
 */
export function flattenLayerTree(tree: LayerTree): LayerNode[] {
  const result: LayerNode[] = [];

  function visit(nodes: LayerNode[]): void {
    for (const node of nodes) {
      result.push(node);
      visit(node.children);
    }
  }

  visit(tree.roots);
  return result;
}

// ── Node lookup ───────────────────────────────────────────────────────────────

/** Find a node by ID. Returns undefined if not found. */
export function findLayer(tree: LayerTree, id: string): LayerNode | undefined {
  return flattenLayerTree(tree).find((n) => n.id === id);
}

/**
 * Find all ancestors of a node, ordered from immediate parent to root.
 * Returns an empty array if the node is a root or not found.
 */
export function findAncestors(tree: LayerTree, id: string): LayerNode[] {
  const all = flattenLayerTree(tree);
  const byId = new Map(all.map((n) => [n.id, n]));
  const ancestors: LayerNode[] = [];
  let current = byId.get(id);
  while (current?.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/**
 * Find all descendants of a node (DFS, pre-order).
 * Returns an empty array for leaf nodes.
 */
export function findDescendants(tree: LayerTree, id: string): LayerNode[] {
  const node = findLayer(tree, id);
  if (!node) return [];

  const result: LayerNode[] = [];
  function visit(n: LayerNode): void {
    for (const child of n.children) {
      result.push(child);
      visit(child);
    }
  }
  visit(node);
  return result;
}

// ── Order manipulation ────────────────────────────────────────────────────────

/**
 * Normalise the `order` values within each sibling group so they are
 * consecutive integers starting at 0, with no gaps.
 */
export function normalizeLayerOrder(tree: LayerTree): LayerTree {
  function normalizeChildren(nodes: LayerNode[]): LayerNode[] {
    return sortByOrder(nodes).map((n, i) => ({
      ...n,
      order: i,
      children: normalizeChildren(n.children),
    }));
  }
  return { ...tree, roots: normalizeChildren(tree.roots) };
}

/**
 * Reorder a node within its current parent.
 * `newOrder` is the desired final order value (0-based).
 * Sibling orders are adjusted to maintain uniqueness.
 * Returns the updated tree (immutable).
 *
 * Rejects if the node is locked or lacks the "reorder" capability.
 */
export function reorderLayer(
  tree: LayerTree,
  id: string,
  newOrder: number,
): LayerTree | { error: string } {
  const node = findLayer(tree, id);
  if (!node) return { error: `Layer ${id} not found` };
  if (node.locked) return { error: `Layer ${id} is locked` };
  if (!node.capabilities.includes("reorder"))
    return { error: `Layer ${id} does not support reorder` };

  function reorderInChildren(nodes: LayerNode[]): LayerNode[] {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx === -1) return nodes.map((n) => ({ ...n, children: reorderInChildren(n.children) }));

    const without = nodes.filter((n) => n.id !== id);
    const clampedOrder = Math.max(0, Math.min(newOrder, without.length));
    const updated = { ...node, order: clampedOrder } as LayerNode;
    const inserted: LayerNode[] = [...without.slice(0, clampedOrder), updated, ...without.slice(clampedOrder)];
    return inserted.map((n, i) => ({ ...n, order: i } as LayerNode));
  }

  return normalizeLayerOrder({
    ...tree,
    roots: reorderInChildren(tree.roots),
  });
}

/**
 * Move a node to a new parent (or to the root level when `newParentId` is null).
 * Rejects if:
 * - node is locked
 * - node lacks "move" capability
 * - `newParentId` is a descendant of `id` (would create a cycle)
 * - `newParentId` belongs to a different artifact
 */
export function moveLayer(
  tree: LayerTree,
  id: string,
  newParentId: string | null,
  newOrder: number,
): LayerTree | { error: string } {
  const node = findLayer(tree, id);
  if (!node) return { error: `Layer ${id} not found` };
  if (node.locked) return { error: `Layer ${id} is locked` };
  if (!node.capabilities.includes("move"))
    return { error: `Layer ${id} does not support move` };

  // Prevent move into descendant
  if (newParentId !== null) {
    const descendants = findDescendants(tree, id);
    if (descendants.some((d) => d.id === newParentId))
      return { error: `Cannot move layer ${id} into its own descendant` };
    if (newParentId === id)
      return { error: `Cannot move layer ${id} into itself` };
    const targetParent = findLayer(tree, newParentId);
    if (!targetParent)
      return { error: `Target parent ${newParentId} not found` };
    if (targetParent.artifactId !== tree.artifactId)
      return { error: `Cross-artifact move is not permitted` };
  }

  // Remove node from its current location
  function removeNode(nodes: LayerNode[]): LayerNode[] {
    return nodes
      .filter((n) => n.id !== id)
      .map((n) => ({ ...n, children: removeNode(n.children) }));
  }

  // Insert node into new location
  function insertNode(nodes: LayerNode[], parentId: string | null): LayerNode[] {
    if (parentId === null) {
      const clampedOrder = Math.max(0, Math.min(newOrder, nodes.length));
      const updated = { ...node, parentId: null, order: clampedOrder } as LayerNode;
      const merged: LayerNode[] = [...nodes.slice(0, clampedOrder), updated, ...nodes.slice(clampedOrder)];
      return merged.map((n, i) => ({ ...n, order: i } as LayerNode));
    }
    return nodes.map((n) => {
      if (n.id === parentId) {
        const clampedOrder = Math.max(0, Math.min(newOrder, n.children.length));
        const updated = { ...node, parentId, order: clampedOrder };
        const newChildren: LayerNode[] = [
          ...n.children.slice(0, clampedOrder),
          updated,
          ...n.children.slice(clampedOrder),
        ].map((c, i) => ({ ...c, order: i } as LayerNode));
        return { ...n, children: newChildren } as LayerNode;
      }
      return { ...n, children: insertNode(n.children, parentId) };
    });
  }

  const withoutNode = removeNode(tree.roots);
  const withNode = insertNode(withoutNode, newParentId);
  return normalizeLayerOrder({ ...tree, roots: withNode });
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a flat list of nodes for structural correctness.
 * Checks: duplicate IDs, missing parents, self-parents, cycles.
 */
export function validateLayerTree(flat: FlatLayerNode[]): LayerTreeValidationResult {
  const errors: LayerTreeValidationResult["errors"] = [];
  const idSet = new Set<string>();

  // Duplicate IDs
  for (const node of flat) {
    if (idSet.has(node.id)) {
      errors.push({ code: "DUPLICATE_ID", message: `Duplicate layer ID: ${node.id}`, nodeId: node.id });
    }
    idSet.add(node.id);
  }

  for (const node of flat) {
    // Self-parent
    if (node.parentId === node.id) {
      errors.push({ code: "SELF_PARENT", message: `Layer ${node.id} is its own parent`, nodeId: node.id });
    }
    // Missing parent
    if (node.parentId !== null && !idSet.has(node.parentId)) {
      errors.push({ code: "MISSING_PARENT", message: `Layer ${node.id} references missing parent ${node.parentId}`, nodeId: node.id });
    }
    // Invalid order
    if (!Number.isFinite(node.order) || node.order < 0) {
      errors.push({ code: "INVALID_ORDER", message: `Layer ${node.id} has invalid order ${node.order}`, nodeId: node.id });
    }
  }

  // Cycle detection
  const cycleIds = detectLayerCycles(flat);
  for (const nodeId of cycleIds) {
    errors.push({ code: "CIRCULAR_HIERARCHY", message: `Circular hierarchy detected involving layer ${nodeId}`, nodeId });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect all node IDs that participate in a cycle.
 * Uses DFS with three-colour marking (white/grey/black).
 */
export function detectLayerCycles(flat: FlatLayerNode[]): string[] {
  const parentMap = new Map<string, string | null>(flat.map((n) => [n.id, n.parentId]));
  const colour = new Map<string, "white" | "grey" | "black">(
    flat.map((n) => [n.id, "white"]),
  );
  const cycleIds = new Set<string>();

  function visit(id: string): boolean {
    const c = colour.get(id);
    if (c === "black") return false;
    if (c === "grey") return true; // back-edge → cycle

    colour.set(id, "grey");
    const parentId = parentMap.get(id);
    if (parentId !== null && parentId !== undefined && parentMap.has(parentId)) {
      if (visit(parentId)) {
        cycleIds.add(id);
      }
    }
    colour.set(id, "black");
    return false;
  }

  for (const n of flat) {
    if (colour.get(n.id) === "white") visit(n.id);
  }

  return [...cycleIds];
}

// ── Effective state derivation ────────────────────────────────────────────────

/**
 * A node is effectively visible only if it AND all its ancestors are visible.
 */
export function deriveEffectiveVisibility(tree: LayerTree, id: string): boolean {
  const node = findLayer(tree, id);
  if (!node) return false;
  if (!node.visible) return false;
  const ancestors = findAncestors(tree, id);
  return ancestors.every((a) => a.visible);
}

/**
 * A node is effectively locked if it OR any ancestor is locked.
 */
export function deriveEffectiveLock(tree: LayerTree, id: string): boolean {
  const node = findLayer(tree, id);
  if (!node) return false;
  if (node.locked) return true;
  const ancestors = findAncestors(tree, id);
  return ancestors.some((a) => a.locked);
}

// ── Selection helpers ─────────────────────────────────────────────────────────

/**
 * Calculate what the selection should become after deleting the given IDs.
 * Tries to select the next sibling, then the previous sibling, then the parent.
 */
export function calculateSelectionAfterDelete(
  tree: LayerTree,
  deletedIds: string[],
  currentSelection: LayerSelection,
): LayerSelection {
  const flat = flattenLayerTree(tree);
  const remaining = flat.filter((n) => !deletedIds.includes(n.id));
  const deleted = new Set(deletedIds);

  // If primary selection is not being deleted, keep it
  if (
    currentSelection.primaryId !== null &&
    !deleted.has(currentSelection.primaryId)
  ) {
    const stillSelected = currentSelection.selectedIds.filter((id) => !deleted.has(id));
    return { selectedIds: stillSelected, primaryId: currentSelection.primaryId };
  }

  if (remaining.length === 0) return { selectedIds: [], primaryId: null };

  // Find the nearest remaining sibling or parent of the first deleted node
  const firstDeleted = flat.find((n) => deletedIds.includes(n.id));
  if (!firstDeleted) return { selectedIds: [], primaryId: null };

  const siblings = remaining.filter((n) => n.parentId === firstDeleted.parentId);
  if (siblings.length > 0) {
    const next = siblings.find((n) => n.order > firstDeleted.order) ?? siblings[siblings.length - 1];
    return { selectedIds: [next.id], primaryId: next.id };
  }

  // Fall back to parent
  if (firstDeleted.parentId) {
    const parent = remaining.find((n) => n.id === firstDeleted.parentId);
    if (parent) return { selectedIds: [parent.id], primaryId: parent.id };
  }

  // Fall back to any remaining node
  const fallback = remaining[0];
  return { selectedIds: [fallback.id], primaryId: fallback.id };
}

// ── Capability guard ──────────────────────────────────────────────────────────

/**
 * Returns an error string if the mutation is blocked by the node's capabilities
 * or lock state. Returns null if the mutation is allowed.
 */
export function guardMutation(
  tree: LayerTree,
  mutation: LayerMutation,
): string | null {
  function checkNode(id: string, requiredCapability: LayerCapability): string | null {
    const node = findLayer(tree, id);
    if (!node) return `Layer ${id} not found`;
    if (deriveEffectiveLock(tree, id) && requiredCapability !== "lock-unlock" && requiredCapability !== "select")
      return `Layer ${id} is locked`;
    if (!node.capabilities.includes(requiredCapability))
      return `Layer ${id} does not support '${requiredCapability}'`;
    return null;
  }

  switch (mutation.op) {
    case "select":
      for (const id of mutation.ids) {
        const err = checkNode(id, "select");
        if (err) return err;
      }
      return null;
    case "show":
    case "hide":
      return checkNode(mutation.id, "show-hide");
    case "lock":
    case "unlock":
      return checkNode(mutation.id, "lock-unlock");
    case "rename":
      return checkNode(mutation.id, "rename");
    case "reorder":
      return checkNode(mutation.id, "reorder");
    case "move":
      return checkNode(mutation.id, "move");
    case "group":
      for (const id of mutation.ids) {
        const err = checkNode(id, "group");
        if (err) return err;
      }
      return null;
    case "ungroup":
      return checkNode(mutation.id, "ungroup");
    case "duplicate":
      for (const id of mutation.ids) {
        const err = checkNode(id, "duplicate");
        if (err) return err;
      }
      return null;
    case "delete":
      for (const id of mutation.ids) {
        const err = checkNode(id, "delete");
        if (err) return err;
      }
      return null;
    default:
      return null;
  }
}
