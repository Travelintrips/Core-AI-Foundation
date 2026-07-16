/**
 * Design Template Editor — Adapter + Reducer Round-trip Tests
 *
 * Tests:
 * - Schema → editor normalization
 * - Editor → schema serialization
 * - Round-trip fidelity
 * - Element add/delete
 * - Drag position updates
 * - Resize
 * - Rotation
 * - z-index reorder
 * - Lock
 * - Variable binding
 * - Delete bound variable warning (binding survives delete until element also updated)
 * - Undo/redo
 * - Draft save payload (no base64)
 * - Published version not mutated by editor state change
 * - Canvas size limits
 * - No base64 binary persisted
 */

import { describe, it, expect } from "vitest";
import { schemaToEditor, editorToSchema, validateTemplate } from "../utils/design-editor/adapter";
import { editorReducer, initialEditorState } from "../state/design-editor/reducer";
import type { EditorState, DesignTemplate, DesignElement } from "../state/design-editor/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<DesignTemplate> = {}): DesignTemplate {
  return {
    schemaVersion: "1.0",
    id: "42",
    tenantId: "default",
    name: "Test Template",
    canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
    elements: [],
    variables: [],
    metadata: { createdBy: "test", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 },
    ...overrides,
  };
}

function makeTextEl(overrides: Partial<DesignElement> = {}): DesignElement {
  return {
    id: "el1", type: "text", x: 10, y: 20, width: 200, height: 50,
    zIndex: 1, content: "Hello", fontFamily: "Inter", fontSize: 24, color: "#000",
    ...overrides,
  } as DesignElement;
}

function makeShapeEl(overrides: Partial<DesignElement> = {}): DesignElement {
  return {
    id: "el2", type: "shape", shape: "rectangle", x: 50, y: 50, width: 100, height: 100,
    zIndex: 2, fill: "#7C6EFA",
    ...overrides,
  } as DesignElement;
}

function loadTemplate(t: DesignTemplate): EditorState {
  return editorReducer(initialEditorState, { type: "LOAD_TEMPLATE", template: t });
}

// ── Schema → Editor ───────────────────────────────────────────────────────────

describe("schemaToEditor", () => {
  it("normalizes a valid template", () => {
    const raw = makeTemplate({ elements: [makeTextEl()] });
    const result = schemaToEditor(raw);
    expect(result.id).toBe("42");
    expect(result.elements).toHaveLength(1);
    expect(result.canvas.width).toBe(1080);
  });

  it("assigns IDs to elements missing one", () => {
    const raw = makeTemplate({ elements: [{ ...makeTextEl(), id: undefined as any }] });
    const result = schemaToEditor(raw);
    expect(result.elements[0]!.id).toBeTruthy();
    expect(result.elements[0]!.id.length).toBeGreaterThan(0);
  });

  it("applies defaults for missing canvas fields", () => {
    const result = schemaToEditor({ canvas: undefined } as any);
    expect(result.canvas.width).toBe(1080);
    expect(result.canvas.unit).toBe("px");
  });

  it("normalizes zIndex to 1-based sequential", () => {
    const raw = makeTemplate({
      elements: [makeTextEl({ zIndex: 99 }), makeShapeEl({ zIndex: 5 })],
    });
    const result = schemaToEditor(raw);
    const zIndices = result.elements.map((e) => e.zIndex).sort((a, b) => a - b);
    expect(zIndices[0]).toBe(1);
    expect(zIndices[1]).toBe(2);
  });

  it("handles unknown element type gracefully", () => {
    const raw = makeTemplate({ elements: [{ id: "x", type: "custom", x: 0, y: 0, width: 10, height: 10, zIndex: 1 } as any] });
    const result = schemaToEditor(raw);
    expect(result.elements).toHaveLength(1);
  });
});

// ── Editor → Schema ───────────────────────────────────────────────────────────

