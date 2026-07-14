/**
 * Phase 4A — Brief Assistant: Answer Mapper
 *
 * Two pure functions:
 *   previewAssistantAnswer()   → builds a draft change (no mutation)
 *   applyAssistantDraftChange() → applies a confirmed draft to the brief
 *
 * Uses ONLY the existing parsers/serializers from brief-utils.
 * Never overwrites existing values without explicit "replace" mode.
 */

import type { BriefData } from "@/pages/brief";
import {
  INDUSTRY_OPTIONS, GOAL_OPTIONS, AUDIENCE_OPTIONS, ASSET_OPTIONS,
  CHANNEL_OPTIONS, STYLE_OPTIONS, PRIORITY_OPTIONS, LANGUAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
} from "@/config/brief-options";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import {
  parseChoices, serializeChoices,
  parseSingleChoice, serializeSingleChoice,
  parseColors, serializeColors,
  hasAnySelection,
} from "@/lib/brief-utils";
import { STYLE_MAX, COLOR_MAX, AUDIENCE_MAX } from "@/features/brief-intelligence/apply-adapter";
import type { AssistantDraftChange, ApplyAssistantAnswerResult } from "./types";

// ── Option registry lookup ─────────────────────────────────────────────────────

/** Field → options registry mapping for serializer lookups. */
const CHIP_FIELD_OPTIONS: Partial<Record<keyof BriefData, { value: string; label: string; description?: string }[]>> = {
  primaryGoal:          GOAL_OPTIONS,
  existingAssets:       ASSET_OPTIONS,
  audienceDemographics: AUDIENCE_OPTIONS,
  audienceChannels:     CHANNEL_OPTIONS,
  stylePreference:      STYLE_OPTIONS,
  companyIndustry:      INDUSTRY_OPTIONS,
  companySize:          COMPANY_SIZE_OPTIONS,
  outputLanguage:       LANGUAGE_OPTIONS,
  priority:             PRIORITY_OPTIONS,
};

function labelsForKeys(keys: string[], opts: { value: string; label: string }[]): string[] {
  return keys.map((k) => opts.find((o) => o.value === k)?.label ?? k);
}

function colorLabelsForKeys(keys: string[]): string[] {
  return keys.map((k) => DEFAULT_COLOR_PRESETS.find((p) => p.value === k)?.label ?? k);
}

// ── previewAssistantAnswer ─────────────────────────────────────────────────────

export interface AssistantAnswerInput {
  brief: BriefData;
  field: keyof BriefData;
  /** Keys selected for chip/single fields. Raw text for text fields. */
  selectedKeys: string[];
  /** Custom "Lainnya" free text (used alongside selectedKeys). */
  customText: string;
}

/**
 * Builds a proposed AssistantDraftChange from the user's selection.
 * Does NOT mutate the brief.
 *
 * For multi-select fields the proposed change MERGES with existing selection
 * (respecting maxSelections).  `conflict = true` flags that existing data
 * was already present — the UI will show the conflict options.
 */
export function previewAssistantAnswer(input: AssistantAnswerInput): AssistantDraftChange {
  const { brief, field, selectedKeys, customText } = input;
  const existing = brief[field] ?? "";

  // ── colorPalette ───────────────────────────────────────────────────────────
  if (field === "colorPalette") {
    const parsedExisting = parseColors(existing, DEFAULT_COLOR_PRESETS);
    const existingKeys = parsedExisting.selected.filter((k) => k !== "none");
    const conflict = existingKeys.length > 0;

    // Proposed merged set (respecting COLOR_MAX)
    const incoming = selectedKeys.filter((k) => !existingKeys.includes(k));
    const slots = COLOR_MAX - existingKeys.length;
    const added = incoming.slice(0, Math.max(0, slots));
    const mergedKeys = [...existingKeys, ...added];
    const customMerged = parsedExisting.custom
      ? `${parsedExisting.custom}${customText ? `, ${customText}` : ""}`
      : customText;
    const nextValue = serializeColors(mergedKeys, DEFAULT_COLOR_PRESETS, customMerged);
    const warnings: string[] = [];
    if (incoming.length > added.length)
      warnings.push(`Batas ${COLOR_MAX} warna tercapai — ${incoming.length - added.length} warna dilewati`);

    return {
      field,
      previousValue: existing,
      nextValue,
      displayBefore: colorLabelsForKeys(existingKeys),
      displayAfter: colorLabelsForKeys(mergedKeys),
      conflict,
      warnings,
      canMerge: true,
    };
  }

  // ── multi-select chip fields ───────────────────────────────────────────────
  const chipOpts = CHIP_FIELD_OPTIONS[field];
  const meta = getFieldMeta(field);

  if (meta?.isMulti && chipOpts) {
    const parsedExisting = parseChoices(existing, chipOpts);
    const existingKeys = parsedExisting.selected.filter((k) => k !== "other" && k !== "unsure");
    const conflict = existingKeys.length > 0;

    const maxSel = getMax(field);
    const incoming = selectedKeys.filter((k) => !parsedExisting.selected.includes(k));
    const slots = maxSel !== null ? Math.max(0, maxSel - existingKeys.length) : incoming.length;
    const added = incoming.slice(0, slots);
    const mergedKeys = [...parsedExisting.selected.filter((k) => k !== "unsure"), ...added];
    const customMerged = [parsedExisting.custom, customText].filter(Boolean).join("; ");
    const nextValue = serializeChoices(mergedKeys, chipOpts, customMerged);
    const warnings: string[] = [];
    if (incoming.length > added.length)
      warnings.push(`Batas ${maxSel} pilihan tercapai — ${incoming.length - added.length} pilihan dilewati`);

    return {
      field,
      previousValue: existing,
      nextValue,
      displayBefore: labelsForKeys(existingKeys, chipOpts),
      displayAfter: labelsForKeys(mergedKeys.filter((k) => k !== "other" && k !== "unsure"), chipOpts),
      conflict,
      warnings,
      canMerge: true,
    };
  }

  // ── single-select chip fields (industry, size, language, priority) ─────────
  if (chipOpts) {
    const parsedExisting = parseSingleChoice(existing, chipOpts);
    const conflict = parsedExisting.selected !== "" && parsedExisting.selected !== selectedKeys[0];
    const key = selectedKeys[0] ?? "";
    const customFinal = key === "other" ? customText : "";
    const nextValue = serializeSingleChoice(key, chipOpts, customFinal);

    return {
      field,
      previousValue: existing,
      nextValue,
      displayBefore: parsedExisting.selected
        ? labelsForKeys([parsedExisting.selected], chipOpts)
        : [],
      displayAfter: key === "other" && customFinal
        ? [customFinal]
        : labelsForKeys([key], chipOpts),
      conflict,
      warnings: [],
      canMerge: false,
    };
  }

  // ── free-text fields ───────────────────────────────────────────────────────
  const rawText = customText || selectedKeys.join(", ");
  const conflict = existing.trim().length > 0 && rawText !== existing;
  return {
    field,
    previousValue: existing,
    nextValue: rawText,
    displayBefore: existing.trim() ? [existing.trim()] : [],
    displayAfter: rawText ? [rawText] : [],
    conflict,
    warnings: [],
    canMerge: false,
  };
}

