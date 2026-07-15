/**
 * interiorDesignDocumentMapper.ts — Interior Design Proposal PDF mapper.
 *
 * Normalizes the 5-agent Interior Design pipeline outputs into a
 * CreativeDocumentSpec for PDF rendering.
 *
 * Minimum page count: 5
 */

import type { CreativeProject } from "@workspace/db";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../creativeDocumentService.js";
import type { DocumentDefinition } from "../creativeDocumentWorkerService.js";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

interface InteriorDesignContent {
  conceptTitle:             string;
  conceptNarrative:         string;
  designPhilosophy:         string;
  emotionalIntent:          string;
  colorPaletteMood:         string;
  signatureElements:        string[];
  zoningPrinciple:          string;
  circulationFlow:          string;
  naturalLightApproach:     string;
  flooringHighlights:       string;
  wallTreatmentHighlights:  string;
  heroFurniture:            string;
  lightingSpecification:    string;
  greeneryBiophilic:        string;
  projectTitle:             string;
  projectTagline:           string;
  designStatement:          string;
  conceptNarrativeCopy:     string;
  valueStatement:           string;
  socialRevealCaption:      string;
  overallScore:             number;
  approved:                 boolean;
  approvalNotes:            string;
}

function normalizeInteriorContent(project: CreativeProject): InteriorDesignContent {
  const result    = obj(project.result);
  const concept   = obj(result["interiorConceptArchitect"]);
  const spacePlan = obj(result["interiorSpacePlanner"]);
  const materials = obj(result["interiorMaterialSpecialist"]);
  const copy      = obj(result["interiorCopywriter"]);
  const qc        = obj(result["interiorQcReview"]);

  const designConcept  = obj(concept["design_concept"]);
  const colorConcept   = obj(concept["color_concept"]);
  const spaceStrategy  = obj(spacePlan["space_planning_strategy"]);
  const naturalLight   = obj(spacePlan["natural_light_optimization"]);
  const lighting       = obj(materials["lighting_specification"]);
  const socialCopy     = obj(copy["social_media_copy"]);

  const flooringArr    = Array.isArray(materials["flooring"]) ? materials["flooring"] : [];
  const firstFloor     = obj(flooringArr[0]);
  const wallArr        = Array.isArray(materials["wall_treatments"]) ? materials["wall_treatments"] : [];
  const firstWall      = obj(wallArr[0]);
  const furnitureArr   = Array.isArray(materials["key_furniture"]) ? materials["key_furniture"] : [];
  const heroFurnitureObj = obj(furnitureArr[0]);

  return {
    conceptTitle:            str(designConcept["title"]),
    conceptNarrative:        str(designConcept["narrative"]),
    designPhilosophy:        str(designConcept["design_philosophy"]),
    emotionalIntent:         str(designConcept["emotional_intent"]),
    colorPaletteMood:        str(colorConcept["palette_mood"]),
    signatureElements:       strArr(concept["signature_elements"]),
    zoningPrinciple:         str(spaceStrategy["zoning_principle"]),
    circulationFlow:         str(spaceStrategy["circulation_flow"]),
    naturalLightApproach:    str(naturalLight["window_treatment_direction"]),
    flooringHighlights:      firstFloor["material"] ? `${str(firstFloor["material"])} — ${str(firstFloor["rationale"])}` : "",
    wallTreatmentHighlights: firstWall["treatment"] ? `${str(firstWall["treatment"])} — ${str(firstWall["color_or_pattern"])}` : "",
    heroFurniture:           heroFurnitureObj["piece"] ? `${str(heroFurnitureObj["piece"])}: ${str(heroFurnitureObj["style"])}` : "",
    lightingSpecification:   str(lighting["hero_fixture"]) || str(lighting["ambient_lighting"]),
    greeneryBiophilic:       str(materials["greenery_biophilic"]),
    projectTitle:            str(copy["project_title"]),
    projectTagline:          str(copy["project_tagline"]),
    designStatement:         str(copy["design_statement"]),
    conceptNarrativeCopy:    str(copy["concept_narrative"]),
    valueStatement:          str(copy["value_statement"]),
    socialRevealCaption:     str(socialCopy["project_reveal_caption"]),
    overallScore:            typeof qc["overall_score"] === "number" ? (qc["overall_score"] as number) : 0,
    approved:                qc["approved"] === true,
    approvalNotes:           str(qc["approval_notes"]),
  };
}

