/**
 * Phase 4A — Brief Assistant: Session Storage
 *
 * Persists and restores conversation state using sessionStorage.
 * Key is scoped to the requestId so sessions never bleed across requests.
 *
 * NEVER stores: tokens, API keys, auth headers, email, phone, raw responses.
 * Pending changes are intentionally cleared on restore (spec §17).
 */

import type { AssistantConversationState } from "./types";
import { INITIAL_CONVERSATION_STATE } from "./types";

const KEY = (requestId: string) => `creative-brief-assistant:${requestId}`;

/** Shape stored in sessionStorage — a safe subset of the full state. */
interface PersistedState {
  mode: AssistantConversationState["mode"];
  stage: AssistantConversationState["stage"];
  currentQuestionId: string | null;
  answeredQuestionIds: string[];
  skippedQuestionIds: string[];
  completed: boolean;
  // pendingChange intentionally excluded
  // clarificationRequest intentionally excluded (transient)
  /** Team 04: persisted confidence map for adaptive re-ordering across restore. */
  confidenceMap?: Partial<Record<string, number>>;
}

function toPersistedState(state: AssistantConversationState): PersistedState {
  return {
    mode: state.mode,
    stage: state.stage,
    currentQuestionId: state.currentQuestionId,
    answeredQuestionIds: state.answeredQuestionIds,
    skippedQuestionIds: state.skippedQuestionIds,
    completed: state.completed,
    confidenceMap: state.confidenceMap,
  };
}

function fromPersistedState(raw: PersistedState): AssistantConversationState {
  return {
    ...raw,
    pendingChange: null,          // NEVER restore a pending change — spec §17
    clarificationRequest: null,   // Team 04: transient, never restored
    confidenceMap: raw.confidenceMap ?? {},
  };
}

export function saveConversationState(
  requestId: string,
  state: AssistantConversationState,
): void {
  try {
    const persisted = toPersistedState(state);
    sessionStorage.setItem(KEY(requestId), JSON.stringify(persisted));
  } catch {
    // sessionStorage may be unavailable (private browsing, quota) — silently skip
  }
}

export function loadConversationState(
  requestId: string,
): AssistantConversationState | null {
  try {
    const raw = sessionStorage.getItem(KEY(requestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Validate shape minimally
    if (!parsed || typeof parsed.stage !== "string") return null;
    return fromPersistedState(parsed);
  } catch {
    return null;
  }
}

export function clearConversationState(requestId: string): void {
  try {
    sessionStorage.removeItem(KEY(requestId));
  } catch {
    // ignore
  }
}

/** Default initial state when nothing is stored. */
export { INITIAL_CONVERSATION_STATE };
