/**
 * Team 3 — Component Pipeline Unit Tests
 *
 * Coverage:
 *   - component ID uniqueness
 *   - variable binding to components
 *   - price currency formatting
 *   - phone validation pattern
 *   - asset aspect ratio format
 *   - logo placeholder creation
 *   - missing / unknown component references
 *   - duplicate variable key detection
 *   - component region out-of-canvas detection
 *   - section without component (warning path)
 *   - invalid AI JSON → retry behaviour
 *   - retry count tracking
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ComponentTeamInput,
  ComponentPlan,
  VariablePlan,
  AssetPlan,
  ComponentTeamOutput,
} from "../../types/component-plan.types.js";

// ─── Hoist mockCreate so it's available inside vi.mock factory ───────────────

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockOpenAI };
});

vi.mock("../../../aiSecretService.js", () => ({
  getProviderApiKey: vi.fn().mockReturnValue("test-api-key"),
}));

vi.mock("../../../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CANVAS_W = 1080;
const CANVAS_H = 1080;

const mockInput: ComponentTeamInput = {
  discovery: {
    category: "restaurant",
    industry: "F&B",
    objective: "Promote daily menu specials",
    brandName: "Warung Nusantara",
    keyMessages: ["Fresh ingredients", "Affordable price"],
  },
  design: {
    style: "bold-modern",
    colorPalette: ["#FF5733", "#FFFFFF"],
    fontPrimary: "Poppins",
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    sections: [
      { id: "hero", name: "Hero", order: 1, purpose: "Brand introduction" },
      { id: "product", name: "Product Showcase", order: 2, purpose: "Menu item highlight" },
      { id: "footer", name: "Footer", order: 3, purpose: "Contact info" },
    ],
  },
};

const validComponentPlan: ComponentPlan = {
  components: [
    {
      id: "hero-background",
      sectionId: "hero",
      type: "background",
      role: "Hero background",
      required: true,
      contentSource: "asset",
      region: { x: 0, y: 0, width: 1080, height: 400 },
      layerRole: "background",
      properties: {},
    },
    {
      id: "hero-logo",
      sectionId: "hero",
      type: "logo",
      role: "Brand logo",
      required: true,
      contentSource: "asset",
      region: { x: 40, y: 20, width: 200, height: 80 },
      layerRole: "foreground",
      properties: {},
    },
    {
      id: "hero-title",
      sectionId: "hero",
      type: "title",
      role: "Main headline",
      required: true,
      contentSource: "variable",
      bindingKey: "brand_name",
      region: { x: 40, y: 120, width: 700, height: 80 },
      layerRole: "content",
      properties: { fontSize: 56 },
    },
    {
      id: "product-image",
      sectionId: "product",
      type: "image_placeholder",
      role: "Product photo",
      required: true,
      contentSource: "asset",
      region: { x: 0, y: 400, width: 540, height: 400 },
      layerRole: "content",
      properties: {},
    },
    {
      id: "product-name",
      sectionId: "product",
      type: "title",
      role: "Menu item name",
      required: true,
      contentSource: "variable",
      bindingKey: "menu_name",
      region: { x: 560, y: 420, width: 480, height: 60 },
      layerRole: "content",
      properties: {},
    },
    {
      id: "product-price",
      sectionId: "product",
      type: "price",
      role: "Menu item price",
      required: true,
      contentSource: "variable",
      bindingKey: "price",
      region: { x: 560, y: 500, width: 480, height: 60 },
      layerRole: "content",
      properties: {},
    },
    {
      id: "footer-phone",
      sectionId: "footer",
      type: "contact_information",
      role: "Phone number",
      required: false,
      contentSource: "variable",
      bindingKey: "phone",
      region: { x: 40, y: 900, width: 400, height: 40 },
      layerRole: "content",
      properties: {},
    },
    {
      id: "footer-cta",
      sectionId: "footer",
      type: "cta",
      role: "Call to action button",
      required: true,
      contentSource: "variable",
      bindingKey: "cta_label",
      region: { x: 560, y: 920, width: 480, height: 80 },
      layerRole: "foreground",
      properties: {},
    },
  ],
};

const validVariablePlan: VariablePlan = {
  variables: [
    {
      key: "brand_name",
      label: "Brand Name",
      type: "text",
      required: true,
      defaultValue: "Warung Nusantara",
      placeholder: "Your brand name",
      validation: { maxLength: 60 },
      usedByComponentIds: ["hero-title"],
    },
    {
      key: "menu_name",
      label: "Menu Name",
      type: "text",
      required: true,
      placeholder: "e.g. Nasi Goreng Spesial",
      validation: { maxLength: 80 },
      usedByComponentIds: ["product-name"],
    },
    {
      key: "price",
      label: "Price",
      type: "currency",
      required: true,
      defaultValue: 25000,
      formatting: { locale: "id-ID", currency: "IDR", prefix: "Rp " },
      usedByComponentIds: ["product-price"],
    },
    {
      key: "phone",
      label: "Phone Number",
      type: "phone",
      required: false,
      placeholder: "+62 812-xxxx-xxxx",
      validation: { pattern: "^\\+?[0-9\\s\\-()]{7,20}$" },
      usedByComponentIds: ["footer-phone"],
    },
    {
      key: "cta_label",
      label: "CTA Label",
      type: "text",
      required: true,
      defaultValue: "Pesan Sekarang",
      validation: { maxLength: 30 },
      usedByComponentIds: ["footer-cta"],
    },
  ],
};

const validAssetPlan: AssetPlan = {
  assets: [
    {
      id: "hero-background-asset",
      type: "background",
      componentId: "hero-background",
      purpose: "Atmospheric background for the hero section",
      required: true,
      placeholderLabel: "Hero Background Image",
      dimensions: { width: 1080, height: 400 },
      aspectRatio: "27:10",
      fit: "cover",
      cropFocus: "center",
      acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      visualGuidance: [
        "Use a high-quality food or restaurant atmosphere photo",
        "Minimum 1080px wide",
        "Dark or muted tones work best with light text overlay",
      ],
    },
    {
      id: "hero-logo-asset",
      type: "logo",
      componentId: "hero-logo",
      purpose: "Brand identity mark",
      required: true,
      placeholderLabel: "Brand Logo",
      dimensions: { width: 200, height: 80 },
      aspectRatio: "5:2",
      fit: "contain",
      cropFocus: "center",
      acceptedMimeTypes: ["image/png", "image/svg+xml"],
      visualGuidance: [
        "Use a PNG with transparent background",
        "Minimum 200px wide for sharp rendering",
        "Prefer light or white logo variant for dark backgrounds",
      ],
    },
    {
      id: "product-photo",
      type: "photo",
      componentId: "product-image",
      purpose: "Close-up product or food photo",
      required: true,
      placeholderLabel: "Menu Item Photo",
      dimensions: { width: 540, height: 400 },
      aspectRatio: "27:20",
      fit: "cover",
      cropFocus: "center",
      acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      visualGuidance: [
        "Use a well-lit, appetising photo of the menu item",
        "Shoot from above or 45-degree angle",
        "Avoid busy backgrounds — keep focus on the food",
        "Minimum 540px wide",
      ],
    },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOpenAIResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  };
}

// ─── Schema tests (pure — no AI calls) ───────────────────────────────────────

describe("ComponentPlan schema", () => {
  it("accepts a valid component plan", async () => {
    const { componentPlanSchema } = await import(
      "../../schemas/components/componentBuilderSchema.js"
    );
    const result = componentPlanSchema.safeParse(validComponentPlan);
    expect(result.success).toBe(true);
  });

  it("rejects a component with an unsafe ID (space in ID)", async () => {
    const { componentPlanSchema } = await import(
      "../../schemas/components/componentBuilderSchema.js"
    );
    const bad = {
      components: [{ ...validComponentPlan.components[0], id: "hero background" }],
    };
    const result = componentPlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a component with zero-width region", async () => {
    const { componentPlanSchema } = await import(
      "../../schemas/components/componentBuilderSchema.js"
    );
    const bad = {
      components: [
        { ...validComponentPlan.components[0], region: { x: 0, y: 0, width: 0, height: 400 } },
      ],
    };
    const result = componentPlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("VariablePlan schema", () => {
  it("accepts a valid variable plan", async () => {
    const { variablePlanSchema } = await import(
      "../../schemas/components/variableDesignerSchema.js"
    );
    const result = variablePlanSchema.safeParse(validVariablePlan);
    expect(result.success).toBe(true);
  });

  it("rejects a variable with invalid key (space in key)", async () => {
    const { variablePlanSchema } = await import(
      "../../schemas/components/variableDesignerSchema.js"
    );
    const bad = { variables: [{ ...validVariablePlan.variables[0], key: "bad key!" }] };
    const result = variablePlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("validates price variable has currency formatting", () => {
    const priceVar = validVariablePlan.variables.find((v) => v.key === "price");
    expect(priceVar).toBeDefined();
    expect(priceVar?.type).toBe("currency");
    expect(priceVar?.formatting?.currency).toBeDefined();
  });

  it("validates phone variable has a regex validation pattern", () => {
    const phoneVar = validVariablePlan.variables.find((v) => v.key === "phone");
    expect(phoneVar).toBeDefined();
    expect(phoneVar?.type).toBe("phone");
    expect(phoneVar?.validation?.pattern).toBeDefined();
    expect(() => new RegExp(phoneVar!.validation!.pattern!)).not.toThrow();
  });

  it("rejects a variable with empty usedByComponentIds", async () => {
    const { variablePlanSchema } = await import(
      "../../schemas/components/variableDesignerSchema.js"
    );
    const bad = {
      variables: [{ ...validVariablePlan.variables[0], usedByComponentIds: [] }],
    };
    const result = variablePlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("AssetPlan schema", () => {
  it("accepts a valid asset plan", async () => {
    const { assetPlanSchema } = await import("../../schemas/components/assetPlannerSchema.js");
    const result = assetPlanSchema.safeParse(validAssetPlan);
    expect(result.success).toBe(true);
  });

  it("validates logo placeholder is present and typed correctly", () => {
    const logoAsset = validAssetPlan.assets.find((a) => a.type === "logo");
    expect(logoAsset).toBeDefined();
    expect(logoAsset?.placeholderLabel).toBeTruthy();
    expect(logoAsset?.visualGuidance.length).toBeGreaterThan(0);
  });

  it("validates aspect ratio is in W:H format", async () => {
    const { assetPlanSchema } = await import("../../schemas/components/assetPlannerSchema.js");
    const bad = {
      assets: [{ ...validAssetPlan.assets[0], aspectRatio: "16x9" }],
    };
    const result = assetPlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an asset with zero-height dimension", async () => {
    const { assetPlanSchema } = await import("../../schemas/components/assetPlannerSchema.js");
    const bad = {
      assets: [{ ...validAssetPlan.assets[0], dimensions: { width: 1080, height: 0 } }],
    };
    const result = assetPlanSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ─── Internal validation logic (pure — exercised directly on fixtures) ────────

describe("Pipeline internal validation logic", () => {
  it("detects duplicate component IDs via Set tracking", () => {
    const comps = [
      validComponentPlan.components[0],
      { ...validComponentPlan.components[1], id: validComponentPlan.components[0].id },
    ];
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const c of comps) {
      if (seen.has(c.id)) dups.push(c.id);
      seen.add(c.id);
    }
    expect(dups).toContain(validComponentPlan.components[0].id);
  });

  it("detects duplicate variable keys", () => {
    const vars = [validVariablePlan.variables[0], { ...validVariablePlan.variables[1], key: validVariablePlan.variables[0].key }];
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const v of vars) {
      if (seen.has(v.key)) dups.push(v.key);
      seen.add(v.key);
    }
    expect(dups).toContain(validVariablePlan.variables[0].key);
  });

  it("detects variable with no matching component", () => {
    const orphanVar = validVariablePlan.variables.find((v) => v.key === "brand_name")!;
    const knownIds = new Set(["some-other-id"]);
    const missing = orphanVar.usedByComponentIds.filter((id) => !knownIds.has(id));
    expect(missing.length).toBeGreaterThan(0);
  });

  it("detects asset referencing unknown component", () => {
    const orphanAsset = { ...validAssetPlan.assets[0], componentId: "non-existent-component" };
    const knownIds = new Set(validComponentPlan.components.map((c) => c.id));
    expect(knownIds.has(orphanAsset.componentId)).toBe(false);
  });

  it("detects region width exceeding 2× canvas", () => {
    const bigComp = {
      ...validComponentPlan.components[0],
      region: { x: 0, y: 0, width: CANVAS_W * 3, height: 400 },
    };
    expect(bigComp.region.width > CANVAS_W * 2).toBe(true);
  });

  it("all sections in fixture are covered by at least one component", () => {
    const sectionIds = new Set(mockInput.design.sections.map((s) => s.id));
    const coveredSections = new Set(validComponentPlan.components.map((c) => c.sectionId));
    const empty = [...sectionIds].filter((id) => !coveredSections.has(id));
    expect(empty).toHaveLength(0);
  });
});

// ─── Component Builder Agent ──────────────────────────────────────────────────

describe("Component Builder Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with valid component plan", async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validComponentPlan)));

    const { runComponentBuilderAgent } = await import(
      "../../agents/components/componentBuilderAgent.js"
    );
    const result = await runComponentBuilderAgent(mockInput, "test-key");

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
    expect(result.data!.components.length).toBeGreaterThan(0);
    expect(result.metadata.agentId).toBe("component-builder-ai");
    expect(result.metadata.retryCount).toBe(0);
  });

  it("retries on invalid JSON and increments retryCount", async () => {
    mockCreate
      .mockResolvedValueOnce(makeOpenAIResponse("not-json{{"))
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validComponentPlan)));

    const { runComponentBuilderAgent } = await import(
      "../../agents/components/componentBuilderAgent.js"
    );
    const result = await runComponentBuilderAgent(mockInput, "test-key");

    expect(result.status).toBe("success");
    expect(result.metadata.retryCount).toBe(1);
  });

  it("returns failed after all retry attempts exhausted", async () => {
    // All 3 attempts (0, 1, 2) return invalid JSON
    mockCreate.mockResolvedValue(makeOpenAIResponse("{invalid}"));

    const { runComponentBuilderAgent } = await import(
      "../../agents/components/componentBuilderAgent.js"
    );
    const result = await runComponentBuilderAgent(mockInput, "test-key");

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.metadata.retryCount).toBe(2);
  });

  it("warns when component references unknown sectionId", async () => {
    const badPlan: ComponentPlan = {
      components: [
        { ...validComponentPlan.components[0], sectionId: "nonexistent-section" },
      ],
    };
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(badPlan)));

    const { runComponentBuilderAgent } = await import(
      "../../agents/components/componentBuilderAgent.js"
    );
    const result = await runComponentBuilderAgent(mockInput, "test-key");

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("nonexistent-section"))).toBe(true);
  });
});

// ─── Variable Designer Agent ──────────────────────────────────────────────────

describe("Variable Designer Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with valid variable plan", async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validVariablePlan)));

    const { runVariableDesignerAgent } = await import(
      "../../agents/components/variableDesignerAgent.js"
    );
    const result = await runVariableDesignerAgent(mockInput, validComponentPlan, "test-key");

    expect(result.status).toBe("success");
    expect(result.data!.variables.length).toBeGreaterThan(0);
    expect(result.metadata.agentId).toBe("variable-designer-ai");
  });

  it("warns when variable references non-existent component ID", async () => {
    const badPlan: VariablePlan = {
      variables: [
        { ...validVariablePlan.variables[0], usedByComponentIds: ["does-not-exist"] },
      ],
    };
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(badPlan)));

    const { runVariableDesignerAgent } = await import(
      "../../agents/components/variableDesignerAgent.js"
    );
    const result = await runVariableDesignerAgent(mockInput, validComponentPlan, "test-key");

    expect(result.warnings.some((w) => w.includes("does-not-exist"))).toBe(true);
  });

  it("warns when component bindingKey has no matching variable", async () => {
    // Only define brand_name; other bindingKeys (menu_name, price, phone, cta_label) are orphaned
    const partialPlan: VariablePlan = {
      variables: [
        {
          key: "brand_name",
          label: "Brand Name",
          type: "text",
          required: true,
          usedByComponentIds: ["hero-title"],
        },
      ],
    };
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(partialPlan)));

    const { runVariableDesignerAgent } = await import(
      "../../agents/components/variableDesignerAgent.js"
    );
    const result = await runVariableDesignerAgent(mockInput, validComponentPlan, "test-key");

    expect(result.warnings.some((w) => w.includes("bindingKey"))).toBe(true);
  });

  it("retries on invalid AI JSON", async () => {
    mockCreate
      .mockResolvedValueOnce(makeOpenAIResponse("INVALID"))
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validVariablePlan)));

    const { runVariableDesignerAgent } = await import(
      "../../agents/components/variableDesignerAgent.js"
    );
    const result = await runVariableDesignerAgent(mockInput, validComponentPlan, "test-key");

    expect(result.status).toBe("success");
    expect(result.metadata.retryCount).toBe(1);
  });
});

// ─── Asset Planner Agent ──────────────────────────────────────────────────────

describe("Asset Planner Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with valid asset plan", async () => {
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validAssetPlan)));

    const { runAssetPlannerAgent } = await import(
      "../../agents/components/assetPlannerAgent.js"
    );
    const result = await runAssetPlannerAgent(validComponentPlan, CANVAS_W, CANVAS_H, "test-key");

    expect(result.status).toBe("success");
    expect(result.data!.assets.length).toBeGreaterThan(0);
    expect(result.metadata.agentId).toBe("asset-planner-ai");
  });

  it("skips AI call when no asset components exist", async () => {
    const staticOnlyPlan: ComponentPlan = {
      components: [
        {
          id: "static-title",
          sectionId: "hero",
          type: "title",
          role: "Static title",
          required: true,
          contentSource: "static",
          region: { x: 0, y: 0, width: 1080, height: 100 },
          layerRole: "content",
          properties: {},
        },
      ],
    };

    const { runAssetPlannerAgent } = await import(
      "../../agents/components/assetPlannerAgent.js"
    );
    const result = await runAssetPlannerAgent(staticOnlyPlan, CANVAS_W, CANVAS_H, "test-key");

    expect(result.status).toBe("skipped");
    expect(result.data!.assets).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("warns when asset references unknown component ID", async () => {
    const badPlan: AssetPlan = {
      assets: [{ ...validAssetPlan.assets[0], componentId: "missing-comp" }],
    };
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(badPlan)));

    const { runAssetPlannerAgent } = await import(
      "../../agents/components/assetPlannerAgent.js"
    );
    const result = await runAssetPlannerAgent(validComponentPlan, CANVAS_W, CANVAS_H, "test-key");

    expect(result.warnings.some((w) => w.includes("missing-comp"))).toBe(true);
  });
});

// ─── Full pipeline integration ────────────────────────────────────────────────

describe("runComponentPipeline (full pipeline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated ComponentTeamOutput on success", async () => {
    mockCreate
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validComponentPlan)))
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validVariablePlan)))
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validAssetPlan)));

    const { runComponentPipeline } = await import("../../agents/components/index.js");
    const output: ComponentTeamOutput = await runComponentPipeline(mockInput);

    expect(output.componentPlan.components.length).toBeGreaterThan(0);
    expect(output.variablePlan.variables.length).toBeGreaterThan(0);
    expect(output.assetPlan.assets.length).toBeGreaterThan(0);

    // All asset componentIds must exist in the component plan
    const compIds = new Set(output.componentPlan.components.map((c) => c.id));
    for (const asset of output.assetPlan.assets) {
      expect(compIds.has(asset.componentId)).toBe(true);
    }

    // All variable usedByComponentIds must exist in the component plan
    for (const variable of output.variablePlan.variables) {
      for (const cid of variable.usedByComponentIds) {
        expect(compIds.has(cid)).toBe(true);
      }
    }
  });

  it("throws when Component Builder fails all retries", async () => {
    // 3 calls all fail (attempt 0, 1, 2)
    mockCreate
      .mockResolvedValueOnce(makeOpenAIResponse("BAD{"))
      .mockResolvedValueOnce(makeOpenAIResponse("BAD{"))
      .mockResolvedValueOnce(makeOpenAIResponse("BAD{"));

    const { runComponentPipeline } = await import("../../agents/components/index.js");
    await expect(runComponentPipeline(mockInput)).rejects.toThrow(/Agent 9.*failed|Component Builder.*failed/i);
  });

  it("does not call AI for assets when no asset-source components exist", async () => {
    const noAssetPlan: ComponentPlan = {
      components: validComponentPlan.components.map((c) => ({
        ...c,
        contentSource: "variable" as const,
      })),
    };

    mockCreate
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(noAssetPlan)))
      .mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify(validVariablePlan)));
    // No third call — Asset Planner is skipped

    const { runComponentPipeline } = await import("../../agents/components/index.js");
    const output = await runComponentPipeline(mockInput);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(output.assetPlan.assets).toHaveLength(0);
  });
});
