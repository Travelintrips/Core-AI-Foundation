/**
 * Team 04 — Adaptive Question Engine: Answer Validator
 *
 * Pure validation functions — no network, no React, no mutations.
 * Called before draftAnswer() to detect invalid input early.
 *
 * Returns structured ValidationResult with:
 * - errors (actionable, shown to the user)
 * - confidence score (used by the engine to decide if AI clarification is needed)
 */

import type { BriefData } from "@/pages/brief";
import type { PlannedBriefQuestion } from "./types";
import { FIELD_META } from "./constants";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

export interface AnswerConfidence {
  /** Qualitative level. */
  level: ConfidenceLevel;
  /** Numeric 0–1. */
  score: number;
  /** Human-readable reason for low/medium confidence (shown in audit log, not UI). */
  reason?: string;
}

export interface ValidationError {
  code: ValidationErrorCode;
  /** User-facing message in Bahasa Indonesia. */
  message: string;
  field: keyof BriefData;
}

export type ValidationErrorCode =
  | "REQUIRED_EMPTY"
  | "TOO_SHORT"
  | "VAGUE_PLACEHOLDER"
  | "NO_SELECTION"
  | "EXCEEDS_MAX_SELECTIONS";

export interface ValidationResult {
  /** True when there are no blocking errors. Warnings still allow submission. */
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  confidence: AnswerConfidence;
  /**
   * Normalized/cleaned text for text answers.
   * undefined = no normalization applied (use raw value).
   */
  normalizedValue?: string;
}

export interface ValidateAnswerInput {
  question: PlannedBriefQuestion;
  /** Raw text typed by user (for text questions). */
  rawText?: string;
  /** Selected option keys (for single/multi questions). */
  selectedKeys?: string[];
  /** Custom "other" text, if any. */
  customText?: string;
}

// ── Vague / placeholder patterns ───────────────────────────────────────────────

const VAGUE_PATTERNS: RegExp[] = [
  /^(tes+|test|testing|coba|dummy|placeholder|n\/a|tbd|tba|todo|xxx+|yyy+|zzz+|\.+|-+|_+)$/i,
  /^(tidak tahu|ga tau|ga ada|belum tahu|belum ada|gak ada|gapapa|ok|oke|yes|no|ya|tidak)$/i,
];

function isVaguePlaceholder(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return VAGUE_PATTERNS.some((r) => r.test(trimmed));
}

// ── Unit/dimension normalization ───────────────────────────────────────────────

/** Normalizes dimension strings: "5x7" → "5 × 7", "3m x 4m" → "3m × 4m". */
function normalizeDimensions(text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/g, "$1 × $2")
    .replace(/(\d+)\s*(cm|m|mm|inch|in)\s*[xX×]\s*(\d+)\s*(cm|m|mm|inch|in)/gi, "$1$2 × $3$4")
    .trim();
}

/** Normalizes currency ranges: "1jt-5jt" → "1 juta – 5 juta". */
function normalizeCurrencyRange(text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)/gi,
      (_, a, unitA, b, unitB) => `${a} ${unitA.toLowerCase()} – ${b} ${unitB.toLowerCase()}`)
    .trim();
}

const DIMENSION_KEYWORDS = /\b(cm|mm|meter|m\b|inch|lebar|panjang|tinggi|dimensi|ukuran|ruang)/i;
const CURRENCY_KEYWORDS = /\b(jt|juta|rb|ribu|rupiah|rp|budget|anggaran|harga)/i;

function normalizeTextAnswer(text: string): string {
  let normalized = text.trim();
  if (DIMENSION_KEYWORDS.test(normalized)) normalized = normalizeDimensions(normalized);
  if (CURRENCY_KEYWORDS.test(normalized)) normalized = normalizeCurrencyRange(normalized);
  return normalized;
}

// ── Confidence scoring ─────────────────────────────────────────────────────────

function scoreTextConfidence(text: string, question: PlannedBriefQuestion): AnswerConfidence {
  const trimmed = text.trim();

  if (!trimmed) {
    return { level: "low", score: 0, reason: "Empty text answer" };
  }

  if (isVaguePlaceholder(trimmed)) {
    return { level: "low", score: 0.1, reason: "Vague/placeholder text detected" };
  }

  if (trimmed.length < 5) {
    return { level: "low", score: 0.2, reason: "Answer too short to be meaningful" };
  }

  if (trimmed.length < 15) {
    return { level: "medium", score: 0.5, reason: "Short answer — may need more detail" };
  }

  // Bonus for domain-specific keywords (dimensions for interior/fashion, etc.)
  const hasDomainDetail =
    DIMENSION_KEYWORDS.test(trimmed) ||
    CURRENCY_KEYWORDS.test(trimmed) ||
    trimmed.length >= 30;

  return hasDomainDetail
    ? { level: "high", score: 0.95 }
    : { level: "high", score: 0.8 };
}

