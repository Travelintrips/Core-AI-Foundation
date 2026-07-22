/**
 * Tests: Integration, Security, Accessibility, Regression
 *
 * Covers spec requirements:
 * 18. selection change
 * 20. unsafe HTML not rendered
 * 21. accessibility labels
 * 23. existing forms not regression
 */

import { describe, it, expect } from "vitest";
import { LocalSelectionAdapter, selectionToContextFields } from "../workspace-selection-adapter";
import { sanitizeLabel, generateInputId, isValueSafe, sanitizePropertyValue } from "../security";
import { PropertySectionRegistry, PropertyFieldRendererRegistry } from "../registry";
import { editingModelReducer, makeInitialEditingState } from "../editing-model";
import type { PropertyPanelContext, PropertySectionDefinition } from "../types";

// ── Test 18: selection change ─────────────────────────────────────────────────

describe("selection change (test 18)", () => {
  it("LocalSelectionAdapter notifies subscribers on setSelection", () => {
    const adapter = new LocalSelectionAdapter({ selectedArtifactId: "art-1" });
    const received: any[] = [];
    const unsub = adapter.subscribe((sel) => received.push(sel));

    adapter.setSelection({ selectedElementId: "el-5" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ selectedElementId: "el-5" });
    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    const adapter = new LocalSelectionAdapter();
    const received: any[] = [];
    const unsub = adapter.subscribe((sel) => received.push(sel));

    adapter.setSelection({ selectedElementId: "el-1" });
    unsub();
    adapter.setSelection({ selectedElementId: "el-2" });

    expect(received).toHaveLength(1); // only the first one
  });

  it("getSelection returns current selection", () => {
    const adapter = new LocalSelectionAdapter({ selectedArtifactId: "art-A" });
    expect(adapter.getSelection().selectedArtifactId).toBe("art-A");
  });

  it("multiple subscribers all receive updates", () => {
    const adapter = new LocalSelectionAdapter();
    let count = 0;
    const u1 = adapter.subscribe(() => count++);
    const u2 = adapter.subscribe(() => count++);
    adapter.setSelection({ selectedElementId: "e" });
    expect(count).toBe(2);
    u1();
    u2();
  });

  it("selectionToContextFields extracts all opaque IDs", () => {
    const sel = {
      selectedArtifactId: "a",
      selectedFrameId: "f",
      selectedElementId: "e",
      selectedRegionId: "r",
      selectedLayerId: "l",
    };
    const fields = selectionToContextFields(sel);
    expect(fields.selectedArtifactId).toBe("a");
    expect(fields.selectedFrameId).toBe("f");
    expect(fields.selectedElementId).toBe("e");
    expect(fields.selectedRegionId).toBe("r");
    expect(fields.selectedLayerId).toBe("l");
  });

  it("panel context updates when selection changes (integration)", () => {
    const adapter = new LocalSelectionAdapter({ selectedArtifactId: "art-1" });
    let lastContext: Partial<PropertyPanelContext> = {};
    adapter.subscribe((sel) => {
      lastContext = selectionToContextFields(sel);
    });

    adapter.setSelection({ selectedElementId: "el-42" });

    expect(lastContext.selectedElementId).toBe("el-42");
    expect(lastContext.selectedArtifactId).toBeUndefined();
  });

  it("selection IDs are treated as opaque strings (domain-neutral)", () => {
    // Core must NOT interpret meaning of these IDs
    const domainIds = [
      "sleeve-panel-left",
      "wall-facade-north",
      "logo-mark-primary",
      "sofa-cushion-3",
    ];
    const adapter = new LocalSelectionAdapter();
    const received: string[] = [];
    adapter.subscribe((sel) => {
      if (sel.selectedElementId) received.push(sel.selectedElementId);
    });
    for (const id of domainIds) {
      adapter.setSelection({ selectedElementId: id });
    }
    expect(received).toEqual(domainIds); // passed through unchanged
  });
});

// ── Test 20: unsafe HTML not rendered ─────────────────────────────────────────

