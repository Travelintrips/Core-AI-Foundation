/**
 * Team 13 — Dynamic Design Composition Engine
 * Composition State Guard
 *
 * Enforces terminal-state rules for composition sessions:
 *
 *   completed  → BLOCKED (return existing result, no reprocess)
 *   cancelled  → BLOCKED (create a new request instead)
 *   failed     → BLOCKED unless allowRetry=true (explicit caller decision)
 *   processing → BLOCKED (concurrent execution guard)
 *   pending    → ALLOWED
 *
 * State machine transitions:
 *
 *   pending    → processing | cancelled
 *   processing → completed | failed | cancelled
 *   completed  → (terminal — no transitions)
 *   failed     → pending   (only via explicit retry)
 *   cancelled  → (terminal — no transitions)
 */

import type { CompositionSession, CompositionState, DesignCompositionSpec } from "./types.js";

// ── Allowed transitions ────────────────────────────────────────────────────────

export const ALLOWED_TRANSITIONS: Readonly<Record<CompositionState, CompositionState[]>> = {
  pending:    ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  completed:  [],           // terminal
  failed:     ["pending"],  // only via explicit retry — not automatic
  cancelled:  [],           // terminal
};

export const TERMINAL_STATES: ReadonlySet<CompositionState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// ── Terminal state error discriminated union ───────────────────────────────────

export type TerminalStateError =
  | {
      code: "ALREADY_COMPLETED";
      state: "completed";
      /** Existing result — caller should return this directly */
      existingResult: DesignCompositionSpec;
    }
  | {
      code: "CANCELLED";
      state: "cancelled";
      message: string;
    }
  | {
      code: "FAILED_NO_RETRY";
      state: "failed";
      failureReason: string | undefined;
      message: string;
    }
  | {
      code: "IN_PROGRESS";
      state: "processing";
      message: string;
    };

// ── Guard function ─────────────────────────────────────────────────────────────

/**
 * Evaluate whether a composition session can be re-entered.
 *
 * Returns null if execution should proceed.
 * Returns a TerminalStateError if execution must be blocked.
 *
 * @param session     The existing session to evaluate.
 * @param retryAllowed  Whether the caller explicitly opted into retry (allowRetry=true).
 */
export function guardCompositionState(
  session: CompositionSession,
  retryAllowed: boolean,
): TerminalStateError | null {
  switch (session.state) {
    case "completed":
      // Terminal — always return existing result, never reprocess
      return {
        code: "ALREADY_COMPLETED",
        state: "completed",
        existingResult: session.result!,
      };

    case "cancelled":
      // Terminal — caller must create a new request
      return {
        code: "CANCELLED",
        state: "cancelled",
        message:
          "This composition was cancelled and cannot be processed. " +
          "Create a new request with a different idempotencyKey.",
      };

    case "failed":
      if (retryAllowed) {
        // Explicit retry is the only valid path out of failed state.
        // The session store will transition failed → pending before re-execution.
        return null;
      }
      return {
        code: "FAILED_NO_RETRY",
        state: "failed",
        failureReason: session.failureReason,
        message:
          "Composition previously failed. Set allowRetry=true in your request " +
          "to retry via the official retry path.",
      };

    case "processing":
      // Concurrent execution guard — only one execution per idempotencyKey
      return {
        code: "IN_PROGRESS",
        state: "processing",
        message: "Composition is currently processing. Poll /ai/composer/sessions/:key for result.",
      };

    case "pending":
      // Normal — proceed
      return null;

    default:
      return null;
  }
}

// ── Transition validator ───────────────────────────────────────────────────────

/**
 * Returns true if the transition from → to is allowed by the state machine.
 */
export function validateTransition(from: CompositionState, to: CompositionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
