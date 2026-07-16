/**
 * Design Template Engine — Variable Resolver & Formatter
 *
 * Resolves VariableBinding references in a template against a RenderDataRow,
 * applies formatters, evaluates conditional visibility, and validates required fields.
 *
 * Security rules:
 *  - No eval, no Function constructor, no dynamic code execution.
 *  - Operator set for conditionalVisibility is strictly enumerated.
 *  - Formatter output is always a plain string.
 */

import type {
  DesignTemplate,
  DesignElement,
  RenderDataRow,
  RenderWarning,
  TemplateVariable,
  ConditionalVisibility,
  VariableBinding,
  VariableFormatter,
} from "../types/designTemplate.js";

// ── Formatters ────────────────────────────────────────────────────────────────

function applyFormatter(
  raw: string,
  formatter: VariableFormatter,
  opts: { truncateAt?: number; currencyCode?: string; dateFormat?: string } = {},
): string {
  switch (formatter) {
    case "uppercase":
      return raw.toUpperCase();
    case "lowercase":
      return raw.toLowerCase();
    case "titlecase":
      return raw.replace(/\b\w/g, (c) => c.toUpperCase());
    case "truncate": {
      const at = opts.truncateAt ?? 80;
      return raw.length > at ? raw.slice(0, at) + "…" : raw;
    }
    case "currency": {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: opts.currencyCode ?? "USD",
          maximumFractionDigits: 2,
        }).format(num);
      } catch {
        return raw;
      }
    }
    case "number": {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      return new Intl.NumberFormat("en-US").format(num);
    }
    case "percentage": {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      return `${(num * 100).toFixed(1)}%`;
    }
    case "date": {
      // Simple date formatter — safe subset only
      try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw;
        const fmt = opts.dateFormat ?? "DD MMM YYYY";
        const pad = (n: number) => String(n).padStart(2, "0");
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        // Replace MMM before MM to avoid "MM" clobbering the "MM" inside "MMM"
        return fmt
          .replace("MMM", months[d.getMonth()]!)
          .replace("YYYY", String(d.getFullYear()))
          .replace("MM", pad(d.getMonth() + 1))
          .replace("DD", pad(d.getDate()));
      } catch {
        return raw;
      }
    }
    default:
      return raw;
  }
}

// ── Single value resolver ─────────────────────────────────────────────────────

export function resolveBinding(
  binding: VariableBinding,
  data: RenderDataRow,
): { value: string; missing: boolean } {
  const raw = data[binding.variableKey];

  if (raw === null || raw === undefined || raw === "") {
    const fallback = binding.fallback ?? "";
    return { value: fallback, missing: true };
  }

  let str = String(raw);
  if (binding.formatter) {
    str = applyFormatter(str, binding.formatter, {
      truncateAt: binding.truncateAt,
      currencyCode: binding.currencyCode,
      dateFormat: binding.dateFormat,
    });
  }
  return { value: str, missing: false };
}

export function resolveTextContent(
  content: string | { binding: VariableBinding },
  data: RenderDataRow,
): { value: string; missing: boolean } {
  if (typeof content === "string") {
    return { value: content, missing: false };
  }
  return resolveBinding(content.binding, data);
}

// ── Conditional Visibility ────────────────────────────────────────────────────

export function evaluateVisibility(
  condition: ConditionalVisibility | undefined,
  data: RenderDataRow,
): boolean {
  if (!condition) return true;

  const raw = data[condition.variable];
  const isEmpty = raw === null || raw === undefined || raw === "";

  switch (condition.operator) {
    case "is_empty":
      return isEmpty;
    case "is_not_empty":
      return !isEmpty;
    case "equals":
      // eslint-disable-next-line eqeqeq -- intentional loose equality for mixed types
      return String(raw ?? "") == String(condition.value ?? "");
    case "not_equals":
      return String(raw ?? "") != String(condition.value ?? "");
    default:
      return true;
  }
}

// ── Variable Validation ───────────────────────────────────────────────────────

export type VariableValidationResult = {
  valid: boolean;
  missingRequired: string[];
  invalidFields: Array<{ key: string; error: string }>;
};

export function validateRenderData(
  variables: TemplateVariable[],
  data: RenderDataRow,
): VariableValidationResult {
  const missingRequired: string[] = [];
  const invalidFields: Array<{ key: string; error: string }> = [];

  for (const variable of variables) {
    const raw = data[variable.key];
    const isEmpty = raw === null || raw === undefined || raw === "";

    if (variable.required && isEmpty) {
      missingRequired.push(variable.key);
      continue;
    }

    if (isEmpty) continue; // optional, skip further validation

    if (variable.validation) {
      const v = variable.validation;
      const str = String(raw);

      if (v.maxLength !== undefined && str.length > v.maxLength) {
        invalidFields.push({ key: variable.key, error: `Exceeds maxLength ${v.maxLength}` });
      }
      if (v.minLength !== undefined && str.length < v.minLength) {
        invalidFields.push({ key: variable.key, error: `Below minLength ${v.minLength}` });
      }
      if (v.pattern) {
        try {
          const re = new RegExp(v.pattern);
          if (!re.test(str)) {
            invalidFields.push({ key: variable.key, error: `Does not match pattern` });
          }
        } catch {
          // invalid pattern stored — skip silently (caught at template-save time)
        }
      }
      if (typeof raw === "number" || variable.type === "number" || variable.type === "currency") {
        const num = parseFloat(str);
        if (!isNaN(num)) {
          if (v.min !== undefined && num < v.min) {
            invalidFields.push({ key: variable.key, error: `Value below min ${v.min}` });
          }
          if (v.max !== undefined && num > v.max) {
            invalidFields.push({ key: variable.key, error: `Value above max ${v.max}` });
          }
        }
      }
    }
  }

  return {
    valid: missingRequired.length === 0 && invalidFields.length === 0,
    missingRequired,
    invalidFields,
  };
}

// ── Idempotency Hash ──────────────────────────────────────────────────────────

import { createHash } from "crypto";

/**
 * Deterministic SHA-256 of (templateVersionId + canonicalized inputData).
 * Same version + same data always produces the same hash → idempotent renders.
 */
export function computeInputHash(templateVersionId: number, data: RenderDataRow): string {
  const canonical = JSON.stringify({ v: templateVersionId, d: sortedKeys(data) });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedKeys(obj: RenderDataRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// ── Tenant Guard ──────────────────────────────────────────────────────────────

export class TenantAccessError extends Error {
  constructor(resource: string) {
    super(`Cross-tenant access denied for ${resource}`);
    this.name = "TenantAccessError";
  }
}

export function assertTenantMatch(
  resourceTenantId: string,
  requestTenantId: string,
  resource: string,
): void {
  if (resourceTenantId !== requestTenantId) {
    throw new TenantAccessError(resource);
  }
}
