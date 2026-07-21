/**
 * Workspace Clipboard Manager (Team 19)
 *
 * Internal (in-memory) clipboard for workspace items.
 * Clipboard is project-scoped: pasting into a different project is rejected.
 *
 * Note: This does not integrate with the OS clipboard (navigator.clipboard).
 * It is a session-local reference clipboard for copy/paste within the workspace.
 */

import type { WorkspaceClipboardPayload } from "./types";

export type ClipboardValidationResult =
  | { valid: true; payload: WorkspaceClipboardPayload }
  | { valid: false; reason: string };

export class WorkspaceClipboardManager {
  private payload: WorkspaceClipboardPayload | null = null;

  /**
   * Copy items to the clipboard.
   * @param projectId    Owning project — must match at paste time
   * @param artifactType Logical artifact type (e.g. "design-template")
   * @param items        Opaque item payloads
   */
  copy(projectId: string, artifactType: string, items: unknown[]): void {
    if (items.length === 0) {
      throw new Error("WorkspaceClipboardManager: cannot copy empty items array.");
    }
    this.payload = {
      projectId,
      artifactType,
      items: [...items], // shallow copy to prevent mutation
      copiedAt: Date.now(),
    };
  }

  /**
   * Retrieve the clipboard payload, validated against the caller's project.
   * Returns { valid: false } if clipboard is empty or project doesn't match.
   */
  paste(projectId: string): ClipboardValidationResult {
    if (!this.payload) {
      return { valid: false, reason: "Clipboard is empty." };
    }

    if (this.payload.projectId !== projectId) {
      return {
        valid: false,
        reason:
          `Clipboard contains items from project "${this.payload.projectId}". ` +
          `Cannot paste into project "${projectId}". Cross-project paste is not allowed.`,
      };
    }

    return { valid: true, payload: { ...this.payload, items: [...this.payload.items] } };
  }

  /** True if there is something on the clipboard. */
  get hasContent(): boolean {
    return this.payload !== null;
  }

  /** True if the clipboard belongs to the given project. */
  belongsTo(projectId: string): boolean {
    return this.payload?.projectId === projectId;
  }

  /** Clear the clipboard. */
  clear(): void {
    this.payload = null;
  }

  /** Peek at the raw payload (for debugging/testing — callers should use paste()). */
  peek(): WorkspaceClipboardPayload | null {
    return this.payload ? { ...this.payload, items: [...this.payload.items] } : null;
  }
}
