/**
 * useWorkspaceShortcuts — React hook (Team 19)
 *
 * Attaches the WorkspaceShortcutRegistry listener to the window on mount
 * and cleans up on unmount. The callback is called when a shortcut fires.
 */

import { useEffect, useRef } from "react";
import { WorkspaceShortcutRegistry } from "../shortcut-registry";

export type ShortcutFiredCallback = (commandId: string, shortcutId: string) => void;

export function useWorkspaceShortcuts(
  registry: WorkspaceShortcutRegistry,
  onShortcutFired: ShortcutFiredCallback,
  target?: EventTarget,
): void {
  // Stable ref to callback so we don't re-attach on every render
  const callbackRef = useRef<ShortcutFiredCallback>(onShortcutFired);
  callbackRef.current = onShortcutFired;

  useEffect(() => {
    registry.attach((commandId, shortcutId) => {
      callbackRef.current(commandId, shortcutId);
    }, target ?? window);

    return () => {
      registry.detach();
    };
    // registry and target are stable references — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, target]);
}
