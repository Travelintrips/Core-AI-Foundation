/**
 * Universal Design Layer System — Test Suite
 *
 * 22 required tests per Team 13 spec.
 * All tests are pure logic (no DOM/jsdom required — vitest env: node).
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import { describe, it, expect } from "vitest";
import {
  buildLayerTree,
  flattenLayerTree,
  validateLayerTree,
  detectLayerCycles,
  deriveEffectiveVisibility,
  deriveEffectiveLock,
  reorderLayer,
  moveLayer,
  findLayer,
  findDescendants,
  guardMutation,
  calculateSelectionAfterDelete,
  normalizeLayerOrder,
} from "../lib/layer-system/utils";
import {
  layerSystemReducer,
  INITIAL_LAYER_SYSTEM_STATE,
} from "../lib/layer-system";
import type { FlatLayerNode, LayerMutation, LayerTree } from "../lib/layer-system/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_CAPS = [
  "select", "show-hide", "lock-unlock", "rename", "reorder", "move",
  "group", "ungroup", "duplicate", "delete",
] as const;

function makeNode(
  overrides: Partial<FlatLayerNode> & { id: string },
): FlatLayerNode {
  return {
    parentId: null,
    artifactId: "art-1",
    name: overrides.id,
    type: "layer",
    order: 0,
    visible: true,
    locked: false,
    selectable: true,
    capabilities: [...ALL_CAPS],
    metadata: {},
    extensions: {},
    ...overrides,
  };
}

/** Build a simple two-level tree: root → child-a, child-b */
function makeSimpleTree(): LayerTree {
  return buildLayerTree(
    [
      makeNode({ id: "root", order: 0 }),
      makeNode({ id: "child-a", parentId: "root", order: 0 }),
      makeNode({ id: "child-b", parentId: "root", order: 1 }),
    ],
    "art-1",
    1,
  );
}

// ── 1. Build hierarchy ────────────────────────────────────────────────────────

describe("1. build hierarchy", () => {
  it("assembles a two-level tree from flat nodes", () => {
    const tree = makeSimpleTree();
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].id).toBe("root");
    expect(tree.roots[0].children).toHaveLength(2);
    expect(tree.roots[0].children[0].id).toBe("child-a");
    expect(tree.roots[0].children[1].id).toBe("child-b");
  });

  it("promotes orphan nodes to roots", () => {
    const flat = [
      makeNode({ id: "orphan", parentId: "missing-parent", order: 0 }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].id).toBe("orphan");
  });
});

// ── 2. Flatten ────────────────────────────────────────────────────────────────

describe("2. flatten", () => {
  it("returns all nodes in DFS pre-order", () => {
    const tree = makeSimpleTree();
    const flat = flattenLayerTree(tree);
    expect(flat.map((n) => n.id)).toEqual(["root", "child-a", "child-b"]);
  });
});

// ── 3. Duplicate ID ───────────────────────────────────────────────────────────

describe("3. duplicate ID", () => {
  it("reports DUPLICATE_ID error", () => {
    const flat = [makeNode({ id: "x" }), makeNode({ id: "x" })];
    const result = validateLayerTree(flat);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });
});

// ── 4. Orphan ─────────────────────────────────────────────────────────────────

describe("4. orphan", () => {
  it("reports MISSING_PARENT error", () => {
    const flat = [makeNode({ id: "child", parentId: "ghost" })];
    const result = validateLayerTree(flat);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_PARENT")).toBe(true);
  });
});

// ── 5. Cycle ──────────────────────────────────────────────────────────────────

describe("5. cycle", () => {
  it("detects circular parent references", () => {
    const flat = [
      makeNode({ id: "a", parentId: "b" }),
      makeNode({ id: "b", parentId: "a" }),
    ];
    const cycleIds = detectLayerCycles(flat);
    expect(cycleIds.length).toBeGreaterThan(0);

    const result = validateLayerTree(flat);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CIRCULAR_HIERARCHY")).toBe(true);
  });

  it("self-parent reports SELF_PARENT error", () => {
    const flat = [makeNode({ id: "self", parentId: "self" })];
    const result = validateLayerTree(flat);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SELF_PARENT")).toBe(true);
  });
});

