/**
 * Engineering Adapter (Discovery + Design + Component → Team 4 Engineering Pipeline → Orchestrator)
 *
 * Bridges:
 *  1. Maps orchestrator types → Team 4 EngineeringTeamInput
 *  2. Calls runEngineeringPipeline() — Team 4's real implementation (agents 12–14)
 *  3. Maps Team 4 real EngineeringPipelineOutput → orchestrator EngineeringPipelineOutput shape
 *
 * Rules (per Tahap 5 policy): pure, deterministic, no fabricated data.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type {
  DesignTeamOutput as OrchestratorDesignOutput,
  ComponentTeamOutput as OrchestratorComponentOutput,
  EngineeringPipelineOutput as OrchestratorEngineeringOutput,
  EngineeringValidation,
} from "../../types/orchestrator.types.js";
import type {
  EngineeringTeamInput,
  EngineeringPipelineOutput as T4RealOutput,
  DiscoveryTeamOutput as T4DiscoveryInput,
  DesignTeamOutput as T4DesignInput,
  ComponentTeamOutput as T4ComponentInput,
} from "../../types/engineering.types.js";
import type { DesignElement } from "../../../../types/designTemplate.js";
import { runEngineeringPipeline } from "../../pipeline/engineeringPipeline.js";

export interface EngineeringAdapterOptions {
  tenantId:    string;
  actorId:     string;
  templateId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SIZE_PRESETS = new Set([
  "instagram-square", "instagram-portrait", "instagram-landscape", "a4", "custom",
]);

function toSizePreset(
  preset: string | undefined,
): "instagram-square" | "instagram-portrait" | "instagram-landscape" | "a4" | "custom" | undefined {
  if (!preset) return undefined;
  return VALID_SIZE_PRESETS.has(preset)
    ? (preset as "instagram-square" | "instagram-portrait" | "instagram-landscape" | "a4" | "custom")
    : "custom";
}

/** Parse "key:value" notes written by designAdapter. */
function parseColorNotes(notes: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const note of notes) {
    const colon = note.indexOf(":");
    if (colon > 0) {
      const val = note.slice(colon + 1);
      if (val && val !== "undefined") {
        result[note.slice(0, colon)] = val;
      }
    }
  }
  return result;
}

/** Infer variable type from key name — deterministic keyword match. */
function inferVariableType(
  key: string,
): "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean" {
  const k = key.toLowerCase();
  if (/image|photo|picture|logo|banner/.test(k))  return "image";
  if (/price|amount|cost|fee|harga/.test(k))       return "currency";
  if (/count|qty|quantity|num/.test(k))            return "number";
  if (/url|link|href|website/.test(k))             return "url";
  if (/date|time|deadline/.test(k))               return "date";
  if (/color|colour/.test(k))                     return "color";
  return "text";
}

/** Map Team 3 component type string → DesignElement["type"] — deterministic lookup. */
function mapComponentType(type: string): DesignElement["type"] {
  const MAP: Record<string, DesignElement["type"]> = {
    logo:                "image",
    image_placeholder:   "image",
    title:               "text",
    subtitle:            "text",
    description:         "text",
    price:               "text",
    cta:                 "shape",
    qr_code:             "qrcode",
    contact_information: "text",
    footer:              "text",
    social_icon:         "image",
    badge:               "shape",
    divider:             "shape",
    background:          "shape",
    shape:               "shape",
  };
  return MAP[type] ?? "text";
}

/** Map role/purpose string → Team 4's purpose enum — deterministic lookup. */
function mapPurpose(
  role: string,
): "heading" | "subheading" | "body" | "cta" | "image" | "logo" | "background" | "decoration" | "qrcode" | "divider" {
  const MAP: Record<string, "heading" | "subheading" | "body" | "cta" | "image" | "logo" | "background" | "decoration" | "qrcode" | "divider"> = {
    title:               "heading",
    subtitle:            "subheading",
    description:         "body",
    cta:                 "cta",
    image_placeholder:   "image",
    logo:                "logo",
    background:          "background",
    shape:               "decoration",
    badge:               "decoration",
    divider:             "divider",
    qr_code:             "qrcode",
  };
  return MAP[role] ?? "body";
}

function resolveLayoutStrategy(
  gridSystem: string,
  density: "low" | "medium" | "high",
): "centered" | "left-aligned" | "grid" | "hero-bottom" | "split" {
  if (gridSystem.startsWith("1-"))   return "centered";
  if (density === "high")            return "grid";
  if (gridSystem.startsWith("2-"))   return "split";
  return "left-aligned";
}

