/**
 * Universal Design Layer System — Core Types
 *
 * Domain-neutral contract. No sleeve, wall, dieline, chair, logo, or any
 * domain-specific concept lives here. All domain-specific data belongs in
 * `extensions` or `metadata`.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

// ── Node type ─────────────────────────────────────────────────────────────────

/**
 * Generic node type labels. Open union — renderers may add their own strings.
 * Core must not special-case any specific value.
 */
export type LayerNodeType =
  | "group"
  | "layer"
  | "text"
  | "image"
  | "shape"
  | "video"
  | "audio"
  | "component"
  | "annotation"
  | "mask"
  | (string & Record<never, never>); // open for plugin extension

// ── Capability ────────────────────────────────────────────────────────────────

/**
 * Operation capabilities. UI must not show an action that is absent from the
 * node's `capabilities` list.
 */
export type LayerCapability =
  | "select"
  | "show-hide"
  | "lock-unlock"
  | "rename"
  | "reorder"
  | "move"
  | "group"
  | "ungroup"
  | "duplicate"
  | "delete";

// ── Node ──────────────────────────────────────────────────────────────────────

/**
 * A single node in the layer hierarchy.
 *
 * `children` is populated by `buildLayerTree` from the flat representation.
 * The serialised/persisted form carries `parentId` only — `children` is derived.
 */
export type LayerNode = {
  /** Unique within the entire tree. */
  id: string;
  /** null for root-level nodes. */
  parentId: string | null;
  /** The design artifact this layer belongs to. */
  artifactId: string;
  /** Human-readable display name. */
  name: string;
  /** Generic type tag — must not be special-cased in core logic. */
  type: LayerNodeType;
  /**
   * Sibling sort order. Lower = higher position in the list.
   * Normalised values are non-negative integers with no gaps.
   */
  order: number;
  /** Own visibility flag. Effective visibility also depends on ancestors. */
  visible: boolean;
  /** Own lock flag. Effective lock also depends on ancestors. */
  locked: boolean;
  /** Whether this node can be selected by the user. */
  selectable: boolean;
  /** Derived child nodes (populated by buildLayerTree). */
  children: LayerNode[];
  /** Supported operations. UI hides actions absent from this list. */
  capabilities: LayerCapability[];
  /** Renderer/plugin-defined structured data. Not used by core logic. */
  metadata: Record<string, unknown>;
  /**
   * Domain-specific extensions (fashion sleeve geometry, packaging dieline, etc.).
   * Core ignores these entirely.
   */
  extensions: Record<string, unknown>;
};

// ── Tree ──────────────────────────────────────────────────────────────────────

export type LayerTree = {
  /** The design artifact these layers belong to. */
  artifactId: string;
  /** Root-level nodes in display order (order ascending). */
  roots: LayerNode[];
  /** Monotonically increasing version counter for optimistic concurrency. */
  version: number;
};

// ── Selection ─────────────────────────────────────────────────────────────────

export type LayerSelection = {
  /** All currently selected node IDs. */
  selectedIds: string[];
  /**
   * The primary (anchor) selection. Used for property panel context.
   * null when nothing is selected.
   */
  primaryId: string | null;
};

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Discrete, serialisable operations the system can perform on the tree.
 * Each operation is validated against the node's `capabilities` before dispatch.
 */
export type LayerMutation =
  | { op: "select"; ids: string[]; primary?: string }
  | { op: "show"; id: string }
  | { op: "hide"; id: string }
  | { op: "lock"; id: string }
  | { op: "unlock"; id: string }
  | { op: "rename"; id: string; name: string }
  | { op: "reorder"; id: string; newOrder: number; parentId: string | null }
  | { op: "move"; id: string; newParentId: string | null; newOrder: number }
  | { op: "group"; ids: string[]; groupName?: string }
  | { op: "ungroup"; id: string }
  | { op: "duplicate"; ids: string[] }
  | { op: "delete"; ids: string[] };

// ── Patch ─────────────────────────────────────────────────────────────────────

/** Partial update applied to a node's mutable fields. */
export type LayerPatch = Partial<
  Pick<
    LayerNode,
    | "name"
    | "visible"
    | "locked"
    | "order"
    | "parentId"
    | "capabilities"
    | "metadata"
    | "extensions"
  >
>;

// ── Validation ────────────────────────────────────────────────────────────────

export type LayerTreeValidationErrorCode =
  | "DUPLICATE_ID"
  | "MISSING_PARENT"
  | "CIRCULAR_HIERARCHY"
  | "SELF_PARENT"
  | "INVALID_ORDER"
  | "CROSS_ARTIFACT";

export type LayerTreeValidationError = {
  code: LayerTreeValidationErrorCode;
  message: string;
  nodeId?: string;
};

export type LayerTreeValidationResult = {
  valid: boolean;
  errors: LayerTreeValidationError[];
};

// ── Provider adapter ──────────────────────────────────────────────────────────

/**
 * Contract that a renderer or plugin must implement to contribute layers to
 * the universal system. Team 13 does not implement adapters — renderers do.
 *
 * If a dependency adapter is not yet available, callers create a narrow local
 * adapter stub marked with an integration note.
 */
export type LayerProviderAdapter = {
  /** Unique adapter identifier (e.g. "fashion-renderer", "interior-renderer"). */
  adapterId: string;
  /** Fetch the current layer tree for an artifact. */
  getLayerTree(artifactId: string): Promise<LayerTree>;
  /**
   * Apply a mutation and return the updated tree.
   * Must not modify the tree if validation fails — return success:false with error.
   */
  applyMutation(
    artifactId: string,
    mutation: LayerMutation,
  ): Promise<{ success: boolean; updatedTree?: LayerTree; error?: string }>;
  /**
   * Called when the workspace selection changes externally (e.g. user clicks
   * an object on the canvas). Adapter can use this to highlight layers.
   * Optional — only implement if the adapter bridges a workspace.
   *
   * Team 11 workspace selection boundary hook.
   */
  onSelectionChange?: (selection: LayerSelection) => void;
};

// ── Flat node (serialisation) ─────────────────────────────────────────────────

/**
 * The wire/persistence form of a node — no derived `children` array.
 * Use `buildLayerTree` to hydrate into `LayerNode`.
 */
export type FlatLayerNode = Omit<LayerNode, "children">;