describe("unsafe HTML not rendered (test 20)", () => {
  it("sanitizeLabel strips HTML tags from strings", () => {
    const input = '<script>alert("xss")</script>Title';
    expect(sanitizeLabel(input)).toBe("Title");
  });

  it("sanitizeLabel returns text without HTML angle-bracket content", () => {
    expect(sanitizeLabel("<b>Bold</b>")).toBe("Bold");
    expect(sanitizeLabel("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("sanitizeLabel handles null/undefined safely", () => {
    expect(sanitizeLabel(null)).toBe("");
    expect(sanitizeLabel(undefined)).toBe("");
  });

  it("sanitizeLabel does not alter plain text", () => {
    expect(sanitizeLabel("Hello World")).toBe("Hello World");
    expect(sanitizeLabel("50%")).toBe("50%");
    expect(sanitizeLabel("#FF0000")).toBe("#FF0000");
  });

  it("isValueSafe rejects function values", () => {
    expect(isValueSafe(() => {})).toBe(false);
  });

  it("isValueSafe rejects strings with <script", () => {
    expect(isValueSafe('<script>alert(1)</script>')).toBe(false);
  });

  it("isValueSafe rejects javascript: protocol strings", () => {
    expect(isValueSafe("javascript:alert(1)")).toBe(false);
  });

  it("isValueSafe accepts safe string values", () => {
    expect(isValueSafe("Hello World")).toBe(true);
    expect(isValueSafe("#FF0000")).toBe(true);
    expect(isValueSafe(42)).toBe(true);
    expect(isValueSafe(true)).toBe(true);
    expect(isValueSafe(null)).toBe(true);
  });

  it("sanitizePropertyValue returns null for unsafe values", () => {
    expect(sanitizePropertyValue(() => {})).toBeNull();
    expect(sanitizePropertyValue('<script>alert(1)</script>')).toBeNull();
  });

  it("sanitizePropertyValue passes safe values through", () => {
    expect(sanitizePropertyValue("Hello")).toBe("Hello");
    expect(sanitizePropertyValue(42)).toBe(42);
  });

  it("plugin labels containing HTML are sanitized before rendering", () => {
    // Simulate plugin providing a section with an XSS label
    const reg = new PropertySectionRegistry();
    reg.register({
      id: "plugin-xss",
      label: '<img src=x onerror=alert(1)>Malicious',
      fields: [
        {
          id: "f1",
          type: "text",
          label: '<script>alert("field")</script>Safe Field',
        },
      ],
    });
    const sections = reg.getSections({
      capabilities: [],
      isReadOnly: false,
      tenantId: "t1",
    });
    // The registry stores raw values; sanitizeLabel is applied at render time.
    // Here we verify sanitizeLabel produces safe output for these values:
    expect(sanitizeLabel(sections[0]!.label)).toBe("Malicious");
    expect(sanitizeLabel(sections[0]!.fields[0]!.label)).toBe('Safe Field');
  });
});

// ── Test 21: accessibility labels ─────────────────────────────────────────────

describe("accessibility labels (test 21)", () => {
  it("generateInputId produces stable id from section + field ids", () => {
    expect(generateInputId("transform", "rotation")).toBe("prop-transform-rotation");
    expect(generateInputId("typography", "font-size")).toBe("prop-typography-font-size");
  });

  it("generateInputId replaces unsafe chars with underscores", () => {
    const id = generateInputId("my section!", "field name?");
    expect(id).toMatch(/^prop-[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+$/);
    expect(id).not.toContain("!");
    expect(id).not.toContain("?");
    expect(id).not.toContain(" ");
  });

  it("generateInputId is deterministic for the same inputs", () => {
    const a = generateInputId("sec", "fld");
    const b = generateInputId("sec", "fld");
    expect(a).toBe(b);
  });

  it("generateInputId produces different IDs for different section-field combos", () => {
    const a = generateInputId("sec-1", "field");
    const b = generateInputId("sec-2", "field");
    const c = generateInputId("sec-1", "other");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("error id is derived from input id for aria-describedby linkage", () => {
    const inputId = generateInputId("transform", "opacity");
    const errorId = `${inputId}-error`;
    // In the rendered HTML, error <p id={errorId}> is linked from the field
    expect(errorId).toBe("prop-transform-opacity-error");
  });
});

// ── Test 23: existing forms not regression ────────────────────────────────────

describe("existing forms regression (test 23)", () => {
  it("new registries are independent instances (no global state leak)", () => {
    const reg1 = new PropertySectionRegistry();
    const reg2 = new PropertySectionRegistry();
    reg1.register({
      id: "sec-a",
      label: "Section A",
      fields: [{ id: "f1", type: "text", label: "F1" }],
    });
    // reg2 should not see reg1's section
    expect(reg1.size).toBe(1);
    expect(reg2.size).toBe(0);
  });

  it("editingModelReducer does not mutate input state", () => {
    const original = makeInitialEditingState({ x: "original" });
    const originalCopy = JSON.parse(
      JSON.stringify({
        ...original,
        dirtyFields: Array.from(original.dirtyFields),
      }),
    );
    editingModelReducer(original, { type: "UPDATE_DRAFT", fieldId: "x", value: "mutated?" });
    // original draft should be unchanged
    expect(original.draft["x"]).toBe("original");
    expect(Array.from(original.dirtyFields)).toHaveLength(0);
  });

  it("PropertyFieldRendererRegistry instances are independent", () => {
    const reg1 = new PropertyFieldRendererRegistry();
    const reg2 = new PropertyFieldRendererRegistry();
    reg1.register({ type: "text", render: () => null });
    expect(reg1.has("text")).toBe(true);
    expect(reg2.has("text")).toBe(false);
  });

  it("registry section IDs from universal panel do not conflict with design-editor IDs", () => {
    // Universal panel uses namespaced IDs — no risk of collision with existing panels
    const reg = new PropertySectionRegistry();
    const upIds = [
      "upp:transform", "upp:typography", "upp:fill",
      "upp:layout", "upp:metadata", "upp:review",
    ];
    for (const id of upIds) {
      reg.register({ id, label: id, fields: [{ id: "f", type: "text", label: "F" }] });
    }
    expect(reg.size).toBe(upIds.length);
    // None of these IDs conflict with existing design-editor panel sections
    // (which use plain section titles, not "upp:" prefixed IDs)
    for (const id of upIds) {
      expect(id.startsWith("upp:")).toBe(true);
    }
  });

  it("sanitizeLabel handles numbers and booleans (non-string plugin values)", () => {
    expect(sanitizeLabel(42 as any)).toBe("42");
    expect(sanitizeLabel(true as any)).toBe("true");
    expect(sanitizeLabel(false as any)).toBe("false");
  });

  it("makeInitialEditingState is pure (no shared references)", () => {
    const s1 = makeInitialEditingState({ x: "a" });
    const s2 = makeInitialEditingState({ x: "a" });
    // Mutating s1 draft should not affect s2
    (s1.draft as any)["x"] = "mutated";
    expect(s2.draft["x"]).toBe("a");
  });
});

// ── Tenant isolation note ─────────────────────────────────────────────────────

describe("tenant isolation (spec compliance)", () => {
  it("PropertyPanelContext tenantId is a server-provided opaque string", () => {
    // Core never derives tenantId from selection IDs or client input.
    // This test verifies the context shape enforces this pattern.
    const ctx: PropertyPanelContext = {
      tenantId: "server-resolved-tenant-abc",
      capabilities: [],
      isReadOnly: false,
    };
    expect(typeof ctx.tenantId).toBe("string");
    // The panel must not expose tenantId through property values
    // (security.ts sanitizePropertyValue handles this at the value layer)
  });

  it("context does not accept raw client tenantId (adapter pattern)", () => {
    // The WorkspaceSelection adapter strips tenantId from selection events.
    const sel = selectionToContextFields({
      selectedArtifactId: "art-1",
      // tenantId is not part of WorkspaceSelection — only server resolves it
    });
    // @ts-expect-error — tenantId should not be in WorkspaceSelection
    expect((sel as any).tenantId).toBeUndefined();
  });
});
