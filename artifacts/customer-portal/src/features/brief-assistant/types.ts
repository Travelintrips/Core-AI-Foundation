/**
 * Phase 4A — AI Guided Brief Assistant: Domain Types
 *
 * All pure types — no React, no network, no side effects.
 * Used by planner, mapper, reducer, storage, and UI.
 */

import type { BriefData } from "@/pages/brief";

// ── Modes ──────────────────────────────────────────────────────────────────────

/** The three assistant operating modes selectable from the start menu. */
export type AssistantMode =
  | "start-from-beginning"
  | "complete-missing"
  | "show-recommendations";

// ── Stages ─────────────────────────────────────────────────────────────────────

/** Current lifecycle stage of the conversation. */
export type AssistantStage =
  | "idle"          // Not started — shows start menu
  | "intro"         // Brief intro message shown before questions begin
  | "question"      // A question is active
  | "preview"       // User has answered; showing change preview
  | "review"        // End-of-session review of all fields
  | "complete";     // Session complete

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
}

export const INITIAL_CONVERSATION_STATE: AssistantConversationState = {
  mode: null,
  stage: "idle",
  currentQuestionId: null,
  answeredQuestionIds: [],
  skippedQuestionIds: [],
  pendingChange: null,
  completed: false,
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
  | { type: "RESTORE"; state: AssistantConversationState };

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
