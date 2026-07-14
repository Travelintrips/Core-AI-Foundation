/**
 * Phase 4A — Brief Assistant: Question Planner
 *
 * Pure functions — deterministic, no network, no React state, no mutations.
 *
 * planBriefQuestions()     → full ordered list for the current session
 * getNextBriefQuestion()   → next unanswered question (or null if done)
 */

import type { BriefData } from "@/pages/brief";
import type { BriefSectionConfig, ServiceType } from "@/config/brief-service-config";
import {
  INDUSTRY_OPTIONS, COMPANY_SIZE_OPTIONS, GOAL_OPTIONS, ASSET_OPTIONS,
  AUDIENCE_OPTIONS, CHANNEL_OPTIONS, STYLE_OPTIONS, PRIORITY_OPTIONS,
  LANGUAGE_OPTIONS,
} from "@/config/brief-options";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import { parseChoices, parseSingleChoice, parseColors, hasAnySelection } from "@/lib/brief-utils";
import { STYLE_MAX, COLOR_MAX, AUDIENCE_MAX } from "@/features/brief-intelligence/apply-adapter";

import type { AssistantMode, AssistantOption, PlannedBriefQuestion } from "./types";
import { FIELD_META, SERVICE_QUESTION_ORDER, CONDITIONALLY_VISIBLE } from "./constants";

// ── Field-filled detection ─────────────────────────────────────────────────────

/** Returns true if the user has meaningfully filled in a field. */
function isFieldFilled(brief: BriefData, field: keyof BriefData): boolean {
  const val = brief[field];
  if (!val || !val.trim()) return false;

  switch (field) {
    case "companyIndustry": {
      // "Lainnya" alone (without custom text) is not a complete answer
      const parsed = parseSingleChoice(val, INDUSTRY_OPTIONS);
      return parsed.selected !== "" && !(parsed.selected === "other" && !parsed.custom);
    }
    case "primaryGoal":
    case "audienceDemographics":
    case "stylePreference":
    case "existingAssets":
    case "audienceChannels":
      return hasAnySelection(val);
    case "colorPalette": {
      const { selected } = parseColors(val, DEFAULT_COLOR_PRESETS);
      return selected.length > 0 && !selected.every((s) => s === "none");
    }
    default:
      return val.trim().length > 0;
  }
}

// ── Option adapters (display-only trim; stable keys preserved) ─────────────────

function toAssistantOptions(
  opts: { value: string; label: string; description?: string }[],
): AssistantOption[] {
  return opts.map((o) => ({ key: o.value, label: o.label, description: o.description }));
}

function toColorOptions(): AssistantOption[] {
  return DEFAULT_COLOR_PRESETS
    .filter((p) => p.value !== "other")
    .map((p) => ({ key: p.value, label: p.label, hex: (p as { value: string; label: string; hex?: string }).hex }));
}

// ── Question builders ──────────────────────────────────────────────────────────

type QuestionBuilder = (serviceConfig: BriefSectionConfig) => Omit<PlannedBriefQuestion, "id" | "field">;

const QUESTION_BUILDERS: Partial<Record<keyof BriefData, QuestionBuilder>> = {
  companyIndustry: (sc) => ({
    type: "single",
    title: "Industri",
    question: sc.step1.industryLabel,
    helperText: sc.step1.industryHint,
    options: toAssistantOptions(INDUSTRY_OPTIONS),
    required: true,
    reason: "Membantu sistem memilih gaya dan strategi visual yang tepat",
  }),

  companySize: (sc) => ({
    type: "single",
    title: "Ukuran perusahaan",
    question: "Berapa besar tim atau perusahaan Anda?",
    helperText: sc.step1.showSize ? undefined : undefined,
    options: toAssistantOptions(COMPANY_SIZE_OPTIONS),
    required: false,
    reason: "Membantu menyesuaikan skala dan kompleksitas output",
  }),

  primaryGoal: (sc) => ({
    type: "multi",
    title: "Tujuan project",
    question: sc.step2.goalLabel,
    helperText: sc.step2.goalDescription,
    options: toAssistantOptions(GOAL_OPTIONS),
    required: true,
    maxSelections: 5,
    reason: "Menentukan fokus dan strategi kreatif project",
  }),

  existingAssets: (sc) => ({
    type: "multi",
    title: "Aset yang dimiliki",
    question: sc.step2.existingAssetsLabel,
    helperText: "Pilih semua aset yang sudah Anda miliki",
    options: toAssistantOptions(ASSET_OPTIONS),
    required: false,
    reason: "Menghindari duplikasi dan memanfaatkan aset yang ada",
  }),

  audienceDemographics: (sc) => ({
    type: "multi",
    title: "Target audiens",
    question: sc.step3.audienceLabel,
    helperText: sc.step3.audienceDescription,
    options: toAssistantOptions(AUDIENCE_OPTIONS),
    required: true,
    maxSelections: AUDIENCE_MAX,
    reason: "Menentukan tone, gaya, dan pesan yang paling efektif",
  }),

  audienceChannels: (sc) => ({
    type: "multi",
    title: "Channel audiens",
    question: sc.step3.channelsLabel,
    helperText: "Di mana audiens Anda paling aktif?",
    options: toAssistantOptions(CHANNEL_OPTIONS),
    required: false,
    reason: "Memastikan format output sesuai dengan platform yang digunakan",
  }),

  audiencePainPoints: () => ({
    type: "text",
    title: "Masalah audiens",
    question: "Masalah utama apa yang ingin Anda bantu selesaikan untuk audiens ini?",
    helperText: "Ceritakan singkat — 1–2 kalimat sudah cukup",
    required: false,
    reason: "Membantu merumuskan pesan yang relevan dan persuasif",
  }),

  stylePreference: (sc) => ({
    type: "multi",
    title: "Gaya visual",
    question: sc.step4.styleLabel,
    helperText: `Pilih maksimal ${STYLE_MAX} gaya yang paling menggambarkan brand Anda`,
    options: toAssistantOptions(STYLE_OPTIONS.filter((o) => o.value !== "unsure")),
    required: true,
    maxSelections: STYLE_MAX,
    reason: "Menentukan arah visual seluruh project",
  }),

  colorPalette: () => ({
    type: "multi",
    title: "Warna brand",
    question: "Warna apa yang paling mewakili brand Anda?",
    helperText: `Pilih maksimal ${COLOR_MAX} warna`,
    options: toColorOptions(),
    required: false,
    maxSelections: COLOR_MAX,
    reason: "Memastikan palet warna konsisten dengan identitas brand",
  }),

  specialRequirements: (sc) => ({
    type: "text",
    title: "Catatan khusus",
    question: sc.step4.specialReqLabel,
    helperText: sc.step4.specialReqHint,
    required: false,
    reason: "Mencatat pantangan, preferensi, atau spesifikasi teknis khusus",
  }),

  outputFormats: (sc) => ({
    type: "text",
    title: "Format output",
    question: sc.step5.outputLabel,
    helperText: sc.step5.outputHint,
    required: true,
    reason: "Memastikan tim memahami scope pekerjaan secara jelas",
  }),

  outputLanguage: () => ({
    type: "single",
    title: "Bahasa output",
    question: "Dalam bahasa apa hasil akhirnya dibuat?",
    options: toAssistantOptions(LANGUAGE_OPTIONS),
    required: false,
    reason: "Menghindari revisi akibat perbedaan bahasa yang diharapkan",
  }),

  priority: () => ({
    type: "single",
    title: "Prioritas pengerjaan",
    question: "Apa yang paling Anda prioritaskan untuk project ini?",
    options: toAssistantOptions(PRIORITY_OPTIONS),
    required: false,
    reason: "Membantu tim menyesuaikan jadwal dan pendekatan pengerjaan",
  }),
};

