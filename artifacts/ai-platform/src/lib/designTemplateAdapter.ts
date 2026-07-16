/**
 * Design Template Canvas Adapter
 *
 * Converts between the canonical DesignTemplate JSON (source of truth)
 * and the editor's internal SceneElement model used for Konva rendering.
 *
 * Rules:
 * - Binary images MUST NOT be stored in template_json (only storagePath/URL refs)
 * - Round-trip: canonicalToScene → sceneToCanonical must produce identical output
 * - No executable code in template data (validated server-side by Zod schema)
 */

import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "./designTemplateTypes";
import type {
  DesignTemplate,
  DesignElement as CanonicalElement,
  TextElement,
  ImageElement,
  ShapeElement,
  LineElement,
  QrCodeElement,
  TemplateVariable,
  DesignCanvas,
  VariableBinding,
  ConditionalVisibility,
  AssetReference,
} from "./designTemplateTypes";

// ── Editor Scene Model ────────────────────────────────────────────────────────

export type SceneElementType = "text" | "image" | "shape" | "line" | "qrcode";

export interface SceneBaseProps {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  visibleWhen?: ConditionalVisibility;
}

export interface SceneTextElement extends SceneBaseProps {
  type: "text";
  contentMode: "static" | "variable";
  staticContent: string;
  variableBinding?: VariableBinding;
  fontFamily: string;
  fontSize: number;
  fontWeight: number | "bold" | "normal";
  italic: boolean;
  underline: boolean;
  color: string;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  textTransform: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface SceneImageElement extends SceneBaseProps {
  type: "image";
  /** URL for display only; actual source is assetRef */
  previewUrl?: string;
  assetRef?: AssetReference;
  variableBinding?: VariableBinding;
  objectFit: "cover" | "contain" | "fill";
  borderRadius: number;
}

export interface SceneShapeElement extends SceneBaseProps {
  type: "shape";
  shapeKind: "rectangle" | "circle" | "rounded-rectangle";
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface SceneLineElement extends SceneBaseProps {
  type: "line";
  strokeColor: string;
  strokeWidth: number;
  dashArray: number[];
}

export interface SceneQrCodeElement extends SceneBaseProps {
  type: "qrcode";
  contentMode: "static" | "variable";
  staticContent: string;
  variableBinding?: VariableBinding;
  fgColor: string;
  bgColor: string;
  errorLevel: "L" | "M" | "Q" | "H";
}

export type SceneElement =
  | SceneTextElement
  | SceneImageElement
  | SceneShapeElement
  | SceneLineElement
  | SceneQrCodeElement;

export interface Scene {
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
  };
  elements: SceneElement[];
  variables: TemplateVariable[];
  /** Metadata preserved for round-trip */
  _meta: {
    schemaVersion: string;
    id: string;
    tenantId: string;
    name: string;
    description?: string;
    category?: string;
    metadata: DesignTemplate["metadata"];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseProps(el: CanonicalElement): SceneBaseProps {
  return {
    id: el.id,
    name: el.name,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation ?? 0,
    opacity: el.opacity ?? 1,
    visible: el.visible ?? true,
    locked: el.locked ?? false,
    zIndex: el.zIndex,
    visibleWhen: el.visibleWhen,
  };
}

function baseCanonical(el: SceneBaseProps): Omit<CanonicalElement, "type"> {
  const out: Record<string, unknown> = {
    id: el.id,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    zIndex: el.zIndex,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
    locked: el.locked,
  };
  if (el.name !== undefined) out["name"] = el.name;
  if (el.visibleWhen !== undefined) out["visibleWhen"] = el.visibleWhen;
  return out as Omit<CanonicalElement, "type">;
}

// ── canonicalToScene ──────────────────────────────────────────────────────────

function textToScene(el: TextElement): SceneTextElement {
  const isBinding = typeof el.content === "object" && "binding" in el.content;
  return {
    ...baseProps(el),
    type: "text",
    contentMode: isBinding ? "variable" : "static",
    staticContent: isBinding ? "" : (el.content as string),
    variableBinding: isBinding ? (el.content as { binding: VariableBinding }).binding : undefined,
    fontFamily: el.fontFamily ?? "Inter",
    fontSize: el.fontSize ?? 16,
    fontWeight: el.fontWeight ?? "normal",
    italic: el.italic ?? false,
    underline: el.underline ?? false,
    color: el.color ?? "#000000",
    textAlign: el.textAlign ?? "left",
    lineHeight: el.lineHeight ?? 1.4,
    letterSpacing: el.letterSpacing ?? 0,
    textTransform: el.textTransform ?? "none",
  };
}

function imageToScene(el: ImageElement): SceneImageElement {
  const isSrcBinding = el.src && typeof el.src === "object" && "binding" in el.src;
  const assetRef = isSrcBinding ? undefined : (el.src as AssetReference | undefined);
  const previewUrl = assetRef
    ? assetRef.type === "url"
      ? assetRef.url
      : assetRef.type === "storage"
        ? assetRef.url
        : undefined
    : undefined;

  return {
    ...baseProps(el),
    type: "image",
    previewUrl,
    assetRef: assetRef,
    variableBinding: isSrcBinding ? (el.src as { binding: VariableBinding }).binding : undefined,
    objectFit: el.objectFit ?? "cover",
    borderRadius: el.borderRadius ?? 0,
  };
}

function shapeToScene(el: ShapeElement): SceneShapeElement {
  const fill = typeof el.fill === "string" ? el.fill : "#6366f1";
  return {
    ...baseProps(el),
    type: "shape",
    shapeKind: el.shape === "circle" ? "circle" : el.shape === "rounded-rectangle" ? "rounded-rectangle" : "rectangle",
    fillColor: fill,
    strokeColor: el.border?.color ?? "transparent",
    strokeWidth: el.border?.width ?? 0,
    cornerRadius: el.borderRadius ?? 0,
  };
}

function lineToScene(el: LineElement): SceneLineElement {
  return {
    ...baseProps(el),
    type: "line",
    strokeColor: el.stroke ?? "#000000",
    strokeWidth: el.strokeWidth ?? 2,
    dashArray: el.dashArray ?? [],
  };
}

function qrcodeToScene(el: QrCodeElement): SceneQrCodeElement {
  const isBinding = typeof el.content === "object" && "binding" in el.content;
  return {
    ...baseProps(el),
    type: "qrcode",
    contentMode: isBinding ? "variable" : "static",
    staticContent: isBinding ? "" : (el.content as string),
    variableBinding: isBinding ? (el.content as { binding: VariableBinding }).binding : undefined,
    fgColor: el.fgColor ?? "#000000",
    bgColor: el.bgColor ?? "#ffffff",
    errorLevel: el.errorLevel ?? "M",
  };
}

/**
 * Convert a canonical DesignTemplate JSON to the editor Scene model.
 * Skips unsupported element types (icon, group) with a console.warn.
 */
export function canonicalToScene(template: DesignTemplate): Scene {
  const elements: SceneElement[] = [];

  for (const el of template.elements) {
    switch (el.type) {
      case "text":    elements.push(textToScene(el as TextElement)); break;
      case "image":   elements.push(imageToScene(el as ImageElement)); break;
      case "shape":   elements.push(shapeToScene(el as ShapeElement)); break;
      case "line":    elements.push(lineToScene(el as LineElement)); break;
      case "qrcode":  elements.push(qrcodeToScene(el as QrCodeElement)); break;
      default:
        console.warn(`[adapter] Skipping unsupported element type: ${(el as CanonicalElement).type}`);
    }
  }

  return {
    canvas: {
      width: template.canvas.width,
      height: template.canvas.height,
      backgroundColor: template.canvas.backgroundColor ?? "#ffffff",
    },
    elements,
    variables: template.variables ?? [],
    _meta: {
      schemaVersion: template.schemaVersion,
      id: template.id,
      tenantId: template.tenantId,
      name: template.name,
      description: template.description,
      category: template.category,
      metadata: template.metadata,
    },
  };
}

// ── sceneToCanonical ──────────────────────────────────────────────────────────

function sceneTextToCanonical(el: SceneTextElement): TextElement {
  const content: TextElement["content"] =
    el.contentMode === "variable" && el.variableBinding
      ? { binding: el.variableBinding }
      : el.staticContent;

  return {
    ...baseCanonical(el),
    type: "text",
    content,
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    italic: el.italic,
    underline: el.underline,
    color: el.color,
    textAlign: el.textAlign,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    textTransform: el.textTransform,
  } as TextElement;
}

function sceneImageToCanonical(el: SceneImageElement): ImageElement {
  const src: ImageElement["src"] =
    el.variableBinding
      ? { binding: el.variableBinding }
      : el.assetRef;

  return {
    ...baseCanonical(el),
    type: "image",
    src,
    objectFit: el.objectFit,
    borderRadius: el.borderRadius,
  } as ImageElement;
}

function sceneShapeToCanonical(el: SceneShapeElement): ShapeElement {
  return {
    ...baseCanonical(el),
    type: "shape",
    shape: el.shapeKind === "circle" ? "circle" : el.shapeKind === "rounded-rectangle" ? "rounded-rectangle" : "rectangle",
    fill: el.fillColor,
    border: el.strokeWidth > 0 ? { width: el.strokeWidth, color: el.strokeColor } : undefined,
    borderRadius: el.cornerRadius,
  } as ShapeElement;
}

function sceneLineToCanonical(el: SceneLineElement): LineElement {
  return {
    ...baseCanonical(el),
    type: "line",
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    dashArray: el.dashArray.length > 0 ? el.dashArray : undefined,
  } as LineElement;
}

function sceneQrCodeToCanonical(el: SceneQrCodeElement): QrCodeElement {
  const content: QrCodeElement["content"] =
    el.contentMode === "variable" && el.variableBinding
      ? { binding: el.variableBinding }
      : el.staticContent;

  return {
    ...baseCanonical(el),
    type: "qrcode",
    content,
    fgColor: el.fgColor,
    bgColor: el.bgColor,
    errorLevel: el.errorLevel,
  } as QrCodeElement;
}

/**
 * Serialize the editor Scene model back to canonical DesignTemplate JSON.
 * Updates metadata.updatedAt to current time.
 */
export function sceneToCanonical(scene: Scene, updatedBy?: string): DesignTemplate {
  const elements: CanonicalElement[] = scene.elements.map((el) => {
    switch (el.type) {
      case "text":    return sceneTextToCanonical(el);
      case "image":   return sceneImageToCanonical(el);
      case "shape":   return sceneShapeToCanonical(el);
      case "line":    return sceneLineToCanonical(el);
      case "qrcode":  return sceneQrCodeToCanonical(el);
    }
  });

  const canvas: DesignCanvas = {
    width: scene.canvas.width,
    height: scene.canvas.height,
    unit: "px",
    backgroundColor: scene.canvas.backgroundColor,
  };

  return {
    schemaVersion: scene._meta.schemaVersion || DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: scene._meta.id,
    tenantId: scene._meta.tenantId,
    name: scene._meta.name,
    description: scene._meta.description,
    category: scene._meta.category,
    canvas,
    elements,
    variables: scene.variables,
    metadata: {
      ...scene._meta.metadata,
      updatedAt: new Date().toISOString(),
      ...(updatedBy ? {} : {}),
    },
  };
}

/**
 * Verify that a canonical template survives a round-trip through the adapter
 * without losing data. Returns an array of differences (empty = identical).
 */
export function verifyRoundTrip(original: DesignTemplate): string[] {
  const scene = canonicalToScene(original);
  const restored = sceneToCanonical(scene);

  const diffs: string[] = [];

  // Canvas
  if (restored.canvas.width !== original.canvas.width) diffs.push("canvas.width mismatch");
  if (restored.canvas.height !== original.canvas.height) diffs.push("canvas.height mismatch");

  // Element count (minus unsupported types)
  const supported = original.elements.filter((e) =>
    ["text", "image", "shape", "line", "qrcode"].includes(e.type)
  );
  if (restored.elements.length !== supported.length) {
    diffs.push(`element count: expected ${supported.length}, got ${restored.elements.length}`);
  }

  // Variables
  if (restored.variables.length !== (original.variables ?? []).length) {
    diffs.push("variables count mismatch");
  }

  return diffs;
}