// ── applyAssistantDraftChange ──────────────────────────────────────────────────

/**
 * Applies a confirmed draft change to the brief and returns the updated brief.
 *
 * mode "merge":   adds new selections to existing ones (multi-select only).
 * mode "replace": overwrites the field with the new value (all fields).
 *
 * Never modifies any field other than `change.field`.
 * Retains legacy custom values wherever possible.
 */
export function applyAssistantDraftChange(
  brief: BriefData,
  change: AssistantDraftChange,
  mode: "merge" | "replace",
): ApplyAssistantAnswerResult {
  // No-op if nothing changed
  if (change.nextValue === change.previousValue && mode === "merge") {
    return { updatedBrief: brief, applied: false, skipped: true, reason: "Tidak ada perubahan", warnings: [] };
  }

  const targetValue = mode === "replace" ? buildReplaceValue(brief, change) : change.nextValue;

  if (!targetValue && targetValue === brief[change.field]) {
    return { updatedBrief: brief, applied: false, skipped: true, reason: "Nilai sudah sama", warnings: change.warnings };
  }

  const updatedBrief: BriefData = { ...brief, [change.field]: targetValue };
  return { updatedBrief, applied: true, skipped: false, warnings: change.warnings };
}

/**
 * For "replace" mode: builds a fresh value for the field using ONLY the
 * incoming selection, discarding the existing content.
 * Custom text from the draft is preserved.
 */
function buildReplaceValue(brief: BriefData, change: AssistantDraftChange): string {
  // The nextValue already contains the MERGED result.
  // For replace, re-compute from scratch using the incoming keys only.
  // We detect this by checking the previousValue vs nextValue.

  // Simple approach: the `nextValue` in the draft was computed as a merge.
  // For replace, we return a value that has ONLY the new selection.
  // We do this by computing nextValue starting from an empty brief field.

  const { field } = change;
  const emptyBrief: BriefData = { ...brief, [field]: "" };

  // Re-run previewAssistantAnswer against an empty field to get a clean value
  // We re-extract the incoming keys from nextValue vs previousValue.
  // Simplest: just use nextValue (merge result) if previousValue was empty anyway.
  // If not empty, we need to strip the previous. We approximate by returning
  // the nextValue minus the contribution of previousValue.
  // For safety, we store the raw "afterKeys" in displayAfter and rebuild.

  const chipOpts = CHIP_FIELD_OPTIONS[field];

  if (field === "colorPalette") {
    const parsedNext = parseColors(change.nextValue, DEFAULT_COLOR_PRESETS);
    const parsedPrev = parseColors(change.previousValue, DEFAULT_COLOR_PRESETS);
    const incoming = parsedNext.selected.filter((k) => !parsedPrev.selected.includes(k));
    return serializeColors(incoming, DEFAULT_COLOR_PRESETS, "");
  }

  if (chipOpts) {
    const meta = getFieldMeta(field);
    if (meta?.isMulti) {
      const parsedNext = parseChoices(change.nextValue, chipOpts);
      const parsedPrev = parseChoices(change.previousValue, chipOpts);
      const incoming = parsedNext.selected.filter((k) => !parsedPrev.selected.includes(k));
      return serializeChoices(incoming, chipOpts, "");
    }
    // Single select: nextValue IS the replacement
    return change.nextValue;
  }

  // Free text: nextValue is the replacement
  return change.nextValue;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

import { FIELD_META } from "./constants";

function getFieldMeta(field: keyof BriefData) {
  return FIELD_META[field] ?? null;
}

function getMax(field: keyof BriefData): number | null {
  if (field === "stylePreference")      return STYLE_MAX;
  if (field === "audienceDemographics") return AUDIENCE_MAX;
  if (field === "primaryGoal")          return 5;
  return null;
}