describe("editorToSchema", () => {
  it("produces a valid DesignTemplate", () => {
    const state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    const schema = editorToSchema(state);
    expect(schema.schemaVersion).toBe("1.0");
    expect(schema.elements).toHaveLength(1);
    expect(schema.canvas.unit).toBe("px");
  });

  it("sorts elements by zIndex ascending", () => {
    const raw = makeTemplate({
      elements: [makeShapeEl({ zIndex: 3 }), makeTextEl({ zIndex: 1 })],
    });
    const state = loadTemplate(raw);
    const schema = editorToSchema(state);
    const zs = schema.elements.map((e) => e.zIndex);
    expect(zs[0]).toBeLessThan(zs[1]!);
  });

  it("strips base64 data URIs from image src", () => {
    const imgEl = {
      id: "img1", type: "image", x: 0, y: 0, width: 200, height: 200, zIndex: 1,
      src: { type: "dataurl", url: "data:image/png;base64,ABC123" },
    } as any;
    const state = loadTemplate(makeTemplate({ elements: [imgEl] }));
    const schema = editorToSchema(state);
    expect((schema.elements[0] as any).src).toBeUndefined();
  });
});

// ── Round-trip ────────────────────────────────────────────────────────────────

describe("round-trip", () => {
  it("schema → editor → schema preserves element count", () => {
    const elements = [makeTextEl(), makeShapeEl()];
    const original = makeTemplate({ elements });
    const state = loadTemplate(schemaToEditor(original));
    const output = editorToSchema(state);
    expect(output.elements).toHaveLength(2);
  });

  it("preserves variable keys", () => {
    const vars = [{ key: "product_name", label: "Product", type: "text" as const }];
    const original = makeTemplate({ variables: vars });
    const state = loadTemplate(schemaToEditor(original));
    const output = editorToSchema(state);
    expect(output.variables[0]!.key).toBe("product_name");
  });

  it("preserves canvas dimensions", () => {
    const original = makeTemplate({ canvas: { width: 1080, height: 1350, unit: "px" } });
    const state = loadTemplate(schemaToEditor(original));
    const output = editorToSchema(state);
    expect(output.canvas.width).toBe(1080);
    expect(output.canvas.height).toBe(1350);
  });

  it("preserves text element content binding", () => {
    const el = makeTextEl({ content: { binding: { variableKey: "product_name", fallback: "Product" } } });
    const original = makeTemplate({ elements: [el] });
    const state = loadTemplate(schemaToEditor(original));
    const output = editorToSchema(state);
    const outEl = output.elements[0] as any;
    expect(outEl.content?.binding?.variableKey).toBe("product_name");
  });
});

// ── Reducer — element lifecycle ───────────────────────────────────────────────

describe("reducer: add element", () => {
  it("adds element and selects it", () => {
    const state = loadTemplate(makeTemplate());
    const next = editorReducer(state, { type: "ADD_ELEMENT", element: makeTextEl() });
    expect(next.elements).toHaveLength(1);
    expect(next.selectedElementIds).toContain("el1");
    expect(next.dirty).toBe(true);
  });

  it("pushes history on add", () => {
    const state = loadTemplate(makeTemplate());
    const next = editorReducer(state, { type: "ADD_ELEMENT", element: makeTextEl() });
    expect(next.history.past).toHaveLength(1);
  });
});

describe("reducer: delete element", () => {
  it("removes the element", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "SELECT_ELEMENTS", ids: ["el1"] });
    state = editorReducer(state, { type: "DELETE_ELEMENTS", ids: ["el1"] });
    expect(state.elements).toHaveLength(0);
    expect(state.selectedElementIds).not.toContain("el1");
  });
});

describe("reducer: drag updates position", () => {
  it("transient drag does not push history", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    const prevHistoryLen = state.history.past.length;
    state = editorReducer(state, { type: "UPDATE_ELEMENT_TRANSIENT", id: "el1", patch: { x: 99, y: 88 } });
    expect(state.elements[0]!.x).toBe(99);
    expect(state.history.past.length).toBe(prevHistoryLen); // no push
  });

  it("commit after drag pushes history", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "UPDATE_ELEMENT_TRANSIENT", id: "el1", patch: { x: 99, y: 88 } });
    state = editorReducer(state, { type: "COMMIT_TRANSIENT" });
    expect(state.history.past.length).toBe(1);
  });
});

