/**
 * Workspace Context Menu Builder (Team 19)
 *
 * Builds a context-aware menu based on selection state and available commands.
 * Pure function — no React, no rendering.
 */

import type {
  ContextMenuItem,
  ContextMenuRequest,
  WorkspaceCommand,
} from "./types";
import type { WorkspaceCommandContext } from "./types";
import type { WorkspaceCommandRegistry } from "./command-registry";
import type { WorkspaceShortcutRegistry } from "./shortcut-registry";

/** Map of commandId → shortcut hint string for display in menu items */
type ShortcutHintMap = Map<string, string>;

function buildShortcutHints(shortcutRegistry: WorkspaceShortcutRegistry): ShortcutHintMap {
  const map = new Map<string, string>();
  for (const s of shortcutRegistry.getAllShortcuts()) {
    if (!map.has(s.commandId)) {
      map.set(s.commandId, s.description ?? s.key);
    }
  }
  return map;
}

function makeItem(
  command: WorkspaceCommand,
  disabled: boolean,
  hintMap: ShortcutHintMap,
): ContextMenuItem {
  return {
    kind: "action",
    commandId: command.id,
    label: command.label,
    disabled,
    shortcutHint: hintMap.get(command.id),
  };
}

/**
 * Build the context menu for a given request.
 * Commands are grouped into logical sections separated by separators.
 */
export function buildContextMenu(
  request: ContextMenuRequest,
  commandRegistry: WorkspaceCommandRegistry,
  shortcutRegistry: WorkspaceShortcutRegistry,
  ctx: WorkspaceCommandContext,
): ContextMenuItem[] {
  const hints = buildShortcutHints(shortcutRegistry);
  const hasSelection = ctx.selectedIds.size > 0;
  const hasClipboard = ctx.capabilities.has("can-paste");

  const items: ContextMenuItem[] = [];

  // ── Selection section ────────────────────────────────────────────────────
  const selectAll = commandRegistry.getCommand("select-all");
  if (selectAll) {
    items.push(makeItem(selectAll, false, hints));
  }
  if (hasSelection) {
    const clearSel = commandRegistry.getCommand("clear-selection");
    if (clearSel) items.push(makeItem(clearSel, false, hints));
  }

  items.push({ kind: "separator" });

  // ── Edit section ─────────────────────────────────────────────────────────
  if (hasSelection) {
    for (const id of ["copy", "duplicate", "delete"]) {
      const cmd = commandRegistry.getCommand(id);
      if (!cmd) continue;
      const avail = commandRegistry.isAvailable(cmd, ctx);
      items.push(makeItem(cmd, !avail.available, hints));
    }
  }

  const paste = commandRegistry.getCommand("paste");
  if (paste) {
    items.push(makeItem(paste, !hasClipboard, hints));
  }

  items.push({ kind: "separator" });

  // ── Layer section ────────────────────────────────────────────────────────
  if (hasSelection) {
    for (const id of ["bring-forward", "send-backward"]) {
      const cmd = commandRegistry.getCommand(id);
      if (!cmd) continue;
      const avail = commandRegistry.isAvailable(cmd, ctx);
      items.push(makeItem(cmd, !avail.available, hints));
    }
    items.push({ kind: "separator" });
  }

  // ── Lock/visibility section ───────────────────────────────────────────────
  if (hasSelection) {
    for (const id of ["lock", "unlock", "show", "hide"]) {
      const cmd = commandRegistry.getCommand(id);
      if (!cmd) continue;
      const avail = commandRegistry.isAvailable(cmd, ctx);
      items.push(makeItem(cmd, !avail.available, hints));
    }
    items.push({ kind: "separator" });
  }

  // ── Undo/Redo section ────────────────────────────────────────────────────
  const undoCmd = commandRegistry.getCommand("undo");
  const redoCmd = commandRegistry.getCommand("redo");
  if (undoCmd) {
    const avail = commandRegistry.isAvailable(undoCmd, ctx);
    items.push(makeItem(undoCmd, !avail.available, hints));
  }
  if (redoCmd) {
    const avail = commandRegistry.isAvailable(redoCmd, ctx);
    items.push(makeItem(redoCmd, !avail.available, hints));
  }

  // Remove trailing separator
  while (items.length > 0 && items[items.length - 1]!.kind === "separator") {
    items.pop();
  }

  return items;
}
