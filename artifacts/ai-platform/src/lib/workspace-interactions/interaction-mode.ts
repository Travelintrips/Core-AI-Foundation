/**
 * Workspace Interaction Mode Manager (Team 19)
 *
 * Tracks the current interaction mode and manages transitions.
 * Handles gesture conflict detection (e.g. pan vs. box-select during drag).
 */

import type { WorkspaceInteractionMode } from "./types";

export type ModeChangeListener = (
  mode: WorkspaceInteractionMode,
  previous: WorkspaceInteractionMode,
) => void;

/** Allowed transitions map — undefined means all transitions allowed. */
const ALLOWED_TRANSITIONS: Partial<Record<WorkspaceInteractionMode, WorkspaceInteractionMode[]>> = {
  // From "locked" mode, nothing is allowed
  locked: [],
};

export class WorkspaceInteractionModeManager {
  private current: WorkspaceInteractionMode = "select";
  private previous: WorkspaceInteractionMode = "select";
  private readonly listeners: Set<ModeChangeListener> = new Set();

  /** Set the interaction mode. Throws on disallowed transition (e.g. from locked). */
  setMode(mode: WorkspaceInteractionMode): void {
    if (mode === this.current) return;

    const allowed = ALLOWED_TRANSITIONS[this.current];
    if (allowed !== undefined && !allowed.includes(mode)) {
      throw new Error(
        `WorkspaceInteractionModeManager: transition from "${this.current}" to "${mode}" is not allowed.`,
      );
    }

    this.previous = this.current;
    this.current = mode;
    this.notify(mode, this.previous);
  }

  /** Restore the previous mode (e.g. after a temporary pan). */
  restorePrevious(): void {
    if (this.previous === this.current) return;
    this.setMode(this.previous);
  }

  get mode(): WorkspaceInteractionMode {
    return this.current;
  }

  get previousMode(): WorkspaceInteractionMode {
    return this.previous;
  }

  /**
   * Detect potential gesture conflict between a requested mode and the current mode.
   * Returns a conflict description, or null if no conflict.
   */
  detectGestureConflict(
    requested: WorkspaceInteractionMode,
  ): { conflict: true; description: string } | { conflict: false } {
    // Pan conflicts with box-select (both use drag)
    if (
      (this.current === "pan" && requested === "box-select") ||
      (this.current === "box-select" && requested === "pan")
    ) {
      return {
        conflict: true,
        description: `Gesture conflict: "${this.current}" and "${requested}" both use drag gestures. Resolve by releasing the current gesture first.`,
      };
    }

    // Drawing conflicts with select
    if (
      (this.current === "draw" && requested === "select") ||
      (this.current === "select" && requested === "draw")
    ) {
      // Not a hard conflict — select can be interrupted
      return { conflict: false };
    }

    return { conflict: false };
  }

  addListener(listener: ModeChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener: ModeChangeListener): void {
    this.listeners.delete(listener);
  }

  private notify(mode: WorkspaceInteractionMode, previous: WorkspaceInteractionMode): void {
    for (const listener of this.listeners) {
      listener(mode, previous);
    }
  }

  reset(): void {
    this.current = "select";
    this.previous = "select";
    this.listeners.clear();
  }
}