// ── Input mappings ────────────────────────────────────────────────────────────

function adaptDiscoveryForEngineering(discovery: DiscoveryTeamOutput): T4DiscoveryInput {
  const brief = discovery.creativeBrief;
  const req   = discovery.requirementAnalysis;
  const brand = discovery.brandStrategy;
  return {
    briefSummary:      brief.designGoal,
    targetAudience:    brief.targetAudience.primary,
    communicationGoals: brief.contentPriority,
    requiredVariables: req.requestedVariables.map(key => ({
      key,
      label:    key.replace(/_/g, " "),
      type:     inferVariableType(key),
      required: true,
    })),
    recommendedSizePreset: toSizePreset(req.canvas.preset),
    canvasWidth:  req.canvas.width,
    canvasHeight: req.canvas.height,
    brandGuidelines: {
      primaryColors:   [],
      secondaryColors: [],
      fonts:           [],
      tone:            brand.mood.join(", "),
    },
  };
}

function adaptDesignForEngineering(design: OrchestratorDesignOutput): T4DesignInput {
  const colors = parseColorNotes(design.colorSystemNotes);
  const layoutStrategy = resolveLayoutStrategy(
    design.layoutDecisions.gridSystem,
    design.layoutDecisions.densityRating,
  );

  return {
    templateName:   `AI Generated — ${design.layoutDecisions.gridSystem}`,
    layoutStrategy,
    colorPalette: {
      background: colors["background"] ?? "#ffffff",
      primary:    colors["primary"]    ?? "#000000",
      secondary:  colors["secondary"],
      accent:     colors["accent"],
      text:       colors["text"]       ?? "#000000",
      textMuted:  colors["textMuted"],
    },
    typography: {
      heading: {
        fontFamily: design.typographyChoices.primaryCategory,
        fontSize:   48,
        fontWeight: "bold",
      },
      body: {
        fontFamily: design.typographyChoices.secondaryCategory ?? design.typographyChoices.primaryCategory,
        fontSize:   16,
      },
    },
  };
}

function adaptComponentsForEngineering(
  components: OrchestratorComponentOutput,
): T4ComponentInput {
  return {
    componentPlan: components.componentPlan.map(c => ({
      id:            c.id,
      componentType: mapComponentType(c.type),
      purpose:       mapPurpose(c.purpose),
    })),
  };
}

// ── Output mapping: Team 4 real → orchestrator contract ──────────────────────

function adaptEngineeringOutput(real: T4RealOutput): OrchestratorEngineeringOutput {
  const fv = real.finalValidation;
  const validation: EngineeringValidation = {
    passed:         fv.passed,
    errors:         fv.errors.map(e => `[${e.code}] ${e.message}`),
    warnings:       fv.warnings.map(w => `[${w.code}] ${w.message}`),
    outOfBoundsIds: fv.errors.filter(e => e.code === "OUT_OF_BOUNDS").map(e => e.nodeId ?? "").filter(Boolean),
    missingBindings: fv.errors.filter(e => e.code === "MISSING_BINDING").map(e => e.field ?? "").filter(Boolean),
    ctaCoveredIds:  fv.errors.filter(e => e.code === "CTA_COVERED").map(e => e.nodeId ?? "").filter(Boolean),
  };

  return {
    optimizedTemplate: real.optimizedTemplate,
    finalValidation:   validation,
    _agentMetadata:    [],
  };
}

// ── Public adapter (replaces runEngineeringPipelineStub) ─────────────────────

export async function runEngineeringAdapter(
  discovery:  DiscoveryTeamOutput,
  design:     OrchestratorDesignOutput,
  components: OrchestratorComponentOutput,
  opts:       EngineeringAdapterOptions,
): Promise<OrchestratorEngineeringOutput> {
  const t4Input: EngineeringTeamInput = {
    discovery:  adaptDiscoveryForEngineering(discovery),
    design:     adaptDesignForEngineering(design),
    components: adaptComponentsForEngineering(components),
  };

  const realOutput = await runEngineeringPipeline(t4Input, {
    tenantId:   opts.tenantId,
    actorId:    opts.actorId,
    templateId: opts.templateId,
  });

  return adaptEngineeringOutput(realOutput);
}
