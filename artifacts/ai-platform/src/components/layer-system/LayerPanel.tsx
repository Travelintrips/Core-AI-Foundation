/**
 * Universal Design Layer System — LayerPanel
 *
 * Reusable hierarchical layer panel. Domain-neutral: accepts a LayerTree
 * and emits typed LayerMutation events. Never references domain-specific
 * concepts (sleeve, wall, dieline, etc.).
 *
 * Features:
 * - Hierarchical rows with indentation
 * - Expand / collapse (keyboard: ArrowLeft/Right)
 * - Visibility toggle (show/hide)
 * - Lock toggle
 * - Inline rename (double-click or F2, keyboard: Enter/Escape)
 * - Move up/down fallback (no heavy DnD library)
 * - Context: empty / loading / error states
 * - Semantic tree/treeitem ARIA roles
 * - Full keyboard navigation (ArrowUp/Down to move focus, Enter to select)
 * - Focus indicator on all interactive elements
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { Loader2, AlertCircle, Layers } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { LayerMutation, LayerNode, LayerSelection, LayerTree } from "@/lib/layer-system/types";
import {
  flattenLayerTree,
  findLayer,
  guardMutation,
  reorderLayer,
} from "@/lib/layer-system/utils";
import { LayerRow } from "./LayerRow";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LayerPanelProps {
  /** The layer tree to display. null renders loading or empty state. */
  tree: LayerTree | null;
  /** Current workspace selection. */
  selection: LayerSelection;
  /** Loading state — shows skeleton/spinner when true. */
  loading?: boolean;
  /** Error message — shows error state when provided. */
  error?: string | null;
  /**
   * Called when the user requests a mutation.
   * The panel validates capability before calling this.
   */
  onMutate: (mutation: LayerMutation) => void;
  /** Optional class name for the outer container. */
  className?: string;
  /** Accessibility label for the panel (defaults to "Layers"). */
  "aria-label"?: string;
}

// ── Recursive row renderer ────────────────────────────────────────────────────

