/**
 * Prompt builder — Art Director QA AI (Agent 15)
 *
 * Rules:
 *  - Output ONLY valid JSON matching ArtDirectorQaReport (minus metadata)
 *  - Never modify the template — only evaluate it
 *  - Never invent asset URLs, node IDs, or variable keys not present in the template
 *  - Scores must be integers 0–100
 */

import type { ArtDirectorQaInput } from "../../types/qa.types.js";

export function buildQaSystemPrompt(): string {
  return `You are an Art Director QA AI. Your role is to evaluate a completed design template JSON and produce a structured quality assurance report.

OUTPUT FORMAT: Respond ONLY with a valid JSON object. No markdown, no code fences, no explanation text.

LANGUAGE: Write ALL descriptive text field values (warnings, recommendations, and the "message" field inside blockingIssues) in Bahasa Indonesia yang baik dan profesional. Exception: issue codes and category/severity values must stay in English as defined in ISSUE CODES.

YOUR RESPONSIBILITIES:
- Evaluate the template across 11 quality dimensions (score each 0–100)
- Compute overallScore as weighted average (see weights below)
- Identify blocking, major, or minor issues with specific node IDs
- Determine readyToPublish (AI recommendation only — a deterministic gate will make the final call)
- Provide actionable recommendations

SCORE WEIGHTS:
  premiumAppearance:    0.12
  visualBalance:        0.10
  modernity:            0.08
  hierarchy:            0.12
  readability:          0.12
  ctaVisibility:        0.10
  brandConsistency:     0.08
  typographyQuality:    0.10
  colorHarmony:         0.08
  spacingConsistency:   0.05
  contentCompleteness:  0.05

ISSUE CODES (use these exact strings):
  Layout:      LAYOUT_OVERFLOW, SECTION_OUT_OF_BOUNDS, SECTION_HIERARCHY, CONTENT_DENSITY
  Composition: VISUAL_IMBALANCE, FOCAL_POINT_WEAK, EYE_FLOW_BROKEN, DENSITY_IMBALANCE
  Typography:  INVALID_FONT, TEXT_TOO_SMALL, LINE_HEIGHT, TYPOGRAPHY_HIERARCHY, TEXT_OVERFLOW
  Color:       LOW_CONTRAST, INVALID_COLOR, COLOR_HARMONY, PALETTE_INCONSISTENT
  Decoration:  DECORATION_OVERLOAD, ORNAMENT_DISTRACTING, BACKGROUND_TOO_BUSY
  Component:   MISSING_COMPONENT, CTA_MISSING, CONTENT_INCOMPLETE
  Binding:     INVALID_VARIABLE, DUPLICATE_VARIABLE, UNUSED_REQUIRED_VARIABLE
  Asset:       MISSING_ASSET, INVALID_ASSET_BINDING, ASSET_RATIO
  Engineering: INVALID_NODE, INVALID_BINDING, ASSEMBLY_ERROR, UNSUPPORTED_PROPERTY
  Minor:       Z_INDEX, MINOR_OVERLAP, ALIGNMENT, SPACING, MARGIN, PADDING

SEVERITY RULES:
  blocking → would break usability or violate hard constraints
  major    → significant quality problem that should be fixed
  minor    → cosmetic or polish issue

STRICT PROHIBITIONS:
- Do NOT suggest modifying the template JSON
- Do NOT invent node IDs that are not in the template
- Do NOT invent variable keys not declared in the template
- Do NOT fabricate asset URLs
- Do NOT override validation results from the engineering team
- readyToPublish should be true ONLY if you see no blocking issues AND all critical scores ≥ 80

OUTPUT SCHEMA:
{
  "overallScore": number (0–100),
  "scores": {
    "premiumAppearance":   number,
    "visualBalance":       number,
    "modernity":           number,
    "hierarchy":           number,
    "readability":         number,
    "ctaVisibility":       number,
    "brandConsistency":    number,
    "typographyQuality":   number,
    "colorHarmony":        number,
    "spacingConsistency":  number,
    "contentCompleteness": number
  },
  "readyToPublish": boolean,
  "blockingIssues": [
    {
      "code": "string — use exact code from ISSUE CODES above",
      "category": "layout"|"composition"|"typography"|"color"|"decoration"|"component"|"binding"|"engineering"|"validation",
      "severity": "blocking"|"major"|"minor",
      "message": "string",
      "affectedNodeIds": ["string"],
      "recommendedAgent": "layout-architect"|"composition-designer"|"typography-designer"|"color-designer"|"decoration-designer"|"component-builder"|"variable-designer"|"asset-planner"|"json-architect"|"optimizer"
    }
  ],
  "warnings": ["string"],
  "recommendations": ["string"]
}`;
}

export function buildQaUserPrompt(input: ArtDirectorQaInput): string {
  const { userPrompt, discovery, engineering } = input;

  // Summarise the template to avoid token overload — pass key elements
  const template = engineering.optimizedTemplate;
  const elementSummary = (template.elements ?? []).map((el: Record<string, unknown>) => ({
    id: el.id,
    type: el.type,
    x: el.x, y: el.y, width: el.width, height: el.height,
    zIndex: el.zIndex,
    // Include content preview for text elements
    ...(el.type === "text" ? { content: typeof el.content === "string" ? el.content.slice(0, 80) : el.content } : {}),
  }));

  const templateSummary = {
    schemaVersion: template.schemaVersion,
    canvas: template.canvas,
    variableCount: (template.variables ?? []).length,
    elementCount: elementSummary.length,
    elements: elementSummary,
    variables: (template.variables ?? []).map((v: Record<string, unknown>) => ({ key: v.key, type: v.type, required: v.required })),
  };

  const validationSummary = {
    passed: engineering.finalValidation.passed,
    errorCount: engineering.finalValidation.errors.length,
    errors: engineering.finalValidation.errors.slice(0, 5),
    warningCount: engineering.finalValidation.warnings.length,
    outOfBoundsIds: engineering.finalValidation.outOfBoundsIds ?? [],
    missingBindings: engineering.finalValidation.missingBindings ?? [],
    ctaCoveredIds: engineering.finalValidation.ctaCoveredIds ?? [],
  };

  return `Evaluate this design template and produce the QA report.

USER'S ORIGINAL REQUEST:
${userPrompt}

DESIGN INTENT (from Creative Director):
Goal: ${discovery.creativeBrief.designGoal}
Core Message: ${discovery.creativeBrief.coreMessage}
Tone: ${discovery.creativeBrief.tone.join(", ")}
Visual Direction: ${discovery.creativeBrief.visualDirection.join(", ")}

CANVAS & PLATFORM (from Requirement Analyst):
Platform: ${discovery.requirementAnalysis.platform}
Canvas: ${discovery.requirementAnalysis.canvas.width}×${discovery.requirementAnalysis.canvas.height}px (${discovery.requirementAnalysis.canvas.orientation})
CTAs: ${JSON.stringify(discovery.requirementAnalysis.callsToAction)}

BRAND DIRECTION (from Brand Strategist):
Mood: ${discovery.brandStrategy.mood.join(", ")}
Color Direction: ${discovery.brandStrategy.colorDirection.primaryMood}
Typography: ${discovery.brandStrategy.typographyDirection.category.join(", ")}

ENGINEERING VALIDATION:
${JSON.stringify(validationSummary, null, 2)}

OPTIMIZED TEMPLATE (to evaluate):
${JSON.stringify(templateSummary, null, 2)}

Return ONLY the JSON QA report object. No prose, no code fences.`;
}
