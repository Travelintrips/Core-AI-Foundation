/**
 * product-design — Port Interfaces
 *
 * Pure interfaces for the blueprint and composition engine ports.
 * The domain NEVER imports concrete infrastructure classes.
 * Tests use null implementations; Team 24 wires real adapters at mount time.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { MockupFormat, MockupLayer, ViewAngle, CompositionSpec } from "./mockup";
import type { ProductConcept } from "./concept";

// ── Blueprint Port ─────────────────────────────────────────────────────────────

export interface BlueprintGenerateInput {
  concept: ProductConcept;
  viewAngle: ViewAngle;
  widthPx: number;
  heightPx: number;
}

export interface BlueprintGenerateResult {
  /** Ordered layers (bottom to top) derived from the concept definition. */
  layers: MockupLayer[];
  /** Recommended canvas background color as a hex string. */
  backgroundColor: string;
}

/**
 * BlueprintPort — assembles an ordered layer stack from a concept.
 * Does NOT perform pixel rendering — layer assembly only.
 */
export interface BlueprintPort {
  generateLayers(input: BlueprintGenerateInput): Promise<BlueprintGenerateResult>;
  isHealthy(): Promise<boolean>;
}

// ── Composition Port ───────────────────────────────────────────────────────────

export interface CompositionRenderInput {
  spec: CompositionSpec;
  format: MockupFormat;
}

export interface CompositionRenderResult {
  /** Object-storage key for the rendered asset. */
  assetKey: string;
  widthPx: number;
  heightPx: number;
  mimeType: string;
}

/**
 * CompositionPort — renders a finalised CompositionSpec to a raster/vector asset.
 * Stores the result in object storage and returns the asset key.
 */
export interface CompositionPort {
  render(input: CompositionRenderInput): Promise<CompositionRenderResult>;
  isHealthy(): Promise<boolean>;
}

// ── Port Registry ──────────────────────────────────────────────────────────────

export interface ProductDesignPortRegistry {
  blueprint: BlueprintPort;
  composition: CompositionPort;
}
