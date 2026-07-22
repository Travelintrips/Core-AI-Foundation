/**
 * Phase 4A — AI Guided Brief Assistant: Domain Types
 *
 * All pure types — no React, no network, no side effects.
 * Used by planner, mapper, reducer, storage, and UI.
 */

import type { BriefData } from "@/pages/brief";

// ── Modes ──────────────────────────────────────────────────────────────────────

/** The assistant operating modes selectable from the start menu. */
export type AssistantMode =
  | "start-from-beginning"
  | "complete-missing"
  | "show-recommendations"
  /** Team 04: Re-answer a specific field without restarting the full session. */
  | "correction";

// ── Stages ─────────────────────────────────────────────────────────────────────

/** Current lifecycle stage of the conversation. */
export type AssistantStage =
  | "idle"           // Not started — shows start menu
  | "intro"          // Brief intro message shown before questions begin
  | "question"       // A question is active
  | "preview"        // User has answered; showing change preview
  | "clarification"  // Team 04: AI adapter has a follow-up clarification question
  | "review"         // End-of-session review of all fields
  | "complete";      // Session complete

// ── Question types ─────────────────────────────────────────────────────────────

export type AssistantQuestionType = "single" | "multi" | "text" | "confirm";

export interface AssistantOption {
  key: string;
  label: string;
  description?: string;
  /** Hex color for color-picker questions */
  hex?: string;
  /** Mutually exclusive with all other selections when chosen */
  exclusive?: boolean;
}

// ── Question plan ──────────────────────────────────────────────────────────────

/** A concrete question the assistant will ask about one BriefData field. */
export interface PlannedBriefQuestion {
  /** Unique stable ID — by convention equals the BriefData field name. */
  id: string;
  /** The BriefData field this question maps to. */
  field: keyof BriefData;
  type: AssistantQuestionType;
  /** Short title shown in the review summary. */
  title: string;
  /** Full question text shown to the user. */
  question: string;
  helperText?: string;
  /** Options for single/multi-select questions — from registry, never hardcoded. */
  options?: AssistantOption[];
  required: boolean;
  /** Selection cap for multi questions (from apply-adapter constants). */
  maxSelections?: number;
  /** Why this question matters — shown as context. */
  reason: string;
}

// ── Draft change ───────────────────────────────────────────────────────────────

/** A proposed change to a single BriefData field, not yet applied. */
export interface AssistantDraftChange {
  field: keyof BriefData;
  /** Raw current value in the brief (serialized string). */
  previousValue: string;
  /** Proposed new serialized value (not yet written). */
  nextValue: string;
  /** Human-readable labels for what's currently in the field. */
  displayBefore: string[];
  /** Human-readable labels for what will be in the field after apply. */
  displayAfter: string[];
  /** True if field already had content — triggers the conflict UI. */
  conflict: boolean;
  /** Non-fatal warnings (e.g. max-limit reached, some keys skipped). */
  warnings: string[];
  /** True if multiple values can be added without replacing (multi-select). */
  canMerge: boolean;
  /**
   * Team 04: Optional confidence score from the answer validator.
   * Undefined = no confidence evaluation performed (legacy path).
   */
  confidence?: AnswerConfidence;
}

// ── Apply result ───────────────────────────────────────────────────────────────

export interface ApplyAssistantAnswerResult {
  updatedBrief: BriefData;
  applied: boolean;
  skipped: boolean;
  reason?: string;
  warnings: string[];
}

// ── Conversation state ─────────────────────────────────────────────────────────

export interface AssistantConversationState {
  mode: AssistantMode | null;
  stage: AssistantStage;
  /** ID of the currently-active question (= field name). */
  currentQuestionId: string | null;
  /** IDs of questions the user has confirmed (answered + applied or applied from quick reply). */
  answeredQuestionIds: string[];
  /** IDs of questions the user explicitly skipped. */
  skippedQuestionIds: string[];
  /** Draft change waiting for confirmation — MUST NOT be auto-applied. */
  pendingChange: AssistantDraftChange | null;
  completed: boolean;
  /**
   * Team 04: Active clarification request from the AI adapter.
   * Transient — never persisted to sessionStorage.
   */
  clarificationRequest: ClarificationRequest | null;
  /**
   * Team 04: Confidence map for answered fields.
   * Key = field name, value = 0–1 score.
   * Used by the adaptive engine to prioritize low-confidence re-visits.
   */
  confidenceMap: Partial<Record<string, number>>;
}

export const INITIAL_CONVERSATION_STATE: AssistantConversationState = {
  mode: null,
  stage: "idle",
  currentQuestionId: null,
  answeredQuestionIds: [],
  skippedQuestionIds: [],
  pendingChange: null,
  completed: false,
  clarificationRequest: null,
  confidenceMap: {},
};

// ── Reducer actions ────────────────────────────────────────────────────────────

export type AssistantAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SELECT_MODE"; mode: AssistantMode }
  | { type: "SHOW_QUESTION"; questionId: string }
  | { type: "ANSWER_DRAFTED"; change: AssistantDraftChange }
  | { type: "EDIT_DRAFT" }
  | { type: "APPLY_DRAFT" }
  | { type: "SKIP_QUESTION"; questionId: string }
  | { type: "GO_TO_REVIEW" }
  | { type: "COMPLETE" }
  | { type: "RESET" }
  | { type: "RESTORE"; state: AssistantConversationState }
  /** Team 04: Enter correction mode to re-answer a specific field. */
  | { type: "ENTER_CORRECTION_MODE"; targetField: string }
  /** Team 04: AI adapter has generated a clarification request for the current answer. */
  | { type: "CLARIFICATION_REQUESTED"; request: ClarificationRequest }
  /** Team 04: User has answered the clarification prompt; return to preview stage. */
  | { type: "CLARIFICATION_ANSWERED"; answer: string };

// ── Team 04: Validation & confidence types ─────────────────────────────────────

/** Confidence level assigned by the answer validator or AI clarification adapter. */
export type ConfidenceLevel = "high" | "medium" | "low";

export interface AnswerConfidence {
  level: ConfidenceLevel;
  /** Numeric 0–1. */
  score: number;
  /** Reason for low/medium confidence (audit use, not shown in UI). */
  reason?: string;
}

// ── Team 04: Clarification request ────────────────────────────────────────────

/**
 * A follow-up clarification question generated by the optional AI adapter.
 * Stored transiently in session state; never persisted to sessionStorage.
 */
export interface ClarificationRequest {
  id: string;
  targetField: keyof BriefData;
  prompt: string;
  reason: string;
  suggestions?: string[];
}

// ── Analytics event hook (Phase 4C will connect this to backend) ───────────────

export type BriefAssistantEvent =
  | "assistant_opened"
  | "assistant_started"
  | "question_answered"
  | "answer_applied"
  | "answer_skipped"
  | "recommendations_viewed"
  | "assistant_completed"
  | "assistant_closed";

export type AssistantEventHandler = (
  event: BriefAssistantEvent,
  meta?: Record<string, unknown>,
) => void;

/** Default no-op event handler — Phase 4C will replace this. */
export const defaultEventHandler: AssistantEventHandler = () => {};
