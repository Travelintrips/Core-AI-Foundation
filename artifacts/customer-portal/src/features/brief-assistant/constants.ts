/**
 * Phase 4A — Brief Assistant: Static Field Registry
 *
 * Defines which fields the assistant covers, their question priority by service,
 * and which fields are optional.  All option data is imported from existing
 * registries — nothing is hardcoded here.
 */

import type { BriefData } from "@/pages/brief";
import type { ServiceType } from "@/config/brief-service-config";
import type { AssistantQuestionType } from "./types";

// ── Field metadata ─────────────────────────────────────────────────────────────

export interface AssistantFieldMeta {
  /** Type of question rendered for this field. */
  questionType: AssistantQuestionType;
  /** Step in the wizard this field lives in (1-6). */
  wizardStep: number;
  /** True if this field is skippable in all modes. */
  alwaysOptional: boolean;
  /**
   * Chip-based fields use serialization via parseChoices / serializeChoices.
   * Non-chip fields use raw strings.
   */
  isChipField: boolean;
  /** True if the field supports selecting multiple values. */
  isMulti: boolean;
}

export const FIELD_META: Partial<Record<keyof BriefData, AssistantFieldMeta>> = {
  companyIndustry:      { questionType: "single", wizardStep: 1, alwaysOptional: false, isChipField: false, isMulti: false },
  companySize:          { questionType: "single", wizardStep: 1, alwaysOptional: true,  isChipField: false, isMulti: false },
  primaryGoal:          { questionType: "multi",  wizardStep: 2, alwaysOptional: false, isChipField: true,  isMulti: true  },
  existingAssets:       { questionType: "multi",  wizardStep: 2, alwaysOptional: true,  isChipField: true,  isMulti: true  },
  audienceDemographics: { questionType: "multi",  wizardStep: 3, alwaysOptional: false, isChipField: true,  isMulti: true  },
  audienceChannels:     { questionType: "multi",  wizardStep: 3, alwaysOptional: true,  isChipField: true,  isMulti: true  },
  audiencePainPoints:   { questionType: "text",   wizardStep: 3, alwaysOptional: true,  isChipField: false, isMulti: false },
  stylePreference:      { questionType: "multi",  wizardStep: 4, alwaysOptional: false, isChipField: true,  isMulti: true  },
  colorPalette:         { questionType: "multi",  wizardStep: 4, alwaysOptional: true,  isChipField: false, isMulti: true  },
  specialRequirements:  { questionType: "text",   wizardStep: 4, alwaysOptional: true,  isChipField: false, isMulti: false },
  outputFormats:        { questionType: "text",   wizardStep: 5, alwaysOptional: false, isChipField: false, isMulti: false },
  outputLanguage:       { questionType: "single", wizardStep: 5, alwaysOptional: true,  isChipField: false, isMulti: false },
  priority:             { questionType: "single", wizardStep: 6, alwaysOptional: true,  isChipField: false, isMulti: false },
};

// ── Service-specific question ordering ─────────────────────────────────────────

/**
 * Priority-ordered list of BriefData fields for each service type.
 * The planner will filter out fields not relevant to the current service.
 */
export const SERVICE_QUESTION_ORDER: Record<ServiceType, (keyof BriefData)[]> = {
  brand_identity: [
    "companyIndustry",
    "primaryGoal",
    "audienceDemographics",
    "stylePreference",
    "colorPalette",
    "existingAssets",
    "audienceChannels",
    "specialRequirements",
    "companySize",
    "priority",
    "outputLanguage",
  ],
  logo_design: [
    "companyIndustry",
    "primaryGoal",
    "stylePreference",
    "colorPalette",
    "existingAssets",
    "audienceDemographics",
    "specialRequirements",
    "companySize",
    "priority",
  ],
  company_profile: [
    "companyIndustry",
    "audienceDemographics",
    "primaryGoal",
    "existingAssets",
    "outputLanguage",
    "companySize",
    "audienceChannels",
    "stylePreference",
    "priority",
  ],
  pitch_deck: [
    "primaryGoal",
    "audienceDemographics",
    "companyIndustry",
    "existingAssets",
    "stylePreference",
    "outputLanguage",
    "companySize",
    "priority",
  ],
  social_media: [
    "audienceChannels",
    "primaryGoal",
    "audienceDemographics",
    "stylePreference",
    "existingAssets",
    "colorPalette",
    "companyIndustry",
    "priority",
  ],
  copywriting: [
    "primaryGoal",
    "audienceDemographics",
    "outputLanguage",
    "audiencePainPoints",
    "stylePreference",
    "existingAssets",
    "companyIndustry",
    "priority",
  ],
  image_generation: [
    "stylePreference",
    "colorPalette",
    "primaryGoal",
    "existingAssets",
    "companyIndustry",
    "audienceDemographics",
    "specialRequirements",
  ],
  fashion_design: [
    "companyIndustry",
    "primaryGoal",
    "audienceDemographics",
    "stylePreference",
    "colorPalette",
    "specialRequirements",
    "existingAssets",
    "audienceChannels",
    "outputFormats",
  ],
  interior_design: [
    "companyIndustry",
    "primaryGoal",
    "audienceDemographics",
    "stylePreference",
    "colorPalette",
    "specialRequirements",
    "existingAssets",
    "outputFormats",
    "audienceChannels",
  ],
  default: [
    "companyIndustry",
    "companySize",
    "primaryGoal",
    "audienceDemographics",
    "stylePreference",
    "colorPalette",
    "existingAssets",
    "audienceChannels",
    "outputLanguage",
    "priority",
    "audiencePainPoints",
    "outputFormats",
    "specialRequirements",
  ],
};

/** Fields whose visibility depends on service config flags. */
export const CONDITIONALLY_VISIBLE: Partial<Record<keyof BriefData, (cfg: {
  showSize: boolean;
  showSuccessMetrics: boolean;
  showExistingAssets: boolean;
  showPainPoints: boolean;
  showChannels: boolean;
  showColor: boolean;
  showReferences: boolean;
  showSpecialReq: boolean;
  showLanguage: boolean;
  showPriority: boolean;
  showMilestones: boolean;
}) => boolean>> = {
  companySize:        (c) => c.showSize,
  existingAssets:     (c) => c.showExistingAssets,
  audiencePainPoints: (c) => c.showPainPoints,
  audienceChannels:   (c) => c.showChannels,
  colorPalette:       (c) => c.showColor,
  referenceLinks:     (c) => c.showReferences,
  specialRequirements:(c) => c.showSpecialReq,
  outputLanguage:     (c) => c.showLanguage,
  priority:           (c) => c.showPriority,
};

// ── Review field list (shown in AssistantReview) ──────────────────────────────

/** Fields shown in the final review screen, in display order. */
export const REVIEW_FIELDS: { field: keyof BriefData; label: string; required: boolean }[] = [
  { field: "companyIndustry",      label: "Industri",                required: true  },
  { field: "primaryGoal",          label: "Tujuan project",          required: true  },
  { field: "audienceDemographics", label: "Target audiens",          required: true  },
  { field: "stylePreference",      label: "Gaya visual",             required: true  },
  { field: "colorPalette",         label: "Warna",                   required: false },
  { field: "existingAssets",       label: "Aset yang dimiliki",      required: false },
  { field: "audienceChannels",     label: "Channel audiens",         required: false },
  { field: "outputLanguage",       label: "Bahasa output",           required: false },
  { field: "priority",             label: "Prioritas pengerjaan",    required: false },
  { field: "outputFormats",        label: "Format output",           required: true  },
];
