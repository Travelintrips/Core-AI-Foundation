/**
 * compositionService.test.ts — Team 14
 */

import { describe, it, expect } from "vitest";
import { buildComposition, parseComposition } from "../compositionService.js";
import { RenderError } from "../errors.js";

const BASE_LAYER = {
  kind:    "svg" as const,
  label:   "Test layer",
  zIndex:  0,
  visible: true,
  bounds:  { x: 0, y: 0, width: 100, height: 100 },
  data:    { svgContent: "<svg/>" },
};

describe("buildComposition", () => {
  it("produces a valid CompositionDocument", () => {
    const { composition } = buildComposition({
      id:           "test-001",
      canvas:       { width: 1920, height: 1080 },
      layers:       [BASE_LAYER],
      sourceFormat: "svg",
    });
    expect(composition.version).toBe("1.0");
    expect(composition.kind).toBe("universal-composition");
    expect(composition.layers).toHaveLength(1);
    expect(composition.canvas).toMatchObject({ width: 1920, height: 1080 });
  });

  it("includes a non-empty checksum in metadata", () => {
    const { checksum, composition } = buildComposition({
      id:           "test-002",
      canvas:       { width: 800, height: 600 },
      layers:       [BASE_LAYER],
      sourceFormat: "svg",
    });
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(composition.metadata.checksum).toBe(checksum);
  });

  it("assigns stable layer IDs", () => {
    const { composition } = buildComposition({
      id:           "test-003",
      canvas:       { width: 100, height: 100 },
      layers:       [BASE_LAYER, { ...BASE_LAYER, kind: "image", zIndex: 1 }],
      sourceFormat: "svg",
    });
    expect(composition.layers[0]!.id).toBe("layer-0-svg");
    expect(composition.layers[1]!.id).toBe("layer-1-image");
  });

  it("throws COMPOSITION_INVALID for empty layers", () => {
    expect(() =>
      buildComposition({ id: "x", canvas: { width: 1, height: 1 }, layers: [], sourceFormat: "svg" }),
    ).toThrow(RenderError);
    expect(() =>
      buildComposition({ id: "x", canvas: { width: 1, height: 1 }, layers: [], sourceFormat: "svg" }),
    ).toThrowError(expect.objectContaining({ code: "COMPOSITION_INVALID" }));
  });

  it("throws COMPOSITION_INVALID for canvas width < 1", () => {
    expect(() =>
      buildComposition({ id: "x", canvas: { width: 0, height: 100 }, layers: [BASE_LAYER], sourceFormat: "svg" }),
    ).toThrowError(expect.objectContaining({ code: "COMPOSITION_INVALID" }));
  });

  it("throws COMPOSITION_INVALID for empty id", () => {
    expect(() =>
      buildComposition({ id: "  ", canvas: { width: 1, height: 1 }, layers: [BASE_LAYER], sourceFormat: "svg" }),
    ).toThrowError(expect.objectContaining({ code: "COMPOSITION_INVALID" }));
  });
});

describe("parseComposition", () => {
  it("round-trips a built composition", () => {
    const { json } = buildComposition({
      id:           "rt-001",
      canvas:       { width: 100, height: 100 },
      layers:       [BASE_LAYER],
      sourceFormat: "svg",
    });
    const parsed = parseComposition(json);
    expect(parsed.id).toBe("rt-001");
    expect(parsed.layers).toHaveLength(1);
  });

  it("throws COMPOSITION_INVALID for invalid JSON", () => {
    expect(() => parseComposition("not json {{")).toThrow(RenderError);
  });

  it("throws COMPOSITION_INVALID for wrong version", () => {
    const bad = JSON.stringify({ version: "2.0", kind: "universal-composition" });
    expect(() => parseComposition(bad)).toThrowError(expect.objectContaining({ code: "COMPOSITION_INVALID" }));
  });
});
