/**
 * useWorkspaceSelection — React hook (Team 19)
 *
 * Subscribes to a WorkspaceSelectionManager and returns
 * the current selection snapshot, re-rendering on change.
 */

import { useState, useEffect } from "react";
import type { WorkspaceSelectionSet } from "../types";
import type { WorkspaceSelectionManager } from "../selection-manager";

export function useWorkspaceSelection(
  manager: WorkspaceSelectionManager,
): WorkspaceSelectionSet {
  const [selection, setSelection] = useState<WorkspaceSelectionSet>(
    manager.getSelection,
  );

  useEffect(() => {
    // Sync to latest in case manager changed between render and effect
    setSelection(manager.getSelection());
    const unsubscribe = manager.addListener(setSelection);
    return unsubscribe;
  }, [manager]);

  return selection;
}
