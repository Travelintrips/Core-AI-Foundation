/**
 * Phase 4A — Brief Assistant: Public Barrel
 *
 * Consumers (brief.tsx) should only import from this file.
 */

export { useAssistantSession } from "./assistant-session";
export type { AssistantSessionOptions, AssistantSessionReturn } from "./assistant-session";

export { BriefAssistantLauncher } from "./components/BriefAssistantLauncher";
export { BriefAssistantPanel } from "./components/BriefAssistantPanel";

export type {
  AssistantMode, AssistantStage, AssistantQuestionType,
  AssistantOption, PlannedBriefQuestion, AssistantDraftChange,
  AssistantConversationState, AssistantAction,
  BriefAssistantEvent, AssistantEventHandler,
  ApplyAssistantAnswerResult,
  // Team 04 additions
  AnswerConfidence, ConfidenceLevel, ClarificationRequest,
} from "./types";

export { planBriefQuestions, getNextBriefQuestion, isFieldFilled } from "./question-planner";
export { previewAssistantAnswer, applyAssistantDraftChange } from "./answer-mapper";
export { assistantReducer } from "./conversation-reducer";
export {
  saveConversationState, loadConversationState, clearConversationState,
} from "./conversation-storage";

// ── Team 04: Adaptive Question Engine ─────────────────────────────────────────

export {
  planAdaptiveQuestions,
  getAdaptiveNextQuestion,
  getAdaptivePlanResult,
  checkCompletionPolicy,
  isQuestionSkippable,
  detectContradictions,
} from "./adaptive-question-engine";
export type { AdaptivePlanInput, AdaptivePlanResult, ContradictionPair } from "./adaptive-question-engine";

export {
  getBuiltinSchema,
  mergeSchema,
} from "./adaptive-schema";
export type {
  DynamicBriefSchema, BriefFieldSchema, CompletionPolicy, PriorityRule,
} from "./adaptive-schema";

export {
  validateAnswer,
  canSkipQuestion,
} from "./answer-validator";
export type { ValidationResult, ValidationError, AnswerConfidence as ValidatorConfidence } from "./answer-validator";

export type {
  AiClarificationAdapter,
  ClarificationInput,
  ClarificationResult,
  ClarificationQuestion,
} from "./ai-clarification-adapter";
export {
  NULL_CLARIFICATION_ADAPTER,
  buildClarificationContext,
} from "./ai-clarification-adapter";
