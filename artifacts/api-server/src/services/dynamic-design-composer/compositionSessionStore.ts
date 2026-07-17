/**
 * Team 13 — Dynamic Design Composition Engine
 * Composition Session Store
 *
 * In-memory session store for idempotency + terminal-state tracking.
 * Sessions are scoped strictly by tenantId — cross-tenant lookups always
 * return null (404 at the route layer), never a result from another tenant.
 *
 * The lookup key is SHA-256(tenantId NUL idempotencyKey) to prevent
 * separator-injection attacks and avoid exposing raw key parts.
 *
 * Sessions are ephemeral — they do not survive a server restart. This is
 * intentional: the composition engine is pure computation; a restart simply
 * means the next identical request recomputes the same deterministic result.
 *
 * TTL: 24 hours (configurable via SESSION_TTL_MS).
 */

import { createHash } from "node:crypto";
import type { CompositionSession, CompositionState, DesignCompositionSpec } from "./types.js";
import { validateTransition } from "./compositionStateGuard.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Internal store ────────────────────────────────────────────────────────────

type StoredSession = CompositionSession & { expiresAt: number };

/** Module-level singleton store. Use clearStore() in tests to reset. */
const _store = new Map<string, StoredSession>();

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a store key from tenantId + idempotencyKey.
 * Uses NUL byte as separator (cannot appear in either string) then hashes.
 */
function deriveKey(tenantId: string, idempotencyKey: string): string {
  return createHash("sha256")
    .update(`${tenantId}\x00${idempotencyKey}`)
    .digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Expired session cleanup ───────────────────────────────────────────────────

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, session] of _store) {
    if (session.expiresAt < now) _store.delete(key);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up a session.
 *
 * IDOR GUARD: scoped strictly to tenantId.
 * A request for tenantId="A" will never return a session owned by tenantId="B",
 * even if both share the same idempotencyKey.
 *
 * Returns null when not found or tenantId does not match.
 */
export function getSession(tenantId: string, idempotencyKey: string): CompositionSession | null {
  purgeExpired();
  const session = _store.get(deriveKey(tenantId, idempotencyKey));
  if (!session) return null;
  // Belt-and-suspenders: double-check tenant ownership on retrieval
  if (session.tenantId !== tenantId) return null;
  return session;
}

/**
 * Create a new session in "pending" state.
 *
 * Throws if a non-expired session already exists for this tenantId+idempotencyKey.
 * Callers should call getSession first and apply guardCompositionState.
 */
export function createSession(tenantId: string, idempotencyKey: string): CompositionSession {
  purgeExpired();
  const key = deriveKey(tenantId, idempotencyKey);
  if (_store.has(key)) {
    throw new Error(
      `Session already exists for tenantId="${tenantId}" idempotencyKey="${idempotencyKey}". ` +
        "Call getSession and apply guardCompositionState before creating a new session.",
    );
  }
  const ts = nowIso();
  const session: StoredSession = {
    sessionId: key,
    tenantId,
    idempotencyKey,
    state: "pending",
    createdAt: ts,
    updatedAt: ts,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  _store.set(key, session);
  return session;
}

/**
 * Transition a session to a new state.
 *
 * Validates the transition against the state machine.
 * Throws on invalid transitions (e.g. completed → processing).
 *
 * For the "failed → pending" retry path, pass `to: "pending"` — the session
 * is reset so the next composition attempt can proceed.
 */
export function transitionSession(
  tenantId: string,
  idempotencyKey: string,
  to: CompositionState,
  payload?: { result?: DesignCompositionSpec; failureReason?: string },
): CompositionSession {
  const key = deriveKey(tenantId, idempotencyKey);
  const session = _store.get(key);
  if (!session) throw new Error(`Session not found: tenantId="${tenantId}"`);
  // IDOR guard — never allow a caller to mutate another tenant's session
  if (session.tenantId !== tenantId) {
    throw new Error("Tenant mismatch: cannot transition a session owned by another tenant.");
  }
  if (!validateTransition(session.state, to)) {
    throw new Error(
      `Invalid state transition: ${session.state} → ${to} is not allowed by the composition state machine.`,
    );
  }
  session.state = to;
  session.updatedAt = nowIso();
  session.expiresAt = Date.now() + SESSION_TTL_MS; // refresh TTL on transition
  if (payload?.result !== undefined) session.result = payload.result;
  if (payload?.failureReason !== undefined) session.failureReason = payload.failureReason;
  // Clean up payload fields on state reset
  if (to === "pending") {
    delete session.result;
    delete session.failureReason;
  }
  _store.set(key, session);
  return session;
}

/**
 * Delete a session (for explicit cancellation or test cleanup).
 * Returns true if the session existed, false otherwise.
 */
export function deleteSession(tenantId: string, idempotencyKey: string): boolean {
  const key = deriveKey(tenantId, idempotencyKey);
  const session = _store.get(key);
  if (!session || session.tenantId !== tenantId) return false;
  _store.delete(key);
  return true;
}

/**
 * Return the number of active (non-expired) sessions.
 * For monitoring and tests only.
 */
export function sessionCount(): number {
  purgeExpired();
  return _store.size;
}

/**
 * Clear all sessions. For use in tests only.
 */
export function clearStore(): void {
  _store.clear();
}
