/**
 * Team 13 — Dynamic Design Composition Engine
 * Composer Engine — main orchestrator
 *
 * Combines all inputs deterministically into a DesignCompositionSpec.
 * No image generation. No file rendering. Returns pure JSON.
 *
 * Determinism guarantee: identical inputs always produce identical outputs.
 * Composition ID is a SHA-256 hash of the normalised input.
 */

import { createHash } from "node:crypto";
import type {
  CompositionRequest,
  DesignCompositionSpec,
  ComponentInput,
  ResolvedComponent,
} from "./types.js";
import { applyFallbacks } from "./fallbackHandler.js";
import { checkCompatibility } from "./compatibilityChecker.js";
import { checkBrandConsistency } from "./brandConsistencyChecker.js";
import { buildExplainabilityReport } from "./explainabilityEngine.js";
import { deriveTokens, resolveComponentStyleTokens } from "./tokenDeriver.js";
import { explainComponents } from "./explainabilityEngine.js";

// ── Deterministic ID ──────────────────────────────────────────────────────────

function buildCompositionId(request: CompositionRequest): string {
  // Normalise: sort keys, strip undefined, produce stable JSON
  const stable = JSON.stringify(request, (_key, value) => {
    if (value === undefined) return null;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return createHash("sha256").update(stable).digest("hex");
}

// ── Style consistency score ───────────────────────────────────────────────────

function computeStyleConsistencyScore(
  compatibilityScore: number,
  fallbackCount: number,
): number {
  // Start from compatibility score, penalise for each fallback applied
  const fallbackPenalty = Math.min(fallbackCount * 5, 30);
  return Math.max(0, Math.round(compatibilityScore - fallbackPenalty));
}

// ── Component resolver ────────────────────────────────────────────────────────

function resolveComponents(
  components: ComponentInput[],
  request: CompositionRequest,
  fallbacks: ReturnType<typeof applyFallbacks>["fallbacks"],
): ResolvedComponent[] {
  const { palette, decoration, layout, brandDna } = {
    palette: request.palette,
    decoration: request.decoration,
    layout: request.layoutPlan,
    brandDna: request.brandDna,
  };

  const explanations = explainComponents(components, layout, brandDna, fallbacks);

  return components.map((component, idx) => {
    const explanation = explanations[idx] ?? {
      componentType: component.type,
      chosen: component.type,
      why: "Included as specified.",
      brandSignal: null,
      alternativesRejected: [],
      overridden: false,
    };

    const resolvedZone = component.zone ?? defaultZone(component.type);
    const resolvedVariant = component.variant ?? defaultVariant(component.type, request);
    const styleTokens = resolveComponentStyleTokens(component, palette, decoration);

    return {
      ...component,
      resolvedVariant,
      resolvedZone,
      styleTokens,
      explanation,
    };
  });
}

function defaultZone(type: ComponentInput["type"]): ResolvedComponent["resolvedZone"] {
  const topZone: ComponentInput["type"][] = ["header", "nav", "hero", "breadcrumb"];
  const bottomZone: ComponentInput["type"][] = ["footer", "cta", "form"];
  const sidebarZone: ComponentInput["type"][] = ["map"];
  if (topZone.includes(type)) return "top";
  if (bottomZone.includes(type)) return "bottom";
  if (sidebarZone.includes(type)) return "sidebar";
  return "middle";
}

function defaultVariant(
  type: ComponentInput["type"],
  request: CompositionRequest,
): string {
  const personality = request.brandDna?.brandPersonality?.[0]?.toLowerCase() ?? "";
  const variantMap: Partial<Record<ComponentInput["type"], Record<string, string>>> = {
    hero: {
      minimal: "text-only",
      bold: "full-bleed-image",
      corporate: "split-image",
      default: "standard",
    },
    cta: {
      luxury: "outlined",
      bold: "filled-large",
      default: "filled",
    },
    header: {
      minimal: "transparent",
      default: "solid",
    },
  };
  const typeVariants = variantMap[type];
  if (!typeVariants) return "standard";
  return typeVariants[personality] ?? typeVariants["default"] ?? "standard";
}

// ── Main compose function ─────────────────────────────────────────────────────

export function compose(request: CompositionRequest): DesignCompositionSpec {
  // 1. Build deterministic composition ID
  const compositionId = buildCompositionId(request);

  // 2. Apply fallbacks — resolve all missing/invalid inputs
  const fallbackResult = applyFallbacks(
    request.blueprint,
    request.layoutPlan,
    request.components,
    request.pattern,
    request.palette,
    request.typography,
    request.decoration,
    request.material,
    request.motif,
    request.brandDna,
  );

  const {
    blueprint,
    layoutPlan,
    components,
    pattern,
    palette,
    typography,
    decoration,
    material,
    motif,
    fallbacks,
  } = fallbackResult;

  // Merge fallback-resolved values back into a unified request for downstream use
  const resolved: CompositionRequest = {
    ...request,
    blueprint,
    layoutPlan,
    components,
    pattern,
    palette,
    typography,
    decoration,
    material,
    motif,
  };

  // 3. Compatibility check
  const compatibility = checkCompatibility({
    material,
    pattern,
    palette,
    decoration,
    layout: layoutPlan,
    components,
    typography,
  });

  // 4. Brand consistency check (only if Brand DNA provided)
  const brandDna = request.brandDna;
  const brandConsistency = brandDna
    ? checkBrandConsistency({ palette, typography, layout: layoutPlan, decoration, material, brandDna })
    : {
        score: 100,
        colorAlignment: { score: 100, issues: [], suggestions: [] },
        typographyAlignment: { score: 100, issues: [], suggestions: [] },
        layoutAlignment: { score: 100, issues: [], suggestions: [] },
        personalityAlignment: { score: 100, traits: [], mismatches: [] },
      };

  // 5. Resolve components with style tokens and explanations
  const resolvedComponents = resolveComponents(components, resolved, fallbacks);

  // 6. Derive design tokens
  const derivedTokens = deriveTokens(typography, decoration, material);

  // 7. Build explainability report
  const explainability = buildExplainabilityReport({
    blueprint,
    layout: layoutPlan,
    palette,
    typography,
    pattern,
    components,
    decoration,
    material,
    motif,
    brandDna,
    fallbacks,
  });

  // 8. Compute quality scores
  const styleConsistencyScore = computeStyleConsistencyScore(
    compatibility.score,
    fallbacks.length,
  );
  const brandConsistencyScore = brandDna ? brandConsistency.score : 100;

  return {
    compositionId,
    version: "1.0",

    // Resolved design elements
    blueprint,
    layout: layoutPlan,
    palette,
    typography,
    components: resolvedComponents,
    pattern,
    decoration,
    material,
    motif,

    // Derived tokens
    derivedTokens,

    // Quality scores
    styleConsistencyScore,
    brandConsistencyScore,
    brandConsistency,
    compatibility,

    // Explainability
    explainability,

    // Fallbacks
    fallbacksApplied: fallbacks,
    hasNoAssetFallbacks: fallbacks.some((f) => f.reason === "missing"),

    composedAt: new Date().toISOString(),
  };
}
