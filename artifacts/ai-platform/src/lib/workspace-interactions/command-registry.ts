/**
 * Workspace Command Registry (Team 19)
 *
 * Central registry for registering, looking up, and executing workspace commands.
 * Commands are capability-aware and permission-aware.
 * No domain-specific logic here — purely structural.
 */

import type {
  WorkspaceCommand,
  WorkspaceCommandHandler,
  WorkspaceCommandContext,
  WorkspaceCommandResult,
} from "./types";

export class WorkspaceCommandRegistry {
  private readonly commands = new Map<string, WorkspaceCommand>();
  private readonly handlers = new Map<string, WorkspaceCommandHandler<unknown>>();

  /**
   * Register a command definition.
   * Throws if a command with the same id is already registered.
   */
  registerCommand(command: WorkspaceCommand): void {
    if (this.commands.has(command.id)) {
      throw new Error(
        `WorkspaceCommandRegistry: duplicate command id "${command.id}". ` +
        `Each command id must be unique across the registry.`,
      );
    }
    this.commands.set(command.id, command);
  }

  /**
   * Register a handler for a command.
   * The command must already be registered.
   * Throws if handler already registered for this commandId.
   */
  registerHandler<TPayload>(handler: WorkspaceCommandHandler<TPayload>): void {
    if (!this.commands.has(handler.commandId)) {
      throw new Error(
        `WorkspaceCommandRegistry: cannot register handler for unknown command "${handler.commandId}". ` +
        `Register the command first.`,
      );
    }
    if (this.handlers.has(handler.commandId)) {
      throw new Error(
        `WorkspaceCommandRegistry: handler already registered for command "${handler.commandId}".`,
      );
    }
    this.handlers.set(handler.commandId, handler as WorkspaceCommandHandler<unknown>);
  }

  /** Look up a registered command definition. Returns undefined if not found. */
  getCommand(id: string): WorkspaceCommand | undefined {
    return this.commands.get(id);
  }

  /** Returns all registered command definitions. */
  getAllCommands(): WorkspaceCommand[] {
    return Array.from(this.commands.values());
  }

  /** Returns commands that are currently available given the context. */
  getAvailableCommands(ctx: WorkspaceCommandContext): WorkspaceCommand[] {
    return this.getAllCommands().filter((cmd) => this.isAvailable(cmd, ctx).available);
  }

  /**
   * Execute a command by id with a payload.
   * Returns a result indicating success or failure reason.
   * Failed commands are NOT pushed to undo history — callers must check result.ok.
   */
  execute<TPayload>(
    commandId: string,
    payload: TPayload,
    ctx: WorkspaceCommandContext,
  ): WorkspaceCommandResult {
    const command = this.commands.get(commandId);
    if (!command) {
      return { ok: false, reason: `Unknown command "${commandId}"` };
    }

    const availability = this.isAvailable(command, ctx);
    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }

    const handler = this.handlers.get(commandId);
    if (!handler) {
      return { ok: false, reason: `No handler registered for command "${commandId}"` };
    }

    return handler.execute(payload, ctx);
  }

  /**
   * Check whether a command is available in the given context.
   * Returns { available: true } or { available: false, reason }.
   */
  isAvailable(
    command: WorkspaceCommand,
    ctx: WorkspaceCommandContext,
  ): { available: true } | { available: false; reason: string } {
    if (command.disabled) {
      return { available: false, reason: `Command "${command.id}" is disabled` };
    }

    if (command.requiresSelection && ctx.selectedIds.size === 0) {
      return { available: false, reason: `Command "${command.id}" requires a selection` };
    }

    if (command.capabilities) {
      for (const cap of command.capabilities) {
        if (!ctx.capabilities.has(cap)) {
          return {
            available: false,
            reason: `Command "${command.id}" requires capability "${cap}"`,
          };
        }
      }
    }

    if (command.permissions) {
      for (const perm of command.permissions) {
        if (!ctx.permissions.has(perm)) {
          return {
            available: false,
            reason: `Command "${command.id}" requires permission "${perm}"`,
          };
        }
      }
    }

    return { available: true };
  }

  /** Remove a command and its handler from the registry. */
  unregisterCommand(id: string): void {
    this.commands.delete(id);
    this.handlers.delete(id);
  }

  /** Clear all commands and handlers (useful for testing). */
  clear(): void {
    this.commands.clear();
    this.handlers.clear();
  }
}
