/**
 * product-design — Mockup & Composition Types
 *
 * Describes the layered composition spec that drives the blueprint
 * and composition engine ports. A mockup is a concept-stage visual
 * reference, NOT a photorealistic render or production asset.
 *
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

export type LayerType =
  | "background"
  | "form_silhouette"
  | "cmf_overlay"
  | "feature"
  | "label"
  | "annotation"
  | "shadow";

export type MockupFormat = "png" | "svg" | "pdf" | "jpg";

export type ViewAngle =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "isometric_left"
  | "isometric_right";

// ── Layer ──────────────────────────────────────────────────────────────────────

export interface MockupLayer {
  /** Unique id within the composition. */
  id: string;
  type: LayerType;
  /** Display label for design tools. */
  label: string;
  /** z-order: higher numbers render on top. */
  zIndex: number;
  /** Opacity 0–1. */
  opacity: number;
  /** Source entity this layer visualises (featurePlacement.id, labelArea.id, CMF zone). */
  sourceRef?: string;
  visible: boolean;
  /**
   * Object-storage asset key for the raster/vector asset backing this layer.
   * Injected by the composition port after rendering; null until rendered.
   */
  assetKey?: string;
}

// ── Composition Spec ───────────────────────────────────────────────────────────

export interface CompositionSpec {
  /** Concept being composed. */
  conceptId: string;
  viewAngle: ViewAngle;
  /** Canvas width in pixels. */
  widthPx: number;
  /** Canvas height in pixels. */
  heightPx: number;
  /** Ordered layers from bottom (index 0) to top. */
  layers: MockupLayer[];
  /** Background fill color as a hex string (e.g. "#FFFFFF"). */
  backgroundColor: string;
  /**
   * True once all layers are confirmed and the spec is ready for rendering.
   * A non-finalised spec should not be sent to the composition port.
   */
  finalised: boolean;
}

// ── Product Mockup ─────────────────────────────────────────────────────────────

export interface ProductMockup {
  id: string;
  conceptId: string;
  viewAngle: ViewAngle;
  format: MockupFormat;
  widthPx: number;
  heightPx: number;
  layers: MockupLayer[];
  /** Asset key returned by composition port after rendering; null until rendered. */
  renderedAssetKey?: string;
  /** Whether a rendered asset is currently available. */
  rendered: boolean;
  /**
   * Mandatory disclaimer on every mockup output.
   * Must not be stripped before delivery to clients.
   */
  disclaimer: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Layer z-index canonical order ─────────────────────────────────────────────

export const LAYER_ZINDEX: Record<LayerType, number> = {
  background: 0,
  shadow: 10,
  form_silhouette: 20,
  cmf_overlay: 30,
  label: 40,
  feature: 50,
  annotation: 60,
};