interface RowsProps {
  nodes: LayerNode[];
  tree: LayerTree;
  depth: number;
  expandedIds: Set<string>;
  selection: LayerSelection;
  renamingId: string | null;
  renameValue: string;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRenameStart: (id: string, name: string) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function LayerRows({
  nodes,
  tree,
  depth,
  expandedIds,
  selection,
  renamingId,
  renameValue,
  onToggleExpand,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onMoveUp,
  onMoveDown,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: RowsProps) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <LayerRow
            node={node}
            tree={tree}
            depth={depth}
            isExpanded={expandedIds.has(node.id)}
            selection={selection}
            isRenaming={renamingId === node.id}
            renameValue={renameValue}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
            onToggleVisibility={onToggleVisibility}
            onToggleLock={onToggleLock}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onRenameStart={onRenameStart}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
          />
          {node.children.length > 0 && expandedIds.has(node.id) && (
            <LayerRows
              nodes={node.children}
              tree={tree}
              depth={depth + 1}
              expandedIds={expandedIds}
              selection={selection}
              renamingId={renamingId}
              renameValue={renameValue}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onToggleVisibility={onToggleVisibility}
              onToggleLock={onToggleLock}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRenameStart={onRenameStart}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          )}
        </div>
      ))}
    </>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function LayerPanel({
  tree,
  selection,
  loading = false,
  error = null,
  onMutate,
  className,
  "aria-label": ariaLabel = "Layers",
}: LayerPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const treeRef = useRef<HTMLDivElement>(null);

  // Sync expanded state when tree changes (auto-expand roots)
  useEffect(() => {
    if (!tree) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      tree.roots.forEach((r) => {
        if (r.children.length > 0) next.add(r.id);
      });
      return next;
    });
  }, [tree?.artifactId]); // only re-run when artifact changes

  // ── Expand / collapse ─────────────────────────────────────────────────────

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Selection ─────────────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string, multi: boolean) => {
      if (!tree) return;
      const node = findLayer(tree, id);
      if (!node || !node.capabilities.includes("select")) return;

      const err = guardMutation(tree, { op: "select", ids: [id] });
      if (err) return;

      const newIds = multi
        ? selection.selectedIds.includes(id)
          ? selection.selectedIds.filter((s) => s !== id)
          : [...selection.selectedIds, id]
        : [id];

      onMutate({ op: "select", ids: newIds, primary: id });
    },
    [tree, selection, onMutate],
  );

  // ── Visibility ────────────────────────────────────────────────────────────

  const handleToggleVisibility = useCallback(
    (id: string) => {
      if (!tree) return;
      const node = findLayer(tree, id);
      if (!node) return;
      const err = guardMutation(tree, { op: node.visible ? "hide" : "show", id });
      if (err) return;
      onMutate({ op: node.visible ? "hide" : "show", id });
    },
    [tree, onMutate],
  );

  // ── Lock ──────────────────────────────────────────────────────────────────

  const handleToggleLock = useCallback(
    (id: string) => {
      if (!tree) return;
      const node = findLayer(tree, id);
      if (!node) return;
      // Lock/unlock is allowed even when locked (to unlock)
      const mut: LayerMutation = { op: node.locked ? "unlock" : "lock", id };
      onMutate(mut);
    },
    [tree, onMutate],
  );

  // ── Reorder (move up/down fallback) ──────────────────────────────────────

  const handleMoveUp = useCallback(
    (id: string) => {
      if (!tree) return;
      const node = findLayer(tree, id);
      if (!node || !node.capabilities.includes("reorder")) return;
      const result = reorderLayer(tree, id, Math.max(0, node.order - 1));
      if ("error" in result) return;
      onMutate({ op: "reorder", id, newOrder: Math.max(0, node.order - 1), parentId: node.parentId });
    },
    [tree, onMutate],
  );

  const handleMoveDown = useCallback(
    (id: string) => {
      if (!tree) return;
      const node = findLayer(tree, id);
      if (!node || !node.capabilities.includes("reorder")) return;
      onMutate({ op: "reorder", id, newOrder: node.order + 1, parentId: node.parentId });
    },
    [tree, onMutate],
  );

  // ── Rename ────────────────────────────────────────────────────────────────

  const handleRenameStart = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const handleRenameCommit = useCallback(() => {
    if (!tree || !renamingId) return;
    const node = findLayer(tree, renamingId);
    if (node && renameValue.trim() && renameValue.trim() !== node.name) {
      const err = guardMutation(tree, { op: "rename", id: renamingId, name: renameValue.trim() });
      if (!err) {
        onMutate({ op: "rename", id: renamingId, name: renameValue.trim() });
      }
    }
    setRenamingId(null);
    setRenameValue("");
  }, [tree, renamingId, renameValue, onMutate]);

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!tree) return;
      const flat = flattenLayerTree(tree).filter((n) => {
        // Only visible-in-UI nodes: root nodes or nodes whose parent is expanded
        if (n.parentId === null) return true;
        return expandedIds.has(n.parentId);
      });

      const focusedEl = document.activeElement as HTMLElement | null;
      const focusedId = focusedEl?.dataset?.layerId;
      const currentIndex = flat.findIndex((n) => n.id === focusedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = flat[currentIndex + 1];
        if (next) {
          treeRef.current
            ?.querySelector<HTMLElement>(`[data-layer-id="${next.id}"]`)
            ?.focus();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = flat[currentIndex - 1];
        if (prev) {
          treeRef.current
            ?.querySelector<HTMLElement>(`[data-layer-id="${prev.id}"]`)
            ?.focus();
        }
      }
    },
    [tree, expandedIds],
  );

  // ── Node count ────────────────────────────────────────────────────────────

  const nodeCount = tree ? flattenLayerTree(tree).length : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn("flex flex-col h-full bg-white border-r border-slate-200", className)}
      data-testid="layer-panel"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide select-none">
          Layers
        </span>
        {!loading && !error && nodeCount > 0 && (
          <span className="text-[10px] text-slate-400 tabular-nums">{nodeCount}</span>
        )}
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Loading state */}
        {loading && (
          <div
            className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400"
            data-testid="layer-panel-loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="text-xs">Loading layers…</span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            className="flex flex-col items-center justify-center py-10 px-3 gap-2 text-red-500"
            data-testid="layer-panel-error"
            role="alert"
          >
            <AlertCircle className="h-5 w-5" aria-hidden />
            <span className="text-xs text-center">{error}</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && (!tree || nodeCount === 0) && (
          <div
            className="flex flex-col items-center justify-center py-12 px-4 gap-2 text-slate-400"
            data-testid="layer-panel-empty"
          >
            <Layers className="h-8 w-8 text-slate-200" aria-hidden />
            <p className="text-xs text-center leading-relaxed text-slate-400">
              No layers yet.
            </p>
          </div>
        )}

        {/* Tree */}
        {!loading && !error && tree && nodeCount > 0 && (
          <div
            ref={treeRef}
            role="tree"
            aria-label={ariaLabel}
            aria-multiselectable
            className="py-1 outline-none"
            onKeyDown={handleKeyDown}
            data-testid="layer-tree"
          >
            <LayerRows
              nodes={tree.roots}
              tree={tree}
              depth={0}
              expandedIds={expandedIds}
              selection={selection}
              renamingId={renamingId}
              renameValue={renameValue}
              onToggleExpand={handleToggleExpand}
              onSelect={handleSelect}
              onToggleVisibility={handleToggleVisibility}
              onToggleLock={handleToggleLock}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onRenameStart={handleRenameStart}
              onRenameChange={setRenameValue}
              onRenameCommit={handleRenameCommit}
              onRenameCancel={handleRenameCancel}
            />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
