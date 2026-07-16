/**
 * Design Template Engine — Phase 1 Unit Tests
 *
 * Tests:
 *  - Template JSON schema validation
 *  - Variable binding + formatters
 *  - Conditional visibility
 *  - Text overflow guards
 *  - Idempotency hash
 *  - Tenant guard
 */

import { describe, it, expect } from "vitest";
import {
  designTemplateJsonSchema,
  renderDataRowSchema,
} from "../validators/designTemplateSchema.js";
import {
  resolveBinding,
  resolveTextContent,
  evaluateVisibility,
  validateRenderData,
  computeInputHash,
  assertTenantMatch,
  TenantAccessError,
} from "../services/designTemplateVariableService.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION, DESIGN_LIMITS } from "../types/designTemplate.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: "1",
    tenantId: "default",
    name: "Test Template",
    canvas: { width: 1080, height: 1080, unit: "px" },
    elements: [],
    variables: [],
    metadata: {
      createdBy: "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    ...overrides,
  };
}

// ── Schema Validation ─────────────────────────────────────────────────────────

describe("designTemplateJsonSchema", () => {
  it("accepts a minimal valid template", () => {
    const result = designTemplateJsonSchema.safeParse(makeTemplate());
    expect(result.success).toBe(true);
  });

  it("rejects wrong schemaVersion", () => {
    const result = designTemplateJsonSchema.safeParse(makeTemplate({ schemaVersion: "9.0" }));
    expect(result.success).toBe(false);
  });

  it("rejects canvas width exceeding MAX_CANVAS_WIDTH", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({ canvas: { width: DESIGN_LIMITS.MAX_CANVAS_WIDTH + 1, height: 100, unit: "px" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects canvas height exceeding MAX_CANVAS_HEIGHT", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({ canvas: { width: 100, height: DESIGN_LIMITS.MAX_CANVAS_HEIGHT + 1, unit: "px" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects elements array exceeding MAX_ELEMENT_COUNT", () => {
    const tooMany = Array.from({ length: DESIGN_LIMITS.MAX_ELEMENT_COUNT + 1 }, (_, i) => ({
      id: `el-${i}`,
      type: "shape",
      shape: "rectangle",
      x: 0, y: 0, width: 10, height: 10, zIndex: i,
    }));
    const result = designTemplateJsonSchema.safeParse(makeTemplate({ elements: tooMany }));
    expect(result.success).toBe(false);
  });

  it("rejects unsafe font family name", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        elements: [{
          id: "t1", type: "text", content: "hi",
          x: 0, y: 0, width: 100, height: 30, zIndex: 1,
          fontFamily: "<script>alert(1)</script>",
        }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a text element with variable binding", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        variables: [{ key: "product_name", label: "Product Name", type: "text", required: true }],
        elements: [{
          id: "t1", type: "text",
          content: { binding: { variableKey: "product_name", fallback: "Product" } },
          x: 0, y: 0, width: 200, height: 40, zIndex: 1,
        }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts an image element", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        elements: [{
          id: "img1", type: "image",
          src: { type: "url", url: "https://example.com/photo.jpg" },
          objectFit: "cover",
          x: 0, y: 0, width: 400, height: 400, zIndex: 1,
        }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a QR code element with variable binding", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        variables: [{ key: "product_url", label: "Product URL", type: "url" }],
        elements: [{
          id: "qr1", type: "qrcode",
          content: { binding: { variableKey: "product_url" } },
          x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects variable key with invalid characters", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        variables: [{ key: "product name!", label: "Product Name", type: "text" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid color format", () => {
    const result = designTemplateJsonSchema.safeParse(
      makeTemplate({
        elements: [{
          id: "t1", type: "text", content: "hello",
          x: 0, y: 0, width: 100, height: 30, zIndex: 1,
          color: "not-a-color",
        }],
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ── Variable Binding ──────────────────────────────────────────────────────────

describe("resolveBinding", () => {
  it("returns value when variable exists", () => {
    const r = resolveBinding({ variableKey: "name" }, { name: "Coconut Charcoal" });
    expect(r.value).toBe("Coconut Charcoal");
    expect(r.missing).toBe(false);
  });

  it("returns fallback when variable is missing", () => {
    const r = resolveBinding({ variableKey: "name", fallback: "Default Product" }, {});
    expect(r.value).toBe("Default Product");
    expect(r.missing).toBe(true);
  });

  it("returns empty string when no fallback and missing", () => {
    const r = resolveBinding({ variableKey: "name" }, {});
    expect(r.value).toBe("");
    expect(r.missing).toBe(true);
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe("formatters", () => {
  it("uppercase", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "uppercase" }, { x: "hello world" });
    expect(r.value).toBe("HELLO WORLD");
  });

  it("lowercase", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "lowercase" }, { x: "HELLO" });
    expect(r.value).toBe("hello");
  });

  it("titlecase", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "titlecase" }, { x: "coconut charcoal briquette" });
    expect(r.value).toBe("Coconut Charcoal Briquette");
  });

  it("truncate at specified length", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "truncate", truncateAt: 10 }, { x: "Long product name here" });
    expect(r.value).toBe("Long produ…");
    expect(r.value.length).toBeLessThanOrEqual(11); // 10 chars + ellipsis
  });

  it("truncate does not add ellipsis when not needed", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "truncate", truncateAt: 100 }, { x: "Short" });
    expect(r.value).toBe("Short");
  });

  it("currency USD", () => {
    const r = resolveBinding({ variableKey: "price", formatter: "currency", currencyCode: "USD" }, { price: "1200" });
    expect(r.value).toContain("1,200");
    expect(r.value).toContain("$");
  });

  it("number formatter adds thousands separator", () => {
    const r = resolveBinding({ variableKey: "qty", formatter: "number" }, { qty: "10000" });
    expect(r.value).toContain(",");
  });

  it("percentage formatter", () => {
    const r = resolveBinding({ variableKey: "pct", formatter: "percentage" }, { pct: "0.856" });
    expect(r.value).toBe("85.6%");
  });

  it("date formatter DD MMM YYYY", () => {
    const r = resolveBinding({ variableKey: "dt", formatter: "date", dateFormat: "DD MMM YYYY" }, { dt: "2026-01-15" });
    expect(r.value).toContain("Jan");
    expect(r.value).toContain("2026");
  });

  it("currency handles non-numeric value gracefully", () => {
    const r = resolveBinding({ variableKey: "x", formatter: "currency" }, { x: "not-a-number" });
    expect(r.value).toBe("not-a-number"); // passthrough
  });
});

// ── Conditional Visibility ────────────────────────────────────────────────────

describe("evaluateVisibility", () => {
  it("returns true when no condition", () => {
    expect(evaluateVisibility(undefined, {})).toBe(true);
  });

  it("equals — matches", () => {
    expect(evaluateVisibility({ variable: "show", operator: "equals", value: "yes" }, { show: "yes" })).toBe(true);
  });

  it("equals — does not match", () => {
    expect(evaluateVisibility({ variable: "show", operator: "equals", value: "yes" }, { show: "no" })).toBe(false);
  });

  it("not_equals", () => {
    expect(evaluateVisibility({ variable: "x", operator: "not_equals", value: "a" }, { x: "b" })).toBe(true);
  });

  it("is_empty — empty string", () => {
    expect(evaluateVisibility({ variable: "opt", operator: "is_empty" }, { opt: "" })).toBe(true);
  });

  it("is_empty — null", () => {
    expect(evaluateVisibility({ variable: "opt", operator: "is_empty" }, { opt: null })).toBe(true);
  });

  it("is_empty — missing key", () => {
    expect(evaluateVisibility({ variable: "opt", operator: "is_empty" }, {})).toBe(true);
  });

  it("is_not_empty", () => {
    expect(evaluateVisibility({ variable: "opt", operator: "is_not_empty" }, { opt: "value" })).toBe(true);
  });
});

// ── Variable Validation ───────────────────────────────────────────────────────

describe("validateRenderData", () => {
  it("passes when all required fields are present", () => {
    const variables = [
      { key: "product_name", label: "Name", type: "text" as const, required: true },
    ];
    const result = validateRenderData(variables, { product_name: "Coconut Charcoal" });
    expect(result.valid).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("fails when required field is missing", () => {
    const variables = [
      { key: "product_name", label: "Name", type: "text" as const, required: true },
    ];
    const result = validateRenderData(variables, {});
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("product_name");
  });

  it("passes when optional field is missing", () => {
    const variables = [
      { key: "subtitle", label: "Subtitle", type: "text" as const, required: false },
    ];
    const result = validateRenderData(variables, {});
    expect(result.valid).toBe(true);
  });

  it("catches maxLength violation", () => {
    const variables = [
      { key: "name", label: "Name", type: "text" as const, validation: { maxLength: 5 } },
    ];
    const result = validateRenderData(variables, { name: "Too long value" });
    expect(result.valid).toBe(false);
    expect(result.invalidFields[0]!.key).toBe("name");
  });
});

// ── Idempotency Hash ──────────────────────────────────────────────────────────

describe("computeInputHash", () => {
  it("produces same hash for same input", () => {
    const data = { product_name: "A", price: "100" };
    const h1 = computeInputHash(42, data);
    const h2 = computeInputHash(42, data);
    expect(h1).toBe(h2);
  });

  it("produces different hash when version differs", () => {
    const data = { product_name: "A" };
    expect(computeInputHash(1, data)).not.toBe(computeInputHash(2, data));
  });

  it("produces different hash when data differs", () => {
    expect(computeInputHash(1, { name: "A" })).not.toBe(computeInputHash(1, { name: "B" }));
  });

  it("is order-independent (keys sorted canonically)", () => {
    const h1 = computeInputHash(1, { a: "1", b: "2" });
    const h2 = computeInputHash(1, { b: "2", a: "1" });
    expect(h1).toBe(h2);
  });

  it("is a 64-character hex string (SHA-256)", () => {
    const hash = computeInputHash(1, { x: "y" });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── Tenant Guard ──────────────────────────────────────────────────────────────

describe("assertTenantMatch", () => {
  it("passes when tenant IDs match", () => {
    expect(() => assertTenantMatch("default", "default", "resource")).not.toThrow();
  });

  it("throws TenantAccessError when tenant IDs differ", () => {
    expect(() => assertTenantMatch("tenant-a", "tenant-b", "resource")).toThrowError(TenantAccessError);
  });
});

// ── renderDataRowSchema ───────────────────────────────────────────────────────

describe("renderDataRowSchema", () => {
  it("accepts valid row data", () => {
    const r = renderDataRowSchema.safeParse({ product_name: "Test", price: 100, active: true });
    expect(r.success).toBe(true);
  });

  it("accepts null values", () => {
    const r = renderDataRowSchema.safeParse({ optional_field: null });
    expect(r.success).toBe(true);
  });

  it("rejects keys with invalid characters", () => {
    const r = renderDataRowSchema.safeParse({ "bad key!": "value" });
    expect(r.success).toBe(false);
  });
});