// ── Visibility check ───────────────────────────────────────────────────────────

/** Returns true if the field should be shown for this service config. */
function isFieldVisible(field: keyof BriefData, serviceConfig: BriefSectionConfig): boolean {
  const checker = CONDITIONALLY_VISIBLE[field];
  if (!checker) return true; // not conditional = always visible

  // Build a flat flags object from the multi-step config
  const flags = {
    showSize:           serviceConfig.step1.showSize,
    showSuccessMetrics: serviceConfig.step2.showSuccessMetrics,
    showExistingAssets: serviceConfig.step2.showExistingAssets,
    showPainPoints:     serviceConfig.step3.showPainPoints,
    showChannels:       serviceConfig.step3.showChannels,
    showColor:          serviceConfig.step4.showColor,
    showReferences:     serviceConfig.step4.showReferences,
    showSpecialReq:     serviceConfig.step4.showSpecialReq,
    showLanguage:       serviceConfig.step5.showLanguage,
    showPriority:       serviceConfig.step6.showPriority,
    showMilestones:     serviceConfig.step6.showMilestones,
  };
  return checker(flags);
}

// ── Main planner ───────────────────────────────────────────────────────────────

export interface PlanInput {
  brief: BriefData;
  serviceType: ServiceType;
  serviceConfig: BriefSectionConfig;
  mode: AssistantMode;
  answeredQuestionIds: string[];
  skippedQuestionIds: string[];
}

/**
 * Returns the full prioritized list of questions for the current session.
 * Deterministic: same inputs → same outputs.
 */
export function planBriefQuestions(input: PlanInput): PlannedBriefQuestion[] {
  const { brief, serviceType, serviceConfig, mode, answeredQuestionIds, skippedQuestionIds } = input;

  const orderedFields = SERVICE_QUESTION_ORDER[serviceType] ?? SERVICE_QUESTION_ORDER.default;
  const questions: PlannedBriefQuestion[] = [];

  for (const field of orderedFields) {
    // Skip fields we have no question builder for
    const builder = QUESTION_BUILDERS[field];
    if (!builder) continue;

    // Skip conditionally-hidden fields (service config)
    if (!isFieldVisible(field, serviceConfig)) continue;

    // Skip already-answered or skipped questions
    if (answeredQuestionIds.includes(field) || skippedQuestionIds.includes(field)) continue;

    // In complete-missing mode, skip fields the user has already filled
    if (mode === "complete-missing" && isFieldFilled(brief, field)) continue;

    const def = builder(serviceConfig);
    const meta = FIELD_META[field];

    questions.push({
      id: field,
      field,
      ...def,
      required: def.required && !(meta?.alwaysOptional ?? false),
    });
  }

  return questions;
}

/**
 * Returns the next question to ask, or null if the session is complete.
 */
export function getNextBriefQuestion(input: PlanInput): PlannedBriefQuestion | null {
  const questions = planBriefQuestions(input);
  return questions[0] ?? null;
}

/**
 * Returns whether a given field has meaningful content in the brief.
 * Exposed for use in AssistantReview and session hooks.
 */
export { isFieldFilled };
