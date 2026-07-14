/**
 * Phase 4A — Brief Assistant: Session Hook
 *
 * useAssistantSession() ties together:
 *   - conversationReducer (pure state machine)
 *   - conversationStorage  (sessionStorage persist/restore)
 *   - questionPlanner      (deterministic question queue)
 *   - answerMapper         (preview + apply)
 *   - onBriefChange        (parent callback — the ONLY way the brief mutates)
 *
 * Autosave integration: only `applyAnswer()` calls onBriefChange.
 * Opening the panel, selecting mode, and skipping never touch the brief.
 */

import { useReducer, useEffect, useCallback, useRef, useMemo } from "react";
import type { BriefData } from "@/pages/brief";
import type { BriefSectionConfig, ServiceType } from "@/config/brief-service-config";

import type { AssistantMode, AssistantEventHandler, AssistantDraftChange } from "./types";
import { defaultEventHandler } from "./types";
import { assistantReducer } from "./conversation-reducer";
import {
  loadConversationState, saveConversationState, clearConversationState,
  INITIAL_CONVERSATION_STATE,
} from "./conversation-storage";
import {
  planBriefQuestions, getNextBriefQuestion, type PlanInput,
} from "./question-planner";
import {
  previewAssistantAnswer, applyAssistantDraftChange,
  type AssistantAnswerInput,
} from "./answer-mapper";

export interface AssistantSessionOptions {
  requestId: string;
  brief: BriefData;
  serviceType: ServiceType;
  serviceConfig: BriefSectionConfig;
  /** Called ONLY when Terapkan is clicked — triggers autosave via existing flow. */
  onBriefChange: (newBrief: BriefData) => void;
  onEvent?: AssistantEventHandler;
}

export interface AssistantSessionReturn {
  // ── State ──────────────────────────────────────────────────────────────────
  state: ReturnType<typeof assistantReducer>;

  // ── Computed from state + planner ──────────────────────────────────────────
  currentQuestion: ReturnType<typeof getNextBriefQuestion>;
  plannedQuestions: ReturnType<typeof planBriefQuestions>;
  totalQuestions: number;
  currentQuestionIndex: number;

  // ── Actions ────────────────────────────────────────────────────────────────
  selectMode: (mode: AssistantMode) => void;
  /** Build and store a draft change — does NOT mutate the brief. */
  draftAnswer: (input: Omit<AssistantAnswerInput, "brief">) => void;
  /** Write the confirmed draft to the brief via onBriefChange. */
  applyAnswer: (mergeMode: "merge" | "replace") => void;
  editDraft: () => void;
  skipQuestion: () => void;
  goToReview: () => void;
  complete: () => void;
  reset: () => void;
}

export function useAssistantSession({
  requestId,
  brief,
  serviceType,
  serviceConfig,
  onBriefChange,
  onEvent = defaultEventHandler,
}: AssistantSessionOptions): AssistantSessionReturn {
  // ── Reducer ────────────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(
    assistantReducer,
    INITIAL_CONVERSATION_STATE,
  );

  // ── Restore from sessionStorage on mount ──────────────────────────────────
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = loadConversationState(requestId);
    if (saved) dispatch({ type: "RESTORE", state: saved });
  }, [requestId]);

  // ── Persist state to sessionStorage (debounced) ───────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveConversationState(requestId, state);
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [requestId, state]);

  // ── Plan input (memoised — recomputed when brief or state changes) ─────────
  const planInput = useMemo<PlanInput>(
    () => ({
      brief,
      serviceType,
      serviceConfig,
      mode: state.mode ?? "complete-missing",
      answeredQuestionIds: state.answeredQuestionIds,
      skippedQuestionIds: state.skippedQuestionIds,
    }),
    [brief, serviceType, serviceConfig, state.mode, state.answeredQuestionIds, state.skippedQuestionIds],
  );

  const plannedQuestions = useMemo(() => planBriefQuestions(planInput), [planInput]);
  const currentQuestion = useMemo(() => getNextBriefQuestion(planInput), [planInput]);

  // ── Advance to next question automatically when in "question" stage ────────
  const lastAutoQuestionId = useRef<string | null>(null);
  useEffect(() => {
    if (
      state.stage === "question" &&
      state.pendingChange === null &&
      state.mode !== "show-recommendations"
    ) {
      const nextQ = currentQuestion;
      const nextId = nextQ?.id ?? null;

      if (nextId && nextId !== state.currentQuestionId && nextId !== lastAutoQuestionId.current) {
        lastAutoQuestionId.current = nextId;
        dispatch({ type: "SHOW_QUESTION", questionId: nextId });
      } else if (!nextId && state.currentQuestionId !== null) {
        // No more questions — auto-advance to review
        dispatch({ type: "GO_TO_REVIEW" });
      }
    }
  }, [state.stage, state.pendingChange, state.mode, state.currentQuestionId, currentQuestion]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const selectMode = useCallback(
    (mode: AssistantMode) => {
      dispatch({ type: "SELECT_MODE", mode });
      onEvent("assistant_started", { mode });
      if (mode === "show-recommendations") {
        onEvent("recommendations_viewed");
      }
    },
    [onEvent],
  );

  const draftAnswer = useCallback(
    (input: Omit<AssistantAnswerInput, "brief">) => {
      const change = previewAssistantAnswer({ ...input, brief });
      dispatch({ type: "ANSWER_DRAFTED", change });
      onEvent("question_answered", { field: input.field });
    },
    [brief, onEvent],
  );

  const applyAnswer = useCallback(
    (mergeMode: "merge" | "replace") => {
      const change = state.pendingChange;
      if (!change) return;

      const result = applyAssistantDraftChange(brief, change, mergeMode);
      if (result.applied) {
        // THIS is the only place the brief mutates — triggers autosave naturally
        onBriefChange(result.updatedBrief);
        onEvent("answer_applied", { field: change.field, mergeMode });
      }
      dispatch({ type: "APPLY_DRAFT" });
    },
    [brief, onBriefChange, onEvent, state.pendingChange],
  );

  const editDraft = useCallback(() => {
    dispatch({ type: "EDIT_DRAFT" });
  }, []);

  const skipQuestion = useCallback(() => {
    const id = state.currentQuestionId;
    if (!id) return;
    dispatch({ type: "SKIP_QUESTION", questionId: id });
    onEvent("answer_skipped", { questionId: id });
  }, [state.currentQuestionId, onEvent]);

  const goToReview = useCallback(() => {
    dispatch({ type: "GO_TO_REVIEW" });
  }, []);

  const complete = useCallback(() => {
    dispatch({ type: "COMPLETE" });
    clearConversationState(requestId);
    onEvent("assistant_completed");
  }, [requestId, onEvent]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    clearConversationState(requestId);
  }, [requestId]);

  // ── Computed progress ──────────────────────────────────────────────────────
  const totalQuestions = plannedQuestions.length + state.answeredQuestionIds.length + state.skippedQuestionIds.length;
  const currentQuestionIndex = state.answeredQuestionIds.length + state.skippedQuestionIds.length + 1;

  return {
    state,
    currentQuestion,
    plannedQuestions,
    totalQuestions,
    currentQuestionIndex,
    selectMode,
    draftAnswer,
    applyAnswer,
    editDraft,
    skipQuestion,
    goToReview,
    complete,
    reset,
  };
}