describe("reducer: resize", () => {
  it("updates width and height", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "UPDATE_ELEMENT", id: "el1", patch: { width: 300, height: 80 } });
    expect(state.elements[0]!.width).toBe(300);
    expect(state.elements[0]!.height).toBe(80);
  });
});

describe("reducer: rotation", () => {
  it("updates rotation", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "UPDATE_ELEMENT", id: "el1", patch: { rotation: 45 } });
    expect(state.elements[0]!.rotation).toBe(45);
  });
});

describe("reducer: z-index reorder", () => {
  it("bring forward swaps z-indices", () => {
    const elements = [makeTextEl({ id: "a", zIndex: 1 }), makeShapeEl({ id: "b", zIndex: 2 })];
    let state = loadTemplate(makeTemplate({ elements }));
    state = editorReducer(state, { type: "BRING_FORWARD", id: "a" });
    const a = state.elements.find((e) => e.id === "a")!;
    const b = state.elements.find((e) => e.id === "b")!;
    expect(a.zIndex).toBeGreaterThan(b.zIndex);
  });

  it("send to back assigns lowest z-index", () => {
    const elements = [makeTextEl({ id: "a", zIndex: 1 }), makeShapeEl({ id: "b", zIndex: 2 })];
    let state = loadTemplate(makeTemplate({ elements }));
    state = editorReducer(state, { type: "SEND_TO_BACK", id: "b" });
    const b = state.elements.find((e) => e.id === "b")!;
    const a = state.elements.find((e) => e.id === "a")!;
    expect(b.zIndex).toBeLessThan(a.zIndex);
  });
});

describe("reducer: lock", () => {
  it("sets locked flag", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "UPDATE_ELEMENT", id: "el1", patch: { locked: true } });
    expect(state.elements[0]!.locked).toBe(true);
  });
});

describe("reducer: variable binding", () => {
  it("binding is preserved in element content", () => {
    const el = makeTextEl({ content: { binding: { variableKey: "title" } } });
    const state = loadTemplate(makeTemplate({ elements: [el] }));
    const outEl = state.elements[0] as any;
    expect(outEl.content?.binding?.variableKey).toBe("title");
  });
});

describe("reducer: delete variable with binding warning", () => {
  it("variable is deleted even when bound (caller must warn)", () => {
    const vars = [{ key: "title", label: "Title", type: "text" as const }];
    let state = loadTemplate(makeTemplate({ variables: vars }));
    state = editorReducer(state, { type: "DELETE_VARIABLE", key: "title" });
    expect(state.variables).toHaveLength(0);
    // Note: Elements that were bound still have their binding — the UI warns before delete
  });
});

describe("reducer: undo/redo", () => {
  it("undo restores previous state", () => {
    let state = loadTemplate(makeTemplate());
    state = editorReducer(state, { type: "ADD_ELEMENT", element: makeTextEl() });
    expect(state.elements).toHaveLength(1);
    state = editorReducer(state, { type: "UNDO" });
    expect(state.elements).toHaveLength(0);
  });

  it("redo re-applies the action", () => {
    let state = loadTemplate(makeTemplate());
    state = editorReducer(state, { type: "ADD_ELEMENT", element: makeTextEl() });
    state = editorReducer(state, { type: "UNDO" });
    expect(state.elements).toHaveLength(0);
    state = editorReducer(state, { type: "REDO" });
    expect(state.elements).toHaveLength(1);
  });

  it("undo is a no-op when history is empty", () => {
    const state = loadTemplate(makeTemplate());
    const same = editorReducer(state, { type: "UNDO" });
    expect(same.elements).toHaveLength(0);
  });

  it("future is cleared after a new action following undo", () => {
    let state = loadTemplate(makeTemplate());
    state = editorReducer(state, { type: "ADD_ELEMENT", element: makeTextEl() });
    state = editorReducer(state, { type: "UNDO" });
    state = editorReducer(state, { type: "ADD_ELEMENT", element: makeShapeEl() });
    expect(state.history.future).toHaveLength(0);
  });
});

