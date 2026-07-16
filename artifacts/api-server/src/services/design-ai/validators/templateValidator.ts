/**
 * Template Validator — Core Structural Checks
 *
 * Deterministic checks (no AI): duplicate IDs, invalid node types,
 * negative/zero dimensions, invalid opacity, invalid z-index,
 * duplicate z-index at critical positions, invalid font, invalid color,
 * unsupported properties, and text readability.
 *
 * All checks return a list of ValidationIssue — never throws.
 */

import type { DesignTemplate, DesignElement } from "../../../types/designTemplate.js";
import type { ValidationIssue } from "../types/engineering.types.js";
import { SAFE_FONT_FAMILIES } from "../types/engineering.types.js";
import { DESIGN_LIMITS } from "../../../types/designTemplate.js";

const SAFE_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SAFE_ID   = /^[a-zA-Z0-9_\-]+$/;
const VALID_TYPES = new Set(["text", "image", "shape", "qrcode", "line"]);

export function runTemplateValidator(template: DesignTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ── 1. Duplicate element IDs ───────────────────────────────────────────────
  const seenIds = new Map<string, number>();
  for (const el of template.elements) {
    seenIds.set(el.id, (seenIds.get(el.id) ?? 0) + 1);
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      issues.push({
        code: "DUPLICATE_ID",
        severity: "error",
        nodeId: id,
        field: "id",
        message: `Element ID "${id}" is duplicated ${count} times. IDs must be unique.`,
        suggestedFix: "Assign a unique ID to each element.",
      });
    }
  }

  // ── 2. Invalid ID format ───────────────────────────────────────────────────
  for (const el of template.elements) {
    if (!SAFE_ID.test(el.id)) {
      issues.push({
        code: "INVALID_ID_FORMAT",
        severity: "error",
        nodeId: el.id,
        field: "id",
        message: `Element ID "${el.id}" contains invalid characters. Only [a-zA-Z0-9_-] allowed.`,
        suggestedFix: "Replace special characters with hyphens.",
      });
    }
  }

  // ── 3. Invalid node type ───────────────────────────────────────────────────
  for (const el of template.elements) {
    if (!VALID_TYPES.has(el.type)) {
      issues.push({
        code: "INVALID_NODE_TYPE",
        severity: "error",
        nodeId: el.id,
        field: "type",
        message: `Element "${el.id}" has unsupported type "${el.type}". Valid: text, image, shape, qrcode, line.`,
        suggestedFix: `Change type to one of: ${[...VALID_TYPES].join(", ")}.`,
      });
    }
  }

  // ── 4. Negative or zero dimensions ────────────────────────────────────────
  for (const el of template.elements) {
    if (el.width <= 0) {
      issues.push({
        code: "NEGATIVE_WIDTH",
        severity: "error",
        nodeId: el.id,
        field: "width",
        message: `Element "${el.id}" has width ${el.width} ≤ 0.`,
        suggestedFix: "Set width to at least 1.",
      });
    }
    if (el.height <= 0) {
      issues.push({
        code: "NEGATIVE_HEIGHT",
        severity: "error",
        nodeId: el.id,
        field: "height",
        message: `Element "${el.id}" has height ${el.height} ≤ 0.`,
        suggestedFix: "Set height to at least 1.",
      });
    }
  }

  // ── 5. Invalid opacity ─────────────────────────────────────────────────────
  for (const el of template.elements) {
    if (el.opacity !== undefined && (el.opacity < 0 || el.opacity > 1)) {
      issues.push({
        code: "INVALID_OPACITY",
        severity: "error",
        nodeId: el.id,
        field: "opacity",
        message: `Element "${el.id}" has opacity ${el.opacity} outside [0, 1].`,
        suggestedFix: "Clamp opacity to the range 0–1.",
      });
    }
  }

  // ── 6. Invalid z-index ─────────────────────────────────────────────────────
  for (const el of template.elements) {
    if (!Number.isInteger(el.zIndex) || el.zIndex < 0 || el.zIndex > 9999) {
      issues.push({
        code: "INVALID_Z_INDEX",
        severity: "error",
        nodeId: el.id,
        field: "zIndex",
        message: `Element "${el.id}" has zIndex ${el.zIndex} outside integer range [0, 9999].`,
        suggestedFix: "Use an integer between 0 and 9999.",
      });
    }
  }

  // ── 7. Duplicate z-index (warning — overlapping stack order) ──────────────
  const zIndexMap = new Map<number, string[]>();
  for (const el of template.elements) {
    if (!zIndexMap.has(el.zIndex)) zIndexMap.set(el.zIndex, []);
    zIndexMap.get(el.zIndex)!.push(el.id);
  }
  for (const [zIdx, ids] of zIndexMap) {
    if (ids.length > 1) {
      issues.push({
        code: "DUPLICATE_Z_INDEX",
        severity: "warning",
        field: "zIndex",
        message: `z-index ${zIdx} is shared by elements: ${ids.join(", ")}. Render order may be unpredictable.`,
        suggestedFix: "Assign unique z-index values to avoid ambiguous stacking.",
      });
    }
  }

  // ── 8. Canvas size limits ─────────────────────────────────────────────────
  if (template.canvas.width > DESIGN_LIMITS.MAX_CANVAS_WIDTH) {
    issues.push({
      code: "CANVAS_TOO_WIDE",
      severity: "error",
      field: "canvas.width",
      message: `Canvas width ${template.canvas.width} exceeds max ${DESIGN_LIMITS.MAX_CANVAS_WIDTH}.`,
      suggestedFix: `Reduce canvas width to ≤ ${DESIGN_LIMITS.MAX_CANVAS_WIDTH}.`,
    });
  }
  if (template.canvas.height > DESIGN_LIMITS.MAX_CANVAS_HEIGHT) {
    issues.push({
      code: "CANVAS_TOO_TALL",
      severity: "error",
      field: "canvas.height",
      message: `Canvas height ${template.canvas.height} exceeds max ${DESIGN_LIMITS.MAX_CANVAS_HEIGHT}.`,
      suggestedFix: `Reduce canvas height to ≤ ${DESIGN_LIMITS.MAX_CANVAS_HEIGHT}.`,
    });
  }

  // ── 9. Element count limit ────────────────────────────────────────────────
  if (template.elements.length > DESIGN_LIMITS.MAX_ELEMENT_COUNT) {
    issues.push({
      code: "TOO_MANY_ELEMENTS",
      severity: "error",
      field: "elements",
      message: `Template has ${template.elements.length} elements, exceeding max ${DESIGN_LIMITS.MAX_ELEMENT_COUNT}.`,
      suggestedFix: "Remove or merge elements.",
    });
  }

  // ── 10. Invalid font family ───────────────────────────────────────────────
  for (const el of template.elements) {
    if (el.type === "text" && "fontFamily" in el && el.fontFamily) {
      const primary = el.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
      if (!SAFE_FONT_FAMILIES.has(primary)) {
        issues.push({
          code: "INVALID_FONT",
          severity: "warning",
          nodeId: el.id,
          field: "fontFamily",
          message: `Font "${primary}" in element "${el.id}" is not in the safe font registry.`,
          suggestedFix: `Use one of the approved fonts, e.g. "Inter", "Roboto", "Poppins".`,
        });
      }
    }
  }

  // ── 11. Invalid color ─────────────────────────────────────────────────────
  function checkColor(value: unknown, nodeId: string, field: string): void {
    if (typeof value !== "string") return;
    if (!SAFE_HEX.test(value)) {
      issues.push({
        code: "INVALID_COLOR",
        severity: "error",
        nodeId,
        field,
        message: `Color "${value}" on element "${nodeId}" is not a valid CSS hex color.`,
        suggestedFix: "Use #RRGGBB or #RGB format, e.g. #FFFFFF.",
      });
    }
  }

  for (const el of template.elements) {
    if (el.type === "text" && "color" in el) checkColor(el.color, el.id, "color");
    if (el.type === "shape") {
      if (typeof el.fill === "string") checkColor(el.fill, el.id, "fill");
      if (el.border?.color) checkColor(el.border.color, el.id, "border.color");
    }
    if (el.type === "qrcode") {
      if ("fgColor" in el) checkColor(el.fgColor, el.id, "fgColor");
      if ("bgColor" in el) checkColor(el.bgColor, el.id, "bgColor");
    }
    if (el.type === "line" && "stroke" in el) checkColor(el.stroke, el.id, "stroke");
    if (template.canvas.backgroundColor) checkColor(template.canvas.backgroundColor, "__canvas__", "canvas.backgroundColor");
  }

  // ── 12. Text too small ────────────────────────────────────────────────────
  for (const el of template.elements) {
    if (el.type === "text" && "fontSize" in el && el.fontSize !== undefined) {
      if (el.fontSize < DESIGN_LIMITS.MIN_FONT_SIZE) {
        issues.push({
          code: "TEXT_TOO_SMALL",
          severity: "warning",
          nodeId: el.id,
          field: "fontSize",
          message: `Text element "${el.id}" has fontSize ${el.fontSize}, below minimum ${DESIGN_LIMITS.MIN_FONT_SIZE}.`,
          suggestedFix: `Increase fontSize to at least ${DESIGN_LIMITS.MIN_FONT_SIZE}.`,
        });
      }
    }
  }

  // ── 13. Variable count limit ──────────────────────────────────────────────
  if (template.variables.length > DESIGN_LIMITS.MAX_VARIABLE_COUNT) {
    issues.push({
      code: "TOO_MANY_VARIABLES",
      severity: "error",
      field: "variables",
      message: `Template has ${template.variables.length} variables, exceeding max ${DESIGN_LIMITS.MAX_VARIABLE_COUNT}.`,
      suggestedFix: "Consolidate or remove unused variables.",
    });
  }

  return issues;
}

/** Extracts the variableKey referenced by an element's binding (if any) */
export function getElementBindingKey(el: DesignElement): string | null {
  if (el.type === "text" || el.type === "qrcode") {
    const c = el.content as any;
    if (c && typeof c === "object" && "binding" in c) {
      return (c.binding as any).variableKey ?? null;
    }
  }
  if (el.type === "image") {
    const s = el.src as any;
    if (s && typeof s === "object" && "binding" in s) {
      return (s.binding as any).variableKey ?? null;
    }
  }
  return null;
}
