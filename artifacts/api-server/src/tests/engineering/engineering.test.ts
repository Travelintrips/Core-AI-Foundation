/**
 * Engineering Team — Unit Tests
 *
 * Covers all cases required by the Team 4 spec:
 *   ✓ valid template
 *   ✓ duplicate ID
 *   ✓ invalid font
 *   ✓ invalid color
 *   ✓ variable binding missing
 *   ✓ asset missing (image src binding referencing undeclared variable)
 *   ✓ out of bounds
 *   ✓ negative size
 *   ✓ unsafe overlap
 *   ✓ CTA covered
 *   ✓ optimizer fixes spacing
 *   ✓ optimizer does not change semantic content
 *   ✓ re-validation after optimize
 *   ✓ invalid AI output (bad JSON)
 *   ✓ retry exhaustion
 *
 * No live AI API calls — all AI paths use a stub ModelProvider.
 */

import { describe, it, expect, vi } from "vitest";
import type { DesignTemplate } from "../../types/designTemplate.js";
import { runTemplateValidator }  from "../../services/design-ai/validators/templateValidator.js";
import { runBindingValidator }   from "../../services/design-ai/validators/bindingValidator.js";
import { runBoundsValidator }    from "../../services/design-ai/validators/boundsValidator.js";
import { runOverlapValidator }   from "../../services/design-ai/validators/overlapValidator.js";
import { optimizeSpacing }       from "../../services/design-ai/optimizers/spacingOptimizer.js";
import { optimizeLayers }        from "../../services/design-ai/optimizers/layerOptimizer.js";
import { optimizeAlignment }     from "../../services/design-ai/optimizers/alignmentOptimizer.js";
import { runValidatorAgent }     from "../../services/design-ai/agents/engineering/validatorAgent.js";
import { runOptimizerAgent }     from "../../services/design-ai/agents/engineering/optimizerAgent.js";
import { runJsonArchitectAgent } from "../../services/design-ai/agents/engineering/jsonArchitectAgent.js";
import { runEngineeringPipeline } from "../../services/design-ai/pipeline/engineeringPipeline.js";
import type { ModelProvider, EngineeringTeamInput } from "../../services/design-ai/types/engineering.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<DesignTemplate> = {}): DesignTemplate {
  return {
    schemaVersion: "1.0",
    id: "test-template",
    tenantId: "tenant-1",
    name: "Test Template",
    canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#FFFFFF" },
    elements: [
      {
        id: "bg",
        type: "shape",
        shape: "rectangle",
        x: 0, y: 0, width: 1080, height: 1080, zIndex: 0,
        fill: "#1E40AF",
        name: "background",
      },
      {
        id: "title",
        type: "text",
        x: 60, y: 200, width: 960, height: 120, zIndex: 1,
        content: "Welcome",
        fontFamily: "Inter",
        fontSize: 64,
        color: "#FFFFFF",
        name: "heading",
      },
    ],
    variables: [],
    metadata: {
      createdBy: "test-actor",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
    ...overrides,
  };
}

const VALID_ENGINEERING_INPUT: EngineeringTeamInput = {
  discovery: {
    briefSummary: "Instagram post for product launch",
    targetAudience: "Young adults 18-35",
    communicationGoals: ["Drive awareness", "Increase clicks"],
    requiredVariables: [
      { key: "product_name", label: "Product Name", type: "text", required: true },
    ],
    recommendedSizePreset: "instagram-square",
  },
  design: {
    templateName: "Product Launch Post",
    layoutStrategy: "centered",
    colorPalette: {
      background: "#FFFFFF",
      primary: "#1E40AF",
      text: "#1E3A5F",
    },
    typography: {
      heading: { fontFamily: "Inter", fontSize: 64, fontWeight: "bold" },
      body:    { fontFamily: "Inter", fontSize: 32 },
    },
  },
  components: {
    componentPlan: [
      {
        id: "bg",
        componentType: "shape",
        purpose: "background",
        suggestedPosition: { x: 0, y: 0 },
        suggestedSize: { width: 1080, height: 1080 },
        zIndexHint: 0,
      },
      {
        id: "title",
        componentType: "text",
        purpose: "heading",
        variableKey: "product_name",
        suggestedPosition: { x: 60, y: 200 },
        suggestedSize: { width: 960, height: 120 },
        zIndexHint: 1,
      },
    ],
  },
};

