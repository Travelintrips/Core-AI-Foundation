/**
 * Template Assembler
 *
 * Converts an AiTemplateProposal (from templateAiService) into a fully-typed
 * EngineeringTeamInput so it can flow through the Engineering Pipeline.
 *
 * This is the bridge between the existing AI generation system (Team 1-style
 * output) and the new Team 4 engineering pipeline. It also provides a
 * convenience function to build EngineeringTeamInput directly from structured
 * team outputs.
 */

import type { AiTemplateProposal } from "../../../validators/designTemplateAiSchema.js";
import type {
  EngineeringTeamInput,
  DiscoveryTeamOutput,
  DesignTeamOutput,
  ComponentTeamOutput,
} from "../types/engineering.types.js";
import type { DesignElement, TemplateVariable } from "../../../types/designTemplate.js";

// Local type aliases for brevity
type RawVariable = AiTemplateProposal["variables"][number];
type RawElement  = AiTemplateProposal["template"]["elements"][number];

// ── Proposal → EngineeringTeamInput ──────────────────────────────────────────

/**
 * Converts an existing AiTemplateProposal into an EngineeringTeamInput.
 * Useful when Teams 1/2/3 output is represented as an AiTemplateProposal.
 */
export function proposalToEngineeringInput(proposal: AiTemplateProposal): EngineeringTeamInput {
  const t = proposal.template;

  // ── Discovery (Team 1 analog) ─────────────────────────────────────────────
  const discovery: DiscoveryTeamOutput = {
    briefSummary: proposal.summary,
    targetAudience: "General audience",
    communicationGoals: proposal.assumptions,
    requiredVariables: proposal.variables.map((v: RawVariable) => ({
      key: v.key,
      label: v.label,
      type: v.type as DiscoveryTeamOutput["requiredVariables"][number]["type"],
      required: v.required,
      defaultValue: v.defaultValue as string | number | boolean | undefined,
    })),
    canvasWidth:  t.canvas.width,
    canvasHeight: t.canvas.height,
  };

  // ── Design (Team 2 analog) ────────────────────────────────────────────────
  // Extract color palette from the existing template elements
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements = t.elements as any[];
  const bgShape  = elements.find(el => el.type === "shape" && (el as any).zIndex === 0) as any;
  const firstText = elements.find(el => el.type === "text") as any;

  const design: DesignTeamOutput = {
    templateName: t.name,
    category:    t.category,
    description: t.description,
    layoutStrategy: "centered",
    colorPalette: {
      background: (t.canvas as any).backgroundColor ?? bgShape?.fill ?? "#FFFFFF",
      primary:    firstText?.color ?? "#1E3A5F",
      text:       firstText?.color ?? "#1E3A5F",
    },
    typography: {
      heading: {
        fontFamily: firstText?.fontFamily ?? "Inter",
        fontSize:   firstText?.fontSize   ?? 48,
        fontWeight: firstText?.fontWeight ?? "bold",
      },
      body: {
        fontFamily: firstText?.fontFamily ?? "Inter",
        fontSize:   Math.round((firstText?.fontSize ?? 48) * 0.5),
      },
    },
  };

  // ── Components (Team 3 analog) ────────────────────────────────────────────
  const componentPlan: ComponentTeamOutput["componentPlan"] = elements.map((el) => {
    // elements is cast to any[] above; el is any
    const name = el.name ?? el.type;
    const purpose = inferPurpose(name, el.type);
    let variableKey: string | undefined;

    // Extract variable key from binding
    if (el.type === "text" || el.type === "qrcode") {
      const c = el.content;
      if (c && typeof c === "object" && "binding" in c) variableKey = c.binding?.variableKey;
    }
    if (el.type === "image") {
      const s = el.src;
      if (s && typeof s === "object" && "binding" in s) variableKey = s.binding?.variableKey;
    }

    return {
      id:            el.id,
      componentType: el.type as DesignElement["type"],
      purpose,
      suggestedContent: el.type === "text" && typeof el.content === "string" ? el.content : undefined,
      variableKey,
      suggestedPosition: { x: el.x, y: el.y },
      suggestedSize:     { width: el.width, height: el.height },
      zIndexHint:        el.zIndex,
    };
  });

  const components: ComponentTeamOutput = { componentPlan };

  return { discovery, design, components };
}

function inferPurpose(name: string, type: string): ComponentTeamOutput["componentPlan"][number]["purpose"] {
  const n = name.toLowerCase();
  if (n.includes("bg") || n.includes("background")) return "background";
  if (n.includes("heading") || n.includes("title"))  return "heading";
  if (n.includes("sub"))                              return "subheading";
  if (n.includes("body") || n.includes("desc"))      return "body";
  if (n.includes("cta")  || n.includes("button"))    return "cta";
  if (n.includes("logo"))                             return "logo";
  if (n.includes("image") || n.includes("photo"))    return "image";
  if (n.includes("qr"))                               return "qrcode";
  if (n.includes("line")  || n.includes("divider"))  return "divider";
  if (n.includes("deco")  || n.includes("accent"))   return "decoration";
  // Fallback by type
  if (type === "image")   return "image";
  if (type === "qrcode")  return "qrcode";
  if (type === "line")    return "divider";
  if (type === "shape")   return "decoration";
  return "body";
}

// ── Convenience builder ───────────────────────────────────────────────────────

export function buildEngineeringInput(
  discovery: DiscoveryTeamOutput,
  design: DesignTeamOutput,
  components: ComponentTeamOutput,
): EngineeringTeamInput {
  return { discovery, design, components };
}
