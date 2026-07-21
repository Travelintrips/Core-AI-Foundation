/**
 * Workspace Interactions — Public API (Team 19)
 *
 * Reusable canvas interaction layer.
 * Import only what you need — tree-shaking is supported.
 *
 * Integration note for Team 11/12/13:
 * - Replace CanvasContract shim in canvas-interaction-adapter.ts
 *   with your published package once available.
 * - Team 12 property handoff: pass AlignTarget[] to computeAlignment().
 * - Team 13 layer selection: use WorkspaceSelectionManager.select() with mode="range".
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  WorkspaceCommand,
  WorkspaceCommandHandler,
  WorkspaceCommandContext,
  WorkspaceCommandResult,
  WorkspaceShortcut,
  ShortcutModifier,
  WorkspaceInteractionMode,
  WorkspaceSelectionSet,
  SelectionAddMode,
  WorkspaceClipboardPayload,
  WorkspaceUndoEntry,
  SnapAxis,
  SnapPoint,
  SnapGuide,
  BoundingBox,
  AlignTarget,
  AlignDirection,
  DistributeAxis,
  ContextMenuItem,
  ContextMenuRequest,
} from "./types";

// ── Command Registry ──────────────────────────────────────────────────────────
export { WorkspaceCommandRegistry } from "./command-registry";

// ── Shortcut Registry ─────────────────────────────────────────────────────────
export { WorkspaceShortcutRegistry, normaliseShortcutKey } from "./shortcut-registry";

// ── Selection ─────────────────────────────────────────────────────────────────
export { WorkspaceSelectionManager } from "./selection-manager";
export type { SelectableItem, SelectionChangeListener } from "./selection-manager";

// ── Undo Stack ────────────────────────────────────────────────────────────────
export { WorkspaceUndoStack } from "./undo-stack";
export type { UndoStackOptions, UndoRedoListener } from "./undo-stack";

// ── Clipboard ─────────────────────────────────────────────────────────────────
export { WorkspaceClipboardManager } from "./clipboard";
export type { ClipboardValidationResult } from "./clipboard";

// ── Snap & Alignment ──────────────────────────────────────────────────────────
export {
  getElementSnapPoints,
  getGuideSnapPoints,
  snapToPoints,
  computeAlignment,
  computeDistribution,
  computeNudge,
  unionBounds,
  centerX,
  centerY,
} from "./snap-align";
export type { SnapResult, NudgeDirection } from "./snap-align";

// ── Interaction Mode ──────────────────────────────────────────────────────────
export { WorkspaceInteractionModeManager } from "./interaction-mode";
export type { ModeChangeListener } from "./interaction-mode";

// ── Context Menu ──────────────────────────────────────────────────────────────
export { buildContextMenu } from "./context-menu";

// ── Canvas Adapter ────────────────────────────────────────────────────────────
export {
  CanvasInteractionAdapter,
  createNullCanvasAdapter,
} from "./canvas-interaction-adapter";
export type { CanvasContract } from "./canvas-interaction-adapter";

// ── React Hooks ───────────────────────────────────────────────────────────────
export { useWorkspaceShortcuts } from "./hooks/use-workspace-shortcuts";
export type { ShortcutFiredCallback } from "./hooks/use-workspace-shortcuts";

export { useWorkspaceSelection } from "./hooks/use-workspace-selection";

export { useWorkspaceCommands } from "./hooks/use-workspace-commands";
export type { UseWorkspaceCommandsReturn } from "./hooks/use-workspace-commands";
