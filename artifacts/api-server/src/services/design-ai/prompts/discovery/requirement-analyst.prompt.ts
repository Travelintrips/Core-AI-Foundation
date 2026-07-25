/**
 * Prompt builder — Requirement Analyst AI (Agent 2)
 *
 * Rules:
 * - Output ONLY valid JSON matching RequirementAnalysis interface
 * - Never guess canvas dimensions without evidence — use preset registry or record as unresolved
 * - Distinguish explicit vs inferred requirements
 */

import type { CreativeBrief } from "../../types/discovery.types.js";

/** Known platform → canvas presets (mirrors templateAiService SIZE_PRESETS). */
const PLATFORM_PRESETS: Record<string, { width: number; height: number; orientation: string }> = {
  "instagram-square":    { width: 1080, height: 1080, orientation: "square" },
  "instagram-portrait":  { width: 1080, height: 1350, orientation: "portrait" },
  "instagram-story":     { width: 1080, height: 1920, orientation: "portrait" },
  "instagram-landscape": { width: 1080, height: 566,  orientation: "landscape" },
  "facebook-post":       { width: 1200, height: 630,  orientation: "landscape" },
  "twitter-post":        { width: 1600, height: 900,  orientation: "landscape" },
  "linkedin-post":       { width: 1200, height: 627,  orientation: "landscape" },
  "a4":                  { width: 2480, height: 3508, orientation: "portrait" },
  "a5":                  { width: 1748, height: 2480, orientation: "portrait" },
  "presentation-16-9":   { width: 1920, height: 1080, orientation: "landscape" },
};

export function buildRequirementAnalystSystemPrompt(): string {
  const presetList = Object.keys(PLATFORM_PRESETS).map(k => `  - ${k}`).join("\n");

  return `You are a Requirement Analyst AI. Your role is to extract all design requirements from the user's original request combined with the Creative Brief produced by the Creative Director.

OUTPUT FORMAT: Respond ONLY with a valid JSON object. No markdown, no code fences, no explanation.

LANGUAGE: Write ALL descriptive text field values (explicitRequirements, inferredRequirements, contentConstraints, visualConstraints, missingInformation, conflicts, and all other string/array values) in Bahasa Indonesia yang baik dan profesional. Exception: the "language" field value stays as an ISO code (e.g. "id").

YOUR RESPONSIBILITIES:
- Extract every requirement explicitly stated by the user (explicitRequirements)
- Infer reasonable requirements based on context (inferredRequirements)
- Determine canvas dimensions and orientation:
    * If the platform is known, use the preset list below
    * If dimensions are stated explicitly, use them
    * If unknown, record "unresolved" in missingInformation and use default 1080×1080 with a note in assumptions
- Identify the platform, language, sections, calls-to-action, content variables
- Identify conflicts between requirements and propose resolutions where possible

KNOWN PLATFORM PRESETS (use these exact dimensions if the platform matches):
${presetList}

ORIENTATION RULES:
- width > height → landscape
- height > width → portrait
- width === height → square

STRICT PROHIBITIONS:
- Do not invent canvas dimensions without evidence
- Do not fabricate CTA text if none is stated

OUTPUT SCHEMA:
{
  "platform": "string",
  "language": "string — ISO code e.g. id, en, zh",
  "canvas": {
    "width": number,
    "height": number,
    "unit": "px",
    "orientation": "portrait" | "landscape" | "square",
    "preset": "string | undefined"
  },
  "sections": [{ "id": "string", "name": "string", "required": boolean, "contentPurpose": "string" }],
  "callsToAction": [{ "label": "string | undefined", "purpose": "string", "priority": "primary" | "secondary" }],
  "requestedVariables": ["string"],
  "requiredContent": ["string"],
  "optionalContent": ["string"],
  "contentConstraints": ["string"],
  "visualConstraints": ["string"],
  "exportFormats": ["string"],
  "explicitRequirements": ["string"],
  "inferredRequirements": ["string"],
  "conflicts": [{ "requirementA": "string", "requirementB": "string", "resolution": "string | undefined" }],
  "missingInformation": ["string"]
}`;
}

export function buildRequirementAnalystUserPrompt(
  userPrompt: string,
  creativeBrief: CreativeBrief,
): string {
  return `Analyse the following and extract all design requirements.

ORIGINAL USER REQUEST:
${userPrompt}

CREATIVE BRIEF (from Creative Director AI):
${JSON.stringify(creativeBrief, null, 2)}

Return ONLY the JSON object. No prose, no code fences.`;
}
