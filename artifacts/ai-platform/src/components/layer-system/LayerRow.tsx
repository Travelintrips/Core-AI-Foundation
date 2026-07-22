/**
 * Universal Design Layer System — LayerRow
 *
 * A single row in the layer panel. Domain-neutral — never references
 * sleeve, wall, dieline, or any domain-specific concept.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Layers,
  Type,
  Image,
  Square,
  Video,
  Music,
  Component,
  Pen,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayerNode, LayerSelection } from "@/lib/layer-system/types";
import { deriveEffectiveLock, deriveEffectiveVisibility } from "@/lib/layer-system/utils";
import type { LayerTree } from "@/lib/layer-system/types";

// ── Type icon ─────────────────────────────────────────────────────────────────

function NodeTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = cn("h-3 w-3 shrink-0", className);
  switch (type) {
    case "group":     return <Layers className={cls} />;
    case "text":      return <Type className={cls} />;
    case "image":     return <Image className={cls} />;
    case "shape":     return <Square className={cls} />;
    case "video":     return <Video className={cls} />;
    case "audio":     return <Music className={cls} />;
    case "component": return <Component className={cls} />;
    case "annotation":return <Pen className={cls} />;
    case "line":      return <Minus className={cls} />;
    default:          return <Square className={cls} />;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LayerRowProps {
  node: LayerNode;
  tree: LayerTree;
  depth: number;
  isExpanded: boolean;
  selection: LayerSelection;
  isRenaming: boolean;
  renameValue: string;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string, multi: boolean) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRenameStart: (id: string, currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LayerRow({
  node,
  tree,
  depth,
  isExpanded,
  selection,
  isRenaming,
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
}: LayerRowProps) {
  const isSelected = selection.selectedIds.includes(node.id);
  const isPrimary = selection.primaryId === node.id;
  const hasChildren = node.children.length > 0;
  const effectivelyVisible = deriveEffectiveVisibility(tree, node.id);
  const effectivelyLocked = deriveEffectiveLock(tree, node.id);

  const canShowHide = node.capabilities.includes("show-hide");
  const canLockUnlock = node.capabilities.includes("lock-unlock");
  const canRename = node.capabilities.includes("rename");
  const canReorder = node.capabilities.includes("reorder");

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      data-layer-id={node.id}
      data-testid={`layer-row-${node.id}`}
      tabIndex={isSelected ? 0 : -1}
      className={cn(
        "group flex items-center gap-1 px-1 py-0.5 cursor-pointer select-none text-xs transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
        isSelected && isPrimary
          ? "bg-blue-100 text-blue-900"
          : isSelected
            ? "bg-blue-50 text-blue-800"
            : "hover:bg-slate-50 text-slate-700",
        !effectivelyVisible && "opacity-50",
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={(e) => {
        if (!effectivelyLocked || node.capabilities.includes("select")) {
          onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
        }
      }}
      onKeyDown={(e) => {
        switch (e.key) {
          case "Enter":
          case " ":
            e.preventDefault();
            onSelect(node.id, false);
            break;
          case "ArrowRight":
            e.preventDefault();
            if (hasChildren && !isExpanded) onToggleExpand(node.id);
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (hasChildren && isExpanded) onToggleExpand(node.id);
            break;
          case "F2":
            if (canRename) {
              e.preventDefault();
              onRenameStart(node.id, node.name);
            }
            break;
        }
      }}
    >
      {/* Expand / collapse toggle */}
      <button
        className="shrink-0 p-0 w-4 h-4 flex items-center justify-center rounded hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand(node.id);
        }}
        aria-label={hasChildren ? (isExpanded ? "Collapse group" : "Expand group") : undefined}
        tabIndex={-1}
        aria-hidden={!hasChildren}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-slate-400" />
          ) : (
            <ChevronRight className="h-3 w-3 text-slate-400" />
          )
        ) : null}
      </button>

      {/* Type icon */}
      <NodeTypeIcon
        type={node.type}
        className={cn(
          "shrink-0",
          isSelected ? "text-blue-600" : "text-slate-400",
        )}
      />

      {/* Name / rename input */}
      {isRenaming ? (
        <input
          autoFocus
          className="flex-1 text-xs bg-white border border-blue-400 rounded px-1 py-0 outline-none min-w-0"
          value={renameValue}
          data-testid={`rename-input-${node.id}`}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onRenameCommit();
            if (e.key === "Escape") onRenameCancel();
          }}
          onBlur={onRenameCommit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 truncate min-w-0"
          onDoubleClick={(e) => {
            if (canRename) {
              e.stopPropagation();
              onRenameStart(node.id, node.name);
            }
          }}
          title={node.name}
        >
          {node.name}
        </span>
      )}

      {/* Inline status indicators (always visible) */}
      <span className="shrink-0 flex items-center gap-0.5 ml-auto">
        {!effectivelyVisible && !isSelected && (
          <EyeOff className="h-2.5 w-2.5 text-slate-300" aria-hidden />
        )}
        {effectivelyLocked && !isSelected && (
          <Lock className="h-2.5 w-2.5 text-slate-300" aria-hidden />
        )}
      </span>

      {/* Hover / selected actions */}
      <span
        className={cn(
          "shrink-0 flex items-center gap-0.5",
          isSelected ? "flex" : "hidden group-hover:flex",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {canReorder && (
          <>
            <button
              className="p-0.5 rounded hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              onClick={() => onMoveUp(node.id)}
              aria-label={`Move "${node.name}" up`}
              tabIndex={-1}
              title="Move up"
            >
              <span className="text-slate-400 leading-none text-[10px]">▲</span>
            </button>
            <button
              className="p-0.5 rounded hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              onClick={() => onMoveDown(node.id)}
              aria-label={`Move "${node.name}" down`}
              tabIndex={-1}
              title="Move down"
            >
              <span className="text-slate-400 leading-none text-[10px]">▼</span>
            </button>
          </>
        )}

        {canShowHide && (
          <button
            className="p-0.5 rounded hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            onClick={() => onToggleVisibility(node.id)}
            aria-label={node.visible ? `Hide "${node.name}"` : `Show "${node.name}"`}
            aria-pressed={!node.visible}
            tabIndex={-1}
            title={node.visible ? "Hide" : "Show"}
          >
            {node.visible ? (
              <Eye className="h-3 w-3 text-slate-500" />
            ) : (
              <EyeOff className="h-3 w-3 text-slate-400" />
            )}
          </button>
        )}

        {canLockUnlock && (
          <button
            className="p-0.5 rounded hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            onClick={() => onToggleLock(node.id)}
            aria-label={node.locked ? `Unlock "${node.name}"` : `Lock "${node.name}"`}
            aria-pressed={node.locked}
            tabIndex={-1}
            title={node.locked ? "Unlock" : "Lock"}
          >
            {node.locked ? (
              <Lock className="h-3 w-3 text-slate-500" />
            ) : (
              <Unlock className="h-3 w-3 text-slate-400" />
            )}
          </button>
        )}
      </span>
    </div>
  );
}
