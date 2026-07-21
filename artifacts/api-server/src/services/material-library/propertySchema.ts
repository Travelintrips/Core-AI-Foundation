/**
 * material-library/propertySchema.ts — Team 21
 *
 * Generic property value validation for MaterialPropertyDefinition.
 * All property logic lives here so the service layer stays policy-free.
 *
 * Rules:
 *   - Validation returns a typed result, never throws.
 *   - Unknown type is an explicit error, not a silent pass.
 *   - Domain-specific properties must live in plugin/category data, never here.
 */

import type { MaterialPropertyDefinition, MaterialPropertyValue, PropertyType } from "./types.js";

export interface PropertyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const OK: PropertyValidationResult = { valid: true, errors: [] };

function err(...msgs: string[]): PropertyValidationResult {
  return { valid: false, errors: msgs };
}

/**
 * Validate a single property value against its definition.
 * Returns { valid: true } on success, or { valid: false, errors: [...] } on failure.
 */
export function validatePropertyValue(
  def: MaterialPropertyDefinition,
  value: MaterialPropertyValue,
): PropertyValidationResult {
  if (value === null || value === undefined) {
    if (def.required) return err(`Property "${def.propertyId}" is required but was null/undefined`);
    return OK;
  }

  switch (def.type as PropertyType) {
    case "text":
      if (typeof value !== "string") return err(`Property "${def.propertyId}" must be a string`);
      return OK;

    case "number": {
      if (typeof value !== "number" || isNaN(value))
        return err(`Property "${def.propertyId}" must be a number`);
      const errors: string[] = [];
      if (def.min !== undefined && value < def.min)
        errors.push(`Property "${def.propertyId}" must be ≥ ${def.min} (got ${value})`);
      if (def.max !== undefined && value > def.max)
        errors.push(`Property "${def.propertyId}" must be ≤ ${def.max} (got ${value})`);
      return errors.length ? { valid: false, errors } : OK;
    }

    case "boolean":
      if (typeof value !== "boolean") return err(`Property "${def.propertyId}" must be a boolean`);
      return OK;

    case "enum": {
      if (typeof value !== "string") return err(`Property "${def.propertyId}" (enum) must be a string`);
      const opts = def.enumOptions ?? [];
      if (opts.length > 0 && !opts.includes(value))
        return err(`Property "${def.propertyId}" must be one of: ${opts.join(", ")} (got "${value}")`);
      return OK;
    }

    case "range": {
      if (typeof value !== "object" || value === null || !("min" in value) || !("max" in value))
        return err(`Property "${def.propertyId}" (range) must be { min: number, max: number }`);
      const r = value as { min: number; max: number };
      if (typeof r.min !== "number" || typeof r.max !== "number")
        return err(`Property "${def.propertyId}" range min/max must be numbers`);
      if (r.min > r.max)
        return err(`Property "${def.propertyId}" range min (${r.min}) must not exceed max (${r.max})`);
      if (def.min !== undefined && r.min < def.min)
        return err(`Property "${def.propertyId}" range min must be ≥ ${def.min}`);
      if (def.max !== undefined && r.max > def.max)
        return err(`Property "${def.propertyId}" range max must be ≤ ${def.max}`);
      return OK;
    }

    case "color": {
      if (typeof value !== "string")
        return err(`Property "${def.propertyId}" (color) must be a hex string`);
      if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value))
        return err(`Property "${def.propertyId}" (color) must be a valid hex color (e.g. #RGB, #RRGGBB, #RRGGBBAA)`);
      return OK;
    }

    case "measurement": {
      if (typeof value !== "object" || value === null || !("value" in value) || !("unit" in value))
        return err(`Property "${def.propertyId}" (measurement) must be { value: number, unit: string }`);
      const m = value as { value: unknown; unit: unknown };
      if (typeof m.value !== "number") return err(`Property "${def.propertyId}" measurement.value must be a number`);
      if (typeof m.unit !== "string") return err(`Property "${def.propertyId}" measurement.unit must be a string`);
      return OK;
    }

    case "percentage": {
      if (typeof value !== "number" || isNaN(value))
        return err(`Property "${def.propertyId}" (percentage) must be a number`);
      if (value < 0 || value > 100)
        return err(`Property "${def.propertyId}" (percentage) must be between 0 and 100 (got ${value})`);
      return OK;
    }

    case "reference":
    case "texture_asset": {
      if (typeof value !== "object" || value === null || !("assetId" in value))
        return err(`Property "${def.propertyId}" (${def.type}) must be { assetId: string, url: string }`);
      const ref = value as { assetId: unknown; url: unknown };
      if (typeof ref.assetId !== "string" || !ref.assetId)
        return err(`Property "${def.propertyId}" assetId must be a non-empty string`);
      if (typeof ref.url !== "string" || !ref.url.startsWith("https://"))
        return err(`Property "${def.propertyId}" url must be a safe https:// URL`);
      return OK;
    }

    case "metadata":
      // metadata is an open Record; we only require it is an object
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return err(`Property "${def.propertyId}" (metadata) must be a plain object`);
      return OK;

    default:
      return err(`Property "${def.propertyId}" has unknown type: "${def.type}"`);
  }
}

/**
 * Validate all properties of a material against a set of definitions.
 * Returns a merged result covering all property errors.
 */
export function validateAllProperties(
  definitions: readonly MaterialPropertyDefinition[],
  properties: Readonly<Record<string, MaterialPropertyValue>>,
): PropertyValidationResult {
  const errors: string[] = [];

  for (const def of definitions) {
    const val = properties[def.propertyId] ?? null;
    const result = validatePropertyValue(def, val);
    if (!result.valid) errors.push(...result.errors);
  }

  // Check for extra properties not in definitions (warn but don't fail)
  // This is intentionally permissive for forward-compatibility with plugin extensions.

  return errors.length ? { valid: false, errors } : OK;
}