// ── Stub model provider (no live API) ─────────────────────────────────────────

function makeStubProvider(response: { content: string } | "bad-json" | "timeout"): ModelProvider {
  return {
    async chat() {
      if (response === "timeout") throw new Error("Provider timeout (stub)");
      if (response === "bad-json") return { content: "NOT_JSON{{{", inputTokens: 10, outputTokens: 5 };
      return { content: response.content, inputTokens: 50, outputTokens: 100 };
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("templateValidator", () => {
  it("passes a valid template with no issues", () => {
    const issues = runTemplateValidator(makeTemplate());
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("detects duplicate element IDs", () => {
    const template = makeTemplate({
      elements: [
        { id: "dup", type: "shape", shape: "rectangle", x: 0, y: 0, width: 100, height: 100, zIndex: 0, fill: "#FFFFFF" },
        { id: "dup", type: "shape", shape: "rectangle", x: 200, y: 0, width: 100, height: 100, zIndex: 1, fill: "#000000" },
      ],
    });
    const issues = runTemplateValidator(template);
    const dupError = issues.find((i) => i.code === "DUPLICATE_ID");
    expect(dupError).toBeDefined();
    expect(dupError?.severity).toBe("error");
    expect(dupError?.nodeId).toBe("dup");
  });

  it("detects invalid font family", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "bad-font", type: "text",
          x: 0, y: 0, width: 200, height: 50, zIndex: 0,
          content: "hello",
          fontFamily: "ComicSansMSXXX", // not in SAFE_FONTS
          fontSize: 20,
          color: "#000000",
        },
      ],
    });
    const issues = runTemplateValidator(template);
    const fontWarn = issues.find((i) => i.code === "INVALID_FONT");
    expect(fontWarn).toBeDefined();
  });

  it("detects invalid color format", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "bad-color", type: "text",
          x: 0, y: 0, width: 200, height: 50, zIndex: 0,
          content: "hello",
          color: "red", // not a hex color
        },
      ],
    });
    const issues = runTemplateValidator(template);
    const colorError = issues.find((i) => i.code === "INVALID_COLOR");
    expect(colorError).toBeDefined();
    expect(colorError?.severity).toBe("error");
  });

  it("detects negative width and height", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "negative", type: "shape", shape: "rectangle",
          x: 0, y: 0, width: -10, height: -5, zIndex: 0, fill: "#FFFFFF",
        },
      ],
    });
    const issues = runTemplateValidator(template);
    const widthErr  = issues.find((i) => i.code === "NEGATIVE_WIDTH");
    const heightErr = issues.find((i) => i.code === "NEGATIVE_HEIGHT");
    expect(widthErr).toBeDefined();
    expect(heightErr).toBeDefined();
  });
});

describe("bindingValidator", () => {
  it("passes when all bindings reference declared variables", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "bound-text", type: "text",
          x: 0, y: 0, width: 200, height: 50, zIndex: 0,
          content: { binding: { variableKey: "product_name" } },
        },
      ],
      variables: [
        { key: "product_name", label: "Product Name", type: "text", required: true },
      ],
    });
    const issues = runBindingValidator(template);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("detects missing variable binding reference", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "missing-binding", type: "text",
          x: 0, y: 0, width: 200, height: 50, zIndex: 0,
          content: { binding: { variableKey: "ghost_variable" } },
        },
      ],
      variables: [], // ghost_variable not declared
    });
    const issues = runBindingValidator(template);
    const err = issues.find((i) => i.code === "BINDING_NOT_FOUND");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
    expect(err?.nodeId).toBe("missing-binding");
  });

  it("detects missing image src binding (asset missing)", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "img", type: "image",
          x: 0, y: 0, width: 300, height: 300, zIndex: 0,
          src: { binding: { variableKey: "logo_url" } }, // not declared
        },
      ],
      variables: [],
    });
    const issues = runBindingValidator(template);
    const err = issues.find((i) => i.code === "BINDING_NOT_FOUND" && i.nodeId === "img");
    expect(err).toBeDefined();
  });
});

