/**
 * Applies engine recommendations back into BriefData.
 *
 * Field-mapping rule (deliberate, documented simplification — see
 * ADVISORY_ONLY_CATEGORIES in types.ts): the real BriefData schema has no
 * dedicated field for personality / tone-of-voice / photography-direction /
 * visual-direction / content-direction. Those "advisory" categories are
 * appliable ONLY as an appended bullet in `specialRequirements`, and ONLY
 * when that field is still empty — applying them would otherwise silently
 * overwrite the user's own free text, which is forbidden. `style`, `color`,
 * and `audience` map directly onto existing chip fields and merge with
 * (never replace) the user's current selection, respecting each field's
 * existing max-selection limits. `deliverable` maps onto the free-text
 * `outputFormats` field and follows the same empty-only rule as the
 * advisory categories.
 */

import { STYLE_OPTIONS, AUDIENCE_OPTIONS } from "@/config/brief-options";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import {
  parseChoices, serializeChoices, parseColors, serializeColors,
} from "@/lib/brief-utils";
import type { BriefData } from "@/pages/brief";
import type { ApplyMode, ApplyRecommendationResult, ApplySkip, BriefRecommendation, RecommendationCategory } from "./types";

/**
 * Selection limits — must match the UI chip group `max` props in brief.tsx.
 * Single source of truth: import these in brief.tsx rather than hardcoding
 * separate values, so the adapter and the UI can never drift apart.
 */
export const STYLE_MAX = 3;
export const COLOR_MAX = 3;
export const AUDIENCE_MAX = 4;

const FREE_TEXT_CATEGORIES: RecommendationCategory[] = [
  "deliverable", "personality", "toneOfVoice", "photographyDirection", "visualDirection", "contentDirection",
];

const FREE_TEXT_CATEGORY_LABEL: Record<string, string> = {
  deliverable: "Format output disarankan",
  personality: "Kepribadian brand disarankan",
  toneOfVoice: "Tone of voice disarankan",
  photographyDirection: "Arahan fotografi disarankan",
  visualDirection: "Arahan visual disarankan",
  contentDirection: "Arahan konten disarankan",
};

function appendToFreeText(existing: string, category: RecommendationCategory, label: string): string {
  const heading = FREE_TEXT_CATEGORY_LABEL[category] ?? "Rekomendasi";
  const bullet = `- ${label}`;
  if (!existing.trim()) return `${heading}:\n${bullet}`;
  // If a heading for this category already exists, append under it; otherwise
  // add a new heading block. This keeps repeated "empty-only" applies stable.
  if (existing.includes(heading)) {
    return existing.includes(bullet) ? existing : `${existing}\n${bullet}`;
  }
  return `${existing}\n\n${heading}:\n${bullet}`;
}

function applyOne(
  brief: BriefData,
  rec: BriefRecommendation,
  applied: { category: RecommendationCategory; key: string }[],
  skipped: ApplySkip[],
): BriefData {
  if (rec.category === "style") {
    const parsed = parseChoices(brief.stylePreference, STYLE_OPTIONS);
    if (parsed.selected.includes(rec.key)) {
      skipped.push({ category: rec.category, key: rec.key, reason: "Sudah dipilih sebelumnya" });
      return brief;
    }
    if (parsed.selected.filter((k) => k !== "other" && k !== "unsure").length >= STYLE_MAX) {
      skipped.push({ category: rec.category, key: rec.key, reason: `Batas maksimum ${STYLE_MAX} gaya sudah tercapai` });
      return brief;
    }
    const nextSelected = [...parsed.selected.filter((k) => k !== "unsure"), rec.key];
    const serialized = serializeChoices(nextSelected, STYLE_OPTIONS, parsed.custom);
    applied.push({ category: rec.category, key: rec.key });
    return { ...brief, stylePreference: serialized };
  }

  if (rec.category === "color") {
    const parsed = parseColors(brief.colorPalette, DEFAULT_COLOR_PRESETS);
    if (parsed.selected.includes(rec.key)) {
      skipped.push({ category: rec.category, key: rec.key, reason: "Sudah dipilih sebelumnya" });
      return brief;
    }
    if (parsed.selected.filter((k) => k !== "other" && k !== "none").length >= COLOR_MAX) {
      skipped.push({ category: rec.category, key: rec.key, reason: `Batas maksimum ${COLOR_MAX} warna sudah tercapai` });
      return brief;
    }
    const nextSelected = [...parsed.selected.filter((k) => k !== "none"), rec.key];
    const serialized = serializeColors(nextSelected, DEFAULT_COLOR_PRESETS, parsed.custom);
    applied.push({ category: rec.category, key: rec.key });
    return { ...brief, colorPalette: serialized };
  }

  if (rec.category === "audience") {
    const parsed = parseChoices(brief.audienceDemographics, AUDIENCE_OPTIONS);
    if (parsed.selected.includes(rec.key)) {
      skipped.push({ category: rec.category, key: rec.key, reason: "Sudah dipilih sebelumnya" });
      return brief;
    }
    if (parsed.selected.filter((k) => k !== "other").length >= AUDIENCE_MAX) {
      skipped.push({ category: rec.category, key: rec.key, reason: `Batas maksimum ${AUDIENCE_MAX} target audiens sudah tercapai` });
      return brief;
    }
    const nextSelected = [...parsed.selected, rec.key];
    const serialized = serializeChoices(nextSelected, AUDIENCE_OPTIONS, parsed.custom);
    applied.push({ category: rec.category, key: rec.key });
    return { ...brief, audienceDemographics: serialized };
  }

  if (FREE_TEXT_CATEGORIES.includes(rec.category)) {
    const targetField: keyof BriefData = rec.category === "deliverable" ? "outputFormats" : "specialRequirements";
    const current = brief[targetField];
    if (current.trim() && rec.category !== "deliverable") {
      skipped.push({ category: rec.category, key: rec.key, reason: "Field sudah diisi — tidak menimpa jawaban Anda" });
      return brief;
    }
    if (rec.category === "deliverable" && current.trim()) {
      skipped.push({ category: rec.category, key: rec.key, reason: "Field Format Output sudah diisi — tidak menimpa jawaban Anda" });
      return brief;
    }
    const nextValue = appendToFreeText(current, rec.category, rec.label);
    applied.push({ category: rec.category, key: rec.key });
    return { ...brief, [targetField]: nextValue };
  }

  skipped.push({ category: rec.category, key: rec.key, reason: "Kategori tidak dapat diterapkan otomatis" });
  return brief;
}

export function applyRecommendations(
  brief: BriefData,
  recommendations: BriefRecommendation[],
  mode: ApplyMode,
  target: { category?: RecommendationCategory; key?: string },
): ApplyRecommendationResult<BriefData> {
  const applied: { category: RecommendationCategory; key: string }[] = [];
  const skipped: ApplySkip[] = [];
  const warnings: string[] = [];

  let toApply: BriefRecommendation[];
  if (mode === "apply-single") {
    toApply = recommendations.filter((r) => r.category === target.category && r.key === target.key);
  } else if (mode === "apply-category") {
    toApply = recommendations.filter((r) => r.category === target.category);
  } else {
    toApply = recommendations;
  }

  let nextBrief = brief;
  for (const rec of toApply) {
    nextBrief = applyOne(nextBrief, rec, applied, skipped);
  }

  if (mode === "apply-all-empty-only" && applied.length === 0 && toApply.length > 0) {
    warnings.push("Semua field terkait sudah terisi — tidak ada yang diterapkan.");
  }

  return { updatedBrief: nextBrief, applied, skipped, warnings };
}
