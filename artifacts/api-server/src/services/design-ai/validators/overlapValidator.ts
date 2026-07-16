/**
 * Overlap Validator — Dangerous Overlaps & CTA Visibility
 *
 * Detects:
 *  - Elements that fully cover a CTA (call-to-action) element.
 *  - Unsafe overlaps: a higher-z opaque element completely covers a meaningful element.
 *
 * "CTA" is identified by element name containing "cta", "button", "action",
 * or "call-to-action" (case-insensitive).
 *
 * Deterministic — no AI calls.
 */

import type { DesignTemplate, DesignElement } from "../../../types/designTemplate.js";
import type { ValidationIssue } from "../types/engineering.types.js";

function isCta(el: DesignElement): boolean {
  const name = (el.name ?? "").toLowerCase();
  return /cta|button|action|call.to.action/.test(name);
}

function rectsIntersect(a: DesignElement, b: DesignElement): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectFullyCovers(cover: DesignElement, target: DesignElement): boolean {
  return (
    cover.x <= target.x &&
    cover.y <= target.y &&
    cover.x + cover.width  >= target.x + target.width &&
    cover.y + cover.height >= target.y + target.height
  );
}

/** Returns true if an element appears visually solid (not transparent) */
function isSolidElement(el: DesignElement): boolean {
  const opacity = el.opacity ?? 1;
  if (opacity < 0.1) return false; // effectively invisible
  if (el.type === "shape" && typeof el.fill === "string" && el.fill) return true;
  if (el.type === "image") return true;
  return false;
}

export function runOverlapValidator(template: DesignTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);

  for (let i = 0; i < elements.length; i++) {
    const lower = elements[i];
    if (!lower.visible && lower.visible !== undefined) continue;

    for (let j = i + 1; j < elements.length; j++) {
      const upper = elements[j];
      if (!upper.visible && upper.visible !== undefined) continue;
      if (!isSolidElement(upper)) continue;

      // Skip if they don't overlap at all
      if (!rectsIntersect(lower, upper)) continue;

      // ── CTA covered check ──────────────────────────────────────────────────
      if (isCta(lower) && rectFullyCovers(upper, lower)) {
        issues.push({
          code: "CTA_COVERED",
          severity: "error",
          nodeId: lower.id,
          message: `CTA element "${lower.id}" (zIndex:${lower.zIndex}) is fully covered by "${upper.id}" (zIndex:${upper.zIndex}).`,
          suggestedFix: `Move "${upper.id}" below the CTA in z-order, or reposition to avoid covering the CTA.`,
        });
        continue;
      }

      // ── Unsafe overlap: non-background fully covers a meaningful element ───
      const upperIsBackground = (upper.name ?? "").toLowerCase().includes("bg") ||
                                (upper.name ?? "").toLowerCase().includes("background");
      if (!upperIsBackground && rectFullyCovers(upper, lower) && upper.zIndex > lower.zIndex + 1) {
        issues.push({
          code: "UNSAFE_OVERLAP",
          severity: "warning",
          nodeId: lower.id,
          message: `Element "${lower.id}" (zIndex:${lower.zIndex}) is fully covered by "${upper.id}" (zIndex:${upper.zIndex}) and may be invisible.`,
          suggestedFix: `Check if "${lower.id}" is intentionally hidden, or adjust z-index/position.`,
        });
      }
    }
  }

  return issues;
}