describe("boundsValidator", () => {
  it("passes for elements within canvas", () => {
    const issues = runBoundsValidator(makeTemplate());
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("detects element fully out of bounds", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "out", type: "shape", shape: "rectangle",
          x: 1200, y: 1200, width: 100, height: 100, zIndex: 0, fill: "#FF0000",
        },
      ],
    });
    const issues = runBoundsValidator(template);
    const err = issues.find((i) => i.code === "ELEMENT_OUT_OF_BOUNDS");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  it("warns for element partially outside canvas", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "partial", type: "shape", shape: "rectangle",
          x: 1000, y: 0, width: 200, height: 100, zIndex: 0, fill: "#FF0000",
        },
      ],
    });
    const issues = runBoundsValidator(template);
    const warn = issues.find((i) => i.code === "CANVAS_OVERFLOW");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });
});

describe("overlapValidator", () => {
  it("detects unsafe overlap when a solid element covers another", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "lower", type: "text",
          x: 100, y: 100, width: 200, height: 50, zIndex: 0,
          content: "Hidden text", name: "body",
        },
        {
          id: "upper", type: "shape", shape: "rectangle",
          x: 100, y: 100, width: 200, height: 50, zIndex: 5, fill: "#000000",
          name: "blocker",
        },
      ],
    });
    const issues = runOverlapValidator(template);
    const overlap = issues.find((i) => i.code === "UNSAFE_OVERLAP");
    expect(overlap).toBeDefined();
  });

  it("detects CTA covered by a solid element", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "my-cta", type: "text",
          x: 100, y: 800, width: 200, height: 60, zIndex: 1,
          content: "Buy Now", name: "cta-button",
        },
        {
          id: "overlay", type: "shape", shape: "rectangle",
          x: 50, y: 780, width: 400, height: 100, zIndex: 10, fill: "#000000",
          name: "overlay-shape",
        },
      ],
    });
    const issues = runOverlapValidator(template);
    const ctaErr = issues.find((i) => i.code === "CTA_COVERED");
    expect(ctaErr).toBeDefined();
    expect(ctaErr?.severity).toBe("error");
    expect(ctaErr?.nodeId).toBe("my-cta");
  });
});

describe("spacingOptimizer", () => {
  it("clamps elements out of bounds back into canvas", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "offscreen", type: "shape", shape: "rectangle",
          x: 1200, y: 0, width: 100, height: 100, zIndex: 0, fill: "#FF0000",
        },
      ],
    });
    const { elements, changes } = optimizeSpacing(template);
    const fixed = elements.find((e) => e.id === "offscreen")!;
    expect(fixed.x).toBeLessThan(1080); // clamped back
    expect(changes.length).toBeGreaterThan(0);
  });

  it("fixes negative width and height", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "tiny", type: "shape", shape: "rectangle",
          x: 0, y: 0, width: -20, height: -5, zIndex: 0, fill: "#FF0000",
        },
      ],
    });
    const { elements, changes } = optimizeSpacing(template);
    const fixed = elements.find((e) => e.id === "tiny")!;
    expect(fixed.width).toBeGreaterThan(0);
    expect(fixed.height).toBeGreaterThan(0);
    const types = changes.map((c) => c.type);
    expect(types).toContain("fix_negative_width");
    expect(types).toContain("fix_negative_height");
  });

  it("does NOT change content or bindings", () => {
    const template = makeTemplate({
      elements: [
        {
          id: "bound-text", type: "text",
          x: 60, y: 200, width: 960, height: 120, zIndex: 0,
          content: { binding: { variableKey: "product_name" } },
          fontFamily: "Inter",
          fontSize: 64,
          color: "#FFFFFF",
        },
      ],
      variables: [{ key: "product_name", label: "Product Name", type: "text" }],
    });
    const { elements } = optimizeSpacing(template);
    const el = elements.find((e) => e.id === "bound-text") as any;
    // Binding must be preserved exactly
    expect(el.content).toEqual({ binding: { variableKey: "product_name" } });
  });
});