// ── 6. Effective visibility ───────────────────────────────────────────────────

describe("6. effective visibility", () => {
  it("returns false when own node is hidden", () => {
    const flat = [
      makeNode({ id: "root", visible: false }),
      makeNode({ id: "child", parentId: "root", visible: true }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    expect(deriveEffectiveVisibility(tree, "child")).toBe(false);
  });

  it("returns true when node and all ancestors are visible", () => {
    const tree = makeSimpleTree();
    expect(deriveEffectiveVisibility(tree, "child-a")).toBe(true);
  });

  it("returns false when the node itself is hidden", () => {
    const flat = [
      makeNode({ id: "root" }),
      makeNode({ id: "child", parentId: "root", visible: false }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    expect(deriveEffectiveVisibility(tree, "child")).toBe(false);
  });
});

// ── 7. Effective lock ─────────────────────────────────────────────────────────

describe("7. effective lock", () => {
  it("returns true when ancestor is locked", () => {
    const flat = [
      makeNode({ id: "root", locked: true }),
      makeNode({ id: "child", parentId: "root", locked: false }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    expect(deriveEffectiveLock(tree, "child")).toBe(true);
  });

  it("returns true when node itself is locked", () => {
    const flat = [makeNode({ id: "node", locked: true })];
    const tree = buildLayerTree(flat, "art-1");
    expect(deriveEffectiveLock(tree, "node")).toBe(true);
  });

  it("returns false when node and all ancestors are unlocked", () => {
    const tree = makeSimpleTree();
    expect(deriveEffectiveLock(tree, "child-a")).toBe(false);
  });
});

// ── 8. Reorder ────────────────────────────────────────────────────────────────

describe("8. reorder", () => {
  it("moves child-b before child-a", () => {
    const tree = makeSimpleTree();
    const result = reorderLayer(tree, "child-b", 0);
    expect("error" in result).toBe(false);
    const flat = flattenLayerTree(result as LayerTree);
    const root = (result as LayerTree).roots[0];
    expect(root.children[0].id).toBe("child-b");
    expect(root.children[1].id).toBe("child-a");
  });

  it("normalises orders after reorder", () => {
    const tree = makeSimpleTree();
    const result = reorderLayer(tree, "child-b", 0) as LayerTree;
    const root = result.roots[0];
    expect(root.children.map((c) => c.order)).toEqual([0, 1]);
  });
});

// ── 9. Invalid cross-parent move ─────────────────────────────────────────────

describe("9. invalid cross-parent move", () => {
  it("allows moving to a sibling parent", () => {
    const flat = [
      makeNode({ id: "root" }),
      makeNode({ id: "group-a", parentId: "root", type: "group", order: 0 }),
      makeNode({ id: "group-b", parentId: "root", type: "group", order: 1 }),
      makeNode({ id: "child", parentId: "group-a", order: 0 }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const result = moveLayer(tree, "child", "group-b", 0);
    expect("error" in result).toBe(false);
    const moved = findLayer(result as LayerTree, "child");
    expect(moved?.parentId).toBe("group-b");
  });
});

// ── 10. Move to descendant rejection ─────────────────────────────────────────

describe("10. move to descendant rejection", () => {
  it("rejects moving a node into its own descendant", () => {
    const tree = makeSimpleTree();
    const result = moveLayer(tree, "root", "child-a", 0);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/descendant/i);
  });

  it("rejects moving a node into itself", () => {
    const tree = makeSimpleTree();
    const result = moveLayer(tree, "root", "root", 0);
    expect("error" in result).toBe(true);
  });
});

// ── 11. Locked mutation rejection ─────────────────────────────────────────────

describe("11. locked mutation rejection", () => {
  it("reorderLayer rejects a locked node", () => {
    const flat = [makeNode({ id: "locked", locked: true })];
    const tree = buildLayerTree(flat, "art-1");
    const result = reorderLayer(tree, "locked", 0);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/locked/i);
  });

  it("moveLayer rejects a locked node", () => {
    const flat = [
      makeNode({ id: "parent", order: 0 }),
      makeNode({ id: "locked", parentId: "parent", locked: true, order: 0 }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const result = moveLayer(tree, "locked", null, 0);
    expect("error" in result).toBe(true);
  });

  it("guardMutation rejects rename on effectively locked node", () => {
    const flat = [
      makeNode({ id: "parent", locked: true }),
      makeNode({ id: "child", parentId: "parent" }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "child", name: "new name" });
    expect(err).not.toBeNull();
    expect(err).toMatch(/locked/i);
  });
});

// ── 12. Capability rejection ──────────────────────────────────────────────────

describe("12. capability rejection", () => {
  it("guardMutation rejects when capability is absent", () => {
    const flat = [makeNode({ id: "node", capabilities: ["select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "node", name: "x" });
    expect(err).not.toBeNull();
    expect(err).toMatch(/rename/i);
  });

  it("guardMutation allows when capability is present", () => {
    const flat = [makeNode({ id: "node", capabilities: ["rename", "select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "node", name: "x" });
    expect(err).toBeNull();
  });
});

// ── 13. Selection ─────────────────────────────────────────────────────────────

describe("13. selection", () => {
  it("reducer MUTATION_QUEUE with op:select updates selection", () => {
    const tree = makeSimpleTree();
    const state = { ...INITIAL_LAYER_SYSTEM_STATE, tree };
    const mutation: LayerMutation = { op: "select", ids: ["child-a"], primary: "child-a" };
    const next = layerSystemReducer(state, {
      type: "MUTATION_QUEUE",
      mutation,
      optimisticTree: tree,
    });
    expect(next.selection.selectedIds).toContain("child-a");
    expect(next.selection.primaryId).toBe("child-a");
  });

  it("calculateSelectionAfterDelete selects next sibling", () => {
    const tree = makeSimpleTree();
    const selection = { selectedIds: ["child-a"], primaryId: "child-a" };
    const after = calculateSelectionAfterDelete(tree, ["child-a"], selection);
    expect(after.selectedIds).toContain("child-b");
  });

  it("calculateSelectionAfterDelete returns empty when all nodes deleted", () => {
    const flat = [makeNode({ id: "only" })];
    const tree = buildLayerTree(flat, "art-1");
    const after = calculateSelectionAfterDelete(
      tree,
      ["only"],
      { selectedIds: ["only"], primaryId: "only" },
    );
    expect(after.selectedIds).toHaveLength(0);
    expect(after.primaryId).toBeNull();
  });
});

// ── 14. Expand / collapse ─────────────────────────────────────────────────────

describe("14. expand/collapse", () => {
  it("TOGGLE_EXPAND adds id to expandedIds", () => {
    const state = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "TOGGLE_EXPAND",
      id: "root",
    });
    expect(state.expandedIds.has("root")).toBe(true);
  });

  it("TOGGLE_EXPAND removes already-expanded id", () => {
    const first = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "TOGGLE_EXPAND",
      id: "root",
    });
    const second = layerSystemReducer(first, { type: "TOGGLE_EXPAND", id: "root" });
    expect(second.expandedIds.has("root")).toBe(false);
  });

  it("COLLAPSE_ALL clears all expanded ids", () => {
    const withExpanded = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "SET_EXPANDED",
      ids: ["a", "b", "c"],
    });
    const collapsed = layerSystemReducer(withExpanded, { type: "COLLAPSE_ALL" });
    expect(collapsed.expandedIds.size).toBe(0);
  });
});

// ── 15. Visibility toggle ─────────────────────────────────────────────────────

describe("15. visibility toggle", () => {
  it("guardMutation allows hide on a visible node with show-hide capability", () => {
    const flat = [makeNode({ id: "node", visible: true, capabilities: ["show-hide", "select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "hide", id: "node" });
    expect(err).toBeNull();
  });

  it("guardMutation rejects hide on node without show-hide capability", () => {
    const flat = [makeNode({ id: "node", visible: true, capabilities: ["select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "hide", id: "node" });
    expect(err).not.toBeNull();
  });
});

// ── 16. Lock toggle ───────────────────────────────────────────────────────────

describe("16. lock toggle", () => {
  it("guardMutation allows lock on unlocked node with lock-unlock capability", () => {
    const flat = [makeNode({ id: "node", locked: false, capabilities: ["lock-unlock", "select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "lock", id: "node" });
    expect(err).toBeNull();
  });

  it("guardMutation allows unlock even when node is locked (lock-unlock bypasses effective lock check)", () => {
    const flat = [makeNode({ id: "node", locked: true, capabilities: ["lock-unlock", "select"] })];
    const tree = buildLayerTree(flat, "art-1");
    // unlock should bypass the effective-lock guard
    const err = guardMutation(tree, { op: "unlock", id: "node" });
    expect(err).toBeNull();
  });
});

// ── 17. Rename ────────────────────────────────────────────────────────────────

describe("17. rename", () => {
  it("guardMutation allows rename when capability present and node not locked", () => {
    const flat = [makeNode({ id: "node", capabilities: ["rename", "select"], locked: false })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "node", name: "New Name" });
    expect(err).toBeNull();
  });

  it("guardMutation rejects rename when capability absent", () => {
    const flat = [makeNode({ id: "node", capabilities: ["select"] })];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "node", name: "New" });
    expect(err).not.toBeNull();
  });
});

// ── 18. Drag/move fallback ────────────────────────────────────────────────────

describe("18. drag/move fallback (reorder up/down)", () => {
  it("reorderLayer with newOrder=0 moves node to top", () => {
    const tree = makeSimpleTree();
    const result = reorderLayer(tree, "child-b", 0) as LayerTree;
    expect(result.roots[0].children[0].id).toBe("child-b");
  });

  it("reorderLayer normalises sibling orders after move", () => {
    const tree = makeSimpleTree();
    const result = reorderLayer(tree, "child-b", 0) as LayerTree;
    const orders = result.roots[0].children.map((c) => c.order);
    expect(orders).toEqual([0, 1]);
  });

  it("normalizeLayerOrder fills gaps in order values", () => {
    const flat = [
      makeNode({ id: "a", order: 0 }),
      makeNode({ id: "b", order: 5 }),
      makeNode({ id: "c", order: 10 }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const normalised = normalizeLayerOrder(tree);
    expect(normalised.roots.map((r) => r.order)).toEqual([0, 1, 2]);
  });
});

// ── 19. Keyboard navigation ───────────────────────────────────────────────────

describe("19. keyboard navigation (state machine)", () => {
  it("EXPAND_ALL marks all group nodes expanded", () => {
    const tree = makeSimpleTree();
    const state = { ...INITIAL_LAYER_SYSTEM_STATE, tree };
    const next = layerSystemReducer(state, { type: "EXPAND_ALL" });
    // root has children so should be expanded
    expect(next.expandedIds.has("root")).toBe(true);
  });

  it("SET_EXPANDED sets exactly the given ids", () => {
    const state = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "SET_EXPANDED",
      ids: ["a", "b"],
    });
    expect(state.expandedIds.has("a")).toBe(true);
    expect(state.expandedIds.has("b")).toBe(true);
    expect(state.expandedIds.has("c")).toBe(false);
  });
});

// ── 20. Empty / loading / error state ────────────────────────────────────────

describe("20. empty/loading/error state", () => {
  it("initial state has null tree and idle status", () => {
    expect(INITIAL_LAYER_SYSTEM_STATE.tree).toBeNull();
    expect(INITIAL_LAYER_SYSTEM_STATE.status).toBe("idle");
    expect(INITIAL_LAYER_SYSTEM_STATE.error).toBeNull();
  });

  it("LOAD_START sets status to loading when tree is null", () => {
    const state = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, { type: "LOAD_START" });
    expect(state.status).toBe("loading");
  });

  it("LOAD_START sets status to refreshing when tree already loaded", () => {
    const withTree = { ...INITIAL_LAYER_SYSTEM_STATE, tree: makeSimpleTree() };
    const state = layerSystemReducer(withTree, { type: "LOAD_START" });
    expect(state.status).toBe("refreshing");
  });

  it("LOAD_ERROR records error and returns to idle", () => {
    const loading = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, { type: "LOAD_START" });
    const errored = layerSystemReducer(loading, { type: "LOAD_ERROR", error: "Network error" });
    expect(errored.status).toBe("idle");
    expect(errored.error).toBe("Network error");
  });

  it("LOAD_SUCCESS clears error and sets tree", () => {
    const tree = makeSimpleTree();
    const state = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "LOAD_SUCCESS",
      tree,
    });
    expect(state.tree).not.toBeNull();
    expect(state.error).toBeNull();
    expect(state.status).toBe("idle");
  });
});

// ── 21. Workspace selection synchronisation ───────────────────────────────────

describe("21. workspace selection synchronization", () => {
  it("SYNC_SELECTION updates selection from external workspace", () => {
    const externalSelection = { selectedIds: ["child-b"], primaryId: "child-b" };
    const state = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "SYNC_SELECTION",
      selection: externalSelection,
    });
    expect(state.selection.selectedIds).toContain("child-b");
    expect(state.selection.primaryId).toBe("child-b");
  });

  it("SYNC_SELECTION replaces previous selection", () => {
    const withSel = layerSystemReducer(INITIAL_LAYER_SYSTEM_STATE, {
      type: "SYNC_SELECTION",
      selection: { selectedIds: ["child-a"], primaryId: "child-a" },
    });
    const replaced = layerSystemReducer(withSel, {
      type: "SYNC_SELECTION",
      selection: { selectedIds: ["child-b"], primaryId: "child-b" },
    });
    expect(replaced.selection.selectedIds).not.toContain("child-a");
    expect(replaced.selection.selectedIds).toContain("child-b");
  });
});

// ── 22. No domain leakage ─────────────────────────────────────────────────────

describe("22. no domain leakage", () => {
  it("core types accept arbitrary LayerNodeType without special-casing", () => {
    // A node with a domain-specific type should be valid in the core
    const flat = [
      makeNode({ id: "sleeve-layer", type: "sleeve-curve" as string }),
      makeNode({ id: "wall-panel", type: "wall" as string }),
      makeNode({ id: "dieline", type: "dieline-panel" as string }),
      makeNode({ id: "chair-leg", type: "furniture-component" as string }),
    ];
    const result = validateLayerTree(flat);
    // Validation only checks structural rules — it must NOT fail on unknown types
    expect(result.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_PARENT")).toBe(false);
    expect(result.errors.some((e) => e.code === "CIRCULAR_HIERARCHY")).toBe(false);
  });

  it("flattenLayerTree works regardless of node type value", () => {
    const flat = [
      makeNode({ id: "n1", type: "landscape-zone" as string }),
      makeNode({ id: "n2", parentId: "n1", type: "planting-area" as string }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const flattened = flattenLayerTree(tree);
    expect(flattened).toHaveLength(2);
  });

  it("capabilities are enforced by contract, not by node type", () => {
    // A 'sleeve-curve' node without rename capability cannot be renamed
    const flat = [
      makeNode({ id: "sleeve", type: "sleeve-curve" as string, capabilities: ["select", "show-hide"] }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const err = guardMutation(tree, { op: "rename", id: "sleeve", name: "New Sleeve" });
    expect(err).not.toBeNull();
  });

  it("findDescendants works for any node type", () => {
    const flat = [
      makeNode({ id: "g", type: "group", order: 0 }),
      makeNode({ id: "x", parentId: "g", type: "logo-symbol" as string, order: 0 }),
      makeNode({ id: "y", parentId: "g", type: "chair" as string, order: 1 }),
    ];
    const tree = buildLayerTree(flat, "art-1");
    const desc = findDescendants(tree, "g");
    expect(desc.map((n) => n.id)).toEqual(["x", "y"]);
  });
});
