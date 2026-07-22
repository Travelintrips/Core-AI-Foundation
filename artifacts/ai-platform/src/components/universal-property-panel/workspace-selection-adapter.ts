/**
 * WorkspaceSelectionAdapter — minimal adapter for Team 11 integration.
 *
 * Team 11 provides the Canvas Workspace and selection events.
 * Until Team 11's contract is available this file provides:
 *   - A no-op LocalSelectionAdapter (for standalone use / tests)
 *   - A factory that wraps a Team 11–compatible event emitter when available
 *
 * INTEGRATION NOTE: Replace LocalSelectionAdapter with Team 11's
 * WorkspaceSelectionSource when their contract is published.
 * Contract expected:
 *   - team11.getSelection() → WorkspaceSelection
 *   - team11.subscribe(handler) → unsubscribe fn
 * Do NOT create a second Canvas Workspace.
 *
 * IDs are opaque. Core must not interpret domain meaning
 * (sleeve, wall, logo-mark, sofa, etc.).
 */

import type {
  WorkspaceSelection,
  WorkspaceSelectionSource,
  SelectionChangeHandler,
} from "./types";

// ── Local (no-op) adapter ─────────────────────────────────────────────────────

export class LocalSelectionAdapter implements WorkspaceSelectionSource {
  private _selection: WorkspaceSelection;
  private _handlers: Set<SelectionChangeHandler> = new Set();

  constructor(initial: WorkspaceSelection = {}) {
    this._selection = initial;
  }

  getSelection(): WorkspaceSelection {
    return { ...this._selection };
  }

  subscribe(handler: SelectionChangeHandler): () => void {
    this._handlers.add(handler);
    return () => {
      this._handlers.delete(handler);
    };
  }

  /** Programmatically update selection (for testing / standalone use) */
  setSelection(next: WorkspaceSelection): void {
    this._selection = next;
    for (const h of this._handlers) {
      h({ ...next });
    }
  }
}

// ── Team 11 bridge (forward-compatible) ───────────────────────────────────────

/**
 * BridgedSelectionAdapter wraps any object that matches the Team 11
 * WorkspaceSelectionSource interface. Use this when Team 11's module
 * is available at runtime.
 *
 * @integration-note Replace `source` with `team11WorkspaceInstance`
 *   once Team 11 publishes their contract.
 */
export class BridgedSelectionAdapter implements WorkspaceSelectionSource {
  constructor(private readonly _source: WorkspaceSelectionSource) {}

  getSelection(): WorkspaceSelection {
    return this._source.getSelection();
  }

  subscribe(handler: SelectionChangeHandler): () => void {
    return this._source.subscribe(handler);
  }
}

// ── Utility: extract PropertyPanelContext fields from selection ────────────────

export function selectionToContextFields(
  selection: WorkspaceSelection,
): Pick<
  import("./types").PropertyPanelContext,
  | "selectedArtifactId"
  | "selectedFrameId"
  | "selectedElementId"
  | "selectedRegionId"
  | "selectedLayerId"
> {
  return {
    selectedArtifactId: selection.selectedArtifactId,
    selectedFrameId: selection.selectedFrameId,
    selectedElementId: selection.selectedElementId,
    selectedRegionId: selection.selectedRegionId,
    selectedLayerId: selection.selectedLayerId,
  };
}
