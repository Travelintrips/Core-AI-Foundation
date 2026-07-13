/**
 * Adapts the live BriefData wizard state (+ service context) into the
 * engine's BriefIntelligenceContext. Pure read-only transform — never
 * mutates the brief.
 */

import { detectServiceType } from "@/config/brief-service-config";
import {
  INDUSTRY_OPTIONS, COMPANY_SIZE_OPTIONS, GOAL_OPTIONS,
  AUDIENCE_OPTIONS, ASSET_OPTIONS, PRIORITY_OPTIONS, STYLE_OPTIONS,
} from "@/config/brief-options";
import { DEFAULT_COLOR_PRESETS } from "@/components/creative-ui/ColorPicker";
import { parseChoices, parseColors, parseSingleChoice } from "@/lib/brief-utils";
import type { BriefData } from "@/pages/brief";
import type { BriefIntelligenceContext } from "./types";

export interface BuildContextInput {
  brief: BriefData;
  serviceName: string | null | undefined;
}

export function buildBriefIntelligenceContext({ brief, serviceName }: BuildContextInput): BriefIntelligenceContext {
  const serviceType = detectServiceType(serviceName ?? "");

  const industryParsed = parseSingleChoice(brief.companyIndustry, INDUSTRY_OPTIONS);
  const industryKey = industryParsed.selected && industryParsed.selected !== "other" ? industryParsed.selected : null;
  const industryCustomText = industryParsed.selected === "other" ? industryParsed.custom : "";

  const companySizeParsed = parseSingleChoice(brief.companySize, COMPANY_SIZE_OPTIONS);
  const companySizeKey = companySizeParsed.selected && companySizeParsed.selected !== "other" ? companySizeParsed.selected : null;

  const goalParsed = parseChoices(brief.primaryGoal, GOAL_OPTIONS);
  const audienceParsed = parseChoices(brief.audienceDemographics, AUDIENCE_OPTIONS);
  const assetsParsed = parseChoices(brief.existingAssets, ASSET_OPTIONS);
  const priorityParsed = parseSingleChoice(brief.priority, PRIORITY_OPTIONS);
  const styleParsed = parseChoices(brief.stylePreference, STYLE_OPTIONS);
  const colorParsed = parseColors(brief.colorPalette, DEFAULT_COLOR_PRESETS);

  return {
    serviceType,
    industryKey,
    industryCustomText,
    companySizeKey,
    goalKeys: goalParsed.selected.filter((k) => k !== "other"),
    audienceKeys: audienceParsed.selected.filter((k) => k !== "other"),
    existingAssetKeys: assetsParsed.selected.filter((k) => k !== "other" && k !== "none"),
    priorityKey: priorityParsed.selected && priorityParsed.selected !== "other" ? priorityParsed.selected : null,
    selected: {
      styleKeys: styleParsed.selected.filter((k) => k !== "other" && k !== "unsure"),
      colorKeys: colorParsed.selected.filter((k) => k !== "other" && k !== "none"),
    },
  };
}
