/**
 * Design Template Editor — JSON Adapter
 *
 * Converts between the backend DesignTemplate schema and editor-friendly state.
 * The schema and editor use the same domain types, so the adapter handles:
 *  - Normalization (ensure required fields have defaults)
 *  - Element ID generation (if missing)
 *  - zIndex normalization
 *  - Serialization validation before save
 *
 * Round-trip guarantee: editorToSchema(schemaToEditor(json)).elements ≅ json.elements
 */

import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../design-editor/constants";
import type {
  DesignTemplate,
  DesignElement,
  DesignCanvas,
  TemplateVariable,
  EditorState,
} from "../../state/design-editor/types";

// Re-export for convenience
export { DESIGN_TEMPLATE_SCHEMA_VERSION };

// ── Normalization helpers ─────────────────────────────────────────────────────

function genId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeElement(el: Partial<DesignElement>, index: number): DesignElement {
  const base = {
    id: (el as any).id || genId(),
    type: (el as any).type || "shape",
    x: (el as any).x ?? 0,
    y: (el as any).y ?? 0,
    width: (el as any).width ?? 100,
    height: (el as any).height ?? 100,
    zIndex: (el as any).zIndex ?? index + 1,
    visible: (el as any).visible !== false,
    locked: (el as any).locked ?? false,
    rotation: (el as any).rotation ?? 0,
    opacity: (el as any).opacity ?? 1,
  };

  // Merge type-specific defaults
  switch (base.type) {
    case "text":
      return {
        ...base,
        type: "text",
        content: (el as any).content ?? "New Text",
        fontFamily: (el as any).fontFamily ?? "Inter",
        fontSize: (el as any).fontSize ?? 24,
        color: (el as any).color ?? "#000000",
        textAlign: (el as any).textAlign ?? "left",
        fontWeight: (el as any).fontWeight ?? 400,
        overflow: (el as any).overflow ?? "wrap",
      } as DesignElement;
    case "image":
      return {
        ...base,
        type: "image",
        objectFit: (el as any).objectFit ?? "cover",
        borderRadius: (el as any).borderRadius ?? 0,
      } as DesignElement;
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: (el as any).shape ?? "rectangle",
        fill: (el as any).fill ?? "#7C6EFA",
        borderRadius: (el as any).borderRadius ?? 0,
      } as DesignElement;
    case "qrcode":
      return {
        ...base,
        type: "qrcode",
        content: (el as any).content ?? "https://example.com",
        fgColor: (el as any).fgColor ?? "#000000",
        bgColor: (el as any).bgColor ?? "#ffffff",
      } as DesignElement;
    case "line":
      return {
        ...base,
        type: "line",
        stroke: (el as any).stroke ?? "#000000",
        strokeWidth: (el as any).strokeWidth ?? 2,
      } as DesignElement;
    default:
      return { ...base, type: (el as any).type } as DesignElement;
  }
}

function normalizeCanvas(c: Partial<DesignCanvas>): DesignCanvas {
  return {
    width: c.width ?? 1080,
    height: c.height ?? 1080,
    unit: "px",
    backgroundColor: c.backgroundColor ?? "#ffffff",
    backgroundImage: c.backgroundImage,
  };
}

