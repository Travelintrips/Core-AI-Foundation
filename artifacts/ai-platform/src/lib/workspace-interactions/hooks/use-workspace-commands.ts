/**
 * useWorkspaceCommands — React hook (Team 19)
 *
 * Provides a stable `executeCommand` function bound to the current context.
 * Integrates with the undo stack: reversible successful commands are pushed automatically.
 */

import { useCallback } from "react";
import type { WorkspaceCommandRegistry } from "../command-registry";
import type { WorkspaceCommandContext, WorkspaceCommandResult } from "../types";
import type { WorkspaceUndoStack } from "../undo-stack";

export type UseWorkspaceCommandsReturn = {
  executeCommand: <TPayload>(
    commandId: string,
    payload: TPayload,
  ) => WorkspaceCommandResult;
};

export function useWorkspaceCommands(
  registry: WorkspaceCommandRegistry,
  ctx: WorkspaceCommandContext,
  undoStack: WorkspaceUndoStack,
): UseWorkspaceCommandsReturn {
  const executeCommand = useCallback(
    <TPayload>(commandId: string, payload: TPayload): WorkspaceCommandResult => {
      const result = registry.execute(commandId, payload, ctx);

      if (result.ok) {
        const command = registry.getCommand(commandId);
        // Only push to undo history if the command is reversible and succeeded
        if (command?.reversible && result.undoPayload !== undefined) {
          undoStack.push({
            commandId,
            undoPayload: result.undoPayload,
            timestamp: Date.now(),
          });
        }
      }

      return result;
    },
    [registry, ctx, undoStack],
  );

  return { executeCommand };
}