function buildInteriorDesignSpec(
  project: CreativeProject,
  rawContent: Record<string, unknown>,
  coverImageBuffer: Buffer | null,
  _inlineImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativeDocumentSpec; report: Record<string, unknown> } {
  const content = rawContent as unknown as InteriorDesignContent;
  const sections: CreativeDocumentSection[] = [];
  const included: string[] = [];
  const skipped:  string[] = [];

  function add(id: string, ...items: CreativeDocumentSection[]) { sections.push(...items); included.push(id); }
  function skip(id: string) { skipped.push(id); }

  // Design Concept
  if (content.conceptNarrative || content.designPhilosophy) {
    add("design-concept",
      { type: "heading",   title: content.conceptTitle || "Design Concept" },
      ...(content.conceptNarrative ? [{ type: "paragraph" as const, text: content.conceptNarrative }] : []),
      ...(content.designPhilosophy ? [{ type: "paragraph" as const, text: `Philosophy: ${content.designPhilosophy}` }] : []),
      ...(content.emotionalIntent ? [{ type: "paragraph" as const, text: `Intent: ${content.emotionalIntent}` }] : []),
    );
  } else skip("design-concept");

  // Color & Signature
  if (content.colorPaletteMood || content.signatureElements.length) {
    add("color-signature",
      { type: "heading", title: "Color Story & Signature Elements" },
      ...(content.colorPaletteMood ? [{ type: "paragraph" as const, text: content.colorPaletteMood }] : []),
      ...(content.signatureElements.length ? [{ type: "bullets" as const, items: content.signatureElements }] : []),
    );
  } else skip("color-signature");

  // Space Planning
  if (content.zoningPrinciple || content.circulationFlow) {
    add("space-planning",
      { type: "heading", title: "Space Planning" },
      ...(content.zoningPrinciple ? [{ type: "paragraph" as const, text: `Zoning: ${content.zoningPrinciple}` }] : []),
      ...(content.circulationFlow ? [{ type: "paragraph" as const, text: `Flow: ${content.circulationFlow}` }] : []),
      ...(content.naturalLightApproach ? [{ type: "paragraph" as const, text: `Natural Light: ${content.naturalLightApproach}` }] : []),
    );
  } else skip("space-planning");

  // Materials & Finishes
  const materialItems: string[] = [
    content.flooringHighlights ? `Flooring: ${content.flooringHighlights}` : "",
    content.wallTreatmentHighlights ? `Walls: ${content.wallTreatmentHighlights}` : "",
    content.heroFurniture ? `Hero Furniture: ${content.heroFurniture}` : "",
    content.lightingSpecification ? `Lighting: ${content.lightingSpecification}` : "",
    content.greeneryBiophilic ? `Biophilic: ${content.greeneryBiophilic}` : "",
  ].filter(Boolean);
  if (materialItems.length) {
    add("materials-finishes",
      { type: "heading", title: "Materials & Finishes" },
      ...materialItems.map((t) => ({ type: "paragraph" as const, text: t })),
    );
  } else skip("materials-finishes");

  // Design Statement
  if (content.designStatement || content.conceptNarrativeCopy) {
    add("design-statement",
      { type: "heading", title: content.projectTitle || "Design Statement" },
      ...(content.projectTagline ? [{ type: "quote" as const, text: content.projectTagline, attribution: project.brandName }] : []),
      ...(content.designStatement ? [{ type: "paragraph" as const, text: content.designStatement }] : []),
      ...(content.conceptNarrativeCopy ? [{ type: "paragraph" as const, text: content.conceptNarrativeCopy }] : []),
    );
  } else skip("design-statement");

  // Value & Social
  if (content.valueStatement) {
    add("value",
      { type: "heading",   title: "Investment Value" },
      { type: "paragraph", text: content.valueStatement },
      ...(content.socialRevealCaption ? [{ type: "paragraph" as const, text: `Reveal Copy: ${content.socialRevealCaption}` }] : []),
    );
  } else skip("value");

  const spec: CreativeDocumentSpec = {
    documentType: "interior_design",
    title:        `${project.brandName} — Interior Design Proposal`,
    cover: {
      title:       project.brandName,
      tagline:     content.projectTagline || content.emotionalIntent,
      subtitle:    content.projectTitle || "Interior Design Proposal",
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Interior Design Proposal`,
      showPageNumber: true,
    },
    closing: {
      text: `This interior design proposal was crafted to transform your space into a reflection of your vision and lifestyle.`,
    },
  };

  return {
    spec,
    report: {
      documentType:     "interior_design",
      sectionsIncluded: included,
      sectionsSkipped:  skipped,
      overallScore:     content.overallScore,
      approved:         content.approved,
    },
  };
}

export const interiorDesignDefinition: DocumentDefinition = {
  documentType:     "interior_design",
  filenamePrefix:   "interior-design-proposal",
  minimumPageCount: 5,
  requiresLogo:     false,
  maxInlineImages:  3,

  generateContent: async (project) => {
    const content = normalizeInteriorContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: buildInteriorDesignSpec,
};
