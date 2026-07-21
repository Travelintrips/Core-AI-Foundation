/**
 * Workspace Selection Manager (Team 19)
 *
 * Manages the selection state for a canvas workspace.
 * All items are referenced by opaque string IDs.
 * Supports: single, toggle, additive, range (with hierarchy), box-select,
 *           locked/unselectable items, primary selection tracking.
 */

import type { WorkspaceSelectionSet, SelectionAddMode } from "./types";

export type SelectionChangeListener = (selection: WorkspaceSelectionSet) => void;

/** Item metadata the selection manager needs to enforce rules */
export type SelectableItem = {
  id: string;
  /** Locked items cannot be selected */
  locked?: boolean;
  /** Ordered position in the layer hierarchy (0 = bottom). Used for range selection. */
  hierarchyIndex?: number;
};

export class WorkspaceSelectionManager {
  private ids: Set<string> = new Set();
  private primaryId: string | null = null;
  private readonly lockedIds: Set<string> = new Set();
  private readonly listeners: Set<SelectionChangeListener> = new Set();

  // ── Lock management ────────────────────────────────────────────────────────

  /** Mark an item as locked (unselectable). Removes it from selection if present. */
  lockItem(id: string): void {
    this.lockedIds.add(id);
    if (this.ids.has(id)) {
      this.ids.delete(id);
      if (this.primaryId === id) this.primaryId = this.ids.size > 0 ? [...this.ids][0]! : null;
      this.notify();
    }
  }

  /** Unlock a previously locked item. */
  unlockItem(id: string): void {
    this.lockedIds.delete(id);
  }

  /** Returns true if the item is locked. */
  isLocked(id: string): boolean {
    return this.lockedIds.has(id);
  }

  // ── Selection operations ───────────────────────────────────────────────────

  /**
   * Select one or more items.
   * @param ids         IDs to operate on
   * @param mode        How the new ids interact with the current selection
   * @param allItems    Full ordered item list (required for range mode)
   */
  select(
    ids: string[],
    mode: SelectionAddMode = "replace",
    allItems?: SelectableItem[],
  ): void {
    const selectable = ids.filter((id) => !this.lockedIds.has(id));

    switch (mode) {
      case "replace": {
        this.ids = new Set(selectable);
        this.primaryId = selectable[selectable.length - 1] ?? null;
        break;
      }

      case "toggle": {
        const id = selectable[0];
        if (!id) break;
        if (this.ids.has(id)) {
          this.ids.delete(id);
          if (this.primaryId === id) {
            this.primaryId = this.ids.size > 0 ? [...this.ids].at(-1)! : null;
          }
        } else {
          this.ids.add(id);
          this.primaryId = id;
        }
        break;
      }

      case "additive": {
        for (const id of selectable) {
          this.ids.add(id);
        }
        if (selectable.length > 0) {
          this.primaryId = selectable[selectable.length - 1]!;
        }
        break;
      }

      case "range": {
        if (!allItems || allItems.length === 0 || selectable.length === 0) break;
        const targetId = selectable[0]!;
        const anchorId = this.primaryId;

        if (!anchorId) {
          // No anchor — treat as replace
          this.ids = new Set(selectable.filter((id) => !this.lockedIds.has(id)));
          this.primaryId = targetId;
          break;
        }

        // Find indices in hierarchy
        const anchorIdx = allItems.findIndex((item) => item.id === anchorId);
        const targetIdx = allItems.findIndex((item) => item.id === targetId);

        if (anchorIdx === -1 || targetIdx === -1) {
          this.ids.add(targetId);
          break;
        }

        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);
        const rangeIds = allItems
          .slice(lo, hi + 1)
          .filter((item) => !item.locked && !this.lockedIds.has(item.id))
          .map((item) => item.id);

        this.ids = new Set(rangeIds);
        // primary stays at anchor
        break;
      }
    }

    this.notify();
  }

  /** Clear the entire selection. */
  clear(): void {
    if (this.ids.size === 0 && this.primaryId === null) return;
    this.ids = new Set();
    this.primaryId = null;
    this.notify();
  }

  /**
   * Select all provided items (respects locks).
   */
  selectAll(allItems: SelectableItem[]): void {
    const selectable = allItems
      .filter((item) => !item.locked && !this.lockedIds.has(item.id))
      .map((item) => item.id);
    this.ids = new Set(selectable);
    this.primaryId = selectable[0] ?? null;
    this.notify();
  }

  /**
   * Box (rubber-band) selection: replace selection with all items whose IDs are in the box set.
   * Does not select locked items.
   */
  boxSelect(idsInBox: string[]): void {
    const selectable = idsInBox.filter((id) => !this.lockedIds.has(id));
    this.ids = new Set(selectable);
    this.primaryId = selectable[0] ?? null;
    this.notify();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Current immutable selection snapshot. */
  getSelection(): WorkspaceSelectionSet {
    return {
      ids: new Set(this.ids),
      primaryId: this.primaryId,
    };
  }

  /** True if the given id is currently selected. */
  isSelected(id: string): boolean {
    return this.ids.has(id);
  }

  /** Number of currently selected items. */
  get size(): number {
    return this.ids.size;
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  addListener(listener: SelectionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener: SelectionChangeListener): void {
    this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getSelection();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /** Reset all state (useful for testing). */
  reset(): void {
    this.ids = new Set();
    this.primaryId = null;
    this.lockedIds.clear();
    this.listeners.clear();
  }
}