// ── Draft save payload ────────────────────────────────────────────────────────

describe("draft save payload", () => {
  it("editorToSchema has schemaVersion", () => {
    const state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    const schema = editorToSchema(state);
    expect(schema.schemaVersion).toBe("1.0");
  });

  it("editorToSchema does not include selectedElementIds", () => {
    const state = loadTemplate(makeTemplate());
    const schema = editorToSchema(state) as any;
    expect(schema.selectedElementIds).toBeUndefined();
    expect(schema.dirty).toBeUndefined();
    expect(schema.zoom).toBeUndefined();
    expect(schema.history).toBeUndefined();
  });
});

// ── Published version not mutated ─────────────────────────────────────────────

describe("published version immutability (editor)", () => {
  it("LOAD_TEMPLATE does not mutate the input object", () => {
    const original = makeTemplate({ elements: [makeTextEl()] });
    const originalCopy = JSON.parse(JSON.stringify(original));
    loadTemplate(original);
    expect(original).toEqual(originalCopy);
  });

  it("MARK_SAVED records versionId without modifying elements", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl()] }));
    state = editorReducer(state, { type: "MARK_SAVED", versionId: "99" });
    expect(state.baseVersionId).toBe("99");
    expect(state.elements).toHaveLength(1);
    expect(state.dirty).toBe(false);
  });
});

// ── Canvas size limits ────────────────────────────────────────────────────────

describe("canvas limits", () => {
  it("validateTemplate rejects oversized canvas", () => {
    const t = makeTemplate({ canvas: { width: 9999, height: 1080, unit: "px" } });
    const result = validateTemplate(t);
    expect(result.valid).toBe(false);
  });

  it("validateTemplate accepts valid canvas", () => {
    const t = makeTemplate({ canvas: { width: 1080, height: 1080, unit: "px" } });
    const result = validateTemplate(t);
    expect(result.valid).toBe(true);
  });

  it("validateTemplate rejects too many elements", () => {
    const elements = Array.from({ length: 201 }, (_, i) =>
      makeTextEl({ id: `el${i}`, zIndex: i + 1 }),
    );
    const t = makeTemplate({ elements });
    const result = validateTemplate(t);
    expect(result.valid).toBe(false);
  });
});

// ── No base64 binary persisted ────────────────────────────────────────────────

describe("no base64 binary", () => {
  it("editorToSchema removes data: URI image src", () => {
    const imgEl = {
      id: "img1", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1,
      src: { type: "dataurl", url: "data:image/png;base64,iVBOR" },
    } as any;
    const state = loadTemplate(makeTemplate({ elements: [imgEl] }));
    const schema = editorToSchema(state);
    expect((schema.elements[0] as any).src).toBeUndefined();
  });

  it("validateTemplate rejects base64 in image elements", () => {
    const t = makeTemplate({
      elements: [{
        id: "img1", type: "image", x: 0, y: 0, width: 100, height: 100, zIndex: 1,
        src: "data:image/png;base64,ABC",
      } as any],
    });
    const result = validateTemplate(t);
    expect(result.valid).toBe(false);
  });
});

// ── Keyboard delete ───────────────────────────────────────────────────────────

describe("keyboard delete (reducer)", () => {
  it("DELETE_ELEMENTS removes multiple selected", () => {
    let state = loadTemplate(makeTemplate({ elements: [makeTextEl(), makeShapeEl()] }));
    state = editorReducer(state, { type: "SELECT_ELEMENTS", ids: ["el1", "el2"] });
    state = editorReducer(state, { type: "DELETE_ELEMENTS", ids: state.selectedElementIds });
    expect(state.elements).toHaveLength(0);
  });
});
