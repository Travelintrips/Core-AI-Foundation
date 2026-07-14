/**
 * Phase 4A — Brief Assistant: Conversation Reducer
 *
 * Pure reducer — no side effects, no network, no React state mutations.
 * The panel dispatches actions here; the hook persists the resulting state.
 */

import type {
  AssistantAction,
  AssistantConversationState,
} from "./types";
import { INITIAL_CONVERSATION_STATE } from "./types";

export function assistantReducer(
  state: AssistantConversationState,
  action: AssistantAction,
): AssistantConversationState {
  switch (action.type) {
    case "OPEN":
      // Opening just ensures we're not stuck in idle if there's a persisted state
      if (state.stage === "idle" && state.mode === null) {
        return { ...state, stage: "idle" };
      }
      return state;

    case "CLOSE":
      // Closing does not reset — session is preserved for restore.
      return state;

    case "SELECT_MODE":
      return {
        ...state,
        mode: action.mode,
        stage: action.mode === "show-recommendations" ? "complete" : "intro",
        currentQuestionId: null,
        pendingChange: null,
      };

    case "SHOW_QUESTION":
      return {
        ...state,
        stage: "question",
        currentQuestionId: action.questionId,
        pendingChange: null,
      };

    case "ANSWER_DRAFTED":
      return {
        ...state,
        stage: "preview",
        pendingChange: action.change,
      };

    case "EDIT_DRAFT":
      // Return to question stage to allow re-answering
      return {
        ...state,
        stage: "question",
        pendingChange: null,
      };

    case "APPLY_DRAFT": {
      if (!state.currentQuestionId) return state;
      const answered = state.answeredQuestionIds.includes(state.currentQuestionId)
        ? state.answeredQuestionIds
        : [...state.answeredQuestionIds, state.currentQuestionId];
      return {
        ...state,
        stage: "question",        // planner will advance to next question
        answeredQuestionIds: answered,
        pendingChange: null,      // draft consumed — UI calls brief update separately
      };
    }

    case "SKIP_QUESTION": {
      const skipped = state.skippedQuestionIds.includes(action.questionId)
        ? state.skippedQuestionIds
        : [...state.skippedQuestionIds, action.questionId];
      return {
        ...state,
        stage: "question",
        currentQuestionId: null,  // planner will compute next
        skippedQuestionIds: skipped,
        pendingChange: null,
      };
    }

    case "GO_TO_REVIEW":
      return {
        ...state,
        stage: "review",
        currentQuestionId: null,
        pendingChange: null,
      };

    case "COMPLETE":
      return {
        ...state,
        stage: "complete",
        completed: true,
        pendingChange: null,
      };

    case "RESET":
      return INITIAL_CONVERSATION_STATE;

    case "RESTORE":
      // Restoring persisted session — pendingChange is NEVER auto-applied
      return {
        ...action.state,
        pendingChange: null, // safety: never restore a pending change
      };

    default:
      return state;
  }
}
