/**
 * Workspace Shortcut Registry (Team 19)
 *
 * Manages keyboard shortcut bindings for workspace commands.
 * Features:
 * - Duplicate shortcut conflict detection
 * - Platform key normalisation (Ctrl on Win/Linux, Meta on Mac)
 * - Input protection — does not fire when user is typing in an input
 * - Disabled command support
 * - Accessible help listing
 * - Full event listener cleanup
 */

import type { WorkspaceShortcut, ShortcutModifier } from "./types";

type ShortcutCallback = (commandId: string, shortcutId: string) => void;

/** Detect macOS so we can map platformKey → Meta */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/** Returns true if the event target is an input-like element (typing context).
 *  Uses duck typing so it works in Node.js test environments (no DOM globals). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as unknown as Record<string, unknown>;
  if (typeof el["tagName"] !== "string") return false;
  const tag = el["tagName"].toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el["isContentEditable"] === true) return true;
  return false;
}

/** Normalise a shortcut to a stable string key for conflict detection */
export function normaliseShortcutKey(shortcut: WorkspaceShortcut): string {
  const mods = new Set<string>(shortcut.modifiers ?? []);

  if (shortcut.platformKey) {
    // Replace ctrl/meta with the platform-appropriate one
    mods.delete("ctrl");
    mods.delete("meta");
    mods.add(isMac() ? "meta" : "ctrl");
  }

  const parts = Array.from(mods).sort();
  parts.push(shortcut.key.toLowerCase());
  return parts.join("+");
}

/** Check whether a keyboard event matches a shortcut */
function eventMatchesShortcut(e: KeyboardEvent, shortcut: WorkspaceShortcut): boolean {
  const key = e.key;
  if (key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const mods = new Set<ShortcutModifier>(shortcut.modifiers ?? []);

  // Resolve platformKey
  let needsCtrl = mods.has("ctrl");
  let needsMeta = mods.has("meta");
  if (shortcut.platformKey) {
    if (isMac()) {
      needsMeta = true;
      needsCtrl = false;
    } else {
      needsCtrl = true;
      needsMeta = false;
    }
  }

  if (needsCtrl !== e.ctrlKey) return false;
  if (needsMeta !== e.metaKey) return false;
  if (mods.has("shift") !== e.shiftKey) return false;
  if (mods.has("alt") !== e.altKey) return false;
  return true;
}

export class WorkspaceShortcutRegistry {
  private readonly shortcuts = new Map<string, WorkspaceShortcut>();
  /** normalised key → shortcut id — for conflict detection */
  private readonly keyIndex = new Map<string, string>();
  private readonly disabledCommandIds = new Set<string>();

  private boundListener: ((e: KeyboardEvent) => void) | null = null;
  private listenerTarget: EventTarget | null = null;
  private callback: ShortcutCallback | null = null;

  /**
   * Register a shortcut.
   * Throws if the normalised key combination is already registered.
   */
  registerShortcut(shortcut: WorkspaceShortcut): void {
    if (this.shortcuts.has(shortcut.id)) {
      throw new Error(
        `WorkspaceShortcutRegistry: duplicate shortcut id "${shortcut.id}".`,
      );
    }
    const normKey = normaliseShortcutKey(shortcut);
    if (this.keyIndex.has(normKey)) {
      const existingId = this.keyIndex.get(normKey)!;
      throw new Error(
        `WorkspaceShortcutRegistry: shortcut key conflict — "${normKey}" ` +
        `is already registered by shortcut "${existingId}". ` +
        `Resolve the conflict before registering "${shortcut.id}".`,
      );
    }
    this.shortcuts.set(shortcut.id, shortcut);
    this.keyIndex.set(normKey, shortcut.id);
  }

  /** Remove a previously registered shortcut. */
  unregisterShortcut(id: string): void {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) return;
    const normKey = normaliseShortcutKey(shortcut);
    this.keyIndex.delete(normKey);
    this.shortcuts.delete(id);
  }

  /** Mark a command as disabled — its shortcuts will be ignored. */
  disableCommand(commandId: string): void {
    this.disabledCommandIds.add(commandId);
  }

  /** Re-enable a previously disabled command. */
  enableCommand(commandId: string): void {
    this.disabledCommandIds.delete(commandId);
  }

  /** Returns true if the command is currently disabled. */
  isCommandDisabled(commandId: string): boolean {
    return this.disabledCommandIds.has(commandId);
  }

  /**
   * Attach a keydown listener to the given target (default: window).
   * The callback is invoked for every matching, non-conflicting, non-disabled shortcut.
   * Call detach() to remove the listener.
   */
  attach(callback: ShortcutCallback, target: EventTarget = window): void {
    if (this.boundListener) this.detach();

    this.callback = callback;
    this.listenerTarget = target;

    this.boundListener = (e: KeyboardEvent) => {
      // Do not intercept shortcuts when the user is typing
      if (isTypingTarget(e.target)) return;

      for (const shortcut of this.shortcuts.values()) {
        if (this.disabledCommandIds.has(shortcut.commandId)) continue;
        if (eventMatchesShortcut(e, shortcut)) {
          e.preventDefault();
          callback(shortcut.commandId, shortcut.id);
          return; // first match wins
        }
      }
    };

    target.addEventListener("keydown", this.boundListener as EventListener);
  }

  /** Remove the attached keydown listener. Safe to call multiple times. */
  detach(): void {
    if (this.boundListener && this.listenerTarget) {
      this.listenerTarget.removeEventListener(
        "keydown",
        this.boundListener as EventListener,
      );
    }
    this.boundListener = null;
    this.listenerTarget = null;
    this.callback = null;
  }

  /** Returns all registered shortcuts (for accessibility help UI). */
  getShortcutHelp(): Array<{ shortcutId: string; commandId: string; description: string; keys: string }> {
    return Array.from(this.shortcuts.values()).map((s) => ({
      shortcutId: s.id,
      commandId: s.commandId,
      description: s.description ?? s.commandId,
      keys: normaliseShortcutKey(s),
    }));
  }

  /** Returns all registered shortcuts. */
  getAllShortcuts(): WorkspaceShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /** Check if a given shortcut key combination is already registered. */
  hasConflict(shortcut: WorkspaceShortcut): boolean {
    const normKey = normaliseShortcutKey(shortcut);
    return this.keyIndex.has(normKey);
  }

  /** Clear all shortcuts and detach listener. */
  clear(): void {
    this.detach();
    this.shortcuts.clear();
    this.keyIndex.clear();
    this.disabledCommandIds.clear();
  }
}
