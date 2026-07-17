// ============================================================
// TEAM 12 — Responsive Variants
// Generates layout variants for standard breakpoints
// ============================================================

import type {
  LayoutElement,
  LayoutCanvas,
  LayoutRequest,
  ResponsiveBreakpoint,
  Constraint,
} from "../../types/layout-composer/index.js";

export interface BreakpointDef {
  name: string;
  minWidth: number;
  maxWidth?: number;
  label: string;
}

export const STANDARD_BREAKPOINTS: BreakpointDef[] = [
  { name: "xs",  minWidth: 0,    maxWidth: 479,  label: "Mobile Small"  },
  { name: "sm",  minWidth: 480,  maxWidth: 767,  label: "Mobile"        },
  { name: "md",  minWidth: 768,  maxWidth: 1023, label: "Tablet"        },
  { name: "lg",  minWidth: 1024, maxWidth: 1279, label: "Desktop"       },
  { name: "xl",  minWidth: 1280,                 label: "Desktop Large" },
];

/**
 * Scale element positions and sizes proportionally when canvas width changes.
 * Preserves aspect ratios and relative positions.
 */
export function scaleElementsToCanvas(
  elements: LayoutElement[],
  fromCanvas: LayoutCanvas,
  toCanvas: LayoutCanvas
): LayoutElement[] {
  const scaleX = toCanvas.width / fromCanvas.width;
  const scaleY = toCanvas.height / fromCanvas.height;

  return elements.map((el) => ({
    ...el,
    x: Math.round(el.x * scaleX),
    y: Math.round(el.y * scaleY),
    width: Math.round(el.width * scaleX),
    height: Math.round(el.height * scaleY),
    textStyle: el.textStyle
      ? {
          ...el.textStyle,
          fontSize: Math.max(8, Math.round(el.textStyle.fontSize * Math.min(scaleX, scaleY))),
        }
      : undefined,
  }));
}

/**
 * Apply breakpoint-specific overrides from responsive constraints to elements.
 */
export function applyResponsiveOverrides(
  elements: LayoutElement[],
  constraints: Constraint[],
  breakpointName: string
): LayoutElement[] {
  // Collect overrides for this breakpoint from responsive constraints
  const overrideMap = new Map<string, Partial<LayoutElement>>();

  for (const constraint of constraints) {
    if (constraint.type !== "responsive") continue;
    const params = constraint.params as { breakpoints?: ResponsiveBreakpoint[] };
    if (!params?.breakpoints) continue;

    const bp = params.breakpoints.find((b) => b.name === breakpointName);
    if (!bp) continue;

    for (const elementId of constraint.elementIds) {
      const existing = overrideMap.get(elementId) ?? {};
      overrideMap.set(elementId, { ...existing, ...bp.overrides });
    }
  }

  return elements.map((el) => {
    const overrides = overrideMap.get(el.id);
    if (!overrides) return el;
    return { ...el, ...overrides };
  });
}

/**
 * Build a canvas scaled to the representative width of a breakpoint.
 */
export function canvasForBreakpoint(
  original: LayoutCanvas,
  bp: BreakpointDef
): LayoutCanvas {
  // Use midpoint of breakpoint range, or minWidth if no max
  const targetWidth = bp.maxWidth
    ? Math.round((bp.minWidth + bp.maxWidth) / 2)
    : bp.minWidth + 240; // arbitrary wide for xl

  const scaleX = targetWidth / original.width;
  const targetHeight = Math.round(original.height * scaleX);

  return {
    ...original,
    width: targetWidth,
    height: targetHeight,
    padding: original.padding
      ? {
          top: Math.round((original.padding.top ?? 0) * scaleX),
          right: Math.round((original.padding.right ?? 0) * scaleX),
          bottom: Math.round((original.padding.bottom ?? 0) * scaleX),
          left: Math.round((original.padding.left ?? 0) * scaleX),
        }
      : undefined,
    safeZone: original.safeZone
      ? {
          x: Math.round(original.safeZone.x * scaleX),
          y: Math.round(original.safeZone.y * scaleX),
          width: Math.round(original.safeZone.width * scaleX),
          height: Math.round(original.safeZone.height * scaleX),
        }
      : undefined,
  };
}

/**
 * Determine which breakpoint a given canvas width falls into.
 */
export function detectBreakpoint(canvasWidth: number): BreakpointDef {
  for (let i = STANDARD_BREAKPOINTS.length - 1; i >= 0; i--) {
    if (canvasWidth >= STANDARD_BREAKPOINTS[i].minWidth) {
      return STANDARD_BREAKPOINTS[i];
    }
  }
  return STANDARD_BREAKPOINTS[0];
}

/**
 * Produce a sub-request for a specific breakpoint.
 * The solver will run on this to produce a responsive variant plan.
 */
export function buildBreakpointRequest(
  original: LayoutRequest,
  bp: BreakpointDef
): LayoutRequest {
  const variantCanvas = canvasForBreakpoint(original.canvas, bp);
  const scaled = scaleElementsToCanvas(original.elements, original.canvas, variantCanvas);
  const withOverrides = applyResponsiveOverrides(scaled, original.constraints, bp.name);

  // Filter out responsive constraints (they're already applied)
  const nonResponsive = original.constraints.filter((c) => c.type !== "responsive");

  return {
    ...original,
    id: `${original.id ?? "plan"}-${bp.name}`,
    canvas: variantCanvas,
    elements: withOverrides,
    constraints: nonResponsive,
    includeResponsive: false, // avoid infinite recursion
  };
}