function normalizeVariable(v: Partial<TemplateVariable>): TemplateVariable {
  return {
    key: (v as any).key ?? `var_${Date.now()}`,
    label: (v as any).label ?? (v as any).key ?? "Variable",
    type: (v as any).type ?? "text",
    required: (v as any).required ?? false,
    defaultValue: (v as any).defaultValue,
    validation: (v as any).validation,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Convert a raw DesignTemplate JSON blob (from backend) into a normalized
 * DesignTemplate safe for the editor.
 */
export function schemaToEditor(raw: unknown): DesignTemplate {
  const json = (raw ?? {}) as Record<string, unknown>;
  const rawElements = (json["elements"] as Partial<DesignElement>[] | undefined) ?? [];
  const rawVariables = (json["variables"] as Partial<TemplateVariable>[] | undefined) ?? [];
  const rawCanvas = (json["canvas"] as Partial<DesignCanvas> | undefined) ?? {};

  // Sort by original zIndex then reassign sequential 1-based indices
  const rawNormalized = rawElements.map(normalizeElement);
  rawNormalized.sort((a, b) => a.zIndex - b.zIndex);
  const elements = rawNormalized.map((el, i) => ({ ...el, zIndex: i + 1 }));
  const canvas = normalizeCanvas(rawCanvas);
  const variables = rawVariables.map(normalizeVariable);

  return {
    schemaVersion: (json["schemaVersion"] as string) || DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: (json["id"] as string) || "",
    tenantId: (json["tenantId"] as string) || "default",
    name: (json["name"] as string) || "Untitled",
    description: json["description"] as string | undefined,
    category: json["category"] as string | undefined,
    canvas,
    elements,
    variables,
    metadata: {
      createdBy: (json["metadata"] as any)?.createdBy ?? "system",
      createdAt: (json["metadata"] as any)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: ((json["metadata"] as any)?.version ?? 0) + 1,
    },
  };
}

/**
 * Serialize the current editor state back to a backend-compatible DesignTemplate.
 *
 * Rules:
 * - No binary blobs in the output (images are referenced by URL/storagePath)
 * - No editor-only fields (selectedElementIds, dirty, zoom, history)
 * - Elements sorted by zIndex ascending
 */
export function editorToSchema(state: Pick<EditorState, "canvas" | "elements" | "variables" | "templateId" | "templateName" | "tenantId" | "baseVersionId">): DesignTemplate {
  const sortedElements = [...state.elements].sort((a, b) => a.zIndex - b.zIndex);

  // Strip any accidental binary/blob from elements
  const safeElements = sortedElements.map((el) => {
    const clean = { ...el } as Record<string, unknown>;
    // Remove any base64 or data: URIs that may have slipped in
    if (clean["src"] && typeof clean["src"] === "object" && (clean["src"] as any)?.type === "dataurl") {
      delete clean["src"];
    }
    return clean as DesignElement;
  });

  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: state.templateId,
    tenantId: state.tenantId,
    name: state.templateName,
    canvas: state.canvas,
    elements: safeElements,
    variables: state.variables,
    metadata: {
      createdBy: "editor",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
  };
}

/**
 * Validate that a DesignTemplate is safe to submit to the backend.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateTemplate(t: DesignTemplate): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (!t.id) errors.push("Template ID is required");
  if (!t.name) errors.push("Template name is required");
  if (t.canvas.width < 1 || t.canvas.width > 8000) errors.push("Canvas width out of range (1–8000)");
  if (t.canvas.height < 1 || t.canvas.height > 8000) errors.push("Canvas height out of range (1–8000)");
  if (t.elements.length > 200) errors.push("Too many elements (max 200)");
  if (t.variables.length > 50) errors.push("Too many variables (max 50)");

  // Check for base64/binary in image src
  for (const el of t.elements) {
    if (el.type === "image") {
      const src = (el as any).src;
      if (src && typeof src === "string" && src.startsWith("data:")) {
        errors.push(`Element "${el.id}": base64 image data must not be stored in template JSON`);
      }
    }
  }

  // Check required variable keys are valid identifiers
  for (const v of t.variables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.key)) {
      errors.push(`Variable key "${v.key}" contains invalid characters`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Create a default template scaffold for new templates.
 */
export function createDefaultTemplate(opts: {
  id: string;
  name: string;
  tenantId: string;
  canvasWidth?: number;
  canvasHeight?: number;
}): DesignTemplate {
  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: opts.id,
    tenantId: opts.tenantId,
    name: opts.name,
    canvas: {
      width: opts.canvasWidth ?? 1080,
      height: opts.canvasHeight ?? 1080,
      unit: "px",
      backgroundColor: "#ffffff",
    },
    elements: [],
    variables: [],
    metadata: {
      createdBy: "editor",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
  };
}
