/**
 * product-design — Null Blueprint Port (test stub)
 *
 * Returns a deterministic layer stack from a concept without any real
 * blueprint engine. Used in unit tests and local development.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { BlueprintPort, BlueprintGenerateInput, BlueprintGenerateResult } from "../../types/ports";
import type { MockupLayer } from "../../types/mockup";
import { LAYER_ZINDEX } from "../../types/mockup";

export class NullBlueprintPort implements BlueprintPort {
  /** All calls recorded for test assertions. */
  readonly calls: BlueprintGenerateInput[] = [];

  async generateLayers(input: BlueprintGenerateInput): Promise<BlueprintGenerateResult> {
    this.calls.push(input);

    const { concept } = input;

    // Build a minimal but representative layer stack from the concept
    const layers: MockupLayer[] = [
      {
        id:        `${concept.id}-background`,
        type:      "background",
        label:     "Background",
        zIndex:    LAYER_ZINDEX.background,
        opacity:   1,
        visible:   true,
      },
      {
        id:        `${concept.id}-shadow`,
        type:      "shadow",
        label:     "Drop Shadow",
        zIndex:    LAYER_ZINDEX.shadow,
        opacity:   0.35,
        visible:   true,
      },
      {
        id:        `${concept.id}-form`,
        type:      "form_silhouette",
        label:     `${concept.formDirection.category} silhouette`,
        zIndex:    LAYER_ZINDEX.form_silhouette,
        opacity:   1,
        visible:   true,
      },
    ];

    // One CMF overlay per CMF entry
    concept.cmf.entries.forEach((entry, i) => {
      layers.push({
        id:        `${concept.id}-cmf-${i}`,
        type:      "cmf_overlay",
        label:     `CMF: ${entry.zone} (${entry.colorName})`,
        zIndex:    LAYER_ZINDEX.cmf_overlay + i,
        opacity:   1,
        sourceRef: entry.zone,
        visible:   true,
      });
    });

    // One label layer per label area
    concept.labelAreas.forEach((la, i) => {
      layers.push({
        id:        `${concept.id}-label-${la.id}`,
        type:      "label",
        label:     `Label: ${la.name}`,
        zIndex:    LAYER_ZINDEX.label + i,
        opacity:   1,
        sourceRef: la.id,
        visible:   true,
      });
    });

    // One feature layer per feature placement
    concept.featurePlacements.forEach((fp, i) => {
      layers.push({
        id:        `${concept.id}-feature-${fp.id}`,
        type:      "feature",
        label:     `Feature: ${fp.label}`,
        zIndex:    LAYER_ZINDEX.feature + i,
        opacity:   1,
        sourceRef: fp.id,
        visible:   true,
      });
    });

    return {
      layers,
      backgroundColor: "#F8F8F8",
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  reset(): void {
    this.calls.length = 0;
  }
}
