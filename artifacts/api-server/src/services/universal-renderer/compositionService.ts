/**
 * compositionService — Universal Renderer Team 14
 *
 * Produces and validates an "editable composition JSON" — a serialisable
 * description of a rendered design that can be re-imported into the
 * canvas editor for further editing.
 *
 * Schema contract:
 *   - version: "1.0"
 *   - kind: "universal-composition"
 *   - canvas: { width, height }
 *   - layers: ordered array of layer descriptors
 *   - metadata: render provenance
 */

import { RenderError } from "./errors.js";
import { computeChecksum } from "./checksumService.js";

export interface CompositionLayer {
  id: string;
  kind: "svg" | "image" | "text" | "pdf-page" | "group";
  label?: string;
  zIndex: number;
  visible: boolean;
  /** Bounding box in canvas pixels */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Layer-specific data (SVG string, URL, text content, etc.) */
  data: Record<string, unknown>;
}

export interface CompositionDocument {
  version: "1.0";
  kind:    "universal-composition";
  id:      string;
  canvas: {
    width:  number;
    height: number;
    background?: string;
  };
  layers:   CompositionLayer[];
  metadata: {
    createdAt:    string;
    renderedBy:   string;
    checksum:     string;
    sourceFormat: string;
  };
}

export interface BuildCompositionInput {
  id:     string;
  canvas: { width: number; height: number; background?: string };
  layers: Omit<CompositionLayer, "id">[];
  sourceFormat: string;
}

const MAX_LAYERS = 200;

/**
 * Build a CompositionDocument from a set of layers.
 * Validates structure, assigns stable IDs, computes checksum.
 */
export function buildComposition(input: BuildCompositionInput): {
  composition: CompositionDocument;
  json:        string;
  checksum:    string;
} {
  if (!input.id || input.id.trim().length === 0) {
    throw new RenderError("COMPOSITION_INVALID", "Composition id must be non-empty");
  }
  if (input.canvas.width < 1 || input.canvas.height < 1) {
    throw new RenderError("COMPOSITION_INVALID", "Canvas dimensions must be ≥ 1×1");
  }
  if (input.layers.length === 0) {
    throw new RenderError("COMPOSITION_INVALID", "Composition must contain at least one layer");
  }
  if (input.layers.length > MAX_LAYERS) {
    throw new RenderError("COMPOSITION_INVALID", `Layer count ${input.layers.length} exceeds maximum ${MAX_LAYERS}`);
  }

  const layers: CompositionLayer[] = input.layers.map((l, i) => ({
    ...l,
    id: `layer-${i}-${l.kind}`,
  }));

  const composition: CompositionDocument = {
    version: "1.0",
    kind:    "universal-composition",
    id:      input.id,
    canvas:  input.canvas,
    layers,
    metadata: {
      createdAt:    new Date().toISOString(),
      renderedBy:   "Creative AI Studio — Universal Renderer v1",
      checksum:     "", // filled below
      sourceFormat: input.sourceFormat,
    },
  };

  const json     = JSON.stringify(composition, null, 2);
  const checksum = computeChecksum(Buffer.from(json, "utf8"));
  composition.metadata.checksum = checksum;

  return { composition, json: JSON.stringify(composition, null, 2), checksum };
}

/**
 * Validate a composition JSON string and return the parsed document.
 * Throws COMPOSITION_INVALID if the structure is not valid.
 */
export function parseComposition(raw: string): CompositionDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RenderError("COMPOSITION_INVALID", "Composition JSON is not valid JSON");
  }

  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as Record<string, unknown>)["version"] !== "1.0" ||
    (parsed as Record<string, unknown>)["kind"]    !== "universal-composition"
  ) {
    throw new RenderError("COMPOSITION_INVALID", "Document is not a valid universal-composition v1.0");
  }

  return parsed as CompositionDocument;
}