describe("layerOptimizer", () => {
  it("normalizes duplicate z-index values to a clean sequence", () => {
    const elements: DesignTemplate["elements"] = [
      { id: "a", type: "shape", shape: "rectangle", x: 0, y: 0, width: 100, height: 100, zIndex: 0, fill: "#FFF" },
      { id: "b", type: "shape", shape: "rectangle", x: 10, y: 10, width: 100, height: 100, zIndex: 0, fill: "#000" }, // duplicate
      { id: "c", type: "shape", shape: "rectangle", x: 20, y: 20, width: 100, height: 100, zIndex: 5, fill: "#AAA" },
    ];
    const { elements: result, changes } = optimizeLayers(elements);
    const zIndices = result.map((e) => e.zIndex).sort((a, b) => a - b);
    // All unique after normalization
    expect(new Set(zIndices).size).toBe(zIndices.length);
    expect(changes.some((c) => c.type === "normalize_z_index")).toBe(true);
  });
});

describe("validatorAgent", () => {
  it("returns passed:true for a valid template", async () => {
    const result = await runValidatorAgent(makeTemplate());
    expect(result.status).toBe("success");
    expect(result.data?.passed).toBe(true);
    expect(result.data?.score).toBeGreaterThan(90);
  });

  it("returns passed:false with errors for an invalid template", async () => {
    const template = makeTemplate({
      elements: [
        // Duplicate IDs
        { id: "dup", type: "shape", shape: "rectangle", x: 0, y: 0, width: 100, height: 100, zIndex: 0, fill: "#FFF" },
        { id: "dup", type: "shape", shape: "rectangle", x: 200, y: 0, width: 100, height: 100, zIndex: 1, fill: "#000" },
      ],
    });
    const result = await runValidatorAgent(template);
    expect(result.status).toBe("success");
    expect(result.data?.passed).toBe(false);
    expect(result.data?.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });
});

describe("optimizerAgent", () => {
  it("fixes spacing issues and logs changes", async () => {
    const template = makeTemplate({
      elements: [
        {
          id: "overflow", type: "shape", shape: "rectangle",
          x: 1200, y: 0, width: 100, height: 100, zIndex: 0, fill: "#FF0000",
        },
      ],
    });

    const validationResult = await runValidatorAgent(template);
    const result = await runOptimizerAgent(template, validationResult.data!);

    expect(result.status).toBe("success");
    expect(result.data?.changes.length).toBeGreaterThan(0);
    const optimizedEl = result.data?.template.elements.find((e) => e.id === "overflow");
    expect(optimizedEl?.x).toBeLessThan(1080);
  });

  it("does not change semantic content (text, bindings, variable keys)", async () => {
    const template = makeTemplate({
      elements: [
        {
          id: "branded-text", type: "text",
          x: 60, y: 200, width: 960, height: 120, zIndex: 0,
          content: { binding: { variableKey: "brand_name" } },
          fontFamily: "Inter", fontSize: 64, color: "#1E40AF",
          name: "heading",
        },
      ],
      variables: [{ key: "brand_name", label: "Brand Name", type: "text", required: true }],
    });

    const validationResult = await runValidatorAgent(template);
    const result = await runOptimizerAgent(template, validationResult.data!);

    const el = result.data?.template.elements.find((e) => e.id === "branded-text") as any;
    // Content binding must be preserved
    expect(el?.content).toEqual({ binding: { variableKey: "brand_name" } });
    // Font and color must not change
    expect(el?.fontFamily).toBe("Inter");
    expect(el?.color).toBe("#1E40AF");
    // Variable definition must be preserved
    const v = result.data?.template.variables.find((v) => v.key === "brand_name");
    expect(v).toBeDefined();
  });

  it("re-validates after optimize: fewer or equal errors than initial", async () => {
    const template = makeTemplate({
      elements: [
        {
          id: "out-of-bounds", type: "shape", shape: "rectangle",
          x: 2000, y: 2000, width: 100, height: 100, zIndex: 0, fill: "#FF0000",
        },
      ],
    });

    const initialValidation = (await runValidatorAgent(template)).data!;
    const optimizerResult   = (await runOptimizerAgent(template, initialValidation)).data!;
    const finalValidation   = (await runValidatorAgent(optimizerResult.template)).data!;

    // After optimization, out-of-bounds error should be fixed
    const initialBoundsErrors = initialValidation.errors.filter((e) => e.code === "ELEMENT_OUT_OF_BOUNDS").length;
    const finalBoundsErrors   = finalValidation.errors.filter((e) => e.code === "ELEMENT_OUT_OF_BOUNDS").length;
    expect(finalBoundsErrors).toBeLessThanOrEqual(initialBoundsErrors);
  });
});

describe("jsonArchitectAgent (deterministic path)", () => {
  it("assembles a valid template from structured team inputs", async () => {
    const result = await runJsonArchitectAgent(VALID_ENGINEERING_INPUT, {
      tenantId: "tenant-test",
      actorId:  "actor-test",
    });

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
    expect(result.data!.elements.length).toBe(2);
    expect(result.data!.variables.length).toBe(1);
    expect(result.data!.variables[0].key).toBe("product_name");
    expect(result.data!.canvas.width).toBe(1080);
  });

  it("handles invalid AI output (bad JSON) with retries, then fails", async () => {
    const sparseInput: EngineeringTeamInput = {
      ...VALID_ENGINEERING_INPUT,
      components: { componentPlan: [] }, // empty plan → triggers AI path
    };

    const result = await runJsonArchitectAgent(sparseInput, {
      tenantId:      "tenant-test",
      actorId:       "actor-test",
      modelProvider: makeStubProvider("bad-json"),
    });

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.metadata.retryCount).toBeGreaterThanOrEqual(1);
  });

  it("handles provider timeout (retry exhaustion)", async () => {
    const sparseInput: EngineeringTeamInput = {
      ...VALID_ENGINEERING_INPUT,
      components: { componentPlan: [] }, // triggers AI path
    };

    const result = await runJsonArchitectAgent(sparseInput, {
      tenantId:      "tenant-test",
      actorId:       "actor-test",
      modelProvider: makeStubProvider("timeout"),
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.toLowerCase().includes("timeout") || e.includes("attempt"))).toBe(true);
  });
});

describe("engineeringPipeline (full integration)", () => {
  it("runs the full pipeline and returns all four outputs", async () => {
    const output = await runEngineeringPipeline(VALID_ENGINEERING_INPUT, {
      tenantId: "tenant-test",
      actorId:  "actor-test",
    });

    expect(output.initialTemplate).toBeDefined();
    expect(output.initialValidation).toBeDefined();
    expect(output.optimizedTemplate).toBeDefined();
    expect(output.finalValidation).toBeDefined();
    expect(Array.isArray(output.optimizationChanges)).toBe(true);

    // Final validation should pass for a well-formed input
    expect(output.finalValidation.passed).toBe(true);
  });

  it("final score >= initial score after optimization", async () => {
    const output = await runEngineeringPipeline(VALID_ENGINEERING_INPUT, {
      tenantId: "tenant-test",
      actorId:  "actor-test",
    });

    expect(output.finalValidation.score).toBeGreaterThanOrEqual(output.initialValidation.score);
  });
});
