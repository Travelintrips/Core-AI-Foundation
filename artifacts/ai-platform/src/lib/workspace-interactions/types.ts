/**
 * Workspace Interactions — Core Types (Team 19)
 *
 * Reusable interaction layer for Canvas Workspace.
 * Domain-agnostic: no Fashion/Interior/Packaging references.
 * All identifiers are opaque strings.
 */

// ── Command ───────────────────────────────────────────────────────────────────

/** A declarative description of a workspace command. */
export type WorkspaceCommand = {
  /** Unique command identifier e.g. "delete", "bring-forward" */
  id: string;
  label: string;
  category?: string;
  /** Whether this command can be undone */
  reversible: boolean;
  /** Whether at least one item must be selected */
  requiresSelection?: boolean;
  /** Capability keys that must be present in context (e.g. "can-delete") */
  capabilities?: string[];
  /** Permission keys required (e.g. "editor") */
  permissions?: string[];
  /** If true, command is declared but will not execute */
  disabled?: boolean;
};

/** Runtime context supplied to every command execution */
export type WorkspaceCommandContext = {
  /** Opaque project/artifact identifier for cross-project guard */
  projectId: string;
  /** Capabilities the current user/mode has */
  capabilities: Set<string>;
  /** Permissions the current user has */
  permissions: Set<string>;
  /** Currently selected IDs */
  selectedIds: ReadonlySet<string>;
};

/** Result returned by a command handler */
export type WorkspaceCommandResult =
  | { ok: true; undoPayload?: unknown }
  | { ok: false; reason: string };

/** A registered handler for a specific command */
export type WorkspaceCommandHandler<TPayload = unknown> = {
  commandId: string;
  execute: (payload: TPayload, ctx: WorkspaceCommandContext) => WorkspaceCommandResult;
  /** Must be provided if command.reversible === true */
  undo?: (undoPayload: unknown, ctx: WorkspaceCommandContext) => void;
};

// ── Shortcut ──────────────────────────────────────────────────────────────────

export type ShortcutModifier = "ctrl" | "meta" | "shift" | "alt";

/** A keyboard shortcut bound to a command */
export type WorkspaceShortcut = {
  /** Unique shortcut identifier */
  id: string;
  commandId: string;
  /** Primary key (e.g. "z", "Delete", "ArrowLeft") */
  key: string;
  modifiers?: ShortcutModifier[];
  /**
   * When true, use Meta on Mac and Ctrl on Windows/Linux.
   * The registry normalises to a platform-neutral key string.
   */
  platformKey?: boolean;
  /** Human-readable description for accessibility help */
  description?: string;
};

// ── Interaction Mode ──────────────────────────────────────────────────────────

export type WorkspaceInteractionMode =
  | "select"
  | "pan"
  | "zoom-in"
  | "zoom-out"
  | "box-select"
  | "draw"
  | "text"
  | "locked";

// ── Selection ─────────────────────────────────────────────────────────────────

export type SelectionAddMode =
  | "replace"   // Replace entire selection
  | "toggle"    // Toggle one item
  | "additive"  // Add without removing existing
  | "range";    // Range from primary to target (requires hierarchy)

/** Immutable snapshot of the current selection */
export type WorkspaceSelectionSet = {
  /** All currently selected opaque IDs */
  readonly ids: ReadonlySet<string>;
  /** The "anchor" selection (last directly clicked item) */
  readonly primaryId: string | null;
};

// ── Clipboard ─────────────────────────────────────────────────────────────────

/** Clipboard payload — project-scoped to prevent cross-project paste */
export type WorkspaceClipboardPayload = {
  /** Project/artifact ID at copy time — must match at paste time */
  projectId: string;
  /** Logical artifact type e.g. "design-template", "canvas" */
  artifactType: string;
  /** Copied items (opaque to the interaction layer) */
  items: unknown[];
  copiedAt: number;
};

// ── Undo/Redo ─────────────────────────────────────────────────────────────────

/** A single entry in the undo history */
export type WorkspaceUndoEntry = {
  commandId: string;
  /** Payload needed to re-execute the undo handler */
  undoPayload: unknown;
  /** Optional group — grouped entries are undone together */
  groupId?: string;
  timestamp: number;
};

// ── Snap / Alignment ──────────────────────────────────────────────────────────

export type SnapAxis = "x" | "y" | "both";

export type SnapPoint = {
  x: number;
  y: number;
  axis: SnapAxis;
  /** Source description e.g. "element-edge", "canvas-center", "guide" */
  source: string;
};

export type SnapGuide = {
  axis: "horizontal" | "vertical";
  position: number;
  label?: string;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AlignTarget = {
  id: string;
  bounds: BoundingBox;
};

export type AlignDirection =
  | "left" | "center-h" | "right"
  | "top" | "center-v" | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

// ── Context Menu ──────────────────────────────────────────────────────────────

export type ContextMenuItem =
  | { kind: "action"; commandId: string; label: string; disabled?: boolean; shortcutHint?: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; items: ContextMenuItem[] };

export type ContextMenuRequest = {
  x: number;
  y: number;
  selectedIds: ReadonlySet<string>;
  targetId?: string;
};
