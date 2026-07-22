/**
 * Workspace Undo Stack (Team 19)
 *
 * Command-level local/session undo-redo.
 * Does NOT touch backend persistence — only in-memory command history.
 *
 * Features:
 * - Reversible and non-reversible commands
 * - Command grouping (grouped entries undone together)
 * - Bounded history (configurable max)
 * - Clear on artifact/version change
 * - Failed operations are never pushed (callers must not push on failure)
 */

import type { WorkspaceUndoEntry } from "./types";

export type UndoStackOptions = {
  /** Maximum number of undo entries (not groups). Defaults to 100. */
  maxHistory?: number;
};

export type UndoRedoListener = (canUndo: boolean, canRedo: boolean) => void;

export class WorkspaceUndoStack {
  private past: WorkspaceUndoEntry[] = [];
  private future: WorkspaceUndoEntry[] = [];
  private readonly maxHistory: number;
  private readonly listeners: Set<UndoRedoListener> = new Set();

  constructor(options: UndoStackOptions = {}) {
    this.maxHistory = options.maxHistory ?? 100;
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  /**
   * Push a reversible command onto the history.
   * Call this ONLY after a command has succeeded (ok: true).
   * Non-reversible commands should never be pushed.
   */
  push(entry: WorkspaceUndoEntry): void {
    this.past.push(entry);
    // Trim if over budget
    if (this.past.length > this.maxHistory) {
      this.past = this.past.slice(this.past.length - this.maxHistory);
    }
    // Any new action wipes the redo future
    this.future = [];
    this.notify();
  }

  /**
   * Push multiple entries as a single logical group.
   * All entries will be assigned the same groupId if they don't already have one.
   */
  pushGroup(entries: WorkspaceUndoEntry[], groupId: string): void {
    const tagged = entries.map((e) => ({ ...e, groupId }));
    for (const entry of tagged) {
      this.past.push(entry);
    }
    if (this.past.length > this.maxHistory) {
      this.past = this.past.slice(this.past.length - this.maxHistory);
    }
    this.future = [];
    this.notify();
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  /**
   * Pop the last entry (or group) from past and move it to future.
   * Returns the entries that should be undone (in reverse order).
   */
  undo(): WorkspaceUndoEntry[] {
    if (this.past.length === 0) return [];

    const last = this.past[this.past.length - 1]!;
    let toUndo: WorkspaceUndoEntry[];

    if (last.groupId) {
      // Find all entries belonging to the same group at the tail of past
      const groupId = last.groupId;
      let i = this.past.length - 1;
      while (i >= 0 && this.past[i]!.groupId === groupId) i--;
      toUndo = this.past.splice(i + 1).reverse();
    } else {
      toUndo = [this.past.pop()!];
    }

    this.future.push(...toUndo);
    this.notify();
    return toUndo;
  }

  // ── Redo ──────────────────────────────────────────────────────────────────

  /**
   * Pop the last entry from future back into past.
   * Returns the entries that should be re-executed.
   */
  redo(): WorkspaceUndoEntry[] {
    if (this.future.length === 0) return [];

    const last = this.future[this.future.length - 1]!;
    let toRedo: WorkspaceUndoEntry[];

    if (last.groupId) {
      const groupId = last.groupId;
      let i = this.future.length - 1;
      while (i >= 0 && this.future[i]!.groupId === groupId) i--;
      toRedo = this.future.splice(i + 1).reverse();
    } else {
      toRedo = [this.future.pop()!];
    }

    this.past.push(...toRedo);
    this.notify();
    return toRedo;
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  /**
   * Clear the entire history.
   * Call this when the artifact or version changes to prevent cross-version undo.
   */
  clear(): void {
    this.past = [];
    this.future = [];
    this.notify();
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get historySize(): number {
    return this.past.length;
  }

  get futureSize(): number {
    return this.future.length;
  }

  /** Snapshot of past entries (oldest first). */
  getPast(): WorkspaceUndoEntry[] {
    return [...this.past];
  }

  // ── Listeners ─────────────────────────────────────────────────────────────

  addListener(listener: UndoRedoListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener: UndoRedoListener): void {
    this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.canUndo, this.canRedo);
    }
  }
}
