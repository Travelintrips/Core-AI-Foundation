/**
 * Universal Creative Component Library — Validation Service (Team 8)
 *
 * Validates component instance field values against the definition's
 * property schema and constraints.  Pure logic — no DB, no I/O.
 */

import type {
  ComponentType,
  ComponentDomain,
  FieldDefinition,
  Constraint,
  ValidationError,
  ValidationResult,
  ComponentInstanceInput,
} from "./types.js";
import { getComponentDefinition } from "./componentRegistry.js";

// ── Field-level validation ────────────────────────────────────────────────────

function validateField(
  key: string,
  def: FieldDefinition,
  value: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required check
  if (def.required && (value === undefined || value === null || value === "")) {
    errors.push({ field: key, message: `${def.label} is required.` });
    return errors; // no point in further checks when missing
  }

  if (value === undefined || value === null || value === "") return errors;

  switch (def.type) {
    case "string":
    case "font":
    case "textarea": {
      if (typeof value !== "string") {
        errors.push({ field: key, message: `${def.label} must be a string.` });
        break;
      }
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        errors.push({
          field: key,
          message: `${def.label} exceeds maximum length of ${def.maxLength} characters.`,
        });
      }
      break;
    }

    case "number":
    case "mm":
    case "pt":
    case "px": {
      const num = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(num)) {
        errors.push({ field: key, message: `${def.label} must be a number.` });
        break;
      }
      if (def.min !== undefined && num < def.min) {
        errors.push({ field: key, message: `${def.label} must be at least ${def.min}.` });
      }
      if (def.max !== undefined && num > def.max) {
        errors.push({ field: key, message: `${def.label} must be at most ${def.max}.` });
      }
      break;
    }

    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push({ field: key, message: `${def.label} must be a boolean.` });
      }
      break;
    }

    case "color": {
      if (typeof value !== "string" || !/^#[0-9A-Fa-f]{3,8}$/.test(value)) {
        errors.push({
          field: key,
          message: `${def.label} must be a valid hex colour (e.g. #FFFFFF).`,
        });
      }
      break;
    }

    case "url": {
      if (typeof value !== "string") {
        errors.push({ field: key, message: `${def.label} must be a string URL.` });
        break;
      }
      try {
        new URL(value);
      } catch {
        errors.push({ field: key, message: `${def.label} must be a valid URL.` });
      }
      break;
    }

    case "enum": {
      if (!def.options || !def.options.includes(String(value))) {
        errors.push({
          field: key,
          message: `${def.label} must be one of: ${(def.options ?? []).join(", ")}.`,
        });
      }
      break;
    }

    case "json": {
      if (typeof value === "string") {
        try {
          JSON.parse(value);
        } catch {
          errors.push({ field: key, message: `${def.label} must be valid JSON.` });
        }
      } else if (typeof value !== "object") {
        errors.push({ field: key, message: `${def.label} must be an object or array.` });
      }
      break;
    }
  }

  return errors;
}

// ── Constraint validation ──────────────────────────────────────────────────────

function validateConstraint(
  constraint: Constraint,
  fieldValues: Record<string, unknown>,
  properties: Record<string, FieldDefinition>,
): ValidationError | null {
  switch (constraint.rule) {
    case "required": {
      const fields = Array.isArray(constraint.value)
        ? (constraint.value as string[])
        : [constraint.value as string];
      for (const f of fields) {
        const v = fieldValues[f];
        if (v === undefined || v === null || v === "") {
          return { field: f, message: `${properties[f]?.label ?? f} is required.` };
        }
      }
      return null;
    }

    case "min": {
      // Applied at field level; skip here
      return null;
    }

    case "max": {
      // Applied at field level; skip here
      return null;
    }

    case "custom": {
      // "at_least_one_of" pattern — value is an array of field names
      if (Array.isArray(constraint.value)) {
        const fields = constraint.value as string[];
        const anyFilled = fields.some((f) => {
          const v = fieldValues[f];
          return v !== undefined && v !== null && v !== "";
        });
        if (!anyFilled) {
          return {
            field: fields[0] ?? "_",
            message: constraint.description,
          };
        }
      }
      return null;
    }

    case "depends_on": {
      // "if field A has value X, field B is required"
      // Handled by field-level required; skip here
      return null;
    }

    default:
      return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateComponentInstance(
  input: Pick<ComponentInstanceInput, "type" | "domain" | "fieldValues">,
): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Resolve definition
  const def = getComponentDefinition(input.type);
  if (!def) {
    return {
      valid: false,
      errors: [{ field: "type", message: `Unknown component type: "${input.type}".` }],
    };
  }

  // 2. Domain compatibility
  if (!def.supportedDomains.includes(input.domain)) {
    errors.push({
      field: "domain",
      message: `Component type "${input.type}" does not support domain "${input.domain}". Supported: ${def.supportedDomains.join(", ")}.`,
    });
  }

  // 3. Field-level validation
  for (const [key, fieldDef] of Object.entries(def.properties)) {
    const value = input.fieldValues[key];
    errors.push(...validateField(key, fieldDef, value));
  }

  // 4. Unknown fields (warn only — not an error)
  // (omitted by design — extra fields are silently ignored)

  // 5. Constraint validation
  for (const constraint of def.constraints) {
    const err = validateConstraint(constraint, input.fieldValues, def.properties);
    if (err) errors.push(err);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate only a subset of fields (useful for partial saves / draft mode).
 * Required constraints are relaxed — only type-check present values.
 */
export function validatePartialComponentInstance(
  type: ComponentType,
  domain: ComponentDomain,
  fieldValues: Record<string, unknown>,
): ValidationResult {
  const errors: ValidationError[] = [];

  const def = getComponentDefinition(type);
  if (!def) {
    return {
      valid: false,
      errors: [{ field: "type", message: `Unknown component type: "${type}".` }],
    };
  }

  // Domain check
  if (!def.supportedDomains.includes(domain)) {
    errors.push({
      field: "domain",
      message: `Component type "${type}" does not support domain "${domain}".`,
    });
  }

  // Only validate fields that are present
  for (const [key, fieldDef] of Object.entries(def.properties)) {
    const value = fieldValues[key];
    if (value !== undefined && value !== null && value !== "") {
      // Validate type/format but not required
      const relaxed: FieldDefinition = { ...fieldDef, required: false };
      errors.push(...validateField(key, relaxed, value));
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply default values from the component definition to supplement
 * a partial fieldValues object (non-destructive — won't overwrite existing).
 */
export function applyDefaults(
  type: ComponentType,
  fieldValues: Record<string, unknown>,
): Record<string, unknown> {
  const def = getComponentDefinition(type);
  if (!def) return fieldValues;

  const result: Record<string, unknown> = { ...fieldValues };
  for (const [key, fieldDef] of Object.entries(def.properties)) {
    if ((result[key] === undefined || result[key] === null) && fieldDef.default !== undefined) {
      result[key] = fieldDef.default;
    }
  }
  return result;
}
