/**
 * product-design — Mockup Composer
 *
 * Orchestrates the blueprint and composition ports to produce a ProductMockup.
 *
 * Flow:
 *   1. Call BlueprintPort.generateLayers(concept, viewAngle) → layer stack
 *   2. Build a CompositionSpec from the layer stack
 *   3. Optionally call CompositionPort.render(spec) → assetKey
 *   4. Return a ProductMockup (with disclaimer)
 *
 * The composer itself is SIDE-EFFECT FREE beyond calling the ports.
 * All port interactions are async and injected — no global singletons.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { randomUUID } from "crypto";
import type { ProductConcept } from "../types/concept";
import { CONCEPT_DISCLAIMER } from "../types/concept";
import type { ProductMockup, CompositionSpec, MockupFormat, ViewAngle } from "../types/mockup";
import { LAYER_ZINDEX } from "../types/mockup";
import type { BlueprintPort, CompositionPort } from "../types/ports";

// ── Options ────────────────────────────────────────────────────────────────────

export interface ComposeMockupOptions {
  viewAngle: ViewAngle;
  widthPx: number;
  heightPx: number;
  format: MockupFormat;
  backgroundColor?: string;
  /**
   * If true, the composer calls the CompositionPort to render the asset.
   * If false (default), returns the spec-only mockup (layers assembled, not rendered).
   */
  render?: boolean;
}

// ── Composer ───────────────────────────────────────────────────────────────────

/**
 * Composes a ProductMockup for the given concept and view angle.
 *
 * @param concept     The concept to visualise.
 * @param options     Composition options (view, size, format, render flag).
 * @param blueprint   BlueprintPort implementation (real or null stub).
 * @param composition CompositionPort implementation (real or null stub).
 *                    Only called when options.render === true.
 */
export async function composeMockup(
  concept: ProductConcept,
  options: ComposeMockupOptions,
  blueprint: BlueprintPort,
  composition: CompositionPort,
): Promise<ProductMockup> {
  const {
    viewAngle,
    widthPx,
    heightPx,
    format,
    backgroundColor = "#FFFFFF",
    render = false,
  } = options;

  // ── Step 1: generate layer stack ──────────────────────────────────────────

  const blueprintResult = await blueprint.generateLayers({
    concept,
    viewAngle,
    widthPx,
    heightPx,
  });

  // ── Step 2: sort layers by canonical z-index ───────────────────────────────

  const sortedLayers = [...blueprintResult.layers].sort(
    (a, b) => a.zIndex - b.zIndex,
  );

  // Enforce canonical z-index values from LAYER_ZINDEX map
  const normalisedLayers = sortedLayers.map((layer) => ({
    ...layer,
    zIndex: LAYER_ZINDEX[layer.type] ?? layer.zIndex,
  }));

  // ── Step 3: build CompositionSpec ─────────────────────────────────────────

  const spec: CompositionSpec = {
    conceptId:       concept.id,
    viewAngle,
    widthPx,
    heightPx,
    layers:          normalisedLayers,
    backgroundColor: blueprintResult.backgroundColor ?? backgroundColor,
    finalised:       true,
  };

  // ── Step 4: optional rendering ────────────────────────────────────────────

  let renderedAssetKey: string | undefined;
  if (render) {
    const renderResult = await composition.render({ spec, format });
    renderedAssetKey = renderResult.assetKey;
  }

  // ── Step 5: assemble mockup ───────────────────────────────────────────────

  const now = new Date();
  return {
    id:               randomUUID(),
    conceptId:        concept.id,
    viewAngle,
    format,
    widthPx,
    heightPx,
    layers:           normalisedLayers,
    renderedAssetKey,
    rendered:         renderedAssetKey !== undefined,
    disclaimer:       CONCEPT_DISCLAIMER,
    createdAt:        now,
    updatedAt:        now,
  };
}

/**
 * Builds a CompositionSpec without calling any port.
 * Useful for previewing the planned layer order before committing to render.
 */
export function buildCompositionSpec(
  concept: ProductConcept,
  layers: ReturnType<typeof Array.prototype.slice>,
  options: Pick<ComposeMockupOptions, "viewAngle" | "widthPx" | "heightPx" | "backgroundColor">,
): CompositionSpec {
  const sorted = [...layers as typeof layers].sort((a, b) => a.zIndex - b.zIndex);
  return {
    conceptId:       concept.id,
    viewAngle:       options.viewAngle,
    widthPx:         options.widthPx,
    heightPx:        options.heightPx,
    layers:          sorted,
    backgroundColor: options.backgroundColor ?? "#FFFFFF",
    finalised:       false,
  };
}
