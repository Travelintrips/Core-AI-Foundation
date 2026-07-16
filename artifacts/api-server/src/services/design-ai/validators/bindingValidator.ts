/**
 * Binding Validator — Variable Binding Consistency
 *
 * Ensures every variable key referenced by a binding exists in the
 * template's declared variables array. Also checks that variable
 * definitions have valid keys and types.
 *
 * Deterministic — no AI calls.
 */

import type { DesignTemplate } from "../../../types/designTemplate.js";
import type { ValidationIssue } from "../types/engineering.types.js";
import { getElementBindingKey } from "./templateValidator.js";

const VALID_VARIABLE_TYPES = new Set(["text","number","currency","image","color","url","date","boolean"]);
const SAFE_ID = /^[a-zA-Z0-9_\-]+$/;

export function runBindingValidator(template: DesignTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const declaredKeys = new Set(template.variables.map((v) => v.key));

  // ── 1. Check each binding references a declared variable ──────────────────
  for (const el of template.elements) {
    const key = getElementBindingKey(el);
    if (key !== null && !declaredKeys.has(key)) {
      issues.push({
        code: "BINDING_NOT_FOUND",
        severity: "error",
        nodeId: el.id,
        field: "content.binding.variableKey",
        message: `Element "${el.id}" references variable "${key}" which is not declared in variables[].`,
        suggestedFix: `Add { key: "${key}", label: "...", type: "text" } to the variables array, or remove the binding.`,
      });
    }
  }

  // ── 2. Check image src bindings ───────────────────────────────────────────
  for (const el of template.elements) {
    if (el.type !== "image") continue;
    const s = (el as any).src;
    if (s && typeof s === "object" && "binding" in s) {
      const key = s.binding?.variableKey;
      if (key && !declaredKeys.has(key)) {
        issues.push({
          code: "BINDING_NOT_FOUND",
          severity: "error",
          nodeId: el.id,
          field: "src.binding.variableKey",
          message: `Image element "${el.id}" references variable "${key}" which is not declared.`,
          suggestedFix: `Declare variable "${key}" in the variables array.`,
        });
      }
    }
  }

  // ── 3. Validate variable definition keys ──────────────────────────────────
  for (const v of template.variables) {
    if (!SAFE_ID.test(v.key)) {
      issues.push({
        code: "INVALID_VARIABLE_KEY",
        severity: "error",
        field: `variables[${v.key}].key`,
        message: `Variable key "${v.key}" contains invalid characters. Only [a-zA-Z0-9_-] allowed.`,
        suggestedFix: "Use only alphanumeric characters, hyphens, and underscores.",
      });
    }
    if (!VALID_VARIABLE_TYPES.has(v.type)) {
      issues.push({
        code: "INVALID_VARIABLE_TYPE",
        severity: "error",
        field: `variables[${v.key}].type`,
        message: `Variable "${v.key}" has invalid type "${v.type}".`,
        suggestedFix: `Use one of: ${[...VALID_VARIABLE_TYPES].join(", ")}.`,
      });
    }
  }

  // ── 4. Declared variables unused (info only) ──────────────────────────────
  const usedKeys = new Set<string>();
  for (const el of template.elements) {
    const key = getElementBindingKey(el);
    if (key) usedKeys.add(key);
  }
  for (const v of template.variables) {
    if (!usedKeys.has(v.key)) {
      issues.push({
        code: "UNUSED_VARIABLE",
        severity: "info",
        field: `variables[${v.key}]`,
        message: `Variable "${v.key}" is declared but not bound to any element.`,
        suggestedFix: "Remove unused variable or bind it to an element.",
      });
    }
  }

  return issues;
}
