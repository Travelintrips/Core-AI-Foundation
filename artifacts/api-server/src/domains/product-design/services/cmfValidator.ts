/**
 * product-design — CMF Validator
 *
 * Validates Color / Material / Finish specifications.
 * Checks color code format, enum membership, and zone uniqueness.
 * All validations are concept-stage only.
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import type { CMFEntry, CMFSpec } from "../types/concept";
import { ALL_MATERIAL_CLASSES, ALL_FINISH_TYPES } from "../types/concept";

// ── Color code validation ──────────────────────────────────────────────────────

const HEX_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
// Pantone format: "Pantone 185 C", "PMS 485", etc.
const PANTONE_REGEX = /^(pantone|pms)\s[\w\s-]+$/i;
// RAL format: "RAL 9010", "RAL Classic 1013"
const RAL_REGEX = /^ral\s[\w\s]+$/i;

export function isValidColorCode(code: string): boolean {
  return (
    HEX_REGEX.test(code) ||
    PANTONE_REGEX.test(code) ||
    RAL_REGEX.test(code)
  );
}

// ── CMF entry validation ───────────────────────────────────────────────────────

export interface CMFEntryValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateCMFEntry(entry: CMFEntry, index: number): CMFEntryValidationResult {
  const errors: string[] = [];
  const tag = `CMF entry [${index}] (zone "${entry.zone}")`;

  if (!isValidColorCode(entry.colorCode)) {
    errors.push(
      `${tag}: colorCode "${entry.colorCode}" is not a recognised format. ` +
      `Use a hex code (#RRGGBB), Pantone ("Pantone 185 C"), or RAL ("RAL 9010").`,
    );
  }

  if (!entry.colorName || entry.colorName.trim().length === 0) {
    errors.push(`${tag}: colorName must not be empty.`);
  }

  if (!ALL_MATERIAL_CLASSES.includes(entry.material)) {
    errors.push(
      `${tag}: material "${entry.material}" is not a recognised MaterialClass. ` +
      `Valid values: ${ALL_MATERIAL_CLASSES.join(", ")}.`,
    );
  }

  if (!ALL_FINISH_TYPES.includes(entry.finish)) {
    errors.push(
      `${tag}: finish "${entry.finish}" is not a recognised FinishType. ` +
      `Valid values: ${ALL_FINISH_TYPES.join(", ")}.`,
    );
  }

  if (!entry.zone || entry.zone.trim().length === 0) {
    errors.push(`${tag}: zone must not be empty.`);
  }

  return { valid: errors.length === 0, errors };
}

// ── CMF spec validation ────────────────────────────────────────────────────────

export interface CMFSpecValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  duplicateZones: string[];
}

/**
 * Validates a full CMFSpec.
 * - Each entry passes individual validation.
 * - No two entries share the same zone (duplicate zone = ambiguous output).
 * - Warns if fewer than 2 zones are defined (usually insufficient for a concept).
 */
export function validateCMFSpec(spec: CMFSpec): CMFSpecValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const zoneSeen = new Map<string, number>();
  const duplicateZones: string[] = [];

  if (!Array.isArray(spec.entries) || spec.entries.length === 0) {
    errors.push("CMF spec must contain at least one entry.");
    return { valid: false, errors, warnings, duplicateZones };
  }

  spec.entries.forEach((entry, i) => {
    const result = validateCMFEntry(entry, i);
    if (!result.valid) errors.push(...result.errors);

    const normalizedZone = entry.zone.trim().toLowerCase();
    if (zoneSeen.has(normalizedZone)) {
      if (!duplicateZones.includes(normalizedZone)) {
        duplicateZones.push(normalizedZone);
        errors.push(
          `CMF spec: zone "${entry.zone}" appears more than once. ` +
          `Each zone must have exactly one CMF entry.`,
        );
      }
    } else {
      zoneSeen.set(normalizedZone, i);
    }
  });

  if (spec.entries.length < 2) {
    warnings.push(
      "CMF spec has only one zone. Most product concepts require at least " +
      "two zones (e.g. body + cap). Consider adding more entries.",
    );
  }

  return { valid: errors.length === 0, errors, warnings, duplicateZones };
}
