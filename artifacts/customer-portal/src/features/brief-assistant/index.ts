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
} from "./types";

export { planBriefQuestions, getNextBriefQuestion, isFieldFilled } from "./question-planner";
export { previewAssistantAnswer, applyAssistantDraftChange } from "./answer-mapper";
export { assistantReducer } from "./conversation-reducer";
export {
  saveConversationState, loadConversationState, clearConversationState,
} from "./conversation-storage";