function scoreSelectionConfidence(
  selectedKeys: string[],
  question: PlannedBriefQuestion,
): AnswerConfidence {
  if (selectedKeys.length === 0) {
    return { level: "low", score: 0, reason: "No option selected" };
  }

  const max = question.maxSelections;
  if (max && selectedKeys.length > max) {
    return { level: "low", score: 0.3, reason: "Too many selections" };
  }

  // "other" alone without customText is lower confidence
  if (selectedKeys.length === 1 && selectedKeys[0] === "other") {
    return { level: "medium", score: 0.5, reason: "Only 'other' selected — custom text expected" };
  }

  return { level: "high", score: 1.0 };
}

// ── Main validator ─────────────────────────────────────────────────────────────

/**
 * Validates a user's answer to a brief question.
 * Returns errors (blocking) and confidence (informational).
 *
 * This is called BEFORE previewAssistantAnswer() so invalid answers
 * never silently reach the brief state.
 */
export function validateAnswer(input: ValidateAnswerInput): ValidationResult {
  const { question, rawText = "", selectedKeys = [], customText = "" } = input;
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  const meta = FIELD_META[question.field];
  const isTextQuestion = question.type === "text";
  const isSelectionQuestion = question.type === "single" || question.type === "multi";

  // ── Text field validation ────────────────────────────────────────────────────

  if (isTextQuestion) {
    const trimmed = rawText.trim();

    if (!trimmed && question.required) {
      errors.push({
        code: "REQUIRED_EMPTY",
        message: "Mohon isi jawaban untuk pertanyaan wajib ini.",
        field: question.field,
      });
      return {
        valid: false,
        errors,
        warnings,
        confidence: { level: "low", score: 0 },
      };
    }

    if (trimmed && trimmed.length < 3) {
      errors.push({
        code: "TOO_SHORT",
        message: "Jawaban terlalu singkat — mohon berikan informasi yang lebih lengkap.",
        field: question.field,
      });
    }

    if (trimmed && isVaguePlaceholder(trimmed)) {
      errors.push({
        code: "VAGUE_PLACEHOLDER",
        message: "Jawaban tidak dapat digunakan — mohon isi informasi yang sebenarnya.",
        field: question.field,
      });
    }

    const normalizedValue = trimmed ? normalizeTextAnswer(trimmed) : undefined;
    const confidence = scoreTextConfidence(trimmed, question);

    if (confidence.level === "low" && trimmed && !errors.length) {
      warnings.push("Jawaban mungkin terlalu singkat — pertimbangkan untuk menambahkan detail.");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      confidence,
      normalizedValue: normalizedValue !== trimmed ? normalizedValue : undefined,
    };
  }

  // ── Selection field validation ───────────────────────────────────────────────

  if (isSelectionQuestion) {
    const hasSelection = selectedKeys.length > 0;
    const hasCustom = customText.trim().length > 0;
    const effectiveSelection = hasSelection || hasCustom;

    if (!effectiveSelection && question.required) {
      errors.push({
        code: "NO_SELECTION",
        message: "Mohon pilih minimal satu opsi untuk pertanyaan wajib ini.",
        field: question.field,
      });
      return {
        valid: false,
        errors,
        warnings,
        confidence: { level: "low", score: 0 },
      };
    }

    const max = question.maxSelections;
    if (max && selectedKeys.length > max) {
      errors.push({
        code: "EXCEEDS_MAX_SELECTIONS",
        message: `Maksimal ${max} pilihan — mohon kurangi pilihan Anda.`,
        field: question.field,
      });
    }

    const confidence = scoreSelectionConfidence(selectedKeys, question);

    if (selectedKeys.length === 1 && selectedKeys[0] === "other" && !hasCustom) {
      warnings.push("Anda memilih 'Lainnya' — tambahkan keterangan di kolom bebas untuk hasil terbaik.");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      confidence,
    };
  }

  // ── Fallback (confirm type) ──────────────────────────────────────────────────
  return {
    valid: true,
    errors: [],
    warnings: [],
    confidence: { level: "high", score: 1.0 },
  };
}

/**
 * Returns true if a field can be skipped by the user, based on schema rules.
 * Required fields are not skippable unless the schema marks them as skippable.
 */
export function canSkipQuestion(
  question: PlannedBriefQuestion,
  schemaSkippable: boolean,
): boolean {
  // Required + not skippable in schema = cannot skip
  if (question.required && !schemaSkippable) return false;
  // alwaysOptional questions are always skippable
  const meta = FIELD_META[question.field];
  if (meta?.alwaysOptional) return true;
  // Defer to schema
  return schemaSkippable;
}
